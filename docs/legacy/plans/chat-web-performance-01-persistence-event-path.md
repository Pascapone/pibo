# Chat Web Performance 01: Persistence vom Router-Event-Pfad entkoppeln

## Zweck

Dieses Dokument bewertet den Umbau, Persistenzarbeit aus dem heißen Router-Event-Pfad zu reduzieren oder zu entkoppeln. Es dient als Planungs- und Risikodokument, nicht als Implementierungsspezifikation.

## Ausgangslage

`ensureEventIndexing()` in `src/apps/chat/web-app.ts` verarbeitet jedes Router-Event synchron. Der Pfad schreibt je nach Event in mehrere Stores:

- `ChatEventLog` in `src/apps/chat/event-log.ts`
- `ChatWebReadModel` in `src/apps/chat/read-model.ts`
- `PiboReliabilityStore` in `src/reliability/store.ts`
- Session-read cursor über `markActiveSessionRead()`
- Live-Listener für Browser-SSE

Alle drei Stores verwenden `DatabaseSync`. SQLite-Operationen blockieren also den Node.js-Thread. Bei hoher Eventrate, Tool-Updates oder vielen Subagenten kann der Gateway dadurch weniger responsiv werden.

## Was sinnvoll ist

### Prepared Statements cachen

Das ist der risikoärmste erste Schritt. Der Code ruft heute in vielen Methoden wiederholt `this.db.prepare(...)` auf. Hotspots sind:

- `ChatEventLog.appendEvent()`
- `ChatEventLog.getLatestStreamId()`
- `ChatEventLog.markSessionRead()`
- `ChatWebReadModel.upsertSession()`
- `ChatWebReadModel.recordEvent()`
- `ChatWebReadModel.nextEventSequence()`
- `PiboReliabilityStore.append()`
- `PiboReliabilityStore.appendOnce()`

Caching reduziert CPU- und GC-Kosten, ohne die Persistenzsemantik zu ändern.

### Kleine lokale Transactions einführen

Transactions sind sinnvoll, wenn mehrere Writes in derselben SQLite-Datenbank logisch zusammengehören. Sie reduzieren fsync-/WAL-Overhead und halten Zwischenzustände kürzer.

Wichtig: `web-chat.sqlite` und `pibo-events.sqlite` sind getrennte Datenbanken. Eine lokale Transaction in einem Store macht die gesamte Eventindexierung nicht atomar über alle Stores.

### Write-Anzahl reduzieren

Vor einer Queue sollte der Code unnötige Writes vermeiden:

- Session nur upserten, wenn relevante Felder geändert sind.
- Status-Updates vermeiden, wenn der Status unverändert bleibt.
- Read-cursor nur schreiben, wenn der neue Stream höher ist.

## Was riskant ist

### Bounded in-process Queue

Eine Queue kann Request- und Eventpfade entlasten, verändert aber die Semantik. Risiken:

- Events können bei Prozesscrash verloren gehen, wenn sie noch nicht durable sind.
- Event-Reihenfolge pro Pibo Session kann kaputtgehen.
- Live-SSE kann Events anzeigen, die noch nicht dauerhaft gespeichert sind.
- Fehler können im Hintergrund verschwinden.
- Queue overflow braucht eine klare Policy.

Eine Queue darf nur eingeführt werden, wenn folgende Fragen beantwortet sind:

- Welche Events müssen durable sein, bevor sie an Clients gehen?
- Welche Events dürfen gedroppt werden? Wahrscheinlich nur Live-Deltas.
- Blockiert der Router bei voller Queue oder schließt er langsame Clients?
- Wie werden Persistenzfehler an UI, Logs und Operator sichtbar?

### Separater Persistence Worker

Ein Worker ist ein fundamentaler Architekturumbau. Er braucht:

- definierte Shutdown-/Flush-Semantik;
- Crash-Recovery;
- Idempotenz für wiederholte Events;
- Ordering pro Session;
- klare Backpressure;
- Tests für Prozessabbruch und Wiederanlauf.

Das sollte nicht Teil eines kleinen Performance-Patches sein.

## Was den Code fundamental ändert

Fundamental wird der Umbau, sobald Persistenz asynchron wird. Dann ist der Router nicht mehr automatisch an durable Writes gekoppelt. Das betrifft:

- Chat Event Log als Durable Event Stream;
- Read Model als UI-Projection;
- Reliability Store als Audit-/Recovery-Schicht;
- SSE-Replay über `eventLog.listEvents()`;
- Trace-Versionierung über `latestStreamId` und `event_sequence`.

## Problematische Annahmen

Eine häufige falsche Annahme wäre: „Wir können alle Writes einfach in eine Queue legen.“ Das übersieht, dass Chat Web Replay, Trace-Aufbau und Unread Counts direkt von gespeicherten Events abhängen.

Eine zweite falsche Annahme wäre: „Transactions lösen die ganze Konsistenzfrage.“ Sie lösen nur lokale SQLite-Konsistenz, nicht Multi-DB-Konsistenz.

## Übersehene Punkte

### Event-Sequenzierung

`ChatWebReadModel.nextEventSequence()` nutzt `MAX(event_sequence) + 1`. Wenn mehrere Writer oder ein Worker ins Spiel kommen, muss diese Sequenzierung geschützt werden.

### Multi-DB-Konsistenz

Ein Event kann im Chat Event Log geschrieben sein, aber im Read Model oder Reliability Store fehlen. Der aktuelle Code nimmt diese Nähe implizit an. Ein Umbau muss Recovery für partielle Writes definieren.

### Live-vs-durable Semantik

Live-Events und persistierte Events laufen im gleichen Indexing-Pfad. Der Umbau muss unterscheiden zwischen:

- flüchtigen Streaming-Deltas;
- Chat-Nachrichten;
- Trace-Events;
- Audit-/Reliability-Events.

## Empfohlene Reihenfolge

1. Hot Statements cachen.
2. Idempotente Write-Skip-Checks ergänzen.
3. Lokale Transactions in einzelnen Stores verwenden.
4. Metriken für Write-Dauer und Queue-Druck erfassen.
5. Erst danach eine bounded Queue spezifizieren.
6. Worker nur nach Messung und separatem Design.

## Akzeptanzkriterien

- Event-Reihenfolge bleibt pro Pibo Session stabil.
- SSE-Replay verliert keine persistierten Events.
- Trace-Aufbau und Unread Counts bleiben korrekt.
- Persistenzfehler werden sichtbar geloggt und erreichen Debug-/Health-Ausgaben.
- `npm run typecheck`, `npm test` und relevante Chat-Trace-Tests bleiben grün.

## Mindesttests

- Persisted Events erscheinen in `ChatEventLog` und `ChatWebReadModel` in derselben Reihenfolge.
- Duplicate Events bleiben idempotent.
- `message_finished` korreliert weiter mit `assistant_message`.
- Restart nach partieller Indexierung kann den Zustand rekonstruieren oder meldet einen klaren Fehler.
- Hohe Eventrate blockiert den Gateway messbar weniger als vorher.
