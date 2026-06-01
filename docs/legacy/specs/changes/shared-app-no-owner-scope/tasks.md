# Tasks: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Related spec:** `docs/specs/changes/shared-app-no-owner-scope/spec.md`

## Phase 0: Branch and Baseline

- [ ] Start from current `upstream/dev` in a dedicated worktree/branch.
- [ ] Decide how to carry forward the existing shared-app compatibility hotfix.
- [ ] Record current `git status` and separate unrelated docs/plans from this change.
- [ ] Run baseline checks before implementation:
  - [ ] `npm run build`
  - [ ] relevant existing tests for Chat Web, sessions, Ralph, Cron, projects, and annotations.
- [ ] Capture current owner/principal inventory with `rg` and database count reports.

## Phase 1: Shared App Contract and Auth Boundary

- [ ] Add or rename a neutral shared-app context helper for new code.
- [ ] Keep `SHARED_APP_SCOPE` only as legacy storage/migration compatibility, if still needed.
- [ ] Change web auth/session types so account id is not a product owner.
- [ ] Remove account-derived owner-scope generation from `requireWebSession` consumers.
- [ ] Update runtime session context so agents do not receive user ownership semantics.
- [ ] Add tests proving two allowed accounts resolve to the same app context.

## Phase 2: Chat Web Sessions and Rooms

- [ ] Rename or replace `listOwnedSessions`, `requireOwnedSession`, and related helpers.
- [ ] Remove owner equality from direct session open, bootstrap, send, fork/clone, archive/restore, and room assignment paths.
- [ ] Remove or neutralize room membership checks.
- [ ] Make sidebar room/session listings app-global.
- [ ] Decide and implement read-state behavior: app-global or browser-local.
- [ ] Update Chat Web tests for mixed historical `shared:app` + `user:*` data.
- [ ] Browser/API validate historical recovery session access on Dev.

## Phase 3: App-Global Product Resources

- [ ] Custom Agents: remove owner-scoped list/get/create/update/delete behavior.
- [ ] Projects: remove owner-scoped personal project behavior or replace with app-global default project behavior.
- [ ] Workflows: remove owner-scoped drafts, assets, lifecycle events, and run filters.
- [ ] Web Annotations: remove owner-scoped annotation/binding behavior.
- [ ] Settings/provider/config surfaces: verify no account-derived product partition remains.
- [ ] Add tests showing Account B sees resources created by Account A.

## Phase 4: Automation and CLI/API Cleanup

- [ ] Ralph: remove required `--owner-scope` from normal commands.
- [ ] Ralph: convert `personal` targets to app-global targets or a neutral equivalent.
- [ ] Ralph: make existing `shared:app` and `user:*` jobs jointly visible before mutation.
- [ ] Cron: remove owner-scoped job creation, listing, and control.
- [ ] Debug/data CLIs: keep legacy owner inspection only behind explicit migration/debug commands.
- [ ] API payloads: remove or deprecate owner/principal fields from normal requests/responses.
- [ ] Update CLI help to preserve progressive discovery without owner-scope teaching.

## Phase 5: Data Migrations

- [ ] Build a migration inspector that reports owner/principal counts by store/table.
- [ ] Add mandatory backup creation for mutation mode.
- [ ] Add dry-run mode that prints planned changes and conflicts without writes.
- [ ] Migrate `pibo.sqlite`:
  - [ ] `sessions`
  - [ ] `rooms`
  - [ ] `session_navigation`
  - [ ] `room_members`
  - [ ] `principal_session_stats`
  - [ ] `principal_room_stats`
- [ ] Migrate `chat-agents.sqlite`.
- [ ] Migrate `pibo-ralph.sqlite`.
- [ ] Migrate `pibo-cron.sqlite`.
- [ ] Migrate `web-annotations.sqlite`.
- [ ] Migrate `web-projects.sqlite`, if still used.
- [ ] Migrate workflow persistence stores.
- [ ] Add idempotency tests for each migration.
- [ ] Add conflict fixture tests for default rooms, navigation/read-state, and custom-agent profile names.

## Phase 6: Schema, Types, and Search Gates

- [ ] Remove or neutralize owner/principal columns from fresh schemas after behavior no longer depends on them.
- [ ] Remove `room_members` from fresh schema or mark as legacy-only pending migration.
- [ ] Remove owner-scoped indices.
- [ ] Remove `ownerScope` and account-derived `principalId` from product TypeScript types.
- [ ] Remove active `getOwned*`, `listOwned*`, `requireOwned*`, and `requireRoomAccess` semantics.
- [ ] Add an allowlisted search gate for active code:
  - [ ] `ownerScope`
  - [ ] `owner_scope`
  - [ ] `principalId`
  - [ ] `principal_id`
  - [ ] `room_members`
  - [ ] `getOwned`
  - [ ] `listOwned`
  - [ ] `requireOwned`
  - [ ] `personal target`
- [ ] Ensure remaining matches are migration, legacy debug, or unrelated technical terms with comments.

## Phase 7: Documentation and Product Text

- [x] Update `GLOSSARY.md` to mark `Owner Scope` as legacy and define the shared app context.
- [x] Update capability specs:
  - [x] `web-auth-and-same-origin-host.md`
  - [x] `chat-web-rooms-and-event-streams.md`
  - [x] `pibo-session-routing.md`
  - [x] `pibo-session-store.md`
  - [x] `custom-agents.md`
  - [x] `continuous-ralph-jobs.md`
  - [x] `scheduled-pibo-jobs.md`
  - [x] `local-store-ownership-and-canonical-data-boundaries.md`
- [ ] Move obsolete owner-isolation docs to `docs/legacy/` or rewrite them as migration history.
- [x] Update UI copy that says `Personal Chat`, `personal target`, `owner`, `owned`, `principal`, or equivalent.
- [x] Update tests/fixtures/docs that still teach account ownership as current behavior.

## Phase 8: Dev Validation

- [x] Deploy to Dev with `./scripts/deploy-web-dev.sh`.
- [x] Restart Dev through `pibo gateway dev restart`.
- [x] Verify Dev status with `pibo gateway dev status`.
- [x] API validate bootstrap/open for:
  - [x] historical `shared:app` session,
  - [x] historical `user:*` session,
  - [x] newly created shared-app session.
- [x] Browser validate sidebar and direct session open.
- [x] Validate cross-account behavior if two allowed test accounts are available. (Covered through the user-approved Docker dev-auth shared-app validation path.)
- [x] Save Dev validation report under `docs/reports/`.

## Phase 9: Production Rollout

- [ ] Ask user approval before Production deploy.
- [ ] Deploy with `./scripts/deploy-web.sh` only after Dev validation passes.
- [ ] Restart Production through `pibo gateway web restart`; use force only with explicit approval if active sessions block restart.
- [ ] Verify Production gateway status.
- [ ] Run migration dry-run against Production data and save report.
- [ ] Ask user approval before mutation migration.
- [ ] Run mutation migration with backups.
- [ ] Verify:
  - [ ] recovery session opens,
  - [ ] current session opens,
  - [ ] sidebar shows unified history,
  - [ ] Ralph/Cron/jobs are visible,
  - [ ] custom agents/projects/workflows are visible.
- [ ] Save Production validation report under `docs/reports/`.

## Phase 10: PR Preparation

- [ ] Ensure branch contains only this change and approved hotfix carry-forward.
- [ ] Run final build/test/search gates.
- [ ] Review diff for unrelated edits.
- [ ] Commit focused changes.
- [ ] Push branch to `origin`.
- [ ] Open PR against `upstream/dev`.
- [ ] Include migration/rollback notes and Dev validation report in PR description.
