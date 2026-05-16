---
name: ralph-loop
description: Plan, create, run, monitor, and review Ralph implementation loops with reusable Docker workers, git worktrees, PRD batches, stop policies, maxIterations, progress files, commits, and safe agent instructions. Use whenever the user wants to start a Ralph job, run an implementation loop, prepare autonomous PRD execution, monitor Ralph, debug Ralph job behavior, or capture the standard Ralph loop workflow.
---

# Ralph Loop Workflow

Use this skill to create and operate a Ralph implementation loop safely. Ralph runs repeated Pibo agent sessions against an objective, usually from PRD stories. The core pattern is:

1. Prepare a clean git worktree.
2. Reuse a dedicated Docker dev worker for runtime, builds, tests, gateway, and browser checks.
3. Create a Ralph job from a built-in template.
4. Give Ralph explicit operating instructions.
5. Start only after inspection.
6. Monitor with Ralph, debug session, events, trace, and git status.
7. Require progress updates and commits after completed stories or coherent story groups.

For CLI details, first discover the current implementation:

```bash
pibo tools guide ralph ralph
pibo ralph templates --json
pibo ralph conditions
```

Do not duplicate the whole CLI guide in answers. Use it as the live source of truth.

## When to Use Which Skill

- Use `ralph-loop` for job setup, Docker/worktree strategy, monitoring, stop conditions, and loop operations.
- Use `ralph-prd-json` to convert Markdown PRDs/specs into Ralph `prd.json` story files.
- Use `pibo-docker-system` when a Docker worker must be created, inspected, authenticated, or debugged.
- Use `github-server-flow` when pushing branches or opening upstream PRs.

## Default Safety Rules

Apply these unless the user says otherwise:

- Reuse an existing Docker dev worker. Do not create or release workers without explicit approval.
- Keep source edits and git commits in the host worktree.
- Use the Docker worker only for runtime, builds, tests, dev gateway restarts, and browser/web verification.
- Do not restart or modify host services such as `pibo-web.service` from the Ralph job.
- Do not expose tokens or credentials in prompts, logs, commits, or reports.
- Keep a progress file at the repo root, usually `IMPLEMENTATION_PROGRESS.md`.
- Commit after each completed story or coherent story group.
- Prefer starting the job stopped, inspect it, then start it.
- Stop normally with `pibo ralph stop`; use `cancel` only when stuck or unsafe.

## Standard Topology

Use a dedicated branch and worktree per Ralph loop:

```bash
cd /root/code/pibo
git fetch upstream main
git switch main
git merge --ff-only upstream/main

git worktree add .worktrees/<loop-name> -b <branch-name>
cd .worktrees/<loop-name>
```

Typical names:

- Worktree: `/root/code/pibo/.worktrees/<feature-or-loop-name>`
- Branch: `<feature-or-loop-name>`
- Docker worker: `pibo-dev-<feature-or-loop-name>`
- Progress file: `<worktree>/IMPLEMENTATION_PROGRESS.md`

If a Docker worker already exists, reuse it. A typical container command is:

```bash
docker exec <worker-name> bash -lc 'cd /workspace && <command>'
```

The container usually sees the worktree at `/workspace`. Git metadata may not work inside the container, so keep git operations on the host worktree.

## Progress File Template

Create or update `IMPLEMENTATION_PROGRESS.md` in the worktree root:

```markdown
# <Feature> Implementation Progress

## Ralph job setup

- Created: <date>
- Owner scope: `<owner-scope>`
- Target room: `<room-id>`
- Profile: `pibo-agent`
- Template: `<template-id>`
- Worktree: `<absolute-host-worktree>`
- Branch: `<branch>`
- Docker dev worker: `<worker-name>`
- Docker web port: `<port>`
- Docker gateway port: `<port>`
- Docker CDP port: `<port>`

## Scope

Implement:

`<paths to PRDs/specs/tasks>`

## Operating notes

- Keep implementation work in the dedicated host worktree above.
- Reuse the existing Docker dev worker for runtime, tests, builds, and gateway restarts.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host services.
- Run container commands as `docker exec <worker> bash -lc 'cd /workspace && <command>'`.
- Git operations and commits must be done on the host worktree path.
- Batch user stories sensibly. Stop the session when a coherent batch is complete.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.

## Progress log

- <date>: Created worktree and validated Docker worker.
```

## Ralph Job Creation Flow

Prefer this sequence:

1. Prepare or verify worktree, Docker worker, and progress file.
2. Inspect templates.
3. Create the job stopped.
4. Inspect the job JSON.
5. Start after confirmation.

Example:

```bash
OWNER_SCOPE='user:<user-id>'
ROOM_ID='<room-id>'

pibo ralph templates --json

pibo ralph add \
  --owner-scope "$OWNER_SCOPE" \
  --room "$ROOM_ID" \
  --profile pibo-agent \
  --template prd-batch-stories \
  --name "Implement <feature> PRD batch" \
  --prompt "$(cat /tmp/ralph-loop-prompt.txt)" \
  --json

pibo ralph list --owner-scope "$OWNER_SCOPE" --all --json
pibo ralph start --owner-scope "$OWNER_SCOPE" <job-id>
```

Use `--start` only when the user explicitly wants immediate launch or the job has already been reviewed.

## Template Choice

Use the built-in templates as source-of-truth presets:

- `prd-single-story-standard`: one failing PRD story per run, useful for risky changes.
- `prd-batch-stories`: multiple PRD stories in priority order, useful for a prepared batch with clear commits.
- `single-run-objective`: one focused non-PRD task, stops after one completed run attempt.

Explicit CLI options override template fields. Keep loaded fields editable when preparing jobs.

## Stop Conditions and maxIterations

Ralph has two layers of stopping:

- Semantic stop conditions, e.g. promise-complete or story completion.
- `maxIterations` fallback.

`maxIterations` should be treated as a hard fallback over **completed run attempts**, including:

- `ok`
- `error`
- `cancelled`

This prevents endless loops when runs repeatedly fail or get cancelled before satisfying a semantic stop condition.

Use a high but bounded value for large PRD batches, such as `100`, and a small value for focused one-shot tasks, such as `1`.

### Promise-complete Token Safety

Ralph's promise-complete condition is a literal marker check on the final answer. Older deployments and some jobs may treat any mention as a match; even with stricter own-line matching, quoted examples are dangerous. If an agent writes the literal completion marker in a negative sentence, quote, explanation, or example, the loop can stop accidentally.

When preparing prompts for jobs with a promise-complete condition:

- Do not include the full literal completion marker contiguously in the prompt.
- Describe it as the XML completion marker, or as the opening tag `<promise>`, the word `COMPLETE`, and the closing tag `</promise>`.
- Instruct the agent not to quote, negate, explain, or mention the literal marker unless all completion criteria are satisfied and it intentionally wants to stop the job.
- For incomplete work, instruct the agent to say "completion marker omitted" instead of writing the literal marker in any form.
- When reviewing a stopped job with reason `promise-complete`, inspect the final answer for accidental mentions such as "not complete" statements before assuming the work is finished.

## Prompt Instructions Ralph Needs

The job prompt is the most important part. It should be explicit about environment, scope, verification, commits, and forbidden actions.

Include:

- Exact host worktree path.
- Exact branch name.
- Exact Docker worker name and ports.
- Exact PRD/spec paths to implement.
- Progress file path.
- Commit policy.
- Test/build policy.
- Safety restrictions.
- What to do first.
- When to stop the current session.

### Prompt Skeleton

```text
Implement <feature/scope> using the dedicated Ralph loop environment.

Environment:
- Host worktree: <absolute-host-worktree>
- Branch: <branch>
- Docker dev worker: <worker-name>
- Container workspace: /workspace
- Web: http://127.0.0.1:<web-port>/apps/chat
- Gateway: <gateway-port>
- CDP: <cdp-port>
- Progress file: <absolute-host-worktree>/IMPLEMENTATION_PROGRESS.md

Scope:
- Implement PRDs under: <path/glob>
- Total workload: <optional story count>

Operating rules:
- Work in the host worktree. Use absolute paths or cd into the worktree before edits.
- Use the Docker worker for runtime, tests, builds, dev gateway restarts, and browser checks.
- Run container commands as: docker exec <worker> bash -lc 'cd /workspace && <command>'.
- Do not create or release Docker workers.
- Do not restart or modify host pibo-web.service.
- Do not expose credentials.
- Keep telemetry/privacy/product constraints from the PRDs.
- If using promise-complete, never quote, negate, explain, or mention the literal completion marker unless all completion criteria are satisfied; for incomplete work, say "completion marker omitted".
- Update IMPLEMENTATION_PROGRESS.md with decisions, completed stories, validation, commits, blockers, and next steps.
- Commit after every completed story or coherent story group.

First actions:
1. cd <host-worktree>.
2. Run git status and recent git log.
3. Read IMPLEMENTATION_PROGRESS.md.
4. Read the PRD JSON files and related specs/tasks/decisions.
5. Select a coherent next story group.
6. State the selected group in the progress file.

Completion rules for each story group:
- Implement the smallest coherent slice.
- Run focused tests first.
- Run typecheck/build when appropriate.
- Commit from the host worktree with a clear message.
- Update progress with validation and commit hash.
- Stop the session if the coherent batch is complete or if blocked.
```

## Monitoring Checklist

Use read-only checks unless the user asks for intervention:

```bash
pibo ralph list --owner-scope "$OWNER_SCOPE" --all --json
pibo ralph runs --owner-scope "$OWNER_SCOPE" --job <job-id> --json
pibo debug session <pibo-session-id>
pibo debug events <pibo-session-id> --limit 30
pibo debug trace <pibo-session-id> --running-only --check
```

Also inspect git state:

```bash
cd <worktree>
git status --short --branch
git log --oneline --decorate -n 8
tail -80 IMPLEMENTATION_PROGRESS.md
```

Interpretation tips:

- A running session with fresh events is healthy even if a trace wrapper reports `status: error`; compare session status, events, and Ralph run status before acting.
- If the worktree has uncommitted changes for a long time, check whether Ralph is still actively editing/testing.
- If a completed story is uncommitted, remind or intervene only with user approval unless the job instructions authorize commits.

## Review and Intervention Strategy

Early review should be read-only:

1. Confirm job enabled/running state.
2. Confirm current run and session IDs.
3. Confirm session events are fresh.
4. Confirm worktree branch and changed files.
5. Confirm progress file is being updated.
6. Confirm Docker worker is reachable if runtime checks are expected.
7. Report concise status, risks, and whether to continue.

Intervene only when:

- The job is unsafe.
- It touches forbidden host services.
- It uses the wrong repo/worktree/branch.
- It creates/release workers without approval.
- It is stale and not making progress.
- It repeatedly fails and `maxIterations` is being consumed.

Prefer `pibo ralph stop` for graceful shutdown. Use `pibo ralph cancel` only for stuck or unsafe active runs.

## Sync and PR Strategy

For host repo sync:

```bash
cd /root/code/pibo
git fetch upstream main
git switch main
git merge --ff-only upstream/main
git switch developer
git merge --ff-only main
git push origin main developer
```

For Ralph worktree branches:

- Do not merge or rebase a running Ralph worktree without checking active edits.
- Let Ralph finish and commit a coherent batch first.
- Then sync intentionally, resolve conflicts, run tests, and push.
- Open upstream PRs with the project helper when ready.

## Minimal User Report

Keep reports short:

```text
Ralph läuft gesund.
- Job: <id>
- Run: <id>, Status: running
- Session: <id>, letzte Events frisch
- Worktree: <branch>, aktuelle Änderungen: <files>
- Progress: <last completed story/commit>
- Risiko: <none/short note>
Empfehlung: weiterlaufen lassen / stoppen / eingreifen.
```