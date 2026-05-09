# Pibo Chat Data V2 — Final Legacy Removal Plan

Date: 2026-05-09
Status: Ready after dev stability confirmation

## Goal

Switch Chat Web fully to Chat Data V2 and remove the legacy Chat Web data system.

After this work:

- Chat Web always uses `~/.pibo/pibo.sqlite` for rooms, messages, trace events, navigation, and read state.
- Chat Web no longer opens or writes `~/.pibo/web-chat.sqlite` during normal operation.
- `PIBO_CHAT_DATA_MODE=legacy` no longer exists.
- `PIBO_DATA_V2_WRITE` shadow-write mode no longer exists.
- Legacy code remains only where explicitly needed for one-time import or backup inspection.

## Current State

Dev has been deployed and restarted with the V2 runtime-adapter code through commit:

```text
bd0d5b5 Add V2 chat web runtime adapters
```

The user confirmed dev is stable.

Current V2 pieces:

- `src/data/chat-v2-adapters.ts`
  - `ChatV2ReadModel`
  - `ChatV2EventLog`
  - `ChatV2RoomStore`
- `PIBO_CHAT_DATA_MODE=v2` routes Chat Web to V2 adapters.
- `pibo data import legacy-chat` imports legacy `web-chat.sqlite` and `pibo-sessions.sqlite` data into `pibo.sqlite`.
- Test coverage proves V2 mode can create a session, send a message, load bootstrap, and avoid creating the legacy Chat Web store.

## Cutover Rule

Use one rule from this point forward:

```text
Chat Web data source = V2 only
```

Do not keep a runtime legacy fallback. A fallback invites split-brain behavior and hides migration defects.

Rollback, if needed, should be operational:

1. restore the gateway to the previous stable deployment,
2. restore backed-up legacy files if needed,
3. restart the gateway.

Do not implement product-level automatic fallback.

## Phase 1 — Live Data Backup and Import

### Work

1. Create a timestamped backup:

```bash
backup_dir="$HOME/.pibo/backups/chat-v2-final-cutover-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -a "$HOME/.pibo/web-chat.sqlite"* "$backup_dir"/ 2>/dev/null || true
cp -a "$HOME/.pibo/pibo-sessions.sqlite"* "$backup_dir"/ 2>/dev/null || true
cp -a "$HOME/.pibo/pibo.sqlite"* "$backup_dir"/ 2>/dev/null || true
```

2. Record inventory:

```bash
npm run --silent dev -- data inventory --json > reports/chat-data-inventory-before-final-v2-cutover.json
```

3. Import legacy Chat Web data into V2:

```bash
npm run --silent dev -- data import legacy-chat --from "$HOME/.pibo" --to "$HOME/.pibo/pibo.sqlite" --json > reports/chat-data-import-final-v2-cutover.json
```

4. Run the importer a second time and verify idempotency:

```bash
npm run --silent dev -- data import legacy-chat --from "$HOME/.pibo" --to "$HOME/.pibo/pibo.sqlite" --json > reports/chat-data-import-final-v2-cutover-rerun.json
```

### Acceptance Criteria

- Backup exists.
- Import reports exist.
- Second import reports skipped rows instead of duplicate growth.
- `pibo.sqlite` contains rooms, sessions, event log rows, messages, observations, and navigation rows.

## Phase 2 — Make V2 the Default Runtime

### Work

1. Change Chat Web default data mode from legacy to V2.
2. Remove the need to set `PIBO_CHAT_DATA_MODE=v2` for normal operation.
3. Keep `dataMode?: "v2"` only if tests still need explicit construction; otherwise remove it.
4. Remove `PIBO_DATA_V2_WRITE` behavior.
5. Make `createDataStore()` unconditional for Chat Web.
6. Remove shadow-write wording and metrics that imply V2 is optional.

### Code Areas

- `src/apps/chat/web-app.ts`
- `src/data/ingest-service.ts`
- `test/web-channel.test.mjs`
- any deployment config that sets `PIBO_CHAT_DATA_MODE` or `PIBO_DATA_V2_WRITE`

### Acceptance Criteria

- Chat Web defaults to V2 with no env flag.
- Tests no longer rely on legacy mode except explicit importer tests.
- No normal Chat Web path uses `ChatWebReadModel`, `ChatEventLog`, or `PiboRoomStore`.

## Phase 3 — Remove Legacy Runtime Stores from Chat Web

### Work

Delete or quarantine the runtime legacy classes:

- `src/apps/chat/read-model.ts`
- `src/apps/chat/event-log.ts`
- legacy runtime parts of `src/apps/chat/rooms.ts`

Keep only shared types/helpers still needed by the UI or tests. Move those to neutral files if necessary.

Likely follow-up moves:

- Move room metadata helpers from `rooms.ts` to a V2-neutral file.
- Move event/read-model types from legacy files to V2-neutral files.
- Keep trace builder independent from storage implementation.

### Acceptance Criteria

- Chat Web imports no runtime class that opens `web-chat.sqlite`.
- `createDefaultChatWebReadModel`, `createDefaultChatEventLog`, and `createDefaultPiboRoomStore` are gone or test-only.
- `rg "web-chat.sqlite" src/apps/chat src/data` returns only importer/debug/documentation references.

## Phase 4 — Keep Importer, Remove Legacy Runtime Fallback

### Work

Keep the importer as an operator tool:

```bash
npm run --silent dev -- data import legacy-chat
```

But make its role explicit:

- It reads legacy files only as import sources.
- It never participates in Chat Web runtime reads or writes.
- It can be removed after a later cleanup window if no backups need importing.

Update CLI help text to call legacy stores “import sources,” not active stores.

### Acceptance Criteria

- Importer tests still pass.
- Runtime tests pass without creating or opening `web-chat.sqlite`.
- Operator docs state that legacy files are backup/import inputs only.

## Phase 5 — Add Guardrails Against Legacy Reintroduction

### Work

Add tests and checks that fail if Chat Web reopens legacy storage.

Required tests:

1. Chat Web default mode creates a session and sends a message without creating `web-chat.sqlite`.
2. Bootstrap, navigation, sessions, trace, and read endpoints work without `web-chat.sqlite`.
3. Importer remains idempotent.
4. Static guard test rejects runtime imports of:
   - `createDefaultChatWebReadModel`
   - `createDefaultChatEventLog`
   - `createDefaultPiboRoomStore`
   - `piboHomePath("web-chat.sqlite")` from Chat Web runtime code.

### Acceptance Criteria

- `npm test` fails if a runtime legacy dependency returns.
- V2 default is covered by integration tests.

## Phase 6 — Dev Activation Test Without Legacy Store

### Work

On dev, after deployment:

1. Import legacy dev data into V2.
2. Stop dev gateway.
3. Move legacy Chat Web store aside:

```bash
mv ~/.pibo/web-chat.sqlite ~/.pibo/web-chat.sqlite.legacy-disabled
mv ~/.pibo/web-chat.sqlite-wal ~/.pibo/web-chat.sqlite-wal.legacy-disabled 2>/dev/null || true
mv ~/.pibo/web-chat.sqlite-shm ~/.pibo/web-chat.sqlite-shm.legacy-disabled 2>/dev/null || true
```

4. Start/restart dev gateway.
5. Test:
   - app load,
   - session switch,
   - new message,
   - trace view,
   - raw events,
   - archived sessions,
   - room switch,
   - unread/read behavior.

### Acceptance Criteria

- Dev starts with no `web-chat.sqlite` present.
- Chat Web stays stable.
- No new `web-chat.sqlite` file appears.

## Phase 7 — Production Cutover

### Work

Only after Phase 6 passes:

1. Backup production live data.
2. Run legacy import into production `pibo.sqlite`.
3. Deploy code with V2 default.
4. Move production `web-chat.sqlite*` aside, not delete.
5. Restart production gateway through the Pibo CLI.
6. Verify health and Chat Web flows.

Use normal production restart safety. If active sessions block restart, ask for explicit approval before forcing.

### Acceptance Criteria

- Production health returns OK.
- Chat Web opens and uses V2 data.
- Old sessions are visible.
- New messages persist to `pibo.sqlite`.
- No runtime dependency on `web-chat.sqlite` remains.

## Phase 8 — Delete Legacy Runtime Code

### Work

After dev and production stay stable:

1. Delete runtime legacy store files or reduce them to importer-only fixtures.
2. Remove legacy mode docs.
3. Remove old shadow-write reports from active docs, or mark them historical.
4. Remove env flags:

```text
PIBO_CHAT_DATA_MODE
PIBO_DATA_V2_WRITE
```

5. Update `pibo data inventory` to label `web-chat.sqlite` as legacy backup/import source.

### Acceptance Criteria

- `rg "PIBO_CHAT_DATA_MODE|PIBO_DATA_V2_WRITE" src test scripts` returns no runtime use.
- `rg "web-chat.sqlite" src/apps/chat` returns no runtime use.
- `npm run typecheck` passes.
- `npm test` passes.

## Validation Commands

Run before any deploy:

```bash
npm run typecheck
npm run build
npm test
```

Run focused checks:

```bash
node --test test/data-cli.test.mjs
node --test test/web-channel.test.mjs
```

Run Docker validation for Chat Web changes:

```bash
npm run --silent dev -- compute spawn --name v2-final-removal
# copy or work in the worker worktree, then:
npm run typecheck
npm run build
```

## Rollback Plan

Rollback is operational, not automatic.

If the final cutover fails:

1. Stop/restart the gateway to the last known stable deployment.
2. Move legacy files back:

```bash
mv ~/.pibo/web-chat.sqlite.legacy-disabled ~/.pibo/web-chat.sqlite 2>/dev/null || true
mv ~/.pibo/web-chat.sqlite-wal.legacy-disabled ~/.pibo/web-chat.sqlite-wal 2>/dev/null || true
mv ~/.pibo/web-chat.sqlite-shm.legacy-disabled ~/.pibo/web-chat.sqlite-shm 2>/dev/null || true
```

3. Restore from the timestamped backup if needed.
4. Restart through the Pibo CLI.
5. Record the failed endpoint, error, and missing V2 data shape before retrying.

## Done Definition

The migration is complete when all statements are true:

- Chat Web starts with no `web-chat.sqlite` present.
- Chat Web does not recreate `web-chat.sqlite`.
- Chat Web reads and writes only `pibo.sqlite` for Chat Web data.
- Legacy mode flags are removed.
- Legacy runtime store classes are removed or quarantined outside runtime code.
- Importer remains only as an operator tool.
- Dev and production pass app-load, session, trace, archived-session, room, and unread checks.
- `npm test` passes.
