# PRD: Pibo Observability and Debug Telemetry — Runtime, Provider, and Tool Capture

**Status:** Draft
**Created:** 2026-05-16
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`

## 1. Executive Summary

- **Problem Statement**: Pibo currently emits useful normalized events, but runtime incidents still require inference because queue state, active turn phase, provider request lifecycle, raw stream progress, parser behavior, tool-argument progress, and tool execution are not captured as first-class telemetry.
- **Proposed Solution**: Instrument routed sessions, provider stream processing, tool-call construction, and tool execution with best-effort telemetry writes that preserve progress, correlation, timing, counters, and terminal states while linking back to existing session/event evidence instead of storing full raw payloads or tool arguments by default.
- **Success Criteria**:
  - SC-01: Queue and turn lifecycle telemetry shows accepted, queued, started, completed, aborted, errored, or timed-out work with queue depth and queued-behind count.
  - SC-02: Turn phase telemetry shows active/open phases and terminal phases with last progress timestamps.
  - SC-03: Provider request telemetry records start, headers/status summary, first byte, last raw event, last normalized event, upstream response id when observed, counters, parse errors, unknown event counts, terminal status, and links to normalized events when available.
  - SC-04: Tool-call telemetry records argument deltas as progress metadata, parse state, completion state, safe keys, and execution linkage.
  - SC-05: Capture failures do not crash or block normal provider streaming/tool execution paths.

## 2. User Experience & Functionality

- **User Personas**:
  - Runtime engineer diagnosing session routing and queues.
  - Provider integration engineer debugging OpenAI/Codex Responses streams.
  - Tooling engineer debugging tool-call arguments and tool execution.
  - AI operator investigating an incident after the fact.

- **User Stories**:
  - As a runtime engineer, I want queue and turn lifecycle capture so that I can see whether later messages are blocked behind one stuck turn.
  - As a provider engineer, I want request lifecycle telemetry so that I can tell whether the provider never responded, streamed partially, produced unknown events, failed parsing, completed, aborted, or timed out.
  - As a parser engineer, I want raw event-type summaries so that I can see provider event sequences without dumping raw SSE payloads.
  - As a tool engineer, I want tool-call argument progress so that I can distinguish an incomplete argument stream from a completed tool execution failure.
  - As an operator, I want abort/error capture so that the incident timeline explains why a session recovered.

- **Acceptance Criteria**:
  - Session router/routed session capture records message accepted, queue depth, queued-behind count, turn start, turn finish, abort, clear, and dispose where applicable.
  - Phase capture records the V1 minimum phases `queued`, `message_started`, `provider_request`/`provider_stream`, `assistant_text`, `tool_args`, `tool_execution`, `finish`, `abort`, `error`, and `timeout` when those states occur. `prompt_build`, `reasoning`, and `continuation` are captured when visible through existing runtime events.
  - Provider capture records lifecycle facts and event counters without requiring raw payload capture.
  - Provider event metadata includes sequence number or aggregate window, timestamp, event type, byte size, parse status, normalized type, provider item id when known, tool call id when known, normalized event link when available, and optional bounded sample reference if approved.
  - Tool-call capture records first/last delta time, argument byte length, parse status, safe keys, args completion, execution start, execution end, and error category/message when safe.
  - Best-effort telemetry failures are logged or counted safely and do not throw into the streaming path.

- **Ralph Work Package Derivation**:
  - `US-001`: queue and turn lifecycle capture.
  - `US-002`: explicit phase timeline capture with a stable V1 minimum phase set.
  - `US-003`: provider request lifecycle capture, independent of raw Pi event forwarding.
  - `US-004`: provider event metadata/counters/aggregates without full payload bodies.
  - `US-005`: tool-call argument progress and interleaved-call correlation.
  - `US-006`: tool execution lifecycle summaries.
  - `US-007`: incident-specific stuck-tool-call fixture; broad reusable fixtures stay in PRD 05.

- **Non-Goals**:
  - Implementing stream inactivity timeouts or automatic provider abort/retry.
  - Persisting every raw stream byte, full provider event body, duplicate normalized event payload, or full tool argument body by default.
  - Replacing normalized Pibo event emission.
  - Changing provider semantics except for observation hooks.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Telemetry store/service from PRD 02.
  - Hooks in routed session/session router for lifecycle and phase capture.
  - Hooks in OpenAI/Codex Responses stream processing for raw-event summaries and provider lifecycle.
  - Tool-call and tool-execution event observation from the agent loop/runtime path.

- **Evaluation Strategy**:
  - Unit tests for phase transitions from representative normalized event sequences.
  - Provider parser tests for normal completion, partial tool-call stream, malformed JSON, unknown event type, heartbeat/ignored event, aggregation/sampling behavior, and abort.
  - Tool-call tests for empty, partial, valid, invalid, and complete argument states.
  - Integration fixture reproducing the 2026-05-16 stuck pattern: `tool_call` with `argsComplete=false`, no tool execution, and stale provider/tool phase.

## 4. Technical Specifications

- **Architecture Overview**:
  - Runtime capture writes to the telemetry service at natural lifecycle boundaries.
  - Phase capture maintains one active phase per turn when possible, but supports linked open phases for provider stream and tool args where the model stream requires it.
  - Provider request capture assigns a local `providerRequestId` before the network call and updates it as response headers, raw events, normalized events, errors, aborts, and completion occur.
  - Provider stream parser emits bounded provider event metadata, counters, aggregate/sample rows where needed, and safe structural fields while continuing to produce existing normalized events.
  - Tool-call capture tracks by `toolCallId` and provider item id where available, avoiding a single global current item for interleaved calls and linking back to existing session/event evidence instead of duplicating full args.
  - Tool execution capture links execution start/update/finish to the tool call id and turn id.

- **Integration Points**:
  - `src/core/session-router.ts` and `src/core/routed-session.ts` for queue/turn state.
  - Pi agent loop behavior as upstream package behavior to observe through Pibo-managed seams/wrappers where feasible; do not edit `node_modules`.
  - OpenAI/Codex Responses parser behavior as provider capture targets through Pibo-managed provider wrappers/seams where feasible; do not edit `node_modules`.
  - Existing Pibo event stream ids and normalized event persistence for correlation.

- **Security & Privacy**:
  - Provider capture stores lifecycle metadata, counters, event-type summaries, and safe structural fields by default, not raw payload bodies.
  - Tool-call capture stores argument size, parse state, completion state, and safe keys by default, not full command or argument content.
  - Unknown provider event fields are omitted unless explicitly allowlisted as safe or captured as an approved bounded sample.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - V1 vertical slice: queue/turn/phase capture plus provider request summary and tool-call summary capture.
  - V1 complete: provider event metadata rows or aggregates, safe field selection, parse/unknown counters, incident-specific stuck-tool-call fixture, and interleaved tool-call safeguards.
  - v1.1: optional bounded sample references if preview storage is explicitly approved later.

- **Technical Risks**:
  - Some capture targets live inside dependency packages; mitigate by wrapping provider calls or adding narrow instrumentation seams in Pibo-managed code where direct edits are not appropriate.
  - Interleaved provider items may be mis-associated; mitigate by tracking item ids, output indexes, tool call ids, and provider request ids.
  - Telemetry writes may slow streaming or grow storage too quickly; mitigate with bounded summaries, counters, aggregation/sampling, and best-effort error isolation.
  - Argument parsing may be expensive or unsafe on partial JSON; mitigate with byte limits and tolerant parse-state detection.
