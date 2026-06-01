# Ink CLI Terminal Rendering Parity Audit — 2026-05-17

## Scope

This report captures current `pibo tui:sessions` PTY output for PRD 01. It compares the observed terminal output to `TERMINAL_DESIGN.md` and classifies visible elements as transcript rows, overlays, chrome, or invalid detached messages.

## Artifact root

Container artifact root: `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17`

Each scenario directory contains:

- `raw.ansi.log`
- `clean.txt`
- `screen.txt`
- `metadata.json`
- `input.json`
- `assertions.json`
- `events.jsonl`

Visual conversion fallback: no ANSI-to-HTML/SVG/PNG renderer was standardized for this PRD 01 audit run. Review uses `raw.ansi.log`, `clean.txt`, and `screen.txt`; PRD 07 remains responsible for standardizing visual artifacts.

## Scenarios

| Scenario | Evidence tier | Command | Artifact directory | Result |
|---|---|---|---|---|
| Startup, owner picker, room picker, session creation, mocked message send | mocked default TUI path with debug fixtures | `node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17` (`owner-room-session-message`) | `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/owner-room-session-message` | Passed. Captures startup chrome, owner overlay, room/session overlays, created session, user message, and assistant reply. |
| Slash suggestions, `/status`, thinking picker | mocked default TUI path with debug fixtures | `node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17` (`slash-suggestions-status-thinking`) | `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/slash-suggestions-status-thinking` | Passed. Captures slash palette, command row, status card row, redacted warning, thinking picker, and filtered `/th` suggestions. |
| Existing transcript hydration | mocked prepared local data path | `node scripts/ink-cli-v2-pty-smoke.mjs --scenario existing-session-hydration --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/existing-session-hydration` | Passed. Captures hydrated user and assistant transcript rows. |
| Running/streaming row demo | demo renderer path under PTY | `node dist/bin/pibo.js debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/running-row-demo --timeout-ms 10000 --idle-timeout-ms 2000 --cols 100 --rows 20 --name running-row-demo --expect "Assistant streaming" --expect "▣ Tool" -- node --input-type=module -e 'import React from "react"; import { renderToString } from "ink"; import { InkTerminalView } from "./dist/apps/cli-ui/index.js"; const rows=[{id:"assistant-running",kind:"message.assistant",status:"running",lines:[],output:"Assistant streaming response",sourceNodeIds:["assistant-running"]},{id:"tool-running",kind:"tool.call",status:"running",lines:[{prefix:"bullet",tokens:[{text:"Calling ",tone:"cyan",weight:"semibold"}],functionCall:{name:"read",input:{path:"src/index.ts"}}}],sourceNodeIds:["tool-running"]}]; console.log(renderToString(React.createElement(InkTerminalView,{rows,maxRows:10,maxLineChars:100})));'` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/running-row-demo` | Passed. Captures running assistant/tool row markers without using a real provider. |

## Element classification

| Visible element | Classification | Notes |
|---|---|---|
| `Pibo CLI Sessions | ...` header | Chrome | Compact, but still visually strong. Long model/session values truncate, which is acceptable for now but should be reviewed in narrow PRD 04/05 work. |
| `Commands: /help /new ...` line | Chrome | Bounded and compact; can still compete with the transcript when repeated after each render. |
| Owner, room, session, thinking pickers | Overlay | Temporary keyboard overlays with `❯` selection marker. They are not transcript history. |
| Slash command suggestions | Overlay/palette | Appears near the input and filters as the operator types. It remains compact but can cover most rows in short terminals. |
| `› <input>` prompt | Composer/input | Uses terminal prompt glyph and preserves typed slash input. |
| `› Smoke existing user prompt` | Transcript row | User row uses prompt glyph. |
| Assistant reply line | Transcript row | Assistant output follows user row chronologically. |
| `✓ ▣ Command — command · done` | Transcript command row | `/status` command appears before the status result. |
| `✓ ▣ Status — status · done` and `↳` details | Transcript result row/card | Status result is chronological and card-like through terminal-native rows, not a detached message. |
| `⚠ Debug PTY status fixture redacts TOKEN=[redacted]` | Transcript status warning | Redaction visible before rendering. |
| `✓ ▣ Thinking — thinking · done` after picker selection | Transcript result row/card | Selection result appears after the picker flow. |
| Running assistant/tool demo rows | Transcript rows | Demo-only evidence for running status markers; real-provider streaming remains a later validation need. |
| Top-level `state.message` guidance such as `Created session...`, `Message sent`, and picker hints | Ephemeral guidance | Allowed by the policy when it is not command/runtime payload. |

No invalid detached command/runtime result was observed for `/status`; it rendered as a command row followed by a status row.

## Comparison to `TERMINAL_DESIGN.md`

| Design section | Observed status | Evidence | Follow-up |
|---|---|---|---|
| Transcript-first layout | Partial pass | Existing transcript and `/status` rows are chronological. Repeated header/command chrome remains prominent. | PRD 04/06 should reduce chrome dominance and keep overlays compact. |
| Row density | Partial pass | Rows are terse, use `↳` details, and avoid unbounded JSON in status. | PRD 04 should refine spacing and detail bounds for mixed transcripts. |
| Color-as-signal | Partial pass | ANSI markers and status glyphs are present in raw output; clean text remains readable. | PRD 04 should expand no-color and narrow-width assertions. |
| Monospace hierarchy | Pass within PTY | All captured output is terminal text with compact labels. | Continue checking card labels through renderer tests. |
| Prefix glyphs | Pass | Observed `›`, `❯`, `✓`, `▣`, `↳`, and `⚠`. | Later stories should ensure every required row kind has a distinct marker. |
| Detail panels / inline details | Partial pass | Status details render inline under the status row. | Long JSON/markdown and expanded details need PRD 04 coverage. |
| Status bar / header | Partial pass | Header is compact and truncates long values. | Header should stay secondary and not repeat enough to dominate scrollback. |
| Badges / rows / cards | Partial pass | Ink uses terminal-native card rows instead of DOM badges. | PRD 05 should validate unavailable states and progress bars in live paths. |
| Command output | Pass for `/status` | `/status` appears as `Command` then `Status` rows in order. | PRD 03 must apply this to all command result families. |
| Redaction | Pass for fixture path | Status warning shows `TOKEN=[redacted]`; descriptor tests also assert secret removal. | Maintain static redaction guardrails. |

## Current gaps

- The audit mostly uses mocked/debug fixtures, not real-provider streaming. This is acceptable for PRD 01 audit evidence but not sufficient for final parity.
- The running/streaming row path is a demo renderer PTY scenario, not a live session run.
- Header/command chrome repeats in each screen capture and can still feel top-heavy.
- Slash suggestions are compact but can dominate short terminals.
- ANSI visual conversion is not standardized yet; PRD 07 must add or document the final visual artifact path.

## Validation commands run

- `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && npm run build'`
- `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && node --test test/ink-cli-terminal-design-contract.test.mjs test/session-ui-view-models.test.mjs test/session-ui-terminal-rows.test.mjs test/cli-ui-ink-renderer.test.mjs'`
- `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17'` (first two scenarios passed after smoke script updates; third scenario was rerun separately after truncation-safe assertion update)
- `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && node scripts/ink-cli-v2-pty-smoke.mjs --scenario existing-session-hydration --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17'`
- `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && node dist/bin/pibo.js debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/running-row-demo --timeout-ms 10000 --idle-timeout-ms 2000 --cols 100 --rows 20 --name running-row-demo --expect "Assistant streaming" --expect "▣ Tool" -- node --input-type=module -e ...'`
