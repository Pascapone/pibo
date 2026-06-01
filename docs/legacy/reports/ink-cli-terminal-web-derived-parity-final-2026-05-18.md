# Ink CLI Terminal Web-Derived Parity Final Report

**Date:** 2026-05-18  
**Branch:** `ink-cli-terminal-web-derived-parity`  
**Scope:** Phase 2 PRDs 08-13 for Web-derived `pibo tui:sessions` terminal parity.

## Summary

Phase 2 is implemented and validated. Ink now follows the Web Compact Terminal reference for bounded collapsed output, row-owned details, row-first normal events, compact status/header chrome, JSON/markdown/code rendering, slash-command behavior, picker overlays, and room/session label resolution.

No production or Web deployment was performed.

## Matrix coverage

| Area | Evidence |
|---|---|
| Difference matrix and fixtures | `web-terminal-difference-matrix.md`, `slash-command-behavior-matrix.md`, `test/terminal-parity-fixtures.test.mjs` |
| Collapsed preview/details | `/tmp/pibo-pty-long-output-us005-collapsed`, `/tmp/pibo-pty-long-output-us005-expanded` |
| Row-first grammar/status compactness | `/tmp/pibo-pty-row-first-us010`, `/tmp/pibo-pty-status-compact-us010` |
| JSON/markdown/syntax | `/tmp/pibo-pty-json-markdown-us011-color`, `/tmp/pibo-pty-json-markdown-us011-nocolor` |
| Slash/pickers/room labels | `/tmp/pibo-pty-slash-room-prd12`, `/tmp/pibo-pty-slash-room-prd12-local` |
| Final PTY scenarios | `/tmp/pibo-pty-final-web-derived/*` |
| Web semantic hooks | `test/ink-cli-terminal-rendering-parity-final.test.mjs`, `TerminalDetails.tsx` stable data hooks |

## Commands run

```bash
npm run build
node --test test/session-ui-view-models.test.mjs test/cli-session-source.test.mjs test/cli-ui-session-app.test.mjs
npm run validate:ink-web-derived -- --run
node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root /tmp/pibo-pty-final-web-derived
node scripts/ink-cli-v2-pty-smoke.mjs --scenario narrow-no-color-status --artifact-root /tmp/pibo-pty-final-web-derived
node scripts/ink-cli-v2-pty-smoke.mjs --scenario existing-session-hydration --artifact-root /tmp/pibo-pty-final-web-derived
npm run typecheck
npm run chat-ui:build
npm test
```

Visual HTML was generated with:

```bash
node scripts/render-pty-artifact-html.mjs --artifact-dir <artifact-dir>
```

## Final PTY artifacts

- `/tmp/pibo-pty-final-web-derived/owner-room-session-message` — real `dist/bin/pibo.js tui:sessions` path with mocked local router; owner → room → session → message.
- `/tmp/pibo-pty-final-web-derived/slash-suggestions-status-thinking` — slash palette, `/status`, `/download`, `/thinking` picker.
- `/tmp/pibo-pty-final-web-derived/overlay-keyboard-model-login` — model/login nested overlays, disabled rows, `/status` while picker is open.
- `/tmp/pibo-pty-final-web-derived/mixed-transcript-fixture` — row-first normal events, structured exceptions, redaction.
- `/tmp/pibo-pty-final-web-derived/narrow-no-color-status` — NO_COLOR/narrow status with ASCII progress and secret rejection.
- `/tmp/pibo-pty-final-web-derived/existing-session-hydration` — prepared existing session opened with `--session`.

Each artifact contains raw ANSI, clean text, screen text, metadata, input/assertions, event log, and `visual.html`.

## Room/session resolution evidence

- Unit/local data-store test: `local CLI session source resolves canonical room titles for commands and stale metadata` proves a renamed Web room title overrides stale session metadata in `/session-current` and `/sessions`.
- PTY local mocked path: `/tmp/pibo-pty-slash-room-prd12-local` shows `PTY Named Room` through room picker, session creation, `/status`, and `/sessions`.
- Demo path: `/tmp/pibo-pty-slash-room-prd12` shows `/room`, `/session`, `/sessions`, `/session-current`, `/status`, and `/thinking high` with named fake room/session labels.

## Web UI preservation

- No Web Compact Terminal visual behavior was changed to make Ink easier.
- The only direct Web Compact Terminal change adds stable semantic hooks to `TerminalDetails.tsx`; classes and layout remain unchanged.
- Shared `src/session-ui/**` changes are additive command matrix/session-link label metadata.
- Web gates passed: `npm run chat-ui:build`, `npm run typecheck`, and Web source semantic tests in `test/ink-cli-terminal-rendering-parity-final.test.mjs`.

## Limitations

- PTY evidence uses deterministic fake/demo and debug mocked local runtime paths, not live provider calls.
- Pixel-perfect Web screenshot diffing remains out of scope; parity is semantic, behavioral, and terminal-native.
- Production deployment was not requested and was not performed.
