# PRD 02: Shared Render Flow and Parity Fixtures

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `01-terminal-design-contract-and-audit.md`

## 1. Executive Summary

### Problem Statement

Web and Ink share some terminal models, but the tests do not yet prove that they share the same render flow for trace rows, command results, streaming updates, row ordering, status cards, and details. This lets visual and behavioral drift persist even when unit tests pass.

### Proposed Solution

Create canonical shared fixtures and parity tests that both Web and Ink must consume. The fixtures must represent real Compact Terminal behavior: user/assistant messages, reasoning, tool calls/results, status, thinking, model, login, yielded runs, compaction, errors, command results, details, and streaming updates.

### Success Criteria

- SC-01: Shared fixtures cover all Compact Terminal row/card kinds relevant to Web and TUI.
- SC-02: Web and Ink tests assert the same row order, row kinds, card descriptors, token tones, progress IDs, and redaction results.
- SC-03: Streaming/running updates preserve identical chronological order and metadata across both systems.
- SC-04: Tests fail if either renderer bypasses shared row/card descriptors for supported terminal elements.

## 2. User Experience & Functionality

### User Personas

- **CLI user:** Wants terminal traces to appear in the same order and meaning as Web.
- **Web user:** Expects the TUI to preserve context when switching surfaces.
- **Developer/Ralph agent:** Needs deterministic fixtures for implementation and regression tests.

### User Stories

- As a user, I want the same trace elements in the same order in Web and TUI so I can switch surfaces without relearning the flow.
- As a developer, I want shared fixtures so render changes are verified across Web and Ink at the same time.
- As a reviewer, I want tests that prove shared render logic, not just duplicated text assertions.

### Acceptance Criteria

- Add canonical fixture helpers for:
  - user message
  - assistant message
  - running assistant/streaming partial
  - reasoning/thinking
  - tool call
  - tool result
  - exploring/tool group
  - yielded run
  - compaction
  - execution command
  - status command/result
  - thinking/model/login menu rows
  - error row
  - expandable details
- Fixtures include realistic order metadata: `orderSource`, `orderStreamId`, `orderStreamFrameIndex`, event id, and run id where applicable.
- Shared tests assert exact row kind/status sequence for normal and streaming traces.
- Shared tests assert `buildTerminalCardDescriptor` output for all supported rich card rows.
- Shared tests assert token tones and prefix glyph semantics for important rows.
- Shared tests assert secret redaction happens before renderer-specific output.
- Web tests and Ink tests import or derive from the same fixture source.
- Web Compact Terminal retains stable semantic hooks for row kind, status, trace node id, event id, run id, and order metadata.
- Ink output from the same fixture contains equivalent labels, markers, row order, and status meanings.

## 3. Render Flow Requirements

### Required Shared Flow

The shared render flow MUST be:

```text
Trace/runtime/command data
  -> shared fixture or trace view
  -> buildCompactTerminalRows
  -> buildTerminalCardDescriptor / shared descriptors where applicable
  -> Web renderer or Ink renderer
```

Command results that do not originate from persisted trace events MAY use a local conversion step, but that step MUST produce `CompactTerminalRow` and `TerminalCardDescriptor` compatible rows.

### Streaming Requirements

- Running assistant rows remain in order with prior user/tool rows.
- Running tool calls use running markers and cyan/action tone.
- Status or command result rows appended during streaming appear after the current transcript tail.
- Web sticky-follow behavior and Ink tail-window behavior are both tested.
- Streaming metadata is preserved as renderer-visible semantic hooks.

### Details Requirements

- Expandable rows expose detail input/output/error data in shared row fields.
- Web detail panels and Ink detail panels use the same detail items and labels.
- Collapsed previews must preserve error/status meaning.

## 4. Technical Notes

- Prefer adding fixture helpers under `test/fixtures/` or `test/helpers/` if project style allows.
- Avoid brittle color-code assertions. Assert shared tones and stable rendered markers.
- Keep `src/session-ui` renderer-neutral.
- Keep Web DOM components and Ink components separate.

## 5. Validation Requirements

- Focused shared-model tests pass.
- Web Compact Terminal regression/source tests pass.
- Ink renderer snapshot/semantic tests pass.
- Streaming fixture tests pass.
- Typecheck passes.
- Full `npm test` passes before completion.

## 6. Risks & Non-Goals

### Risks

- Fixtures may become too synthetic. Include at least one fixture derived from real event-log shape where feasible.
- Overly exact snapshots may be brittle. Favor semantic assertions plus selected golden screens.

### Non-Goals

- Pixel-identical Web/Ink rendering.
- Browser screenshot automation; that belongs to the visual debugging PRD.
