# Handover — Pibo Chat Data System V2 Rearchitecture

Date: 2026-05-08  
Branch: `chat-data-v2-rearchitecture-2026-05-08`  
Worktree: `/root/code/pibo-chat-data-v2`  
Commit: `9b52c05 Add chat data V2 store foundation`  
Dev deployment: `https://dev.pibo.neuralnexus.me/apps/chat`

## Purpose

This handover is the starting point for the next implementation session. The architecture plan is still the source of truth:

- `plans/pibo-chat-data-system-final-rearchitecture-plan-2026-05-08.md`

The current session completed the V2 data-store foundation and made the first safe hot-path/API split. The full cutover is **not** complete yet.

## What was implemented

### 1. V2 data store foundation

New modules under `src/data/`:

- `src/data/schema.ts`
  - Idempotent V2 schema creation via `applyPiboDataSchema()`.
  - Includes `sessions`, `rooms`, `room_members`, `payloads`, `event_log`, `chat_messages`, `observations`, stats/navigation tables, indexer offsets, and migration import map.
- `src/data/pibo-store.ts`
  - `PiboDataStore` wrapper around `node:sqlite` `DatabaseSync`.
  - Opens SQLite, applies schema, creates store helpers.
- `src/data/payload-store.ts`
  - Content-addressed payload store.
  - gzip file storage.
  - sha256 dedupe.
  - read JSON/text/bytes.
- `src/data/event-log.ts`
  - Compact V2 event envelope store.
  - Idempotent append through `idempotency_key`.
- `src/data/message-store.ts`
  - Canonical chat message inserts and session listing.
- `src/data/observation-store.ts`
  - Trace/timeline observation inserts and session listing.
- `src/data/navigation-store.ts`
  - Rebuildable navigation projection insert/list.
- `src/data/cli.ts`
  - `pibo data inventory`.
  - Read-only inventory of V2, shadow V2, sessions, chat, reliability, and auth stores.

### 2. CLI wiring

Updated `src/cli.ts`:

- Adds `pibo data` as a progressive-discovery command.
- Root help now lists `data`.

### 3. Hot-path / API split groundwork

Updated `src/apps/chat/web-app.ts`:

- Added `GET /api/chat/navigation`.
  - Returns navigation-compatible data without loading catalog.
  - Does not calculate historical unread counts.
  - Calls `buildSessionNodes(..., { skipPiMetadataFallback: true })` to avoid Pi JSONL fallback.
  - Adds a `server-timing` marker: `navigation;desc="no_catalog_no_unread_no_jsonl"`.
- Added `GET /api/chat/catalog`.
  - Returns the catalog portion that bootstrap still includes today.
  - This is additive; frontend has not yet switched to it.
- Kept legacy `GET /api/chat/bootstrap` compatible.
- Fixed room unread aggregation for child-session unread counts.
  - Child session unread now rolls up to the root session room instead of being ignored by room counts.
- Changed `bootstrap?markRead=true` behavior to mark only the selected session read.
  - This matches the existing test name and avoids unintentionally marking whole child subtrees read.

Updated `src/apps/chat/trace.ts`:

- `buildSessionNodes()` now accepts `{ skipPiMetadataFallback?: boolean }`.
- Navigation can opt out of `SessionManager.list()` / Pi JSONL title fallback.
- Existing callers keep old behavior by default.

### 4. Tests added

New tests:

- `test/data-v2-store.test.mjs`
  - Schema migration idempotency.
  - Payload write/read/dedupe.
  - Event-log idempotent append.
  - Message/observation insert/list.
- `test/data-cli.test.mjs`
  - `pibo data inventory --json` is read-only and reports missing stores.

## Validation completed

### Local/worktree

- `npm run typecheck` ✅
- `npm run build` ✅
- Targeted tests for V2 data store and data CLI ✅
- Full test suite: `npm test` ✅
  - 311 tests passing.

### Docker compute worker

Workers used and released:

- `chat-data-v2-orchestrator`
- `chat-data-v2-impl`
- `chat-data-v2-verify`

Docker validation included:

- Worker image build ✅
- Dev-auth login via curl ✅
- `GET /api/chat/navigation` returned 200 ✅
- `GET /api/chat/catalog` returned 200 ✅
- `pibo data inventory --json` ran inside worker ✅
- Browser Use smoke from host against worker web port:
  - Context-files app opened.
  - Navigated to Chat.
  - Chat UI loaded with dev user.
  - Composer visible. ✅
- MCP CLI smoke inside worker:
  - `pibo mcp config help` ✅
  - `pibo mcp --no-setup` ✅

### Dev gateway

- `./scripts/deploy-web-dev.sh` ✅
- Dev public web app reachable:
  - `https://dev.pibo.neuralnexus.me/apps/chat` ✅
- Health returned:
  - `{"status":"ok","mode":"main"}` ✅

## Current state by plan phase

### Phase 0 — Safety, Inventory, Timing

Status: **partial**

Done:

- `pibo data inventory` exists.
- Store sizes, WAL sizes, integrity check, and known table counts are reported.

Not done:

- Payload size histograms from legacy `payload_json`.
- Missing-title count.
- Sessions-without-room count.
- Duplicate event candidates.
- Full server timing split for bootstrap internals.
- Backup/restore guide and test.

### Phase 1 — Hot-path relief

Status: **partial**

Done:

- Added fast additive `/api/chat/navigation` endpoint that avoids catalog, unread aggregation, and JSONL fallback.
- Catalog can be loaded separately through `/api/chat/catalog`.
- Added skip option for Pi metadata fallback in `buildSessionNodes()`.
- Fixed child-session unread room rollup.

Not done:

- Frontend still primarily uses `/api/chat/bootstrap`.
- Room switch in React UI has not been migrated to `/api/chat/navigation`.
- Bootstrap still includes catalog and unread calculation for compatibility.
- No dedicated spy test yet proving `/api/chat/navigation` never calls `SessionManager.list()` or `countUnreadMessagesBySession()`.

### Phase 2 — V2 Store and Payload Store

Status: **foundation complete**

Done:

- V2 schema and store wrappers implemented.
- Payload store implemented and tested.
- Event-log idempotency implemented and tested.
- Message and observation stores implemented and tested.
- Navigation store implemented.

Not done:

- Store is not wired into live chat ingest yet.
- No `session-store.ts`, `room-store.ts`, `stats-store.ts`, `indexer.ts`, `legacy-importer.ts`, or `legacy-compare.ts` yet.
- Existing legacy stores remain primary.

### Phase 3 — Shadow Ingest and Projector

Status: **not started**

Next major implementation target.

Required next work:

- Build central ingest service.
- Wire user-message shadow writes in `sendChatMessage()`.
- Wire router/output shadow writes near `ensureEventIndexing()` / compactor output.
- Externalize large payloads into `PayloadStore`.
- Project to `event_log`, `chat_messages`, `observations`, stats, and navigation.
- Add shadow compare/debug command.

### Phase 4+ — Backfill, primary reads, trace cutover, cleanup

Status: **not started**

Do not start primary read cutover until Phase 3 shadow writes and compare tooling are stable.

## Important files for next session

### Architecture / planning

- `plans/pibo-chat-data-system-final-rearchitecture-plan-2026-05-08.md`
- This handover: `handoffs/pibo-chat-data-v2-rearchitecture-handover-2026-05-08.md`

### V2 store code

- `src/data/schema.ts`
- `src/data/pibo-store.ts`
- `src/data/payload-store.ts`
- `src/data/event-log.ts`
- `src/data/message-store.ts`
- `src/data/observation-store.ts`
- `src/data/navigation-store.ts`
- `src/data/cli.ts`

### Current chat hot paths

- `src/apps/chat/web-app.ts`
  - `/api/chat/bootstrap`
  - `/api/chat/navigation`
  - `/api/chat/catalog`
  - `sendChatMessage()`
  - `ensureEventIndexing()`
  - `buildSessionUnreadCounts()`
  - `buildRoomUnreadCounts()`
- `src/apps/chat/trace.ts`
  - `buildSessionNodes()`
  - JSONL/Pi metadata fallback paths.
- `src/apps/chat/event-log.ts`
  - legacy `chat_events`.
- `src/apps/chat/read-model.ts`
  - legacy `web_chat_events` and session index.
- `src/apps/chat/output-compactor.ts`
  - final durable assistant/tool output compaction.
- `src/reliability/store.ts`
  - currently still stores reliability events; avoid adding chat payload copies.

### Frontend follow-up files

- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/cache.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/types.ts`

## Recommended next implementation sequence

1. **Add tests for `/api/chat/navigation` contract.**
   - File: `test/web-channel.test.mjs`.
   - Assert response contains rooms/sessions/selected ids.
   - Assert response does not include catalog payload.
   - Add spy/mocking if practical to prove no `SessionManager.list()` and no `countUnreadMessagesBySession()`.

2. **Move React room switch/navigation to `/api/chat/navigation`.**
   - Keep bootstrap compatibility.
   - Add `getNavigation()` to `src/apps/chat-ui/src/api.ts`.
   - Reuse or formalize existing `SessionNavigationData` in `cache.ts`.
   - Ensure room switch does not reload trace/catalog.

3. **Introduce `src/data/ingest-service.ts`.**
   - Normalize user input and Pibo output events.
   - Accept optional feature flags/env mode.
   - Write V2 shadow rows only; do not break legacy writes.

4. **Wire user-message shadow ingest.**
   - Entry: `sendChatMessage()` in `src/apps/chat/web-app.ts`.
   - Write:
     - `event_log` envelope.
     - `chat_messages` row.
     - optional `observations` row.
     - payload store when content exceeds threshold.
   - Must be idempotent by `clientTxnId` / event id.

5. **Wire assistant/tool output shadow ingest.**
   - Entry: `ensureEventIndexing()` and/or `OutputCompactor` output.
   - Use only durable/final events for `chat_messages`.
   - Use `observations` for trace/tool/run/errors/model timeline.
   - Do not store large full payloads inline in hot tables.

6. **Add compare/debug tooling.**
   - `pibo data compare` or `pibo debug trace --source v2|legacy|diff` later.
   - Start with simple counts by session: legacy events vs V2 events/messages/observations.

7. **Only after shadow writes are reliable:** start backfill/importer work.

## Acceptance criteria for next session

Minimum useful follow-up:

- `/api/chat/navigation` has explicit tests.
- React room switch uses `/api/chat/navigation` or a clearly staged cache helper.
- V2 ingest service exists with unit/integration tests.
- New user messages appear in both legacy and V2 when shadow mode is enabled.
- Full test suite passes before dev deploy.
- Docker Browser Use smoke confirms refresh, room switch, session select.
- MCP CLI still works (`pibo mcp config help`, `pibo mcp --no-setup`).

## Known caveats / risks

- The V2 schema is implemented but still isolated; it is not primary and not live-ingested.
- `pibo data inventory` currently reports counts for known tables only; it does not yet calculate legacy payload histograms or duplicate candidates.
- `GET /api/chat/navigation` is additive. The UI still uses bootstrap for most flows.
- Bootstrap remains heavy by design for compatibility until the UI split lands.
- Dev deployment happened, but production deployment has **not** been done and needs explicit user approval.
- Host production gateway was not restarted.

## Suggested subagent split for next session

- Explorer A: verify all frontend bootstrap dependencies and design exact `getNavigation()`/query-key migration.
- Worker A: implement navigation API tests and frontend navigation fetch.
- Worker B: implement `ingest-service.ts` and unit tests.
- Worker C: wire `sendChatMessage()` shadow ingest and idempotency tests.
- Explorer B: map assistant/tool output event shapes from `OutputCompactor` to V2 `chat_messages` vs `observations`.

## Commands useful for follow-up

```bash
cd /root/code/pibo-chat-data-v2
git status --short
git log --oneline -3
npm run typecheck
npm run build
node --test test/data-v2-store.test.mjs test/data-cli.test.mjs
npm test
npm run --silent dev -- compute spawn --name chat-data-v2-followup
./scripts/deploy-web-dev.sh
```
