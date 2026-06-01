# Ralph Auftrag: Pibo Workflow UI Authoring V2

## Worktree

You are working on Pibo Workflow UI Authoring V2.

Host worktree:

```bash
cd /root/code/pibo/.worktrees/WorkflowsV2
```

Branch: `WorkflowsV2`  
Base: `main` at `5c8f84baccae38436ded37c39330b899cf4aacda`  
PRDs: `docs/specs/changes/pibo-workflow-ui-authoring-v2/prds/prd_*.json`

Baseline PRD commit:

```text
8d53612 docs: add workflow UI authoring V2 PRDs
```

## Important Worktree / Container Split

Git works on the host worktree, not inside the container.

Use the host worktree for:

- editing source files;
- `git status`;
- `git diff`;
- `git add`;
- `git commit`.

Use the container for:

- build/typecheck/test execution when isolation is needed;
- starting the worker gateway;
- browser testing with `browser-use`.

Do not edit `/app` in the container.

## Container

Container shell:

```bash
docker exec -it pibo-dev-WorkflowsV2 bash
cd /workspace
```

Host URLs:

```text
Chat App:        http://127.0.0.1:4802/apps/chat
Gateway API:     http://127.0.0.1:4800
CDP/Browser:     http://127.0.0.1:4801
Chat UI dev:     http://127.0.0.1:4803
Context UI dev:  http://127.0.0.1:4804
```

Dev-auth login:

```bash
curl -L -c /tmp/workflowsv2-cookie.txt \
  http://127.0.0.1:4802/api/auth/sign-in/social
```

Verify session:

```bash
curl -b /tmp/workflowsv2-cookie.txt \
  http://127.0.0.1:4802/api/auth/session
```

Expected authenticated identity:

```text
dev@pibo.local
```

## Start or Restart the Container Web Gateway

The dev container does not auto-start the gateway. Start it from `/workspace`:

```bash
docker exec -d pibo-dev-WorkflowsV2 bash -lc '
cd /workspace &&
pkill -f "runWebGatewayServer" || true &&
(pgrep -x Xvfb >/dev/null || Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp &) &&
export DISPLAY=:99 &&
npm run build &&
node -e "import(\"./dist/gateway/web.js\").then(m => m.runWebGatewayServer({ devAuth: true, web: { host: \"0.0.0.0\" } }))"
'
```

Verify after restart:

```bash
curl -fsS http://127.0.0.1:4802/apps/chat >/dev/null && echo ok
```

Do not restart host gateways.  
Do not release `pibo-dev-WorkflowsV2`.

## Browser Testing

Browser testing is mandatory for UI stories.

Browser function was verified on 2026-05-11:

```text
Container: pibo-dev-WorkflowsV2
Chat URL:  http://127.0.0.1:4802/apps/chat
Auth:      dev@pibo.local
browser-use: ok
Target:    authenticated=yes, composer=yes
Screenshot inside container: /tmp/workflowsv2-browser-test.png
```

Inside the container:

```bash
docker exec -it pibo-dev-WorkflowsV2 bash
cd /workspace
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use doctor
```

Login/open Chat App:

```bash
browser-use --session ralph-v2 open \
  http://127.0.0.1:4788/api/auth/sign-in/social

browser-use --session ralph-v2 wait selector body
browser-use --session ralph-v2 state
```

Verify authenticated Chat target:

```bash
npm run --silent dev -- tools browser-use targets
```

Expected:

```text
auth: authenticated
composer: yes
title: Pibo Web Chat
```

Useful browser commands:

```bash
browser-use --session ralph-v2 eval "document.title"
browser-use --session ralph-v2 screenshot /tmp/ralph-v2-story.png
browser-use --session ralph-v2 get html --selector body
```

If browser-use fails, first run:

```bash
browser-use --session ralph-v2 close
```

then retry.

## Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

### Your Task

1. Work from the host worktree:
   `cd /root/code/pibo/.worktrees/WorkflowsV2`
2. Read the PRDs:
   `docs/specs/changes/pibo-workflow-ui-authoring-v2/prds/prd_*.json`
3. Read the V2 progress log:
   `docs/specs/changes/pibo-workflow-ui-authoring-v2/prds/progress.txt`
   - If it does not exist, create it.
4. Read the `## Codebase Patterns` section at the top of the progress log if present.
5. Pick the highest priority user story where `passes: false`.
6. Implement that single user story only.
7. Run quality checks:
   - Always run `npm run typecheck`.
   - Run relevant tests for touched areas.
   - For UI stories, run browser verification with `browser-use` inside `pibo-dev-WorkflowsV2`.
8. If checks pass, update the PRD JSON to set `passes: true` for the completed story.
9. Commit all changes from the host worktree with message:
   `feat: [Story ID] - [Story Title]`
10. Append your progress to the V2 progress log.

### Progress Report Format

Append to:

`docs/specs/changes/pibo-workflow-ui-authoring-v2/prds/progress.txt`

Never replace; always append.

```md
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- Quality checks run
- Browser verification, if UI changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

### Consolidate Patterns

If you discover a reusable pattern, add it to the `## Codebase Patterns` section at the top of the V2 progress log.

Example:

```md
## Codebase Patterns
- Use existing workflow validation helpers instead of adding a new validator.
- Browser tests must run inside `pibo-dev-WorkflowsV2` with `browser-use`.
```

Only add general reusable patterns, not story-specific notes.

## Quality Requirements

- All commits must pass quality checks.
- Do not commit broken code.
- Keep changes focused and minimal.
- Work on one story per iteration.
- Follow existing code patterns.
- Do not use Zod.
- Do not add inline TypeScript/code authoring paths in UI.
- Keep Pibo Workflow IR as the source of truth.
- XState remains visualization/projection only.

## Browser Testing Requirements

For any story that changes UI:

1. Start/restart the gateway if needed.
2. Open the Chat App with browser-use.
3. Verify the relevant UI behavior.
4. Save a screenshot if useful.
5. Record the browser verification in progress.txt.

Browser verification is not optional for UI stories.

## Stop Condition

After completing one user story, check if all stories in all V2 `prd_*.json` files have `passes: true`.

If all stories are complete and passing, reply with:

```xml
<promise>COMPLETE</promise>
```

If any story remains with `passes: false`, end normally so another iteration can pick up the next story.

## Important

- Edit code in host worktree:
  `/root/code/pibo/.worktrees/WorkflowsV2`
- Use container path `/workspace` only for running commands inside `pibo-dev-WorkflowsV2`.
- Do not edit `/app`.
- Do not restart host gateways.
- Do not release `pibo-dev-WorkflowsV2`.
- Use browser-use for UI validation.
