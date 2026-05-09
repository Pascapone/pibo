# Debug CLI V2 Cleanup Implementation Plan

Date: 2026-05-09
Status: Planned

## Goal

Bring the Debug CLI in line with the completed Chat Data V2 / unified `pibo.sqlite` cutover.

The Debug CLI should no longer present retired runtime stores as current defaults:

- `pibo-sessions.sqlite`
- `web-chat.sqlite`

It should inspect current production data from `pibo.sqlite` by default, while preserving explicit archive/debug workflows for old database files only when a user intentionally passes a path.

## Non-Goals

- Do not reintroduce runtime fallback to retired databases.
- Do not add legacy import/compare commands back.
- Do not delete archived legacy databases.
- Do not redesign the whole debug command surface.

## Current Findings

Remaining references after the V2 cutover are debug/diagnostic only:

```text
src/debug/stores.ts
src/debug/index.ts
src/debug/trace.ts
src/debug/session.ts
src/debug/events.ts
src/debug/delta-compaction.ts
src/data/cli.ts
```

Tests still create legacy debug fixtures:

```text
test/debug-cli.test.mjs
```

`src/data/cli.ts` still describes old stores for inspection/repair inventory. This must be reviewed separately from runtime behavior; it may keep retired names only if explicitly labelled as archived/legacy inspection.

## Desired End State

### Default debug stores

`pibo debug ...` should default to current stores:

```text
pibo-data   pibo.sqlite        sessions, rooms, events, messages, observations, navigation, stats
reliability pibo-events.sqlite durable jobs / yielded runs / event stream
auth        auth.sqlite
agents      chat-agents.sqlite
bindings    session-bindings.sqlite
```

If the CLI keeps aliases named `sessions` or `chat`, they must point to `pibo.sqlite`, not retired files.

### Retired store handling

Retired stores may be supported only as explicit archive targets, e.g. through a clear path override:

```bash
pibo debug session --store /root/.pibo/legacy-archives/.../web-chat.sqlite.archived-source
```

But default help text must not suggest that retired files are active runtime stores.

### Debug session/trace/events queries

Debug commands that currently read `web_chat_sessions` / `web_chat_events` should query V2 tables:

```text
sessions
session_navigation
session_stats
event_log
chat_messages
observations
principal_session_stats
principal_room_stats
```

Trace/event reconstruction should use `event_log` rows and the existing V2 payload reconstruction rules.

## Implementation Steps

### 1. Inventory and classify debug commands

Run:

```bash
grep -R "web-chat.sqlite\|pibo-sessions.sqlite\|web_chat_events\|web_chat_sessions\|chat_events\|pibo_rooms\|chat_session_reads" -n src/debug src/data test
```

For each hit, classify as:

- current default path that must change
- current V2 query that must be rewritten
- archived/legacy inspection text that may remain but needs explicit labelling
- test fixture that should become V2 fixture

### 2. Update debug store registry

Edit `src/debug/stores.ts`:

- Introduce a canonical `pibo-data` store pointing to `pibo.sqlite`.
- Decide whether to keep `sessions` and `chat` aliases:
  - Preferred: keep aliases temporarily for CLI compatibility, both resolving to `pibo.sqlite`, with descriptions saying they are V2 aliases.
  - Alternative: remove aliases if no user-facing compatibility is needed.
- Update descriptions to avoid implying split stores.

### 3. Update debug help text

Edit `src/debug/index.ts` help/discovery output:

- Replace:

```text
sessions    pibo-sessions.sqlite
chat        web-chat.sqlite
```

with current V2 wording.

Mention retired DBs only under an explicit archive/legacy note, if needed.

### 4. Rewrite session/trace/event debug readers

Edit:

```text
src/debug/session.ts
src/debug/trace.ts
src/debug/events.ts
```

Expected query changes:

- session metadata: `sessions`
- session status/activity: `sessions.status`, `session_stats.status`, `session_navigation.status`
- trace/event stream: `event_log` filtered by `session_id`
- message content: `chat_messages` plus payload refs if needed
- observations/tool traces: `observations`

Use V2 row conversion helpers or add small debug-local converters. Avoid depending on removed legacy adapters.

### 5. Review delta-compaction debug command

Edit `src/debug/delta-compaction.ts`.

Decide whether this command still makes sense after V2:

- If yes, rewrite it to count/delete only V2 delta-like rows in `event_log` by type.
- If no, deprecate/remove the command and update help/tests.

Do not touch runtime compaction behavior.

### 6. Review `pibo data` inventory/repair text

Edit `src/data/cli.ts` only if needed.

The current data CLI still lists retired files in store inventory. Choose one:

- Keep as explicit legacy/archive inventory, labelled retired.
- Remove retired stores from default inventory.
- Add a `legacy` section so agents do not confuse retired files with active runtime stores.

### 7. Update tests

Edit `test/debug-cli.test.mjs`:

- Replace fixture creation of `pibo-sessions.sqlite` and `web-chat.sqlite` with `pibo.sqlite` V2 tables.
- Keep at most one explicit archived legacy-path test if the CLI still supports path-based archive inspection.
- Add regression assertions:
  - default debug help does not mention `web-chat.sqlite` as active
  - default debug help does not mention `pibo-sessions.sqlite` as active
  - debug trace/session/events read from `pibo.sqlite`

### 8. Validate

Run:

```bash
npm run typecheck
npm run build
npm test
```

Optional targeted checks:

```bash
npm run --silent dev -- debug --help
npm run --silent dev -- debug session --help
npm run --silent dev -- debug stores
```

## Acceptance Criteria

- `src/debug/*` default paths no longer point to `web-chat.sqlite` or `pibo-sessions.sqlite`.
- Debug help/discovery presents `pibo.sqlite` as the current source of Chat Web and Pibo Session data.
- Debug session/trace/events commands query V2 tables.
- Tests pass.
- Runtime code remains V2-only and does not regain legacy DB fallback.

## Risks / Notes

- Some debug commands may have been useful specifically for legacy forensic analysis. Preserve that only behind explicit path/archive wording.
- Be careful not to make debug CLI mutate production V2 data unless the existing command is intentionally mutating and documented as such.
- Keep CLI output progressively discoverable and concise.
