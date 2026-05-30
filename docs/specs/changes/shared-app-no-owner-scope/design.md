# Design: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Related spec:** `docs/specs/changes/shared-app-no-owner-scope/spec.md`

## Design Principles

1. **Auth gates entry only.** The logged-in account may appear in auth UI and technical auth diagnostics, but not as product ownership.
2. **Compatibility before mutation.** Code must read mixed `shared:app` and `user:*` data before any production migration normalizes rows.
3. **Migration values are not product concepts.** `SHARED_APP_SCOPE` may bridge old schemas but must not leak into new API/CLI/UI contracts as ownership.
4. **Small reversible steps.** Each phase should be testable and deployable with a clear rollback path.
5. **No new permission model.** Do not replace owner scope with roles, teams, admins, or another account-based partition.

## Target Architecture

### Product Context

Pibo has one product context per host: the shared app context.

Internally, old stores may need a compatibility selector while migrations are underway. Prefer naming that does not imply ownership, for example:

- `APP_CONTEXT_ID` for new neutral code, if a stored value is still needed.
- `SHARED_APP_SCOPE` only inside legacy compatibility/migration modules.
- `LegacyOwnerScope` as a type name only when reading old schema fields.

### Auth Boundary

`requireWebSession` should return enough information to prove the request is authenticated and to display/logout the user. Product handlers should not require `webSession.ownerScope`.

Preferred shape:

```ts
type PiboWebSession = {
  authUserId: string;
  email?: string;
  name?: string;
  image?: string;
  authSession: unknown;
};
```

If compatibility requires `ownerScope` during transition, mark it deprecated and pin it to the shared app value. Do not derive it from `authUserId`.

### Stores and Services

Move from owner-scoped methods to resource-scoped methods:

| Current pattern | Target pattern |
|---|---|
| `listOwnedSessions(ownerScope, ...)` | `listSessions(...)` |
| `requireOwnedSession(ownerScope, id)` | `requireSession(id)` |
| `getOwnedProject(ownerScope, id)` | `getProject(id)` |
| `listOwnedAgents(ownerScope)` | `listAgents()` |
| `principal_session_stats` | app-global stats or browser-local read-state |
| `room_members` | no replacement unless a future permission spec exists |

During transition, method bodies may call compatibility helpers that include both `shared:app` and known legacy user scopes. The public service name should still move toward the target behavior.

### API and CLI Contracts

Normal API requests should select resources by stable resource ids, not by owner or principal. Normal CLI commands should not require `--owner-scope`.

Temporary compatibility policy for old flags:

1. First transition: accept the flag and warn that it is ignored.
2. After docs/tests are updated: keep only where automation compatibility is needed.
3. Final cleanup: remove the flag unless supporting old scripts is explicitly required.

### Migration Strategy

Every data migration follows this sequence:

1. **Inspect:** Count rows by legacy owner/principal value and table/store.
2. **Backup:** Copy the SQLite file before mutation.
3. **Dry-run:** Report planned changes and conflicts. No writes.
4. **Conflict plan:** Merge or rename deterministically before owner removal.
5. **Mutate:** Apply idempotent updates inside transactions.
6. **Post-check:** Verify counts, sample resource opens, and search gates.
7. **Rollback note:** Print the backup path and restore command.

Do not run production mutation while old deployed code can still hide `shared:app` or `user:*` resources.

## Affected Stores

Known affected stores from the inventory:

- `pibo.sqlite`
  - `sessions.owner_scope`
  - `rooms.owner_scope`
  - `room_members`
  - `session_navigation.owner_scope`
  - `principal_session_stats`
  - `principal_room_stats`
- `chat-agents.sqlite`
  - custom agent owner fields
- `pibo-ralph.sqlite`
  - job/run owner fields and personal targets
- `pibo-cron.sqlite`
  - scheduled job owner fields
- `web-annotations.sqlite`
  - annotation/binding owner fields
- `web-projects.sqlite`
  - project owner fields, if still active
- workflow persistence stores
  - workflow run, asset, draft, and lifecycle owner fields

Each store needs its own dry-run and mutation tests because unique constraints differ.

## Conflict Handling Rules

### Sessions

Session ids are already globally unique. Normalize metadata only after all session open/list/send paths ignore owner boundaries.

### Rooms

If multiple default rooms exist, choose one canonical shared default room. Move sessions from duplicate default rooms to the canonical room unless preserving room names/history requires keeping them as ordinary rooms.

### Session Navigation and Read-State

If duplicate navigation/read-state rows conflict after owner removal, prefer the most recent `updated_at` or equivalent timestamp. If read-state semantics remain unclear, move read-state to browser-local storage and drop principal-scoped persisted state.

### Custom Agents

If two legacy owners have agents with the same global profile name, preserve both definitions by deterministic renaming before registering profiles, for example by appending a short legacy-owner hash. If current constraints already guarantee uniqueness, report that no rename is needed.

### Ralph and Cron Jobs

Jobs and runs should keep their ids. Personal/user targets become app-global targets. Active jobs should not be migrated while running unless the runtime can tolerate the metadata change.

### Web Annotations and Projects

Keep resource ids stable. Merge duplicate owner-specific bindings by resource key and prefer most recent metadata where values conflict.

## Verification Plan

### Local

- `npm run build`
- Unit/integration tests for changed stores and APIs.
- Migration tests against synthetic mixed-owner databases.
- Search gate for unapproved active owner/principal terms.

### Dev

- Deploy through `./scripts/deploy-web-dev.sh`.
- Restart dev gateway through `pibo gateway dev restart`.
- Validate API bootstrap for:
  - historical `shared:app` session,
  - historical `user:*` session,
  - newly created shared-app session.
- Browser validation with two authenticated allowed accounts if available.

### Production

- Deploy only after dev validation succeeds and user approves.
- Use normal production restart safety. If active sessions block restart, ask before force.
- Before migration mutation, take backups and run dry-run reports.
- After migration, verify recovery sessions and current sessions by direct open and sidebar navigation.

## Rollback Strategy

- Code rollback: redeploy previous stable web backup if a deploy breaks access before migration mutation.
- Data rollback: restore SQLite backups created by migration tools.
- Partial migration rollback: each migration command must print affected files and backup paths.
- If rollback occurs after schema cleanup, use the matching backup made immediately before that schema migration.

## Open Design Decisions

- Final neutral name for the shared app context constant, if any.
- Whether read-state is app-global or browser-local.
- Whether default room display text changes from `Personal Chat` to `Shared Chat`.
- Exact release window for deprecated CLI flags.
- Which schema columns are dropped in the first PR versus a follow-up cleanup PR.
