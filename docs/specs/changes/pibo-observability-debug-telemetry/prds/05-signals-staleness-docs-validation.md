# PRD: Pibo Observability and Debug Telemetry — Signals, Staleness, Documentation, and Validation

**Status:** Draft
**Created:** 2026-05-16
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../capabilities/pibo-session-signals.md`, `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`

## 1. Executive Summary

- **Problem Statement**: Even with telemetry rows and CLI commands, operators need a compact way to discover stale active work, see lightweight live hints, and follow repeatable playbooks without flooding context or mutating sessions accidentally.
- **Proposed Solution**: Add active-phase/stale hints to live status/signal projections, implement read-only provider-aware stale detection over telemetry, add minimal Provider Settings config for stale thresholds, document incident-debug playbooks, and validate the full drill-down path with synthetic fixtures and safety checks.
- **Success Criteria**:
  - SC-01: Live status/signal snapshots can expose active phase, last progress time, and stale age without raw provider payloads.
  - SC-02: `pibo debug telemetry stale` can list active stale work above provider/profile-aware configurable thresholds without aborting it.
  - SC-03: Documentation includes playbooks for stuck streaming session, partial tool call, provider parse error, unknown provider event, stale tool execution, and retention cleanup.
  - SC-04: A synthetic partial-tool-call fixture validates session → turn → provider/tool drill-down.
  - SC-05: Validation proves default outputs preserve context budget and never print or duplicate full provider payloads, transcripts, normalized event payloads, or full tool arguments.

## 2. User Experience & Functionality

- **User Personas**:
  - AI agent monitoring whether its own session is stuck.
  - Human operator checking live gateway/session health.
  - QA engineer validating observability behavior.
  - Maintainer writing incident reports and playbooks.

- **User Stories**:
  - As an operator, I want live session status to show a compact active-phase hint so that I know whether to inspect telemetry.
  - As an agent, I want a stale-work list so that I can identify stuck sessions before sending more queued messages.
  - As a QA engineer, I want synthetic telemetry fixtures so that CLI/debug behavior can be tested without depending on live provider failures.
  - As a maintainer, I want incident-debug playbooks so that future investigations follow a safe, repeatable sequence.
  - As a maintainer, I want validation that default outputs are bounded and storage-aware.

- **Acceptance Criteria**:
  - Status/signal projection includes active phase, last progress timestamp, stale age, and queue depth when available.
  - Status/signal projection does not include raw provider events, bounded previews, headers, transcripts, normalized event payloads, or full tool arguments.
  - Stale detection reads telemetry and live state, applies provider/profile-aware configurable thresholds with safe defaults, and never aborts/mutates work.
  - Provider Settings config exposes a minimal telemetry stale threshold option for each provider/profile without requiring a Chat Web telemetry UI in V1.
  - Stale output points to next commands such as `pibo debug telemetry turn <turn-id>` and reports the applied threshold plus threshold source.
  - Playbooks live in docs and use concrete command sequences with warnings about optional preview commands and destructive prune flags.
  - Validation fixtures cover partial tool-call stream, malformed provider JSON, unknown provider event, no telemetry available, omitted/disabled payload capture, provider-specific stale thresholds, and stale tool execution.

- **Ralph Work Package Derivation**:
  - `US-001`: compact active telemetry hints in status/signals.
  - `US-002`: provider/profile stale-threshold settings/config.
  - `US-003`: read-only provider-aware stale detector.
  - `US-004`: core normal and partial-toolcall fixtures.
  - `US-005`: malformed/unknown/no-telemetry/preview-disabled fixtures.
  - `US-006`: end-to-end agent drill-down validation from session id.
  - `US-007`: bounded-output validation across telemetry commands.
  - `US-008`: storage non-duplication and preview-unavailable validation.
  - `US-009`: incident-debug playbooks.
  - `US-010`: final rollout verification checklist.

- **Non-Goals**:
  - Full Chat Web telemetry drill-down panel in V1.
  - Automated remediation of stale sessions.
  - External alerting integrations.
  - Incident export or long-term analytics dashboards.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Telemetry store/service from PRD 02.
  - Runtime capture from PRD 03.
  - CLI commands from PRD 04.
  - Signal/status projection utilities and Provider Settings configuration; no Chat Web telemetry drill-down UI in V1.
  - Synthetic test fixture builders for telemetry records.

- **Evaluation Strategy**:
  - Unit tests for stale threshold behavior and read-only operation.
  - Signal/status tests assert compact hints and absence of payload fields.
  - CLI drill-down test starts with only a session id and reaches a stuck `tool_args` or `provider_stream` phase.
  - Documentation checks or review checklist ensures playbooks reference bounded commands first.
  - End-to-end safety/storage check verifies no default command prints large content bodies, full transcripts, full event payloads, or full tool arguments.

## 4. Technical Specifications

- **Architecture Overview**:
  - Signal projection reads active runtime state and/or recent telemetry summaries to expose a small `activeTelemetry`-style hint object.
  - Stale detection compares active/open phase `lastProgressAt` against provider/profile-aware thresholds and returns bounded rows with ids, phase, stale duration, queue depth, applied threshold, threshold source, and next commands.
  - Provider Settings persists a minimal telemetry stale threshold config option per provider/profile; defaults should handle streaming providers differently from providers that hide long thinking phases.
  - Fixture builders insert representative telemetry records into the local telemetry store for repeatable CLI tests; preview fixtures are only used when the preview contract is explicitly enabled.
  - Docs collect operator playbooks under the change docs or capability docs and link to the incident report.

- **Integration Points**:
  - Pibo session signals capability and live gateway status surfaces.
  - `pibo debug telemetry stale` command from PRD 04.
  - Telemetry service stale query and retention stats from PRD 02.
  - Provider Settings config for stale thresholds.
  - Incident report `docs/reports/incident-2026-05-16-stuck-toolcall-stream.md`.

- **Security & Privacy**:
  - Live hints must be metadata-only.
  - Playbooks must warn operators that payload preview commands, if present, are explicit, bounded, and should be avoided unless summaries are insufficient.
  - Validation fixtures should use fake large payloads/tool args to prove default output and storage remain bounded.
  - Destructive prune examples must show dry-run first.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - V1 vertical slice: provider-aware stale detector, minimal Provider Settings threshold config, status/signal active-phase hints, no-telemetry diagnostics, and core CLI drill-down fixture.
  - V1 complete: incident playbooks, broader safety validation fixtures, bounded-output/storage validation, and final rollout checklist.
  - v1.1: optional Chat Web compact stale indicator if existing UI status surfaces can consume the hint safely without adding telemetry drill-down UI.
  - v2.0: incident export and Chat Web telemetry drill-down panel.

- **Technical Risks**:
  - Live state and durable telemetry may disagree; mitigate by labeling source and timestamps in hints.
  - Stale thresholds may be too noisy for long model calls; mitigate with provider/profile-aware configurable thresholds and phase-specific defaults.
  - Documentation may drift from CLI behavior; mitigate with CLI examples covered by tests or reviewed with command help output.
  - Storage/output tests may miss new large-content paths; mitigate with centralized bounded-output tests and conservative default omission of content bodies.
