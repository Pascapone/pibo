# Spec: Telemetry Opt-In Archive Isolation

**Status:** Draft; Phase 0 reliability/gateway hot-path bounds shipped in v1.7.0
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Requester / Source:** Production incident caused by large live telemetry retention
**Related docs:**

- `proposal.md`
- `design.md`
- `tasks.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/`
- `docs/specs/changes/pibo-observability-debug-telemetry/`
- `docs/specs/capabilities/runtime-observability-telemetry.md`

## Why

Pibo needs observability, but detailed telemetry must not become part of the always-on production hot path. A live telemetry table with millions of provider events caused long SQLite operations, high memory pressure, unavailable health checks, and a blocked Chat Web gateway.

The system needs a default mode that keeps the Web UI fast and predictable. Detailed telemetry should be a deliberate capture session, isolated from normal runtime data and easy to archive or delete.

## Goal

Pibo MUST collect detailed telemetry only during explicit telemetry capture runs, store it outside the live gateway database, and keep inactive telemetry archives disconnected from gateway startup, request handling, and normal Chat Web operation.

## Background / Current State

Pibo currently has runtime telemetry tables such as `telemetry_turns`, `telemetry_phases`, `telemetry_provider_requests`, `telemetry_provider_events`, and `telemetry_tool_calls`. These tables can live in `pibo.sqlite` and can grow with every runtime/provider interaction.

The production incident showed three problems:

1. Detailed telemetry grew to a size that affected normal operation.
2. Retention ran in the web gateway request path.
3. The gateway became unavailable while telemetry maintenance ran.

## Scope

### In Scope

- Default-off detailed telemetry.
- Explicit telemetry capture lifecycle.
- Scope-limited and time-limited capture configuration.
- Isolated active telemetry stores.
- Archive finalization and manifest format.
- Archive list, inspect, export, delete, and prune commands.
- Chat Web Settings UI for telemetry status and control.
- Migration strategy for existing live telemetry tables.
- Tests proving telemetry archives are not loaded by default.

### Out of Scope

- Removing normal chat/session persistence — Chat Web needs this data.
- Replacing SQLite as Pibo's local persistence engine — not required for this change.
- Building a remote observability SaaS integration — future work.
- Full runtime resource isolation — covered by `gateway-resource-protection-workers`.
- Full UI redesign and hot-path trace transport — covered by `chat-web-trace-v2-fast-path`; this spec defines archive access contracts, not the final trace UX.

## Definitions

### Operational Data

Data required for normal Pibo operation and UI rendering:

- rooms;
- sessions;
- chat messages;
- visible session event summaries;
- current runtime status;
- job status;
- minimal errors and audit records;
- user settings and app metadata.

Operational data MAY be persisted by default.

### Detailed Telemetry

Debug data not required for normal UI operation:

- raw provider events;
- provider stream payloads;
- detailed provider request timelines;
- detailed tool-call argument phases;
- verbose tool execution diagnostics;
- large payload previews;
- performance trace rows;
- debug snapshots;
- per-token or per-chunk provider details.

Detailed telemetry MUST be opt-in.

### Telemetry Capture Run

An explicit bounded period during which detailed telemetry is recorded for a declared scope.

### Telemetry Archive

A finalized capture run stored outside the live gateway database. Archives are inert until an operator explicitly inspects, exports, or deletes them.

## Requirements

### Requirement: Detailed telemetry is disabled by default

The system MUST NOT collect detailed telemetry on a default installation or after upgrade unless an operator explicitly enables a capture run.

#### Current

Detailed telemetry can be written as part of normal runtime behavior and stored in the live database.

#### Target

Default runtime behavior writes only operational data. Detailed telemetry writers are no-ops unless an active capture run matches the event scope and detail level.

#### Acceptance

- A fresh install runs a session and creates no `telemetry_provider_events` rows in the live gateway database.
- `pibo debug telemetry status` reports `disabled` on a fresh install.
- Chat Web Settings shows telemetry as `Off` by default.

#### Scenario: Fresh install has no active telemetry

- GIVEN Pibo is freshly installed
- WHEN a user sends chat messages and tools run
- THEN detailed telemetry is not persisted
- AND the gateway database does not grow provider-event telemetry tables.

### Requirement: Operational data remains available

The system MUST continue to persist the data required to render rooms, sessions, messages, live status, job status, and minimal errors.

#### Current

Some operational and debug data share storage and retention paths.

#### Target

Operational data is kept separate from detailed telemetry and remains available when telemetry is off.

#### Acceptance

- Chat Web loads rooms and sessions with telemetry disabled.
- Terminal/trace views show normal user-visible session history with telemetry disabled.
- Minimal error records remain available for operator diagnosis.

#### Scenario: Chat works with telemetry disabled

- GIVEN telemetry is disabled
- WHEN a session runs and completes
- THEN the user can reload Chat Web and see the session output
- AND no detailed provider telemetry archive is created.

### Requirement: Reliability output payloads are bounded

The system MUST NOT store unbounded tool output or runtime output payloads inline in hot operational event streams.

#### v1.7.0 Status

Implemented for the Chat Web reliability mirror path: over-budget `pibo.output` payloads are compacted to previews and payload references before append. This does not complete the full telemetry capture/archive lifecycle.

#### Current

The reliability event stream can store full `pibo.output` payloads such as `tool_execution_finished` in `pibo-events.sqlite`. Local evidence showed `pibo_event_stream.payload_json` totaling about 629 MB, with individual output events up to about 4.8 MB.

#### Target

Operational/reliability streams store small envelopes, status, correlation ids, previews, and payload references. Large output bodies are written to a payload store or telemetry/archive store with explicit size limits and lifecycle policy.

#### Acceptance

- A tool result larger than the configured inline threshold is not stored inline in `pibo_event_stream.payload_json`.
- Reliability replay can recover event order and status without loading full large payloads.
- Chat Web can render a preview and request full payload explicitly if permitted.
- A synthetic workload that emits repeated multi-MB tool results does not grow gateway heap without bound.

#### Scenario: Large tool result

- GIVEN a tool finishes with a 5 MB result
- WHEN Pibo persists operational output
- THEN the reliability event contains metadata and a payload reference
- AND the inline event JSON remains below the configured hot-path limit.

### Requirement: Gateway self-observability remains always on and bounded

The system MUST collect minimal gateway health and resource metrics even when detailed telemetry is disabled.

#### v1.7.0 Status

Implemented as bounded gateway diagnostics for memory, event-loop delay, streams/listeners, trace cache bytes, transient replay buffer bytes, reliability payload buckets, externalized payload counts, and recent resource warnings.

#### Target

Always-on self-observability records small rolling metrics for gateway survival diagnostics:

- heap used/total;
- RSS, external memory, and array buffers;
- event-loop delay;
- active SSE/event streams and live listeners;
- trace cache count and estimated bytes;
- transient replay buffer count and estimated bytes;
- large payload write counters;
- SQLite file and WAL sizes;
- store row counts from bounded/indexed queries only.

#### Acceptance

- `pibo gateway web status` or a dedicated diagnostics command can show current memory and cache pressure.
- Chat Web health/debug endpoints expose bounded resource metrics without scanning large tables.
- A small rolling history survives crashes for postmortem analysis.
- Metrics collection itself has fixed memory and disk budgets.

#### Scenario: Heap grows

- GIVEN the gateway heap grows past a warning threshold
- WHEN diagnostics are requested
- THEN Pibo reports heap, active streams, cache sizes, recent large payload writes, and top store sizes
- AND the diagnostic request does not load large payloads.

### Requirement: Operators can start scoped telemetry capture

The system MUST provide CLI and Web API controls to start a telemetry capture run with scope, detail level, and limits.

#### Scope Options

The first implementation SHOULD support:

- current session;
- selected room;
- selected session id;
- global capture with strict duration limit.

#### Detail Levels

The first implementation SHOULD support:

- `summary`: timings, counters, phase transitions, errors;
- `diagnostic`: summary plus provider request lifecycle and tool-call diagnostics;
- `verbose`: diagnostic plus bounded raw provider event metadata and payload references.

#### Limits

Capture runs MUST support at least:

- maximum duration;
- maximum archive size;
- optional maximum raw event count;
- optional payload capture enabled/disabled.

#### Acceptance

- `pibo telemetry start --scope session:<id> --duration 30m --level diagnostic` starts a run.
- Chat Web Settings can start a capture run for the current session.
- Starting a run returns a run id.
- Run status includes scope, level, startedAt, limits, size, and row counts when known.

#### Scenario: Start session-scoped capture

- GIVEN telemetry is disabled
- WHEN an operator starts diagnostic capture for session `ps_123`
- THEN a capture run is created
- AND only matching telemetry events are persisted.

### Requirement: Active telemetry writes to isolated storage

The system MUST write detailed telemetry for active capture runs to a separate active telemetry store, not to the live gateway database.

#### Current

Telemetry can share the live `pibo.sqlite` store.

#### Target

Active telemetry uses an isolated path, for example:

```text
$PIBO_HOME/telemetry/active/<run-id>/telemetry.sqlite
$PIBO_HOME/telemetry/active/<run-id>/manifest.json
```

#### Acceptance

- During active capture, `pibo.sqlite` does not receive detailed telemetry rows.
- The active telemetry store can be deleted or finalized without changing operational session data.
- The gateway can start when an active telemetry store is absent, corrupt, or too large; it reports the run as failed/needs recovery instead of loading it into the hot path.

#### Scenario: Active capture database is separate

- GIVEN telemetry capture is active
- WHEN provider events are recorded
- THEN the rows are written to the active capture database
- AND not to the live gateway database.

### Requirement: Stopping capture archives the telemetry run

The system MUST finalize active telemetry capture into an archive that is inert by default.

#### Target Archive Layout

Recommended layout:

```text
$PIBO_HOME/telemetry/archives/<run-id>/manifest.json
$PIBO_HOME/telemetry/archives/<run-id>/telemetry.sqlite
$PIBO_HOME/telemetry/archives/<run-id>/artifacts/...
```

#### Manifest Fields

The archive manifest MUST include:

- run id;
- schema version;
- Pibo version;
- status (`completed`, `stopped`, `failed`, `corrupt`, `migrated-legacy`);
- scope;
- detail level;
- startedAt;
- stoppedAt;
- duration;
- size bytes;
- row counts by table when available;
- payload/artifact flags;
- retention/delete policy;
- optional incident/user note.

#### Acceptance

- Stopping a run closes the active store and moves or marks it under `archives`.
- The gateway does not open the archive on startup.
- `pibo telemetry archives list` reads manifests without opening large SQLite files.

#### Scenario: Stop capture run

- GIVEN a telemetry capture run is active
- WHEN an operator stops it
- THEN the run is finalized as an archive
- AND normal Chat Web continues without loading the archive.

### Requirement: Archives are not loaded by default

The system MUST NOT open, migrate, scan, retain, or count telemetry archive SQLite files during gateway startup, health checks, Chat Web bootstrap, room/session listing, or normal session routing.

#### Acceptance

- A 50 GB telemetry archive under `$PIBO_HOME/telemetry/archives` does not affect gateway startup time beyond manifest directory listing budgets.
- Health checks do not touch archive SQLite files.
- Chat Web bootstrap does not open archive SQLite files.
- Tests fail if archive DB handles are opened during normal gateway startup.

#### Scenario: Large archive is inert

- GIVEN a large telemetry archive exists
- WHEN the gateway starts
- THEN the gateway becomes healthy without opening the archive database.

### Requirement: Archive inspection is explicit and bounded

The system MUST provide explicit commands and APIs for inspecting telemetry archives without importing them into the live store.

#### Target

Inspection should be command-driven and progressive:

```bash
pibo telemetry archives list
pibo telemetry archive show <run-id>
pibo telemetry archive stats <run-id>
pibo telemetry archive query <run-id> --selector ...
pibo debug telemetry archive <run-id> summary
```

Chat Web MAY expose archive inspection, but it MUST do so through background jobs or bounded paginated reads.

#### Acceptance

- Archive stats can be read without blocking health checks.
- Large queries require explicit selectors and limits.
- UI archive inspection shows loading/progress state and can be cancelled.

#### Scenario: Inspect archive summary

- GIVEN an archived run exists
- WHEN an operator runs `pibo telemetry archive show <run-id>`
- THEN Pibo reads the manifest and returns summary metadata
- AND does not scan the full telemetry database unless requested.

### Requirement: Archive deletion and retention run outside the gateway

The system MUST NOT run archive deletion, pruning, compaction, or vacuum inside the gateway request path.

#### Current

Telemetry retention can run synchronously during a web request.

#### Target

Archive maintenance runs as:

- CLI command;
- system worker job;
- scheduled maintenance worker;
- resource-limited job from the resource protection framework.

#### Acceptance

- Chat Web starts archive deletion by creating a job and returning immediately.
- Job progress is visible.
- Cancelling a job stops future batches and leaves a consistent archive state.
- Gateway health checks remain responsive during archive deletion.

#### Scenario: Delete old archive from UI

- GIVEN an old telemetry archive exists
- WHEN the user clicks delete
- THEN Chat Web creates a maintenance job
- AND the job deletes the archive outside the gateway request path
- AND the UI remains responsive.

### Requirement: Existing live telemetry data has a safe migration path

The system MUST provide a migration strategy for installations that already contain detailed telemetry in the live database.

#### Migration Modes

The implementation SHOULD support at least two modes:

1. **Leave-as-legacy:** keep legacy telemetry tables in place but disable all live reads/writes and never scan them automatically.
2. **Offline archive:** copy or move legacy telemetry into a telemetry archive using a maintenance tool.

The default upgrade MUST choose the safest mode that avoids long gateway startup or blocking maintenance.

#### Acceptance

- Upgrading a system with a 26 GB `pibo.sqlite` does not automatically scan, copy, delete, or vacuum telemetry tables in the gateway process.
- Operators can run `pibo telemetry legacy status` to see whether legacy telemetry exists.
- Operators can run an offline/batch migration to archive or prune legacy telemetry.

#### Scenario: Upgrade with large legacy telemetry

- GIVEN `pibo.sqlite` contains millions of legacy telemetry rows
- WHEN Pibo starts after upgrade
- THEN the gateway becomes healthy
- AND legacy telemetry is marked as inactive
- AND no retention/prune runs automatically.

### Requirement: Telemetry settings are explicit and safe

The system MUST expose telemetry state clearly in settings and CLI.

#### Acceptance

- Settings shows `Off`, `Active`, `Stopping`, `Archived`, or `Failed`.
- The UI explains that telemetry may capture sensitive debug data.
- Capture controls require scope and duration.
- Global verbose capture requires confirmation.
- The system shows where archives live on disk.

#### Scenario: User views telemetry settings

- GIVEN telemetry is off
- WHEN the user opens Settings → Telemetry
- THEN the page shows that detailed telemetry is disabled
- AND offers explicit capture start controls.

## Edge Cases

- Active capture store is corrupt.
- Disk fills while telemetry is active.
- Pibo crashes during capture.
- Operator starts a second overlapping capture.
- Archive manifest exists but database is missing.
- Archive database exists but manifest is missing.
- A capture exceeds duration or size limit.
- A global capture is enabled and many sessions run concurrently.
- Legacy telemetry tables exist with unknown schema version.
- A user deletes an archive while an inspection job is running.

## Constraints

- **Compatibility:** Existing installations must upgrade without blocking the gateway.
- **Privacy:** Verbose telemetry can contain sensitive data; it must be opt-in and deletable.
- **Performance:** Gateway startup and health checks must not open archive databases.
- **Data Safety:** Archive finalization must be crash-tolerant.
- **Resource Isolation:** Maintenance work must use the resource-protected worker model once available.
- **Cross-platform:** Archive lifecycle must work on Linux, macOS, and Windows. Resource limits may vary by platform.

## Success Criteria

- [ ] SC-001: A fresh install with telemetry disabled runs sessions without detailed telemetry rows in the live DB.
- [ ] SC-002: An active capture run writes detailed telemetry to an isolated active store.
- [ ] SC-003: Stopping capture produces an archive manifest and disconnects the archive from the live system.
- [ ] SC-004: Gateway startup and `/health` do not open archive SQLite files.
- [ ] SC-005: Legacy large telemetry tables do not trigger automatic startup migration, retention, or prune.
- [ ] SC-006: Archive delete/prune runs as a cancellable job outside the gateway request path.
- [ ] SC-007: Chat Web Settings exposes telemetry state and warns about sensitive debug capture.
- [ ] SC-008: Tests cover default-off behavior, archive isolation, migration safety, and UI/API lifecycle.
- [x] SC-009: Reliability `pibo.output` hot-path payloads are bounded with previews/payload refs in the Chat Web gateway path.
- [x] SC-010: Always-on gateway resource diagnostics expose memory/cache/replay/payload pressure without opening telemetry archives.

## Assumptions and Open Questions

### Assumptions

- Pibo still needs minimal operational event persistence for Chat Web.
- Existing detailed telemetry can be treated as legacy inactive data until an operator migrates or deletes it.
- SQLite remains acceptable for isolated telemetry archives when access is explicit and bounded.
- Operators prefer missing verbose telemetry over an unavailable gateway.

### Open Questions

- Should there be any default always-on telemetry beyond minimal operational breadcrumbs?
- What is the default maximum duration for a global telemetry capture: 15, 30, or 60 minutes?
- Should payload capture require a separate confirmation even inside verbose telemetry?
- Should legacy live telemetry be migrated to archives automatically only when below a small size threshold?
- Should archive inspection be available in Web V1, or CLI-only first?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Default-off detailed telemetry | Fresh install has no active telemetry | `tasks.md` Phase 1 | Pending |
| Operational data remains available | Chat works with telemetry disabled | `tasks.md` Phase 1 | Pending |
| Scoped capture | Start session-scoped capture | `tasks.md` Phase 2 | Pending |
| Isolated active storage | Active capture database is separate | `tasks.md` Phase 2 | Pending |
| Archive finalization | Stop capture run | `tasks.md` Phase 3 | Pending |
| Archives inert by default | Large archive is inert | `tasks.md` Phase 3 | Pending |
| Explicit inspection | Inspect archive summary | `tasks.md` Phase 4 | Pending |
| Maintenance outside gateway | Delete old archive from UI | `tasks.md` Phase 5 | Pending |
| Legacy migration safety | Upgrade with large legacy telemetry | `tasks.md` Phase 6 | Pending |
| Safe settings | User views telemetry settings | `tasks.md` Phase 4 | Pending |
