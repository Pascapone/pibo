> Status: Superseded for runtime decisions. Chat Web was cut over to V2-only on 2026-05-09. Use `plans/2026-05-09-chat-data-v2-cleanup-and-session-unification-plan.md` and the final V2 removal report for current architecture.

# Pibo Chat Data System — finaler Umbauplan

Date: 2026-05-08  
Status: finaler Architektur- und Migrationsplan  
Inputs:

- `docs/reports/performance/data-system/pibo-chat-data-system-consolidated-analysis-2026-05-08.md`
- `plans/pibo-chat-data-system-rearchitecture-implementation-plan-2026-05-08.md`
- zusätzlicher Architekturabgleich am 2026-05-08

Dieser Plan ersetzt die Einzelpläne nicht als Historie, ist aber die empfohlene Zielrichtung für die Umsetzung.

## Implementierungsstatus — Checkpoint 2026-05-08 nach Follow-up Navigation + User Shadow Ingest

Branch: `chat-data-v2-followup-navigation-ingest-2026-05-08`  
Base commit vor der Follow-up-Session: `2d592ea Document chat data V2 handover`  
Handover: `handoffs/pibo-chat-data-v2-followup-navigation-ingest-handover-2026-05-08.md`  
Status: implementiert und validiert, zum Zeitpunkt dieses Plan-Updates noch nicht committed.  
Dev: kein neuer Dev-Deploy in dieser Follow-up-Session.

Dieser Checkpoint ist der aktuelle Ausgangspunkt für die nächste Session. Die Zielarchitektur bleibt unverändert. Die Umsetzung ist jetzt so gestaffelt:

### Erledigt seit dem vorherigen Checkpoint

- `/api/chat/navigation` hat einen expliziten Vertragstest.
- Frontend-Room-Switch nutzt `/api/chat/navigation` statt `/api/chat/bootstrap`.
- SSE-getriggerte Navigation-Refreshes nutzen `/api/chat/navigation` statt `/api/chat/bootstrap`.
- Frontend-Typen/API/Cache wurden für `NavigationData` ergänzt:
  - `src/apps/chat-ui/src/types.ts`
  - `src/apps/chat-ui/src/api.ts`
  - `src/apps/chat-ui/src/cache.ts`
  - `src/apps/chat-ui/src/App.tsx`
- `src/data/ingest-service.ts` wurde eingeführt.
- User-Message-Shadow-Writes aus `sendChatMessage()` schreiben bei aktivem Flag in V2:
  - `sessions`
  - `event_log`
  - `chat_messages`
  - `session_navigation`
  - große Payloads über `PayloadStore`
- Feature Flag für Shadow Writes:
  - `PIBO_DATA_V2_WRITE=1|user|all`
  - Tests können `dataV2Write: true` setzen.
- User-Message-Idempotenz in V2 basiert auf `clientTxnId`:
  - `chat:user.accepted:${roomId}:${actorId}:${clientTxnId}`
- Tests ergänzt:
  - `test/data-v2-ingest-service.test.mjs`
  - neue Navigation- und V2-Shadow-Ingest-Tests in `test/web-channel.test.mjs`

### Validiert seit dem vorherigen Checkpoint

- `npm run typecheck` ✅
- `npm run build` ✅
- `node --test test/data-v2-ingest-service.test.mjs test/web-channel.test.mjs` ✅
- `npm test` komplett: 315 Tests ✅
- Docker Compute Build/Worker ✅
- Docker typecheck ✅
- Docker `pibo data inventory --json` ✅
- Docker MCP CLI Smoke:
  - `pibo mcp config help` ✅
  - `pibo mcp --no-setup` ✅
- Dev-auth curl gegen Docker Worker:
  - `/api/chat/navigation` 200 ✅
  - `/api/chat/catalog` 200 ✅
- Browser-Use Smoke gegen Docker Worker:
  - Chat UI lädt mit Dev User ✅
  - Room-Wechsel nutzt `/api/chat/navigation` und nicht `/api/chat/bootstrap` ✅

### Aktueller Stand nach finalem Follow-up-Pass

- Phase 1 ist für Room-Switch, Session-Switch und Navigation-Refresh umgesetzt.
- Mark-read ist über `POST /api/chat/sessions/:id/read` von Bootstrap entkoppelt.
- Session-Switch nutzt im geladenen Frontend `/api/chat/navigation` statt `/api/chat/bootstrap`.
- Phase 3 Shadow Ingest ist für User Messages und persistierte Output Events gestartet und getestet:
  - User Messages -> `event_log`, `chat_messages`, `session_navigation`, Payload Store.
  - Assistant final output -> `event_log`, `chat_messages`, `observations`.
  - Tool/run/error-style output -> `event_log`, `observations`.
- `src/data/session-store.ts` ist eingeführt und in `PiboDataStore` verdrahtet.
- `pibo data compare --session <id> --json` existiert als erste count-basierte Shadow-Compare-CLI.
- Legacy bleibt primary für normale Reads und Writes.
- V2 ist noch nicht primary.
- Kein Backfill, kein V2 Trace Primary, kein Legacy Cleanup.
- Dev deploy wurde nach Validierung durchgeführt.

### Aktualisierte nächste Priorität

Die nächste Session soll noch nicht Phase 4+ cutovern, sondern Phase 3 stabilisieren und dann Backfill vorbereiten:

1. Aktuellen Diff reviewen und committen.
2. Falls praktikabel: Spy-Test ergänzen, dass `/api/chat/navigation` keine Pi-JSONL-/`SessionManager.list()`-Fallbacks und keine historische Unread-Aggregation ausführt.
3. Shadow Compare über reine Counts hinaus erweitern:
   - message previews
   - roles
   - event type mismatches
   - missing payload refs
4. Shadow-Ingest-Metriken/Observability für Fehler ergänzen.
5. Legacy Backfill/Importer entwerfen und implementieren.
6. Erst danach V2 Primary Reads für einzelne, flag-gesteuerte Pfade testen.

---

## Implementierungsstatus — vorheriger Checkpoint 2026-05-08 nach erster Umsetzung

Branch: `chat-data-v2-rearchitecture-2026-05-08`  
Commit: `9b52c05 Add chat data V2 store foundation`  
Handover: `handoffs/pibo-chat-data-v2-rearchitecture-handover-2026-05-08.md`  
Dev: `https://dev.pibo.neuralnexus.me/apps/chat`

Dieser Checkpoint war der Ausgangspunkt der Follow-up-Session. Die Zielarchitektur bleibt unverändert, aber die Umsetzung ist jetzt gestaffelt:

### Erledigt

- V2-Store-Fundament unter `src/data/`:
  - `schema.ts` mit idempotentem V2-Schema.
  - `pibo-store.ts` als `DatabaseSync`-Wrapper.
  - `payload-store.ts` mit gzip-Dateien, sha256-Dedupe und read helpers.
  - `event-log.ts` mit idempotentem Append über `idempotency_key`.
  - `message-store.ts`, `observation-store.ts`, `navigation-store.ts`.
- `pibo data inventory` als read-only Inventar-CLI.
- Additive schnelle APIs:
  - `GET /api/chat/navigation` ohne Catalog, ohne historische Unread-Aggregation, ohne Pi-JSONL-Fallback.
  - `GET /api/chat/catalog` als aus Bootstrap herauslösbarer Catalog-Pfad.
- `buildSessionNodes()` kann Pi-Metadata-/JSONL-Fallback überspringen.
- Room-Unread-Rollup für Child Sessions korrigiert.
- `bootstrap?markRead=true` markiert nur noch die ausgewählte Session, nicht den gesamten Child-Subtree.
- Tests ergänzt:
  - `test/data-v2-store.test.mjs`
  - `test/data-cli.test.mjs`

### Validiert

- `npm run typecheck` ✅
- `npm run build` ✅
- `npm test` komplett: 311 Tests ✅
- Docker Compute Build/Worker ✅
- Browser-Use Smoke gegen Docker Worker: Chat UI lädt, Dev User aktiv, Composer sichtbar ✅
- MCP CLI Smoke: `pibo mcp config help`, `pibo mcp --no-setup` ✅
- Dev Deploy mit `./scripts/deploy-web-dev.sh` ✅

### Noch nicht erledigt

- V2 ist noch nicht live-ingested und noch nicht primary.
- Legacy Stores bleiben normale Quelle für Bootstrap, Trace und Chat Web.
- Frontend nutzt `/api/chat/navigation` noch nicht primär.
- Kein Legacy Backfill, kein Shadow Compare, kein V2 Trace Primary, kein Legacy Cleanup.
- `pibo data inventory` hat noch keine Payload-Histogramme, Missing-Title-Counts, Sessions-ohne-Room-Auswertung oder Duplicate-Candidate-Auswertung.

### Aktualisierte nächste Priorität

Die nächste Session soll nicht direkt Phase 4+ starten. Empfohlene Reihenfolge:

1. `/api/chat/navigation` vertraglich testen und Frontend-Room-Switch darauf umstellen.
2. `src/data/ingest-service.ts` einführen.
3. User-Message-Shadow-Writes aus `sendChatMessage()` in V2 schreiben.
4. Assistant-/Tool-/Run-Output-Shadow-Writes aus `ensureEventIndexing()`/`OutputCompactor` in V2 schreiben.
5. Shadow Compare / Debug CLI hinzufügen.
6. Erst danach Legacy Backfill und V2 Primary Reads.

---

## Executive decision

Baue das Chat Data System um eine einfache Regel herum:

> Vollständige Inhalte werden einmal gespeichert. Alles andere ist kleine, rebuildbare Projektion, Index, Cursor oder Debug-/Export-Artefakt.

Die beste Lösung aus beiden bisherigen Plänen ist eine **kanonische Chat-Datenebene** mit klarer Trennung zwischen:

1. **Identität und Metadaten**: Sessions, Rooms, Ownership, Archivstatus.
2. **Chat-Historie**: fertige User-/Assistant-Messages und Turn-Metadaten.
3. **Runtime-/Event-Envelopes**: geordnete, kompakte Event-Hüllen für Ingest, SSE-Catchup, Debug und kurzfristiges Replay.
4. **Trace/Observations**: typisierte Timeline für Web Trace, Tools, Runs, Errors, Model Calls.
5. **Payloads**: große Inhalte als Dateien, referenziert aus Messages, Events und Observations.
6. **Read Models**: Navigation, Stats, Unread Counts und Room Counts.
7. **Legacy/Export**: JSONL und alte DBs nur für Migration, Pi-Kompatibilität, Debug und Export.

### Finaler Speicherentscheid

Implementiere einen neuen V2 Store hinter einer `PiboDataStore`-Abstraktion. Der Zielpfad soll langfristig `~/.pibo/pibo.sqlite` sein. Für die Migration darf eine Shadow-Datei wie `~/.pibo/pibo-chat-v2.sqlite` genutzt werden, solange die Store-Abstraktion den späteren Pfadwechsel versteckt.

`auth.sqlite` bleibt separat, weil Better Auth es besitzt.

`pibo-events.sqlite` bleibt zunächst für Reliability, Jobs und Runs. Es darf aber langfristig keine vollständigen Chat-/Runtime-Payloads mehr speichern. Eine spätere Migration von Jobs/Runs/Workflows in `pibo.sqlite` ist erlaubt, aber kein Blocker für den Chat-Data-System-Cutover.

### Wichtigste Abweichung vom bestehenden Plan

Der bestehende Plan ist stark bei Single-DB, Payload-Store, Feature Flags, Shadow Writes, Importer und Code-Impact. Er vermischt aber Chat-Historie und Trace zu stark über `event_log` und `observations`.

Dieser finale Plan ergänzt deshalb eine eigene kanonische Tabelle `chat_messages`. Sie ist die Wahrheit für die vollständige Chat-Historie. `observations` bleibt die Wahrheit für die Trace-/Timeline-Sicht. Beide referenzieren dieselben Payloads und duplizieren keine großen Inhalte.

---

# 1. Problemdefinition

## Aktuelles Problem

Das aktuelle System speichert fachlich ähnliche Daten mehrfach:

- Pi JSONL Sessions unter `~/.pi/agent/sessions/.../*.jsonl`
- Chat Web DB `~/.pibo/web-chat.sqlite`
  - `chat_events`
  - `web_chat_events`
  - `web_chat_sessions`
  - `pibo_rooms`
  - `chat_session_reads`
- Pibo Session Store `~/.pibo/pibo-sessions.sqlite`
  - `pibo_sessions`
- Pibo Reliability/Event Store `~/.pibo/pibo-events.sqlite`
  - `pibo_event_stream`
  - Jobs/Runs

Diese Speicherorte haben keine saubere Rollenverteilung. Dadurch ist oft unklar:

- Welche Tabelle besitzt Session-Titel?
- Wo liegt die vollständige Chat-Historie?
- Welche Events sind kanonisch und welche nur Web-Replay?
- Was ist Trace, was ist Message, was ist Raw Event?
- Welche Daten darf man löschen, kompaktieren oder neu aufbauen?
- Welche Daten braucht Navigation wirklich?

## Redundanzen

Ein einzelner Assistant-Turn oder Tool-Result kann heute mehrfach vorkommen:

```text
Pi JSONL
  + chat_events.payload_json
  + web_chat_events.payload_json
  + pibo_event_stream.payload_json
  + abgeleitete In-Memory-/Read-Model-Sichten
```

Die Mehrfachhaltung ist besonders schädlich, weil große Payloads inline in SQLite-Tabellen stehen. Das bläht DB- und WAL-Dateien auf und erhöht I/O-Kosten.

## Performance-Hotspots

Aus dem Report:

- `SessionManager.list('/root/code/pibo')`: ca. 2.2–3.3 s
- `countUnreadMessagesBySession()` für 225 Sessions: ca. 4.3 s
- `readModel.listSessions()`: ca. 2.8–3 ms
- Room tree query: ca. 0.1 ms

SQLite ist nicht das Kernproblem. Die langsamen Pfade entstehen, weil Navigation zu viel Arbeit macht.

## Warum Bootstrap und Navigation zu teuer sind

`/api/chat/bootstrap` kombiniert heute:

- Auth
- Default-/selected Session
- Room-Auswahl
- Session-Liste
- Room Tree
- Mark-as-read
- Read-Model-Upserts
- Unread-Berechnung aus historischen Events
- JSONL-Fallback für fehlende Titel
- Catalog/Profile/Model/Agent/Capabilities
- große kombinierte Antwort

Ein Room-Wechsel darf aber nur eine kleine, indexierte Navigation-Query ausführen. Er darf nicht:

- JSONL scannen,
- historische Events aggregieren,
- Catalogs laden,
- Trace vorbereiten,
- große Payloads lesen.

---

# 2. Zielarchitektur

## Zielbild

```text
Runtime / Chat API
  -> Canonical Ingest Service
      -> pibo.sqlite: sessions, rooms, messages, event_log, observations, stats
      -> payload store: große Inhalte
      -> optional legacy mirrors während Migration

Background / Sync Projector
  -> session_navigation
  -> session_stats
  -> principal_session_stats
  -> principal_room_stats

Web UI
  -> minimal bootstrap
  -> navigation endpoint
  -> sessions endpoint
  -> messages endpoint
  -> trace endpoint
  -> payload endpoint
  -> catalog endpoint
```

## Source-of-truth-Tabelle

| Datenklasse | Source of Truth | Abgeleitet / Cache | Normale Leser |
|---|---|---|---|
| Session Identity / Metadata | `sessions` | `session_navigation`, `session_stats` | Navigation, Session API, Trace Header |
| Rooms / Membership | `rooms`, `room_members`, `sessions.room_id` | `principal_room_stats` | Navigation, Room API |
| Chat Messages | `chat_messages` + `payloads` | previews in `session_stats`, Navigation | Chat History API, Export |
| Raw Runtime Events | `event_log` | `observations`, stats, SSE frames | Indexer, SSE replay, Debug |
| Trace / Observations | `observations` + `payloads` | Trace view model in API/UI | Trace API, Debug |
| Read Models / Navigation | `session_navigation` | vollständig rebuildbar | Sidebar, Room switch |
| Unread Counts / Stats | read cursors + `principal_session_stats` | `principal_room_stats` | Badges, Navigation |
| Large Payloads | `payloads` + `~/.pibo/payloads` | previews in hot tables | Payload API, Export, Trace Detail |
| Export / Replay / Recovery | `pibo.sqlite` + payload store | JSONL export, legacy archives | CLI, Debug, Migration |

## Rollenregeln

1. `sessions` besitzt Session-Identität und alle Navigationsmetadaten.
2. `chat_messages` besitzt fertige Chat-Historie.
3. `event_log` besitzt kompakte Event-Envelopes, nicht große Inhalte.
4. `observations` besitzt die Trace-/Timeline-Projektion.
5. `payloads` besitzt vollständige Inhalte.
6. `session_navigation`, Stats und Unread Tables sind rebuildbare Projektionen.
7. JSONL ist nie Web-UI-Quelle.
8. Alte Tabellen `chat_events` und `web_chat_events` werden Legacy-Importquellen.
9. `pibo_event_stream` speichert keine Chat Output Payloads mehr.

---

# 3. Speicherstrategie

## Physische Stores

| Store | Zielstatus | Begründung |
|---|---|---|
| `~/.pibo/pibo.sqlite` | neuer V2 Pibo Data Store | klare Chat-Domain-Wahrheit, Transaktionen, einfache Backups |
| `~/.pibo/payloads/` | neuer Payload Store | große Inhalte raus aus heißen SQLite-Seiten |
| `~/.pibo/auth.sqlite` | bleibt separat | Better Auth besitzt Schema und Lifecycle |
| `~/.pibo/pibo-events.sqlite` | zunächst behalten, Chat-Payloads entfernen | Reliability/Jbos/Runs nicht zum Chat-Cutover-Blocker machen |
| `~/.pibo/web-chat.sqlite` | Legacy, später archivieren/löschen | Importquelle für Events, Rooms, Cursors, Read Models |
| `~/.pibo/pibo-sessions.sqlite` | Legacy, durch V2 `sessions` ersetzen | Session-Wahrheit wandert in V2 |
| Pi JSONL | Legacy/Export/Pi-Kompatibilität | keine Navigation, kein normaler Trace |

## V2 Tabellen

### `sessions`

Kanonische Session-Identität und Navigation-Metadaten.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  pi_session_id TEXT UNIQUE,
  owner_scope TEXT NOT NULL,
  room_id TEXT,
  root_session_id TEXT,
  parent_id TEXT,
  origin_id TEXT,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  profile TEXT NOT NULL,
  active_model_json TEXT,
  workspace TEXT,
  title TEXT NOT NULL DEFAULT 'Untitled Session',
  first_message_preview TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  archived_at TEXT,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
```

Pflichtänderungen:

- `metadata.chatRoomId` wird zu `sessions.room_id`.
- Archivstatus wird echte Spalte.
- `title`, `first_message_preview`, `last_activity_at` sind immer in SQLite vorhanden.
- `pi_session_id` bleibt während der Migration befüllt, wird langfristig nullable, wenn Pi JSONL nicht mehr primäre Runtime-Persistenz ist.

### `rooms` und `room_members`

Übernahme der heutigen `pibo_rooms` und `pibo_room_members` in V2.

```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  name TEXT NOT NULL,
  topic TEXT,
  type TEXT NOT NULL,
  parent_room_id TEXT,
  workspace TEXT,
  archived_at TEXT,
  retention_policy_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(room_id, principal_id)
);
```

### `payloads`

Payload-Metadaten. Große Bytes liegen als Dateien.

```sql
CREATE TABLE payloads (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  storage_kind TEXT NOT NULL,       -- file | inline-small während Migration erlaubt
  storage_path TEXT,
  content_type TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'gzip',
  byte_size INTEGER NOT NULL,
  compressed_byte_size INTEGER,
  preview_text TEXT,
  retention_class TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL,
  last_verified_at TEXT
);
```

### `event_log`

Kompakte append-only Event-Hülle.

```sql
CREATE TABLE event_log (
  stream_id INTEGER PRIMARY KEY,
  session_id TEXT,
  session_sequence INTEGER,
  room_id TEXT,
  topic TEXT NOT NULL,              -- chat, runtime, workflow, run, audit
  type TEXT NOT NULL,
  source TEXT NOT NULL,             -- user, router, pi, pibo, workflow, system
  actor_type TEXT,
  actor_id TEXT,
  turn_id TEXT,
  event_id TEXT,
  tool_call_id TEXT,
  run_id TEXT,
  workflow_run_id TEXT,
  idempotency_key TEXT,
  retention_class TEXT NOT NULL,
  payload_ref TEXT,
  preview_text TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  indexed_at TEXT
);
```

`event_log` ersetzt langfristig die Chat-Rollen von `chat_events`, `web_chat_events` und `pibo_event_stream`. Es speichert Reihenfolge und Referenzen, aber keine großen Payloads inline.

### `chat_messages`

Kanonische Chat-Historie.

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT,
  sequence INTEGER NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL,               -- user | assistant | system
  actor_id TEXT,
  status TEXT NOT NULL,             -- accepted | streaming | complete | failed | cancelled
  created_at TEXT NOT NULL,
  completed_at TEXT,
  content_preview TEXT,
  content_payload_ref TEXT,
  source_stream_id INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(session_id, sequence)
);
```

Diese Tabelle beantwortet: „Was ist die Chat-Historie dieser Session?“ Trace-spezifische Tool-/Run-Details gehören nicht hierhin, sondern in `observations`.

### `observations`

Typisierte Trace-/Timeline-Projektion.

```sql
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  parent_observation_id TEXT,
  turn_id TEXT,
  event_stream_id INTEGER,
  kind TEXT NOT NULL,               -- user_message, assistant_message, tool_call, tool_result, reasoning, run, subagent, error, compaction
  role TEXT,
  name TEXT,
  status TEXT NOT NULL,             -- running, ok, error, cancelled
  started_at TEXT NOT NULL,
  ended_at TEXT,
  latency_ms INTEGER,
  model_provider TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  preview_text TEXT,
  payload_ref TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(session_id, sequence)
);
```

### Navigation und Stats

```sql
CREATE TABLE session_stats (
  session_id TEXT PRIMARY KEY,
  message_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_event_stream_id INTEGER,
  last_message_sequence INTEGER,
  last_observation_sequence INTEGER,
  last_message_preview TEXT,
  last_activity_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE principal_session_stats (
  session_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_read_stream_id INTEGER NOT NULL DEFAULT 0,
  last_read_message_sequence INTEGER NOT NULL DEFAULT 0,
  last_read_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, principal_id)
);

CREATE TABLE principal_room_stats (
  room_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_read_stream_id INTEGER NOT NULL DEFAULT 0,
  last_read_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(room_id, principal_id)
);

CREATE TABLE session_navigation (
  owner_scope TEXT NOT NULL,
  room_id TEXT,
  session_id TEXT PRIMARY KEY,
  root_session_id TEXT,
  parent_id TEXT,
  origin_id TEXT,
  title TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  archived_at TEXT,
  last_activity_at TEXT NOT NULL,
  last_message_preview TEXT,
  child_count INTEGER NOT NULL DEFAULT 0,
  sort_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`session_navigation` ist rebuildbar. Es darf kleine Werte aus `sessions` und `session_stats` duplizieren, damit Sidebar und Room-Wechsel keine Joins über große Tabellen brauchen.

### Migration und Indexer

```sql
CREATE TABLE indexer_offsets (
  indexer_name TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  last_stream_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE migration_import_map (
  source_store TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_key TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_store, source_table, source_key)
);
```

## Indizes

Mindestens:

```text
sessions:
  UNIQUE(pi_session_id)
  (owner_scope, room_id, archived_at, last_activity_at DESC, id)
  (parent_id, last_activity_at DESC)
  (root_session_id)
  (workspace, last_activity_at DESC)

rooms:
  (owner_scope, parent_room_id, updated_at DESC)
  (owner_scope, archived_at, updated_at DESC)

chat_messages:
  UNIQUE(session_id, sequence)
  (session_id, sequence DESC)
  (room_id, created_at DESC)
  (turn_id)
  (session_id, role, status, sequence)

event_log:
  PRIMARY KEY(stream_id)
  UNIQUE(topic, event_id) WHERE event_id IS NOT NULL
  UNIQUE(topic, idempotency_key) WHERE idempotency_key IS NOT NULL
  (topic, stream_id)
  (session_id, stream_id)
  (room_id, stream_id)
  (session_id, type, turn_id)
  (retention_class, created_at)

observations:
  UNIQUE(session_id, sequence)
  (session_id, sequence DESC)
  (session_id, kind, status, sequence DESC)
  (trace_id, span_id)
  (payload_ref)

session_navigation:
  (owner_scope, room_id, archived_at, sort_key DESC)
  (root_session_id)
  (parent_id)

principal_session_stats:
  PRIMARY KEY(principal_id, session_id)
  (principal_id, unread_count)

principal_room_stats:
  PRIMARY KEY(principal_id, room_id)
```

---

# 4. Query- und Performance-Modell

## Bootstrap

`GET /api/chat/bootstrap` wird minimal:

```text
identity
selectedRoomId
selectedSessionId
schemaVersion
dataVersion
featureFlags
```

Nicht enthalten:

- vollständige Session-Liste
- Catalog
- Trace
- Payloads
- aus Event-Historie berechnete Unread Counts

Während der Migration darf Bootstrap als Kompatibilitätsadapter die neuen Endpunkte intern zusammensetzen. Der normale Room-Wechsel darf ihn nicht mehr benutzen.

## Room-Wechsel

```text
GET /api/chat/rooms/:roomId/sessions?limit=50&cursor=...
```

Query-Form:

```sql
SELECT
  n.session_id,
  n.title,
  n.profile,
  n.status,
  n.parent_id,
  n.origin_id,
  n.last_activity_at,
  n.last_message_preview,
  COALESCE(ps.unread_count, 0) AS unread_count
FROM session_navigation n
LEFT JOIN principal_session_stats ps
  ON ps.session_id = n.session_id AND ps.principal_id = ?
WHERE n.owner_scope = ?
  AND n.room_id = ?
  AND n.archived_at IS NULL
  AND n.parent_id IS NULL
ORDER BY n.sort_key DESC
LIMIT ?;
```

Children der sichtbaren Root-Sessions werden separat geladen:

```sql
SELECT *
FROM session_navigation
WHERE root_session_id IN (...)
ORDER BY root_session_id, parent_id, sort_key DESC;
```

Kein JSONL. Keine Event-History-Aggregation.

## Chat-Historie

```text
GET /api/chat/sessions/:id/messages?limit=100&before=...
```

```sql
SELECT id, sequence, role, status, created_at, completed_at,
       content_preview, content_payload_ref
FROM chat_messages
WHERE session_id = ?
  AND sequence < ?
ORDER BY sequence DESC
LIMIT ?;
```

Full Content kommt nur über Payload API.

## Trace / Timeline

```text
GET /api/chat/sessions/:id/trace?limit=200&cursor=...
```

```sql
SELECT id, sequence, kind, role, name, status, started_at, ended_at,
       latency_ms, preview_text, payload_ref, attributes_json
FROM observations
WHERE session_id = ?
  AND sequence < ?
ORDER BY sequence DESC
LIMIT ?;
```

Große Tool Outputs, Bash Logs, Provider Responses und lange Messages werden lazy geladen.

## Payload-Laden

```text
GET /api/chat/payloads/:payloadId
POST /api/chat/payloads/batch
```

Der Client lädt Payloads nur für sichtbare oder expandierte Elemente.

## Performance-Ziele

| Operation | Ziel |
|---|---:|
| Room-Wechsel bei 1.000 Sessions | < 50 ms serverseitig |
| Session-List-Page Query | < 25 ms serverseitig |
| Initial Navigation ohne Catalog | < 100 ms serverseitig |
| Trace erster Page ohne Payload Expansion | < 100 ms serverseitig |
| Payload Batch für sichtbare Details | < 150 ms lokal |
| Unread Lookup | kleine indexierte Query |
| JSONL Reads in Navigation | 0 |
| große Inline-Payloads in heißen Tabellen | 0 über Threshold |

---

# 5. Payload-Strategie

## Grundregel

Vollständige Inhalte liegen im Payload-System. Heiße Tabellen speichern nur:

- Preview
- Payload Ref
- Größen-/Typ-Metadaten
- kleine typisierte Spalten für Queries

## Threshold

Empfehlung:

```text
> 16 KiB: immer Datei im Payload Store
<= 16 KiB: über Payload-Abstraktion; inline-small in payloads ist erlaubt, aber nicht in hot navigation/messages/observations rows
```

Immer auslagern:

- Tool Results
- Bash stdout/stderr
- große File Reads
- rohe Provider Responses
- große Assistant Messages
- Attachments
- Debug Dumps

## Pfadlayout

```text
~/.pibo/payloads/sha256/ab/cd/<sha256>.json.gz
~/.pibo/payloads/sha256/ef/01/<sha256>.txt.gz
```

## Schreibprotokoll

1. Inhalt kanonisieren.
2. SHA-256 über unkomprimierte Bytes berechnen.
3. Komprimierte Temp-Datei schreiben.
4. Datei atomar umbenennen.
5. `payloads` row upserten.
6. Ref Count erhöhen.
7. Referenz in `chat_messages`, `event_log` oder `observations` speichern.

Bei Prozessabbruch bleiben temporäre Dateien bereinigbar.

## Preview Policy

- `preview_text`: 1–4 KiB normalisierter Text.
- Für JSON: relevante Felder bevorzugen, nicht blind Anfang des JSON Dumps.
- Für Binärdaten: Dateityp, Größe, Hash, optional extracted text.

## Integrität

Periodischer Scrub prüft:

- Datei existiert.
- Größe passt.
- Hash passt.
- Ref Count passt zu referenzierenden Tabellen.
- keine orphan payloads außerhalb Quarantäne.

## Löschen und GC

1. Referenz entfernen oder Session löschen.
2. Ref Count reduzieren.
3. Payload mit `ref_count=0` als orphan candidate markieren.
4. Quarantäne, z. B. 7 Tage.
5. GC löscht nur danach.
6. Backup/Export berücksichtigt Manifest.

---

# 6. Migrationsplan

## Sicherheitsprinzip

Migration ist idempotent, resumable und rollbackfähig.

```text
Legacy bleibt zunächst lesbar.
V2 wird parallel aufgebaut.
Read Path wechselt erst nach Vergleich.
Legacy Writes werden spät abgeschaltet.
Legacy Stores werden zuletzt archiviert oder gelöscht.
```

## Feature Flags

```text
PIBO_DATA_V2_WRITE=0|1
PIBO_DATA_V2_READ=off|shadow|primary
PIBO_LEGACY_CHAT_WRITE=1|0
PIBO_LEGACY_JSONL_READ=1|0
PIBO_DATA_V2_IMPORT=off|dry-run|apply
```

## Backfill-Quellen und Priorität

1. `pibo-sessions.sqlite/pibo_sessions` -> `sessions`
2. `web-chat.sqlite/pibo_rooms`, `pibo_room_members` -> `rooms`, `room_members`
3. `web-chat.sqlite/chat_events` -> user accepts/fails, read cursors, SSE-relevante envelopes
4. `web-chat.sqlite/web_chat_events` -> observations, runtime timeline
5. `pibo-events.sqlite/pibo_event_stream` -> nur Produkt-/Runtime-Events, die nicht bereits aus Chat Web importiert wurden
6. JSONL -> nur Lückenfüller für Titel, erste Message, historische Transcript-Lücken, Fork-/Replay-Metadaten und Validierung

## Dedupe-Regeln

- Payloads: SHA-256.
- Event Envelopes: `(topic, event_id)` oder `(topic, idempotency_key)`.
- User Messages: `(room_id, actor_id, client_txn_id)` wenn vorhanden.
- Runtime Events: `(session_id, type, turn_id, tool_call_id, event_id, source_sequence)`.
- Transcript Entries: `(pi_session_id, entry_id)` oder Import Map.
- Live-only deltas werden nicht dauerhaft importiert, wenn ein finaler kompakter Zustand existiert.

## Validierung

Vor Cutover:

- Session Counts alt/neu.
- Room Counts alt/neu.
- Message Counts pro Session.
- Trace Observation Counts pro Session.
- latest activity pro Session.
- unread counts für Stichproben.
- Payload Ref Integrität.
- Orphan Payload Count.
- Stichproben-Export alter Sessions.
- UI Smoke Test gegen V2.

## Rollback

Während Shadow/Dual Write:

- `PIBO_DATA_V2_READ=off` stellt Legacy Reads wieder her.
- Legacy Writes bleiben aktiv.
- V2 DB kann neu aufgebaut werden.
- Payload Store ist additive-only; unreferenzierte Payloads bleiben bis GC erhalten.

Nach V2 Primary:

- Legacy Writes erst nach sauberem Shadow-Vergleich abschalten.
- Legacy DBs mindestens eine Release-/Validierungsphase archivieren.
- Cleanup nur nach `pibo data verify` und Backup.

---

# 7. API-Plan

## Bootstrap

```text
GET /api/chat/bootstrap
```

Minimalantwort:

- `identity`
- `selectedRoomId`
- `selectedSessionId`
- `schemaVersion`
- `dataVersion`
- `featureFlags`

## Navigation und Rooms

```text
GET /api/chat/navigation?area=&roomId=&sessionId=&limit=&cursor=
GET /api/chat/rooms?area=&includeArchived=
GET /api/chat/rooms/:id
POST /api/chat/rooms
PATCH /api/chat/rooms/:id
```

Navigation liefert Room Tree, selektierte IDs und erste Session Page. Kein Catalog, kein Trace, keine Payloads.

## Sessions

```text
GET /api/chat/sessions?roomId=&limit=&cursor=&includeArchived=
GET /api/chat/sessions/:id
POST /api/chat/sessions
PATCH /api/chat/sessions/:id
POST /api/chat/sessions/:id/archive
POST /api/chat/sessions/:id/read
```

## Messages

```text
GET /api/chat/sessions/:id/messages?limit=&cursor=
POST /api/chat/sessions/:id/messages
```

Messages endpoint ist für Chat-Historie. Er liefert previews und payload refs.

## Trace / Timeline

```text
GET /api/chat/sessions/:id/trace?limit=&cursor=
GET /api/chat/observations/:id
```

Trace endpoint ist für Tools, Runs, Model Calls, Errors, Reasoning und Timeline Details.

## Payloads

```text
GET /api/chat/payloads/:payloadId
POST /api/chat/payloads/batch
```

Payload-Zugriff prüft Ownership über die referenzierende Session/Observation/Message. Der Client bekommt keine rohen Dateipfade.

## Catalog

```text
GET /api/chat/catalog
GET /api/chat/agent-catalog
GET /api/chat/model-catalog
```

Catalog ist separat cachebar und gehört nicht in Room Switch.

## SSE

```text
GET /api/chat/events?roomId=&sessionId=&since=
```

SSE nutzt V2 `event_log` für kurzfristigen Catchup und Live-Ingest für neue Frames. Deltas bleiben live-only, wenn finalisierte Messages/Observations existieren.

---

# 8. Betriebs- und Wartungskonzept

## Retention

| Daten | Policy |
|---|---|
| Live deltas | Minuten bis Stunden; nach finaler Message/Observation löschbar |
| Event envelopes | z. B. 7–30 Tage oder bis alle Indexer bestätigt haben |
| Chat messages | bis Session-Löschung oder Nutzer-Retention |
| Observations | längerfristig, aber ohne große Inline-Payloads |
| Payloads | solange referenziert |
| JSONL exports | manuell oder definierte Archiv-Retention |
| Reliability events/jobs | eigene Policy in Reliability Store oder später `pibo.sqlite` |

## Compaction

Regelmäßig:

- assistant deltas zu finaler Message komprimieren,
- tool update deltas zu finaler Observation komprimieren,
- alte raw envelopes nach Indexer-Bestätigung prunen,
- payload refs prüfen,
- stats und navigation neu aufbauen, falls Drift erkannt wird.

## SQLite Maintenance

Nicht im Request Path.

Empfehlung:

- WAL Mode beibehalten.
- `PRAGMA busy_timeout` setzen.
- periodisch `wal_checkpoint(TRUNCATE)` bei ruhigem System oder WAL-Größenlimit.
- `PRAGMA optimize` regelmäßig.
- `ANALYZE` nach großen Migrationen.
- `VACUUM INTO` für Shrinks, nicht riskant ad hoc in-place.
- vor VACUUM: Backup, `integrity_check`, Writes pausieren.
- nach VACUUM: `integrity_check`, Row Count Vergleich, Stichproben öffnen.

## Backup

Vollständiges Backup enthält:

- V2 SQLite Snapshot,
- Payload Store,
- Payload Manifest,
- optional Legacy DBs,
- optional JSONL Archive.

DB ohne Payload Store ist kein vollständiges Backup.

## Repair und Reindexing

CLI-Oberfläche:

```text
pibo data inventory
pibo data migrate --dry-run
pibo data migrate --apply
pibo data verify
pibo data reindex navigation
pibo data reindex stats
pibo data reindex observations
pibo data payloads stats
pibo data payloads scrub
pibo data payloads gc --dry-run
pibo data legacy cleanup --dry-run
pibo debug stores
pibo debug trace <session> --source v2|legacy|diff
pibo debug events <session> --source v2|legacy
```

## Metriken

Tracke:

- DB size,
- WAL size,
- page count,
- freelist pages,
- row counts pro Tabelle,
- largest payloads,
- payload store size,
- orphan payload count,
- indexer lag,
- V2-vs-legacy diff count,
- JSONL reads im Web path,
- endpoint timings,
- slow queries,
- bootstrap payload size.

---

# 9. Implementierungsphasen

## Phase 0 — Safety, Inventory, Timing

**Ziel:** Ist-Zustand messbar machen und Daten schützen.

**Arbeiten:**

- Inventory Command für Legacy Stores.
- Row Counts, DB/WAL-Größen, Freelist Pages.
- Payload-Größenhistogramme aus `payload_json`.
- Missing title count.
- Sessions ohne Room ID.
- Duplicate event candidates.
- Server Timing für Bootstrap, Sessions, Trace, SSE replay.
- Backup-/Restore-Anleitung.
- Feature Flags hinzufügen.

**Risiken:**

- Inventory darf keine Daten mutieren.
- Große Legacy DBs können langsam gescannt werden.

**Erfolgskriterien:**

- `pibo data inventory` läuft read-only.
- Backup-Prozedur ist dokumentiert und getestet.
- Hot-path Timing zeigt JSONL, unread, catalog und serialization separat.

**Tests/Validierung:**

- Inventory gegen Kopie der lokalen Produktionsdaten.
- `PRAGMA integrity_check` auf Legacy DBs.
- Smoke Test der unveränderten UI.

## Phase 1 — Sofortige Hot-Path-Entlastung

**Ziel:** Navigation spürbar schneller machen, bevor der große Umbau greift.

**Arbeiten:**

- Catalog aus Room Switch entfernen oder separat cachen.
- Room Switch darf `SessionManager.list()` nicht aufrufen.
- Fehlende Titel nicht synchron aus JSONL holen; stattdessen Placeholder plus async Backfill.
- Unread Counts nicht blockierend aus historischer Event-History berechnen.
- Vorhandene SQLite Read Models für Navigation bevorzugen.

**Risiken:**

- Kurzzeitig weniger perfekte Titel.
- Unread Badges können verzögert sein.

**Erfolgskriterien:**

- Room Switch ohne JSONL Scan.
- Room Switch ohne `countUnreadMessagesBySession()`.
- Room Switch serverseitig bei aktueller Datenmenge deutlich unter 100 ms.

**Tests/Validierung:**

- Failing mock/spy für `SessionManager.list()` im Navigation Path.
- Browser Smoke Test: refresh, room switch, session select.
- Timing Header prüfen.

## Phase 2 — V2 Store und Payload Store anlegen

**Ziel:** Neue Speicherbasis ohne Verhaltensänderung schaffen.

**Arbeiten:**

- `src/data/pibo-store.ts` für Connection und Transactions.
- `src/data/schema.ts` für V2 Migrationen.
- `src/data/payload-store.ts` für write/read/dedupe/scrub.
- Tabellen `sessions`, `rooms`, `chat_messages`, `event_log`, `observations`, stats, navigation, migration state.
- Idempotente Schema-Migrationen.

**Risiken:**

- Zu viele bestehende Stores auf einmal anfassen.
- Path-Entscheidung `pibo.sqlite` vs Shadow-Datei.

**Erfolgskriterien:**

- V2 Store kann erstellt werden, ohne Legacy zu verändern.
- Payload write/read/dedupe funktioniert.
- Schema-Migration ist idempotent.

**Tests/Validierung:**

- Unit Tests für Schema.
- Payload Store Tests.
- Event idempotency Tests.
- `npm run typecheck`.

## Phase 3 — Shadow Ingest und Projector

**Ziel:** Neue Live-Daten parallel in V2 schreiben.

**Arbeiten:**

- Zentralen Ingest Service bauen.
- `sendChatMessage()` schreibt V2 und Legacy während Flag aktiv ist.
- Router/Pi Output Events normalisieren.
- Große Payloads externalisieren.
- `event_log`, `chat_messages`, `observations`, stats und navigation aktualisieren.
- Startup Catch-up Indexer für unindexierte Events.
- Shadow Compare Commands.

**Risiken:**

- Divergenz zwischen Legacy und V2.
- Teilweise DB-Transaktion + Datei-Schreibvorgang.
- Doppelte Events bei Retry.

**Erfolgskriterien:**

- Neue Events erscheinen in V2.
- Legacy UI bleibt unverändert.
- Keine duplicate full payloads in V2.
- Shadow Compare zeigt konkrete Unterschiede.

**Tests/Validierung:**

- Kill während Payload Write.
- Idempotente doppelte Event Writes.
- Restart nach teilweisem Index.
- SSE reconnect.

## Phase 4 — Legacy Backfill

**Ziel:** Bestehende Daten vollständig und dedupliziert nach V2 importieren.

**Arbeiten:**

- Dry-run Importer.
- Resumable Import mit `migration_import_map`.
- Sessions und Rooms importieren.
- Messages aus `chat_events`, `web_chat_events`, JSONL-Lücken importieren.
- Observations aus `web_chat_events` und Runtime Events importieren.
- Read Cursors übernehmen.
- Titel und Previews backfillen.
- Payloads externalisieren.
- Stats und navigation rebuilden.

**Risiken:**

- Unklare Dedupe bei alten Events.
- Legacy JSONL kann mehr oder andere Informationen haben.
- Große Payload-Migration kann lange laufen.

**Erfolgskriterien:**

- Aktive Sessions haben Titel und Previews.
- V2 Navigation deckt aktive Sessions ab.
- V2 Trace kann aktive Sessions rendern.
- Payload scrub ist sauber.

**Tests/Validierung:**

- Legacy-vs-V2 Count Vergleich.
- Stichproben alter großer Sessions.
- Trace diff für repräsentative Sessions.
- Unread count Vergleich für Stichproben.

## Phase 5 — Neue Read APIs und Frontend-Umstellung

**Ziel:** Web UI nutzt getrennte schnelle Endpunkte.

**Arbeiten:**

- Backend: `/navigation`, `/rooms`, `/sessions`, `/messages`, `/trace`, `/payloads`, `/catalog`.
- Bootstrap als Kompatibilitätsadapter behalten.
- Frontend Query Keys trennen.
- Catalog lazy laden und cachen.
- Room Switch über Sessions/Navigation Endpoint.
- Trace erst bei Session-Auswahl laden.
- Payloads erst bei Expansion laden.
- Mark-read über dedizierten Endpoint.

**Risiken:**

- Mehr Requests können schlechte Client-Koordination zeigen.
- Alte UI-Komponenten erwarten großen Bootstrap Payload.

**Erfolgskriterien:**

- Room Switch lädt nur Navigation/Session Page.
- Catalog wird nicht bei Room Switch geladen.
- Trace wird nicht bei Room Switch geladen.
- Payloads werden nicht für Sidebar geladen.

**Tests/Validierung:**

- Browser Network Profile.
- React Query Cache Tests.
- E2E: refresh, room switch, session switch, trace expansion, message send.

## Phase 6 — V2 Primary Reads und Legacy Chat Writes stoppen

**Ziel:** Neue doppelte Chat-Daten verhindern.

**Arbeiten:**

- `PIBO_DATA_V2_READ=primary` zuerst Docker worker, dann dev gateway, dann production nach Freigabe.
- `PIBO_LEGACY_CHAT_WRITE=0`, wenn Shadow Metrics sauber sind.
- `ChatEventLog` und `ChatWebReadModel` als Adapter oder Legacy-only markieren.
- Chat Output Payloads nicht mehr in `pibo_event_stream` schreiben.

**Risiken:**

- Versteckte Legacy-Call-Sites.
- Debug Tools lesen noch alte Tabellen.

**Erfolgskriterien:**

- `chat_events` und `web_chat_events` wachsen nicht mehr.
- `pibo_event_stream` bekommt keine Chat Output Payload Copies.
- Normale UI funktioniert ohne Legacy Reads.

**Tests/Validierung:**

- Code Audit mit `rg`.
- Debug CLI gegen V2.
- E2E ohne Legacy DB Kopie in Testumgebung.

## Phase 7 — Trace ohne JSONL

**Ziel:** Trace/Timeline aus `observations` und Payloads rendern.

**Arbeiten:**

- Observation-to-trace Adapter.
- `src/apps/chat/trace.ts` primär auf V2 umstellen.
- JSONL rebuild nur noch Debug/Diff.
- Subagent Links, yielded runs, compaction nodes, tools, reasoning und order keys erhalten.

**Risiken:**

- Alte Trace-Ansichten können semantische Details aus JSONL erwarten.
- Fork/clone benötigt stabile Entry IDs.

**Erfolgskriterien:**

- Normaler Trace liest kein JSONL.
- Debug kann V2 gegen Legacy vergleichen.
- Trace UI zeigt große Payloads lazy.

**Tests/Validierung:**

- Trace diff fixtures.
- Live running turn.
- Tool result expansion.
- Subagent session updates.
- Fork/clone controls.

## Phase 8 — Pi JSONL Decommission / Persistence Adapter

**Ziel:** JSONL ist nicht mehr required write path.

**Arbeiten:**

- Pi extension points für eigene Persistenz prüfen.
- Wenn möglich `PiboSessionManagerAdapter` bauen.
- Wenn nicht möglich: upstream interface, lokaler wrapper oder Fork prüfen.
- Export-on-demand JSONL implementieren.
- Fork/clone/tree/compaction auf V2-Daten abbilden.

**Risiken:**

- Pi-Persistenz ist der schwierigste Umbau.
- Externe Kompatibilität kann JSONL erwarten.

**Erfolgskriterien:**

- Neue Sessions können ohne JSONL als primäre Persistenz laufen.
- JSONL wird nicht standardmäßig geschrieben.
- JSONL kann bei Bedarf exportiert werden.

**Tests/Validierung:**

- Runtime E2E ohne JSONL.
- Fork/clone/compact/reopen.
- Export/import Vergleich.

## Phase 9 — Maintenance und Legacy Cleanup

**Ziel:** Alte Stores entfernen und Speicher stabil halten.

**Arbeiten:**

- `pibo data legacy cleanup --archive`.
- Legacy DBs final sichern.
- Alte Tabellen/Codepfade entfernen oder als Migration fixtures behalten.
- Payload GC.
- WAL checkpoint.
- `VACUUM INTO` für finale DB.
- Specs und Docs aktualisieren.

**Risiken:**

- Zu frühes Löschen.
- Versteckte Tools brauchen Legacy noch.

**Erfolgskriterien:**

- App startet ohne `web-chat.sqlite` und `pibo-sessions.sqlite`.
- Normale Operation fragt keine Legacy Tabellen ab.
- Speicher wächst kontrolliert.

**Tests/Validierung:**

- Restore aus Backup.
- `pibo data verify`.
- Browser smoke tests.
- Debug tools gegen V2.

---

# 10. Entscheidungsfragen und Tradeoffs

| Entscheidung | Empfehlung | Verworfene Option | Begründung |
|---|---|---|---|
| Ein Store oder viele? | Ein V2 `PiboDataStore` für Chat-Domain; physisch langfristig `pibo.sqlite` | Dauerhaft `pibo-sessions`, `web-chat`, `events`, JSONL parallel | Ein mentaler Ort für Chat-Daten ist einfacher und schneller |
| Reliability Store sofort migrieren? | Nein, nicht als Chat-Cutover-Blocker | Jobs/Runs/Workflows sofort mit migrieren | Erhöht Risiko ohne direkten Navigation-Gewinn |
| `chat_messages` separat? | Ja | Chat-Historie nur aus `event_log` oder `observations` lesen | Chat-Historie ist fachlich etwas anderes als Trace |
| Raw Event Log ewig behalten? | Nein, retention-basiert | Event Sourcing forever für alles | Speicher wächst; Projektionen und Messages sind die langfristige Wahrheit |
| JSONL als Web Source? | Nein | Titel/Trace weiter aus JSONL | Nachweislich langsam und schwer indexierbar |
| JSONL sofort löschen? | Nein | harte Entfernung in erster Phase | Pi-Abhängigkeit und Recovery-Risiko |
| Unread on demand? | Nein, materialisieren | historische Counts bei Navigation berechnen | Aktuell 4.3 s für 225 Sessions |
| Payloads inline? | Nein, ab 16 KiB Datei; full content über Payload-System | große JSONs in hot tables | Reduziert DB/WAL-Bloat und I/O |
| `session_navigation` als Tabelle? | Ja, rebuildbar | jedes Mal aus vielen Tabellen joinen oder JSON extrahieren | Sidebar braucht konstante, kleine Queries |
| Externe Infrastruktur? | Nein, optional später | ClickHouse/Redis/Kafka/OTel Collector jetzt | Für lokalen Pibo-Betrieb zu schwergewichtig |
| Catalog in Bootstrap? | Nein | All-in-one Bootstrap behalten | Room Switch lädt sonst unnötige Daten |

---

# Code Impact Map

## Neue Module

| Modul | Verantwortung |
|---|---|
| `src/data/pibo-store.ts` | DB öffnen, PRAGMAs, Transaction Helper, Store Registry |
| `src/data/schema.ts` | V2 Schema und Migrationen |
| `src/data/payload-store.ts` | Content-addressed payload writes/reads/dedupe/GC |
| `src/data/event-log.ts` | kompakte Event Envelopes, idempotent append, list |
| `src/data/session-store.ts` | V2 `PiboSessionStore` |
| `src/data/room-store.ts` | V2 Rooms/Members |
| `src/data/message-store.ts` | Chat-Historie |
| `src/data/observation-store.ts` | Trace/Timeline Rows |
| `src/data/navigation-store.ts` | Sidebar/Room queries |
| `src/data/stats-store.ts` | Stats, unread, read cursors |
| `src/data/indexer.ts` | Event -> messages/observations/stats/navigation |
| `src/data/legacy-importer.ts` | Backfill aus Legacy Stores und JSONL |
| `src/data/legacy-compare.ts` | V2-vs-Legacy Diff |

## Bestehende Module

| Datei | Änderung |
|---|---|
| `src/sessions/sqlite-store.ts` | durch V2 Store ersetzen oder adapterweise umbiegen |
| `src/sessions/store.ts` | roomId, archivedAt, firstMessagePreview, lastActivity in Typen staged ergänzen |
| `src/apps/chat/web-app.ts` | Routen splitten, Ingest Service nutzen, Bootstrap verkleinern |
| `src/apps/chat/event-log.ts` | Legacy Adapter, später entfernen |
| `src/apps/chat/read-model.ts` | Legacy Adapter, später durch observations/navigation ersetzen |
| `src/apps/chat/rooms.ts` | auf V2 room store umstellen |
| `src/apps/chat/trace.ts` | primär observations, JSONL nur Debug/Diff |
| `src/apps/chat/output-compactor.ts` | final durable events an V2 ingest liefern; live deltas vermeiden |
| `src/reliability/store.ts` | keine Chat Output Payloads in `pibo_event_stream` |
| `src/apps/chat-ui/src/api.ts` | neue endpoints |
| `src/apps/chat-ui/src/cache.ts` | getrennte query keys |
| `src/apps/chat-ui/src/App.tsx` | Bootstrap entkoppeln, payload lazy loading |
| Debug CLI | `data`, `stores`, `trace --source v2|legacy|diff` |

---

# Testing Plan

## Unit Tests

- Schema migrations.
- Payload write/read/dedupe/scrub.
- Event idempotency.
- Per-session sequence allocation.
- Message projection.
- Observation projection für alle `PiboOutputEvent` Typen.
- Unread counter und mark-read semantics.
- Navigation mit archived rooms/sessions.
- Legacy importer resume.
- Dedupe rules.

## Integration Tests

- New session -> send message -> assistant/tool events -> V2 messages/trace.
- Room switch ruft kein JSONL auf.
- Restart nach partial index -> catch-up.
- SSE reconnect aus V2 event_log.
- Payload expansion.
- Archive/restore/delete.
- Agent/catalog unabhängig von navigation.

## Migration Tests

- Fixture DBs importieren.
- Doppelte Events aus `chat_events` und `web_chat_events` nur einmal übernehmen.
- `pibo_event_stream` Chat Output nur importieren, wenn nicht bereits vorhanden.
- Große Payloads externalisieren.
- Keine fehlenden payload refs.

## Performance Tests

- 1k, 10k, 100k Sessions/Events synthetisch.
- Navigation query timings.
- Trace query timings.
- Payload batch timings.
- Indexer catch-up throughput.
- DB/WAL size nach compaction.

Vor Cutover mindestens:

```bash
npm run typecheck
npm run build
npm test
```

Für Web/Gateway-Änderungen zusätzlich dev gateway / Docker worker browser smoke tests.

---

# Definition of Done

Der Umbau ist fertig, wenn alle Punkte wahr sind:

1. Vollständige Chat-/Tool-/Provider-Inhalte liegen einmal im Payload-System.
2. `sessions` besitzt alle Navigationsmetadaten.
3. `chat_messages` ist die Wahrheit für Chat-Historie.
4. `observations` ist die Wahrheit für Trace/Timeline.
5. Room Switch und Refresh lesen kein JSONL.
6. Room Switch und Refresh aggregieren keine historische Event-History.
7. Bootstrap lädt keinen Catalog, keine Trace-Daten und keine Payloads.
8. Unread Counts sind materialisiert und rebuildbar.
9. `chat_events` und `web_chat_events` werden im Normalbetrieb nicht geschrieben oder gelesen.
10. `pibo_event_stream` enthält keine Chat Output Payload Copies mehr.
11. JSONL ist Export-/Legacy-/Debug-Format, nicht Source of Truth.
12. Legacy Cleanup kann alte Stores nach Verifikation archivieren oder löschen.
13. Debug Tools erklären V2-Zustand ohne Legacy Stores.
14. Backup/Restore umfasst SQLite plus Payload Store.

## Kurzfassung der Zielarchitektur

```text
pibo.sqlite
  sessions              = Session-Wahrheit
  rooms                 = Room-Wahrheit
  chat_messages         = Chat-Historie
  event_log             = kompakte Event-Envelopes
  observations          = Trace/Timeline
  session_navigation    = rebuildbare Sidebar-Projektion
  *_stats               = materialisierte Counts/Cursors
  payloads              = Payload-Metadaten

~/.pibo/payloads
  vollständige große Inhalte, content-addressed

Legacy
  web-chat.sqlite       = Importquelle, später Archiv
  pibo-sessions.sqlite  = Importquelle, später Archiv
  pibo-events.sqlite    = Reliability zunächst behalten, keine Chat-Payload-Kopien
  Pi JSONL              = Migration/Export/Pi-Kompatibilität, kein Web-Hot-Path
```
