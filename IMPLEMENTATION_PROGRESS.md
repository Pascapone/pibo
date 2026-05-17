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
- Web UI preservation gate is mandatory: Web Compact Terminal is the source of truth; Ink adapts to Web. Do not change Web Compact Terminal visual/behavioral render logic unless the user explicitly approves it. Any `src/session-ui/**` change is Web-impacting and requires Web regression evidence. Direct Web Compact Terminal edits are limited to tests/semantic hooks or restoring existing Web behavior.

## Progress log

- 2026-05-17: Created Phase 2 worktree and Docker worker. Prepared PRD batch for Ralph but did not start it yet.
- 2026-05-17: Created stopped Ralph job `ralph_fcef0e46-fe5e-45d3-95d4-7a0ef31db09d` with `maxIterations=90`, room `room_d1949701-2009-4b88-9a13-7eb4a3c8f466`, and prompt `/tmp/ralph-ink-cli-terminal-web-derived-parity-prompt.txt`.
- 2026-05-17: Cleaned browser processes in Docker worker with narrow process-name cleanup and verified container build command: `docker exec pibo-dev-ink-cli-terminal-web-derived-parity bash -lc 'cd /workspace && npm run build'` passed.
- 2026-05-17: Added and merged Web UI preservation gate from `dev`, updated Phase 2 PRD JSON acceptance criteria, and edited Ralph job prompt `ralph_fcef0e46-fe5e-45d3-95d4-7a0ef31db09d` so Web UI must remain unchanged and shared/Web-impacting changes require Web regression evidence.
- 2026-05-17: Selected PRD08 US-001 through US-005 as a coherent foundation batch: create the Web-vs-Ink difference matrix, add renderer-neutral long-output/JSON/markdown/room-session/slash fixtures, wire validation ownership, and mark only fixture/docs stories when focused tests and typecheck pass. No direct Web Compact Terminal behavior changes planned.
- 2026-05-17: Completed PRD08 US-001..US-005. Added `web-terminal-difference-matrix.md`, Web-derived fixture helpers for long output, JSON/markdown/syntax, room/session naming, slash-command coverage, and matrix coverage assertions. Evidence tier: docs/source/shared-fixture unit tests; fake deterministic fixtures, not live provider/default-path PTY. Web preservation: no Web Compact Terminal visual/behavioral code changed and no production `src/session-ui/**` change; Web-impacting regression handled by full test/build gates. Validation in Docker worker: `npm run build`; `node --test test/terminal-parity-fixtures.test.mjs`; `npm run typecheck`; `npm test` all passed. No PTY artifacts required for PRD08 fixture/docs stories; PRD09+ own user-facing PTY evidence.
- 2026-05-17: Selected PRD09 US-001 and US-002 as the next coherent dependency batch: restore/verify Web collapsed preview bounds for output and exploration rows, add explicit omitted-preview metadata, preserve full detail payloads, and run shared/Web-impacting regression evidence because `src/session-ui/**` will change. Planned validation: Docker `npm run build`, focused shared fixture/terminal row tests, Web preservation source/fixture checks where available, `npm run typecheck`, and commit from host.
- 2026-05-17: Completed PRD09 US-001 and US-002. Added `CompactTerminalPreviewOmission` metadata and shared preview constants, kept five-line output previews, bounded collapsed exploration groups to six child summaries, preserved all detail payloads, and added focused tests for empty/fewer-than-limit, exactly-at-limit, over-limit, long-unbroken-token, long-output fixture rows, and grouped exploration metadata. Evidence tier: shared model/Web-impacting regression with deterministic fixtures; no live/default PTY in this batch because PRD09 US-005 owns long-output keyboard expansion PTY evidence. Web preservation: no direct Web Compact Terminal visual code changed; `src/session-ui/**` additive metadata/group bound changes were validated with Web source/fixture regression coverage. Docker validation passed: `npm run build`; `node --test test/session-ui-terminal-rows.test.mjs test/terminal-parity-fixtures.test.mjs`; `npm run typecheck`; `npm run chat-ui:typecheck`; `npm test` (744 tests). Next: PRD09 US-003/US-004 selected-row expansion and inline detail rendering, followed by PTY evidence in US-005.
