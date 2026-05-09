# Plan: Pibo Debug SQL CLI

## Ziel

Pibo soll ein agentenfreundliches CLI fuer lokale Diagnoseabfragen gegen die Pibo SQLite-Dateien bekommen. Das CLI soll es ermoeglichen, Session-, Chat-, Room-, Agent- und Auth-Daten gezielt zu inspizieren, ohne komplette Pi-Transkripte oder grosse Chat-Kontexte unkontrolliert in den Agent-Kontext zu laden.

Das Tool soll zwei Modi kombinieren:

- sichere, gefuehrte Presets fuer haeufige Diagnosefragen
- freie Read-only SQL-Abfragen fuer Faelle, in denen ein Agent gezielt selber queryn muss

## Problem

Aktuell muessen Agents bei Debug-Fragen direkt die SQLite-Dateien kennen und per `node:sqlite` oder externem `sqlite3` abfragen. Das ist schlechte UX:

- `sqlite3` ist nicht immer installiert.
- Das Projekt nutzt `node:sqlite`, was nicht sofort discoverable ist.
- Die relevanten Daten liegen verteilt in mehreren Dateien:
  - `.pibo/pibo-sessions.sqlite`
  - `.pibo/web-chat.sqlite`
  - `.pibo/chat-agents.sqlite`
  - `.pibo/auth.sqlite`
  - `.pibo/session-bindings.sqlite`
- Ohne Schema-Discovery ist unklar, welche Tabellen und Spalten existieren.
- Direkte Session-/Transcript-Dumps koennen den Agent-Kontext ueberladen.
- Eine Chat-Web-URL enthaelt zwar Room- und Pibo-Session-ID, aber aktuell gibt es keinen direkten CLI-Pfad von URL zu Diagnoseausgabe.

## Leitentscheidungen

1. Das CLI wird ein Operator-/Debug-Tool, kein Agent-Profil-Tool.
2. Freie SQL-Abfragen sind Read-only.
3. Das Tool laedt niemals automatisch komplette Pi Session Transkripte.
4. Ausgabe ist standardmaessig klein, begrenzt und tabellarisch oder JSON.
5. Das CLI folgt der Pibo-Regel fuer progressive Discovery: jede Ebene zeigt nur den naechsten sinnvollen Befehl.
6. Presets sollen die haeufigsten Workflows ohne SQL-Kenntnis abdecken.
7. SQL bleibt verfuegbar, damit Agents nicht blockiert sind, wenn ein Preset fehlt.

## Vorgeschlagene Command-Struktur

Neuer Top-Level-Befehl:

```bash
npm run dev -- debug
```

Discovery:

```text
pibo debug - inspect local pibo data

Commands:
  db        Inspect and query local SQLite stores
  session   Inspect one Pibo Session by id or Chat URL

Next:
  pibo debug db
  pibo debug session <url-or-pibo-session-id>
```

### `pibo debug db`

```text
pibo debug db - inspect local SQLite stores

Stores:
  sessions   .pibo/pibo-sessions.sqlite
  chat       .pibo/web-chat.sqlite
  agents     .pibo/chat-agents.sqlite
  auth       .pibo/auth.sqlite
  bindings   .pibo/session-bindings.sqlite

Commands:
  stores                 List known stores and paths
  schema <store>         List tables and columns
  tables <store>         List tables only
  query <store> <sql>    Run read-only SQL

Next:
  pibo debug db schema sessions
  pibo debug db query sessions "select id, profile from pibo_sessions limit 5"
```

### `pibo debug session`

```bash
pibo debug session ps_...
pibo debug session /apps/chat/rooms/room_.../sessions/ps_...
pibo debug session --json ps_...
pibo debug session --children ps_...
pibo debug session --events ps_... --limit 20
```

Default output should include:

- parsed input:
  - `roomId` if supplied by URL
  - `piboSessionId`
- `pibo_sessions` row:
  - id
  - pi_session_id
  - channel
  - kind
  - profile
  - owner_scope
  - parent_id
  - origin_id
  - title
  - metadata_json, parsed when possible
  - created_at / updated_at
- child sessions:
  - id
  - profile
  - kind
  - metadata subagentName
  - metadata subagentToolName
  - metadata threadKey
  - metadata chatRoomId
- Chat Web read model status when present:
  - `web_chat_sessions.status`
  - `last_activity_at`
- room match when present:
  - session metadata `chatRoomId`
  - URL room ID consistency

Default output should not include:

- full `web_chat_events.payload_json`
- full `chat_events.payload_json`
- Pi session JSONL transcript

## SQL Safety Model

`pibo debug db query` must be read-only by default.

Rules:

- Open SQLite with `new DatabaseSync(path, { readOnly: true })`.
- Accept only one SQL statement.
- Reject obvious mutating statements before execution:
  - `insert`
  - `update`
  - `delete`
  - `drop`
  - `alter`
  - `create`
  - `replace`
  - `vacuum`
  - `attach`
  - `detach`
  - `pragma` except allowlisted read-only pragmas
- Permit:
  - `select`
  - `with ... select`
  - read-only `pragma table_info(...)`
  - read-only `pragma index_list(...)`
  - read-only `pragma index_info(...)`
- Enforce a default row limit.
- If the supplied SQL has no explicit `limit`, wrap it:

```sql
select * from (<user sql>) limit ?
```

- Provide `--limit <n>` with a sane max, for example max `1000`.
- Provide `--json` for machine-readable output.
- Provide `--raw` only if needed later; do not include it in V1 unless tests require it.

Important limitation:

- SQL validation is defensive but not a security boundary against a hostile local operator. The real protection is opening the database read-only and keeping the CLI local.

## Store Registry

Create a small internal registry for known local DBs.

Suggested module:

```text
src/debug/stores.ts
```

Data shape:

```ts
type PiboDebugStoreName =
  | "sessions"
  | "chat"
  | "agents"
  | "auth"
  | "bindings";

type PiboDebugStore = {
  name: PiboDebugStoreName;
  description: string;
  defaultPath: string;
};
```

Initial store mapping:

| Store | Path | Purpose |
| --- | --- | --- |
| `sessions` | `.pibo/pibo-sessions.sqlite` | canonical Pibo Session metadata |
| `chat` | `.pibo/web-chat.sqlite` | Chat Web read model, rooms, durable chat events |
| `agents` | `.pibo/chat-agents.sqlite` | custom Agent Designer profiles |
| `auth` | `.pibo/auth.sqlite` | Better Auth local auth data |
| `bindings` | `.pibo/session-bindings.sqlite` | local session binding data if present |

The CLI should tolerate missing stores and print a concise "not found" message with the expected path.

## Output Design

Default table output:

- Use compact text with columns separated by tabs.
- Print at most `--limit` rows.
- Print a final line when truncated:

```text
rows: 50 (limited)
```

JSON output:

```json
{
  "store": "sessions",
  "path": ".pibo/pibo-sessions.sqlite",
  "rows": [
    {
      "id": "ps_...",
      "profile": "codex-compat-openai-web"
    }
  ],
  "limited": false
}
```

Schema output:

```json
{
  "store": "sessions",
  "tables": [
    {
      "name": "pibo_sessions",
      "columns": [
        { "name": "id", "type": "TEXT", "notNull": false, "primaryKey": true }
      ],
      "indexes": []
    }
  ]
}
```

## Session Preset Details

Implement `pibo debug session` using SQL against known stores, not direct store classes that initialize or migrate databases. The command is a read-only inspector.

Input parsing:

- If input starts with `/apps/chat/`, parse:
  - `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>`
  - `/apps/chat/sessions/<piboSessionId>`
- If input starts with `http://` or `https://`, parse URL pathname.
- Otherwise treat input as a Pibo Session ID.

Queries:

```sql
select * from pibo_sessions where id = ?
```

```sql
select id, pi_session_id, channel, kind, profile, parent_id, metadata_json, created_at, updated_at
from pibo_sessions
where parent_id = ?
order by created_at
limit ?
```

```sql
select *
from web_chat_sessions
where pibo_session_id = ?
```

Optional event summary:

```sql
select type, event_id, created_at
from web_chat_events
where pibo_session_id = ?
order by rowid desc
limit ?
```

Do not print full event payloads unless the user explicitly uses `pibo debug db query chat ...`.

## Documentation Requirements

Update:

- `README.md`
  - Mention `pibo debug` in the command list.
  - Add a short "Debug CLI" section with examples.
- `docs/tools.md` or `docs/architecture.md`
  - Document that this is an operator CLI, not a profile tool.
  - Explain read-only SQL, known stores, and session URL parsing.
- `RULES.md`
  - Optional: mention `pibo debug` as a progressive discovery surface once implemented.
- `GLOSSARY.md`
  - Optional: add "Debug CLI" if the term becomes common.

## Implementation Plan

### Phase 1: CLI Skeleton

1. Add `src/debug/index.ts`.
   - Exports `runDebugCli(argv = process.argv)`.
   - Handles root discovery for `pibo debug`.
   - Subcommands: `db`, `session`.
   - Verify: CLI tests for root discovery and subcommand discovery.

2. Wire `debug` into `src/cli.ts`.
   - Top-level root discovery should list `debug`.
   - `argv[2] === "debug"` should delegate before Commander fallback, same pattern as `mcp` and `tools`.
   - Verify: existing progressive CLI tests updated.

### Phase 2: Store Registry And Schema Discovery

1. Add `src/debug/stores.ts`.
   - Known stores and default paths.
   - Path resolution from cwd.
   - Missing-store checks.

2. Add schema commands:
   - `pibo debug db stores`
   - `pibo debug db tables <store>`
   - `pibo debug db schema <store>`

3. Tests:
   - Use temp SQLite DBs or fixture paths.
   - Verify missing DB behavior.
   - Verify schema JSON and compact table output.

### Phase 3: Read-only SQL Query

1. Add `src/debug/sql.ts`.
   - Single-statement validation.
   - Read-only statement guard.
   - Limit wrapping.
   - JSON/table formatting.

2. Add command:

```bash
pibo debug db query <store> <sql> [--limit n] [--json]
```

3. Tests:
   - `select` succeeds.
   - `with ... select` succeeds.
   - `insert`, `update`, `delete`, `drop`, `attach`, and multi-statements fail.
   - Default limit is applied.
   - Explicit limit is honored up to max.

### Phase 4: Session Inspector Preset

1. Add `src/debug/session.ts`.
   - Parse Chat Web URLs and direct Pibo Session IDs.
   - Query session store.
   - Query child sessions.
   - Query Chat Web read model status.
   - Optional `--events --limit n`.

2. Command:

```bash
pibo debug session <url-or-pibo-session-id> [--children] [--events] [--limit n] [--json]
```

3. Default behavior:
   - Always show parent session summary.
   - Show child session summary by default with a small limit, because subagent inspection is a primary use case.
   - Do not show event payloads.

4. Tests:
   - Direct `ps_...` lookup.
   - Chat URL parsing.
   - Child subagent metadata extraction.
   - Missing session returns non-zero exit and concise error.

### Phase 5: Documentation And Follow-up

1. Update docs after implementation.
2. Add examples to README.
3. Consider later presets:
   - `pibo debug room <room-id>`
   - `pibo debug agent <profile-name>`
   - `pibo debug run-notifications <pibo-session-id>`
   - `pibo debug transcript <pibo-session-id> --summary` but only after designing transcript size controls.

## Acceptance Criteria

- `pibo debug` follows progressive discovery and does not dump broad project context.
- `pibo debug db schema sessions` shows tables and columns for `.pibo/pibo-sessions.sqlite`.
- `pibo debug db query sessions "select id, profile from pibo_sessions"` runs without external `sqlite3`.
- Mutating SQL is rejected.
- Missing DB files produce actionable messages.
- `pibo debug session /apps/chat/rooms/<roomId>/sessions/<piboSessionId>` prints the session, room match, child subagents, and Chat Web status without full event payloads.
- JSON output is available for agent consumption.
- Existing CLI tests still pass.
- New tests cover schema, query safety, and session inspection.

## Open Questions

- Should `auth` store be included by default, or hidden behind `--include-sensitive-stores` because it may contain auth metadata?
- Should SQL query output redact known sensitive columns by default?
- Should `pibo debug db query` support parameter binding in V1, or is quoted SQL enough for local operator use?
- Should we expose `session-bindings.sqlite` immediately if no current workflow depends on it?
- Should debug CLI commands use `debug` or `inspect` as the top-level namespace? `debug` is clearer for operator diagnostics; `inspect` is slightly safer sounding for read-only behavior.
