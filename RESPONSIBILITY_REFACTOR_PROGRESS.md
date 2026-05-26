# Code Quality Refactoring Ralph Progress

## Ralph job setup

- Created: 2026-05-26
- Owner scope: `user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB`
- Target room: `room_f3d80d96-327b-4b2e-b9cf-090d1329bad1`
- Ralph job: `ralph_08b432d8-b80f-49b2-bd25-da1c84cfc16e` (created stopped; start explicitly when ready)
- Profile: `pibo-agent`
- Template: custom code-quality refactoring loop
- Worktree: `/root/code/pibo/.worktrees/refactor-responsibility-ralph`
- Branch: `refactor-responsibility-ralph`
- Docker image: `pibo:latest`
- Docker dev worker: `pibo-dev-refactor-responsibility-ralph`
- Container workspace: `/workspace`
- Docker gateway port: `4800`
- Docker CDP port: `4801`
- Docker web port: `4802`
- Docker Chat UI port: `4803`
- Docker context-files UI port: `4804`
- Progress file: `/root/code/pibo/.worktrees/refactor-responsibility-ralph/RESPONSIBILITY_REFACTOR_PROGRESS.md`
- Insight file: `/root/code/pibo/.worktrees/refactor-responsibility-ralph/RESPONSIBILITY_REFACTOR_INSIGHTS.md`

## Scope

Improve maintainability through safe, reviewable code-quality work. Focus mainly on overloaded files and unclear responsibility boundaries, but also address adjacent issues when they are higher-value: module/class boundaries, naming consistency, duplicated logic, brittle architecture, missing tests around risky seams, and analysis that identifies the next best refactor.

Initial high-priority candidates from line-count scan:

- `src/apps/chat/web-app.ts` (~11,096 LOC)
- `src/apps/chat-ui/src/App.tsx` (~10,189 LOC)
- `src/apps/chat-ui/src/WorkflowsArea.tsx` (~4,513 LOC)
- `src/debug/web.ts` (~4,456 LOC)
- `packages/workflows/src/runtime/index.ts` (~3,909 LOC)
- `packages/workflows/src/store/index.ts` (~2,109 LOC)
- `packages/workflows/src/validation/index.ts` (~1,909 LOC)
- `src/shared/trace-engine.ts` (~1,797 LOC)
- `src/apps/chat-ui/src/api.ts` (~1,667 LOC)
- `src/data/telemetry.ts` (~1,576 LOC)

## Acceptance criteria

- Refactor or analyze only when it improves maintainability or identifies a concrete safer next step.
- Prefer files below 1,000 LOC; for very large legacy files, make steady, behavior-preserving reductions without risky big-bang rewrites.
- Valid batches include implementation refactors, naming/convention cleanup, test-safety batches, and analysis-only batches with useful committed findings.
- Preserve behavior and public APIs unless a change is necessary and covered by tests.
- All relevant tests continue to pass.
- Run `npm run typecheck` for completed refactoring batches.
- Run focused tests for touched areas.
- For user-facing Web/CLI/runtime changes, perform a manual end-to-end check in the Docker dev worker and record evidence.
- Commit each successful coherent batch from the host worktree.

## Operating notes

- Work only in the dedicated host worktree: `/root/code/pibo/.worktrees/refactor-responsibility-ralph`.
- Use the Docker dev worker for runtime, tests, builds, gateway restarts, and browser checks.
- Run container commands as: `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace && <command>'`.
- Git operations and commits must be done on the host worktree path.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host services such as `pibo-web.service`.
- Do not deploy to dev or production.
- Keep `RESPONSIBILITY_REFACTOR_PROGRESS.md` short, current, and precise.
- Keep durable learnings, architecture observations, validation notes, and gotchas in `RESPONSIBILITY_REFACTOR_INSIGHTS.md`.

## Current state

- Last batch: Extracted workflow edge structural validation from `packages/workflows/src/validation/index.ts` into `packages/workflows/src/validation/graph-edges.ts`.
- Result: `validation/index.ts` is down from 379 to 318 LOC and now delegates edge source/target node reference checks plus edge adapter transform ref validation to `graph-edges.ts`.
- Validation: `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace/packages/workflows && npm test'` passed; `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace && npm run typecheck'` passed.
- Commit: pending (`refactor(workflows): extract graph edge validators`).
- Blockers: none.
- Exact next step: Consider extracting the remaining node schema validation from `packages/workflows/src/validation/index.ts` into a focused node-schema module, or pause workflow validation splitting and move to the next higher-value large-file seam if review prefers fewer validation modules.

## Progress log

- 2026-05-26: Prepared dedicated upstream/dev-based worktree, Docker dev worker, Ralph room, tracking files, and stopped Ralph job `ralph_08b432d8-b80f-49b2-bd25-da1c84cfc16e` with only `max-iterations=200` as stop condition.
- 2026-05-26: Tightened Ralph prompt to broaden scope from responsibility-only refactoring to code-quality refactoring/analysis, require reading progress/insights and git history at run start, and allow analysis, naming, boundary, test-safety, and architecture-cleanup batches.
- 2026-05-26: Extracted pure workflow JSON Schema validation/equality helpers into `packages/workflows/src/validation/json-schema.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow registry-reference validators into `packages/workflows/src/validation/registry-refs.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow state access/write-conflict validators into `packages/workflows/src/validation/state-access.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow graph port compatibility validators into `packages/workflows/src/validation/graph-ports.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow retry/backoff policy validators into `packages/workflows/src/validation/retry-policy.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow loop/cycle validators into `packages/workflows/src/validation/graph-cycles.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow edge structural validators into `packages/workflows/src/validation/graph-edges.ts`; focused workflow package tests and root typecheck passed in Docker.
