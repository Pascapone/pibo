# Handover — Pibo Chat Data System V2 Follow-up: Navigation Split + User Shadow Ingest

Date: 2026-05-08  
Branch: `chat-data-v2-followup-navigation-ingest-2026-05-08`  
Worktree: `/root/code/pibo-chat-data-v2`  
Base commit before this session: `2d592ea Document chat data V2 handover`  
Status: changes are implemented and validated, not committed in this handover snapshot.  
Source plan: `plans/pibo-chat-data-system-final-rearchitecture-plan-2026-05-08.md`

## Purpose

This handover is the next starting point. The session advanced the plan from the V2 store foundation to:

1. Frontend use of the fast navigation endpoint for room/navigation refreshes.
2. V2 shadow ingest for accepted user messages behind a feature flag.

The full data-system cutover is still incomplete. Legacy stores remain primary for normal Chat Web reads and runtime behavior.

## What was implemented in this session

### 1. Frontend navigation split

Updated files:

- `src/apps/chat-ui/src/types.ts`
  - Added `NavigationData`.
  - `BootstrapData` now extends `NavigationData` with catalog/capability fields.
- `src/apps/chat-ui/src/api.ts`
  - Added `getNavigation()` for `GET /api/chat/navigation`.
  - Shared navigation query-param creation between bootstrap and navigation.
  - Added `normalizeNavigation()` and reused it from `normalizeBootstrap()`.
- `src/apps/chat-ui/src/cache.ts`
  - Navigation cache helpers now accept `NavigationData`.
  - Navigation query key includes selected session id to avoid stale room/session combinations.
- `src/apps/chat-ui/src/App.tsx`
  - Added `loadNavigationQueryData()`.
  - Added `mergeNavigationIntoBootstrap()` so catalog/settings data remain available while navigation updates can be small.
  - Room switch now calls `/api/chat/navigation` instead of `/api/chat/bootstrap`.
  - SSE navigation refresh now calls `/api/chat/navigation` instead of `/api/chat/bootstrap`.
  - Initial route/bootstrap and session select still use bootstrap because mark-read is still bootstrap-coupled.

### 2. Navigation API contract test

Updated:

- `test/web-channel.test.mjs`

Added test:

- `chat navigation returns sidebar data without catalog payload`

It verifies:

- `/api/chat/navigation` returns identity/session/room/sidebar data.
- `server-timing` contains the navigation marker.
- catalog-heavy fields are absent:
  - `agents`
  - `customAgents`
  - `modelCatalog`
  - `agentCatalog`
  - `capabilities`

### 3. V2 user-message shadow ingest service

New file:

- `src/data/ingest-service.ts`

Implemented `ChatDataIngestService.ingestUserMessageAccepted()`.

It writes, in a V2 transaction:

- `sessions`
- `event_log`
- `chat_messages`
- `session_navigation`
- `payloads` for large text payloads over 16 KiB

Idempotency rule:

- User-message accepted events dedupe on `clientTxnId` using an `idempotency_key` shaped as:
  - `chat:user.accepted:${roomId}:${actorId}:${clientTxnId}`
- The V2 message id is deterministic for idempotent client transactions.
- If there is no `clientTxnId`, the service still writes but cannot guarantee retry dedupe.

Payload rule:

- Small message text is stored inline in `attributes.inlineText` for this shadow phase.
- Large message text is externalized to `PayloadStore` and referenced by `content_payload_ref` / `payload_ref`.

### 4. Chat Web integration for user-message shadow writes

Updated:

- `src/apps/chat/web-app.ts`

Changes:

- Added optional `ChatWebAppOptions`:
  - `dataStorePath?: string`
  - `dataPayloadRootDir?: string`
  - `dataV2Write?: boolean`
- Added environment feature flag:
  - `PIBO_DATA_V2_WRITE=1|user|all`
- State can now own:
  - `dataStore?: PiboDataStore`
  - `ingestService?: ChatDataIngestService`
- `sendChatMessage()` now performs V2 shadow ingest immediately after the legacy `user.message.accepted` event is appended and before live listeners/emit.
- Shadow-ingest failures are caught and logged with `console.warn`; legacy message send remains primary and should continue.

### 5. V2 ingest tests

New file:

- `test/data-v2-ingest-service.test.mjs`

Tests:

- `chat data ingest writes user messages idempotently`
  - verifies one V2 event/message/navigation/session after duplicate ingest with same `clientTxnId`.
- `chat data ingest externalizes large user message payloads`
  - verifies large text goes through `PayloadStore` and is readable back.

Updated:

- `test/web-channel.test.mjs`

Added integration test:

- `chat web app shadows user messages into the V2 data store`

It starts Chat Web with `dataV2Write: true`, sends the same `clientTxnId` twice, and verifies exactly one V2 `event_log` row and one V2 `chat_messages` row.

## Validation completed

### Local/worktree

- `npm run typecheck` ✅
- `npm run build` ✅
- `node --test test/data-v2-ingest-service.test.mjs test/web-channel.test.mjs` ✅
- `node --test test/data-v2-ingest-service.test.mjs` ✅ after fixing test payload temp dir behavior
- Full test suite: `npm test` ✅
  - 315 tests passing.

### Docker compute workers

Workers spawned and released:

- `chat-data-v2-followup`
- `chat-data-v2-followup-verify`
- `chat-data-v2-ingest-verify`

Docker validation included:

- Worker image build ✅
- `npm run typecheck` inside worker ✅
- `pibo data inventory --json` inside worker ✅
- MCP CLI smoke inside worker:
  - `pibo mcp config help` ✅
  - `pibo mcp --no-setup` ✅
- Dev-auth curl against worker:
  - `/api/auth/session` returns Dev User ✅
  - `GET /api/chat/navigation` returns 200 ✅
  - `GET /api/chat/catalog` returns 200 ✅
  - navigation response contains no catalog keys ✅
- Browser Use smoke against worker web port:
  - Chat UI opened with dev-auth session ✅
  - Dev user active ✅
  - Created/loaded a test room ✅
  - Room switch network resources included `/api/chat/navigation?...` and did not reload `/api/chat/bootstrap` ✅

## Current state by plan phase

### Phase 0 — Safety, Inventory, Timing

Status: **partial**

Still unchanged from previous handover:

- `pibo data inventory` exists.
- Additional inventory metrics are still missing:
  - legacy `payload_json` histograms
  - missing-title counts
  - sessions-without-room counts
  - duplicate event candidates
  - backup/restore guide and test

### Phase 1 — Hot-path relief

Status: **mostly complete for navigation split, still partial overall**

Done in this session:

- `/api/chat/navigation` has an explicit contract test.
- Frontend room switch uses `/api/chat/navigation`.
- SSE-driven navigation refresh uses `/api/chat/navigation`.
- Browser smoke confirmed room switch requests `/api/chat/navigation` instead of `/api/chat/bootstrap`.

Still not done:

- Initial bootstrap remains heavy.
- Session select still uses bootstrap because mark-read remains coupled to bootstrap.
- Catalog is not yet fully loaded through a separate frontend catalog path.
- No spy test yet proving `/api/chat/navigation` never calls `SessionManager.list()` or `countUnreadMessagesBySession()`.

### Phase 2 — V2 Store and Payload Store

Status: **foundation complete plus first ingest service**

Done:

- Store foundation from previous session.
- New `ChatDataIngestService` for accepted user messages.
- Large user-message payload externalization through `PayloadStore`.

Still not done:

- No dedicated `session-store.ts`, `room-store.ts`, `stats-store.ts`, `indexer.ts`, `legacy-importer.ts`, or `legacy-compare.ts` yet.
- `ChatDataIngestService` currently contains direct SQL for `sessions` until a dedicated session store exists.

### Phase 3 — Shadow Ingest and Projector

Status: **started**

Done:

- User-message shadow writes from `sendChatMessage()` behind `PIBO_DATA_V2_WRITE` / `dataV2Write`.
- Idempotency by `clientTxnId`.
- Unit and HTTP integration tests for user-message shadow writes.

Still not done:

- Assistant/tool/run output shadow writes from `ensureEventIndexing()` / `OutputCompactor`.
- Observations projection for trace/tool/run/error/model timeline.
- Stats projection updates.
- Shadow compare/debug command.

### Phase 4+ — Backfill, primary reads, trace cutover, cleanup

Status: **not started**

Do not start primary read cutover until Phase 3 shadow writes and compare tooling are stable.

## Important files for next session

### Planning / handovers

- `plans/pibo-chat-data-system-final-rearchitecture-plan-2026-05-08.md`
- Previous handover: `handoffs/pibo-chat-data-v2-rearchitecture-handover-2026-05-08.md`
- This handover: `handoffs/pibo-chat-data-v2-followup-navigation-ingest-handover-2026-05-08.md`

### New / changed backend files

- `src/data/ingest-service.ts`
- `src/apps/chat/web-app.ts`
- `src/data/pibo-store.ts`
- `src/data/event-log.ts`
- `src/data/message-store.ts`
- `src/data/payload-store.ts`
- `src/data/navigation-store.ts`

### Changed frontend files

- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/cache.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/types.ts`

### Tests

- `test/data-v2-ingest-service.test.mjs`
- `test/web-channel.test.mjs`
- Existing V2 store tests: `test/data-v2-store.test.mjs`, `test/data-cli.test.mjs`

## Recommended next implementation sequence

1. **Review and commit current changes.**
   - Confirm diff is acceptable.
   - Commit current branch or merge as appropriate.

2. **Add a spy-style navigation regression test if practical.**
   - Prove `/api/chat/navigation` does not call Pi JSONL fallback / `SessionManager.list()`.
   - Prove it does not call historical unread aggregation.

3. **Decouple mark-read from bootstrap.**
   - Add a small endpoint such as `POST /api/chat/read` or `POST /api/chat/sessions/:id/read`.
   - Then move session select to `/api/chat/navigation` as well.

4. **Assistant/tool/run shadow ingest.**
   - Entry points:
     - `ensureEventIndexing()` in `src/apps/chat/web-app.ts`
     - possibly `OutputCompactor` final durable output path
   - Use `event.eventId` as output-path idempotency key.
   - Store final assistant messages in `chat_messages`.
   - Store trace/tool/run/error/model timeline in `observations`.
   - Avoid large inline payloads.

5. **Factor direct session SQL into `src/data/session-store.ts`.**
   - Current `ChatDataIngestService` directly upserts `sessions`.
   - Move that behind a store before expanding ingest too far.

6. **Add shadow compare/debug tooling.**
   - Start simple:
     - counts by session for legacy `chat_events` vs V2 `event_log` / `chat_messages` / `observations`.
   - Suggested command:
     - `pibo data compare --session <id> --json`

7. **Only after shadow compare is stable:** legacy backfill/importer and primary read experiments.

## Known caveats / risks

- The branch currently has uncommitted changes.
- V2 user-message ingest is shadow-only and feature-flagged.
- Legacy writes and legacy reads remain primary.
- `ChatDataIngestService` currently uses direct SQL for `sessions` and sequence allocation.
- Session select still uses bootstrap because mark-read is still tied to bootstrap.
- Shadow ingest logs failures but does not expose metrics yet.
- `observations` are not written by user-message ingest yet.
- Assistant/tool/run output shadow ingest has not started.
- No dev deploy was done in this session.
- Production deploy was not done and still requires explicit approval.

## Useful commands for next session

```bash
cd /root/code/pibo-chat-data-v2
git status --short --branch
git diff --stat
git diff -- src/data/ingest-service.ts src/apps/chat/web-app.ts test/web-channel.test.mjs
npm run typecheck
npm run build
node --test test/data-v2-ingest-service.test.mjs test/web-channel.test.mjs
npm test
npm run --silent dev -- compute spawn --name chat-data-v2-next
```

## Suggested subagent split for next session

- Explorer A: map output event shapes from `ensureEventIndexing()` and `OutputCompactor` to V2 `chat_messages` vs `observations`.
- Worker A: add `session-store.ts` and move direct session SQL out of `ingest-service.ts`.
- Worker B: implement assistant-message shadow ingest and tests.
- Worker C: implement tool/run/error observation shadow ingest and tests.
- Explorer B: design `pibo data compare` output and compare queries.

---

## Continuation update — 2026-05-08 after final implementation pass

Additional work completed after this handover was first written:

- Session selection was moved off bootstrap when navigation state is already loaded:
  - session click now calls `POST /api/chat/sessions/:id/read`
  - then `GET /api/chat/navigation?...`
  - Browser Use verified no `/api/chat/bootstrap` request during session switch in the loaded app.
- Added `src/data/session-store.ts` and wired it into `PiboDataStore`.
- Expanded `ChatDataIngestService` to shadow persisted output events:
  - V2 `event_log` rows for persisted output events.
  - V2 `chat_messages` rows for final `assistant_message` output.
  - V2 `observations` rows for assistant/tool/run/error-style output.
- Added `pibo data compare --session <id> --json` for legacy-vs-V2 count comparison.
- Added tests for:
  - assistant output shadow ingest idempotency
  - tool output observation ingest
  - Chat Web output shadow ingest
  - read endpoint behavior
  - data compare CLI

Final validation before dev deploy:

- `npm run typecheck` ✅
- `npm run build` ✅
- `npm test` ✅ — 320 tests passing
- Docker compute build/spawn ✅
- Docker CLI smoke:
  - `pibo data inventory --json` ✅
  - `pibo data compare --session ps_missing --json` ✅
  - `pibo mcp config help` ✅
  - `pibo mcp --no-setup` ✅
- Browser Use smoke against Docker worker ✅
  - Chat loaded with Dev User
  - session switch used `/api/chat/sessions/:id/read` and `/api/chat/navigation?...`
  - no `/api/chat/bootstrap` request during session switch
- Dev deploy completed:
  - `./scripts/deploy-web-dev.sh` ✅
  - `https://dev.pibo.neuralnexus.me/apps/chat` reachable ✅

Remaining before V2 primary cutover:

- Legacy backfill/importer.
- V2 primary reads for trace/history/navigation.
- Broader shadow compare beyond count-level session comparison.
- Metrics/observability for shadow ingest failures.
- Production deploy requires explicit approval.
