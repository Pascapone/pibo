# Fixplan: Webchat OOM + Delta Compaction

Datum: 2026-05-05

## Quellen

- `reports/2026-05-05-webchat-oom-analysis.md`
- `docs/delta-compaction-hardening-plan.md` aus `stash@{5}^3` wiederhergestellt
- aktueller Code in:
  - `src/apps/chat/web-app.ts`
  - `src/apps/chat/event-log.ts`
  - `src/apps/chat/read-model.ts`
  - `src/apps/chat/stream.ts`
  - `src/apps/chat-ui/src/App.tsx`
  - `src/reliability/store.ts`
  - `src/shared/trace-engine.ts`
  - `src/core/routed-session.ts`
  - `src/core/events.ts`

## Gemeinsames Problemverständnis

Die beiden Berichte beschreiben dasselbe strukturelle Problem aus zwei Richtungen:

1. Der OOM-Report zeigt die betriebliche Auswirkung:
   - sehr große SQLite-Dateien
   - hunderttausende `thinking_delta`/`assistant_delta` Rows
   - dieselben Output-Events werden mehrfach gespiegelt
   - `/api/chat/trace` lädt komplette Session-Historien
   - der Trace-Cache hält große Views im Heap
2. Der Delta-Compaction-Plan definiert das Produktziel:
   - Live-Streaming bleibt chunkweise und latenzarm
   - aber durable Stores dürfen langfristig keine live-only Deltas speichern
   - Reload und Trace müssen aus kanonischen finalen Events funktionieren

Die wichtigste Korrektur gegenüber meinem ersten Zwischenplan: Es sollen **nicht** kompakte `assistant_delta`/`thinking_delta` Segmente dauerhaft gespeichert werden. Ziel ist strenger:

> Neue durable Writes enthalten keine `assistant_delta`, `thinking_delta` oder `tool_execution_updated` Events.

Persistiert werden kanonische Events wie `assistant_message`, `thinking_started`, `thinking_finished`, finale `tool_call`/`tool_execution_finished`, Turn-Boundaries und Fehler-/Audit-Events.

## Aktueller Codebefund

### Ingest-Multiplikator

`ensureEventIndexing(...)` in `src/apps/chat/web-app.ts` speichert derzeit jedes `PiboOutputEvent` in drei Stores:

- `state.eventLog.appendOutputEvent(event, ...)` -> `chat_events`
- `state.readModel.recordEvent(event, session, stored.streamId)` -> `web_chat_events`
- `state.reliabilityStore.append({ topic: "pibo.output", ... })` -> `pibo_event_stream`

Das betrifft auch `assistant_delta`, `thinking_delta` und `tool_execution_updated`.

### Live-SSE und Raw Events

`chatStreamFramesFromOutputEvent(...)` in `src/apps/chat/stream.ts` erzeugt für jedes Output-Event zusätzlich ein `RAW_EVENT` Frame. Damit landen live-only Deltas auch im Browser-State (`selectedTraceEvents`) und können dort unbounded wachsen.

### Trace API

`/api/chat/trace` in `src/apps/chat/web-app.ts` nutzt weiterhin:

```ts
state.readModel.listAllEvents(selectedSession.id)
```

Das lädt alle gespeicherten Events einer Session in ein Array und gibt sie an `buildTraceView(...)` weiter.

Weitere betroffene Stellen:

- Profilwechsel-Check baut ebenfalls eine Trace-View aus allen Events.
- Debug-Endpunkt `trace-at-sequence` lädt alle Events und filtert im Speicher.

### Trace Cache

`TRACE_CACHE_MAX_ENTRIES = 128`. Der Cache speichert komplette `PiboSessionTraceView`s, optional inklusive Raw Events. Für große Sessions ist das zu viel.

### Retention

Vorhanden, aber nicht ausreichend aktiv:

- `ChatEventLog.upsertRetentionPolicy(...)`
- `ChatEventLog.purgeExpired(...)`
- `PiboReliabilityStore.prune(...)`
- Debug CLI für Reliability Stats/Prune

Nicht vorhanden im Runtime-Pfad:

- Default-Retention-Seed
- Background-Purge im Web-Gateway
- automatische Cleanup-Policy für alte `live_delta` Rows

## Machbarkeitsanalyse: bestehende Delta-Daten intelligent ersetzen

Kurzfassung: **Ja, die bestehenden Delta-Rows können grundsätzlich intelligent zusammengeführt und durch kanonische Events ersetzt werden.** Das ist machbar, sollte aber nicht als einfacher `DELETE live_delta`-Job umgesetzt werden. Für `assistant_delta` und `thinking_delta` können wir vollständige Texte rekonstruieren; für `tool_execution_updated` können wir in der Regel auf finale Tool-Events reduzieren. Die Migration muss offline/operativ kontrolliert laufen, in Batches arbeiten, Dry-Run-Berichte erzeugen und eine Rückfallstrategie für uneindeutige Legacy-Sequenzen haben.

### Warum es machbar ist

Die vorhandenen Daten enthalten genug Gruppierungsinformationen, um Delta-Runs zusammenzuführen:

- `piboSessionId` ist in allen relevanten Payloads vorhanden.
- `eventId` ist bei aktuellen Events der Turn-/Message-Schlüssel.
- `assistantIndex`, `thinkingIndex` und `contentIndex` identifizieren mehrere Assistant-/Thinking-Parts innerhalb eines Turns.
- `toolCallId` identifiziert Tool-Call- und Tool-Execution-Spans.
- `stream_id` in `chat_events` und `event_sequence` in `web_chat_events` geben die Persistenzreihenfolge vor.
- `created_at` kann als Diagnose- und Tie-Breaker genutzt werden.

Für abgeschlossene Turns existieren häufig bereits kanonische finale Events:

- `assistant_message` für sichtbaren Assistant-Text
- `thinking_finished` mit optionalem finalem Reasoning-Text
- `tool_execution_finished` für finale Tool-Ergebnisse
- `message_finished` als Turn-Grenze

Wo finale Events fehlen, können sie in vielen Fällen aus zusammenhängenden Deltas synthetisiert werden.

### Was nicht trivial ist

Die Migration darf die Trace-Reihenfolge nicht verfälschen. Ein naiver Ansatz wie „synthetisches `assistant_message` am Ende einfügen und alle Deltas löschen“ kann falsch sein, weil der Assistant-Span dann hinter späteren Tool-Events oder Turn-Grenzen landet.

Darum braucht die Migration eine Reihenfolge-erhaltende Strategie:

1. Für jeden Delta-Run einen kanonischen Ersatz an der Position des Runs erzeugen.
2. Alle übrigen Events in relativer Reihenfolge erhalten.
3. Danach die Tabellen entweder gezielt aktualisieren oder sicherer: in eine kompaktierte Kopie neu schreiben und atomar austauschen.

### Store-spezifische Machbarkeit

#### `chat_events`

Schema:

- Primärordnung: `stream_id INTEGER PRIMARY KEY`
- Keine `event_sequence`
- Payload in `payload_json`
- `event_type` und `retention_class` separat

Machbarkeit: **hoch**, aber exakte Reihenfolge spricht für einen Tabellen-Rewrite statt Append-only-Korrektur.

Empfohlene Methode:

- `chat_events` in eine temporäre Tabelle `chat_events_compacted` neu schreiben.
- Pro Session/Room die alten Rows in `stream_id`-Reihenfolge streamen.
- Delta-Gruppen durch genau ein kanonisches Event ersetzen.
- Neue `stream_id`s sequenziell vergeben.
- `chat_session_reads.last_read_stream_id` anhand einer Old-to-New-Stream-Mapping-Tabelle konservativ umsetzen.
- Danach Tabellen in einer kurzen exklusiven Transaktion umbenennen.

Wenn vorhandene `assistant_message`/`thinking_finished` bereits korrekt sind, werden Deltas einfach entfernt und das finale Event bleibt an seiner vorhandenen Position. Wenn nur Deltas existieren, wird ein synthetisches finales Event an der ersten sinnvollen Position des Delta-Runs eingefügt.

#### `web_chat_events`

Schema:

- Primär-id: UUID `id`
- Reihenfolge: `event_sequence`
- optionaler Link zu `chat_events.stream_id`

Machbarkeit: **hoch**.

Empfohlene Methode:

- Tabelle ebenfalls neu schreiben.
- `event_sequence` neu verdichten.
- `stream_id` für kanonische Events auf den neuen `chat_events.stream_id` mappen, wenn vorhanden; sonst `NULL`.
- Deltas und `tool_execution_updated` entfernen.
- Synthetische finale Events bekommen neue UUIDs, aber stabile Payload-Keys (`eventId`, Indizes, `toolCallId`).

#### `pibo_event_stream` Topic `pibo.output`

Schema:

- Primärordnung: `stream_id`
- Topic/Key/EventId/RetentionClass/Payload
- Im aktuellen OOM-Report waren keine Consumer-Offsets vorhanden; die Tabelle kann aber Consumer haben.

Machbarkeit: **mittel bis hoch**, abhängig von Consumer-Anforderungen.

Empfohlene Methode:

- Für `topic = 'pibo.output'` neue live-only Delta-Rows entfernen.
- Falls kanonische Events aus `chat_events` bereits in `pibo.output` vorhanden sind, keine synthetischen Duplikate erzeugen.
- Falls nicht vorhanden und Replay/Audit für `pibo.output` gewünscht bleibt, synthetische kanonische Events aus der Chat-Migration einfügen.
- Non-destructive Mode respektiert Consumer-Offsets; destructive Mode nur explizit.
- Wegen unklarer externer Consumer-Semantik zuerst `pibo.output` als Debug-/Reliability-Mirror behandeln und nicht als Source of Truth.

### Gruppierungs- und Synthese-Regeln für Bestandsdaten

#### Assistant

Gruppierungs-Key:

```text
piboSessionId + eventId + (assistantIndex ?? contentIndex ?? 0)
```

Algorithmus:

1. Alle `assistant_delta.text` in Persistenzreihenfolge konkatenieren.
2. Wenn ein passendes `assistant_message` existiert:
   - dessen `text` als authoritative behalten.
   - Deltas löschen.
   - Optional prüfen, ob Delta-Join ein Präfix oder exakter Match ist.
3. Wenn kein passendes `assistant_message` existiert:
   - synthetisches `assistant_message` mit zusammengefügtem Text erzeugen.
   - `eventId`, `assistantIndex`/`contentIndex`, `piboSessionId` erhalten.
   - als `chat_message` klassifizieren.
   - Migration-Metadata vermerken.

#### Thinking

Gruppierungs-Key:

```text
piboSessionId + eventId + (thinkingIndex ?? contentIndex ?? 0)
```

Algorithmus:

1. `thinking_started` behalten, falls vorhanden.
2. Alle `thinking_delta.text` konkatenieren.
3. Wenn `thinking_finished.text` existiert: behalten und Deltas löschen.
4. Wenn `thinking_finished` ohne Text existiert: Text aus Deltas ergänzen.
5. Wenn kein `thinking_finished` existiert: synthetisches `thinking_finished` mit Text erzeugen und als `incomplete` markieren, wenn kein `message_finished` für den Turn existiert.
6. Wenn auch `thinking_started` fehlt, kann der Trace aus `thinking_finished` trotzdem rekonstruiert werden; optional synthetisches `thinking_started` erzeugen, wenn der Renderer es benötigt.

#### Tool Updates

Gruppierungs-Key:

```text
piboSessionId + eventId + toolCallId
```

Algorithmus:

1. `tool_execution_started` behalten.
2. `tool_execution_updated` löschen.
3. `tool_execution_finished` behalten.
4. Wenn nur Updates existieren und kein Finish:
   - letzten Update-Stand als synthetisches incomplete Tool-Finish nur erzeugen, wenn das für Trace-Audit sinnvoll ist.
   - Sonst Gruppe als `unsafe` melden und nicht automatisch löschen.
5. Wiederholte `tool_call` Events:
   - finale `argsComplete: true` Version behalten.
   - sonst letzte Args-Version behalten.
   - ältere/incomplete Args-Events entfernen.

### Sicherheitsklassen der Migration

Die Migration sollte jede Gruppe klassifizieren:

- `safe-final-exists`: finales kanonisches Event existiert; Deltas können gelöscht werden.
- `safe-synthesize`: kein finales Event, aber Delta-Gruppe ist eindeutig und zusammenhängend; synthetisches finales Event kann erzeugt werden.
- `needs-review`: mehrere mögliche Gruppen, fehlende IDs, widersprüchliche Texte oder ungewöhnliche Interleavings.
- `unsafe`: keine eindeutige Rekonstruktion; nicht automatisch ändern.

`--apply` darf standardmäßig nur `safe-final-exists` und `safe-synthesize` ändern. `needs-review`/`unsafe` bleiben erhalten oder erfordern eine explizite Option.

### Migration-Metadata / neues Schema

Für Nachvollziehbarkeit sollte die Migration nicht nur Rows löschen, sondern eine kleine Audit-Tabelle ergänzen:

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

Zusätzlich können synthetische Payloads optional Metadata bekommen, z. B.:

```ts
compaction?: {
  synthetic: true;
  source: "legacy-delta-migration";
  deltaCount: number;
  incomplete?: boolean;
};
```

Dafür müssen die betroffenen `PiboOutputEvent`-Typen in `src/core/events.ts` optional erweitert werden. Wenn wir keine Payload-Metadata wollen, reicht die Audit-Tabelle als Source of Truth.

### Operative Machbarkeit und Risiko

Machbar, aber nicht als Online-Migration im laufenden Host-Gateway:

- Die betroffenen Datenbanken sind groß.
- SQLite-Rewrites können lange laufen und WAL/Locking erzeugen.
- Der Host-Gateway ist ein Live-Service.

Empfohlener Ablauf:

1. Backup der SQLite-Dateien.
2. Migration zuerst auf Kopien in Docker Compute Worker testen.
3. Dry-Run mit Counts, Text-Mismatch-Checks und Beispielgruppen.
4. Rewrite in temporäre DB-Datei.
5. Konsistenzprüfung gegen vorher/nachher.
6. Wartungsfenster für Swap der produktiven DB-Dateien.
7. Danach `VACUUM`/`PRAGMA wal_checkpoint(TRUNCATE)` bzw. neue kompaktierte DB-Datei direkt als finale Datei verwenden.

### Entscheidung

Die intelligente Ersetzung bestehender Deltas ist sinnvoll und sollte Teil des Plans werden. Sie löst nicht nur Speicherplatz, sondern reduziert auch sofort Trace-Load und Browser-/Server-Memory für Legacy-Sessions. Sie ersetzt aber nicht die neue Ingest-Architektur: Ohne Store-Guards und OutputCompactor würden neue Deltas wieder nachwachsen.

## Zielarchitektur

Pipeline wird in zwei Pfade getrennt:

```text
PiboOutputEvent
  ├─ live path: aktive SSE-Clients erhalten weiterhin Deltas
  └─ durable path: Stores erhalten nur kanonische persistierbare Events
```

Neue zentrale Komponente:

```text
src/apps/chat/output-compactor.ts
```

Sie aggregiert aktive Turn-/Span-Zustände und entscheidet pro Output-Event:

```ts
type OutputCompactorResult = {
  liveEvents: PiboOutputEvent[];
  persistedEvents: PiboOutputEvent[];
  snapshots: PiboOutputEvent[];
};
```

Regel:

- `liveEvents`: können Deltas enthalten.
- `persistedEvents`: dürfen keine `assistant_delta`, `thinking_delta`, `tool_execution_updated` enthalten.
- `snapshots`: aktuelle in-memory Zustände für Reconnects laufender Turns; nicht als dauerhafte DB-Rows ausgeben, außer sie werden als finale synthetische Events geflusht.

## Event-Regeln

### Assistant Text

- `assistant_delta`
  - live broadcasten
  - in Buffer append
  - nicht persistieren
- `assistant_message`
  - authoritative final text, falls vorhanden
  - falls finaler Text fehlt, Buffer als Fallback nutzen
  - genau ein kanonisches `assistant_message` je Assistant-Part persistieren
  - Buffer löschen
  - Live-Client soll temporären Delta-Span durch finalen Span ersetzen

Key:

```text
piboSessionId + eventId + (assistantIndex ?? contentIndex ?? 0)
```

### Thinking / Reasoning

- `thinking_started`
  - persistieren, da stabiler Span-Anker
  - Buffer starten/resetten
- `thinking_delta`
  - live broadcasten
  - in Buffer append
  - nicht persistieren
- `thinking_finished`
  - Text aus Event verwenden, sonst Buffer-Fallback
  - genau ein kanonisches `thinking_finished` mit Volltext persistieren
  - Buffer löschen

Key:

```text
piboSessionId + eventId + (thinkingIndex ?? contentIndex ?? 0)
```

### Tools

- `tool_call`
  - keine unbounded Args-Updates persistieren
  - je `toolCallId` nur relevante/finale Args-Version persistieren
- `tool_execution_started`
  - einmal persistieren
- `tool_execution_updated`
  - live-only
  - letzter Progress-Zustand nur in-memory für Reconnect
  - nicht persistieren
- `tool_execution_finished`
  - kanonisches finales Tool-Ergebnis persistieren
  - Progress-Snapshot löschen

### Fehler, Abbruch, Shutdown

- `message_finished`
  - vorher offene Assistant-/Thinking-Buffer für denselben `eventId` flushen, wenn nötig
  - danach `message_finished` persistieren
- `session_error`
  - offene Buffer als synthetische finale Events mit Metadata wie `incomplete: true` persistieren
  - `session_error` persistieren
- Gateway shutdown
  - best-effort Flush offener Buffer
  - keine Garantie für live-only Deltas nach Prozessabbruch; abgeschlossene Turns müssen aber bereits kanonisch persistiert sein

## Konkreter Implementierungsplan

### Phase 1: OutputCompactor isoliert bauen

Datei:

```text
src/apps/chat/output-compactor.ts
```

Aufgaben:

1. Buffers für Assistant, Thinking und Tool-Progress implementieren.
2. Dedup/Replacement für finale Events unterstützen.
3. Bounded State:
   - Cleanup auf `message_finished`/`session_error`
   - TTL als Safety Net
   - Debug-Zähler: buffered, flushed, dropped live-only, synthetic finals
4. Unit-Tests für alle Event-Regeln schreiben.

Erfolgskriterien:

- Aus 1000 `assistant_delta` + `assistant_message` wird persistent genau ein `assistant_message`.
- Aus 1000 `thinking_delta` + `thinking_finished` wird persistent `thinking_started` + ein `thinking_finished`.
- `tool_execution_updated` taucht nie in `persistedEvents` auf.

### Phase 2: `ensureEventIndexing(...)` umbauen

Aktueller direkter Store-Write wird ersetzt:

1. Raw Output-Event an Compactor geben.
2. Live-SSE-Listener erhalten live Events sofort.
3. Stores erhalten nur `persistedEvents`.
4. Reconnect-Pfad kann `snapshots` laufender Turns ausgeben.

Wichtig:

- `state.liveListeners` darf nicht mehr nur `StoredChatEvent` erwarten, weil live-only Events keine DB-Row haben.
- Einführung eines Live-Envelope-Typs, z. B.:

```ts
type ChatLiveDelivery =
  | { kind: "stored"; event: StoredChatEvent }
  | { kind: "live"; event: PiboOutputEvent; snapshot?: boolean };
```

Oder alternativ zwei getrennte Listener-Pfade:

- durable replay listener
- transient live listener

Empfehlung: getrennte Pfade, um Cursor-/StreamId-Semantik sauber zu halten.

### Phase 3: Store Guards einbauen

Defensive Guards verhindern spätere Regressionen.

#### `ChatEventLog.appendOutputEvent(...)`

- `assistant_delta`, `thinking_delta`, `tool_execution_updated` ablehnen oder ignorieren.
- Empfehlung: im Produktpfad ignorieren mit Debug-Zähler; in Tests optional strict.

#### `ChatWebReadModel.recordEvent(...)`

- gleiche Guard-Regel.
- Status darf nicht mehr von Deltas abhängig sein.
- `statusFromEvent(...)` auf Start-/Finish-/Tool-Started/-Finished und Session-Error umbauen.

#### `PiboReliabilityStore` bzw. Callsite

- Topic `pibo.output` bekommt keine live-only Deltas mehr.
- Optional Append-Wrapper für `pibo.output`, der live-only Events ablehnt.

Tests:

- Nach einem synthetischen Run enthalten `chat_events`, `web_chat_events`, `pibo_event_stream` null Rows mit:
  - `assistant_delta`
  - `thinking_delta`
  - `tool_execution_updated`

### Phase 4: SSE/Reconnect hardenen

Aktuell basiert Replay auf `chat_events` und `stream_id`. Das bleibt für durable Events richtig, muss aber um aktive Snapshots ergänzt werden.

Regeln:

1. Reconnect replayt zuerst persistierte kanonische Events aus `ChatEventLog`.
2. Danach sendet der Server aktuelle in-memory Snapshots laufender Turns/Tools.
3. Danach folgen neue live Deltas.
4. Snapshot-Frames dürfen nicht so tun, als wären sie durable DB-Rows.
5. `RAW_EVENT` wird nur für persistierbare kanonische Events gesendet, nicht für live-only Deltas.

`chatStreamFramesFromOutputEvent(...)` ändern:

- Option/Parameter einführen: `includeRawEvent` oder Event-Klassifizierung.
- Für live-only Delta-Frames:
  - `TEXT_MESSAGE_CONTENT`/`REASONING_MESSAGE_CONTENT` senden
  - kein `RAW_EVENT`
- Für kanonische persisted Events:
  - normale Frames plus `RAW_EVENT`

### Phase 5: Client-State kompakt halten

Datei vorschlagen:

```text
src/apps/chat-ui/src/traceLiveReducer.ts
```

Aufgaben:

1. Live-Deltas in temporäre Span-Zustände mergen.
2. Bei `assistant_message` passende `assistant_delta`-State entfernen/ersetzen.
3. Bei `thinking_finished` passende `thinking_delta`-State entfernen/ersetzen.
4. Bei `tool_execution_finished` passende `tool_execution_updated`-State entfernen/ersetzen.
5. `selectedTraceEvents` darf nach Abschluss nicht proportional zur Delta-Anzahl wachsen.

Erfolgskriterien im Browser:

- Lange Streaming-Antwort bleibt live sichtbar.
- Nach Completion sinkt/normalisiert die lokale Delta-State-Größe.
- Reload rendert dieselbe finale Ausgabe ohne Deltas.

### Phase 6: Trace API bounded machen

Auch nach Delta-Kompaktion bleiben alte Sessions groß. Deshalb Trace separat entschärfen.

Änderungen:

1. `/api/chat/trace` darf nicht mehr unconditionally `listAllEvents(...)` verwenden.
2. Neue bounded Listing-Methoden:
   - `listTraceEvents(piboSessionId, { limit, before/after, canonicalOnly })`
   - oder Umstellung auf `chat_events` als kanonische Trace-Quelle.
3. `includeRawEvents=true` streng limitieren und nie Cache-verstärken.
4. Profilwechsel-Check ersetzen:
   - kein Trace-Build
   - stattdessen `hasSessionActivity(piboSessionId)` / `countCanonicalEvents(...)`.
5. `debug/trace-at-sequence` absichern:
   - Limit
   - Debug-only Kennzeichnung
   - optional SQL-seitig `WHERE event_sequence <= ?` statt im Speicher filtern.

Erfolgskriterien:

- Große Sessions erzeugen keinen Full-History Heap Spike mehr.
- Trace-View für normale UI lädt bounded kanonische Events.
- Legacy-Fallback ist möglich, aber bewusst limitiert.

### Phase 7: Trace Cache entschärfen

Änderungen:

- `TRACE_CACHE_MAX_ENTRIES` von 128 auf 16-32 senken.
- Views mit Raw Events nicht cachen.
- Sehr große Views nicht cachen, z. B. anhand Node-/RawEvent-Anzahl.
- Optional Cache-Invalidation pro Session beim neuen persisted Event.

Erfolgskriterium:

- Cache kann große Trace-Views nicht mehr langfristig im Heap halten.

### Phase 8: Retention und Background Purge aktivieren

Aufgaben:

1. Beim Web-App-Start Default-Policy seed-en, falls keine vorhanden.
2. Background-Timer in kleinen Batches:
   - `ChatEventLog.purgeExpired(...)`
   - `PiboReliabilityStore.prune(...)`
3. Nie Request-Pfad blockieren.
4. Fehler loggen, aber Gateway nicht crashen.
5. Debug-/Stats-Ausgaben erweitern.

Konservative Defaults:

- live/transient Diagnosedaten: 24-72h
- trace diagnostics: 14-30 Tage
- chat messages: nicht automatisch löschen, solange keine Produkt-Retention entschieden ist

Nach Zielarchitektur sollten neue live-only Deltas ohnehin nicht mehr durable existieren. Retention bleibt für:

- Legacy-Daten
- kompakte Trace-/Audit-Diagnose
- andere high-volume Events

### Phase 9: Legacy-Daten intelligent kompaktieren und migrieren

Diese Phase wird gegenüber dem ursprünglichen Plan geschärft: Bestehende Deltas sollen nicht nur per Retention gelöscht werden. Sie sollen, wo sicher möglich, zu kanonischen finalen Events zusammengeführt und dann ersetzt werden.

#### Neuer Debug-/Operator-Command

```bash
pibo debug events compact-deltas --dry-run
pibo debug events compact-deltas --apply
pibo debug events compact-deltas --apply --store chat
pibo debug events compact-deltas --apply --store read-model
pibo debug events compact-deltas --apply --store reliability
pibo debug events compact-deltas --session ps_...
pibo debug events compact-deltas --include-needs-review
```

`--dry-run` ist Pflicht für die erste Ausführung auf einem Datenbestand. `--apply` muss einen Backup-Hinweis ausgeben und ohne explizite Bestätigung abbrechen, wenn produktive Standardpfade (`~/.pibo/web-chat.sqlite`, `~/.pibo/pibo-events.sqlite`) betroffen sind.

#### Scope

- `chat_events` in `web-chat.sqlite`
- `web_chat_events` in `web-chat.sqlite`
- `pibo_event_stream` Topic `pibo.output` in `pibo-events.sqlite`
- optional später: Pi JSONL-Transcripts nur als Fallback-Quelle, nicht als erstes Migrationsziel

#### Dry-Run-Bericht

Der Dry-Run muss pro Store und pro Session ausgeben:

- Anzahl Rows nach Event-Typ vor/nach geplanter Migration
- Anzahl Delta-Gruppen nach Sicherheitsklasse:
  - `safe-final-exists`
  - `safe-synthesize`
  - `needs-review`
  - `unsafe`
- Anzahl geplanter synthetischer Events
- Anzahl geplanter Deletes
- geschätzte neue DB-Größe bzw. Row-Reduktion
- Text-Mismatch-Warnungen:
  - Delta-Join == finaler Text
  - Delta-Join ist Präfix finaler Text
  - Delta-Join widerspricht finalem Text
- Beispielgruppen mit IDs und kurzen Text-Snippets

#### Reihenfolge-erhaltende Rewrite-Strategie

Für `chat_events` und `web_chat_events` ist ein Rewrite in temporäre Tabellen bevorzugt:

1. Temporäre Tabellen mit gleicher Zielstruktur anlegen.
2. Alte Events sessionweise und in Persistenzordnung streamen.
3. Delta-Gruppen erkennen und ersetzen:
   - finale Events behalten
   - fehlende finale Events synthetisieren
   - live-only Delta-/Update-Rows weglassen
4. Neue `stream_id`/`event_sequence` verdichtet vergeben.
5. Old-to-New-Mapping speichern.
6. `chat_session_reads.last_read_stream_id` über Mapping konservativ anpassen.
7. `chat_event_compactions` Audit-Tabelle schreiben.
8. Konsistenzprüfungen ausführen.
9. Erst danach Tabellen atomar tauschen.

Warum Rewrite statt nur DELETE/INSERT:

- Synthetische Events müssen an der Stelle des alten Delta-Runs stehen, nicht am Tabellenende.
- Verdichtete IDs reduzieren Cursor-/Trace-Komplexität.
- Die resultierende DB ist kleiner und kann ohne separates langes `VACUUM` als neue Datei erzeugt werden.

#### Assistant-Migration

Pro Gruppe:

```text
piboSessionId + eventId + (assistantIndex ?? contentIndex ?? 0)
```

Regeln:

1. Deltas in Reihenfolge konkatenieren.
2. Existiert `assistant_message`:
   - behalten
   - Deltas löschen
   - bei Text-Differenz warnen, aber finalen Text als authoritative nehmen
3. Existiert kein `assistant_message`:
   - synthetisches `assistant_message` mit konkateniertem Text erzeugen
   - `eventId`, `assistantIndex`/`contentIndex` erhalten
   - `retention_class = 'chat_message'`
   - Audit-Eintrag `safe-synthesize` oder `needs-review`
4. Gruppen ohne `eventId` nur automatisch migrieren, wenn sie eindeutig zusammenhängend zwischen `message_started` und `message_finished` liegen; sonst `needs-review`.

#### Thinking-Migration

Pro Gruppe:

```text
piboSessionId + eventId + (thinkingIndex ?? contentIndex ?? 0)
```

Regeln:

1. `thinking_started` behalten, wenn vorhanden.
2. Deltas in Reihenfolge konkatenieren.
3. Existiert `thinking_finished.text`: behalten, Deltas löschen.
4. Existiert `thinking_finished` ohne Text: mit Delta-Join zu einem kanonischen `thinking_finished` aktualisieren/ersetzen.
5. Existiert kein `thinking_finished`: synthetisches `thinking_finished` erzeugen.
6. Wenn kein `thinking_started` existiert, nicht automatisch eines erzwingen, außer Trace-Tests zeigen, dass es für Rendering nötig ist.
7. Wenn der Turn kein `message_finished` hat, synthetischen Finish als `incomplete` markieren oder Gruppe als `needs-review` klassifizieren.

#### Tool-Migration

Pro Gruppe:

```text
piboSessionId + eventId + toolCallId
```

Regeln:

1. `tool_execution_started` behalten.
2. `tool_execution_updated` entfernen, wenn `tool_execution_finished` vorhanden ist.
3. Falls kein Finish vorhanden ist:
   - letzten Update-Stand nicht blind als Erfolg persistieren.
   - entweder synthetisches incomplete Finish mit Metadata erzeugen oder `needs-review`.
4. Mehrere `tool_call` Events kompaktieren:
   - `argsComplete: true` bevorzugen
   - sonst letzte Args-Version behalten
   - ältere/incomplete Args-Rows entfernen

#### Reliability-Store-Migration

Für `pibo_event_stream`:

1. `topic = 'pibo.output' AND retention_class = 'live_delta'` analysieren.
2. Wenn passende kanonische Events bereits in `chat_events`/`web_chat_events` existieren, Delta-Rows im Reliability-Store löschen/prunen.
3. Wenn Reliability-Replay kanonische Events braucht, synthetische `pibo.output` Events erzeugen, aber nur für sichere Gruppen.
4. Consumer-Offsets respektieren:
   - ohne `--destructive` keine Rows löschen, die aktive Consumer noch nicht passiert haben.
   - wenn keine Consumer existieren, kann destructive Cleanup nach Backup empfohlen werden.

#### Audit und Idempotenz

Neue Audit-Tabelle in `web-chat.sqlite`:

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

Idempotenz-Regeln:

- Gruppen mit vorhandenem Audit-Eintrag und unverändertem Row-Fingerprint werden übersprungen.
- Synthetische Events bekommen stabile Idempotency-/Event-IDs aus Session, EventId, Part-Key und Zieltyp.
- Re-run nach Abbruch darf keine doppelten finalen Events erzeugen.

#### Konsistenzprüfung

Nach Rewrite pro Session prüfen:

- Kein `assistant_delta`, `thinking_delta`, `tool_execution_updated` mehr in migrierten Stores für sichere Gruppen.
- Assistant-Text vor/nach Migration ist gleich oder finaler Text ist authoritative dokumentiert.
- Thinking-Text vor/nach Migration ist gleich oder als incomplete dokumentiert.
- Tool-Finish-Status bleibt erhalten.
- Trace-Node-Anzahl sinkt, aber semantische Nodes bleiben erhalten.
- `/api/chat/trace` kann die migrierte Session rendern.

#### Operativer Ablauf

1. DB-Dateien kopieren:
   - `web-chat.sqlite`
   - `web-chat.sqlite-wal`/`-shm`, falls relevant nach Checkpoint
   - `pibo-events.sqlite`
2. In Docker Compute Worker Dry-Run auf Kopie ausführen.
3. Report prüfen.
4. Apply auf Kopie ausführen.
5. Tests/Trace-Checks auf Kopie ausführen.
6. Wartungsfenster planen.
7. Host-Gateway stoppen nur mit expliziter Freigabe.
8. Produktive DB-Dateien sichern und atomar ersetzen.
9. Gateway starten und Counts prüfen.
10. Alte Backups erst nach Beobachtungszeit löschen.

Wichtig:

- Nicht automatisch beim Gateway-Start auf 1+ GiB DBs laufen lassen.
- Retention darf Legacy-Deltas erst löschen, nachdem die intelligente Migration entweder erfolgreich war oder eine Gruppe bewusst als nicht rettbar klassifiziert wurde.
- Vor `--apply` immer Backup-Hinweis und Dry-Run-Report verlangen.

## Tests

### Unit

- Assistant-Deltas -> genau ein `assistant_message`.
- `assistant_message.text` überschreibt Buffer.
- Fehlender finaler Assistant-Text nutzt Buffer.
- Thinking-Deltas -> `thinking_finished.text`.
- `thinking_finished.text` überschreibt Buffer.
- `tool_execution_updated` live-only.
- Repeated `tool_call` kompakt ohne Args-Verlust.
- `session_error` flusht offene Buffer als incomplete finals.
- Compactor-State wird cleanuped.

### Integration

- `ensureEventIndexing()` streamt Deltas live, persistiert aber nur kanonische Events.
- `/api/chat/events` replayt kompakte History plus aktive Snapshots.
- `/api/chat/trace` baut logische Nodes aus kanonischen Events.
- Stores enthalten nach neuen Runs keine live-only Delta Rows.
- Alte delta-heavy Sessions rendern via Fallback/Migration weiterhin.
- Legacy-Migration auf synthetischem SQLite-Fixture ersetzt Delta-Runs durch kanonische Events.
- Migration ist idempotent: zweiter Lauf erzeugt keine zusätzlichen synthetischen Events.
- Migration erhält Reihenfolge um Tool-Interleavings herum.
- `chat_session_reads` Cursor werden nach Rewrite konservativ gemappt.
- `pibo_event_stream` respektiert Consumer-Offsets im non-destructive Mode.

### Browser/E2E

In Docker Compute Worker testen, nicht auf Host-Gateway.

Szenarien:

- lange Assistant-Antwort streamt sichtbar chunkweise
- Completion + Reload zeigt vollständige Antwort
- DOM/Trace-State wächst nach Finalisierung nicht mit Delta-Anzahl
- Reconnect mid-stream ohne doppelte oder fehlende Texte
- lange Session: erste Nachricht bleibt erreichbar
- Tool mit langen Updates: live progress sichtbar, Reload zeigt finalen Tool-Status

## Rollout

1. OutputCompactor + Unit-Tests.
2. SSE live path vorbereiten, Persistenz noch Feature-flagged.
3. Store Guards hinzufügen.
4. In Docker Worker compact persistence aktivieren.
5. Synthetische lange Runs messen:
   - Row counts pro Store
   - RSS vor/nach Trace
   - Browser-State-Größe
6. Trace API bounded machen.
7. Trace Cache reduzieren.
8. Migration Command implementieren.
9. Migration-Dry-Run auf Kopie der aktuellen Daten ausführen und Machbarkeitsreport prüfen.
10. Migration-Apply auf Kopie ausführen und Trace-/Browser-Checks gegen migrierte Daten fahren.
11. Retention Background-Purge aktivieren, aber Legacy-Deltas nur nach erfolgreicher Klassifizierung/Migration löschen.
12. Produktives Wartungsfenster für DB-Swap separat freigeben lassen.
13. Erst danach Deployment/Host-Operationen planen.

## Definition of Done

- Neue Sessions persistieren null `assistant_delta`, `thinking_delta`, `tool_execution_updated` Rows.
- Live-Streaming fühlt sich unverändert inkrementell an.
- Completed Assistant/Thinking/Tool-Spans werden kanonisch ersetzt.
- Reload abgeschlossener Sessions nutzt nur kanonische persistierte Events.
- `/api/chat/trace` lädt keine unbounded Full-History mehr.
- Trace Cache hält keine großen Raw-Historien.
- Background-Retention läuft automatisch in kleinen Batches.
- Legacy-Migration erzeugt einen Dry-Run-Report mit Sicherheitsklassen, Counts und Beispielen.
- Legacy-Migration kann sichere Delta-Gruppen zu kanonischen Events zusammenführen und alte Delta-Rows entfernen.
- Legacy-Migration ist idempotent und reihenfolge-erhaltend.
- Unsichere Legacy-Gruppen werden nicht stillschweigend gelöscht.
- Tests und Docker-Worker-E2E bestehen.
