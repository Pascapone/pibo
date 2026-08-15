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

- `get_goal`: inspect authoritative status, soft-budget risk, tokens used, remaining tokens, active agent time, and elapsed wall-clock time.
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
  --token-reserve <optional-pre-turn-minimum> \
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

Goal token budgets are soft: Pibo accumulates uncached input and output usage reported after model responses, so the final turn can overshoot. Cache-read and cache-write tokens do not consume the budget. Each Goal run records uncached tokens used before the turn, remaining uncached tokens before the turn, turn usage, and overshoot.

Set `--token-reserve <n>` to require more than `n` tokens to remain before Pibo starts another turn. Increase or clear the budget, or lower the reserve, before resuming a budget-limited Goal.

## Time accounting

`activeAgentTimeSeconds` accumulates time spent executing Goal runs. `elapsedWallClockSeconds` starts when the Goal is first activated, includes waiting and paused periods, and freezes when the Goal enters a terminal state. A Goal created paused reports zero wall-clock elapsed time until first activation.

## Managed browser leases

When a Goal owns `resources.browserLeaseIds`, Pibo renews those leases before each turn and while the turn is active. The same lease is retained across non-terminal Goal turns, including gateway service restart, and is released only when the Goal stops or reaches a terminal state. If the browser process disappeared, Pibo attempts to restart Chromium from the persisted managed profile. Failure to restore authenticated access marks the Goal blocked with an operator-facing resource reason.

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
