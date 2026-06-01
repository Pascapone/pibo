# Finaler Umbauplan: Owner Scope vollständig entfernen

**Status:** Draft  
**Erstellt:** 2026-05-31  
**Quelle:** Nutzerwunsch: kein Übergangsmodell mehr, keine `shared:app`-Owner-Scope-Semantik, eine echte gemeinsame App-Fläche.  
**Inventar:**
- `docs/reports/owner-scope-final-removal-inventory-2026-05-31.md`
- `docs/reports/owner-scope-final-removal-raw-inventory-2026-05-31.txt`

## 1. Zielbild

Pibo hat genau einen Produktdatenraum: die App. Authentifizierung entscheidet nur, ob eine Person die App betreten darf. Nach erfolgreichem Login gibt es keine Produktpartition nach Benutzer, Account, Principal, Owner Scope oder `shared:app`-Ersatzwert.

Das bisherige Übergangsmodell wird beendet:

- kein `ownerScope` in Produkttypen;
- keine `owner_scope`-Spalten in aktiven Schemas;
- keine `principal_id`-Read-State- oder Membership-Tabellen für Produktzugriff;
- keine `shared:app`-Konstante als Speicherwert;
- kein `getAppContextLegacyOwnerScope()`;
- keine CLI-/API-Parameter wie `--owner-scope`;
- keine Owner-Auswahl im TUI;
- keine Ralph-/Cron-/Workflow-/Annotation-/Project-/Agent-Ziele mit persönlichem Principal;
- keine Tests, die `user:*` oder `shared:app` als gültiges aktuelles Modell verwenden.

Auth-Benutzer bleiben nur als Authentifizierungs- und Audit-Information bestehen. Better-Auth-Tabellen wie `user`, `session`, `account` sind nicht Teil des Produktdatenraums und werden nicht zu Produkt-Ownern.

## 2. Recherche-Stand

Die Occurrence-Suche lief über Source, Packages, Tests, Scripts, Skills und Dokumentation mit u. a. diesen Mustern:

```text
ownerScope, owner_scope, OwnerScope, owner scope, owner-scope,
getAppContextLegacyOwnerScope, LEGACY_SHARED_APP_OWNER_SCOPE, shared:app,
principalId, principal_id, room_members, listOwned, getOwned,
requireOwned, user:, PIBO_OWNER_SCOPE
```

Zusätzliche UI-/Legacy-Muster:

```text
active owner, current owner, listOwners, setActiveOwner, getActiveOwner,
OwnerSummary, ownerSummaries, personal target, Personal Chat,
Personal Project, personal room, web-user, auth user id, authUserId
```

Wichtige Match-Zahlen aus der Inventur:

| Muster | Treffer |
|---|---:|
| `ownerScope` | 1182 |
| `user:` | 771 |
| `owner-scope` | 402 |
| `owner_scope` | 362 |
| `OwnerScope` | 276 |
| `owner scope` | 187 |
| `principalId` | 186 |
| `shared:app` | 178 |
| `getAppContextLegacyOwnerScope` | 125 |
| `principal_id` | 107 |
| `LEGACY_SHARED_APP_OWNER_SCOPE` | 90 |
| `room_members` | 74 |
| `getOwned` | 31 |
| `requireOwned` | 23 |
| `listOwned` | 17 |
| `PIBO_OWNER_SCOPE` | 2 |

Die größten aktiven Flächen sind:

| Fläche | Befund |
|---|---|
| Chat Web / Rooms / Sessions | `PiboWebSession.ownerScope`, `PiboSession.ownerScope`, `rooms.owner_scope`, `sessions.owner_scope`, `session_navigation.owner_scope`, `room_members`, `principal_*_stats`, compatibility writes. |
| CLI/TUI Sessions | Owner-Picker, `CliOwnerSummary`, `/owner`, `--owner-scope`, owner mismatch protection, selected owner/default room. |
| Custom Agents | `CustomAgentDefinition.ownerScope`, create/list signatures, legacy column reads/writes. |
| Projects / Project workflow sessions | `PiboProject.ownerScope`, `CreateProjectInput.ownerScope`, workflow session snapshots with owner scope. |
| Ralph | Store/API/CLI/Service signatures still carry `ownerScope`; target `personal.principalId` normalizes to `shared:app`; JSON may expose internal fields outside sanitized Chat API paths. |
| Cron | Same pattern as Ralph: signatures and model fields remain; target `personal.principalId`; CLI no-op `--owner-scope`. |
| Web Annotations | `ownerScope` in types, validation, APIs, tools, CDP, attachments; store ignores it for filtering but keeps it in signatures and legacy columns. |
| Workflow package | `workflow_runs.owner_scope` is still a fresh schema column and list filter; `WorkflowRun.ownerScope` is a package-level type. |
| Migration tooling | `pibo data app-context` currently normalizes legacy values to `shared:app`; final target needs schema rebuild/drop, not normalization. |
| Docs/tests/reports | Many current specs and tests still teach Owner Scope, `shared:app`, personal targets, or owner recovery. |

## 3. Aktuelle Lage in einem Satz

Die App ist funktional weitgehend app-global, aber das Datenmodell und viele öffentliche/interne Verträge verwenden noch ein Legacy-Abbild: `shared:app` als synthetischen Owner Scope. Dieser Plan entfernt dieses Abbild vollständig.

## 4. Leitentscheidungen

1. **Kein Ersatz-Owner.** `shared:app` wird nicht durch einen anderen Owner-Wert ersetzt. Die Felder verschwinden.
2. **Schema-Rebuild statt Normalisierung.** Migrationen bauen Tabellen ohne Owner-/Principal-Spalten neu, statt Werte auf `shared:app` zu setzen.
3. **Einmalige Cutover-Migration, keine dauerhafte Runtime-Kompatibilität.** Der finale Stand darf keine allgemeine Owner-Kompatibilität mehr im Runtime-Code pflegen. Alte Schemas werden vor oder während Cutover migriert.
4. **Auth bleibt Auth.** Auth-Identität darf für Anzeigename, Audit und Logout existieren, aber nie für Produkt-Sichtbarkeit, Routing, Workspace, Jobs, Sessions, Projekte oder Read-State.
5. **Technische Ownership prüfen und umbenennen.** Begriffe wie Lease-Owner oder `owner_pibo_session_id` sind keine Produkt-Owner-Scopes, sollen aber umbenannt werden, wenn sie Search-Gates oder Agenten verwirren.
6. **Dokumentation darf kein altes Modell lehren.** Aktuelle Docs müssen das finale Modell beschreiben. Alte Pläne/Reports werden entweder aktualisiert, nach `docs/legacy/` verschoben oder in Such-Gates explizit als historische Artefakte ausgeschlossen.

## 5. In Scope

- Source unter `src/`, `packages/`, `scripts/`, `skills/`.
- Tests und Fixtures.
- Current docs unter `docs/project/`, `docs/specs/`, `docs/plans/`, `docs/reports/`.
- SQLite-Schemas und Migrationen für:
  - `pibo.sqlite`,
  - `pibo-sessions.sqlite`,
  - `chat-agents.sqlite`,
  - `pibo-ralph.sqlite`,
  - `pibo-cron.sqlite`,
  - `web-annotations.sqlite`,
  - `web-projects.sqlite`,
  - `pibo-workflows.sqlite`,
  - reliability/yielded-run state where naming implies product ownership.
- Chat Web, CLI/TUI, Ralph, Cron, Workflows, Web Annotations, Agent Designer, Projects, Settings, Debug.
- Deployment and data cutover plan for Dev and Production.

## 6. Out of Scope

- Removing Better Auth users/sessions/accounts. They gate access and are not product data partitioning.
- Removing normal English words like “owner” from non-product concepts if the term is semantically correct and not confused with product owner scope. However, public Pibo docs and APIs should prefer clearer terms such as `controller`, `holder`, `leaseHolder`, or `createdBy`.
- Rewriting Git history.

## 7. Architektur-Zielmodell

### 7.1 Web/Auth

`PiboWebSession` should contain:

```ts
type PiboWebSession = {
  authSession: PiboAuthSession;
  appContext: { kind: "app-context"; id: "app-context" };
};
```

It must not contain `ownerScope`, `legacyOwnerScope`, principal id, or account-derived product identifiers.

### 7.2 Pibo Session

`PiboSession` should contain only session facts:

```ts
type PiboSession = {
  id: string;
  piSessionId: string;
  channel: string;
  kind: string;
  profile: string;
  parentId?: string;
  originId?: string;
  workspace?: string;
  title?: string;
  metadata?: PiboJsonObject;
  activeModel?: ModelProfile;
  createdAt: string;
  updatedAt: string;
};
```

No store API should accept `ownerScope` as a filter or write value.

### 7.3 Rooms and navigation

Rooms are app objects. Membership and principal read-state are removed.

Target tables:

```sql
rooms(id, name, topic, type, parent_room_id, workspace, archived_at,
      retention_policy_id, metadata_json, created_at, updated_at)

session_navigation(room_id, session_id, root_session_id, parent_id, origin_id,
                   title, profile, status, archived_at, last_activity_at,
                   last_message_preview, child_count, sort_key, updated_at)

app_session_read_state(session_id PRIMARY KEY, last_read_stream_id,
                       last_read_message_sequence, last_read_at, updated_at)

app_room_read_state(room_id PRIMARY KEY, last_read_stream_id,
                    last_read_at, updated_at)
```

Drop:

```text
room_members
principal_session_stats
principal_room_stats
owner_scope columns and owner indexes
```

### 7.4 Custom Agents

Custom Agents are globally visible and named globally. Remove:

- `CustomAgentDefinition.ownerScope`;
- `CreateCustomAgentInput.ownerScope`;
- `list(ownerScope)` compatibility;
- `chat_agents.owner_scope`;
- owner-based profile-name collision handling after migration.

Duplicate historical profile names must be resolved before dropping the column.

### 7.5 Ralph

Ralph jobs and runs are app-global.

Remove:

- `PiboRalphJob.ownerScope`;
- `PiboRalphRun.ownerScope`;
- `PiboRalphRunFact.ownerScope`;
- `PiboRalphJobCreateInput.ownerScope`;
- store/service/CLI/API parameters named `ownerScope`;
- `getOwnedJob`;
- `--owner-scope` and `PIBO_OWNER_SCOPE` handling;
- `personal.principalId` target shape.

Target shape:

```ts
type PiboRalphTarget =
  | { kind: "room"; roomId: string }
  | { kind: "default-chat" };
```

Target tables drop `owner_scope`. Existing `personal` targets migrate to `default-chat`.

### 7.6 Cron

Cron follows Ralph:

- remove job/run owner fields;
- remove owner parameters and no-op CLI flags;
- migrate `personal.principalId` to `default-chat`;
- drop `owner_scope` columns from jobs/runs.

### 7.7 Projects and workflow UI persistence

Projects are app-global.

Remove:

- `PiboProject.ownerScope`;
- `CreateProjectInput.ownerScope`;
- `projectWorkflowSessionSnapshot.ownerScope`;
- `web-projects.projects.owner_scope`;
- workflow UI owner columns in `workflow_ui_drafts`, `workflow_prompt_assets`, `workflow_prompt_asset_revisions`, `workflow_lifecycle_events`.

Rename model names like `OwnedWorkflowDraftRecord` to neutral names such as `WorkflowDraftRecord` if no conflict exists.

### 7.8 Workflow package

`packages/workflows` still has first-class owner scope in fresh schema and public types. Remove:

- `WorkflowRun.ownerScope`;
- `WorkflowRunListFilter.ownerScope`;
- `workflow_runs.owner_scope`;
- `idx_workflow_runs_owner`;
- row mapper and write-value owner fields;
- runtime routing owner propagation;
- inspection output `owner` lines;
- prompt trace privacy kind `ownerScope`.

If a workflow run needs an initiator, use a neutral optional audit field such as `createdByAuthUserId` only if required and never for visibility.

### 7.9 Web Annotations

Remove owner scope from:

- store input/filter types;
- API/tool/CDP signatures;
- validation helpers;
- binding/annotation models;
- `web_annotation_bindings.owner_scope`;
- `web_annotations.owner_scope`.

Annotation access is by app/session/binding ids, not owner.

### 7.10 CLI/TUI Sessions

Remove the owner selection model entirely.

Remove:

- `CliOwnerSummary`;
- `getActiveOwner()`;
- `setActiveOwner()`;
- `listOwners()`;
- `/owner` command;
- owner picker UI;
- owner mismatch errors;
- `--owner-scope` CLI option;
- `PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS` mocked-owner concepts;
- `Root recovery owner` as an owner. If recovery mode remains, rename it to `Local recovery mode` or `Recovery source`.

TUI source should expose app rooms/sessions directly.

### 7.11 Debug and data CLI

Debug tools may inspect historical backups, but current commands must not present Owner Scope as active state.

Target:

- `pibo debug session` shows legacy owner values only when reading an unmigrated backup or when `--legacy-columns` is requested.
- `pibo data app-context` is retired after final migration. Replace with a final cutover tool name such as `pibo data app-space-migration` during implementation, then remove or hide it after Production migration.

## 8. Datenmigration

### 8.1 Migration strategy

Use a strict offline cutover:

1. Stop or quiesce gateway.
2. Take verified backup.
3. Run final migration against SQLite files.
4. Run post-checks.
5. Deploy code that no longer supports runtime owner compatibility.
6. Restart gateway.

Do not keep long-lived runtime branches that normalize old data to `shared:app`.

### 8.2 SQLite table rebuilds

SQLite column drops should be implemented by table rebuild for compatibility and control:

1. Create `new_<table>` with target schema.
2. Copy data excluding owner/principal columns.
3. Merge conflicts deterministically.
4. Drop old indexes/triggers.
5. Rename new table.
6. Recreate target indexes.
7. Run `PRAGMA quick_check`.
8. Record migration journal entry.

### 8.3 Conflict handling

Known collisions:

| Area | Conflict | Resolution |
|---|---|---|
| Rooms | multiple historical default rooms | choose newest non-archived as app default; preserve others as normal archived or renamed rooms. |
| Session navigation | duplicate session ids with different owner rows | keep one row by `session_id`; choose newest `updated_at`; preserve room/session relation from surviving row. |
| Read-state | multiple principal rows per session/room | merge max stream/message cursor and newest read timestamp. |
| Custom Agents | same `profile_name` across owners | keep newest exact name; deterministically rename older duplicates before column drop, e.g. `name-legacy-<hash>`. |
| Projects | duplicate shared default/personal projects | keep app default; preserve non-default projects with stable ids. |
| Ralph/Cron | personal target principal values | rewrite target to `default-chat`; preserve ids, state, resources, run history. |
| Workflows | owner-scoped run filters | drop owner filter; preserve runs by id. |

### 8.4 Migration inputs and outputs

The migration report should include:

- scanned SQLite files and table schemas;
- all columns to drop;
- row counts before/after;
- collision groups;
- selected merge winners;
- renamed ids/names;
- post-check results;
- rollback path.

### 8.5 Production safety

Production migration requires separate explicit approval. Before Production:

- Dev migration succeeds on a copied/sandboxed Pibo home.
- Dev gateway runs final code after migration.
- Browser/API validation passes.
- Production backup is verified with `PRAGMA quick_check`.
- Rollback is documented: stop gateway, restore backup, redeploy previous stable build, restart.

## 9. Implementation phases

### Phase 0 — Baseline and gates

Deliverables:

- Preserve this inventory.
- Add a failing search-gate test for active code and current docs.
- Define allowlist policy. Target final state should have no allowlist for active source. Temporary migration code may be allowlisted only until the cutover PR completes.

Acceptance:

```bash
rg "ownerScope|owner_scope|OwnerScope|owner-scope|getAppContextLegacyOwnerScope|LEGACY_SHARED_APP_OWNER_SCOPE|shared:app|PIBO_OWNER_SCOPE" src packages scripts skills test docs/project docs/specs docs/plans
```

At the end of the full work this command must return no active-model matches. Historical `docs/legacy` may remain only if explicitly accepted; otherwise rewrite or archive outside current docs.

### Phase 1 — Remove app-context-as-owner vocabulary

Tasks:

- Replace `src/app-context.ts` with a pure app-context module or inline `PIBO_APP_CONTEXT` without legacy owner value.
- Remove `legacyOwnerScope` from `PiboAppContext`.
- Remove `PiboWebSession.ownerScope`.
- Remove `PiboRuntimeSessionContext.ownerScope` and generated context mentions.
- Replace helper calls with no value, not with another constant.

Acceptance:

- `rg "getAppContextLegacyOwnerScope|LEGACY_SHARED_APP_OWNER_SCOPE|shared:app" src packages scripts test` returns zero, except inside a temporary migration tool during the migration phase.

### Phase 2 — Core sessions and Chat data

Tasks:

- Remove owner fields from `PiboSession`, create/update/find inputs, in-memory store, SQLite store, Pibo data session store.
- Remove owner filters from `matchesFindInput` and all callers.
- Rebuild `sessions`, `rooms`, `session_navigation` schemas without owner columns.
- Remove `room_members`, `principal_session_stats`, `principal_room_stats` active use.
- Rename `requireRoomAccess(roomId, principalId, action)` to `requireRoom(roomId)` or `requireWritableRoom(roomId)`.
- Change `ensureDefaultRoom(input)` to `ensureDefaultRoom({ name?: string })`.
- Change read-state APIs to app-level signatures.

Acceptance:

- Existing historical sessions open after migration by id and sidebar.
- New sessions write no owner or principal columns.
- Search gate finds no `ownerScope` in `src/sessions`, `src/data`, `src/apps/chat/data`.

### Phase 3 — App feature stores

Tasks:

- Custom Agents: remove owner from types, inputs, rows, list API, web API, profile registration.
- Projects: remove owner from project types, schemas, default project ids, snapshots.
- Workflow UI persistence: drop owner columns and `Owned*` model names.
- Web Annotations: remove owner from store/API/tool/CDP/attachment signatures and schemas.
- User settings: verify settings are app-global and have no owner/principal terminology.

Acceptance:

- Agent Designer, Projects, Workflow authoring, Web Annotations work without owner values in API payloads or store rows.
- Search gate passes for those directories.

### Phase 4 — Ralph and Cron

Tasks:

- Remove owner fields from Ralph/Cron job/run/fact types.
- Remove owner parameters from stores and services.
- Remove no-op CLI `--owner-scope` and `PIBO_OWNER_SCOPE`.
- Replace `personal.principalId` targets with `default-chat` or equivalent neutral target.
- Remove `getOwnedJob` methods.
- Update Chat API serializers because owner fields should not exist at all.
- Update Chat UI types and forms.

Acceptance:

- `pibo ralph add/list/start/stop/cancel/runs --json` contains no `ownerScope` and accepts no `--owner-scope`.
- `pibo cron ... --json` contains no `ownerScope` and accepts no `--owner-scope`.
- Running Ralph/Cron jobs survive migration with ids/history/state intact.

### Phase 5 — Workflow package

Tasks:

- Remove `WorkflowRun.ownerScope` and owner filters.
- Rebuild workflow store schema without `workflow_runs.owner_scope` and owner index.
- Remove runtime routing owner propagation.
- Remove inspection `owner` output.
- Rename trace privacy kind away from `ownerScope`.
- Update workflow tests and package docs.

Acceptance:

- Workflow runs persist and list without owner filters.
- `packages/workflows` has no product owner-scope matches.

### Phase 6 — CLI/TUI and session UI

Tasks:

- Remove owner picker and `/owner` flow.
- Remove `CliOwnerSummary` and source owner APIs.
- Replace owner header/status with app/session/source status.
- Rename recovery concepts away from owner identity.
- Remove user-owner mock env variables.
- Update PTY tests and fixtures.

Acceptance:

- `pibo tui:sessions` opens app-global room/session list directly.
- There is no owner mismatch path because no owner can be selected.
- Help output contains no `--owner-scope` or current-owner guidance.

### Phase 7 — Final migration command and data cutover

Tasks:

- Build a temporary cutover command that can migrate old DBs to final schemas.
- The command may contain old column names, but it must live in one isolated module with a TODO to delete after Production cutover.
- Run dry-run and apply in Docker against copied homes.
- Run Dev cutover on the Dev home after approval.
- After Production cutover, delete the temporary migration module and update the search gate to zero.

Acceptance:

- Final branch after cutover has no Owner Scope compatibility runtime.
- If the temporary migrator remains in code, the final PR is not complete.

### Phase 8 — Docs/tests cleanup

Tasks:

- Rewrite current docs to the final app-space model.
- Move superseded Owner Scope specs/reports/plans to `docs/legacy/` or rewrite them as historical notes.
- Update Glossary: `Owner Scope` becomes a removed historical term, not active compatibility storage.
- Update skills and tool guides.
- Replace tests using `user:*`/`shared:app` current behavior with migration fixtures only; after migrator deletion, remove those fixtures too.

Acceptance:

- Current docs do not instruct agents to use Owner Scope.
- Search gate passes for current docs.

## 10. Verification matrix

| Area | Required checks |
|---|---|
| TypeScript | `npm run typecheck` |
| Build | `npm run build` |
| Full tests | `npm test` |
| Search gates | strict `rg` gates for owner/principal/app-context legacy terms |
| Fresh schema | tests assert no owner/principal columns/tables in new DBs |
| Migration | fixture DBs with old `user:*` and `shared:app` rows migrate to final schemas and preserve data |
| Chat Web API | bootstrap, sessions, rooms, messages, settings, agents, projects, workflows contain no owner fields |
| Ralph/Cron CLI | JSON and help output contain no owner fields/options |
| TUI | PTY path has no owner picker/status and can create/open/send app sessions |
| Browser | Dev Chat Web validates sidebar, direct session open, Ralph/Cron areas, Agent Designer, Projects, Web Annotations |
| Production readiness | verified backup, dry-run report, rollback instructions, no active migration conflicts |

## 11. Search-gate target

Final active-source gate:

```bash
rg -n "ownerScope|owner_scope|OwnerScope|owner scope|owner-scope|getAppContextLegacyOwnerScope|LEGACY_SHARED_APP_OWNER_SCOPE|shared:app|PIBO_OWNER_SCOPE|principalId|principal_id|room_members|listOwned|getOwned|requireOwned|OwnedSession|OwnedProject" \
  src packages scripts skills test docs/project docs/specs docs/plans
```

Target: zero matches, except temporary migration PR phases. The final post-cutover PR should have zero active matches.

Secondary wording gate:

```bash
rg -n "active owner|current owner|listOwners|setActiveOwner|getActiveOwner|OwnerSummary|ownerSummaries|personal target|Personal Chat|Personal Project|personal room|web-user|auth user id|authUserId" \
  src packages scripts skills test docs/project docs/specs docs/plans
```

Target: zero misleading product-owner matches. Auth docs may say “authenticated user” only when describing the auth gate.

## 12. Deployment plan

### Dev

1. Implement in a focused branch from `upstream/dev` and a Docker dev worker.
2. Run migration against a copied/sandboxed Pibo home.
3. Deploy to host Dev only after Docker validation.
4. Restart Dev gateway.
5. Browser-test authenticated Chat Web paths.
6. Record validation report.

### Production

Production requires explicit approval immediately before action.

1. Confirm final PR is merged and production branch is synced.
2. Stop/quiesce production gateway via Pibo CLI.
3. Take fresh verified backup of `.pibo` SQLite files.
4. Run final migration dry-run.
5. Review conflicts.
6. Run final migration apply.
7. Build/deploy final code.
8. Restart production gateway, force only if explicitly approved at that time.
9. Validate Chat Web, Ralph/Cron lists, session open, direct bootstrap, and no owner fields in API payloads.
10. Keep rollback backup until validation window ends.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Data loss during table rebuild | Verified backup, transactional rebuilds, quick_check, row-count checks, dry-run reports. |
| Duplicate global names | Deterministic rename/merge before dropping owner columns. |
| Runtime deployed before migration | Strict deployment order; final code requires final schema. |
| Migration tool becomes permanent compatibility | Time-box and delete before final completion. |
| Agents reintroduce Owner Scope from old docs | Rewrite current docs, move old docs to legacy, enforce search gate. |
| Auth identity accidentally becomes new owner | Code review rule: auth identity may only gate access/display/audit, not data visibility/write location. |
| Workflow package API breakage | Dedicated package phase and migration tests. |

## 14. Definition of Done

The work is done only when all are true:

- `ownerScope`, `owner_scope`, `shared:app`, and app-context legacy helpers are absent from active source.
- Active schemas do not create owner/principal product columns or membership tables.
- Runtime code does not read old owner/principal columns.
- CLI/API/UI payloads do not expose Owner Scope.
- Ralph and Cron loops have no owner parameters, owner fields, or personal principal targets.
- TUI has no owner picker or active-owner state.
- Workflow package has no run owner scope.
- Current docs teach a single app-space model.
- Migration was validated on Dev and, after explicit approval, applied to Production with rollback backup.

## 15. Recommended execution shape

This should be implemented as a dedicated multi-phase PR series, not as an ad hoc patch:

1. PR 1: search gates and pure app-context/web/session type cleanup.
2. PR 2: core Chat data schemas and migration fixtures.
3. PR 3: feature stores: agents/projects/workflow UI/web annotations.
4. PR 4: Ralph/Cron API/CLI/type cleanup.
5. PR 5: workflow package cleanup.
6. PR 6: CLI/TUI owner model removal.
7. PR 7: final cutover migrator, Dev validation, docs cleanup.
8. PR 8, after Production cutover: delete temporary migration compatibility and enforce zero-match gates.

If we want one single PR, it should be Ralph-managed with a strict PRD and Docker worker, but the risk is high because this touches nearly every product surface.
