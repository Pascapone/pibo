# Ink CLI Terminal Web-Derived Parity Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_d1949701-2009-4b88-9a13-7eb4a3c8f466`
- Ralph job: `ralph_fcef0e46-fe5e-45d3-95d4-7a0ef31db09d` (created stopped; start explicitly when ready)
- Profile: `pibo-agent`
- Template: `prd-batch-stories`
- Worktree: `/root/code/pibo/.worktrees/ink-cli-terminal-web-derived-parity`
- Branch: `ink-cli-terminal-web-derived-parity`
- Docker dev worker: `pibo-dev-ink-cli-terminal-web-derived-parity`
- Docker gateway port: `4850`
- Docker CDP port: `4851`
- Docker web port: `4852`
- Docker Chat UI port: `4853`
- Docker Context Files port: `4854`
- Container workspace: `/workspace`
- PRD JSON input: `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_0[8-9]_*.json` and `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_1[0-3]_*.json`
- Total Phase 2 stories: 30
- Recommended max iterations: 90

## Scope

Implement the Web-derived Ink terminal completion PRDs:

- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/08-web-terminal-difference-matrix-and-shared-fixtures.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/09-collapsed-output-details-and-row-expansion.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/10-row-first-layout-spacing-and-status-compactness.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/11-json-markdown-and-syntax-rendering-parity.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/12-slash-commands-room-session-resolution-and-pickers.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/13-e2e-visual-validation-and-regression-gates.md`

Reference docs:

- `docs/specs/changes/ink-cli-terminal-rendering-parity/web-terminal-reference-audit.md`
- `TERMINAL_DESIGN.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/spec.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/tasks.md`

## Operating notes

- Keep implementation work in the host worktree above.
- Use the Docker worker for runtime, builds, tests, PTY checks, dev gateway restarts, and browser/web verification.
- Run container commands as `docker exec pibo-dev-ink-cli-terminal-web-derived-parity bash -lc 'cd /workspace && <command>'`.
- Git operations and commits must be done on the host worktree path.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host services such as `pibo-web.service`.
- Clean Chrome/Chromium/Playwright/Puppeteer processes inside the Docker worker at the start and end of each Ralph session and after browser checks. Avoid broad `pkill node` because it can kill worker services.
- Batch multiple user stories sensibly; there is no fixed 4/5 story cap. Stop a run when a coherent batch is complete, blocked, or validation fails.
- Commit after every completed story or coherent story group.
- Every user-facing TUI story must include the closest practical `pibo tui:sessions` / `pibo debug pty run` validation against the Terminal UI, not only render snapshots.
- Web-impacting stories require Web Compact Terminal regression checks.
- Fake/demo/mocked checks are supporting evidence; real/default-path checks are required when locally feasible.

## Progress log

- 2026-05-17: Created Phase 2 worktree and Docker worker. Prepared PRD batch for Ralph but did not start it yet.
- 2026-05-17: Created stopped Ralph job `ralph_fcef0e46-fe5e-45d3-95d4-7a0ef31db09d` with `maxIterations=90`, room `room_d1949701-2009-4b88-9a13-7eb4a3c8f466`, and prompt `/tmp/ralph-ink-cli-terminal-web-derived-parity-prompt.txt`.
- 2026-05-17: Cleaned browser processes in Docker worker with narrow process-name cleanup and verified container build command: `docker exec pibo-dev-ink-cli-terminal-web-derived-parity bash -lc 'cd /workspace && npm run build'` passed.
