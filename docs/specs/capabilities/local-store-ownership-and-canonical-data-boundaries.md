# Spec: Local Store Ownership and Canonical Data Boundaries

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-17
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`, `docs/specs/capabilities/pibo-home-and-workspace-state.md`, `docs/specs/capabilities/pibo-data-store-and-ingestion.md`, `docs/specs/capabilities/pibo-session-store.md`, `docs/specs/capabilities/reliable-event-core.md`, `docs/specs/capabilities/debug-cli.md`

## Why

Pibo persists product state in several local stores. Agents, web handlers, CLIs, and debug tools need a clear boundary for which store owns each product fact. Without that boundary, future code can accidentally treat projections, debug aliases, or legacy stores as canonical and create inconsistent session, room, event, or runtime state.

This spec captures the current source-owned local storage contract: where stores live, what each store owns, which data is derived, and how consumers must recover when a store is missing or contains stale projection data.

## Goal

Pibo MUST keep each local product fact owned by exactly one current store and MUST treat read models, projections, and debug aliases as derived views unless their source module explicitly owns mutation for that fact.

## Background / Current State

`src/core/pibo-home.ts` defines the default Pibo home as `$PIBO_HOME` or `~/.pibo`. Most product-wide SQLite stores live under that home. Workspace-specific resources, such as prompt files and Pi package registrations, live under the effective workspace `.pibo/` directory.

The current v2 data store in `src/data/pibo-store.ts` creates `pibo.sqlite` and applies `src/data/schema.ts`. That store owns unified Chat Web data and the default routed Pibo Session table: shared rooms, event log rows, payload metadata, chat messages, observations, app read state, navigation rows, indexed session rows, runtime telemetry rows, and workflow authoring/catalog rows created by Chat Web. Legacy member/read-stat tables may exist only in migrated stores. When the router uses `PiboDataSessionStore`, `pibo.sqlite.sessions` is the canonical session store for routed Pibo Session identity; in legacy or injected test paths, the active `PiboSessionStore` remains the routing source of truth.

Current runtime wiring uses the v2 data store by default. `PiboGatewayServer` creates the default session store through `createDefaultPiboDataSessionStore()`, and Chat Web composes its room, session, timeline, event-command, project, read-state, workflow UI, telemetry, and ingest services from `PiboDataStore` plus `src/apps/chat/data/*` services. Legacy Chat Web stores remain source files for compatibility and reference only; runtime code must not reintroduce a data-mode switch that selects those legacy stores for normal gateway or Chat Web paths.

Other durable stores own focused facts: `web-projects.sqlite` for Projects, Project sessions, workflow session snapshots, workflow runs, wait tokens, and human actions; `pibo-events.sqlite` for reliability streams, durable jobs, and yielded-run records; `pibo-cron.sqlite` for scheduled Pibo jobs and run history; `pibo-ralph.sqlite` for Ralph jobs, runs, and facts; `chat-agents.sqlite` for custom Agent Designer profiles; `auth.sqlite` for Better Auth state; context-file SQLite metadata plus managed markdown files for managed context files; `config.json`, `model-defaults.json`, and `user-settings.json` for local settings; and workspace `.pibo/pi-packages.json` plus package install directories for Pi package registrations.

## Scope

### In Scope

- Store path ownership under Pibo home and workspace `.pibo/` directories.
- Canonical ownership of sessions, rooms, chat events, runtime telemetry, workflow authoring/catalog rows, Projects, reliability events, cron jobs, Ralph jobs, custom agents, auth data, managed context files, Pi packages, prompts, model defaults, and user settings.
- Projection and read-model rules for Chat Web data and debug store aliases.
- Idempotency, migration, and recovery behavior at store boundaries.
- Operator/debug visibility for store paths and missing stores.

### Out of Scope

- Distributed storage, remote synchronization, or multi-host replication.
- Full schemas for every table; capability specs for each subsystem own table-level behavior.
- Pi Coding Agent transcript persistence internals outside the Pibo product boundary.
- Legacy documents as authoritative storage contracts.

## Requirements

### Requirement: Store roots are deterministic

The system MUST resolve product-wide stores from the configured Pibo home and workspace-scoped stores from the effective workspace.

#### Current

`getPiboHome()` returns `$PIBO_HOME` when set and otherwise `~/.pibo`. `piboHomePath()` joins product-wide store names to that root. Pi package, base prompt, and compaction prompt stores resolve under the current workspace `.pibo/` directory.

#### Acceptance

- Setting `PIBO_HOME=/tmp/pibo-a` causes product-wide store paths to use `/tmp/pibo-a`.
- Unset `PIBO_HOME` causes product-wide stores to use `~/.pibo`.
- Workspace files such as `.pibo/pi-packages.json`, `.pibo/base-prompt.json`, and `.pibo/compaction-prompt.json` do not move when only `PIBO_HOME` changes.
- Store constructors create parent directories before opening file-backed stores.

#### Scenario: Isolated product home

- GIVEN `PIBO_HOME` points at an empty temporary directory
- WHEN Pibo opens its default data, reliability, cron, auth, and user-settings stores
- THEN each product-wide file is created under that temporary directory and not under the operator's normal home.

### Requirement: Pibo Session identity has one routing source of truth

The system MUST use the router's Pibo Session Store as the canonical source for Pibo Session identity, hierarchy, profile, active model, and Pi session binding. Legacy owner fields are compatibility metadata only.

#### Current

The active `PiboSessionStore` owns `PiboSession` records with unique `piSessionId`, parent and origin ids, profile, workspace, metadata, title, active model, and any legacy owner compatibility value needed by old stores. In normal gateway startup, `createDefaultPiboDataSessionStore()` stores those records in `pibo.sqlite.sessions`. The legacy `SqlitePiboSessionStore` still owns `pibo-sessions.sqlite` records when explicitly used or during migration, and Chat Web ingestion may also update indexed session/navigation fields for room and trace queries.

#### Acceptance

- Runtime routing resolves a Pibo Session from the session store before creating or resuming a runtime.
- The configured router session store is the authority for creating or resuming a routed runtime; in normal gateway startup that store is `PiboDataSessionStore` backed by `pibo.sqlite.sessions`.
- Updating a routed session's profile, title, workspace, metadata, or active model must go through the session store or a channel service that delegates to it.
- Duplicate Pi session ownership is rejected by the canonical session store.

#### Scenario: Projection missing for an existing session

- GIVEN the Pibo Session Store contains session `S`
- AND `session_navigation` has no row for `S`
- WHEN a routed message targets `S`
- THEN routing uses the Pibo Session Store record and can rebuild Chat Web navigation projections from later ingestion.

### Requirement: Chat Web owns rooms and read-model projections in the v2 data store

The system MUST treat `pibo.sqlite` as the canonical store for Chat Web rooms, app-global read state, event-log rows, payload metadata, chat messages, observations, runtime telemetry, workflow UI catalog/authoring rows, and navigation projections.

#### Current

`PiboDataStore` creates `pibo.sqlite`, applies schema version 2, and exposes stores for payloads, event log, messages, observations, navigation, session rows, and telemetry. Chat room/query services use this store for room trees, event timelines, read cursors, and navigation, while Chat Web workflow stores add workflow draft, published-version, prompt-asset, archive, tombstone, and lifecycle-event tables in the same database.

#### Acceptance

- Room creation, archive state, and workspace metadata are persisted in `pibo.sqlite`.
- User-message acceptance creates durable Chat Web event rows and updates projections through v2 data-store services.
- Chat Web read and unread state is app-global and derived from fresh app read-state tables or legacy principal stats during migration.
- Runtime telemetry rows in `pibo.sqlite` remain diagnostic evidence and do not replace chat messages, observations, or Pi transcripts.
- Workflow UI catalog and authoring rows in `pibo.sqlite` own global workflow drafts, published versions, prompt assets, archive states, delete tombstones, and lifecycle events; Project-specific workflow execution state remains in `web-projects.sqlite`.
- Consumers must treat `session_navigation`, `chat_messages`, and `observations` as projections of accepted input and runtime output, not as independent runtime transcripts.

#### Scenario: Navigation row is stale

- GIVEN a session has a newer event-log row than its navigation projection
- WHEN Chat Web re-indexes or ingests the event
- THEN it updates navigation from the event/session data instead of treating the stale navigation row as canonical.

### Requirement: Runtime wiring stays on v2-native data services

The system MUST keep normal gateway and Chat Web runtime paths wired to the v2 data-store services, not to legacy Chat Web read-model implementations or environment-mode flags.

#### Current

`PiboGatewayServer` creates its default Pibo Session Store through `createDefaultPiboDataSessionStore()`. `createChatWebApp` imports `PiboDataStore`, `ChatDataIngestService`, and v2-native services from `src/apps/chat/data/*` for rooms, sessions, timelines, event commands, projects, read state, workflow authoring/catalog stores, and telemetry-backed inspection. Guard tests assert that Chat Web runtime code does not import legacy `event-log`, `read-model`, or `rooms` modules, that the default gateway does not call the legacy `createDefaultPiboSessionStore()`, and that old data-mode flags are absent from runtime files.

#### Acceptance

- Normal gateway startup without an explicit test/session-store override uses the v2-backed Pibo Session Store.
- Chat Web route handlers use v2-native services for room, session, timeline, event command, workflow authoring/catalog, read-state, telemetry, and ingest behavior.
- Runtime files do not gate normal behavior on `PIBO_CHAT_DATA_MODE` or `PIBO_DATA_V2_WRITE`.
- Runtime files do not select legacy `web-chat.sqlite` stores for Chat Web room or session operation.
- Legacy store modules may exist for compatibility or migration, but they are not imported into normal Chat Web runtime wiring.

#### Scenario: Legacy Chat Web mode is not reintroduced

- GIVEN the normal gateway and Chat Web app are built from current source
- WHEN source-level guard checks inspect runtime files
- THEN the gateway default session store is v2-backed
- AND Chat Web runtime imports v2-native services instead of legacy chat stores
- AND no legacy data-mode environment flag controls the runtime path.

### Requirement: Reliability state is operational, not Chat Web canonical state

The system MUST use `pibo-events.sqlite` for operational replay, durable jobs, and yielded-run records, without replacing Chat Web's event log or the Pibo Session Store.

#### Current

`PiboReliabilityStore` defaults to `pibo-events.sqlite`. It stores append-only Pibo events with topics and retention classes, consumer offsets, pending/dead jobs, and yielded-run records. Chat Web ingestion mirrors normalized output events into the `pibo.output` topic for diagnostics and replay.

#### Acceptance

- Reliability events are append-only and cursor-addressable by stream id.
- Consumer offsets are monotonic and scoped to a consumer/topic pair.
- Durable jobs and yielded-run records recover operational work after interruption.
- Missing reliability mirror rows do not erase Chat Web room events or Pibo Session records.
- Replaying reliability data may repair or diagnose projections, but it must not invent a canonical Pibo Session that is absent from the session store.

#### Scenario: Reliability mirror is pruned

- GIVEN Chat Web has persisted event-log rows for session `S`
- AND older `pibo.output` reliability rows have been pruned according to retention policy
- WHEN a user opens the Chat Web trace for `S`
- THEN the trace uses Chat Web/Pi transcript sources and does not fail because the reliability mirror was pruned.

### Requirement: Focused stores own focused product records

The system MUST keep focused product records in their owning stores and reference them by stable ids from other subsystems.

#### Current

`ChatProjectService` owns `web-projects.sqlite` projects, Project sessions, workflow session snapshots, workflow runs, wait tokens, and human actions. `PiboCronStore` owns `pibo-cron.sqlite` jobs and runs. `PiboRalphStore` owns `pibo-ralph.sqlite` jobs, runs, and facts. `CustomAgentStore` owns `chat-agents.sqlite` custom agent definitions. Better Auth owns `auth.sqlite`. The context-file metadata store owns managed context-file metadata and revisions while markdown lives at managed file paths. The Pi package store owns workspace `.pibo/pi-packages.json` and install directories.

#### Acceptance

- Project workflow run and wait-token rows reference Pibo Session IDs without owning the router's session identity.
- Cron jobs and Ralph jobs reference targets such as room ids and persist run outcomes without owning room or session records.
- Custom agents persist selected capability keys and package ids without owning the capability catalog or package installer state.
- Better Auth user/session tables are used only by auth services; auth identities do not create product data partitions.
- Managed context-file metadata owns revision history; plugin context files remain read-only plugin resources.
- Pi package registration does not activate a runtime package unless a profile selects the package and runtime loading succeeds.

#### Scenario: Referenced custom-agent package is removed

- GIVEN a custom agent stores a selected Pi package id
- AND that package is removed from the workspace Pi package store
- WHEN the custom-agent profile is assembled
- THEN the package is skipped or diagnosed by runtime/profile assembly, and the custom-agent record remains the owner of the user's selection.

### Requirement: Local settings stores have narrow, typed ownership

The system MUST keep local configuration, model defaults, user settings, and prompt choices in separate typed stores with bounded recovery behavior.

#### Current

`config.json` stores local operator config such as auth settings. `model-defaults.json` stores provider/model defaults. `user-settings.json` stores shared app settings such as timezone; older per-owner entries are read only as migration fallback. Workspace `.pibo/base-prompt.*` and `.pibo/compaction-prompt.*` store runtime prompt modes and custom content.

#### Acceptance

- Config display redacts secrets and rejects unknown keys through the config CLI contract.
- Invalid or missing model defaults fall back to supported defaults without corrupting sessions that already froze an active model.
- Invalid or missing shared app timezone falls back to `UTC`.
- Prompt stores preserve custom content across mode switches and remain workspace-scoped.
- None of these settings stores owns session, room, event, or auth identity records.

#### Scenario: Corrupt user settings file

- GIVEN `user-settings.json` is missing or cannot be parsed as valid state
- WHEN runtime context asks for the shared app timezone
- THEN Pibo returns the default timezone and does not alter session identity.

### Requirement: Debug store names are diagnostic aliases

The system MUST expose debug store names as read-only diagnostics and MUST distinguish aliases from distinct canonical stores.

#### Current

`PIBO_DEBUG_STORES` maps `pibo-data`, `sessions`, and `chat` to `pibo.sqlite`, maps `agents` to `chat-agents.sqlite`, `auth` to `auth.sqlite`, `bindings` to `session-bindings.sqlite`, and `reliability` to `pibo-events.sqlite`. Debug commands report existence and inspect tables without mutating stores.

#### Acceptance

- `pibo debug stores` shows each known store name, resolved path, and whether the file exists.
- `sessions` and `chat` debug names are aliases for different views of `pibo.sqlite`, not separate owners of session or chat facts.
- A missing debug store is reported as missing instead of being created by read-only diagnostics.
- Debug SQL rejects mutating statements.

#### Scenario: Debug alias inspection

- GIVEN `pibo.sqlite` exists
- WHEN an operator inspects debug stores
- THEN `pibo-data`, `sessions`, and `chat` resolve to the same path with different descriptions.

## Edge Cases

- A projection can lag behind its source event; readers that need canonical behavior must consult the owning store or rebuild the projection.
- A focused store may reference a missing external id, such as a deleted room or package; validation happens at use time and must not silently mutate the owning record unless the user requested cleanup.
- Store constructors may use `:memory:` for tests; behavior must match file-backed stores except for persistence and WAL mode.
- Debug aliases may include legacy or currently unused store names; diagnostics must label missing files without implying current ownership.
- JSON fields must degrade safely when malformed in stores that explicitly sanitize on read.

## Constraints

- **Product Boundary:** Pibo-owned stores define product state. Pi Coding Agent transcripts are separate engine persistence and are used for trace reconstruction, not for Pibo room or routing ownership.
- **Compatibility:** Existing store paths remain stable unless a migration explicitly moves data and updates debug discovery.
- **Security / Privacy:** Auth state and secrets must not be exposed through debug or config display beyond redacted, read-only diagnostics.
- **Reliability:** Projection repair may use durable events, but canonical stores must remain idempotent and avoid duplicating facts.
- **Context Economy:** Specs and debug output should name store ownership compactly instead of repeating full schemas at every command level.

## Success Criteria

- [ ] SC-001: Product-wide store paths resolve from `PIBO_HOME` or `~/.pibo`, while workspace stores remain under the effective workspace `.pibo/` directory.
- [ ] SC-002: Routed runtime creation depends on the Pibo Session Store, not on Chat Web projection tables.
- [ ] SC-003: Chat Web room, event, app read-state, and navigation behavior is owned by `pibo.sqlite` services.
- [ ] SC-004: Reliability replay, durable jobs, and yielded-run records are owned by `pibo-events.sqlite` without replacing Chat Web event-log state.
- [ ] SC-005: Cron jobs, custom agents, Better Auth, context files, Pi packages, prompts, model defaults, config, and user settings each have narrow store ownership.
- [ ] SC-006: Debug store commands reveal resolved paths and aliases without creating or mutating stores.
- [x] SC-007: Normal gateway and Chat Web runtime wiring stay on v2-native data services and do not reintroduce legacy Chat Web data-mode flags, as covered by `test/chat-data-v2-legacy-guard.test.mjs`.

## Assumptions and Open Questions

### Assumptions

- The current v2 direction is that `pibo.sqlite` is the unified Chat Web and projected-session data store, while the router's Pibo Session Store remains the routing authority.
- `session-bindings.sqlite` is retained as a debug-visible legacy or compatibility store name until source code removes or redefines it.

### Open Questions

- Should a future migration retire `pibo-sessions.sqlite` in favor of `pibo.sqlite.sessions`, or should both stores remain distinct long term?
- Should debug output explicitly label `sessions` and `chat` as aliases to reduce operator confusion?
- Which repair command, if any, should rebuild Chat Web projections from canonical session and event sources?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Store roots are deterministic | Isolated product home | `src/core/pibo-home.ts`, `src/data/pibo-store.ts`, `src/reliability/store.ts`, `src/cron/store.ts`, `src/core/base-prompt.ts`, `src/core/compaction-prompt.ts`, `src/pi-packages/store.ts` | Draft |
| REQ-002 Pibo Session identity has one routing source of truth | Projection missing for an existing session | `src/sessions/sqlite-store.ts`, `src/sessions/store.ts`, `src/sessions/pibo-data-store.ts`, `src/gateway/server.ts`, `src/core/session-router.ts`, `src/data/schema.ts` | Draft |
| REQ-003 Chat Web owns rooms and read-model projections | Navigation row is stale | `src/data/schema.ts`, `src/data/pibo-store.ts`, `src/data/telemetry.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat/data/room-service.ts`, `src/apps/chat/data/read-state-service.ts`, `src/apps/chat/data/navigation-query-service.ts` | Draft |
| REQ-004 Runtime wiring stays on v2-native data services | Legacy Chat Web mode is not reintroduced | `src/gateway/server.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat/data/*.ts`, `test/chat-data-v2-legacy-guard.test.mjs` | Covered |
| REQ-005 Reliability state is operational | Reliability mirror is pruned | `src/reliability/store.ts`, `src/apps/chat/web-app.ts`, `src/data/ingest-service.ts` | Draft |
| REQ-006 Focused stores own focused product records | Referenced custom-agent package is removed | `src/apps/chat/data/project-service.ts`, `src/cron/store.ts`, `src/ralph/store.ts`, `src/apps/chat/agent-store.ts`, `src/auth/better-auth.ts`, `src/plugins/context-files-store.ts`, `src/pi-packages/store.ts` | Draft |
| REQ-007 Local settings stores have narrow ownership | Corrupt user settings file | `src/config/config.ts`, `src/core/model-defaults.ts`, `src/core/user-settings.ts`, `src/core/base-prompt.ts`, `src/core/compaction-prompt.ts` | Draft |
| REQ-008 Debug store names are diagnostic aliases | Debug alias inspection | `src/debug/stores.ts`, `src/debug/sql.ts`, `src/debug/index.ts` | Draft |

## Verification Basis

This spec is based on current source inspection of:

- `GLOSSARY.md`
- `docs/specs/README.md`
- the full current `docs/specs/` file list
- `src/core/pibo-home.ts`
- `src/sessions/sqlite-store.ts`
- `src/data/schema.ts`
- `src/data/pibo-store.ts`
- `src/data/telemetry.ts`
- `src/sessions/pibo-data-store.ts`
- `src/gateway/server.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/data/*.ts`
- `test/chat-data-v2-legacy-guard.test.mjs`
- `src/reliability/store.ts`
- `src/cron/store.ts`
- `src/ralph/store.ts`
- `src/apps/chat/data/project-service.ts`
- `src/apps/chat/agent-store.ts`
- `src/auth/better-auth.ts`
- `src/plugins/context-files-store.ts`
- `src/pi-packages/store.ts`
- `src/debug/stores.ts`
