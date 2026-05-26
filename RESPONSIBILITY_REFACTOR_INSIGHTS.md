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
- `packages/workflows/src/validation/index.ts` still mixes workflow orchestration, retry/loop/cycle rules, edge node/adapter port compatibility, state access validation, and port/value entry points. A likely next extraction is state validation (`validateWorkflowNodeStateAccess`, global write conflicts, scoped state path parsing) because it is cohesive and tested through `packages/workflows/src/testing/validation.test.ts`.

## Commit policy

- Commit only passing, coherent refactor batches.
- Use concise messages such as `refactor(chat-ui): extract session navigation helpers`.
- Include tracking-file updates in the same commit when they document that batch.
