# PRD: Pibo Observability and Debug Telemetry — Product Overview

**Status:** Draft
**Created:** 2026-05-16
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: When a Pibo Chat Web session stalls, operators and agents can currently see high-level state such as `processing=true` or `streaming=true`, but cannot reliably determine whether the queue, provider stream, parser, tool-call argument construction, or tool execution is stuck.
- **Proposed Solution**: Add a local-first observability layer and progressive `pibo debug telemetry` CLI that records compact correlated telemetry and lets agents drill from session summary to turn, provider request, event metadata, tool call, stale phase, and retention facts without dumping or duplicating large payloads.
- **Success Criteria**:
  - SC-01: Given only a Pibo Session id, an agent can identify the likely stalled phase in at most four bounded debug commands.
  - SC-02: A partial tool-call stream exposes provider request id, raw event counts, last progress time, argument progress state, and missing completion.
  - SC-03: No default telemetry command prints or duplicates full provider payloads, request headers, transcripts, session content, normalized event payloads, or full tool arguments.
  - SC-04: Every telemetry list/detail command supports bounded text output and `--json` output suitable for agent drill-down.
  - SC-05: V1-complete telemetry includes stats and pruning commands that expose retention classes, record counts, byte sizes, dry-run behavior, and destructive apply behavior.

## 2. User Experience & Functionality

- **User Personas**:
  - AI coding agent diagnosing a stuck Pibo session.
  - Human operator investigating production or dev gateway behavior.
  - Runtime engineer debugging provider stream and tool-call state.
  - CLI/debug engineer extending existing `pibo debug` workflows.
  - Maintainer reviewing storage volume, payload duplication, and debug safety.

- **User Stories**:
  - As an AI operator, I want to start with a session id and receive a compact status summary so that I know which object to inspect next.
  - As a runtime engineer, I want provider request lifecycle facts so that I can distinguish upstream idle, parser failure, unknown event, abort, timeout, and normal completion.
  - As a tool/debug engineer, I want separate tool-call argument telemetry so that I can see whether a tool call completed before execution.
  - As an SRE-style operator, I want stale-session discovery so that I can find active work that has stopped progressing without restarting the gateway.
  - As a maintainer, I want telemetry to store metadata and links rather than duplicate full session/event/tool content so that the unified store remains queryable and bounded.

- **Acceptance Criteria**:
  - `pibo debug telemetry --help` explains summary-first workflows and points to `sessions`, `session`, `turn`, `provider`, `tool`, `stale`, `stats`, and `prune` commands.
  - Session summary output includes recent turns, active phase, queue depth, last progress age, stale indicator, and next commands.
  - Turn output includes ordered phases with start time, end time, status, duration, last progress, stale age, and linked provider/tool ids.
  - Provider output includes model/provider/api/transport, request start, response status, first byte, last raw event, last normalized event, upstream response id when known, raw event counts, parse errors, and unknown event counts.
  - Tool-call output includes tool id/name, provider request id, argument byte length, first/last delta, parse state, safe top-level keys when available, completion state, and execution link when present.
  - Stale output lists active stale sessions/turns and never aborts or mutates them.
  - Default outputs are capped by row count and depth, omit full content payloads, and report truncation or aggregation.

- **Ralph Work Package Derivation**:
  - `US-001`: lock the V1 decision matrix and cross-PRD dependency order before implementation.
  - `US-002`: add durable observability telemetry capability docs outside the change folder.
  - `US-003`: update existing Debug CLI capability docs so the telemetry branch is discoverable.
  - `US-004`: add rollout verification checklist for bounded output, storage safety, stale thresholds, stats/prune, and preview-unavailable behavior.

- **Non-Goals**:
  - Automatic provider hang recovery, automatic abort, or retry behavior.
  - External OpenTelemetry/SaaS observability integration.
  - Full transcript storage or high-cardinality per-token telemetry.
  - Chat Web telemetry drill-down panel in V1.
  - Replacement of existing event logs, trace rendering, or debug CLI branches.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing local `pibo debug` CLI command framework.
  - Unified `pibo.sqlite` store used by Pibo debug/session/event infrastructure.
  - Provider stream parser hooks for OpenAI/Codex Responses streams.
  - Routed session/session router hooks for queue and lifecycle state.
  - JSON output from telemetry commands for agent-driven next-step selection.

- **Evaluation Strategy**:
  - Synthetic stuck-session fixture where tool-call args start but never complete.
  - Synthetic provider stream fixture with unknown event type and malformed JSON.
  - CLI golden/snapshot tests for bounded text output and `--json` shape.
  - Storage/output tests covering large provider payloads, large tool arguments, existing session/event payload links, truncation metadata, and default no-full-content behavior.
  - Agent drill-down test that starts with a session id and reaches the stalled phase in four commands or fewer.

## 4. Technical Specifications

- **Architecture Overview**:
  - Dedicated telemetry tables in `pibo.sqlite` persist compact rows for turns, phases, provider requests, provider event metadata or aggregates, and tool calls. Preview tables/interfaces may exist only to return unavailable by default unless bounded previews are explicitly enabled later.
  - Runtime capture writes best-effort telemetry at queue, turn, phase, provider stream, tool-call, tool execution, abort, and completion boundaries. Telemetry is enabled by default and write failures remain non-fatal.
  - Debug CLI commands read telemetry summaries through store/service APIs and render bounded text or JSON.
  - Live signal/status projection exposes compact hints such as active phase, stale age, and last progress without raw payload details.
  - Telemetry rows link back to existing session, room, event-log, payload metadata, and run/tool evidence instead of duplicating full content.
  - Retention/prune logic manages local disk growth separately for summaries, provider event metadata, and optional preview records if previews are later enabled.

- **Integration Points**:
  - `src/core/session-router.ts` and `src/core/routed-session.ts` for queue, turn, phase, abort, and live state.
  - OpenAI/Codex Responses provider stream processing for provider event metadata/aggregates, parse errors, unknown events, provider request lifecycle, and upstream response id.
  - Existing debug CLI command registration in `src/cli.ts`, `src/debug/*`, and gateway/client helpers as appropriate.
  - Existing event contract and signal capabilities for correlation fields and active-phase hints.

- **Security & Privacy**:
  - Default telemetry output must be summary-only.
  - Telemetry must never store or display full provider request/response bodies, full session transcripts, normalized event payloads, or full tool arguments by default.
  - Optional payload previews, if implemented, must be explicit, bounded, short-lived, and marked with truncation/preview metadata.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - V1 vertical slice: telemetry schema/service, session/event links, volume controls, queue/turn/provider/tool capture, and minimal `session`, `turn`, `provider`, `tool`, and `stale` CLI paths.
  - V1 complete: provider event metadata or aggregate listing, cursor paging, stats/prune commands, signal/status stale hints, incident retention class, fixtures, playbooks, and hardened JSON contracts.
  - v1.1: optional bounded payload previews if explicitly approved, plus provider event compaction/sampling refinements if storage metrics require them.
  - v2.0: optional Chat Web telemetry drill-down UI and incident export workflows.

- **Technical Risks**:
  - Telemetry writes may add streaming overhead; mitigate with bounded best-effort writes and small summaries.
  - Provider event capture may create too much data; mitigate with summary-only defaults, aggregation/sampling, bounded previews, and short retention.
  - Provider event streams may be noisy; mitigate with cursors, limits, counters, and truncation markers.
  - Interleaved tool calls may be mis-correlated; mitigate by tracking provider item ids/tool call ids instead of a single global current item.
  - CLI surface may become too broad; mitigate with compact help and next-command suggestions.
