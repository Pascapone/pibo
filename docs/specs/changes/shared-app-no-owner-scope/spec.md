# Spec: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Owner / Source:** User request in Pibo session `ps_43d015b4-e9af-4502-8bb5-3ef266a0392e`  
**Related docs:** `docs/specs/changes/shared-app-no-owner-scope/proposal.md`, `docs/specs/changes/shared-app-no-owner-scope/design.md`, `docs/specs/changes/shared-app-no-owner-scope/tasks.md`, `docs/plans/no-owner-scope-shared-app-umbauplan-2026-05-28.md`, `GLOSSARY.md`

## Why

Pibo currently mixes two product models. Some records use the old shared value `shared:app`; other records use account-derived values such as `user:<auth-user-id>`. The UI and APIs have compatibility gaps because some paths list both models while other paths still require strict owner equality.

The target product model is a shared Pibo app instance. Authentication decides whether a person may enter the app. Authentication must not decide which rooms, sessions, agents, workflows, jobs, projects, settings, or diagnostics exist for that person.

## Goal

Pibo MUST operate with one shared app context after login, with no account-derived owner or principal value used as a product data boundary.

## Background / Current State

Current code and data still contain many owner/principal artifacts:

- `ownerScope`, `owner_scope`, `principalId`, and `principal_id` fields in product models, stores, tests, and docs.
- `room_members`, `principal_session_stats`, and `principal_room_stats` tables.
- `getOwned*`, `listOwned*`, and `requireOwned*` methods.
- Chat Web, Ralph, Cron, Projects, Workflows, Web Annotations, Custom Agents, and CLI Session UI paths that still pass owner or principal values.
- Production data split across `shared:app` and at least one `user:*` owner value.

A compatibility hotfix can make mixed sessions readable, but it does not remove the old product boundary.

## Scope

### In Scope

- Web auth contract after login.
- Chat Web sessions, rooms, navigation, read-state, projects, custom agents, workflows, settings, and diagnostics.
- Pibo Session routing and persisted session metadata owned by Pibo.
- Ralph jobs/runs, Cron jobs, yielded-run visibility where persisted product state is involved, and automation controls.
- Web Annotations and other app-local stores that currently persist owner/principal fields.
- CLI and API flags, inputs, outputs, help text, tests, and docs that expose owner-scope as product behavior.
- Backup-backed, dry-run-first migrations for mixed historical data.
- Schema cleanup after app-global read/write paths are verified.

### Out of Scope

- Team, role, admin, or permission systems — these would reintroduce a new access model.
- Multi-tenant isolation — this Pibo host is one shared app instance.
- Account-scoped audit history — login identity may appear in technical auth logs, but not as a product ownership feature.
- Unrelated security hardening — track separately.
- Broad UI redesign unrelated to owner/principal removal.

## Requirements

### Requirement REQ-001: One shared app context

The system MUST have exactly one product data context for the app instance.

#### Current

Product data is split by `shared:app` and `user:*` owner scopes. Some paths treat owner scope as access control or list filtering.

#### Target

All allowed accounts see and operate on the same product data set. A temporary constant such as `SHARED_APP_SCOPE = "shared:app"` may exist only for legacy migration and storage compatibility.

#### Acceptance

- Creating a resource while logged in as Account A makes it visible to Account B after login.
- New product writes do not use the authenticated user's id as owner, principal, route, profile, or job-control input.
- Remaining references to `shared:app` are marked as legacy/migration/internal storage compatibility.

#### Scenario: Cross-account visibility

- GIVEN Account A and Account B are both allowed to log in
- WHEN Account A creates a chat session, room, custom agent, project, workflow draft, Ralph job, or Cron job
- THEN Account B can list, open, edit, continue, or control the same resource according to normal resource state rules.

### Requirement REQ-002: Auth is only the app access gate

Web authentication MUST only determine whether the request may access the app.

#### Current

`requireWebSession` and related code expose account-derived owner-scope values that downstream product code uses for filtering and ownership.

#### Target

Auth returns login identity only for session validity, display, logout, and technical auth diagnostics. Product resource access does not derive from account id.

#### Acceptance

- Unauthenticated requests still receive `401` where auth is required.
- Authenticated requests do not receive `403` or `404` only because a resource was created under another account-derived owner value.
- Runtime context shown to agents does not describe the account as product owner.

#### Scenario: Open historical session

- GIVEN a historical session exists under `shared:app`
- AND the current user is logged in with a valid allowed account
- WHEN the user opens that session by id
- THEN Chat Web opens it if the session exists and is otherwise valid.

### Requirement REQ-003: Rooms and sessions are app-global

Rooms, Pibo Sessions, session navigation, and read-state MUST not be partitioned by account owner.

#### Current

Rooms and sessions carry `owner_scope`; room access can depend on ownership or membership; navigation/read-state can be keyed by principal.

#### Target

All rooms and sessions belong to the shared app context. Room membership no longer gates access. Navigation/read-state is either app-global or explicitly browser-local, but not account-owner-scoped.

#### Acceptance

- Sidebar lists the same rooms and sessions for all allowed accounts.
- Direct session open, bootstrap, fork/clone, archive/restore, and message send paths use existence/state checks, not owner equality.
- `room_members` is removed, ignored, or confined to legacy migration code.

#### Scenario: Continue another account's session

- GIVEN Account A created a session before or after the migration
- WHEN Account B opens the session and sends a message
- THEN the message appends to that session unless another normal session-state rule blocks the action.

### Requirement REQ-004: Product resources are app-global

Custom Agents, Projects, Workflows, Skills selections, Context Files, MCP configuration, Pi Packages, Provider settings, and Web Annotations MUST be app-global unless a separate spec explicitly defines a different non-account-scoped boundary.

#### Current

Several stores and UI paths accept or persist `ownerScope`, `principalId`, or personal project/agent targets.

#### Target

Resource identity, uniqueness, and visibility are global to the app instance. Account id does not decide which profile, project, or annotation is available.

#### Acceptance

- Custom Agent profile registration does not depend on the logged-in account.
- Project lists and workflow state are the same for every allowed account.
- Web annotations created by one allowed account are visible to another allowed account where the feature normally shows annotations.

#### Scenario: Shared custom agent

- GIVEN Account A creates a custom agent
- WHEN Account B opens Agent Designer
- THEN Account B sees the custom agent and can use it as a routed profile.

### Requirement REQ-005: Automation is app-global

Ralph jobs/runs, Cron jobs, scheduled Pibo work, and persisted automation controls MUST be visible and controllable at app scope.

#### Current

Ralph and Cron paths can contain `ownerScope`, personal targets, or account-specific persisted state.

#### Target

Automation belongs to the shared app context. CLI and API commands do not require owner-scope to list, start, stop, cancel, inspect, or update automation.

#### Acceptance

- `pibo ralph` and `pibo cron` workflows can be discovered and used without `--owner-scope`.
- Deprecated owner-scope flags, if kept during transition, are ignored with a clear deprecation message or accepted as no-ops.
- Existing jobs under `shared:app` and `user:*` are migrated or jointly visible before migration.

#### Scenario: Shared Ralph job control

- GIVEN Account A creates a Ralph job
- WHEN Account B lists Ralph jobs or stops the job through the supported UI/API/CLI
- THEN the same job is visible and controllable.

### Requirement REQ-006: APIs and CLIs do not expose ownership as product contract

Public or agent-facing Pibo APIs and CLI help MUST not require owner or principal values for normal product operations.

#### Current

Several commands, request payloads, response bodies, debug outputs, and help texts mention owner scope, owned resources, personal targets, principal ids, or membership.

#### Target

Current API and CLI contracts use resource ids, session ids, room ids, target ids, or app-global selectors. Owner/principal terms remain only in legacy migration/debug commands with explicit labeling.

#### Acceptance

- Normal commands for chat, sessions, rooms, projects, agents, workflows, Ralph, Cron, and debug do not require `--owner-scope`.
- Response payloads do not imply account ownership for shared resources.
- `--help` output follows progressive discovery and does not teach owner-scope as a current concept.

#### Scenario: CLI discovery

- GIVEN an agent starts from `pibo ralph --help`
- WHEN it follows the listed discovery commands
- THEN no required path asks for an owner scope to operate on normal Ralph jobs.

### Requirement REQ-007: Migration is safe, idempotent, and auditable

Data migration MUST protect existing production data and support dry-run inspection before mutation.

#### Current

The live data set is mixed. Blind normalization can hide data from old code or collide on unique constraints.

#### Target

Every migration has a backup, dry-run report, conflict handling, idempotent mutation, and post-check. Production mutation runs only after compatible code is deployed and verified.

#### Acceptance

- Migration tools produce counts by store/table and by legacy owner/principal value.
- Dry-run reports identify collisions before writes.
- Migrations merge or rewrite conflicting rows deterministically.
- Re-running a successful migration is safe.
- Rollback instructions identify the backup to restore.

#### Scenario: Mixed owner migration

- GIVEN `sessions`, `rooms`, and `session_navigation` contain both `shared:app` and `user:*` rows
- WHEN the migration runs in dry-run mode
- THEN it reports the rows to normalize, any collisions, and the proposed merge strategy without modifying the database.

### Requirement REQ-008: Schema no longer models account ownership

After read/write behavior no longer depends on owner-scope, schemas and types MUST remove or neutralize account-owner fields.

#### Current

Primary stores include owner/principal columns, room membership tables, and owner-scoped indices.

#### Target

New schemas avoid `owner_scope`, account-derived `principal_id`, `room_members`, and owner-scoped indices for product data. Legacy columns may remain only in explicit migration compatibility layers until removed by a later migration.

#### Acceptance

- New installs do not create owner-scope product boundaries.
- TypeScript product models do not require `ownerScope` or account-derived `principalId`.
- Remaining schema references are documented as legacy migration fields or unrelated technical identifiers.

#### Scenario: New install schema

- GIVEN a fresh Pibo home is initialized after the cleanup
- WHEN schema creation completes
- THEN product tables do not include owner-scoped access-control structures.

### Requirement REQ-009: Tests prove shared-app behavior

Automated tests MUST cover the shared-app contract and migration behavior.

#### Current

Tests include owner-scope fixtures and compatibility coverage but do not fully assert app-global behavior across accounts and stores.

#### Target

Tests create resources under distinct historical accounts and prove that all allowed accounts can see and operate on them after the change.

#### Acceptance

- Unit/integration tests cover mixed `shared:app` + `user:*` reads.
- Migration tests cover conflicts and idempotency.
- API tests cover authenticated cross-account access.
- Browser or debug-web validation covers Chat Web sidebar and direct session open.
- Search gates fail on unapproved active owner/principal product-boundary terms.

#### Scenario: Regression gate

- GIVEN code still contains active `requireOwned*` logic for Chat Web sessions
- WHEN the shared-app test suite runs
- THEN tests fail or the search gate flags the term unless the occurrence is in migration/legacy docs.

### Requirement REQ-010: Documentation matches the new model

Current docs, glossary, specs, and user-facing text MUST describe Pibo as a shared app behind auth, not as user-owned product state.

#### Current

Several current specs and docs describe owner scope as access control, canonical data boundary, or user-scoped ownership.

#### Target

Docs use shared-app terminology. Old ownership docs move to legacy or are rewritten as historical migration context.

#### Acceptance

- `GLOSSARY.md` marks `Owner Scope` as legacy or removes it from current product vocabulary after dependent docs are updated.
- Capability specs for auth, sessions, rooms, custom agents, Ralph, Cron, projects, and data stores no longer define user-owner isolation.
- User-facing strings avoid `owner`, `owned`, `principal`, and `personal target` unless explicitly describing legacy migration.

#### Scenario: Doc review

- GIVEN a reviewer searches current docs for `ownerScope`, `owner_scope`, `principalId`, `principal_id`, `room_members`, and `personal target`
- WHEN matches remain
- THEN each match is either removed, rewritten, or marked as legacy/migration context.

## Edge Cases

- Historical rows have conflicting unique keys after owner values are removed.
- The active production session was created under a user owner while older recovery sessions use `shared:app`.
- A job or session is active while migration is requested.
- Browser-local state and app-global read-state conflict.
- Old CLI scripts still pass `--owner-scope`.
- Debug commands need to inspect legacy owner values without implying current ownership.
- A fresh install should not need to run legacy migrations.

## Constraints

- **Compatibility:** Mixed historical `shared:app` and `user:*` data must stay readable until migration completes.
- **Deployment:** Deploy and test on Dev before Production. Production restarts need the normal safety check and explicit approval when active sessions are present.
- **Data safety:** No production write migration may run without a backup and dry-run report.
- **Security / Privacy:** Authentication remains required. Removing owner isolation is intentional and must not hide unrelated security findings.
- **Performance:** App-global listing must remain bounded and paginated where lists can grow.
- **Discoverability:** CLI help must remain progressive and avoid long all-in-one explanations.

## Success Criteria

- [ ] SC-001: Two allowed accounts see the same rooms, sessions, projects, custom agents, workflows, jobs, settings, and diagnostics.
- [ ] SC-002: New writes do not use authenticated user id as product owner, visibility key, routing key, profile-registration key, or automation-control key.
- [ ] SC-003: Existing `shared:app` and `user:*` sessions open directly and through sidebar navigation.
- [ ] SC-004: Migration dry-run reports all affected tables/stores, counts, conflicts, and proposed actions.
- [ ] SC-005: Migration mutation is idempotent and has a documented backup/restore path.
- [ ] SC-006: Fresh schemas do not create account-owner product boundaries.
- [ ] SC-007: Normal CLI/API flows no longer require owner/principal arguments.
- [ ] SC-008: Current specs/docs match the shared-app model; legacy terms are removed or marked.
- [ ] SC-009: Test/search gates cover active owner/principal boundary regressions.
- [ ] SC-010: Dev deployment and browser/API validation pass before production rollout.

## Assumptions and Open Questions

### Assumptions

- Pibo is intentionally a single shared app instance for the configured host.
- The allowed-email login gate remains the only user-based access decision for the web app.
- `shared:app` may be retained temporarily as an internal storage compatibility value.
- App-global read-state is acceptable unless a later UX decision moves read-state to browser-local storage.

### Open Questions

- Should `Personal Chat` be renamed to `Shared Chat`, or kept as a historical display label with no ownership meaning?
- Should read/unread state be app-global or browser-local?
- Should deprecated `--owner-scope` flags be ignored silently, warn, or fail after one release window?
- Which legacy owner/principal columns should be physically dropped in the first cleanup PR versus left for a later schema migration?
- How should conflicting custom-agent names from different old owners be resolved if encountered on a real host?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 | Cross-account visibility | `tasks.md` Phase 1-3 | Pending |
| REQ-002 | Open historical session | `tasks.md` Phase 1-2 | Pending |
| REQ-003 | Continue another account's session | `tasks.md` Phase 2, 4 | Pending |
| REQ-004 | Shared custom agent | `tasks.md` Phase 2-3 | Pending |
| REQ-005 | Shared Ralph job control | `tasks.md` Phase 3-4 | Pending |
| REQ-006 | CLI discovery | `tasks.md` Phase 3, 6 | Pending |
| REQ-007 | Mixed owner migration | `tasks.md` Phase 4 | Pending |
| REQ-008 | New install schema | `tasks.md` Phase 5 | Pending |
| REQ-009 | Regression gate | `tasks.md` Phase 2-6 | Pending |
| REQ-010 | Doc review | `tasks.md` Phase 6 | Pending |
