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

## Initial large-file candidates

- `src/apps/chat/web-app.ts`: server/API/session/room/Ralph/cron/web app responsibilities are mixed in one very large module.
- `src/apps/chat-ui/src/App.tsx`: likely combines routing, state orchestration, panels, session handling, and UI components.
- `src/apps/chat-ui/src/WorkflowsArea.tsx`: likely a focused feature area but still large enough for component/hook extraction.
- `src/debug/web.ts`: debug CLI/browser/render logic may be separable by command or renderer.
- `packages/workflows/src/runtime/index.ts`: runtime orchestration may need careful test-backed extraction.

## Commit policy

- Commit only passing, coherent refactor batches.
- Use concise messages such as `refactor(chat-ui): extract session navigation helpers`.
- Include tracking-file updates in the same commit when they document that batch.
