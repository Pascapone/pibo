# Chat Data V2 Cleanup and Pibo Session Unification Plan

Date: 2026-05-09  
Scope: Chat Web data system cleanup after the V2-only production cutover  
Status: proposed implementation plan

## Purpose

Chat Web now runs on Chat Data V2 in production. The runtime no longer opens `web-chat.sqlite`, and the legacy mode flags are gone. The next step is to remove the remaining legacy shape from code, tests, and operator docs so future features can build on a clean V2 model.

This plan covers six cleanup items plus the larger Pibo Session unification work:

1. Mark old reports and plans as superseded.
2. Archive legacy Chat Web database files without deleting backups.
3. Extract shared interfaces from legacy store files.
4. Remove or quarantine legacy runtime store classes.
5. Add guardrails against legacy storage reintroduction.
6. Build new features against V2-native APIs instead of old adapter surfaces.
7. Unify the active Pibo Session store into `pibo.sqlite`.

## Current State

Production runs the V2 Chat Web data path:

```text
Chat Web API
  -> ChatDataIngestService
  -> PiboDataStore / ~/.pibo/pibo.sqlite
      - sessions
      - rooms
      - room_members
      - event_log
      - chat_messages
      - observations
      - session_navigation
      - payloads
```

The live gateway process opens `pibo.sqlite`, `pibo-sessions.sqlite`, and `auth.sqlite`. It does not open `web-chat.sqlite`.

The remaining active split is the Pibo Session store:

```text
Runtime session source of truth:  ~/.pibo/pibo-sessions.sqlite
Chat Data V2 projection:          ~/.pibo/pibo.sqlite:sessions
Navigation projection:            ~/.pibo/pibo.sqlite:session_navigation
```

The remaining legacy Chat Web database exists only as an old data source and backup:

```text
~/.pibo/web-chat.sqlite
~/.pibo/web-chat.sqlite-wal
~/.pibo/web-chat.sqlite-shm
```

## Non-Goals

- Do not delete backup data.
- Do not remove Pi Coding Agent JSONL transcripts.
- Do not change auth storage.
- Do not redesign the Chat UI.
- Do not remove gateway protocol compatibility named `legacy-all`; that term belongs to network subscription compatibility, not the Chat Web legacy database.
- Do not merge the reliability store in this pass unless it blocks Pibo Session unification.

## Definitions

**Legacy Chat Web data system** means `web-chat.sqlite` plus the old `ChatEventLog`, `ChatWebReadModel`, and `PiboRoomStore` runtime classes.

**V2 data system** means `PiboDataStore` and its stores over `pibo.sqlite`.

**Pibo Session unification** means the product-level `PiboSessionStore` reads and writes the V2 `sessions` table in `pibo.sqlite` instead of `pibo-sessions.sqlite`.

## Target Architecture

After this cleanup, normal Chat Web and the gateway should use this model:

```text
PiboDataStore (~/.pibo/pibo.sqlite)
  sessions              authoritative Pibo Session rows
  rooms                 room records
  room_members          room membership
  event_log             durable ordered event stream
  chat_messages         materialized chat messages
  observations          trace/tool/run/materialized observations
  session_navigation    sidebar/navigation projection
  payloads              large payload storage

ChatDataIngestService
  owns message/output ingest transactions

V2 Query Services
  own reads for bootstrap, navigation, trace, rooms, unread counts

Legacy Import Tools
  read archived legacy files only when explicitly called
```

No runtime code should instantiate a class whose default path is `web-chat.sqlite`.

## Phase 0 — Safety Baseline

Before changing code, capture the current deployed state.

### Tasks

1. Record production status:

```bash
npm run --silent dev -- gateway web status
curl -fsS http://127.0.0.1:4788/health
```

2. Record data inventory:

```bash
npm run --silent dev -- data inventory --json \
  > reports/chat-data-v2-cleanup-baseline-inventory-2026-05-09.json
```

3. Record open database files for the gateway process:

```bash
pid=$(systemctl show -p MainPID --value pibo-web)
ls -l /proc/$pid/fd > reports/chat-data-v2-cleanup-baseline-fds-2026-05-09.txt
```

4. Verify no legacy mode flags remain in live config or source:

```bash
rg "PIBO_CHAT_DATA_MODE|PIBO_DATA_V2_WRITE" src test scripts .github systemd 2>/dev/null || true
```

### Acceptance Criteria

- Production is healthy before changes.
- Baseline reports exist.
- The gateway process does not open `web-chat.sqlite`.
- No active config sets `PIBO_CHAT_DATA_MODE` or `PIBO_DATA_V2_WRITE`.

## Phase 1 — Mark Superseded Documents

Old documents still describe the shadow-write and legacy-primary stages. Keep them for history, but make their status explicit.

### Files to Mark

- `reports/2026-05-08-chat-data-v2-production-deploy-report.md`
- `reports/2026-05-08-chat-data-v2-followup-abschlussbericht.md`
- `handoffs/pibo-chat-data-v2-followup-navigation-ingest-handover-2026-05-08.md`
- `plans/pibo-chat-data-system-final-rearchitecture-plan-2026-05-08.md`
- `plans/chat-web-performance-05-frontend-trace-transforms.md`

### Tasks

1. Add a short `Superseded by` note at the top of the first four files:

```md
> Status: Superseded for runtime decisions. Chat Web was cut over to V2-only on 2026-05-09. Use `plans/2026-05-09-chat-data-v2-cleanup-and-session-unification-plan.md` and the final V2 removal report for current architecture.
```

2. For `chat-web-performance-05-frontend-trace-transforms.md`, add a narrower note:

```md
> Status: Still relevant for frontend trace performance. Data-system assumptions that mention legacy stores are superseded by the V2-only cutover.
```

3. Add a current architecture index section to the final report or a new small report:

```text
Current authoritative docs:
- final V2 removal report
- this cleanup and session unification plan
- current data inventory report
```

### Acceptance Criteria

- Historical docs no longer look like current instructions.
- No doc tells an operator to enable legacy mode for normal runtime.
- The performance plan remains available for trace UI work.

## Phase 2 — Archive Legacy Chat Web Database Files

Keep backups, but remove legacy files from the normal home directory after verification. This reduces operator confusion and catches hidden dependencies.

### Tasks

1. Create an explicit archive directory:

```bash
archive="$HOME/.pibo/legacy-archives/chat-web-sqlite-20260509"
mkdir -p "$archive"
```

2. Checkpoint the old legacy WAL if possible. This should be done only while no process has `web-chat.sqlite` open.

```bash
sqlite3 "$HOME/.pibo/web-chat.sqlite" 'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;' \
  > "$archive/integrity-before-archive.txt"
```

3. Copy files first, with checksums:

```bash
cp -a "$HOME/.pibo/web-chat.sqlite"* "$archive"/ 2>/dev/null || true
sha256sum "$archive"/* > "$archive/SHA256SUMS.txt"
```

4. Move the active home files aside only after copy succeeds:

```bash
mv "$HOME/.pibo/web-chat.sqlite" "$archive/web-chat.sqlite.archived-source" 2>/dev/null || true
mv "$HOME/.pibo/web-chat.sqlite-wal" "$archive/web-chat.sqlite-wal.archived-source" 2>/dev/null || true
mv "$HOME/.pibo/web-chat.sqlite-shm" "$archive/web-chat.sqlite-shm.archived-source" 2>/dev/null || true
```

5. Restart dev first, then production only after approval.

6. Verify no new `web-chat.sqlite` appears after normal Chat Web use.

### Acceptance Criteria

- The archived files exist and have checksums.
- `~/.pibo/web-chat.sqlite*` no longer exists after archive.
- Chat Web still creates sessions, sends messages, loads navigation, and loads traces.
- No runtime recreates `web-chat.sqlite`.

### Rollback

Move archived files back:

```bash
cp -a "$archive/web-chat.sqlite.archived-source" "$HOME/.pibo/web-chat.sqlite"
cp -a "$archive/web-chat.sqlite-wal.archived-source" "$HOME/.pibo/web-chat.sqlite-wal" 2>/dev/null || true
cp -a "$archive/web-chat.sqlite-shm.archived-source" "$HOME/.pibo/web-chat.sqlite-shm" 2>/dev/null || true
```

## Phase 3 — Extract V2-Neutral Interfaces

`web-app.ts` and `chat-v2-adapters.ts` still import types from legacy files. Move those types to neutral modules before deleting or quarantining old classes.

### Current Problem

These files still define both old runtime classes and shared shapes:

```text
src/apps/chat/event-log.ts       class + StoredChatEvent types
src/apps/chat/read-model.ts      class + ChatWebStoredPiboEvent/session index types
src/apps/chat/rooms.ts           class + room types/helpers
```

Runtime no longer instantiates the classes, but imports from these files make the old files look active.

### Target Files

Create or complete these neutral modules:

```text
src/apps/chat/types/event-store.ts
src/apps/chat/types/read-model.ts
src/apps/chat/types/rooms.ts
src/apps/chat/types/navigation.ts       optional, if navigation types need separation
src/apps/chat/room-metadata.ts          helpers like chatRoomIdFromMetadata
```

Alternative: place them under `src/data/chat-types.ts` if they are data-layer contracts rather than app contracts. Pick one location and keep it consistent.

### Tasks

1. Move pure types out of `event-log.ts`:
   - `StoredChatEvent`
   - `ChatEventAppendInput`
   - `ChatEventListInput`
   - `ChatUnreadCountInput`

2. Move pure read-model types out of `read-model.ts`:
   - `ChatWebStoredPiboEvent`
   - `ChatWebSessionIndexItem`
   - `ChatWebSessionBootstrapIndexResult`

3. Move room types and metadata helpers out of `rooms.ts`:
   - `PiboRoom`
   - `PiboRoomNode`
   - `PiboRoomMember`
   - `PiboRoomRole`
   - `CreatePiboRoomInput`
   - `UpdatePiboRoomInput`
   - `chatRoomIdFromMetadata`
   - `roomWorkspaceFromMetadata`
   - archive/default-room helper functions

4. Update imports in:
   - `src/apps/chat/web-app.ts`
   - `src/apps/chat/trace.ts`
   - `src/data/chat-v2-adapters.ts`
   - `src/debug/trace.ts`
   - tests that only need types

5. Keep runtime implementation imports explicit. A file that imports a legacy class should make that dependency obvious.

### Acceptance Criteria

These commands should return no runtime dependency on legacy implementation files:

```bash
rg "from \"\.\/event-log|from './event-log|from \"\.\/read-model|from './read-model|from \"\.\/rooms|from './rooms" src/apps/chat src/data
rg "\.\./apps/chat/(event-log|read-model|rooms)" src/data src/debug
```

Allowed matches must be either:

- legacy importer/debug code, or
- tests explicitly named as legacy tests.

## Phase 4 — Quarantine or Delete Legacy Runtime Classes

After interface extraction, old classes can move out of normal runtime paths.

### Options

Prefer **Option A** if tests and importer no longer need these classes. Use **Option B** only if migration comparison still needs them.

#### Option A — Delete

Delete:

```text
src/apps/chat/event-log.ts
src/apps/chat/read-model.ts
```

Reduce `src/apps/chat/rooms.ts` to V2-neutral helpers or delete it after moving helpers.

#### Option B — Quarantine

Move classes to:

```text
src/data/legacy/chat-event-log.ts
src/data/legacy/chat-read-model.ts
src/data/legacy/chat-room-store.ts
```

Rules for quarantined files:

- No default factory may point at `piboHomePath("web-chat.sqlite")` without an explicit `Legacy` name.
- Constructors require an explicit path.
- The module header says: `Importer/debug only. Do not import from Chat Web runtime.`
- Importing these files from `src/apps/chat/web-app.ts` is forbidden by test.

### Test Cleanup

Class-level legacy tests should move to one of these groups:

```text
test/legacy-chat-event-log.test.mjs
test/legacy-chat-read-model.test.mjs
test/legacy-chat-room-store.test.mjs
```

or be deleted if V2 tests cover the behavior.

Current likely candidates:

```text
test/chat-rooms-event-log.test.mjs
test/chat-read-model-bootstrap-indexing.test.mjs
test/chat-persistence-event-path.test.mjs
test/output-compactor.test.mjs
test/performance-optimizations.test.mjs
test/chat-trace.test.mjs
```

### Acceptance Criteria

- Chat Web runtime imports no legacy implementation class.
- Any remaining legacy class lives under `src/data/legacy/` or has `Legacy` in the name.
- Tests that use legacy classes say so in file names or test names.
- No default factory silently creates `web-chat.sqlite`.

## Phase 5 — Add Guardrails Against Legacy Reintroduction

Guardrails should fail in CI if runtime code reopens or recreates the old store.

### Tests

Add a focused guard test file:

```text
test/chat-data-v2-legacy-guard.test.mjs
```

It should verify:

1. Chat Web can create a session, send a message, load bootstrap, load navigation, list sessions, load trace, archive/restore, and delete without `web-chat.sqlite` present.
2. No `web-chat.sqlite`, `web-chat.sqlite-wal`, or `web-chat.sqlite-shm` appears in the test storage directory.
3. `createChatWebApp()` does not accept legacy data mode options.
4. Source scanning blocks runtime imports of quarantined legacy modules from `src/apps/chat/web-app.ts`.
5. Source scanning blocks these strings in runtime paths:

```text
PIBO_CHAT_DATA_MODE
PIBO_DATA_V2_WRITE
piboHomePath("web-chat.sqlite")
createDefaultChatEventLog
createDefaultChatWebReadModel
createDefaultPiboRoomStore
```

Limit source scanning to runtime directories to avoid false positives in plans, reports, and importer tests.

### Runtime Smoke

Add or extend the existing performance/check script to assert file absence after UI/API use:

```bash
node scripts/chat-web-performance-check.mjs --assert-no-legacy-chat-store
```

### Acceptance Criteria

- `npm test` fails if Chat Web runtime imports old legacy stores.
- `npm test` fails if default runtime creates `web-chat.sqlite`.
- The guard permits explicit importer/debug references.

## Phase 6 — Introduce V2-Native Query Interfaces

The current V2 adapters preserve old method names. They made the cutover safe, but new features should not depend on old shapes.

### Current Adapter Surfaces

```text
ChatV2ReadModel      emulates ChatWebReadModel
ChatV2EventLog       emulates ChatEventLog
ChatV2RoomStore      emulates PiboRoomStore
```

### Target Query Services

Create V2-native read services with explicit names:

```text
src/data/chat-session-query.ts
src/data/chat-trace-query.ts
src/data/chat-room-query.ts
src/data/chat-navigation-query.ts
src/data/chat-unread-query.ts
```

Suggested responsibilities:

- `ChatSessionQuery`: session list, session lookup, archive/delete state, selected session projections.
- `ChatTraceQuery`: trace pages, cursor handling, event reconstruction, raw-event limits.
- `ChatRoomQuery`: room tree, default room, membership checks.
- `ChatNavigationQuery`: sidebar page data and room/session navigation projection.
- `ChatUnreadQuery`: unread counts and mark-read state.

### Migration Path

1. Add V2-native services behind existing web handlers.
2. Replace handler internals one endpoint at a time.
3. Keep adapter classes only as temporary compatibility shells.
4. Delete adapters when no endpoint uses old interfaces.

### Acceptance Criteria

- New endpoint code uses V2-native services.
- Adapter classes shrink or disappear.
- Trace reconstruction logic lives in `ChatTraceQuery`, not in a compatibility adapter.
- Navigation reads do not need old read-model names.

## Phase 7 — Unify Pibo Sessions into `pibo.sqlite`

This is the largest change. It removes `pibo-sessions.sqlite` as an active store and makes V2 `sessions` authoritative for `PiboSessionStore`.

### Current Split

`SqlitePiboSessionStore` owns `pibo-sessions.sqlite`:

```text
pibo_sessions:
  id
  pi_session_id
  channel
  kind
  profile
  owner_scope
  parent_id
  origin_id
  workspace
  title
  metadata_json
  active_model_json
  created_at
  updated_at
```

V2 `sessions` stores a superset:

```text
sessions:
  id
  pi_session_id
  owner_scope
  room_id
  root_session_id
  parent_id
  origin_id
  channel
  kind
  profile
  active_model_json
  workspace
  title
  first_message_preview
  status
  archived_at
  deleted_at
  metadata_json
  created_at
  updated_at
  last_activity_at
```

### Design Decision

Make `pibo.sqlite:sessions` the authoritative product session store. Keep `session_navigation` as a projection, not as source of truth.

### New Store

Add:

```text
src/sessions/pibo-data-session-store.ts
```

It implements `PiboSessionStore` over `PiboDataStore.sessions` or directly over the V2 `sessions` table.

Preferred shape:

```ts
export class PiboDataSessionStore implements PiboSessionStore {
  constructor(private readonly dataStore: PiboDataStore) {}
  get(id: string): PiboSession | undefined;
  list(): PiboSession[];
  create(input: CreatePiboSessionInput): PiboSession;
  update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined;
  delete(id: string): boolean;
  find(input: FindPiboSessionsInput): PiboSession[];
  close?(): void;
}
```

### Schema Changes

V2 `sessions` already has most fields. Review and add if needed:

- `deleted_at` handling for soft deletes versus current hard delete semantics.
- indexes for `parent_id`, `origin_id`, `channel/kind`, `pi_session_id`, and owner ordering.
- uniqueness for `pi_session_id` when not null.

Likely additions:

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_parent_activity
  ON sessions(parent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_origin_activity
  ON sessions(origin_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_channel_kind_activity
  ON sessions(channel, kind, updated_at DESC);
```

### Migration Command

Add an explicit migration command:

```bash
pibo data migrate sessions-to-v2 --json
```

It should:

1. Read `pibo-sessions.sqlite:pibo_sessions`.
2. Upsert missing rows into `pibo.sqlite:sessions`.
3. Preserve `id`, `piSessionId`, owner, hierarchy, profile, title, active model, metadata, timestamps.
4. Keep existing V2 fields like `room_id`, `first_message_preview`, `status`, and `last_activity_at` when newer or more specific.
5. Rebuild `session_navigation` for chat sessions.
6. Be idempotent.
7. Write a report with imported/skipped/updated counts.

### Runtime Switch

Use a short controlled switch, not a long feature flag period.

1. Add `PiboDataSessionStore`.
2. Run migration locally and in Docker.
3. Switch gateway session-store factory to `PiboDataSessionStore`.
4. Remove `SqlitePiboSessionStore` from production gateway construction.
5. Keep `SqlitePiboSessionStore` only for migration/import tests until retired.

Avoid a persistent runtime flag like `PIBO_SESSION_STORE_MODE`. If a temporary flag is necessary for dev validation, remove it in the same implementation branch.

### Consistency Rules

- `PiboSessionStore.create()` writes one authoritative V2 `sessions` row.
- Chat ingest may update activity/status/projections, but it must not invent session identity.
- `ChatDataIngestService` may call `store.sessions.upsertSession()` only to enrich an existing or just-created session row.
- Delete semantics must be explicit:
  - product session delete may soft-delete by setting `deleted_at`, or
  - hard delete may be retained if all callers expect disappearance.
- Navigation must derive from `sessions`, messages, observations, and room metadata.

### Tests

Add tests for:

- create/get/list/find/update/delete on `PiboDataSessionStore`.
- uniqueness of `piSessionId`.
- parent/origin queries.
- metadata matching.
- active model persistence.
- migration from `pibo-sessions.sqlite` to V2.
- idempotent migration rerun.
- Chat Web session creation after session-store switch.
- Session router behavior with V2 session store.

### Acceptance Criteria

- The gateway no longer opens `pibo-sessions.sqlite` in normal runtime.
- `pibo.sqlite:sessions` is the only active product session table.
- `npm test` passes.
- Docker validation passes.
- Dev gateway can create sessions, fork/clone/switch, run subagents, and show navigation.
- Production deploy includes a backup and migration report.

### Rollback

Rollback must restore the previous deployment and `pibo-sessions.sqlite` backup. Because sessions can be created after cutover, rollback must also export any new V2-only sessions back into `pibo-sessions.sqlite` or accept a bounded data-loss window. Prefer no production switch until export-back or a tested restore procedure exists.

## Phase 8 — Production Rollout Plan

Production rollout should happen in two deployments.

### Deployment A — Cleanup Without Session Store Switch

Includes:

- doc superseded notes,
- interface extraction,
- legacy class quarantine/deletion,
- guard tests,
- legacy DB archive validation in dev,
- V2-native query service beginnings if low risk.

Does not include:

- switching `PiboSessionStore` away from `pibo-sessions.sqlite`.

Deploy A first because it reduces risk before the deeper session-store migration.

### Deployment B — Session Store Unification

Includes:

- `PiboDataSessionStore`,
- session migration CLI,
- gateway store switch,
- production migration report,
- open-fd verification that `pibo-sessions.sqlite` is no longer active.

Deploy B only after Deployment A is stable.

## Validation Matrix

Run before each deploy:

```bash
npm run typecheck
npm run build
npm test
```

Run focused tests:

```bash
node --test test/data-cli.test.mjs
node --test test/data-v2-ingest-service.test.mjs
node --test test/web-channel.test.mjs
node --test test/chat-data-v2-legacy-guard.test.mjs
```

Run Docker validation:

```bash
npm run --silent dev -- compute spawn <name>
# inside worker: typecheck, build, focused tests, browser/API smoke
npm run --silent dev -- compute release <name>
```

Run dev gateway validation:

```bash
./scripts/deploy-web-dev.sh
npm run --silent dev -- gateway dev restart
npm run --silent dev -- gateway dev status
```

Production deployment requires explicit approval before restart.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hidden runtime import recreates `web-chat.sqlite` | Split-brain or stale reads | Guard tests and file absence checks |
| Type extraction changes runtime behavior | Compile/runtime regressions | Move types only first; no logic changes in same patch |
| Deleting legacy tests removes useful coverage | Regressions in trace reconstruction | Port important expectations to V2 tests before deletion |
| Session-store switch loses sessions | High | Idempotent migration, backup, compare report, rollback export plan |
| Delete semantics differ between old and V2 sessions | Archived/deleted sessions reappear or disappear | Define soft/hard delete behavior before implementation |
| Navigation projection drifts from sessions | Sidebar inconsistencies | Rebuild navigation after migration and test updates |
| Production restart interrupts work | User impact | Use gateway safety checks and explicit approval for force restart |

## Implementation Order

1. Add this plan and commit it.
2. Implement Phase 1 docs.
3. Add Phase 5 guard tests before moving code.
4. Extract interfaces in Phase 3.
5. Quarantine/delete legacy runtime classes in Phase 4.
6. Run full local and Docker tests.
7. Deploy cleanup to dev.
8. Archive legacy DB files in dev and verify no recreation.
9. Deploy cleanup to production after approval.
10. Start Phase 7 in a new branch or separate commit series.
11. Migrate sessions in dev, then production only after a tested rollback/export procedure exists.

## Done Criteria

The cleanup is complete when:

- current docs point to V2-only architecture,
- old Chat Web DB files live only in backup/archive paths,
- Chat Web runtime imports no legacy store implementation,
- no runtime default factory creates `web-chat.sqlite`,
- tests fail on legacy-store reintroduction,
- new code uses V2-native query services,
- `pibo.sqlite` owns product sessions,
- normal gateway runtime opens neither `web-chat.sqlite` nor `pibo-sessions.sqlite`,
- production health checks pass after deployment.
