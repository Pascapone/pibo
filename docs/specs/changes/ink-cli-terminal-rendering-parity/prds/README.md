# PRD Catalog: Ink CLI Terminal Rendering Parity

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`

This catalog converts the Ink CLI Terminal Rendering Parity change spec into implementation-grade Markdown PRDs and Ralph JSON story batches.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../web-terminal-reference-audit.md`
- `../../ink-cli-session-ui-v2-web-parity/spec.md`
- `../../../../TERMINAL_DESIGN.md`

## Product Position

`pibo tui:sessions` must become a terminal-native peer of the Web Compact Terminal View. Web and Ink must not share DOM components, but they must share render flow, row/card semantics, command-result behavior, streaming order, status content, and validation fixtures. Ink may use its own ASCII/ANSI style, but the user must recognize the same terminal product immediately.

## PRDs

| PRD | Scope | Ralph JSON |
|---|---|---|
| `01-terminal-design-contract-and-audit.md` | Current-state audit, `TERMINAL_DESIGN.md` conformance, non-negotiable rendering guardrails | `prd_01_terminal_design_contract_and_audit.json` |
| `02-shared-render-flow-and-fixtures.md` | Shared row/card fixtures, ordering, streaming metadata, Web/Ink parity contracts | `prd_02_shared_render_flow_and_fixtures.json` |
| `03-transcript-command-results-and-slash-palette.md` | Slash suggestions/palette placement, command result flow, command result row conversion | `prd_03_transcript_command_results_and_slash_palette.json` |
| `04-ink-compact-terminal-renderer.md` | High-quality Ink rows, user/assistant distinction, spacing, markers, details, narrow/no-color behavior | `prd_04_ink_compact_terminal_renderer.json` |
| `05-status-and-runtime-cards.md` | Status card parity with Web, context/provider quota bars, compact unavailable states, redaction | `prd_05_status_and_runtime_cards.json` |
| `06-pickers-overlays-and-keyboard-flows.md` | Room/session/owner/model/login/thinking pickers as terminal overlays matching Web flow semantics | `prd_06_pickers_overlays_and_keyboard_flows.json` |
| `07-visual-debugging-and-e2e-validation.md` | PTY visual artifacts, golden screen checks, Web screenshot/reference checks, final validation gates | `prd_07_visual_debugging_and_e2e_validation.json` |
| `08-web-terminal-difference-matrix-and-shared-fixtures.md` | Complete Web-vs-Ink difference matrix and fixture coverage for every discovered gap | `prd_08_web_terminal_difference_matrix_and_shared_fixtures.json` |
| `09-collapsed-output-details-and-row-expansion.md` | Web five-line output previews, full details, and Ink row expansion | `prd_09_collapsed_output_details_and_row_expansion.json` |
| `10-row-first-layout-spacing-and-status-compactness.md` | Row-first normal event grammar, spacing rhythm, compact header/status chrome | `prd_10_row_first_layout_spacing_and_status_compactness.json` |
| `11-json-markdown-and-syntax-rendering-parity.md` | Inline/detail JSON, markdown structure, bash/code token rendering | `prd_11_json_markdown_and_syntax_rendering_parity.json` |
| `12-slash-commands-room-session-resolution-and-pickers.md` | All slash-command behavior, picker flows, room/session name resolution | `prd_12_slash_commands_room_session_resolution_and_pickers.json` |
| `13-e2e-visual-validation-and-regression-gates.md` | Final Web-derived validation suite, PTY evidence, Web checks, acceptance report | `prd_13_e2e_visual_validation_and_regression_gates.json` |

## Ralph Batch Summary

### Phase 1 — completed baseline parity

- JSON files: 7
- User stories: 35 total
- Ralph input glob: `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_0[1-7]_*.json`

### Phase 2 — Web-derived completion

- JSON files: 6
- User stories: 30 total
- Ralph input glob: `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_0[8-9]_*.json docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_1[0-3]_*.json`
- Recommended `maxIterations`: 90 (`3 × 30 stories`)

### Full catalog

- JSON files: 13
- User stories: 65 total
- Full Ralph input glob: `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_*.json`
- Recommended branch prefix: `ralph/ink-cli-*`

## Mandatory Ralph Validation Rules

Before implementing PRDs 02-13, apply the reusable gate in `../terminal-design-contract.md#visual-evidence-checklist`. Record the story id, design rules checked, exact PTY command, artifact directory, evidence tier, observed screen result, limitations, Web impact, redaction check, and gate commands.

For Phase 2, PRD 08 is the ordering anchor: update the difference matrix first, then implement preview/details, row grammar/spacing, JSON/markdown, slash/room resolution, and final validation.

Final PRD 07 evidence is summarized in `../../../../reports/ink-cli-terminal-rendering-parity-final-2026-05-17.md`. Reusable PTY scenarios are documented in `../../../../reports/ink-cli-v2-pty-smoke-scenarios.md`; generate review HTML with `node scripts/render-pty-artifact-html.mjs --artifact-dir <artifact-dir>`.

- Every TUI story that changes user-visible rendering must include a `pibo debug pty ...` validation scenario when feasible.
- Fake/demo/mocked tests may support a story, but default-path behavior must be validated with a real installed `pibo tui:sessions` path before final completion.
- Web-impacting stories must include Web Compact Terminal regression checks.
- Web UI preservation is mandatory: Ralph must not change Web Compact Terminal visual/behavioral render logic to satisfy Ink parity. Ink adapts to Web. Shared `src/session-ui/**` changes are Web-impacting and require Web regression evidence; direct Web changes are limited to tests/semantic hooks unless explicitly approved by the user.
- Shared-model stories must include tests that prove Web and Ink consume the same row/card descriptors.
- Every story must include `Typecheck passes`.
- Renderer stories must include focused snapshot/semantic render tests and no-color/narrow-width coverage where relevant.
- Final evidence must record artifact paths: raw ANSI, clean text, final screen, metadata, assertions, and visual HTML/SVG/PNG artifact or documented fallback.
