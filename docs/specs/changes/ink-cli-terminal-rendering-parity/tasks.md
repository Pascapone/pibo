# Tasks: Ink CLI Terminal Rendering Parity

**Status:** Draft implementation plan.

## 1. Spec and Fixture Foundation

- [x] 1.1 Mark `TERMINAL_DESIGN.md` as the canonical visual contract in the change docs.
- [x] 1.2 Add or extract a shared terminal fixture that includes user, assistant, reasoning, tool, status, thinking, model, login, yielded-run, compaction, command, and error rows.
- [x] 1.3 Add shared-model tests for row order, card descriptors, progress descriptors, labels, tones, unavailable states, and secret redaction.
- [x] 1.4 Keep static boundary tests for `src/session-ui` renderer neutrality and CLI/Web renderer separation.

## 2. Command Result Flow

- [x] 2.1 Add a shared or CLI-local normalizer from `CommandResultDescriptor` to `CompactTerminalRow[]`.
- [x] 2.2 Change `/status` to append command/status rows instead of setting `state.message` with the status payload.
- [x] 2.3 Apply the same row flow to `/thinking <level>`, `/model <provider/model>`, `/login <provider/method>`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, `/kill-all`, unsupported commands, and errors where they represent command output.
- [x] 2.4 Keep `state.message` only for picker instructions, suggestion hints, cancellations, and non-history guidance.
- [x] 2.5 Add controller tests for command-result ordering, picker closure, row append behavior, and no status payload in header message.

## 3. Ink Renderer Quality

- [x] 3.1 Refine `InkTerminalCard` to match `TERMINAL_DESIGN.md`: dense text, semantic markers, compact rows, no decorative chrome, clear unavailable states.
- [x] 3.2 Add/extend Ink card renderers for status, thinking, model, login, tool, yielded-run, compaction, command, and error descriptors.
- [x] 3.3 Add text progress bars, badge-like markers, warning/error lines, and detail sections that remain readable with `NO_COLOR=1`.
- [x] 3.4 Add narrow-terminal render tests for owner/session/model/status/error visibility.
- [x] 3.5 Add bounded-output tests for large JSON, long markdown, and long tool output.

## 4. Web Regression and Synchronization

- [x] 4.1 Add Web Compact Terminal tests or source-level checks for shared descriptor consumption across status/model/login/thinking/tool cards.
- [x] 4.2 Add stable semantic hooks where missing, without changing Web visuals.
- [x] 4.3 Use the shared fixture to verify Web and Ink agree on row/card kinds, progress ids, labels, and redaction.
- [x] 4.4 Run `npm run chat-ui:typecheck` and `npm run chat-ui:build` after renderer changes.

## 5. Visual Debugging

- [x] 5.1 Extend the PTY smoke script or add a new script for rendering-parity flows.
- [x] 5.2 Ensure PTY artifacts include raw ANSI, clean text, final screen text, event stream, metadata, and assertions.
- [x] 5.3 Investigate ANSI-to-HTML/SVG/PNG generation for artifact review.
- [x] 5.4 If visual conversion is unavailable, document the fallback and keep screen/ANSI artifacts in a report.
- [x] 5.5 Add a report under `docs/reports/` with exact PTY commands and artifact paths.

## 6. Validation Gates

- [x] 6.1 Run focused shared-model and Ink renderer tests.
- [x] 6.2 Run CLI app/controller tests.
- [x] 6.3 Run PTY visual smoke tests.
- [x] 6.4 Run `npm run typecheck`.
- [x] 6.5 Run `npm test`.
- [x] 6.6 Run `npm run chat-ui:typecheck`.
- [x] 6.7 Run `npm run chat-ui:build`.
- [x] 6.8 Install globally and manually test `pibo tui:sessions` over SSH.

## 7. Web Reference Audit and Contract Update

- [x] 7.1 Audit Web Compact Terminal reference files and record row grammar, preview, detail, JSON, markdown, status, header, and streaming laws in `web-terminal-reference-audit.md`.
- [x] 7.2 Update `TERMINAL_DESIGN.md` with preview-vs-wrapping rules, row-first/card-exception rules, detail expansion behavior, and JSON render modes.
- [x] 7.3 Update this change spec with Web-derived requirements and traceability.

## 8. Requirement: Collapsed Output Preview Parity

- [ ] 8.1 Add/restore a shared fixture with at least 12 output lines for tool calls, execution commands, yielded runs, and async agents.
- [ ] 8.2 Restore shared collapsed preview bounds: 5 output preview lines for tool/result/async/yielded/execution rows and 6 child summary lines for grouped exploration.
- [ ] 8.3 Preserve no character truncation in visible preview lines; assert wrapping/no `… truncated` separately from preview omission.
- [ ] 8.4 Add omitted-line metadata or an equivalent descriptor so renderers can show `+N more lines` and expose details.
- [ ] 8.5 Add Web and Ink tests proving collapsed previews are bounded and expanded details show full output.

## 9. Requirement: Ink Row Grammar and Spacing

- [ ] 9.1 Change Ink rendering so normal rows (`tool.call`, `tool.group.exploring`, `yielded.run`, `execution.command`, `execution.compaction`, `error`) render as terminal rows rather than `▣` card headers.
- [ ] 9.2 Keep structured renderers for Web-equivalent exceptions: `tool.status`, `tool.thinking`, `tool.login`, and `tool.model`.
- [ ] 9.3 Add spacing snapshots for adjacent user/assistant/tool/status/command rows.
- [ ] 9.4 Add a regression assertion that normal rows do not contain decorative card headers.

## 10. Requirement: Ink Row Expansion and Details

- [ ] 10.1 Add selected-row and expanded-row state to `InkSessionApp` or a small controller model.
- [ ] 10.2 Add keyboard handling for selecting expandable rows and toggling details without breaking text input/slash picker behavior.
- [ ] 10.3 Render terminal-native details below the parent row with `Input`, `Output`, `Error`, linked session controls, compacted-output disclosure, and redaction.
- [ ] 10.4 Add controller and renderer tests for expand/collapse, full output visibility, and collapsed transcript density.
- [ ] 10.5 Add a PTY flow that opens details for a long-output row.

## 11. Requirement: Ink JSON and Markdown Semantic Parity

- [ ] 11.1 Add an Ink JSON renderer for inline function-call JSON with key/string/literal/punctuation token roles and collapsed collection markers.
- [ ] 11.2 Add detail JSON well rendering for parsed object/array values and JSON-looking text output.
- [ ] 11.3 Add color and `NO_COLOR` snapshot coverage for JSON rendering.
- [ ] 11.4 Improve Ink markdown approximation for headings, lists, blockquotes, inline code, fenced code, tables, and reasoning tone.
- [ ] 11.5 Add shared JSON/markdown fixtures used by Web semantic-hook tests and Ink snapshots.

## 12. Final Web-Derived Validation

- [ ] 12.1 Run focused shared, Web, and Ink renderer tests.
- [ ] 12.2 Run `npm run typecheck` and `npm test`.
- [ ] 12.3 Run `npm run chat-ui:typecheck` and `npm run chat-ui:build` when Web fixture/hooks change.
- [ ] 12.4 Run PTY visual smoke tests for `/status`, long output preview/details, JSON function-call rendering, and spacing rhythm.
- [ ] 12.5 Update a report under `docs/reports/` with exact commands and artifact paths.
- [ ] 12.6 Run the Web UI preservation gate: if `src/session-ui/**` or Web Compact Terminal files changed, prove Web collapsed previews, status provider rendering, details, JSON, and row grammar still match Web reference behavior; direct Web UI behavior changes require explicit user approval.
