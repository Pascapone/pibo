---
name: loop
description: Plan, create, run, monitor, resume, and review Pibo Goal Loops and legacy Ralph loops. Use whenever the user asks for a persistent goal, continuous loop, autonomous multi-turn objective, token-budgeted goal, Loop job, Goal status, blocked Goal, or the pibo loop CLI.
---

# Pibo Loop Workflow

Use Goal mode for persistent objectives that should continue in the same Pibo Session. Use legacy Ralph mode only when each run should start with fresh session context.

Discover the live CLI progressively:

```bash
pibo loop --help
pibo loop add --help
pibo loop templates --json
pibo loop conditions
```

## Goal lifecycle

Goal-capable profiles expose native tools:

- `get_goal`: inspect authoritative status, objective, token budget, tokens used, remaining tokens, and elapsed active time.
- `create_goal`: create a persistent Goal only when the user or system explicitly requests one.
- `update_goal`: mark the current Goal `complete` after a strict completion audit, or `blocked` after the same impasse repeats for at least three consecutive Goal turns.

These are native Pibo tools, not MCP tools. Agent Designer exposes them as the default-enabled `pibo-goal-control` package. If that package is disabled, the agent cannot change Goal lifecycle status itself.

## CLI creation

```bash
pibo loop add \
  --room <room-id> \
  --profile <profile> \
  --prompt "<complete objective>" \
  --token-budget <optional-positive-token-count> \
  --max-iterations <optional-run-fallback> \
  --start
```

Prefer creating the job stopped when its prompt, target, profile, or safety boundaries still need review.

## Completion and blocked rules

- Treat completion as unproven until current evidence covers every explicit requirement and deliverable.
- Do not use `complete` for partial progress, a plausible result, budget exhaustion, or because the current turn is ending.
- Do not use `blocked` on the first blocker occurrence.
- Use `blocked` only after the same condition repeats for at least three consecutive Goal turns and meaningful progress requires user input or an external-state change.
- Resuming a blocked Goal begins a fresh blocked audit.

## Token budgets

Pibo accumulates model usage reported by completed assistant model messages. A Goal becomes `budget_limited` when reported usage reaches or exceeds its budget. One provider request can overshoot because usage is known only after the response reports it.

Increase or clear the token budget before resuming a budget-limited Goal.

## Operations

```bash
pibo loop list --all --json
pibo loop runs --job <job-id> --json
pibo loop start <job-id>
pibo loop stop <job-id>
pibo loop cancel <job-id>
```

Use `stop` for graceful pause after the current session. Use `cancel` only when the active session must be aborted.

For implementation work involving Docker workers, worktrees, browser checks, or pull requests, also use `pibo-docker-system` and `github-server-flow`.
