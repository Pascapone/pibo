# Ink CLI Terminal Rendering Parity Final Evidence

Date: 2026-05-17

## Summary

PRDs 01-07 are implemented for the terminal-rendering parity change. `pibo tui:sessions` now uses shared renderer-neutral rows/cards/descriptors, renders command results in transcript order, uses compact Ink-native rows/cards/overlays, preserves redaction, and has repeatable PTY evidence plus focused golden/semantic checks.

## Key changed areas

- Shared model and parity fixtures: `src/session-ui/*`, `test/fixtures/terminal-parity-fixtures.mjs`, `test/terminal-parity-fixtures.test.mjs`.
- Ink renderer and controller: `src/apps/cli-ui/*`, `test/cli-ui-ink-renderer.test.mjs`, `test/cli-ui-session-app.test.mjs`.
- Web semantic hooks: `src/apps/chat-ui/src/session-views/compact-terminal/*`.
- PTY and visual evidence: `scripts/ink-cli-v2-pty-smoke.mjs`, `scripts/render-pty-artifact-html.mjs`, `test/ink-cli-terminal-rendering-parity-final.test.mjs`.
- Evidence docs: this report and `docs/reports/ink-cli-v2-pty-smoke-scenarios.md`.

## Evidence matrix

| Scope | Evidence | Classification |
| --- | --- | --- |
| Startup owner/room/session/message | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/owner-room-session-message` | deterministic mocked default TUI path |
| Slash palette, `/status`, `/thinking` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/slash-suggestions-status-thinking` | deterministic mocked default TUI path |
| `/status` while picker open, model/login overlays | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/overlay-keyboard-model-login` | deterministic mocked default TUI path |
| Existing transcript hydration | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/existing-session-hydration` | prepared local data path |
| Mixed transcript/rich cards | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/mixed-transcript-fixture` | deterministic shared fixture/demo renderer PTY |
| Narrow + `NO_COLOR=1` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/narrow-no-color-status` | deterministic shared fixture/demo renderer PTY |
| Installed global startup/message | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-owner-room-session-message` | installed/global `pibo tui:sessions`, mocked provider data |
| Installed global slash/status/thinking | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-slash-status-thinking` | installed/global `pibo tui:sessions`, mocked provider data |
| Installed global picker-open `/status` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-picker-open-status` | installed/global `pibo tui:sessions`, mocked provider data |
| Installed global narrow + `NO_COLOR=1` | `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-narrow-no-color-status` | installed/global `pibo tui:sessions`, mocked provider data |

Every artifact directory above contains `raw.ansi.log`, `clean.txt`, `screen.txt`, `metadata.json`, `input.json`, `assertions.json`, and `events.jsonl` where the PTY backend produced events.

## Visual artifacts

Full ANSI-to-image tooling is not bundled in this worker. Instead, `scripts/render-pty-artifact-html.mjs` writes a terminal-styled `visual.html` from `screen.txt` or `clean.txt` for review without rerunning the TUI. This is a documented fallback, not a color-accurate emulator screenshot.

Generated examples:

- `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/mixed-transcript-fixture/visual.html`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/slash-suggestions-status-thinking/visual.html`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/overlay-keyboard-model-login/visual.html`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-slash-status-thinking/visual.html`

Reproduce from any artifact directory:

```bash
node scripts/render-pty-artifact-html.mjs --artifact-dir .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/mixed-transcript-fixture
```

## Success criteria mapping

| Spec criterion | Result |
| --- | --- |
| SC-001 `/status` transcript flow | Verified by controller tests and PTY `slash-suggestions-status-thinking`, `overlay-keyboard-model-login`, `installed-slash-status-thinking`, and `installed-picker-open-status`. |
| SC-002 shared fixture descriptors | Verified by `test/terminal-parity-fixtures.test.mjs`, `test/session-ui-view-models.test.mjs`, and final Web/Ink source checks. |
| SC-003 Ink rich/narrow/no-color/details/redaction | Verified by `test/cli-ui-ink-renderer.test.mjs`, final golden tests, `mixed-transcript-fixture`, and `narrow-no-color-status`. |
| SC-004 Web Compact Terminal hooks | Verified by Web source checks for row kind/status, event/run/order metadata, shared status fields/progress, and card hooks for status/thinking/model/login. Browser screenshot was not captured; source/render tests are the reference for this worker. |
| SC-005 PTY visual smoke artifacts | Verified by PRD07 artifact directories plus `visual.html` fallback generation. |
| SC-006 final gates | Final gates passed in the Docker worker: `npm run typecheck`, `npm test`, `npm run chat-ui:typecheck`, `npm run chat-ui:build`; installed/global PTY smoke passed. |

## Commands run

Focused validation:

```bash
npm run build
node --test test/ink-cli-terminal-rendering-parity-final.test.mjs test/ink-cli-v2-pty-smoke.test.mjs test/terminal-parity-fixtures.test.mjs test/cli-ui-ink-renderer.test.mjs test/cli-ui-session-app.test.mjs
node scripts/ink-cli-v2-pty-smoke.mjs --scenario mixed-transcript-fixture --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
node scripts/ink-cli-v2-pty-smoke.mjs --scenario narrow-no-color-status --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
node scripts/ink-cli-v2-pty-smoke.mjs --scenario slash-suggestions-status-thinking --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
node scripts/ink-cli-v2-pty-smoke.mjs --scenario overlay-keyboard-model-login --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
node scripts/ink-cli-v2-pty-smoke.mjs --scenario owner-room-session-message --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
node scripts/ink-cli-v2-pty-smoke.mjs --scenario existing-session-hydration --artifact-root .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17
```

Installed/global PTY smoke:

```bash
npm install -g .
pibo debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-owner-room-session-message ... -- pibo tui:sessions
pibo debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-slash-status-thinking ... -- pibo tui:sessions --owner-scope user:installed
pibo debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-picker-open-status ... -- pibo tui:sessions --owner-scope user:installed-picker
pibo debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/prd07-2026-05-17/installed-narrow-no-color-status ... -- pibo tui:sessions --owner-scope user:installed-narrow
```

Final gates:

```bash
npm run typecheck
npm test
npm run chat-ui:typecheck
npm run chat-ui:build
```

## PRD coverage

- PRD 01: design contract and audit artifacts complete.
- PRD 02: shared fixtures and renderer-neutral descriptor parity complete.
- PRD 03: slash palette anchoring and command-result transcript flow complete.
- PRD 04: Ink compact renderer, details, narrow/no-color, mixed transcript evidence complete.
- PRD 05: status/runtime card parity and PTY status evidence complete.
- PRD 06: picker overlays and keyboard-flow PTY evidence complete.
- PRD 07: final PTY runner, visual fallback, golden/semantic checks, Web regression checks, installed/global smoke, and final gates complete.

## Remaining gaps and out of scope

- The visual HTML fallback is not a color-accurate terminal emulator screenshot. It intentionally avoids adding a new converter dependency; a future task can evaluate ANSI-to-SVG/PNG tooling if needed.
- Live provider streaming was not used. Streaming/running visuals are covered by deterministic fixtures and local mocked PTY paths to avoid credentials and nondeterminism.
- Browser screenshot capture of Web Compact Terminal was not run in this worker. Web parity is proven through shared descriptors, source hooks, `chat-ui:typecheck`, and `chat-ui:build`.
- Pixel-perfect Web/Ink matching and DOM component sharing remain out of scope by design.
