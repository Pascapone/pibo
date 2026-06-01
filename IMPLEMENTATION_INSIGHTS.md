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

## US-009 Chat schema lessons

- Fresh `pibo.sqlite` Chat schemas must not create `rooms.owner_scope`, `session_navigation.owner_scope`, `room_members`, `principal_session_stats`, or `principal_room_stats`. `app_session_read_state` and `app_room_read_state` are the app-level read-state targets and must not contain principal columns.
- `ChatRoomService` and `NavigationStore` no longer write legacy owner columns even if a caller creates rooms or navigation rows through active service paths. Any historical owner/principal schema handling must stay in explicit migration fixtures/modules, not normal room/navigation writes.
- `migrateLegacyChatDataSchemaToOwnerless(db)` lives under the isolated final cutover migration path at `src/data/final-app-space-cutover-migration.ts`. It is a temp-fixture/schema helper for pibo.sqlite Chat tables. It drops legacy Chat membership/principal stats tables, rebuilds rooms/navigation without owner columns, resolves duplicate default rooms by newest non-archived room, deduplicates navigation by newest `updated_at`, and merges principal read cursors into app-level read-state tables. Do not run it against host/Production data in this Ralph loop.
- Useful US-009 regression gate: `rg -n "CREATE TABLE IF NOT EXISTS (room_members|principal_session_stats|principal_room_stats)|owner_scope TEXT|principal_id TEXT|idx_.*(owner|principal)|\[\"owner_scope\"\]|\[\"principal_id\"\]" src/data/schema.ts src/data/navigation-store.ts src/apps/chat/data/room-service.ts` should return no matches.

## US-010 Chat Web payload lessons

- Active Chat room payloads are now ownerless: `PiboRoom` has no `ownerScope`, room row mapping must not synthesize legacy owner values, and room detail responses must not include membership/principal payloads.
- Chat UI optimistic room creation must not derive a synthetic owner from the authenticated user. Use resource ids and app/default room metadata only.
- Useful US-010 payload regression pattern: recursively assert Chat Web JSON responses do not contain keys named `ownerScope` or `principalId`; this catches nested bootstrap/navigation/session/room/settings leaks better than shallow checks.
- Worker-local web validation can use `runWebGatewayServer({ devAuth: true, web: { host: "0.0.0.0", port: 4788 } })` inside Docker with `PIBO_HOME=/workspace/.pibo/ralph-test-home`; do not use the normal `gateway:web` CLI without dev auth config and do not touch host gateways. Stop the worker-local gateway and any headless Chromium processes after validation.
- Remaining Chat UI `ownerScope`/`principalId` type matches belong to later story areas: Custom Agents, Projects/workflow UI, Ralph/Cron, workflows, and annotations. Do not broaden US-010 to those domains unless selected stories require it.

## US-011 Custom Agent lessons

- `CustomAgentDefinition`, `CreateCustomAgentInput`, Custom Agent API payloads, and the Chat UI `CustomAgent` type are now ownerless. Do not add `ownerScope` back to Agent Designer, profile registration, or custom-agent API serializers.
- `CustomAgentStore.list()` now takes only `{ includeArchived?: boolean }`; it intentionally ignores historical account boundaries and returns app-global custom agents.
- Fresh `chat_agents.sqlite` schemas must not include `owner_scope`. Historical `owner_scope` knowledge is confined to the `CustomAgentStore` constructor-time table rebuild until US-024/final migration isolation removes runtime compatibility.
- Historical duplicate Custom Agent `profile_name` rows are resolved by keeping the newest updated row under the original exact name and renaming older rows to `<name>-legacy-<8 hex hash>`. Keep this deterministic rule aligned with final cutover tooling.
- CLI session source should treat custom agents as app-global profile options only; custom agents must not create CLI owner summaries.
- Useful US-011 regression gates: `rg -n "ownerScope|legacyOwnerScopeForPreCutoverSchemas|shared:app" src/apps/chat/agent-store.ts src/apps/chat/agent-profiles.ts src/apps/chat/chat-request-normalizers.ts src/apps/chat-ui/src/agents src/apps/chat-ui/src/api-agent-designer.ts` should return no matches; `rg -n "owner_scope" src/apps/chat/agent-store.ts` should show only the temporary historical-column rebuild guard until US-024 removes it.

## US-012 Project/workflow UI lessons

- `PiboProject`, project creation, and project workflow session snapshots are now ownerless. Keep `createdBy` as audit metadata only; do not reintroduce `ownerScope` into project payloads or snapshot JSON.
- Workflow UI draft persistence uses neutral `WorkflowDraftRecord`; the old `OwnedWorkflowDraftRecord` name is removed from active source. Prompt asset and lifecycle APIs list/get/save records without owner parameters.
- Historical owner-column knowledge for Projects/workflow UI remains only in constructor-time rebuild/JSON-stripping helpers until US-024/final cutover isolation removes runtime compatibility. Fresh schemas and normal writes must not create or bind `owner_scope`.
- Useful US-012 regression gates: `rg -n "PiboProject.*ownerScope|CreateProjectInput.*ownerScope|projectWorkflowSessionSnapshot.*ownerScope|OwnedWorkflow|ownerScope: legacyOwnerScopeForPreCutoverSchemas\(\)|listAssets\([^)]*owner|getAsset\([^)]*,|getActiveRevision\([^)]*,|listEvents\(\{[^}]*ownerScope" src/apps/chat/data/project-service.ts src/apps/chat/project-workflow-sessions.ts src/apps/chat/workflow-persistence.ts src/apps/chat/workflow-persistence-model.ts src/apps/chat/workflow-catalog.ts src/apps/chat/workflow-registered-ref-pickers.ts src/apps/chat-ui/src/types.ts` should show only legacy JSON stripping if any. `rg -n "owner_scope TEXT|owner_scope TEXT NOT NULL|owner_scope," src/apps/chat/data/project-service.ts src/apps/chat/workflow-persistence.ts src/apps/chat/workflow-persistence-model.ts src/apps/chat/project-workflow-sessions.ts` should return no matches.

## US-013 Web Annotation lessons

- Web Annotation active contracts are now ownerless. `WebAnnotation`, `WebAnnotationBinding`, create/list/thread input types, CDP binding context, tools, API handlers, and Chat Web attachment preparation must use Pibo Session/resource ids only; do not add `ownerScope` back to these signatures or payloads.
- App-wide Web Annotation listing uses `scope=app` or `allSessions=true`; do not reintroduce `scope=owner` wording.
- `WebAnnotationStore` fresh schemas must not create `owner_scope` columns or owner indexes. Historical owner-column handling is limited to constructor-time table rebuilds in `src/web-annotations/store.ts` until the final compatibility-isolation story removes runtime legacy handling.
- Web Annotation composer attachments now fetch annotations by annotation id and preserve source-session metadata in rendered context; they are not filtered by auth account or synthetic owner.
- Useful US-013 regression gates: `rg -n "ownerScope|legacyOwnerScopeForPreCutoverSchemas|shared:app|principalId|principal_id" src/web-annotations scripts/validate-web-annotations-browser.mjs test/web-annotations*.mjs` should return no matches, and `rg -n "owner_scope TEXT|owner_scope," src/web-annotations/store.ts` should return no fresh-schema creation matches. Remaining `owner_scope` in `src/web-annotations/store.ts` should only be constructor-time historical-column detection/rebuild until US-024.

## US-014 Ralph store lessons

- Ralph active data contracts are ownerless: `PiboRalphJob`, `PiboRalphRun`, `PiboRalphRunFact`, and `PiboRalphJobCreateInput` must not regain `ownerScope`.
- Ralph targets now use `{ kind: "room", roomId }` or `{ kind: "default-chat" }`. Historical `{ kind: "personal", principalId }` target JSON is migration/input compatibility only and must be normalized to `default-chat`, not propagated as an active model.
- `PiboRalphStore` APIs are app-global: use `createJob(input)`, `updateJob(id, patch)`, `requestStop(id)`, `requestCancel(id)`, `removeJob(id)`, `reserveRun(id)`, `listJobs({ includeDisabled })`, `listRuns({ jobId, limit })`, `appendRunFact(input)`, and `listRunFacts({ jobId, runId, type, limit })`.
- Fresh `pibo-ralph.sqlite` schemas must not create `owner_scope` columns or owner indexes. Historical owner-column rebuild lives in `src/ralph/store.ts` until US-024/final cutover isolation removes runtime compatibility.
- Useful US-014 regression gates: `rg -n "ownerScope|getOwnedJob|PiboRalphJobCreateInput.*ownerScope|PiboRalph(Job|Run|RunFact).*ownerScope|kind: .personal.|principalId" src/ralph/types.ts src/ralph/store.ts src/ralph/service.ts` should return no matches, and `rg -n "owner_scope TEXT|owner_scope,|ON pibo_ralph_.*owner" src/ralph/store.ts` should return no fresh-schema creation matches.
- US-015 still owns the visible Ralph CLI/API/UI cleanup for deprecated `--owner-scope`, `--personal`, `--principal-id`, and Chat UI target labels. Do not confuse those transitional surfaces with the ownerless store model.

## US-015 Ralph CLI/API/UI lessons

- Ralph active user-facing surfaces now use only `room` and `default-chat` targets. Do not add `--owner-scope`, `PIBO_OWNER_SCOPE`, `--personal`, `--principal-id`, `principalId`, or `ownerScope` back to `src/ralph/cli.ts`, Chat Ralph API serializers, or Chat UI Ralph types/forms.
- `pibo ralph add` and `pibo ralph edit` use `--default-chat` for the shared default target and `--room <room-id>` for room targets. The built CLI real-path validation in `test/ralph-resource-visibility.test.mjs` covers help/list/add/start/stop/runs JSON against a temp store.
- Chat Ralph API request payloads should reject legacy personal/principal targets and serialize only `{ kind: "default-chat" }` or `{ kind: "room", roomId }`.
- Useful US-015 regression gate: `rg -n -e --owner-scope -e PIBO_OWNER_SCOPE -e --personal -e --principal-id -e ownerScope -e getOwnedJob -e principalId src/ralph src/apps/chat/ralph-api.ts src/apps/chat-ui/src/RalphArea.tsx src/apps/chat-ui/src/api-ralph.ts` should return no matches. Ralph-target matches in `src/apps/chat-ui/src/types.ts` should show only `room` and `default-chat`; Cron owner/personal matches in the same shared types file are US-016/US-017 targets.
- The broader shared-app artifact search gate still sees out-of-scope Cron/data compatibility imports before US-016/US-024. Do not treat those as Ralph regressions; remove them when their stories are selected.

## US-016 Cron store lessons

- Cron active data contracts are ownerless: `PiboCronJob`, `PiboCronRun`, and `PiboCronJobCreateInput` must not regain `ownerScope`.
- Cron targets now use `{ kind: "room", roomId }` or `{ kind: "default-chat" }`. Historical `{ kind: "personal", principalId }` target JSON is migration/input compatibility only and must normalize to `default-chat`, not propagate as an active model.
- `PiboCronStore` APIs are app-global: use `createJob(input)`, `updateJob(id, patch)`, `removeJob(id)`, `reserveManualRun(id)`, `listJobs({ includeDisabled })`, and `listRuns({ jobId, limit })`.
- Fresh `pibo-cron.sqlite` schemas must not create `owner_scope` columns or owner indexes. Historical owner-column rebuild lives in `src/cron/store.ts` until US-024/final cutover isolation removes runtime compatibility.
- Useful US-016 regression gates: `rg -n "ownerScope|getOwnedJob|PiboCron(Job|Run|JobCreateInput).*ownerScope|kind: .personal.|principalId" src/cron/types.ts src/cron/store.ts src/cron/service.ts` should return no matches, and `rg -n "owner_scope TEXT|owner_scope,|ON pibo_cron_.*owner" src/cron/store.ts` should return no fresh-schema creation matches.
- US-017 still owns the visible Cron CLI/API/UI cleanup for deprecated `--owner-scope`, `--personal`, `--principal-id`, Chat UI target labels, and API/UI personal-target payloads. Do not confuse those transitional surfaces with the ownerless store model.

## US-017 Cron CLI/API/UI lessons

- Cron active user-facing surfaces now use only `room` and `default-chat` targets. Do not add `--owner-scope`, `PIBO_OWNER_SCOPE`, `--personal`, `--principal-id`, `principalId`, or `ownerScope` back to `src/cron/cli.ts`, Chat Cron API serializers, or Chat UI Cron types/forms.
- `pibo cron add` and `pibo cron edit` use `--default-chat` for the shared default target and `--room <roomId>` for room targets. The built CLI real-path validation in `test/cron-schedule-store.test.mjs` covers add/help/edit JSON against a temp Cron store.
- Chat Cron API request payloads should reject legacy personal/principal targets and serialize only `{ kind: "default-chat" }` or `{ kind: "room", roomId }`.
- Useful US-017 regression gate: `rg -n -e --owner-scope -e PIBO_OWNER_SCOPE -e --personal -e --principal-id -e ownerScope -e getOwnedJob -e principalId src/cron src/apps/chat/cron-api.ts src/apps/chat-ui/src/CronArea.tsx src/apps/chat-ui/src/api-cron.ts src/apps/chat-ui/src/types.ts` should return no matches.
- The broader shared-app artifact search gate still fails on out-of-scope data/session compatibility (`src/data/session-store.ts`) before the later CLI/TUI/data compatibility stories. Do not treat that as a Cron regression.

## US-018 Workflow package store lessons

- `WorkflowRun` and `WorkflowRunListFilter` are now ownerless. Do not add `ownerScope` back to package run persistence, row mappers, write values, or list filters.
- Fresh `pibo-workflows.sqlite` `workflow_runs` schema must not include `owner_scope` or `idx_workflow_runs_owner`. Historical owner-column handling is limited to `SqliteWorkflowRunStore` constructor-time table rebuild until US-024/final cutover isolation removes runtime compatibility.
- Workflow run migration preserves run/resource identity and execution facts: workflow id/version/hash/snapshot, parent run/node attempt, Pibo session/project links, environment, current cursor, input/output, state, checkpoint, and timestamps. Owner values are dropped, not normalized.
- Runtime code must not fall back from routing to `run.ownerScope`; persisted workflow runs are app-global. Remaining `SessionRoutingPolicy.ownerScope`, Pibo workflow routing owner fields, and prompt trace privacy `kind: "ownerScope"` are US-019 cleanup targets.
- Useful US-018 regression gate: `rg -n "WorkflowRun.*ownerScope|WorkflowRunListFilter.*ownerScope|owner_scope TEXT|ON workflow_runs\\(owner_scope|owner_scope," packages/workflows/src/types/index.ts packages/workflows/src/store/contracts.ts packages/workflows/src/store/index.ts packages/workflows/src/store/row-mappers.ts packages/workflows/src/store/write-values.ts packages/workflows/src/store/schema.ts` should return no matches. Broader package `ownerScope` matches are expected only until US-019 removes routing/prompt terminology and tests.

## US-019 Workflow runtime/routing lessons

- Workflow runtime routing is now ownerless. `SessionRoutingPolicy`, `PiboWorkflowSession`, and `PiboWorkflowSessionCreateInput` must not regain `ownerScope`; routed workflow agent sessions should carry parent/session hierarchy plus optional project/room/channel metadata only.
- `RuntimeSelectionMetadata.routing` may record parent/project/room/channel for traceability, but not product ownership or auth-derived routing.
- Recorded agent prompt trace privacy now uses neutral `kind: "workflowRun"`; do not reintroduce `kind: "ownerScope"` or owner terminology in prompt metadata.
- Workflow run inspection should expose workflow/run/session/project/status facts only. Useful US-019 regression gate: `rg -n "ownerScope|kind: \\\"ownerScope\\\"|principalId|shared:app|SessionRoutingPolicy.*ownerScope|PiboWorkflowSession.*ownerScope" packages/workflows/src/runtime packages/workflows/src/types packages/workflows/src/inspection packages/workflows/src/testing/runtime-agent-node.test.ts packages/workflows/src/testing/runtime-one-node-agent.test.ts packages/workflows/src/testing/runtime-prompt-workflows.test.ts packages/workflows/src/testing/workflow-run-inspection.test.ts` should return no matches.
- Remaining `owner_scope` in package tests/source should be historical workflow-run migration fixture/schema-rebuild code from US-018 until US-024/final migration isolation decides whether that compatibility remains outside active runtime.

## US-020 CLI session source lessons

- `CliSessionSource` is now ownerless. Do not add `CliOwnerSummary`, `getActiveOwner`, `setActiveOwner`, `listOwners`, `ownerSummaries`, owner-scoped list/create inputs, active owner status fields, slash-command owner parameters, or `session_owner_mismatch` back to `src/cli-session`.
- The local CLI source default room id is now the neutral `cliDefaultRoomId()` value `room_cli_default`; it is not derived from an owner value.
- `repairLegacyCliSessions` is a neutral local repair hook. It must not ask for a selected owner or return an owner value.
- `pibo tui:sessions` source construction no longer accepts `--owner-scope` or `PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS`; debug mocked rooms are app-global.
- `InkSessionApp` still carries the UI owner picker/header compatibility and is temporarily `ts-nocheck` after the source contract removal. US-021 should delete that UI surface and the shim rather than adapting it back to source owner methods.
- Useful US-020 regression gate: `rg -n "CliOwnerSummary|getActiveOwner\(|setActiveOwner\(|listOwners\(|ownerSummaries|activeOwnerScope|activeOwnerLabel|session_owner_mismatch|Root recovery owner|selected owner|owner mismatch|ownerScope" src/cli-session src/apps/cli-ui/cliSessionsCommand.ts` should return no matches.

## US-021 Ink TUI lessons

- `InkSessionApp` is now owner-picker-free and typechecked without `ts-nocheck`. Do not add `CliOwnerSummary`, `activeOwner`, `skipOwnerPicker`, `/owner`, selected-owner startup, or owner-scoped source calls back to the TUI.
- `pibo tui:sessions` starts directly at the app-global room picker (or opens an explicit Pibo Session ID). Room/session flows pass only resource ids; slash execution no longer receives owner parameters.
- `/profile` is a neutral alias-style UI path for selecting an existing agent/profile, not an owner/context picker.
- `src/session-ui/ownerViewModel.ts` was deleted. Shared room/session/status descriptors must not carry owner fields; terminal status cards should show session/profile/model/runtime facts only.
- The active PTY smoke scenario is `room-session-message`; it must not use `--owner-scope` or `PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS`. Useful regression command inside Docker: `node scripts/ink-cli-v2-pty-smoke.mjs --scenario room-session-message --artifact-root /workspace/.tmp/us021-pty-final`.
- Useful US-021 regression gate: `rg -n "CliOwnerSummary|buildOwnerPickerDescriptor|getActiveOwner\\(|setActiveOwner\\(|listOwners\\(|activeOwner|owner picker|Select effective owner|selected owner|session_owner_mismatch|--owner-scope|PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS|Personal Chat|ownerScope" src/apps/cli-ui src/session-ui scripts/ink-cli-v2-pty-smoke.mjs test/cli-ui-session-app.test.mjs test/session-ui-view-models.test.mjs test/cli-ui-ink-renderer.test.mjs test/ink-cli-v2-pty-smoke.test.mjs` should return no matches.

## US-022 final cutover inspect/dry-run lessons

- `pibo data final-cutover inspect|dry-run` is the new operator-only final app-space cutover preview command. It requires `--root` or `PIBO_MIGRATION_SANDBOX_HOME`; it must not fall back to normal `PIBO_HOME` or `~/.pibo`.
- `inspectFinalAppSpaceCutoverMigration()` refuses `/root/.pibo` and paths under it. Keep this refusal until a separate human-approved production flag is designed outside the autonomous Ralph loop.
- The command opens affected SQLite DBs read-only and reports affected files, legacy columns/indexes, row counts, redacted legacy values, conflict groups, and dry-run plans. It intentionally does not run SQLite `quick_check` because the copied sandbox contains a very large `pibo.sqlite`; quick checks belong to backup/apply/post-check stories.
- Legacy value summaries redact user-derived values with short hashes while leaving the known historical shared-app literal visible for conflict review. Do not dump arbitrary JSON, prompts, messages, profile names, or auth identities in migration reports.
- Current dry-run conflict detection covers duplicate default rooms, duplicate navigation rows, duplicate Custom Agent profile names, and legacy Ralph/Cron personal/principal target shapes. US-023 apply must keep these decisions aligned when it performs transactional rebuilds.
- Docker sandbox validation for US-022 found copied migration sandbox totals: 6 affected DBs, 19 legacy columns, 15 legacy indexes, 4349 legacy rows, 1 conflict group, and 20 dry-run planned actions with no unresolved blockers. These are sandbox-copy facts only, not Production mutation.

## US-023 final cutover apply lessons

- `pibo data final-cutover apply` is backup-gated and isolated-root-only: it requires `--root` plus `--backup`, refuses `/root/.pibo` through the final-cutover root guard, and requires backup copies outside the target root for every existing affected SQLite DB.
- Backup verification opens each matching backup DB read-only and requires `PRAGMA quick_check = ok` before any target write. Keep this requirement for future sandbox/Production cutover work.
- Apply runs one `BEGIN IMMEDIATE` transaction per database. If a database-level rebuild fails, that database rolls back before later files are processed.
- Apply reuses the final migration decisions from dry-run: duplicate Chat defaults keep the newest non-archived default, duplicate `session_navigation` keeps the newest row per `session_id`, principal read-state merges into app read-state, Custom Agent profile-name collisions rename older rows with deterministic `-legacy-<hash>` suffixes, and Ralph/Cron legacy personal/principal targets normalize to `default-chat`.
- Post-check evidence includes row-count checks for every affected table, post-apply `PRAGMA quick_check`, a JSON report under `<root>/migration-reports/`, and rollback instructions pointing at the verified backup path.
- US-023 intentionally validated apply only against Docker temp fixture homes/backups. Do not run apply against the copied migration sandbox unless using an extra sandbox copy and a verified backup path; never run it against host `/root/.pibo` inside this Ralph loop.

## US-024 runtime compatibility removal lessons

- Normal runtime/source no longer carries pre-cutover Owner Scope compatibility. Do not add `src/owner-scope-compat.ts` or the old `pibo data shared-app` normalization framework back; legacy product data handling belongs in `src/data/final-app-space-cutover-migration.ts` and its tests only.
- Store constructors should assume ownerless schemas after final cutover. If old DBs fail, run/review the final-cutover inspect/dry-run/apply path in an approved isolated/Production process instead of reintroducing runtime table rebuilds.
- `loadPiboUserSettings()` and `updatePiboUserSettings(patch)` are app-level settings APIs. Do not pass auth user ids, principals, or synthetic storage keys into settings callers.
- Compute worker technical labeling is now `holder` / `pibo.compute.holder`; avoid `ownerScope` even for non-product Docker metadata because it trips product vocabulary gates and confuses agents.
- Fresh ownerless runtime regression lives in `test/ownerless-fresh-runtime-regression.test.mjs`; it is the quick proof that new sessions, rooms, agents, projects, annotations, Ralph, Cron, and workflow runs can be created without owner/principal payloads.
- Useful US-024 source gate: `rg -n "owner_scope|principal_id|shared:app|legacyOwnerScopeForPreCutoverSchemas|ownerScope" src packages --glob "*.ts" --glob "!src/data/final-app-space-cutover-migration.ts"` should return no matches. Current historical tests/docs still need cleanup in US-025/US-026/US-029.

## US-025 docs/help cleanup lessons

- Current canonical docs should teach the one app-space model: auth grants access only and does not partition visibility, routing, workspace, jobs, read-state, profiles, or write location.
- Superseded plans/specs that still teach older account-partition or personal-target behavior now live under `docs/legacy/`; do not move them back into `docs/project`, `docs/specs`, or `docs/plans` unless they are rewritten for the final app model.
- `scripts/legacy-product-vocabulary-gate.mjs` has a temporary final-removal documentation allowlist because the active Ralph batch docs necessarily record removed historical vocabulary. The reviewed allowed current-doc files are limited to the final-removal plan, text PRD, and PRD JSON. After user-approved cutover/archival, shrink this allowlist again.
- Built tool guides must not teach removed partition flags. Ralph examples should use `--room` or the default-chat target; Web Annotation docs should describe app resources keyed by Pibo Session/resource metadata.
- Useful US-025 current-docs gate: `node scripts/legacy-product-vocabulary-gate.mjs --roots GLOSSARY.md,docs/project,docs/specs,docs/plans,skills,src/tools/guides.ts --json` should have zero failures; allowed matches should be only final-removal implementation docs until they are archived.

## US-026 full validation lessons

- After US-024 removed normal runtime compatibility for historical owner/principal schemas, tests must not expect runtime stores to rebuild old owner columns. Historical schema/data assertions belong in `test/final-app-space-cutover-migration.test.mjs`; active store tests should cover fresh ownerless schemas and app-global records only.
- Full `npm test` now passes in Docker after stale compatibility tests were removed or rewritten: 895 tests / 4 suites / 895 pass / 0 fail.
- User settings are app-level in `user-settings.json` under `settings`; tests should not expect per-user or synthetic-owner keyed settings maps.
- Compute worker metadata uses `holder` / `pibo.compute.holder`; do not reintroduce compute `ownerScope` labels.
- Historical spec docs moved by US-025 should be read from `docs/legacy/...` in tests that intentionally validate old traceability artifacts.
- Fresh-home schema inventory should check product Owner Scope artifacts (`owner_scope`, `principal_id`, `room_members`, `principal_session_stats`, `principal_room_stats`). Technical run-control fields such as `ownerPiboSessionId` are session-control ownership, not product Owner Scope, but US-029 should still decide whether broader technical owner terminology needs more cleanup or explicit exception documentation.

## US-027 migrated sandbox validation lessons

- For sandbox apply validation, copy the Docker migration sandbox to a separate target such as `/workspace/.tmp/us027-migrated-home` and pass the original `/workspace/.pibo/ralph-migration-sandbox` as the required external backup. Do not mutate the original sandbox unless a later task explicitly calls for that.
- Full copied-sandbox apply on the current data set took about 18.5 minutes including the large `pibo.sqlite` copy and backup/post-apply checks. Use a yielded/background run for this step.
- Worker-local Chat Web validation can start `runWebGatewayServer({ devAuth: true, web: { host: "127.0.0.1", port: <worker-local-port> } })` with `PIBO_HOME` set to the migrated copy. Log in through `/api/auth/sign-in/social` followed by the callback redirect and pass the `pibo_dev_session` cookie to Chat/API requests.
- The provider-free Chat send-equivalent path for validation is `/api/chat/debug/streaming-fixture` with `preludeOnly: true`; it exercises selected session/room resolution and stream fixture handling without invoking an external model provider.
- API payload validation should recursively reject `ownerScope`, `owner_scope`, `principalId`, and `principal_id` keys across bootstrap, rooms/sessions, agents, projects, workflows, Ralph, Cron, and Web Annotation responses.
- Ralph/Cron CLI validation against a migrated copy can safely create disabled/default-chat jobs and recursively scan JSON outputs. Use `pibo ralph add --default-chat --profile base ... --json` and `pibo cron add --default-chat --agent base ... --disabled --json`.
- The reusable Ink PTY smoke script intentionally creates its own deterministic fixture home for `room-session-message`; it validates the owner-picker-free TUI path, while separate CLI JSON/API checks validate the migrated copied data home.

## US-028 Docker deployment/runbook lessons

- Docker-only deployment validation should use the built `dist/gateway/web.js` with `runWebGatewayServer({ devAuth: true, web: { host: "0.0.0.0", port: 4788 } })` and `PIBO_HOME=/workspace/.pibo/ralph-test-home`; this exercises the worker web port mapped to host `4832` without touching host gateways.
- A safe gateway restart check is process-level inside the worker: start the worker-local gateway, dev-auth login, fetch `/api/chat/bootstrap`, stop the process, start it again, and repeat. Do not call `pibo gateway web restart` or `pibo gateway dev restart` from this loop.
- The US-028 runbook report is `docs/reports/final-owner-scope-deploy-cutover-runbook-us-028.md`. It is the source for future manual cutover sequencing: review gate, backup gate, dry-run gate, apply gate, deploy/restart gate, post-checks, rollback, and optional temporary migration module removal after approved cutover.
- The autonomous Ralph loop must still stop before upstream PR creation and before any real Production database migration. US-030 should reuse the US-028 runbook rather than creating a new cutover sequence from scratch.

## US-029 zero-regression sweep lessons

- `npm run check:product-vocab` now defaults to active product roots (`src`, `packages`, `scripts`, `skills`, `docs/project`, `docs/specs`, `docs/plans`) so negative assertions and historical fixture literals in `test/` do not mask active product regressions. Keep test coverage for migration and no-owner-payload assertions in `npm test`; do not use tests as product behavior docs.
- Active-source residual vocabulary after US-029 is limited to the final-removal implementation docs and `src/data/final-app-space-cutover-migration.ts`. The temporary implementation-doc allowlist should be shrunk after user-approved archival/cutover.
- Technical helper names can trip product-vocabulary gates even when they refer to controller/run ownership rather than product Owner Scope. Prefer neutral names such as `getSessionForController`, `requireRunForController`, and `holder` for active source.
- Worker-local API sweeps can reuse a built `dist/gateway/web.js` dev-auth server on an isolated worker port and recursively scan JSON keys for owner/principal fields across Chat bootstrap, agents, projects, workflows, Ralph, Cron, and Web Annotations without touching host gateways.
