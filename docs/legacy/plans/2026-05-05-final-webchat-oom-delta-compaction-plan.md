# Finaler Umsetzungsplan: Webchat OOM + Delta Compaction

Datum: 2026-05-05

## Kurzentscheidung

Wir beheben die OOM-Ursache an zwei Stellen:

1. **Neue Runs:** Streaming-Deltas bleiben live-only. Durable Stores speichern keine neuen `assistant_delta`, `thinking_delta` oder `tool_execution_updated` Events.
2. **Bestandsdaten:** Vorhandene Delta-Rows werden nicht nur gelöscht. Ein Operator-Prozess fasst sie, wo sicher möglich, zu kanonischen finalen Events zusammen und ersetzt die alten Rows.

Persistierte Ziel-Events sind vorhandene kanonische Event-Typen:

- `assistant_message`
- `thinking_started`
- `thinking_finished`
- finale `tool_call`-Zustände
- `tool_execution_started`
- `tool_execution_finished`
- Turn-/Fehler-/Audit-Events

Wir führen keine neuen sichtbaren Delta-Eventtypen ein. Für Migration und Nachvollziehbarkeit ergänzen wir eine Audit-Tabelle.

## Nicht verhandelbare Anforderungen

- Neue durable Writes enthalten keine `assistant_delta`, `thinking_delta`, `tool_execution_updated`.
- Live-SSE streamt weiterhin kleine Text-Chunks.
- Reload abgeschlossener Sessions liest kanonische Events, keine Deltas.
- `/api/chat/trace` lädt keine unbounded Full-History mehr.
- Trace-Cache hält keine großen Raw-Historien.
- Bestandsmigration ist idempotent und löscht unsichere Gruppen nicht still.
- Produktive DB-Migration läuft nur nach Backup, Dry-Run und expliziter Freigabe.
- Web-/Browser-Verifikation läuft im Docker Compute System, nicht gegen den Host-Gateway.

## Aktuelle Hotspots

- `src/apps/chat/web-app.ts`
  - `ensureEventIndexing(...)` persistiert jedes Output-Event dreifach.
  - `/api/chat/trace` nutzt `state.readModel.listAllEvents(...)`.
  - `TRACE_CACHE_MAX_ENTRIES = 128`.
  - SSE-Listener erwarten aktuell `StoredChatEvent`.
- `src/apps/chat/stream.ts`
  - `chatStreamFramesFromOutputEvent(...)` hängt immer `RAW_EVENT` an.
- `src/apps/chat/event-log.ts`
  - `appendOutputEvent(...)` akzeptiert live-only Deltas.
  - Retention existiert, läuft aber nicht automatisch.
- `src/apps/chat/read-model.ts`
  - `recordEvent(...)` akzeptiert live-only Deltas.
  - Status hängt teilweise an Delta-Events.
  - `listAllEvents(...)` ist unbounded.
- `src/reliability/store.ts`
  - `pibo.output` speichert high-volume live-delta Mirror.
- `src/apps/chat-ui/src/App.tsx`
  - `selectedTraceEvents` wächst mit `RAW_EVENT`-Deltas.
- `src/debug/index.ts`
  - Debug Events hat Stats/Prune, aber noch keine Delta-Kompaktion.

## Zielarchitektur

```text
PiboOutputEvent
  ├─ Live path
  │    ├─ Deltas sofort an aktive SSE-Clients
  │    └─ In-memory Snapshots für Reconnect laufender Turns
  └─ Durable path
       ├─ nur kanonische Events
       ├─ keine live-only Deltas
       └─ Audit/Retention in kleinen Batches
```

Neue zentrale Komponente:

```text
src/apps/chat/output-compactor.ts
```

Vertrag:

```ts
type OutputCompactorResult = {
  liveEvents: PiboOutputEvent[];
  persistedEvents: PiboOutputEvent[];
  snapshots: PiboOutputEvent[];
};
```

Regeln:

- `assistant_delta`: live senden, buffer append, nicht persistieren.
- `assistant_message`: finalen Text persistieren; falls leer, Buffer verwenden.
- `thinking_started`: persistieren und Buffer starten.
- `thinking_delta`: live senden, buffer append, nicht persistieren.
- `thinking_finished`: finalen Text persistieren; falls leer, Buffer verwenden.
- `tool_execution_updated`: live-only; letzter Stand nur in-memory.
- `tool_execution_finished`: finale Tool-Ausgabe persistieren.
- `message_finished`/`session_error`: offene Buffer sicher flushen.

Gruppierungs-Keys:

```text
Assistant: piboSessionId + eventId + (assistantIndex ?? contentIndex ?? 0)
Thinking:  piboSessionId + eventId + (thinkingIndex ?? contentIndex ?? 0)
Tool:      piboSessionId + eventId + toolCallId
```

## Bestandsmigration

Die Migration ersetzt alte Delta-Runs durch kanonische Events. Sie läuft offline auf Kopien und später in einem Wartungsfenster.

### Sicherheitsklassen

- `safe-final-exists`: Finales Event existiert. Deltas können weg.
- `safe-synthesize`: Kein finales Event, aber Delta-Gruppe ist eindeutig. Synthetisches finales Event ist sicher.
- `needs-review`: Eindeutigkeit fehlt oder Text weicht ab. Nicht automatisch ändern.
- `unsafe`: Keine zuverlässige Rekonstruktion. Nicht ändern.

### Store-Strategie

#### `chat_events`

- Temporäre Tabelle neu schreiben.
- Alte Rows in `stream_id`-Reihenfolge streamen.
- Delta-Gruppen durch finale Events ersetzen.
- Neue `stream_id`s verdichtet vergeben.
- `chat_session_reads.last_read_stream_id` über Old-to-New-Mapping konservativ umsetzen.

#### `web_chat_events`

- Temporäre Tabelle neu schreiben.
- `event_sequence` neu verdichten.
- `stream_id` auf neue `chat_events.stream_id` mappen, falls vorhanden.
- Deltas und `tool_execution_updated` entfernen.

#### `pibo_event_stream`

- Nur `topic = 'pibo.output'` bearbeiten.
- Consumer-Offsets respektieren.
- Ohne `--destructive` keine Rows löschen, die Consumer noch brauchen.
- Wenn keine Consumer existieren, kann der Dry-Run destructive Cleanup empfehlen.

### Synthese-Regeln

Assistant:

- `assistant_delta.text` in Persistenzreihenfolge joinen.
- Existiert `assistant_message`, bleibt dessen Text authoritative.
- Fehlt `assistant_message`, synthetisches `assistant_message` erzeugen.

Thinking:

- `thinking_started` behalten, falls vorhanden.
- `thinking_delta.text` joinen.
- `thinking_finished.text` behalten oder ergänzen.
- Fehlt `thinking_finished`, synthetisches `thinking_finished` erzeugen.

Tools:

- `tool_execution_started` behalten.
- `tool_execution_updated` entfernen, wenn `tool_execution_finished` existiert.
- Fehlt Finish, Gruppe als `needs-review` klassifizieren oder explicit incomplete synthetisieren.
- Mehrere `tool_call` Rows auf finale `argsComplete: true` Version reduzieren; sonst letzte Args-Version behalten.

### Audit-Tabelle

```sql
CREATE TABLE IF NOT EXISTS chat_event_compactions (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  pibo_session_id TEXT,
  event_id TEXT,
  group_key TEXT NOT NULL,
  old_event_types_json TEXT NOT NULL,
  old_row_count INTEGER NOT NULL,
  old_first_order INTEGER,
  old_last_order INTEGER,
  new_event_type TEXT,
  new_order INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);
```

Payloads bleiben normale `PiboOutputEvent`s. Migration-Metadata lebt in der Audit-Tabelle, nicht in den Trace-Payloads.

### Operator-Command

```bash
pibo debug events compact-deltas --dry-run
pibo debug events compact-deltas --apply
pibo debug events compact-deltas --apply --store chat
pibo debug events compact-deltas --apply --store read-model
pibo debug events compact-deltas --apply --store reliability
pibo debug events compact-deltas --session ps_...
pibo debug events compact-deltas --include-needs-review
```

Dry-Run muss ausgeben:

- Row Counts vor/nach Plan
- Gruppen pro Sicherheitsklasse
- geplante synthetische Events
- geplante Deletes
- Text-Mismatch-Warnungen
- Beispielgruppen mit IDs und kurzen Snippets
- Consumer-Offset-Hinweise für Reliability

## Arbeitspakete

### Paket A: Event-Klassifikation und OutputCompactor

Ziel: Gemeinsamer Vertrag für live-only vs. persistierbare Events.

Dateien:

- `src/apps/chat/output-compactor.ts`
- optional `src/apps/chat/output-event-policy.ts`
- `src/core/events.ts`, nur wenn Typen sauberer werden müssen
- neue Unit-Tests

Lieferung:

- `isLiveOnlyOutputEvent(...)`
- `isPersistableOutputEvent(...)`
- stabile Key-Funktionen für Assistant/Thinking/Tool
- `OutputCompactor`
- Tests für Assistant, Thinking, Tools, Fehler, Cleanup

Abhängigkeiten: keine.

### Paket B: Server Ingest und SSE/Reconnect

Ziel: `ensureEventIndexing(...)` trennt Live- und Durable-Pfad.

Dateien:

- `src/apps/chat/web-app.ts`
- `src/apps/chat/stream.ts`
- Tests in `test/web-channel.test.mjs`

Lieferung:

- `ChatWebAppState` enthält Compactor.
- Live-Listener können transient live Events und stored Events verarbeiten.
- Deltas gehen sofort an SSE, aber nicht an Stores.
- `RAW_EVENT` wird nur für persistierbare Events gesendet.
- Reconnect replayt persisted Events plus aktuelle Snapshots.

Abhängigkeiten: Paket A.

### Paket C: Store Guards und Read Model

Ziel: Durable Stores lehnen live-only Deltas defensiv ab.

Dateien:

- `src/apps/chat/event-log.ts`
- `src/apps/chat/read-model.ts`
- relevante Tests

Lieferung:

- `appendOutputEvent(...)` persistiert keine live-only Deltas.
- `recordEvent(...)` persistiert keine live-only Deltas.
- Status hängt nicht mehr an Delta-Events.
- Methoden für bounded Trace-Listing und Activity-Checks:
  - `hasSessionActivity(...)`
  - `listTraceEvents(...)` oder gleichwertig
  - `countEventsByType(...)` für Tests/Debug

Abhängigkeiten: Paket A für Policy-Helfer.

### Paket D: Trace API und Cache

Ziel: Trace-Aufrufe bleiben bounded.

Dateien:

- `src/apps/chat/web-app.ts`
- `src/apps/chat/trace.ts`
- `src/shared/trace-engine.ts`, nur falls nötig
- Tests in `test/chat-trace.test.mjs`, `test/web-channel.test.mjs`

Lieferung:

- `/api/chat/trace` nutzt bounded/canonical Events.
- Profilwechsel-Check baut keine Full Trace View mehr.
- `trace-at-sequence` filtert SQL-seitig und ist limitiert.
- Trace-Cache sinkt auf 16-32 Entries.
- Views mit Raw Events werden nicht gecacht.

Abhängigkeiten: Paket C.

### Paket E: Client Live Reducer

Ziel: Browser-State wächst nach Finalisierung nicht mit Delta-Anzahl.

Dateien:

- `src/apps/chat-ui/src/traceLiveReducer.ts`
- `src/apps/chat-ui/src/App.tsx`
- UI/Integration-Tests

Lieferung:

- Live-Deltas mergen temporär.
- `assistant_message` ersetzt passende Assistant-Deltas.
- `thinking_finished` ersetzt passende Thinking-Deltas.
- `tool_execution_finished` ersetzt Tool-Updates.
- `selectedTraceEvents` bleibt bounded.

Abhängigkeiten: Paket B für SSE-Vertrag. Kann nach finalem Vertrag parallel starten.

### Paket F: Legacy-Migration Analyzer und CLI

Ziel: Dry-Run und Apply für intelligente Bestandskompaktion.

Dateien:

- `src/debug/index.ts`
- neue Datei, z. B. `src/debug/delta-compaction.ts`
- ggf. Migration-Helfer unter `src/apps/chat/`
- Tests mit SQLite-Fixtures

Lieferung:

- `pibo debug events compact-deltas --dry-run`
- `--apply` mit Backup-/Bestätigungslogik
- Sicherheitsklassen
- temporärer Tabellen-Rewrite für `chat_events` und `web_chat_events`
- Reliability-Cleanup mit Consumer-Offset-Schutz
- Audit-Tabelle
- Idempotenztests

Abhängigkeiten: Paket A für Key-/Policy-Helfer. Analyzer kann parallel mit A beginnen, muss vor Merge angepasst werden.

### Paket G: Retention und Background Purge

Ziel: Wachstum bleibt nach der Umstellung begrenzt.

Dateien:

- `src/apps/chat/web-app.ts`
- `src/apps/chat/event-log.ts`
- `src/reliability/store.ts`, falls Hilfsmethoden fehlen
- Debug/Tests

Lieferung:

- Default-Retention-Policy beim Web-App-Start.
- Background-Purge in kleinen Batches.
- Keine Retention-Löschung unsicherer Legacy-Deltas vor Migration/Klassifizierung.
- Fehler werden geloggt, nicht geworfen.

Abhängigkeiten: Paket C, teilweise unabhängig.

### Paket H: Integration, E2E und Rollout-Skript

Ziel: Gesamtverhalten beweisen.

Dateien:

- Tests nach Bedarf
- ggf. `docs/` oder `reports/` mit Validierung

Lieferung:

- synthetischer Langstream-Test
- Store-Count-Assertions: null neue live-only Delta Rows
- Trace-Memory/Bounded-Check
- Docker-Compute-Webcheck
- Browser-Test: Streaming, Reload, Reconnect, lange Session, Tool-Updates
- finaler Validierungsbericht

Abhängigkeiten: alle Pakete.

## Parallelisierung

### Welle 1: unabhängige Grundlagen

Parallel starten:

- Paket A: Compactor/Policy
- Paket F: Migration Analyzer Dry-Run, zunächst mit lokal duplizierten Keys
- Paket D: Trace-Cache-Reduktion und Profilwechsel-Check-Entkopplung, soweit ohne neue Store-Methoden möglich
- Paket E: Client Reducer-Grundstruktur gegen aktuellen `RAW_EVENT`-Strom

### Welle 2: Server-Persistenz umstellen

Nach Paket A:

- Paket B: Server Ingest/SSE
- Paket C: Store Guards und bounded Listing
- Paket F: Analyzer auf gemeinsame Key-/Policy-Helfer umstellen

### Welle 3: Migration und Retention

Nach Paket C:

- Paket D finalisieren
- Paket F Apply/Rewrites finalisieren
- Paket G Background Purge einbauen

### Welle 4: Integration

Nach B-F:

- Paket H führt Tests, Docker Worker, Browser und Validierungsbericht aus.
- Danach erst Produktiv-Migrationsplan und Deployment-Freigabe.

## Gemeinsame Agent-Anweisung

Diese Anweisung vor jeden Agentenauftrag setzen:

> Lies `GLOSSARY.md`, `docs/delta-compaction-hardening-plan.md`, `reports/2026-05-05-webchat-oom-analysis.md` und `plans/2026-05-05-final-webchat-oom-delta-compaction-plan.md`. Ändere nur Dateien, die dein Auftrag braucht. Starte oder restarte nicht den Host-Gateway `pibo-web`. Nutze für Web-/Browser-Verifikation das Docker Compute System und die dortigen Browser/CDP-Ports. Arbeite analytisch, halte den Diff klein, füge Tests hinzu und nenne am Ende die gelaufenen Checks.

## Agent-Prompts

Die Prompts sind kurz gehalten. Die Modelle sollen die Umsetzung selbst planen und die Anforderungen erfüllen.

### Agent A Prompt

> Implementiere die zentrale Output-Event-Policy und den `OutputCompactor` für Chat Web. Neue durable Events dürfen nie `assistant_delta`, `thinking_delta` oder `tool_execution_updated` enthalten. Live-Streaming muss unverändert Deltas liefern. Füge fokussierte Unit-Tests für Assistant-, Thinking-, Tool-, Fehler- und Cleanup-Fälle hinzu.

### Agent B Prompt

> Baue den Chat-Web-Ingest so um, dass `ensureEventIndexing()` den `OutputCompactor` nutzt. Trenne transient live SSE von durable Store-Writes. Sende `RAW_EVENT` nur für persistierbare Events. Reconnect muss persistierte Events plus aktuelle Snapshots laufender Turns senden. Ergänze Web-Channel-Tests.

### Agent C Prompt

> Härte `ChatEventLog` und `ChatWebReadModel`: live-only Deltas defensiv nicht persistieren, Status nicht aus Deltas ableiten, bounded/canonical Trace-Listing und Activity-Checks bereitstellen. Ergänze Tests, die in allen durable Stores null neue live-only Delta Rows erwarten.

### Agent D Prompt

> Mache `/api/chat/trace` bounded. Entferne Full-History-Aufrufe aus normalem Trace-Pfad und Profilwechsel-Check. Reduziere den Trace-Cache und cache keine Raw-Event-Views. Ergänze Tests für große Sessions und Raw-Event-Limits.

### Agent E Prompt

> Implementiere einen Client-seitigen Live-Trace-Reducer. Deltas dürfen während des Streamings temporär wachsen, müssen aber bei `assistant_message`, `thinking_finished` und `tool_execution_finished` durch kanonische Events ersetzt werden. Halte `selectedTraceEvents` bounded und verifiziere Streaming, Reload und Reconnect im Docker/Browsersetup.

### Agent F Prompt

> Implementiere `pibo debug events compact-deltas`. Der Dry-Run klassifiziert bestehende Delta-Gruppen, zeigt Counts, Beispiele und Risiken. `--apply` migriert sichere Gruppen idempotent: Assistant-/Thinking-Deltas werden zu kanonischen finalen Events, Tool-Updates werden sicher reduziert, Tabellen werden reihenfolge-erhaltend rewritten, und eine Audit-Tabelle dokumentiert jede Gruppe. Respektiere Reliability-Consumer-Offsets.

### Agent G Prompt

> Aktiviere Default-Retention und Background-Purge für Chat Web und Reliability in kleinen Batches. Retention darf unsichere Legacy-Deltas nicht vor der Migration löschen. Fehler dürfen Requests und Gateway nicht crashen. Ergänze Tests und Debug-Ausgaben für Counts und Purge-Ergebnisse.

### Agent H Prompt

> Integriere die Pakete und beweise das Zielverhalten. Führe Typecheck, relevante Tests, synthetische Langstream-Tests und Docker-Compute-Browserchecks aus. Prüfe Store-Counts, Trace-Memory-Bounds, Reload, Reconnect und Tool-Update-Verhalten. Schreibe einen kurzen Validierungsbericht mit Befunden und offenen Risiken.

## Merge-Reihenfolge

1. Paket A.
2. Paket C, soweit es nur Policy-Helfer nutzt.
3. Paket B.
4. Paket D.
5. Paket E.
6. Paket F Dry-Run.
7. Paket F Apply.
8. Paket G.
9. Paket H final.

Wenn Paket B und C kollidieren, gewinnt die Store-Guard-Logik aus C; B passt Call-Sites an.

## Verifikation

Pflicht lokal:

```bash
npm run typecheck
npm test
```

Pflicht für Web/Browser:

- Docker Compute Worker spawnen.
- Gateway/Web im Worker testen.
- Browser über Worker-/Browser-Use-Ports prüfen.
- Host-Gateway nicht stoppen, nicht restarten, nicht mit Dev-Auth starten.

Mindestchecks:

- langer Assistant-Stream: Browser zeigt Text chunkweise
- nach Completion: Reload zeigt vollständigen Text ohne Deltas
- langer Thinking-Stream: Reload zeigt finalen Reasoning-Text
- Tool mit Updates: live sichtbar, reload final kompakt
- Reconnect mid-stream: keine doppelten/fehlenden Textteile
- neue DB-Counts: null `assistant_delta`, `thinking_delta`, `tool_execution_updated` in durable Stores
- alte DB-Kopie: Migration-Dry-Run klassifiziert Gruppen und Apply ist idempotent

## Produktiver Ablauf

1. Code in Docker Worker verifizieren.
2. Aktuelle DB-Dateien sichern:
   - `web-chat.sqlite`
   - `web-chat.sqlite-wal`/`web-chat.sqlite-shm`, falls vorhanden
   - `pibo-events.sqlite`
   - `pibo-events.sqlite-wal`/`pibo-events.sqlite-shm`, falls vorhanden
3. Dry-Run auf Kopie ausführen.
4. Report prüfen.
5. Apply auf Kopie ausführen.
6. Trace-/Browserchecks auf migrierter Kopie ausführen.
7. Wartungsfenster und Host-Operationen explizit freigeben lassen.
8. Gateway stoppen, DB-Dateien atomar ersetzen, Gateway starten.
9. Counts, Trace, Browser und Logs prüfen.
10. Backups erst nach Beobachtungszeit löschen.

## Risiken und Gegenmaßnahmen

- **Uneindeutige Legacy-Gruppen:** klassifizieren und nicht automatisch löschen.
- **Text-Mismatch zwischen Deltas und finalem Event:** finales Event bleibt authoritative; Dry-Run meldet Mismatch.
- **SQLite-Locks/Dateigröße:** Migration auf Kopie und Tabellen-Rewrite statt Online-Mutation.
- **Reconnect-Lücken:** Snapshots aus Compactor senden, nicht als DB-Rows ausgeben.
- **Browser-State wächst weiter:** `RAW_EVENT` für live-only Deltas entfernen und Reducer einsetzen.
- **Neue Deltas wachsen nach:** Store Guards verhindern Regression auch bei falscher Call-Site.
- **Trace bleibt teuer:** bounded Listing und kleiner Cache sind Pflicht, unabhängig von Migration.

## Definition of Done

- Neue Sessions persistieren keine `assistant_delta`, `thinking_delta`, `tool_execution_updated` Rows.
- Live-Streaming bleibt inkrementell.
- Reload nutzt kanonische Events.
- Trace API und Cache bleiben bounded.
- Migration fasst sichere Bestandsdeltas intelligent zusammen.
- Migration ist idempotent, reihenfolge-erhaltend und auditierbar.
- Unsichere Gruppen bleiben erhalten und werden gemeldet.
- Retention läuft automatisch in kleinen Batches.
- Docker-Compute-E2E bestätigt Streaming, Reload, Reconnect und Tool-Spans.
