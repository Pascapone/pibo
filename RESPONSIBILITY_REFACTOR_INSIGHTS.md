# Code Quality Refactoring Insights

## Durable context

- The loop targets broad codebase maintainability, not only `src/apps/chat-ui/src/App.tsx` and not only responsibility splitting.
- Valid work includes implementation refactors, analysis-only target discovery, class/module boundary improvements, naming consistency, test-safety batches, duplication reduction, and small architecture cleanup.
- Large-file line count is only a heuristic. Refactor where responsibilities are separable and tests/manual checks can protect behavior.
- Avoid mechanical splitting that creates worse coupling. Each extraction should have a named responsibility and clear call sites.
- Prefer incremental, behavior-preserving moves: extract types, helpers, service modules, hooks/components, or focused API adapters before changing behavior.
- Use existing project style and naming. Do not add speculative frameworks or abstractions.
- At run start, always read the progress file, this insights file, and recent git history before choosing the next batch.

## Environment reminders

- Host worktree: `/root/code/pibo/.worktrees/refactor-responsibility-ralph`
- Container workspace: `/workspace`
- Docker worker: `pibo-dev-refactor-responsibility-ralph`
- Docker image: `pibo:latest`
- Web URL for manual checks: `http://127.0.0.1:4802/apps/chat`
- CDP port: `4801`
- Gateway port: `4800`

## Validation strategy

- Always inspect current tests near the touched code before moving code.
- For pure extraction, focused unit/type checks may be enough for the batch, but still run `npm run typecheck` before commit.
- For Chat Web UI or server behavior, run a Docker-hosted manual path and record the route, observable result, and any screenshot/log path if available.
- If full `npm test` is too expensive for every small batch, run focused tests plus typecheck, then run broader tests after several coherent commits or before handoff.
- The repo root is not configured as an npm workspace for `packages/workflows`; run focused workflow tests with `cd /workspace/packages/workflows && npm test` inside the Docker worker.

## Initial large-file candidates

- `src/apps/chat/web-app.ts`: server/API/session/room/Ralph/cron/web app responsibilities are mixed in one very large module.
- `src/apps/chat-ui/src/App.tsx`: likely combines routing, state orchestration, panels, session handling, and UI components.
- `src/apps/chat-ui/src/WorkflowsArea.tsx`: likely a focused feature area but still large enough for component/hook extraction.
- `src/debug/web.ts`: debug CLI/browser/render logic may be separable by command or renderer.
- `packages/workflows/src/runtime/index.ts`: runtime orchestration may need careful test-backed extraction.

## Workflow validation seams

- `packages/workflows/src/validation/json-schema.ts` now owns the pure JSON Schema subset/value validation seam: schema keyword/type checks, object/array/ref/anyOf validation, runtime JSON value checks, local `$defs` refs, and semantic schema equality for port compatibility.
- `packages/workflows/src/validation/registry-refs.ts` now owns workflow registry-reference validation: guard refs (including loop policy guard validation), agent profile selection/archive checks, prompt builder refs, code handler refs, adapter refs, human action refs, adapter-ref shape detection, and `WorkflowValidationOptions`.
- `packages/workflows/src/validation/state-access.ts` now owns workflow state access validation: node `state.reads`/`state.writes` declaration shape checks, scoped state path parsing, edge write rejection, unknown global state path diagnostics, and ambiguous concurrent global write detection.
- `packages/workflows/src/validation/graph-ports.ts` now owns direct workflow port compatibility and graph compatibility diagnostics for direct edges and edge-adapter outputs. It preserves the public `areWorkflowPortsDirectlyCompatible` export through `validation/index.ts`.
- `packages/workflows/src/validation/retry-policy.ts` now owns workflow/node retry policy validation: positive `maxAttempts`, backoff object/kind checks, non-negative delay/max bounds, exponential factor bounds, and `retryOn` array/string diagnostics. The existing invalid retry policy test in `packages/workflows/src/testing/validation.test.ts` covers this seam.
- `packages/workflows/src/validation/graph-cycles.ts` now owns loop/cycle graph validation: loop policy edge/maxAttempts checks, loop/edge guard ref validation, bounded loop edge collection, and unbounded cycle traversal diagnostics. Existing bounded review-loop, missing loop policy, missing guard, unknown guard, and free-cycle tests in `packages/workflows/src/testing/validation.test.ts` cover this seam.
- `packages/workflows/src/validation/graph-edges.ts` now owns structural edge graph validation: source/target node references and edge adapter transform refs/registry existence. Existing missing node, invalid adapter ref, and unknown adapter registry tests in `packages/workflows/src/testing/validation.test.ts` and registry tests cover this seam.
- `packages/workflows/src/validation/schema-declarations.ts` now owns authored schema declaration validation: workflow/node/edge-adapter ports, human node response schemas, and global state field schemas. `validateWorkflowPort` remains a public export from `validation/index.ts` via re-export, so runtime and tests keep the same import surface.
- `packages/workflows/src/validation/index.ts` is now a smaller orchestration/public validation entry point plus runtime value validation helpers and delegation to focused workflow validation modules. Further splitting this file has diminishing returns; the next higher-value workflow seam is likely `packages/workflows/src/runtime/index.ts`, but it should start with analysis or focused tests because dispatch/runtime behavior is broader and riskier than pure validation.

## Workflow runtime seams

- `packages/workflows/src/runtime/retry.ts` now owns workflow node retry policy resolution, retry/exhaustion decisions, scheduled retry attempt cloning, and retry backoff delay calculation. `runtime/index.ts` preserves the public retry helper/type exports via re-export, and the existing `runtime-retry-policy.test.ts` and state-loop integration tests cover this seam.
- `packages/workflows/src/runtime/ids.ts` owns the shared runtime id generation helper used by `runtime/index.ts` and retry scheduling. Keep this small and runtime-specific; avoid turning it into a generic utilities module.
- `packages/workflows/src/runtime/state.ts` now owns runtime state scoping/view helpers, local-state snapshots, declared state readers, code-node patch validation/application, and `WorkflowStateAccessViolation`. Existing code-node, one-node, mixed runtime, state-loop, and persistence tests cover this seam.
- `packages/workflows/src/runtime/time.ts` now owns runtime timestamp factories, wait-token expiry calculation, duration-to-milliseconds conversion, ISO-8601 duration parsing, and timestamp comparison. Existing human-node runtime tests cover minute-based expiry and wait-token persistence/resume paths; add direct tests before changing duration parsing semantics.
- `packages/workflows/src/runtime/prompts.ts` now owns agent prompt construction: prompt template rendering, registered prompt builder resolution/execution, prompt builder state/edge readers, and final recorded-prompt metadata. Existing `runtime-agent-node.test.ts`, `runtime-prompt-workflows.test.ts`, and one-node workflow tests cover prompt templates, prompt builders, transferred edge payloads, metadata recording, and routed execution.
- `packages/workflows/src/runtime/edge-payloads.ts` is a tiny shared runtime helper for edge payload readers used by code-node handlers and prompt builders. Keep it focused; do not grow it into a generic runtime utility module.
- `packages/workflows/src/runtime/persistence.ts` now owns runtime persistence/event-store helpers: event emission with optional persistence, optional store capability guards, run/node-attempt/edge-transfer writes, wait wakeup/node-attempt read guards, and workflow event record creation. Existing node-attempt persistence, workflow persistence validation, runtime human-node, edge-transfer, and one-node runtime tests cover this seam.
- `packages/workflows/src/runtime/dispatch-failures.ts` now owns runtime node-dispatch failure helpers: consistent failure result shaping for agent/code/nested/human/adapter dispatch, failed attempt/run mutation, `node.failed` event emission, and failed attempt/run persistence. Existing runtime agent, code, human, nested workflow, adapter/mixed, and one-node tests cover invalid input/output, missing registry refs, thrown handlers/executors, and failed child workflow paths.
- `packages/workflows/src/runtime/pibo-routing.ts` now owns Pibo session routing agent-executor contracts and the `createPiboSessionRoutingAgentExecutor` factory: routing session types, metadata/title resolution, project session linking, actor message emission, assistant reply/session-error correlation, and effective runtime status propagation. `runtime/index.ts` re-exports the same public names, so existing consumers should keep importing from the runtime entry point.
- `packages/workflows/src/runtime/agent-runtime.ts` now owns shared agent runtime selection helpers used by both agent dispatch and one-node workflow execution: fixed Agent Designer profile resolution, runtime selection metadata, Pibo/project session linkage, and executor error summarization. Keep this module about agent runtime selection/session metadata, not general workflow dispatch.
- `packages/workflows/src/runtime/one-node-agent.ts` now owns one-node agent workflow execution: path validation, run/attempt creation, input/global-state checks, prompt building, executor invocation, node/workflow output validation, completion/failure event persistence, and one-node result types. `runtime/index.ts` preserves public one-node exports by re-exporting from this module.
- `packages/workflows/src/runtime/edge-transfer.ts` now owns workflow edge transfer execution and types: direct transfer validation, adapter transfer execution, source/target payload checks, persisted transfer recording, run cursor updates, and `edge.transferred` event emission. `runtime/index.ts` preserves public edge transfer exports by re-exporting from this module. Existing edge-transfer, mixed-node, state-loop, prompt-workflow, and store-facts tests cover this seam.
- `packages/workflows/src/runtime/human-action.ts` now owns workflow human action application and types: wait-token lookup/status checks, action-ref resolution, registry/schema/node-output validation, human-action persistence, wait resume/cancel mutation, wakeup scheduling, node-attempt updates, and apply-result decision shaping. `runtime/index.ts` preserves public human action apply exports by re-exporting from this module. Existing human-node, workflow-persistence-validation, and workflow-store-facts tests cover this seam.
- `packages/workflows/src/runtime/human-node.ts` now owns workflow human node dispatch and types: durable wait-token creation, human node input validation, wait-state mutation, wait-created event emission, node/run persistence, and failure shaping before durable wait creation. `runtime/index.ts` preserves public human node dispatch exports by re-exporting from this module. Existing human-node, mixed-node, persistence-validation, and store facts tests cover this seam.
- `packages/workflows/src/runtime/adapter-node.ts` now owns workflow adapter node dispatch and types: adapter node input validation, registry lookup, adapter execution with a node-scoped run, node-output validation, adapter metadata persistence, completion/failure event persistence, and adapter error summaries. `runtime/index.ts` preserves public adapter node dispatch exports by re-exporting from this module. Existing mixed-node and registry tests cover success, missing adapter refs, output validation, and visible adapter registry behavior.
- `packages/workflows/src/runtime/code-node.ts` now owns workflow code node dispatch and types: code-node input validation, handler registry lookup, scoped global/local/edge readers, handler command collection/emission, code-node state patch validation/application, node-output validation, completion/failure persistence, and code-handler error summaries. `runtime/index.ts` preserves public code node dispatch exports by re-exporting from this module. Existing `runtime-code-node.test.ts` and mixed-node runtime coverage cover handler success, missing handlers, undeclared state writes, invalid output, wrong-kind dispatch, and mixed workflow execution.
- `packages/workflows/src/runtime/nested-workflow-node.ts` now owns workflow nested workflow node dispatch and types: child workflow registry resolution, parent node input and child workflow input validation, child run id generation, nested executor context creation, executor event merging, child run status/output validation, node-output validation, completion/failure persistence, child-run metadata, and nested executor error summaries. `runtime/index.ts` preserves public nested workflow exports by re-exporting from this module. Existing `runtime-nested-workflow-node.test.ts` and mixed-node runtime coverage cover registered child execution, missing child refs, incomplete/failed child runs, child output validation, and mixed workflow execution.
- `packages/workflows/src/runtime/agent-node.ts` now owns workflow agent node dispatch and types: Pibo runtime requirement checks, input/output validation, fixed profile resolution, prompt rendering/builder handoff, executor invocation, runtime metadata/session linkage, node/run persistence, and executor error summarization. `runtime/index.ts` preserves public agent dispatch exports by re-exporting from this module. Existing `runtime-agent-node.test.ts`, `runtime-prompt-workflows.test.ts`, `runtime-mixed-node-workflow.test.ts`, one-node workflow tests, and Pibo routing tests cover profile resolution, prompt building, Pibo executor invocation, output validation, metadata/session linkage, and persistence-adjacent behavior.
- `packages/workflows/src/runtime/index.ts` is now a 107 LOC public barrel for workflow runtime exports. Further runtime splitting should target focused runtime modules only when their internals become overloaded; the higher-value next workflow package target is `packages/workflows/src/store/index.ts`.

## Workflow store seams

- `packages/workflows/src/store/index.ts` remains a high-responsibility module (~2,109 LOC) combining SQLite constants/schema creation, public store interfaces, UI/published-record assertions, one large `SqliteWorkflowRunStore` class, row-to-domain mappers, JSON serialization helpers, and list-limit handling.
- Likely safe first extraction: bottom row mappers (`workflowRunFromRow`, `workflowEventFromRow`, wait/node/edge/checkpoint/wakeup/human-action mappers) plus `parseJson`/optional JSON helpers into a store-owned row mapping module, but inspect mapper usage and tests first because private row types currently live in `store/index.ts`.
- Existing workflow store/persistence tests (`workflow-store-facts`, `workflow-persistence-validation`, `workflow-run-inspection`, `workflow-sqlite-schema`, catalog/published version tests) provide broad coverage for store refactors; add focused mapper tests only if extraction changes mapper visibility or null/optional handling.

## Commit policy

- Commit only passing, coherent refactor batches.
- Use concise messages such as `refactor(chat-ui): extract session navigation helpers`.
- Include tracking-file updates in the same commit when they document that batch.
