# Tasks: Ink CLI Terminal Rendering Parity

**Status:** Draft implementation plan.

## 1. Spec and Fixture Foundation

- [x] 1.1 Mark `TERMINAL_DESIGN.md` as the canonical visual contract in the change docs.
- [x] 1.2 Add or extract a shared terminal fixture that includes user, assistant, reasoning, tool, status, thinking, model, login, yielded-run, compaction, command, and error rows.
- [x] 1.3 Add shared-model tests for row order, card descriptors, progress descriptors, labels, tones, unavailable states, and secret redaction.
- [x] 1.4 Keep static boundary tests for `src/session-ui` renderer neutrality and CLI/Web renderer separation.

## 2. Command Result Flow

- [ ] 2.1 Add a shared or CLI-local normalizer from `CommandResultDescriptor` to `CompactTerminalRow[]`.
- [ ] 2.2 Change `/status` to append command/status rows instead of setting `state.message` with the status payload.
- [ ] 2.3 Apply the same row flow to `/thinking <level>`, `/model <provider/model>`, `/login <provider/method>`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, `/kill-all`, unsupported commands, and errors where they represent command output.
- [ ] 2.4 Keep `state.message` only for picker instructions, suggestion hints, cancellations, and non-history guidance.
- [ ] 2.5 Add controller tests for command-result ordering, picker closure, row append behavior, and no status payload in header message.

## 3. Ink Renderer Quality

- [ ] 3.1 Refine `InkTerminalCard` to match `TERMINAL_DESIGN.md`: dense text, semantic markers, compact rows, no decorative chrome, clear unavailable states.
- [ ] 3.2 Add/extend Ink card renderers for status, thinking, model, login, tool, yielded-run, compaction, command, and error descriptors.
- [ ] 3.3 Add text progress bars, badge-like markers, warning/error lines, and detail sections that remain readable with `NO_COLOR=1`.
- [ ] 3.4 Add narrow-terminal render tests for owner/session/model/status/error visibility.
- [ ] 3.5 Add bounded-output tests for large JSON, long markdown, and long tool output.

## 4. Web Regression and Synchronization

- [x] 4.1 Add Web Compact Terminal tests or source-level checks for shared descriptor consumption across status/model/login/thinking/tool cards.
- [ ] 4.2 Add stable semantic hooks where missing, without changing Web visuals.
- [x] 4.3 Use the shared fixture to verify Web and Ink agree on row/card kinds, progress ids, labels, and redaction.
- [ ] 4.4 Run `npm run chat-ui:typecheck` and `npm run chat-ui:build` after renderer changes.

## 5. Visual Debugging

- [ ] 5.1 Extend the PTY smoke script or add a new script for rendering-parity flows.
- [x] 5.2 Ensure PTY artifacts include raw ANSI, clean text, final screen text, event stream, metadata, and assertions.
- [ ] 5.3 Investigate ANSI-to-HTML/SVG/PNG generation for artifact review.
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
- [ ] 6.8 Install globally and manually test `pibo tui:sessions` over SSH.
