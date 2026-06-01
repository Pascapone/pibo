# PRD: Pibo Observability and Debug Telemetry — Store, Links, Volume, and Retention

**Status:** Draft
**Created:** 2026-05-16
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Pibo lacks a structured telemetry data model that can persist correlated runtime facts without relying on timestamp inference or raw log dumps.
- **Proposed Solution**: Add additive telemetry tables inside the unified `pibo.sqlite` data store plus typed store/service APIs for turns, phases, provider requests, provider event summaries or aggregates, and tool calls, with explicit correlation, volume control, retention behavior, and a preview-disabled contract by default.
- **Success Criteria**:
  - SC-01: Telemetry rows can be joined by explicit ids across session, room, normalized event, payload metadata, turn, phase, provider request, upstream response, tool call, run, and event stream where available.
  - SC-02: Schema migrations are idempotent and do not break existing Pibo debug/session/event stores.
  - SC-03: Payload/content-volume tests prove telemetry does not duplicate full transcripts, normalized event payloads, provider payload bodies, or full tool arguments by default.
  - SC-04: Store APIs support bounded insert/update/list/detail operations needed by runtime capture and debug CLI.
  - SC-05: Retention stats and prune dry-run can report rows and byte counts by retention class before deletion.

## 2. User Experience & Functionality

- **User Personas**:
  - Runtime engineer writing telemetry events.
  - CLI engineer querying telemetry summaries.
  - Maintainer auditing storage volume, preview behavior, and content duplication.
  - Maintainer operating local stores over time.

- **User Stories**:
  - As a runtime engineer, I want a typed telemetry service so that capture code can write small correlated facts without knowing SQL details.
  - As a CLI engineer, I want list/detail queries with limits and cursors so that debug commands can stay bounded.
  - As a maintainer, I want telemetry to link to existing session/event/payload evidence instead of storing another copy of the same content.
  - As a maintainer, I want retention classes and prune dry-runs so that telemetry does not grow without bound.

- **Acceptance Criteria**:
  - Schema supports telemetry turns, phases, provider requests, provider event summaries or aggregates, tool-call summaries, retention classes, and an explicit preview-unavailable/default-disabled contract.
  - Each table has stable ids, timestamps, status fields, correlation fields, and indexes for common debug paths, especially session → telemetry and telemetry → session/event/payload lookups.
  - Store/service methods are typed and expose insert/update/list/detail APIs without requiring callers to construct raw SQL.
  - Telemetry stores metadata, counters, ids, timings, statuses, byte counts, and compact summaries instead of duplicating full content.
  - V1 does not require payload preview persistence; preview read/write APIs may exist only to return a clear unavailable result unless an explicit bounded preview mode is enabled later.
  - Retention stats and prune dry-run can be consumed by CLI commands.

- **Ralph Work Package Derivation**:
  - `US-001`: shared TypeScript telemetry types, correlation model, retention classes, and preview-unavailable result types.
  - `US-002`: additive `pibo.sqlite` migrations and indexes for bidirectional session/event/payload lookup.
  - `US-003`: best-effort/default-on write APIs for runtime capture.
  - `US-004`: bounded read APIs for CLI and stale detection.
  - `US-005`: centralized volume/truncation helper for storage and rendering.
  - `US-006`: preview-disabled/default-unavailable contract; no automatic raw preview capture.
  - `US-007`: retention stats and dry-run/apply prune service, including the `incident` retention class.

- **Non-Goals**:
  - A full external observability datastore.
  - Storing every token or every raw provider event payload indefinitely.
  - Rewriting existing event log storage.
  - Duplicating existing session transcripts, normalized event payloads, or full tool arguments in telemetry tables.
  - Implementing runtime capture hooks beyond store/service call sites.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - `pibo.sqlite` migration and store utilities already used by Pibo.
  - TypeScript types for telemetry records and query results.
  - Volume-control and truncation utilities used consistently by store and CLI rendering; optional preview redaction applies only to later approved preview paths.

- **Evaluation Strategy**:
  - Migration tests run twice against an empty database and existing database.
  - Store contract tests insert and update turns, phases, provider requests, provider events/aggregates, tool calls, retention classes, and preview-unavailable behavior.
  - Query tests verify limits, cursors, correlation lookup, and missing-store behavior.
  - Storage tests verify telemetry rows link to sessions/events/payload metadata without copying full content.
  - Payload preview tests, if previews are implemented, cover bounded size, truncation metadata, and no default full-content duplication.
  - Retention tests cover stats, dry-run, and apply behavior without touching unrelated stores.

## 4. Technical Specifications

- **Architecture Overview**:
  - Add telemetry record types equivalent to `TelemetryTurn`, `TelemetryPhase`, `TelemetryProviderRequest`, `TelemetryProviderEvent` or aggregate, `TelemetryToolCall`, retention stats, and preview-unavailable result types from `../design.md`.
  - Add a telemetry store/service layer with small methods such as `upsertTurn`, `startPhase`, `finishPhase`, `upsertProviderRequest`, `appendProviderEventSummary`, `upsertToolCall`, `getPayloadPreview` returning unavailable by default, `listSessionTelemetry`, `getTurnTimeline`, `getProviderRequest`, `listProviderEvents`, `getToolCall`, `listStaleWork`, `getStats`, and `pruneTelemetry` or project-style-equivalent names.
  - Keep writes best-effort and small; runtime capture must be able to continue when telemetry is disabled or unavailable.
  - Use indexed ids and timestamps for efficient debug queries and direct joins with `sessions`, `event_log`, payload metadata, rooms, and navigation data in `pibo.sqlite`.

- **Integration Points**:
  - Existing `pibo.sqlite` database initialization/migration code.
  - Existing debug store access and CLI output helpers.
  - Runtime capture sites added by later PRDs.
  - Retention/prune debug commands added by later PRDs.

- **Security & Privacy**:
  - Default capture mode is metadata/summary-only unless explicitly configured otherwise.
  - Header/provider summaries should store structural metadata and byte counts, not full header or payload bodies.
  - Payload preview persistence, if implemented, must record `truncated`, `byteSize`, and `retentionClass` metadata and must stay bounded.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - V1 vertical slice: `pibo.sqlite` schema, record types, typed store/service, link/query helpers, volume-control rules, and core contract tests.
  - V1 complete: retention stats/prune service, `incident` retention class, and preview-disabled/unavailable contract.
  - v1.1: optional bounded payload preview support and aggregated provider-event compaction if needed.

- **Technical Risks**:
  - Schema placement may conflict with existing store boundaries; mitigate with additive `pibo.sqlite` migrations and clear table stewardship.
  - Store writes may become too frequent or too large; mitigate with summary rows, counters, aggregation/sampling, and bounded event summaries.
  - Bounded metadata may omit useful fields; mitigate by exposing safe structural fields such as event type, ids, counters, byte sizes, and selected safe dot-paths.
  - Retention pruning may delete evidence too soon; mitigate with separate classes and documented defaults.
