# Ink CLI V2 PTY Smoke Scenarios

Reusable PTY smoke runner:

```bash
node scripts/ink-cli-v2-pty-smoke.mjs --list
node scripts/ink-cli-v2-pty-smoke.mjs --scenario slash-suggestions-status-thinking --artifact-root .tmp/ink-cli-v2-pty-smoke
node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-v2-pty-smoke
```

Run `npm run build` first. The script invokes `pibo debug pty run` through `node dist/bin/pibo.js`, uses bounded timeouts, deterministic environment variables, rows/columns settings, expect/reject assertions, and writes each scenario's raw ANSI log, clean text, screen text, metadata, input, assertions, and events under the selected artifact root. Artifacts may contain transcript content or secrets from local test data; review before sharing outside the worker.

## Scenarios

| Scenario | Coverage | Default artifacts |
| --- | --- | --- |
| `room-session-message` | room picker, session creation, message send, mocked assistant reply | `.tmp/ink-cli-v2-pty-smoke/room-session-message/{raw.ansi.log,clean.txt,...}` |
| `slash-suggestions-status-thinking` | slash suggestions, `/status` rich card, `/thinking` keyboard picker | `.tmp/ink-cli-v2-pty-smoke/slash-suggestions-status-thinking/{raw.ansi.log,clean.txt,...}` |
| `overlay-keyboard-model-login` | compact picker overlays, nested `/model` and `/login` keyboard flows, disabled rows, Escape/back, API-key safe instructions, and `/status` while a picker is open | `.tmp/ink-cli-v2-pty-smoke/overlay-keyboard-model-login/{raw.ansi.log,clean.txt,...}` |
| `mixed-transcript-fixture` | deterministic shared fixture with user, assistant, reasoning, tool, status, thinking, model, login, command, error, details, row ordering, and redaction | `.tmp/ink-cli-v2-pty-smoke/mixed-transcript-fixture/{raw.ansi.log,clean.txt,...}` |
| `narrow-no-color-status` | deterministic narrow `NO_COLOR=1` status card with ASCII progress fallback and reject assertions for Unicode bars/secrets | `.tmp/ink-cli-v2-pty-smoke/narrow-no-color-status/{raw.ansi.log,clean.txt,...}` |
| `existing-session-hydration` | prepared persisted session opened through `--session <id>` with transcript hydration | `.tmp/ink-cli-v2-pty-smoke/existing-session-hydration/{raw.ansi.log,clean.txt,...}` |

## Evidence rules for Ralph agents

When a story uses one of these scenarios as validation evidence, record all of the following in the PRD JSON story notes and `IMPLEMENTATION_PROGRESS.md`:

- exact `node scripts/ink-cli-v2-pty-smoke.mjs ...` command;
- scenario name and whether the path is deterministic mocked, real local source, or live-provider;
- raw artifact path and clean artifact path;
- observed clean-output result;
- any `--reject` assertions used for secret or dashboard-regression checks;
- any focused test/typecheck/build commands run before the PTY script.

## Reviewable HTML fallback

A full ANSI-to-image converter is not bundled. For review without rerunning the TUI, generate a terminal-styled HTML fallback from any artifact directory:

```bash
node scripts/render-pty-artifact-html.mjs --artifact-dir .tmp/ink-cli-v2-pty-smoke/mixed-transcript-fixture
```

The command writes `visual.html` beside `screen.txt`. It preserves the final terminal screen text on a Compact Terminal dark background and links the directory metadata. It is a documented fallback rather than a color-accurate terminal-emulator screenshot.

The scenarios use deterministic mocked provider/router behavior unless a future reviewer adds an explicit live-provider scenario with `pibo debug pty --real-provider` and a positive `--max-iterations` safety limit.
