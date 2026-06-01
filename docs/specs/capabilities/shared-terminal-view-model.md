# Spec: Shared Terminal View Model

**Status:** Draft
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Controller / Source:** `docs/reports/ink-cli-session-subset-report.md`; current workspace source
**Related docs:** `docs/specs/capabilities/cli-session-ui.md`, `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`, `docs/specs/changes/ink-cli-session-ui/`

## Why

Pibo needs one stable translation from session trace state into compact terminal rows so the Web Chat UI and native Ink CLI show the same underlying session story without duplicating business logic.

The Web UI and CLI must not share DOM components, but they should share row data, status derivation, tokenization, truncation rules, and preview logic where possible.

## Goal

Pibo SHALL provide a renderer-neutral terminal view model that maps `PiboSessionTraceView` into compact rows usable by both React DOM Web renderers and Ink terminal renderers.

## Background / Current State

The current implementation lives in `src/session-ui/`. It exports `buildCompactTerminalRows()`, compact row and token types, and terminal value normalization from `src/session-ui/index.ts`. The older Web-only paths under `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts` and `terminalValue.ts` are compatibility re-exports to the shared module.

Chat Web imports the shared model through the compact terminal compatibility boundary and renders the rows with DOM-specific components. The Ink CLI imports `buildCompactTerminalRows()` and row types directly from `src/session-ui/index.ts` and renders the same rows through `src/apps/cli-ui/InkTerminal*` components.

## Scope

### In Scope

- Renderer-neutral types for compact terminal rows, lines, inline tokens, statuses, and details.
- A shared function that maps `PiboSessionTraceView` to compact rows.
- Shared helpers for terminal-safe value normalization and preview text.
- Contract tests using representative trace fixtures.
- Backward-compatible Web UI usage through re-export files.
- Ink CLI usage of the same row model.

### Out of Scope

- Web-specific DOM components and Tailwind styling.
- Ink-specific `Box`/`Text` components.
- Rich browser markdown rendering.
- Interactive JSON tree rendering.
- Changing trace-event semantics.

## Requirements

### Requirement: Terminal row generation is renderer-neutral

The shared terminal view model MUST avoid imports from React DOM, browser APIs, Tailwind/CSS, Virtuoso, lucide icons, and Ink.

#### Current

`src/session-ui/terminalRows.ts`, `src/session-ui/terminalValue.ts`, and `src/session-ui/index.ts` import trace and value helpers only. `test/session-ui-terminal-rows.test.mjs` scans those files for renderer imports, stylesheet imports, and browser globals.

#### Acceptance

The shared row module can be imported by both the Web build and the Node/CLI build without pulling browser-only or Ink-only dependencies.

### Requirement: Shared rows derive from canonical trace view data

The shared terminal view model MUST consume canonical Pibo trace/session structures such as `PiboSessionTraceView` and not Web component props.

#### Current

`buildCompactTerminalRows(traceView, { showThinking })` accepts a `PiboSessionTraceView | null`, flattens and sorts trace nodes with `compareTraceNodes()`, maps known trace node types into `CompactTerminalRow` records, and optionally filters reasoning rows.

#### Acceptance

A test can pass a `PiboSessionTraceView` fixture into `buildCompactTerminalRows()` and receive deterministic rows without rendering React.

### Requirement: Web compact terminal behavior is preserved

The Web compact terminal MUST use the shared row model while keeping Web-only rendering concerns in Chat UI components.

#### Current

`CompactTerminalSessionView.tsx` imports `buildCompactTerminalRows()` and row types from the shared module. Web detail, inline JSON, status, thinking, login, and model cards consume the shared row shape. The old Web terminal model files re-export from `src/session-ui/` so existing internal imports remain stable.

#### Acceptance

Existing Web typecheck/build passes. Snapshot or unit tests for row generation pass before and after extraction.

### Requirement: CLI renderer consumes the same rows

The Ink CLI transcript MUST render from the same compact row data as the Web compact terminal view.

#### Current

`src/apps/cli-ui/InkSessionApp.ts` builds rows from the opened session trace with `buildCompactTerminalRows()` and stores them in CLI app state. `InkTerminalView`, `InkTerminalRow`, `InkTerminalLine`, and `inkColors` render `CompactTerminalRow` and `CompactTerminalLine` values without a separate CLI row generator.

#### Acceptance

The CLI renderer accepts shared row fixtures and produces terminal output without calling Web row generation alternatives.

### Requirement: Details remain structured but renderer-neutral

Row details MUST expose structured data such as input, output, error, linked session ids, run ids, or event ids without requiring Web-specific detail components.

#### Current

`CompactTerminalRow` carries structured fields including `input`, `output`, `error`, `runId`, `eventId`, `linkedPiboSessionId`, `forkEntryId`, and optional `detailItems`. Web and Ink renderers decide how much of those fields to show.

#### Acceptance

Both Web and CLI detail panels can render row details from the same model while applying different presentation rules.

### Requirement: Preview and truncation rules are explicit

The view model MUST define bounded preview behavior for large values so CLI and Web do not accidentally render unbounded content.

#### Current

The shared row builder caps tool-output preview lines, truncates long preview text, marks expandable rows, and uses shared terminal value helpers for text, JSON-like values, empty values, and model content arrays. Renderers may apply additional display bounds.

#### Acceptance

Tests cover long text, JSON-like values, empty values, missing values, errors, and truncation markers.

## Edge Cases

- Empty trace view.
- Trace with only user messages.
- Trace with streaming assistant state but no final message.
- Tool call without result.
- Tool result without known call metadata.
- Delegated/child session row.
- Yielded run row with running and finished states.
- Error row with non-Error payload.
- Very large text and JSON values.

## Constraints

- **Compatibility:** Web compatibility re-exports may remain under the compact-terminal path, but business logic stays in `src/session-ui/`.
- **Dependency hygiene:** Shared model modules must remain free of renderer dependencies.
- **Bounded output:** Row generation should provide enough metadata for renderers to limit output.

## Success Criteria

- [x] SC-001: Shared terminal view-model modules exist outside a Web-only component path and are exported through `src/session-ui/index.ts`.
- [x] SC-002: Web compact terminal and Ink CLI both import the same row-generation contract.
- [x] SC-003: Unit tests cover representative row kinds and truncation behavior.
- [x] SC-004: Renderer-neutral source tests guard against browser, styling, and renderer imports.

## Assumptions and Open Questions

### Assumptions

- Compatibility re-exports under Chat Web compact-terminal paths are intentional until internal imports can be simplified safely.
- Renderer-specific bounds and styling belong in Web and Ink components, not in the shared row model.

### Open Questions

- Which exact row kinds should be treated as a semver-like public contract if external plugins start consuming `src/session-ui/` directly?

## Traceability

| Requirement | Consumer | Source Basis | Verification | Status |
|---|---|---|---|---|
| Renderer-neutral rows | Web and CLI | `src/session-ui/index.ts`, `src/session-ui/terminalRows.ts`, `src/session-ui/terminalValue.ts` | `test/session-ui-terminal-rows.test.mjs` | Source-backed |
| Canonical trace input | Trace engine/session UI | `buildCompactTerminalRows()` in `src/session-ui/terminalRows.ts` | `test/session-ui-terminal-rows.test.mjs` | Source-backed |
| Web behavior preserved | Chat Web | `src/apps/chat-ui/src/session-views/compact-terminal/*` | Source-inspected plus row-model tests | Source-backed |
| CLI renderer reuse | Ink CLI | `src/apps/cli-ui/InkSessionApp.ts`, `src/apps/cli-ui/InkTerminal*.ts`, `src/cli-session/localSessionSource.ts` | `test/cli-ui-ink-renderer.test.mjs`, `test/cli-ui-session-app.test.mjs`, `test/cli-session-source.test.mjs` | Source-backed |
| Structured details and previews | Web and CLI | `CompactTerminalRow`, `CompactTerminalDetailItem`, `terminalValue.ts` | `test/session-ui-terminal-rows.test.mjs` | Source-backed |

## Verification Basis

This spec is based on current code in `src/session-ui/index.ts`, `src/session-ui/terminalRows.ts`, `src/session-ui/terminalValue.ts`, the Chat Web compact-terminal components under `src/apps/chat-ui/src/session-views/compact-terminal/`, the Ink CLI renderer under `src/apps/cli-ui/`, and CLI session source integration in `src/cli-session/`. Current focused tests are `test/session-ui-terminal-rows.test.mjs`, `test/cli-ui-ink-renderer.test.mjs`, `test/cli-ui-session-app.test.mjs`, and `test/cli-session-source.test.mjs`.
