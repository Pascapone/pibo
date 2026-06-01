# Final Owner Scope Removal Implementation Insights

This file is mandatory reading at the start of every Ralph session. Keep durable findings here so later sessions do not rediscover the same facts.

## Product invariants

- The final product has exactly one product data space: the app.
- Auth is only an access gate. It must not decide product visibility, ownership, routing, workspace selection, profile registration, job control, read-state, or write location.
- `shared:app` is not the target model. It is a legacy storage value that must disappear from active runtime code and fresh schemas after the final cutover.
- Do not replace Owner Scope with another synthetic owner value.
- Better Auth tables and sessions are out of scope for removal; they remain auth/access state, not product ownership state.
- Production data mutation, Production migration apply, Production deploy, Production restart, host Dev deploy/restart, and upstream PR creation are forbidden unless the user gives separate explicit approval at that time.
- The loop must stop for user review before the final real database cutover and before PR creation.

## Source docs and inputs

- Main plan: `docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md`.
- Text PRD: `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal-prd.md`.
- Ralph stories: `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal.prd.json`.
- Inventory summary: `docs/reports/owner-scope-final-removal-inventory-2026-05-31.md`.
- Raw inventory: `docs/reports/owner-scope-final-removal-raw-inventory-2026-05-31.txt`.
- Backup report: `docs/reports/final-owner-scope-removal-precutover-backup-2026-05-31.md`.

## Backup and sandbox facts

- Verified host backup: `/root/.pibo/backups/final-owner-scope-removal-precutover-vacuum-20260531T194546Z`.
- Backup method: SQLite `VACUUM INTO` per DB.
- Backup verification: every included backup DB passed `PRAGMA quick_check = ok`.
- Included DBs: `pibo.sqlite`, `chat-agents.sqlite`, `pibo-ralph.sqlite`, `pibo-cron.sqlite`, `web-annotations.sqlite`, `web-projects.sqlite`, `pibo-events.sqlite`, `auth.sqlite`, `context-files/context-files.sqlite`.
- `pibo-sessions.sqlite` and `pibo-workflows.sqlite` were not present at `/root/.pibo` during backup.
- Worker fresh test Pibo home: `/workspace/.pibo/ralph-test-home` in the container; host path `/root/code/pibo/.worktrees/final-owner-scope-removal-ralph/.pibo/ralph-test-home`. Normal build/runtime/gateway/browser/CLI validation should use this fresh test home.
- Worker migration sandbox home: `/workspace/.pibo/ralph-migration-sandbox`; host path `/root/code/pibo/.worktrees/final-owner-scope-removal-ralph/.pibo/ralph-migration-sandbox`, backed by the copied verified backup. Historical-data migration validation may use this path only.
- Use `.pibo/ralph-worker.sh '<command>'` from the worktree to run worker commands with `PIBO_HOME=/workspace/.pibo/ralph-test-home` and `PIBO_MIGRATION_SANDBOX_HOME=/workspace/.pibo/ralph-migration-sandbox`.
- Do not run migration tests or exploratory data commands against `/root/.pibo`.

## Docker and worktree facts

- Host worktree: `/root/code/pibo/.worktrees/final-owner-scope-removal-ralph`.
- Branch: `final-owner-scope-removal-ralph`.
- Base: `upstream/dev` at `f0c588e`.
- Docker worker: `pibo-dev-final-owner-scope-removal-ralph`.
- Container workspace: `/workspace`.
- Ports: gateway `4830`, CDP `4831`, web `4832`, Chat UI `4833`, Context UI `4834`.
- Git commands must run on the host worktree. The Docker worker may not resolve host worktree Git metadata.
- Use Docker for builds, tests, deploy/gateway restarts, browser checks, PTY checks, runtime validation, and all data/migration commands. Host gateway and host databases are out of bounds.
- Do not create/release/replace Docker workers unless the user explicitly asks.

## Implementation strategy

- Prefer dependency order from the PRD JSON: gates/baseline, app context/auth/runtime, sessions/schemas, Chat rooms/navigation, feature stores, Ralph/Cron, workflows, CLI/TUI, migration tooling, docs, validation.
- Keep changes small and story-scoped. Commit each completed story or coherent story group.
- Mark a story `passes: true` only after code, tests, validation evidence, and notes are complete.
- For user-facing Web/CLI/TUI/runtime/persistence changes, use the closest practical real/default path inside Docker, not only mocks. Do not use host gateways for this loop.
- Record evidence in both the PRD JSON story `notes` and `IMPLEMENTATION_PROGRESS.md`.
- Add durable patterns and gotchas here, not just in the progress log.

## Search-gate target

The final branch should remove active product matches for:

```text
ownerScope, owner_scope, OwnerScope, owner scope, owner-scope,
getSharedAppLegacyOwnerScope, LEGACY_SHARED_APP_OWNER_SCOPE, shared:app,
PIBO_OWNER_SCOPE, principalId, principal_id, room_members,
listOwned, getOwned, requireOwned, OwnedSession, OwnedProject,
active owner, current owner, listOwners, setActiveOwner, getActiveOwner,
OwnerSummary, ownerSummaries, personal target, Personal Chat,
Personal Project, personal room, web-user, auth user id, authUserId
```

Temporary exceptions are allowed only for the isolated final migration module and explicitly historical `docs/legacy` material. The post-cutover target is zero active-source matches.

## Open questions / caution areas

- The final cutover migrator may need old column names temporarily. Keep it isolated and removable.
- Decide later whether the migrator is deleted after approved Production cutover or retained as operator-only legacy tooling. The plan prefers deletion after cutover.
- Existing root progress/insights from earlier work were replaced in this branch with final-owner-scope-specific files to avoid misleading Ralph sessions.
- The current codebase may still contain many transitional shared-app compatibility helpers from the previous PR. Do not mistake those for the final target.

## US-001 baseline lessons

- The Docker worker does not expose a global `rg` binary, but the dependency binary works at `node_modules/@vscode/ripgrep-linux-x64/bin/rg`. Use that path for repeatable search-gate work unless a later story adds a repo script wrapper.
- Search baselines should distinguish active source/docs scope (`src packages scripts skills test docs/project docs/specs docs/plans`) from full worktree scope, because `docs/reports/owner-scope-final-removal-raw-inventory-2026-05-31.txt` intentionally contains many historical matches.
- The fresh test home `/workspace/.pibo/ralph-test-home` is currently empty of SQLite databases; the copied historical sandbox is available through `/workspace/.pibo/ralph-migration-sandbox`, a symlink to `/workspace/.pibo/ralph-sandbox`. Use `find -L` or resolve the symlink when inventorying sandbox files.
- Python `sqlite3` URI `mode=ro` is available in the worker and was sufficient for read-only schema inventory without installing `sqlite3` CLI.

## US-002 search gate lessons

- The strict vocabulary gate lives at `scripts/legacy-product-vocabulary-gate.mjs` and is exposed as `npm run check:product-vocab`.
- The gate intentionally is not a default `npm test` dependency yet because the current branch still contains active artifacts that later stories must remove. It should become a final zero-regression check once the active matches are gone.
- The script constructs legacy terms from string segments so that the gate implementation and its focused tests do not create self-matches in the active scan roots.
- The only built-in allowed paths are `docs/legacy/**` and the isolated final app-space cutover migration path. If later migration fixtures need legacy vocabulary, prefer keeping those fixtures under the isolated migration path or revisiting the allowlist explicitly rather than broadening it silently.
- Current Docker scan after US-002: 3703 disallowed matches, 0 allowed matches, 1019 scanned files. This is expected until later PRD stories remove active source/current-doc artifacts.

## US-002 search gate lessons

- The strict vocabulary gate lives at `scripts/legacy-product-vocabulary-gate.mjs` and is exposed as `npm run check:product-vocab`.
- The gate intentionally is not a default `npm test` dependency yet because the current branch still contains active artifacts that later stories must remove. It should become a final zero-regression check once the active matches are gone.
- The script constructs legacy terms from string segments so that the gate implementation and its focused tests do not create self-matches in the active scan roots.
- The only built-in allowed paths are `docs/legacy/**` and the isolated final app-space cutover migration path. If later migration fixtures need legacy vocabulary, prefer keeping those fixtures under the isolated migration path or revisiting the allowlist explicitly rather than broadening it silently.
- Current Docker scan after US-002: 3703 disallowed matches, 0 allowed matches, 1019 scanned files. This is expected until later PRD stories remove active source/current-doc artifacts.

## US-003 neutral app context lessons

- `src/shared-app.ts` is now the neutral app-context module only. It must not regain legacy storage constants, helpers, `ownerScope`, or `legacyOwnerScope` fields.
- Any remaining pre-cutover owner-column compatibility is isolated in `src/owner-scope-compat.ts`. Treat this as a deletion target for later schema/API stories, not as an app context or replacement product owner.
- Tests that still need historical pre-cutover expected values import from `dist/owner-scope-compat.js`, not `dist/shared-app.js`. Later stories should remove those expectations as their feature areas become ownerless.
- Use the exact-symbol gate `node_modules/@vscode/ripgrep-linux-x64/bin/rg -n "getSharedAppLegacyOwnerScope|LEGACY_SHARED_APP_OWNER_SCOPE" src packages scripts test` to ensure the removed shared-app helper names stay gone.

## US-004 web auth access-gate lessons

- `PiboWebSession` is now ownerless: only `authSession` and neutral `appContext` are allowed. Do not add storage compatibility fields back to `src/web/types.ts` or `src/web/auth.ts`.
- If a pre-cutover owner column is still unavoidable before the schema-removal stories, call `legacyOwnerScopeForPreCutoverSchemas()` at that legacy schema boundary. Do not pass it through web auth or treat it as product context.
- Auth identity may be used as audit/display metadata. `src/plugins/context-files.ts` now uses `webSession.authSession.identity.userId` for revision/change actor ids; it must not be reused as a product partition key.
- Useful US-004 regression grep: `grep -R -n "webSession\\.ownerScope\\|ownerScope: .*webSession\\|PiboWebSession.*ownerScope" src/web src/apps/chat src/plugins test/web-auth-shared-app-context.test.mjs` should return no matches.

## US-005 runtime/session context lessons

- `PiboRuntimeSessionContext` is now ownerless. Do not add `ownerScope`, `legacyOwnerScope`, principal, or auth-user-derived fields back to runtime session context.
- `ToolDefinitionContext` is now ownerless too. Runtime-selected tools may receive Pibo Session ID and Pibo Room ID, but not a product owner. Until Web Annotations are fully removed from owner schemas in US-013, their temporary storage compatibility must stay local to Web Annotation code via `legacyOwnerScopeForPreCutoverSchemas()`, not runtime context.
- Generated `pibo://runtime/session-context.md` should mention the neutral app context and resource ids only. Useful regression gate: `rg -n "ownerScope|legacyOwnerScope|Owner scope|User ID|Principal|auth user id|sessionContext\?\.ownerScope" src/core/runtime.ts src/core/profiles.ts src/core/context-build.ts` should return no source matches.
- Session router and Chat Web context-build paths may still use the pre-cutover compatibility helper for existing storage/user-settings boundaries until later stories remove those schemas, but they must not pass that value into runtime session context.

## US-006 Pibo session contract lessons

- `PiboSession`, `CreatePiboSessionInput`, `UpdatePiboSessionInput`, and `FindPiboSessionsInput` are now ownerless. Do not add `ownerScope` back to `src/sessions/store.ts` or session-router create/update/find paths.
- `session.ownerScope` is no longer available as a fallback actor, room, or CLI summary source. For temporary pre-cutover Chat navigation/read-state boundaries, call `legacyOwnerScopeForPreCutoverSchemas()` locally until the relevant later story removes that schema.
- `src/sessions/sqlite-store.ts` and `src/sessions/pibo-data-store.ts` still mention `owner_scope` only as the expected schema-removal target for US-007/US-024. They must not expose that value through `PiboSession` or use it for find matching.
- Useful US-006 regression gate: `rg -n "ownerScope|listOwned|getOwned|requireOwned|OwnedSession" src/sessions src/core/session-router.ts src/debug/trace.ts` should return no matches.

## US-007 session schema lessons

- `SqlitePiboSessionStore` fresh `pibo_sessions` schema is now ownerless. Do not reintroduce `owner_scope` or `idx_pibo_sessions_owner` in `src/sessions/sqlite-store.ts` except inside the isolated constructor rebuild that removes historical columns.
- Standalone historical `pibo-sessions.sqlite` rows with `shared:app` or `user:*` values are migrated by table rebuild: preserve session identifiers and session facts, drop owner columns/indexes, and expose ownerless `PiboSession` objects.
- `PiboDataSessionStore` and `pibo data migrate sessions-to-v2` no longer write owner_scope to `pibo.sqlite.sessions`. Fresh pibo.sqlite session schema was already ownerless; tests now assert this explicitly.
- Useful US-007 regression gate: `rg -n "owner_scope TEXT|ON pibo_sessions\\(owner_scope|owner_scope," src/sessions/sqlite-store.ts src/sessions/pibo-data-store.ts src/data/cli.ts` should return no matches. Remaining data CLI owner/principal read-state repair references are Chat read-state cleanup targets for US-008/US-009, not pibo-sessions schema targets.

## US-008 Chat room/navigation/read-state lessons

- Active Chat room access is now resource-id based. Use `ChatRoomService.requireRoom(roomId)` plus the archived-room write guard; do not reintroduce `requireRoomAccess(roomId, principalId, action)` or room membership as an access gate.
- `ChatRoomService.ensureDefaultRoom()` accepts only an optional name and must not require owner/principal input. It no longer creates `room_members`; member payload cleanup is a later API/UI story.
- `NavigationStore` upsert/list contracts are ownerless. It does not expose `ownerScope` and does not filter `session_navigation` by owner. Temporary legacy-column binding remains only to keep pre-US-009 legacy schemas writable until the schema rebuild removes the column.
- `ChatReadStateService` uses `app_session_read_state`; unread state is shared-app state, not principal state. Active SSE observer tracking stores stream ids only and marks a session read once, not once per auth account.
- Useful US-008 regression search: `rg -n "requireRoomAccess|ensureMember\\(|markSessionRead\\([^,]+,[^,]+,[^)]|countUnreadMessagesBySession\\([^)]*principalId|listRoomTree\\([^)]|ensureDefaultRoom\\(\\{[^\\n]*(ownerScope|principalId)" src/apps/chat src/data src/cron src/ralph src/cli-session/localSessionSource.ts` should return no real active API matches. Current known false positive is parsing `target.principalId` in Ralph/Cron target compatibility, scheduled for automation target cleanup.
