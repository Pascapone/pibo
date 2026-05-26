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

- Last batch: Extracted workflow human action application types/functions into `packages/workflows/src/runtime/human-action.ts`, preserving the public `runtime/index.ts` export surface through re-exports.
- Result: `runtime/index.ts` is down from 1,735 to 1,422 LOC; wait-token lookup, human action validation, action persistence, wait resume/cancel mutation, wakeup scheduling, and apply-result shaping now live behind a focused runtime module.
- Validation: `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace/packages/workflows && npm test -- src/testing/runtime-human-node.test.ts src/testing/workflow-persistence-validation.test.ts src/testing/workflow-store-facts.test.ts'` passed (the package test script also executed all workflow tests: 138 passing); `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace/packages/workflows && npm test'` passed (138 passing); `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace && npm run typecheck'` passed. Closest practical runtime E2E is the workflow package coverage for human wait creation, registered approve/resume/cancel application, durable wait/action/wakeup persistence, and SQLite restart recovery.
- Commit: pending.
- Blockers: none.
- Exact next step: Continue `packages/workflows/src/runtime/index.ts` with another small test-backed seam, likely extracting human node dispatch or adapter node dispatch after confirming its existing tests cover success/failure/persistence paths; avoid central dispatch orchestration until there is a focused safety test for the candidate seam.

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
- 2026-05-26: Extracted workflow schema declaration validators into `packages/workflows/src/validation/schema-declarations.ts`; focused workflow package tests and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime retry decision/scheduling helpers into `packages/workflows/src/runtime/retry.ts` plus shared runtime id generation in `packages/workflows/src/runtime/ids.ts`; focused retry tests, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime state scoping/read/patch helpers into `packages/workflows/src/runtime/state.ts`; focused code-node test command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime timestamp/wait-token expiry helpers into `packages/workflows/src/runtime/time.ts`; focused human-node runtime test command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime agent prompt-building helpers into `packages/workflows/src/runtime/prompts.ts` plus shared edge payload reader creation in `packages/workflows/src/runtime/edge-payloads.ts`; focused prompt/agent command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime persistence/event-store helpers into `packages/workflows/src/runtime/persistence.ts`; focused persistence/human-node command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow runtime node-dispatch failure helpers into `packages/workflows/src/runtime/dispatch-failures.ts`; focused failed dispatch command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted Pibo session routing agent executor/types into `packages/workflows/src/runtime/pibo-routing.ts`; focused routing/agent tests, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted one-node agent workflow runtime/types and shared agent runtime selection helpers into `packages/workflows/src/runtime/one-node-agent.ts` and `packages/workflows/src/runtime/agent-runtime.ts`; focused one-node/agent tests, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow edge transfer runtime/types into `packages/workflows/src/runtime/edge-transfer.ts`; focused edge/mixed/state/prompt/store tests, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow human action application runtime/types into `packages/workflows/src/runtime/human-action.ts`; focused human/wait persistence command, full workflow package tests, and root typecheck passed in Docker.
