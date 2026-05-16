# Tasks: Pibo Observability and Debug Telemetry

## 1. Spec and Discovery Foundation

- [ ] 1.1 Review and approve `docs/specs/changes/pibo-observability-debug-telemetry/spec.md`.
- [ ] 1.2 Review and approve `docs/specs/changes/pibo-observability-debug-telemetry/design.md`.
- [x] 1.3 Decide storage location: unified `pibo.sqlite` with dedicated telemetry tables and explicit session/event/payload correlation fields.
- [ ] 1.4 Decide provider/phase-aware stale threshold defaults; V1 payload-preview capture defaults to disabled/unavailable unless explicitly approved later.
- [ ] 1.5 Add or update capability spec after design approval if needed.

## 2. Data Model, Links, and Storage Volume

- [x] 2.1 Add `pibo.sqlite` telemetry schema migration for turns, phases, provider requests, provider events/aggregates, tool calls, retention classes, preview-unavailable contract, and indexes for session/event/payload joins.
- [x] 2.2 Add typed telemetry store/service with bounded insert/update methods.
- [x] 2.3 Add bounded-preview/truncation helper for optional preview paths and header/payload-like display values.
- [x] 2.4 Add retention class and stats support.
- [x] 2.5 Add tests for idempotent migration, missing store behavior, session/event/payload joins, bounded storage, truncation, and prune dry-run.

## 3. Runtime and Provider Capture

- [x] 3.1 Capture queue and turn lifecycle in session router / routed session.
- [x] 3.2 Capture phase transitions from normalized events.
- [x] 3.3 Capture provider request lifecycle around stream calls.
- [x] 3.4 Capture bounded provider event metadata/summaries in OpenAI/Codex Responses stream parser without duplicating raw provider bodies.
- [x] 3.5 Capture parse error and unknown-event counters.
- [x] 3.6 Capture tool-call argument progress metadata, including deltas as counters and timestamps.
- [x] 3.7 Capture tool execution start/update/finish summaries.
- [x] 3.8 Add tests for partial tool-call stream, malformed SSE event, unknown event type, and interleaved tool calls where feasible.

## 4. Signals and Staleness Hints

- [x] 4.1 Add active phase and last progress summary to runtime status or signal projection.
- [x] 4.2 Add provider/profile-aware stale threshold settings, including a minimal Provider Settings option.
- [x] 4.3 Add stale work detector that reads telemetry without aborting work.
- [x] 4.4 Expose stale hints through gateway status when available.
- [x] 4.5 Add tests for active stale session, non-stale active session, and provider-specific threshold behavior.

## 5. Debug CLI

- [x] 5.1 Add `pibo debug telemetry --help` with compact progressive discovery.
- [x] 5.2 Add `sessions`, `session`, and `turn` commands with bounded text and JSON output.
- [x] 5.3 Add `provider`, `provider events`, and optional `provider payload` unavailable/preview command with cursors/aggregation, limits, allowlisted fields, and truncation indicators.
- [x] 5.4 Add `tool` command for tool-call argument and execution telemetry.
- [x] 5.5 Add `stale` command with threshold option.
- [x] 5.6 Add `stats` and `prune` commands with dry-run default.
- [x] 5.7 Add next-command suggestions to text and JSON output.
- [x] 5.8 Add tests mirroring existing debug CLI patterns.

## 6. Validation

- [x] 6.1 Run `npm run typecheck`.
- [x] 6.2 Run debug CLI tests.
- [x] 6.3 Reproduce a synthetic partial-tool-call telemetry fixture and verify drill-down path:
  - [x] `pibo debug telemetry session ps_...`
  - [x] `pibo debug telemetry turn <turn-id>`
  - [x] `pibo debug telemetry provider <provider-request-id>`
  - [x] `pibo debug telemetry tool <tool-call-id>`
- [x] 6.4 Verify no default command prints raw provider payloads, full transcripts, normalized event payloads, or full tool arguments.
- [x] 6.5 If payload preview commands exist, verify disabled/unavailable behavior by default and truncation/preview metadata when previews are explicitly enabled.

## 7. Documentation and Handoff

- [x] 7.1 Add examples to the Debug CLI capability spec or a dedicated telemetry capability spec.
- [x] 7.2 Add an incident-debug playbook: stuck streaming session, partial tool call, provider parse error, stale tool execution.
- [x] 7.3 Document retention defaults and pruning commands.
- [x] 7.4 Document how agents should drill down without overflowing context.
