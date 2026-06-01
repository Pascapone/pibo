# Spec: Ink CLI Terminal Rendering Parity

**Status:** Draft  
**Created:** 2026-05-17  
**Owner / Source:** User QA of `pibo tui:sessions` V2 after deployed owner/status fixes  
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `web-terminal-reference-audit.md`, `TERMINAL_DESIGN.md`, `docs/specs/changes/ink-cli-session-ui-v2-web-parity/spec.md`, `docs/specs/capabilities/shared-terminal-view-model.md`

## Why

The CLI/TUI is now functionally closer to Web Chat, but the rendering still feels separate. `/status` can appear as a header message instead of a chronological terminal row. Rich Web terminal cards are represented in the CLI as plain text more often than they should be.

Users need the TUI to feel like the same product surface as the Web Compact Terminal View, while still using terminal-native Ink components.

## Goal

Make `pibo tui:sessions` render session transcript, slash-command results, status, tools, and interactive command output through Compact Terminal semantics that follow `TERMINAL_DESIGN.md`, using shared headless models and renderer-specific Web/Ink components.

## Background / Current State

### Implemented

- Web and CLI share compact terminal rows through `src/session-ui/terminalRows.ts`.
- Web and CLI share several descriptors: command catalog, command results, status view model, terminal cards, owner/room/session picker descriptors.
- The CLI has Ink renderers for rows/cards and can render status/thinking/model/login/tool/error descriptors.
- PTY smoke tests produce raw ANSI, clean text, screen text, event logs, and assertions.

### Gaps

- Some slash-command results are assigned to `state.message`, which renders above the transcript and breaks chronological flow.
- `/status` should be a transcript event/result row. It must not replace or float above the current terminal stream.
- The CLI renderer does not yet consistently apply `TERMINAL_DESIGN.md` rules: transcript-first, dense rows, prefix glyphs, semantic color, compact detail panels, and minimal chrome.
- Existing PTY tests assert text presence but do not make visual review easy.
- Existing Web tests and CLI tests do not yet share enough fixtures to prevent render-logic drift.
- Web Compact Terminal components consume shared descriptors in places, but some rendering choices still live only in DOM components and are not mirrored by Ink tests.
- A Web reference audit now identifies additional render laws that were not explicit enough in the original spec: collapsed output previews show five lines, details reveal full output, normal tool/command rows are row-first rather than card-first, inline/detail JSON have distinct disclosure behavior, and spacing follows a strict dense transcript rhythm.

## Scope

### In Scope

- CLI rendering conformance to `TERMINAL_DESIGN.md` within terminal constraints.
- Shared fixtures that build the same `CompactTerminalRow[]` and `TerminalCardDescriptor[]` for Web and Ink tests.
- Chronological transcript rendering for command results, including `/status`, `/thinking`, `/model`, `/login`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, and errors.
- Ink renderer improvements for status cards, progress bars, unavailable states, badges, details, and narrow terminals.
- Web-derived collapsed preview behavior: bounded output lines by default, no per-line character truncation, and full output through terminal-native details.
- Web-derived JSON behavior: inline function-call JSON, detail JSON wells, token roles, and disclosure markers mapped to terminal-native Ink output.
- Web-derived row grammar and spacing: normal events stay row-first; card-like Ink output is reserved for the same exceptional controls as Web where possible.
- Web regression tests that assert Web Compact Terminal still consumes shared descriptors and keeps expected semantic hooks.
- PTY artifact improvements for visual debugging.

### Out of Scope

- Importing Web DOM/Tailwind/lucide components into Ink — renderer separation remains mandatory.
- Pixel-perfect Web reproduction in terminal cells — parity means semantics, ordering, density, tone, and behavior within terminal limits.
- Replacing the Web Compact Terminal UI.
- Full mouse support in the TUI.
- Redesigning owner/room/session data flows already covered by V2.

## Requirements

### Requirement: Terminal design contract is explicit

The Web Compact Terminal and Ink CLI terminal MUST treat `TERMINAL_DESIGN.md` as the canonical visual and interaction design contract.

#### Acceptance

- Tests or checklist assertions verify that both renderers preserve transcript-first flow, compact rows, prefix glyphs, semantic row kinds, and secret redaction.
- Ink renderer tests include representative output for user, assistant, reasoning, tool, status, thinking, model, login, yielded-run, compaction, command, and error rows.
- New renderer behavior that intentionally diverges from `TERMINAL_DESIGN.md` must be documented in this change or a follow-up spec.

### Requirement: Command results render in transcript order

Slash-command results MUST render as chronological terminal rows unless the command opens a picker, prompts for input, or exits the app.

#### Current

Several commands set `state.message`. That message appears above suggestions/pickers/transcript and can look like a detached status panel.

#### Target

Commands append or hydrate rows into `state.rows` using shared row/card descriptors. The result appears after the command event and before later transcript events.

#### Acceptance

- Running `/status` appends a command row and a status result row to the transcript.
- `/status` does not set a top-level `message` for the status payload.
- When a picker is open and the user types `/status`, the command executes and the result appears in the transcript after the existing rows.
- Existing transcript order is preserved.

#### Scenario: Status while room picker is open

- GIVEN startup shows a room picker
- WHEN the operator types `/status` and presses Enter
- THEN the picker closes
- AND the transcript contains a command/status result in chronological order
- AND the status payload is not rendered as a header message.

### Requirement: Shared model is the parity boundary

The system MUST share terminal semantics through renderer-neutral models, not through Web DOM components.

#### Acceptance

- `src/session-ui` modules do not import React, Ink, DOM, browser APIs, CSS, or Web component files.
- `src/apps/cli-ui` does not import Web Compact Terminal DOM components.
- Web and Ink tests use shared fixtures that assert the same row kinds, card kinds, token tones, progress descriptors, labels, and redaction behavior.

### Requirement: Ink renderer has first-class terminal cards

Ink MUST render shared terminal cards as compact terminal-native rows/panels, not as generic JSON or flattened prose.

#### Acceptance

- Status cards show owner, session, profile, model, runtime, queue/streaming, cwd, context, provider quota, thinking, fast mode, warnings, and errors when present.
- Missing context/provider data renders as `unavailable`, not `0` or blank.
- Progress bars use text cells such as `████░░ 50.0%` and remain meaningful with `NO_COLOR=1`.
- Error and warning rows preserve high-signal markers and redact secrets.
- Narrow terminal snapshots keep owner/session/error/status meaning visible.

### Requirement: Web Compact Terminal remains the reference behavior

Web behavior MUST remain compatible while exposing enough semantic hooks to validate parity.

#### Acceptance

- Web Compact Terminal tests verify that status/model/login/thinking/tool cards consume shared descriptors.
- Web rendered output includes stable semantic hooks such as `data-shared-terminal-card`, `data-shared-status-field`, or equivalent test IDs.
- Web tests cover the same shared fixture used by Ink renderer tests.
- Web typecheck/build/tests remain green.

### Requirement: Visual debugging artifacts are reviewable

PTY validation MUST produce artifacts that let an agent or reviewer inspect what the terminal actually rendered.

#### Acceptance

- Every visual PTY smoke test writes raw ANSI, clean text, final screen text, input metadata, and assertions.
- At least one rendering-parity PTY path writes an ANSI-rendered HTML/SVG/PNG-style artifact, or documents why the environment cannot produce it.
- Reports link the artifact directory and name the exact command used.
- Visual artifacts include `/status` in transcript flow, slash suggestions, room/session picker, and at least one rich card scenario.

### Requirement: Collapsed output previews follow Web disclosure rules

Ink and Web MUST distinguish between wrapping and preview disclosure. Visible lines MUST wrap without character truncation, while large tool/command outputs MUST be collapsed to the Web preview count until details are opened.

#### Current

Recent Ink work removed visible text truncation. That is correct for wrapping, but the shared preview path no longer enforces the Web five-line collapsed-output rule.

#### Target

Tool calls, tool results, async agents, yielded runs, shell commands, and execution command rows show at most five output preview lines in the collapsed transcript. Grouped exploration rows show at most six child summary lines. Full input/output/error remains available through row details.

#### Acceptance

- A fixture with 12 output lines renders exactly five preview lines when collapsed in Web and Ink.
- The same fixture exposes all 12 lines in details/expanded state.
- No visible preview line contains `… truncated` or loses characters due to a max-character budget.
- If lines are omitted, the row exposes an expansion affordance or `+N more lines` style hint.

### Requirement: Ink uses Web row grammar before card grammar

Ink MUST render normal transcript events as terminal rows first. Card-like renderers are reserved for the same structured exceptions as Web unless a terminal limitation is documented.

#### Current

Ink can convert many normal event kinds into `✓ ▣ ...` card headers. This is readable but diverges from Web's row-first grammar and creates extra spacing.

#### Target

`tool.call`, `tool.group.exploring`, `yielded.run`, `execution.command`, `execution.compaction`, and `error` render as prefix-glyph terminal rows with terse verbs, inline tokens, bounded previews, and optional details. `tool.status`, `tool.thinking`, `tool.login`, and `tool.model` may keep first-class structured renderers because Web also treats them as interactive/structured exceptions.

#### Acceptance

- Ink snapshots for normal tool/command rows use row markers (`•`, `└`, continuation, `›`) rather than decorative `▣` card headers.
- Status/thinking/login/model snapshots keep structured rendering.
- Row spacing tests verify no blank line or extra card header appears between a command row and its preview lines unless the Web fixture has a semantic divider.

### Requirement: Ink details mirror Web row expansion

Ink MUST provide a terminal-native way to inspect row details without dumping full payloads into the default transcript.

#### Current

Web has row-owned expansion with `Input`, `Output`, and `Error` sections. Ink renders some detail items inline and lacks a consistent selected-row expansion model.

#### Target

Ink tracks selected and expanded rows. A keyboard action opens details below the selected row. Details show `Input`, `Output`, `Error`, linked session controls where applicable, pretty JSON for JSON values, and full output for compacted validation payloads.

#### Acceptance

- Operator can open and close details for an expandable row from the TUI keyboard.
- Collapsed transcript stays bounded; expanded row shows full detail payload.
- Details are rendered below the parent row and not as a detached header message or dashboard.

### Requirement: JSON rendering is derived from Web semantics

Ink MUST provide terminal-native JSON rendering that preserves Web's semantic roles even though it cannot reuse DOM components.

#### Current

Web has inline expandable JSON and detail JSON wells with key/string/literal/punctuation tones. Ink mostly pretty-prints monochrome JSON text.

#### Target

Ink inline function-call JSON shows function name, parens, keys, strings, literals, punctuation, and collapsed collection markers with terminal colors where supported. Detail JSON renders in a compact well-like text block with the same semantic token roles and safe fallback without color.

#### Acceptance

- A nested JSON fixture shows collapsed nested objects/arrays in inline function-call output.
- String, number/boolean/null, key, and punctuation tokens are distinguishable in Ink snapshots or ANSI output.
- Detail JSON defaults to a bounded expansion depth but exposes a way to inspect full values.
- Secrets are redacted before JSON rendering.

### Requirement: Spacing rhythm is testable

Ink MUST encode the Web terminal spacing rhythm as tests and snapshots, not as subjective visual preference.

#### Current

Spacing regressions are found manually after each small fix.

#### Target

Renderer tests assert row-first density: one compact block per transcript row, 0-2 lines of gap for detail continuations, no repeated decorative chrome for normal rows, and header/picker/status chrome separated from transcript content.

#### Acceptance

- Snapshot tests cover adjacent user/assistant/tool/status/command rows.
- Snapshots fail if normal tool/command rows gain decorative card headers.
- PTY artifacts include a long-output flow and a JSON tool-call flow for visual review.

## Edge Cases

- No active session exists when `/status` runs.
- A picker is open when a slash command is submitted.
- Status provider/context data is missing, partial, zero, high, or stale.
- Command result contains secrets.
- Very narrow terminal widths.
- `NO_COLOR=1` or unsupported color terminal.
- Large JSON or markdown output.
- Web-only commands return unsupported descriptors.
- A command opens a new session (`/clone`) and must preserve result ordering during session switch.

## Constraints

- **Renderer separation:** Web DOM components cannot be imported into Ink.
- **Web preservation:** Web Compact Terminal visual and behavioral rendering is the source of truth. Ink/TUI work MUST NOT change Web UI behavior to match Ink. Any change to shared renderer-neutral code that Web consumes is Web-impacting and requires Web regression evidence. Direct Web UI changes are limited to tests/semantic hooks unless the user explicitly approves a Web behavior change.
- **Design:** `TERMINAL_DESIGN.md` wins over ad hoc CLI formatting unless an explicit terminal limitation applies.
- **Security:** Secrets must be redacted in shared descriptors and renderer output.
- **Performance:** Rendering must remain bounded for large traces.
- **SSH-first:** All user-visible validation must work from a real or pseudo TTY.

## Success Criteria

- [ ] SC-001: `/status` renders in the transcript flow, not as a top-level status message.
- [ ] SC-002: Shared fixture tests prove Web and Ink consume the same row/card/status descriptors.
- [ ] SC-003: Ink renderer tests cover rich cards, no-color output, narrow terminals, details, and redaction.
- [ ] SC-004: Web Compact Terminal regression tests cover the same fixture and shared semantic hooks.
- [ ] SC-005: PTY visual smoke tests produce raw/clean/screen artifacts plus a visual artifact or explicit documented fallback.
- [ ] SC-006: `npm test`, `npm run typecheck`, `npm run chat-ui:typecheck`, and `npm run chat-ui:build` pass before merge/deploy.
- [ ] SC-007: Collapsed Web and Ink fixtures show five output preview lines, wrap long lines, and expose full details.
- [ ] SC-008: Ink normal tool/command/yielded/error rows use row-first grammar instead of decorative card headers.
- [ ] SC-009: Ink JSON snapshots prove inline/detail JSON token roles and disclosure markers match Web semantics within terminal constraints.
- [ ] SC-010: PTY visual artifacts include long-output preview/expansion, JSON rendering, and spacing rhythm evidence.

## Assumptions and Open Questions

### Assumptions

- The best reuse boundary is shared data/view models plus separate Web/Ink renderers.
- ANSI-rendered SVG/HTML is sufficient for most automated visual review if PNG screenshots are unavailable.
- Some local-only command rows may be ephemeral until the runtime persists equivalent events.

### Open Questions

- Should command-result rows from CLI-only commands be persisted into the event log, or remain local UI rows?
- Which ANSI-to-image renderer should be standardized in the repo?
- Should the Web Compact Terminal expose additional test hooks for model/login/thinking cards?
- Should visual artifacts be generated by default in CI or only in explicit PTY smoke commands?

## Traceability

| Requirement | Task Group | Verification |
|---|---|---|
| Terminal design contract | 1, 3, 5 | Design checklist, renderer snapshots |
| Command results in transcript order | 2, 4 | Unit + PTY `/status` tests |
| Shared model parity boundary | 1, 3 | Static import tests, shared fixture tests |
| Ink first-class cards | 3 | Ink render snapshots, no-color/narrow tests |
| Web reference behavior | 4 | Web shared-fixture regression tests |
| Visual debugging artifacts | 5 | PTY artifacts and report |
| Collapsed output previews | 8 | Web/Ink long-output fixtures, PTY long-output flow |
| Web row grammar in Ink | 9 | Ink snapshots, spacing snapshots |
| Ink row expansion/details | 10 | Keyboard/controller tests, Ink snapshots, PTY details flow |
| JSON semantic parity | 11 | JSON fixtures, Ink snapshots, Web semantic hooks |
| Spacing rhythm | 9, 12 | Snapshot spacing gates, PTY visual artifacts |
