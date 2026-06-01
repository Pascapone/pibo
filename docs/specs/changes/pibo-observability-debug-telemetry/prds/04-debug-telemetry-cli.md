# PRD: Pibo Observability and Debug Telemetry — Debug CLI

**Status:** Draft
**Created:** 2026-05-16
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../capabilities/debug-cli.md`

## 1. Executive Summary

- **Problem Statement**: Pibo has a useful debug CLI, but it does not expose telemetry drill-down paths for runtime phases, provider requests, provider event metadata, tool-call arguments, stale work, retention stats, or preview-unavailable diagnostics.
- **Proposed Solution**: Add a `pibo debug telemetry` branch that mirrors the existing progressive discovery model: compact help, bounded summaries, drill-down by id, cursor/aggregate event listing, clear preview-disabled behavior, and stable JSON output for agents.
- **Success Criteria**:
  - SC-01: An agent can start with `pibo debug telemetry session <id>` and discover next commands without reading separate docs.
  - SC-02: All list/detail commands have bounded defaults and `--json` output.
  - SC-03: Provider event listings paginate or aggregate by sequence/cursor and omit raw payloads by default.
  - SC-04: Preview commands are optional in V1; if present, they require an explicit preview/event-summary id and byte limit, display truncation/preview metadata, and return a clear unavailable result when preview storage is disabled.
  - SC-05: Existing debug CLI commands continue to work and their output contracts are not changed.

## 2. User Experience & Functionality

- **User Personas**:
  - AI agent operating through CLI commands.
  - Human operator inspecting incidents.
  - Runtime/provider engineer debugging a specific provider request or tool call.
  - Maintainer checking telemetry store size and pruning old data.

- **User Stories**:
  - As an agent, I want `pibo debug telemetry --help` to show only immediate commands and examples so that I know how to proceed.
  - As an operator, I want `sessions` and `session` summaries so that I can find active or stale work without a large dump.
  - As a runtime engineer, I want `turn` output so that I can see ordered phases and linked provider/tool ids.
  - As a provider engineer, I want `provider` and `provider events` output so that I can see lifecycle facts and raw event type timelines.
  - As a maintainer, I want provider event details to be metadata-first so that debug output stays useful without duplicating large stored content.
  - As a maintainer, I want `stats` and `prune` commands so that I can manage telemetry retention safely.

- **Acceptance Criteria**:
  - `pibo debug telemetry --help` lists subcommands, one-line descriptions, and next examples without dumping telemetry data.
  - `sessions` supports `--active`, `--stale`, `--limit`, and `--json`; aliases are allowed only if documented in help and tests.
  - `session <pibo-session-id>` shows status, queue depth, active turn, active phase, last progress, stale age, provider request id when known, recent bounded turns, and next commands.
  - `turn <turn-id-or-event-id>` shows ordered phase timeline and linked provider/tool ids.
  - `provider <provider-request-id>` shows lifecycle summary and raw event counts.
  - `provider <id> events` lists provider event metadata or aggregates with cursor/sequence paging, optional allowlisted safe fields, and no raw payload by default.
  - `provider <id> payload <preview-or-event-summary-id>` is optional for V1; if present, it displays only bounded preview data and truncation/preview metadata, or a clear preview-unavailable message.
  - `tool <tool-call-id>` shows tool-call argument and execution summary.
  - `stale`, `stats`, and `prune` expose stale work, applied stale threshold/source, store counts/sizes, and dry-run-first pruning.
  - All commands that output rows support `--json`; JSON includes truncation/cursor/next-command metadata where relevant.

- **Ralph Work Package Derivation**:
  - `US-001`: command root and compact help.
  - `US-002`: bounded `sessions` list.
  - `US-003`: compact `session <id>` detail and next-command hints.
  - `US-004`: `turn <id>` phase timeline.
  - `US-005`: provider request summary.
  - `US-006`: provider event metadata/aggregate listing with cursor/limit.
  - `US-007`: optional preview command or preview-unavailable diagnostic, dependent on PRD 02 preview contract.
  - `US-008`: tool-call detail.
  - `US-009`: stale command, dependent on PRD 05 stale detector/settings.
  - `US-010`: stats and dry-run-first prune, dependent on PRD 02 retention service.

- **Non-Goals**:
  - Mutating session state from telemetry commands, except explicit prune operations.
  - Automatically aborting stale sessions.
  - Printing full raw provider payloads, full transcripts, duplicate normalized event payloads, or full tool arguments.
  - Replacing existing `pibo debug events`, `sessions`, `traces`, `jobs`, or `runs` branches.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Telemetry store/service from PRD 02.
  - Existing CLI command parser and debug output formatting helpers.
  - JSON output conventions used by existing debug commands.
  - Safe-field, truncation, and optional preview helpers for provider event rendering.

- **Evaluation Strategy**:
  - CLI tests for every telemetry command in text and JSON mode.
  - Golden output tests assert bounded rows, next-command suggestions, truncation/aggregation markers, and no raw payload bodies in summary commands.
  - JSON tests assert stable fields for agent drill-down: ids, status, phase, stale age, cursors, next commands, and truncation metadata.
  - Negative tests for missing telemetry tables, unknown ids, disabled/omitted payload capture, invalid cursor, and unsafe payload request.

## 4. Technical Specifications

- **Architecture Overview**:
  - Register a telemetry branch under the existing debug CLI surface.
  - Each command reads from telemetry service methods and renders a compact table/summary by default.
  - Each command with list output supports a row limit, a hard maximum, and JSON shape with explicit truncation/cursor metadata.
  - Text output includes `next:` suggestions so agents know the next narrowing command.
  - Payload commands, if included, call bounded preview methods and never read arbitrary raw store content.

- **Integration Points**:
  - `src/cli.ts` and `src/debug/*` command registration/formatting.
  - Gateway/client status helpers where live telemetry is needed.
  - Telemetry store/service from PRD 02.
  - Capability docs for `debug-cli` and new telemetry capability docs.

- **Security & Privacy**:
  - Summary/list commands must not include raw JSON payload bodies, raw headers, full transcript text, or full tool args.
  - Payload preview command, if included, must require explicit id and report whether preview capture was disabled, omitted, truncated, or unavailable.
  - `--fields` on provider events must select allowlisted safe structural fields only.
  - Prune apply must require an explicit destructive flag and should default to dry-run.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - V1 vertical slice: help, sessions, session, turn, provider summary, tool summary, stale.
  - V1 complete: provider events cursor/aggregate listing, stats, prune, stable JSON next-command metadata, and preview-unavailable diagnostics.
  - v1.1: optional bounded payload preview output if preview storage is explicitly approved later.

- **Technical Risks**:
  - CLI command tree may be too large; mitigate with compact help and examples.
  - JSON output may become unstable; mitigate with tests and versioned/explicit fields.
  - Payload preview flags may be misused; mitigate with explicit ids, small defaults, hard maximums, and truncation/preview metadata.
  - Missing telemetry for older sessions may confuse users; mitigate with clear “no telemetry available” diagnostics and suggestions to inspect existing events.
