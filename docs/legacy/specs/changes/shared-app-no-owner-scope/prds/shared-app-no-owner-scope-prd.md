# PRD: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Source:** User request to remove user/owner-scoped product behavior and move Pibo to one shared app space.  
**Related spec:** `../spec.md`  
**Ralph story batch:** `shared-app-no-owner-scope.prd.json`

## 1. Executive Summary

### Problem Statement

Pibo still contains account-derived owner and principal boundaries in code, database schemas, tests, CLI/API contracts, and docs. This causes old `shared:app` sessions and newer `user:*` sessions to diverge, hide from each other, or require compatibility patches.

### Proposed Solution

Convert Pibo to a single shared app space. Authentication remains required, but it only gates access to the app. After login, every allowed account sees and operates on the same sessions, rooms, working directories, agents, projects, workflows, Ralph jobs, Cron jobs, settings, diagnostics, and persisted history.

### Success Criteria

- **SC-001 Shared visibility:** Two allowed accounts see the same Chat Web rooms, sessions, agents, projects, workflows, Ralph jobs, Cron jobs, settings, and diagnostics.
- **SC-002 No account-derived writes:** New product records never use the authenticated user id as owner, principal, workspace selector, routing selector, profile-registration selector, or job-control selector.
- **SC-003 Historical access:** Existing `shared:app` and `user:*` sessions open through sidebar navigation, direct bootstrap, message send, fork/clone, and debug paths.
- **SC-004 Migration safety:** All affected stores support backup, dry-run, conflict reporting, idempotent mutation, and post-migration verification.
- **SC-005 Artifact removal:** Active product code, fresh schemas, CLI help, API contracts, tests, and current docs no longer teach owner/principal isolation. Remaining references are explicitly legacy migration/debug evidence or archived docs.

## 2. User Experience & Functionality

### User Personas

- **Allowed Pibo user:** A person who can log in and use the shared app instance.
- **Operator/maintainer:** A person or agent who deploys, migrates, validates, and debugs the host.
- **Ralph implementation agent:** An autonomous implementation loop that needs small stories, clear acceptance criteria, and verifiable stop conditions.

### Product Rule

There is no user space. There is one shared app space for the host. Login proves access; it does not create ownership, isolation, or separate working state.

### User Stories and Acceptance Criteria

#### Story 1: Access gate without data partition

As an allowed Pibo user, I want login to grant access to the shared app so that I can continue all work on the host regardless of which account created it.

Acceptance criteria:

- Unauthenticated web requests still fail with `401` where auth is required.
- Authenticated requests do not fail with `403` or `404` only because a resource was created under another account-derived owner value.
- `PiboWebSession` and downstream handlers do not expose account-derived owner scope as product state.
- Runtime context does not tell agents that the current auth account owns product data.
- Tests cover two allowed auth identities resolving to the same app context.

#### Story 2: Shared Chat Web history

As an allowed Pibo user, I want the same rooms and sessions in Chat Web that every other allowed user sees so that the host has one conversation history.

Acceptance criteria:

- Sidebar room/session lists include historical `shared:app` and `user:*` records before migration.
- Direct session bootstrap opens both historical `shared:app` and `user:*` sessions.
- Sending a message appends to an existing session regardless of historical owner value.
- Fork, clone, archive, restore, delete, and room assignment use resource existence and state, not owner equality.
- Room membership no longer controls access.
- `Personal Chat`/personal copy is removed or renamed to shared/default wording.
- Browser or API validation proves the recovery session and current session open after deploy.

#### Story 3: Shared workspace and working directories

As an allowed Pibo user, I want the same working directories and runtime workspace assumptions as every other allowed user so that account changes do not move or split work.

Acceptance criteria:

- Session creation, routed runtime startup, subagent creation, workflow runs, Ralph runs, and Cron-triggered runs do not derive working directory from auth user id.
- Existing workspace/project selection remains stable after login with another allowed account.
- Tests or debug validation prove a session created by one account can be continued by another without workspace change caused by account identity.

#### Story 4: Shared product resources

As an allowed Pibo user, I want agents, projects, workflows, annotations, settings, tools, skills, MCP configuration, Pi packages, and provider settings to be shared so that the host behaves as one configured app.

Acceptance criteria:

- Custom Agents are listed, edited, archived/restored, deleted, and registered as profiles without owner filters.
- Projects and workflow resources are listed and mutated without owner filters.
- Web annotations are app-global.
- Settings/provider/tool/profile resources do not partition by auth account.
- Tests show Account B can see and use resources created by Account A.

#### Story 5: Shared automation

As an operator, I want Ralph, Cron, scheduled work, and yielded-run product state to be shared so that automation does not disappear under another account.

Acceptance criteria:

- Ralph job/run creation, listing, inspection, start, stop, cancel, cleanup, and resource visibility are app-global.
- Cron job creation, listing, enable/disable, execution, and history are app-global.
- Normal Ralph and Cron CLI/API flows do not require `--owner-scope`.
- Deprecated owner-scope options, if temporarily accepted, warn or no-op and do not change behavior.
- Tests cover mixed historical `shared:app` and `user:*` Ralph/Cron records.

#### Story 6: Safe data migration

As an operator, I want safe migrations for all historical owner/principal data so that the host converges to one shared app state without losing work.

Acceptance criteria:

- Migration inspection reports counts by store, table, and legacy owner/principal value.
- Mutation mode refuses to run without a fresh backup.
- Dry-run mode reports planned changes and conflicts without writes.
- Mutation mode is transactional and idempotent.
- Conflicts are resolved deterministically before owner/principal values are removed or neutralized.
- Post-check verifies row counts, sample resource opens, and no hidden sessions.

#### Story 7: Final cleanup and documentation

As a maintainer, I want old owner/principal artifacts removed from active code and current docs so that future work cannot accidentally rebuild user-space isolation.

Acceptance criteria:

- Fresh schemas do not create owner-scope or room-membership product boundaries.
- Active product TypeScript models do not require `ownerScope` or account-derived `principalId`.
- Current CLI help, API docs, UI copy, tests, and capability specs describe the shared app model.
- Search gates allow owner/principal terms only in explicit legacy migration/debug evidence or archived documentation.
- Dev and Production validation reports are saved under `docs/reports/`.

### Non-Goals

- No teams, roles, admins, per-resource permissions, or multi-tenant isolation.
- No account-scoped audit product feature.
- No unrelated security hardening in this PRD.
- No broad UI redesign except removing owner/personal wording.
- No Pi Coding Agent rewrite unless a Pibo-owned owner-scope seam requires it.

## 3. AI System Requirements

### Tool Requirements

The Ralph implementation loop needs:

- File/code search with `rg`.
- TypeScript editing and test execution.
- SQLite inspection and synthetic migration fixture creation.
- Pibo CLI discovery for Ralph, Cron, debug, gateway, and data commands.
- Docker worker execution for builds, tests, dev gateway, and browser validation.
- Browser/CDP validation for Chat Web where available.

### Evaluation Strategy

Ralph must not mark the loop complete until all global gates pass:

- Build/type gates pass.
- Focused unit/integration tests pass.
- Migration tests pass with dry-run, mutation, conflict, idempotency, and backup checks.
- Search gates prove no active owner/principal product boundary remains.
- Dev deployment and real-path API/browser validation pass.
- Production rollout steps are documented and gated by user approval.

For incomplete work, Ralph should update `IMPLEMENTATION_PROGRESS.md`, commit completed coherent batches only, and omit the completion marker.

## 4. Technical Specifications

### Architecture Overview

The target flow is:

1. User authenticates through the existing web auth mechanism.
2. Auth middleware returns valid login identity for display/logout only.
3. Product handlers operate in the shared app context.
4. Stores list and mutate resources by resource ids and app-global selectors.
5. Runtime routing, profile selection, workdir selection, and automation do not use auth user id.
6. Legacy owner/principal data remains jointly readable until migration normalizes it.
7. Final schemas and active code remove owner/principal product boundaries.

### Integration Points

Affected areas include:

- `src/web/auth.ts` and web session types.
- `src/apps/chat/web-app.ts` and Chat Web API/bootstrap/send paths.
- Rooms, sessions, session navigation, stats/read-state, and room membership stores.
- Custom Agent store and dynamic profile registration.
- Project and workflow persistence.
- Ralph job/run stores, resource cleanup, CLI, and API surfaces.
- Cron schedule stores, CLI, and API surfaces.
- Web Annotations stores and tools.
- Runtime context, subagent routing, session router/store, and debug commands.
- SQLite schemas and migrations in all affected stores.
- Current capability specs, glossary, and product docs.

### Security & Privacy

- Auth remains required for web app access.
- Removing cross-account isolation is intentional product behavior, not a bug.
- Do not expose auth tokens, provider credentials, or unrelated secrets in migration reports, tests, docs, or Ralph prompts.
- Do not close unrelated security findings as part of this PRD.
- Debug and migration commands may show legacy owner values only as technical evidence.

### Data Migration Requirements

Affected stores must be inspected and migrated where applicable:

- `pibo.sqlite`: sessions, rooms, navigation, room membership, principal stats.
- `chat-agents.sqlite`: custom agents and profile registration metadata.
- `pibo-ralph.sqlite`: jobs, runs, resources, facts, personal targets.
- `pibo-cron.sqlite`: schedules, executions, ownership metadata.
- `web-annotations.sqlite`: annotations and bindings.
- `web-projects.sqlite`: project metadata, if still active.
- Workflow persistence stores: drafts, assets, runs, lifecycle events.

### Conflict Rules

- Keep globally unique ids stable.
- Merge duplicate navigation/read-state by latest update timestamp.
- Merge or retire duplicate default rooms; canonical display name should be shared/default, not personal.
- Preserve conflicting custom-agent definitions by deterministic rename if global profile names collide.
- Keep active job/run ids stable; do not mutate live-running jobs unless the migration can prove safety.

## 5. Risks & Roadmap

### Phased Rollout

#### MVP: Compatibility and write-path conversion

- Auth no longer creates account-derived product owner state.
- Chat sessions, rooms, direct open, send, and sidebar all read mixed history.
- New writes use shared app behavior.

#### v1: Full active-code conversion

- Agents, projects, workflows, annotations, settings, Ralph, Cron, and debug paths are app-global.
- CLI/API contracts no longer require owner/principal values.
- Search gates prevent regressions.

#### v1.1: Migration and schema cleanup

- Dry-run and mutation migrations converge existing stores.
- Fresh schemas remove owner/principal boundaries.
- Docs and tests describe the shared-app model.

#### Rollout

- Validate locally.
- Deploy/test on Dev.
- Produce Dev validation report.
- Ask user before Production deploy.
- Ask separately before Production migration mutation.
- Produce Production validation report.

### Technical Risks

- **Hidden owner checks:** Residual owner filters can make resources disappear after migration.
- **Unique constraint collisions:** Blind normalization can fail or overwrite data.
- **Active runtime mutation:** Migrating active jobs/sessions can interrupt work.
- **Scope creep:** Adding permissions or roles would contradict the target model.
- **Incomplete docs cleanup:** Future agents may reintroduce owner-scope behavior if current docs remain stale.

## Required Test and Validation Gates

### Always Run Before PR Review

- `npm run typecheck`
- `npm run build`
- `npm test`
- Focused tests added or updated by the implementation.
- Owner/principal artifact search gate with an allowlist.

### Focused Existing Test Areas

Run relevant tests as code changes touch them:

- Auth: `test/better-auth-config.test.mjs`, `test/dev-auth.test.mjs`
- Chat API/UI: `test/chat-api-routes.test.mjs`, `test/chat-ui-app-bootstrap-mutations.test.mjs`, `test/chat-ui-app-route-selection.test.mjs`, `test/chat-ui-app-routes.test.mjs`, `test/chat-ui-app-session-model.test.mjs`, `test/chat-ui-app-navigation-merge.test.mjs`, `test/chat-ui-composer-send.test.mjs`
- Sessions/router/store: `test/session-store.test.mjs`, `test/session-router-store.test.mjs`, `test/session-actions.test.mjs`, `test/pibo-data-session-store.test.mjs`
- Agents/projects/workflows: `test/agent-store.test.mjs`, `test/agent-profiles.test.mjs`, `test/project-service-workflow-link.test.mjs`, workflow tests touched by the change
- Ralph/Cron: `test/ralph-resource-visibility.test.mjs`, `test/ralph-resource-cleanup.test.mjs`, `test/ralph-resource-metadata.test.mjs`, `test/cron-store-lifecycle.test.mjs`, `test/cron-schedule-store.test.mjs`, `test/chat-cron-api.test.mjs`
- Web annotations: `test/web-annotations-store.test.mjs`, `test/web-annotations-tools.test.mjs`, `test/web-annotations-cdp-api.test.mjs`
- CLI/TUI where touched: `test/cli-session-source.test.mjs`, `test/cli-ui-session-app.test.mjs`

### New Tests Required

- Cross-account shared visibility test for Chat Web bootstrap/list/send.
- Cross-account custom-agent visibility and profile registration test.
- Cross-account project/workflow visibility test.
- Cross-account Ralph and Cron visibility/control test.
- Migration dry-run/mutation/idempotency tests for each affected SQLite store.
- Conflict tests for duplicate default rooms, navigation/read-state collisions, and custom-agent profile name collisions.
- Fresh-schema test proving owner/principal access-control artifacts are absent.
- Search-gate test for active owner/principal boundary terms.

### Real-Path Validation Required

- Dev deploy with `./scripts/deploy-web-dev.sh`.
- Dev gateway restart via `pibo gateway dev restart`.
- API validate bootstrap/open/send for:
  - historical `shared:app` session,
  - historical `user:*` session,
  - newly created shared-app session.
- Browser validate Chat Web sidebar and direct session open.
- Validate Ralph and Cron list/control commands through the real CLI without owner-scope.
- Production deploy and migration only after explicit user approval.

## Definition of Done

This PRD is complete only when:

- All success criteria pass.
- All required test/validation gates pass or have documented user-approved exceptions.
- No active product path partitions data by auth account.
- Fresh installs use the shared app model.
- Existing mixed data is migrated or safely readable with no hidden sessions/resources.
- Current docs and user-facing strings no longer describe user-owned product state.
- PR includes migration, rollback, Dev validation, and Production rollout notes.
