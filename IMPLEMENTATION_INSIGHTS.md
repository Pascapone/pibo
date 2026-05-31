# Final Owner Scope Removal Implementation Insights

This file is mandatory reading at the start of every Ralph session. Keep durable findings here so later sessions do not rediscover the same facts.

## Product invariants

- The final product has exactly one product data space: the app.
- Auth is only an access gate. It must not decide product visibility, ownership, routing, workspace selection, profile registration, job control, read-state, or write location.
- `shared:app` is not the target model. It is a legacy storage value that must disappear from active runtime code and fresh schemas after the final cutover.
- Do not replace Owner Scope with another synthetic owner value.
- Better Auth tables and sessions are out of scope for removal; they remain auth/access state, not product ownership state.
- Production data mutation, Production migration apply, Production deploy, and Production restart are forbidden unless the user gives separate explicit approval at that time.

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
- Worker sandbox Pibo home: `/workspace/.pibo/ralph-sandbox` in the container; host path `/root/code/pibo/.worktrees/final-owner-scope-removal-ralph/.pibo/ralph-sandbox`.
- Use `.pibo/ralph-worker.sh '<command>'` from the worktree to run worker commands with `PIBO_HOME=/workspace/.pibo/ralph-sandbox`.
- Do not run migration tests or exploratory data commands against `/root/.pibo`.

## Docker and worktree facts

- Host worktree: `/root/code/pibo/.worktrees/final-owner-scope-removal-ralph`.
- Branch: `final-owner-scope-removal-ralph`.
- Base: `upstream/dev` at `f0c588e`.
- Docker worker: `pibo-dev-final-owner-scope-removal-ralph`.
- Container workspace: `/workspace`.
- Ports: gateway `4830`, CDP `4831`, web `4832`, Chat UI `4833`, Context UI `4834`.
- Git commands must run on the host worktree. The Docker worker may not resolve host worktree Git metadata.
- Use Docker for builds, tests, gateway/browser checks, PTY checks, and runtime validation.
- Do not create/release/replace Docker workers unless the user explicitly asks.

## Implementation strategy

- Prefer dependency order from the PRD JSON: gates/baseline, app context/auth/runtime, sessions/schemas, Chat rooms/navigation, feature stores, Ralph/Cron, workflows, CLI/TUI, migration tooling, docs, validation.
- Keep changes small and story-scoped. Commit each completed story or coherent story group.
- Mark a story `passes: true` only after code, tests, validation evidence, and notes are complete.
- For user-facing Web/CLI/TUI/runtime/persistence changes, use the closest practical real/default path, not only mocks.
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
