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

- Last batch: Completed an analysis-only App seam ranking for `src/apps/chat-ui/src/App.tsx`.
- Result: Ranked the next safe App responsibility moves. Highest-value next implementation is extracting the embedded sessions sidebar from the `App` render into a focused component; next options are Agent Designer module extraction, then trace-pane test-safety/hook extraction. Durable findings are recorded in `RESPONSIBILITY_REFACTOR_INSIGHTS.md`.
- Evidence: `App.tsx` is 9,946 LOC. Source-structure inspection in the Docker worker showed the largest spans as `App` 1,761 LOC, `SessionTracePane` 979 LOC, `AgentsView` 517 LOC, `Composer` 508 LOC, `ProjectsArea` 425 LOC, `SessionNode` 286 LOC, `RoomNode` 228 LOC, and `WebAnnotationsEntryPoints` 222 LOC; grep confirmed existing `context/`, `settings/`, `session-views/`, and `tracing/` feature directories.
- Validation: `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace && wc -l src/apps/chat-ui/src/App.tsx && python3 - <<'"'"'PY'"'"' ... PY'` passed for line-span analysis; `docker exec pibo-dev-refactor-responsibility-ralph bash -lc 'cd /workspace && grep -nE "function (SessionTracePane|AgentsView|Composer|ProjectsArea|SettingsView|SettingsSidebar|ContextSidebar)|type BootstrapMutationSnapshot|function applySignalSnapshotToBootstrap|function liveSessionStatusFromEvent|function buildNativeToolGroups" src/apps/chat-ui/src/App.tsx && find src/apps/chat-ui/src -maxdepth 2 -type d | sort'` passed for seam/directory evidence. No build/typecheck was needed because this batch changed only tracking docs.
- Commit: `d3a539c` (`docs(refactor): rank chat app seams`).
- Blockers: none.
- Exact next step: Extract a `SessionSidebar` component from the sessions branch of `App`'s route shell, keeping row components (`RoomNode`, `SessionNode`, archived lists, load-more button) unchanged first; validate with `npm run chat-ui:typecheck`, `npm run typecheck`, and a Chat Web sessions-route smoke/manual check if the worker web server is available.

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
- 2026-05-26: Extracted workflow human node dispatch runtime/types into `packages/workflows/src/runtime/human-node.ts`; focused human/mixed/persistence command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow adapter node dispatch runtime/types into `packages/workflows/src/runtime/adapter-node.ts`; focused mixed/registry command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow code node dispatch runtime/types into `packages/workflows/src/runtime/code-node.ts`; focused code-node command, full workflow package tests, and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow nested workflow node dispatch runtime/types into `packages/workflows/src/runtime/nested-workflow-node.ts`; focused nested/mixed command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-26: Extracted workflow agent node dispatch runtime/types into `packages/workflows/src/runtime/agent-node.ts`; focused agent/prompt/mixed/one-node/routing command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store row types/mappers into `packages/workflows/src/store/row-mappers.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store schema metadata and install/migration setup into `packages/workflows/src/store/schema.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store catalog record constants/guards and published-version record helpers into `packages/workflows/src/store/catalog-records.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store list-query construction and limit clamping into `packages/workflows/src/store/list-query.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store public contracts/list filters into `packages/workflows/src/store/contracts.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow store write-side SQLite value serialization into `packages/workflows/src/store/write-values.ts`; focused store/persistence/schema/inspection command (package script ran all 138 workflow tests) and root typecheck passed in Docker.
- 2026-05-27: Extracted workflow draft conflict and identity current-draft side-effect helpers into `packages/workflows/src/store/draft-writes.ts`; focused store/catalog/persistence command and root typecheck passed in Docker.
- 2026-05-27: Extracted telemetry SQLite row types and row-to-domain mappers into `src/data/telemetry-rows.ts`; focused runtime/validation telemetry tests and root typecheck passed in Docker.
- 2026-05-27: Extracted telemetry bounded-preview and safe-field helpers into `src/data/telemetry-preview.ts`; focused telemetry store/runtime/validation tests and root typecheck passed in Docker.
- 2026-05-27: Extracted telemetry retention stats and prune planning/deletion helpers into `src/data/telemetry-retention.ts`; focused telemetry store/runtime/validation tests and root typecheck passed in Docker.
- 2026-05-27: Extracted telemetry read/query helpers into `src/data/telemetry-queries.ts`; build, focused telemetry store/runtime/validation tests, and root typecheck passed in Docker.
- 2026-05-27: Extracted trace node sorting/tree helpers into `src/shared/trace-nodes.ts`; build, focused trace/debug tests, and root typecheck passed in Docker.
- 2026-05-27: Extracted trace live-patch structural sharing helpers into `src/shared/trace-patch-nodes.ts`; build, focused trace/debug tests, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Ralph Chat UI API client seam into `src/apps/chat-ui/src/api-ralph.ts` and shared request helper into `src/apps/chat-ui/src/api-http.ts`; workflow API source checklist, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Cron Chat UI API client seam into `src/apps/chat-ui/src/api-cron.ts`; workflow API source checklist, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Context Files Chat UI API client seam into `src/apps/chat-ui/src/api-context-files.ts`; context-files web tests, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Workflow Chat UI API client seam into `src/apps/chat-ui/src/api-workflows.ts`; source sanity check, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the prompt/settings Chat UI API client seam into `src/apps/chat-ui/src/api-settings.ts`; source sanity check, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Agent Designer/capability-management Chat UI API client seam into `src/apps/chat-ui/src/api-agent-designer.ts`; source sanity check, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the Web Annotation Chat UI API client seam into `src/apps/chat-ui/src/api-web-annotations.ts`; source/import sanity check, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the trace/signal Chat UI API client seam into `src/apps/chat-ui/src/api-trace-signals.ts`; source/import sanity check, build, and root typecheck passed in Docker.
- 2026-05-27: Extracted the chat file upload/download Chat UI API client seam into `src/apps/chat-ui/src/api-chat-files.ts`; source/import sanity check, build, and root typecheck passed in Docker. A route smoke check found the worker web server was not listening, so no service restart/browser check was performed for this pure extraction.
- 2026-05-27: Extracted the auth Chat UI API client seam into `src/apps/chat-ui/src/api-auth.ts`; source/import sanity check, build, and root typecheck passed in Docker. A route smoke check found the worker web server was not listening, so no service restart/browser check was performed for this pure extraction.
- 2026-05-27: Extracted the navigation/projects/rooms/sessions/message Chat UI API client seam into `src/apps/chat-ui/src/api-chat-sessions.ts`; source/import sanity check, build, and root typecheck passed in Docker. A route smoke check found the worker web server was not listening, so no service restart/browser check was performed for this pure extraction.
- 2026-05-27: Extracted Chat UI local-storage/session preference helpers into `src/apps/chat-ui/src/app-storage.ts`; source/import sanity check, build, and root typecheck passed in Docker. A route smoke check found the worker web server was not listening, so no service restart/browser check was performed for this pure extraction.
- 2026-05-27: Extracted Web Annotation browser-storage and shortcut persistence helpers into `src/apps/chat-ui/src/web-annotation-storage.ts`; source/import sanity check, build, and root typecheck passed in Docker. A route smoke check found the worker web server was not listening, so no service restart/browser check was performed for this pure extraction.
- 2026-05-27: Completed an analysis-only App seam ranking for `src/apps/chat-ui/src/App.tsx`; Docker source-structure inspection identified sessions sidebar as the best next extraction, followed by Agent Designer module extraction and trace-pane test-safety/hook work.
