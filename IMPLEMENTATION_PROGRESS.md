# Ink CLI Terminal Rendering Parity Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_d45b1be3-7317-4c35-86b3-5e4550336cdc`
- Profile: `pibo-agent`
- Ralph job: `ralph_2573cc4a-d1d4-4a0e-88e9-c6224222c2d4`
- Max iterations: `105` (3x 35 PRD user stories)
- Template: `prd-batch-stories` with flexible coherent story batching
- Host worktree: `/root/code/pibo/.worktrees/ink-cli-terminal-rendering-parity`
- Branch: `ralph/ink-cli-terminal-rendering-parity`
- Docker dev worker: `pibo-dev-ink-cli-terminal-rendering-parity`
- Container workspace: `/workspace`
- Web: `http://127.0.0.1:4842/apps/chat`
- Gateway port: `4840`
- CDP port: `4841`
- Chat UI dev port: `4843`
- Context Files UI dev port: `4844`

## Scope

Implement:

- `docs/specs/changes/ink-cli-terminal-rendering-parity/proposal.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/spec.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/design.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/tasks.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_*.json`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/*.md`
- `TERMINAL_DESIGN.md`

## Operating notes

- Work in the dedicated host worktree above.
- Reuse the existing Docker dev worker for runtime, tests, builds, dev gateway/browser checks, and PTY validation.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host services.
- Run container commands as `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && <command>'`.
- Git metadata is not available inside the container. Git operations and commits must be done on the host worktree path.
- Clean stale Chrome/Chromium/Playwright/Puppeteer processes inside the Docker worker at the start and end of every Ralph session, and after any browser/CDP validation.
- Batch stories fluidly: choose as many related failing stories as can be implemented, fully verified, and committed safely. There is no fixed cap of three stories.
- If a story is large or risky, do only that story or a smaller coherent slice.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.

## Progress log

- 2026-05-17: Created worktree, committed PRD Markdown/JSON batch, started Docker dev worker, prepared Ralph job prompt, and created stopped Ralph job `ralph_2573cc4a-d1d4-4a0e-88e9-c6224222c2d4`.
- 2026-05-17: Validated Docker worker access and replaced the Ralph prompt Chrome cleanup command with exact-name `pkill -x` cleanup so the cleanup command does not match and terminate its own shell.
- 2026-05-17: Confirmed target room `room_d45b1be3-7317-4c35-86b3-5e4550336cdc`, set Ralph max iterations to 105, and tightened the job prompt using outcome-first prompting guidance.
