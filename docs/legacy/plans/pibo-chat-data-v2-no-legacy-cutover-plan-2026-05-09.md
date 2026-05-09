# Pibo Chat Data V2 — No-Legacy Cutover Plan

Date: 2026-05-09

## Context

We previously treated the current host gateway as “production.” Operationally, it is the live instance, but it is not yet a hard production environment with strict backwards-compatibility requirements. That changes the migration strategy.

Instead of running a long legacy-plus-shadow period, we can perform a direct cutover to the V2 chat data system and remove the legacy Chat Web data path.

This plan describes the complete migration to a V2-only Chat Web data system.

## Goal

Make `~/.pibo/pibo.sqlite` the primary and only Chat Web data store for:

- rooms,
- Pibo sessions metadata needed by Chat Web,
- chat messages,
- event envelopes,
- trace observations,
- navigation/read models,
- unread state,
- payload references.

Legacy Chat Web stores should no longer be required for normal app behavior.

## Non-Goals

- Do not migrate Better Auth into `pibo.sqlite`; `auth.sqlite` remains owned by Better Auth.
- Do not remove Pi JSONL compatibility where Pi Coding Agent still needs it.
- Do not migrate jobs/runs/reliability infrastructure unless needed for Chat Web V2 reads.
- Do not preserve the legacy code path indefinitely.

## Target Architecture

### Primary Store

```text
~/.pibo/pibo.sqlite
```

Primary V2 tables:

- `sessions`
- `rooms`
- `chat_messages`
- `event_log`
- `observations`
- `payloads`
- `session_navigation`

Large payloads live outside SQLite and are referenced by hash/path metadata.

### Legacy Stores After Cutover

Legacy stores become migration inputs only:

```text
~/.pibo/web-chat.sqlite        migration input / backup only
~/.pibo/pibo-sessions.sqlite   compatibility input until session store is unified
~/.pi/agent/sessions/*.jsonl   Pi compatibility / import source only
```

Normal Chat Web must not depend on `web-chat.sqlite` after cutover.

## Migration Strategy

Because this is not a strict production environment, use a staged but decisive cutover:

1. Finish V2 read/write implementation.
2. Backfill existing legacy data into V2.
3. Switch Chat Web reads and writes to V2 by default.
4. Keep legacy files as backup, not as active fallback.
5. Remove or quarantine legacy Chat Web paths.

Avoid a long dual-write period unless a specific test requires it.

## Phase 0 — Backup and Baseline

### Work

1. Stop or pause active Chat Web writes if possible.
2. Backup current state:

```bash
mkdir -p ~/.pibo/backups/chat-v2-cutover-$(date +%Y%m%d-%H%M%S)
cp -a ~/.pibo/web-chat.sqlite* ~/.pibo/backups/chat-v2-cutover-*/ 2>/dev/null || true
cp -a ~/.pibo/pibo-sessions.sqlite* ~/.pibo/backups/chat-v2-cutover-*/ 2>/dev/null || true
cp -a ~/.pibo/pibo.sqlite* ~/.pibo/backups/chat-v2-cutover-*/ 2>/dev/null || true
```

3. Record inventory:

```bash
npm run --silent dev -- data inventory --json > reports/chat-data-inventory-before-v2-cutover.json
```

4. Record gateway status and current commit.

### Acceptance Criteria

- Backup exists.
- Inventory report exists.
- Current app still starts before migration work begins.

## Phase 1 — Complete V2 Write Path

### Work

Make all Chat Web writes go to V2 directly.

Required write paths:

- user message accepted,
- assistant final message,
- assistant/tool/reasoning trace events,
- tool calls and tool results,
- yielded run events,
- errors,
- session create/rename/archive/delete,
- room create/rename/archive/delete,
- mark read/unread,
- model/profile metadata updates used by Chat Web.

Current shadow-ingest code should become the primary write path. Legacy write code should either be removed or moved behind a temporary `legacy-import` utility.

### Code Areas

- `src/apps/chat/web-app.ts`
- `src/data/ingest-service.ts`
- `src/data/*-store.ts`
- `src/sessions/store.ts` if session ownership remains split
- tests under `test/data-*.test.mjs` and `test/web-channel.test.mjs`

### Acceptance Criteria

- Sending a message writes complete V2 data.
- Tool calls and assistant output appear in V2.
- Session navigation data updates from V2 writes.
- Mark-read state is stored in V2 or in a V2-owned read model.
- Tests can run without `web-chat.sqlite` as an active dependency.

## Phase 2 — Complete V2 Read Path

### Work

Move Chat Web read endpoints to V2.

Endpoints to convert:

- `GET /api/chat/bootstrap`
- `GET /api/chat/navigation`
- `GET /api/chat/sessions`
- `GET /api/chat/trace/summary`
- `GET /api/chat/trace`
- `GET /api/chat/events` catch-up where durable history is needed
- room APIs where room data is still legacy-backed

### Read Model Rules

- Navigation reads from `session_navigation`.
- Chat history reads from `chat_messages`.
- Trace reads from `observations` plus bounded event pages.
- Raw debug event views read from `event_log` pages.
- Large content resolves through payload refs.

### Acceptance Criteria

- Chat Web works after moving `web-chat.sqlite` aside.
- Initial app load works.
- Session switch works.
- Room switch works.
- Trace view works.
- Raw events work.
- Archived sessions work.
- Unread counts work.

## Phase 3 — Legacy Importer / Backfill

### Work

Build an idempotent importer from legacy stores into V2.

Inputs:

- `web-chat.sqlite`
- `pibo-sessions.sqlite`
- Pi JSONL files where legacy DB lacks complete history

Importer command proposal:

```bash
npm run --silent dev -- data import legacy-chat --from ~/.pibo --to ~/.pibo/pibo.sqlite --json
```

Importer requirements:

- idempotent,
- repeatable,
- safe to interrupt and rerun,
- preserves session ids,
- preserves room ids where possible,
- dedupes by event id / stream id / message id / idempotency key,
- externalizes large payloads,
- rebuilds `session_navigation`,
- records import stats.

### Acceptance Criteria

- Running importer twice does not duplicate data.
- Existing sessions appear in Chat Web after cutover.
- Existing traces are visible.
- Import report shows counts by source and target table.

## Phase 4 — Compare and Validate

### Work

Expand compare tooling beyond counts.

Command proposal:

```bash
npm run --silent dev -- data compare legacy-v2 --session <id> --json
```

Compare:

- message count,
- roles,
- previews,
- timestamps,
- event types,
- tool call ids,
- run ids,
- payload refs,
- missing or duplicate events,
- navigation title/status/last activity.

### Acceptance Criteria

- Compare output can explain differences.
- Known acceptable differences are listed explicitly.
- Unexpected mismatches block cutover.

## Phase 5 — Cutover Flag and Default

### Work

Add a short-lived runtime mode flag:

```text
PIBO_CHAT_DATA_MODE=v2
```

Allowed values during migration:

```text
legacy
v2
```

Default should become `v2` once tests pass.

Do not keep this as a permanent product mode. It exists to make rollout and rollback explicit while we finish removal.

### Acceptance Criteria

- `PIBO_CHAT_DATA_MODE=v2` uses V2 reads and writes.
- Moving `web-chat.sqlite` away does not break Chat Web in V2 mode.
- Legacy mode is only used for one release cycle or local emergency checks.

## Phase 6 — Deploy V2-Only to Live Host

### Work

1. Backup live host data.
2. Deploy V2 code to dev.
3. Run importer on dev/live data copy if available.
4. Validate with Browser Use:
   - app load,
   - session switch,
   - room switch,
   - archived sessions,
   - trace load older,
   - raw events,
   - send message,
   - tool call run.
5. Deploy to live host.
6. Restart gateway.
7. Run health and smoke checks.

### Acceptance Criteria

- Health check passes.
- User can send and receive messages.
- New messages persist after restart.
- Old imported sessions are visible.
- No reads from `web-chat.sqlite` during normal operation.

## Phase 7 — Remove Legacy Chat Web Path

### Work

After V2-only mode is stable:

- Remove legacy Chat Web read/write code.
- Remove shadow-write feature flag.
- Remove legacy bootstrap/session read-model dependencies.
- Keep importer under `data import legacy-chat` for a while.
- Keep backup docs.
- Update docs to say V2 is primary.

### Acceptance Criteria

- Codebase has one Chat Web data path.
- Tests do not need legacy Chat Web DB setup except importer tests.
- Documentation no longer describes shadow write as the normal next step.

## Phase 8 — Frontend Cleanup After V2

### Work

With V2 as primary, simplify frontend payloads:

- Bootstrap returns small metadata only.
- Navigation returns small selected-room/session metadata only.
- Sidebar always uses session pages.
- Trace always uses cursor pages.
- Raw events always use bounded debug pages.

### Acceptance Criteria

- Full bootstrap/navigation object caching is unnecessary.
- Query cache contains only small metadata and pages.
- No full session tree rehydrate path remains.

## Testing Plan

### Unit / Integration

Run before every cutover attempt:

```bash
npm run typecheck
npm test
```

Add focused tests for:

- V2 message writes,
- V2 assistant/tool writes,
- V2 trace reads,
- V2 navigation reads,
- legacy importer idempotency,
- compare mismatch reporting,
- Chat Web without `web-chat.sqlite`.

### Browser Smoke

Required scenarios:

- initial load,
- new message,
- assistant response,
- tool call streaming,
- session switch,
- room switch,
- archived sessions,
- load more sessions,
- load older trace history,
- raw events panel,
- restart gateway and verify persistence.

### Performance

Run:

```bash
node scripts/chat-web-performance-check.mjs --cdp-url <target> --url <chat-url>
```

Keep max long task below agreed threshold.

## Rollback Plan

Before legacy removal, rollback is:

1. Stop gateway.
2. Restore backup files.
3. Set `PIBO_CHAT_DATA_MODE=legacy` if still available.
4. Restart gateway.

After legacy removal, rollback is:

1. Restore previous git/stable backup.
2. Restore legacy DB backup.
3. Restart gateway.

Because this environment is not strict production, rollback can be operational rather than transparent, but backups are still mandatory.

## Risks

### Data loss

Mitigation:

- backup first,
- idempotent importer,
- compare before cutover,
- keep legacy DB read-only backup.

### Missing trace events

Mitigation:

- compare event types,
- test tool/run/error flows,
- keep raw event pages available.

### Navigation mismatch

Mitigation:

- rebuild `session_navigation` during import,
- test rooms, archives, unread counts.

### Hidden dependency on Pi JSONL

Mitigation:

- test with `web-chat.sqlite` moved away,
- log any Pi JSONL fallback during Chat Web requests,
- remove fallback from normal V2 path.

## Suggested Implementation Order

1. Add `PIBO_CHAT_DATA_MODE=v2` plumbing.
2. Complete V2 write path for all Chat Web mutations/events.
3. Implement V2 read path endpoint by endpoint.
4. Add legacy importer.
5. Add expanded compare.
6. Validate with legacy DB moved aside.
7. Deploy V2-only mode.
8. Remove legacy Chat Web code after stability window.

## Definition of Done

This migration is complete when:

- Chat Web starts with no active dependency on `web-chat.sqlite`.
- New chats persist only through V2 data stores.
- Existing legacy chats are imported into V2.
- Trace, navigation, rooms, sessions, unread counts, and raw debug views read from V2.
- Full test suite passes.
- Browser smoke passes after gateway restart.
- Legacy Chat Web code is removed or quarantined behind importer-only commands.
- Documentation names V2 as the primary Chat Web data system.
