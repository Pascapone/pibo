# Proposal: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Owner / Source:** User request in Pibo session `ps_43d015b4-e9af-4502-8bb5-3ef266a0392e`  
**Related docs:** `docs/plans/no-owner-scope-shared-app-umbauplan-2026-05-28.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`, `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/pibo-session-store.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/continuous-ralph-jobs.md`, `docs/specs/capabilities/scheduled-pibo-jobs.md`, `docs/specs/capabilities/local-store-ownership-and-canonical-data-boundaries.md`

## Summary

Pibo will stop using account-derived `ownerScope` or `principalId` values as product ownership, visibility, routing, or authorization boundaries. A logged-in account proves only that the person may access the app. After login, every allowed account uses the same shared app data set: rooms, sessions, agents, workflows, jobs, projects, settings, provider configuration, diagnostics, and related history.

This change replaces the former user-scoped product model with one shared app context. Legacy owner-scope values may remain temporarily as migration metadata, but they must not define behavior after the change is complete.

## Motivation

The current system contains a mixed data set: historical records under `shared:app` and newer records under `user:<auth-user-id>`. Compatibility fixes can make both readable, but they preserve the old conceptual model. That leaves fragile filters, hidden sessions, duplicated default rooms, account-specific automation, and misleading documentation.

The desired product model is simpler: Pibo is a shared app instance behind an auth gate. Any allowed account can open, continue, diagnose, and manage the same work.

## Goals

- Make auth an access gate, not a product data partition.
- Make all product data app-global and visible to every allowed account.
- Safely migrate existing mixed `shared:app` and `user:*` data without data loss.
- Remove or neutralize owner/principal terms from runtime behavior, APIs, CLI UX, tests, and current documentation.
- Keep a bounded legacy bridge for old data and deployed hosts until schema cleanup is safe.

## Non-Goals

- Introduce teams, roles, per-resource permissions, admins, or multi-tenant isolation.
- Add account-scoped audit history as a product feature.
- Fix unrelated security issues such as path traversal, arbitrary file reads, unauthenticated local gateway exposure, dependency execution risk, or file-permission hardening.
- Rewrite Pi Coding Agent internals unless needed to remove Pibo-owned owner-scope behavior.

## Proposed Change

Introduce a durable shared-app contract:

1. A valid web login permits access to the whole Pibo app instance.
2. Pibo product data has one app context.
3. New writes do not derive owner, visibility, routing, profile registration, or job control from the authenticated user id.
4. Existing owner-scoped rows are read together, then migrated into the shared context through idempotent, backup-backed migrations.
5. CLI/API/UI contracts stop requiring owner-scope or principal arguments. Temporary deprecated options may be accepted only to preserve compatibility.
6. Specs, tests, and docs describe the shared-app model and mark old ownership terminology as legacy.

## Risks

- **Data-loss risk:** Blindly updating `owner_scope` can collide with existing rows. The migration must dry-run, report conflicts, and merge before mutation.
- **Availability risk:** Production restarts can interrupt active runtime sessions. Deployments should follow the normal dev-first and production-approval process.
- **Semantic drift risk:** Keeping `SHARED_APP_SCOPE` forever may preserve owner-scope thinking. It must be documented as a migration bridge, not a product identity.
- **Security communication risk:** Removing cross-owner isolation is intentional, but unrelated security risks remain and must not be closed accidentally.

## Rollout Summary

1. Land compatibility reads where needed so old and new sessions remain accessible.
2. Switch runtime write paths to the shared app context.
3. Remove owner filters from Chat Web, sessions, rooms, resources, jobs, and diagnostics.
4. Add backup-backed dry-run migrations for every affected store.
5. Run migrations after dev validation and production approval.
6. Remove obsolete schema, APIs, CLI flags, tests, and documentation references.
