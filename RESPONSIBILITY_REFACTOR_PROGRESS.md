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

- Last batch: Extracted Chat UI App signal-status/bootstrap patch helpers into `src/apps/chat-ui/src/app-signal-status.ts` with focused tests.
- Result: `App.tsx` no longer owns signal snapshot-to-bootstrap status reconciliation, signal patch application, legacy signal-status mapping, timestamp selection, or signal snapshot node/session map merging.
- Evidence: `App.tsx` dropped from 1,932 LOC to 1,837 LOC; the new `app-signal-status.ts` is 97 LOC.
- Validation: host `git diff --check` passed; Docker focused `node --test test/chat-ui-app-signal-status.test.mjs` passed; Docker `npm run chat-ui:typecheck` passed; Docker root `npm run typecheck` passed. Docker route smoke `curl http://127.0.0.1:4802/apps/chat` returned connection failure/HTTP 000 because port 4802 was not listening; no service restart was performed.
- Commit: `ab697db` (`refactor(chat-ui): extract app signal status helpers`).
- Blockers: worker Chat Web server on port 4802 is still not listening for route smoke checks; not blocking this behavior-preserving pure helper extraction because focused tests and typechecks passed.
- Exact next step: Continue reducing `App.tsx` with another low-risk pure seam, preferably the navigation/bootstrap merge helpers near the top of `App.tsx` (`mergeNavigationIntoBootstrap`, unread-count preservation, room unread merge, and `appendSessionRoots`) with focused tests before moving more route/effect logic.

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
- 2026-05-27: Extracted `SessionSidebar` from the sessions-route branch of `App` while keeping row components unchanged; Docker `npm run chat-ui:typecheck` and `npm run typecheck` passed, and a worker route smoke found port 4802 returning connection reset/HTTP 000 without restarting services.
- 2026-05-27: Extracted pure SessionSidebar room/session presentation helpers into `src/apps/chat-ui/src/session-sidebar-helpers.ts`; Docker source/import sanity check, `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection refused without restarting services.
- 2026-05-27: Extracted Chat UI session navigation components into `src/apps/chat-ui/src/session-sidebar.tsx` and `src/apps/chat-ui/src/session-node.tsx`, with shared clipboard fallback in `src/apps/chat-ui/src/clipboard.ts`; Docker source/import sanity check, `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection refused without restarting services.
- 2026-05-27: Extracted pure Agent Designer model/catalog helpers into `src/apps/chat-ui/src/agents/agent-designer-model.ts`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection reset without restarting services.
- 2026-05-27: Extracted shared Agent Designer UI chrome into `src/apps/chat-ui/src/agents/designer-ui.tsx`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection reset without restarting services.
- 2026-05-27: Moved the Agent Designer route subtree into `src/apps/chat-ui/src/agents/AgentsView.tsx`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection refused without restarting services.
- 2026-05-27: Extracted the Chat UI settings route/sidebar and settings subpanels into `src/apps/chat-ui/src/settings/SettingsView.tsx`, `src/apps/chat-ui/src/settings/SettingsSidebar.tsx`, and `src/apps/chat-ui/src/settings/types.ts`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke found port 4802 connection refused without restarting services.
- 2026-05-27: Extracted the Projects route sidebar and project-workflow presentation helpers into `src/apps/chat-ui/src/projects/ProjectsSidebar.tsx` and `src/apps/chat-ui/src/projects/project-session-workflow.tsx`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned HTTP 000 without restarting services.
- 2026-05-27: Extracted the Project workflow create/start panels and diagnostics helpers into `src/apps/chat-ui/src/projects/ProjectWorkflowPanels.tsx`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted pure Projects route orchestration helpers into `src/apps/chat-ui/src/projects/ProjectsAreaModel.ts`; Docker source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI live stream event/cursor helpers into `src/apps/chat-ui/src/tracing/chat-stream-events.ts`; source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI raw-event compaction into `src/apps/chat-ui/src/tracing/raw-events.ts` and added `test/chat-ui-raw-events.test.mjs`; source/import sanity check, `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI optimistic user-message reconciliation/fork-entry annotation into `src/apps/chat-ui/src/tracing/optimistic-user-messages.ts` and added `test/chat-ui-optimistic-user-messages.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI live-overlay trimming/confirmation-key helpers into `src/apps/chat-ui/src/tracing/live-overlay.ts` and added `test/chat-ui-live-overlay.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI current trace-view composition into `src/apps/chat-ui/src/tracing/current-trace-view.ts` and added `test/chat-ui-current-trace-view.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` live stream lifecycle and pending overlay event ingestion into `src/apps/chat-ui/src/tracing/use-session-trace-live-stream.ts`; `git diff --check`, Docker source sanity, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` upload attachment selection state into `src/apps/chat-ui/src/chat-upload-attachments.ts` and added `test/chat-ui-upload-attachments.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` web-annotation selection/query/panel state into `src/apps/chat-ui/src/use-session-web-annotations.ts`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted remaining web-annotation entry/list presentation into `src/apps/chat-ui/src/web-annotations.tsx`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` header/session-view controls into `src/apps/chat-ui/src/session-trace-header.tsx`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` composer send planning/optimistic overlay helpers into `src/apps/chat-ui/src/composer-send.ts` and added `test/chat-ui-composer-send.test.mjs`; `git diff --check`, Docker focused test, source/import sanity, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` composer UI, browser paste/upload handling, composer history navigation, autosizing, suggestion state, and attachment chips into `src/apps/chat-ui/src/composer/Composer.tsx`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` raw-events sidebar/load-more rendering into `src/apps/chat-ui/src/tracing/RawEventsSidebar.tsx`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` trace-history load-more strip into `src/apps/chat-ui/src/tracing/TraceHistoryLoadMore.tsx`; source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` session-view prop assembly and session-view link/model badge helpers into `src/apps/chat-ui/src/session-trace-view-props.ts`; source/import sanity, focused chat-ui trace tests, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Added focused test-safety coverage for `session-trace-view-props.ts` link labels, derivation links, model badge fallback precedence, missing-model output, and prop callback assembly; focused Docker test, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed.
- 2026-05-27: Extracted Chat UI App bootstrap mutation helpers into `src/apps/chat-ui/src/app-bootstrap-mutations.ts` and added `test/chat-ui-app-bootstrap-mutations.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted shared Chat UI App session model helpers into `src/apps/chat-ui/src/app-session-model.ts` and added `test/chat-ui-app-session-model.test.mjs`; focused helper/session trace prop tests, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` older trace-page merge rules into `src/apps/chat-ui/src/tracing/trace-page-merge.ts` and added `test/chat-ui-trace-page-merge.test.mjs`; `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` trace summary/page query state into `src/apps/chat-ui/src/tracing/use-session-trace-page.ts` and shared trace debug output sizing through `src/apps/chat-ui/src/tracing/trace-output.ts`; `git diff --check`, Docker focused trace-page merge test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` current trace composition/debug/snapshot hook into `src/apps/chat-ui/src/tracing/use-current-session-trace.ts`; `git diff --check`, Docker source/import sanity, focused current-trace and trace-page tests, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted `SessionTracePane` shell/layout JSX into `src/apps/chat-ui/src/session-trace-layout.tsx`; `git diff --check`, Docker source/import sanity, focused current-trace/trace-page/session-view-props/composer-send tests, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Moved `SessionTracePane` orchestration into `src/apps/chat-ui/src/session-trace-pane.tsx` with shared `chat-commands.ts` and `error-message.ts`; `git diff --check`, Docker source/import sanity, focused current-trace/trace-page/session-view-props/composer-send tests, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Moved the Projects route component into `src/apps/chat-ui/src/projects/ProjectsArea.tsx`; Docker source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted the Context sidebar presentation into `src/apps/chat-ui/src/context/ContextSidebar.tsx` and moved `ContextPanel` into `src/apps/chat-ui/src/context/types.ts`; Docker source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted App-owned room/session destructive confirmation modals into `src/apps/chat-ui/src/delete-confirmation-modals.tsx`; Docker source/import sanity, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted App shell/chrome presentation into `src/apps/chat-ui/src/app-chrome.tsx` and removed the orphaned local modal helper from `App.tsx`; Docker source/import sanity check, `git diff --check`, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
- 2026-05-27: Extracted Chat UI App signal-status/bootstrap patch helpers into `src/apps/chat-ui/src/app-signal-status.ts` and added `test/chat-ui-app-signal-status.test.mjs`; host `git diff --check`, Docker focused test, Docker `npm run chat-ui:typecheck`, and root `npm run typecheck` passed. Worker route smoke returned curl connection failure/HTTP 000 without restarting services.
