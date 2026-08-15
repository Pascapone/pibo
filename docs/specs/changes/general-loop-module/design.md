# Design: Native Goal Lifecycle and Accounting

## Context

The first Loop implementation copied Codex's continuation and completion-audit prompting but retained Ralph's textual completion marker. It also omitted goal token accounting and has no explicit blocked state. This design moves Goal mode to structured native tooling while preserving Ralph compatibility.

## Goals

- Provide native `get_goal`, `create_goal`, and `update_goal` tools without MCP.
- Let Agent Designer profiles enable or disable the complete goal-tool capability.
- Persist explicit goal lifecycle status and accounting.
- Stop Goal continuation from structured completion, blocked, or budget-limited state.
- Preserve marker-based Ralph behavior and existing Loop data.

## Decisions

### Decision: Goal tools are a profile tool package

- **Choice:** Add a `goalControl` tool-package flag, enabled by default for the base profile and new or migrated custom agents. The package exposes all three native tools and appears as one Agent Designer switch.
- **Rationale:** Goal lifecycle tools must normally be available, but a custom agent owner must be able to remove the capability atomically.
- **Alternative considered:** Three independent native-tool selections. This makes partial configurations easy and does not meet the requested single disable control as clearly.

### Decision: Tools bind to the current Pibo Session

- `get_goal` returns the newest goal associated with the current Pibo Session.
- `create_goal` creates an active Goal Loop associated with the current session, room, and profile. It fails while an unfinished goal exists for that session.
- `update_goal` accepts only `complete` or `blocked` from the model.
- User and system operations continue to own pause/resume and budget-limited transitions.

### Decision: Goal status is persisted in existing job state

Goal jobs persist one of:

- `active`
- `paused`
- `blocked`
- `budget_limited`
- `complete`

Legacy Goal rows without an explicit status derive `active` when enabled and `paused` when stopped. Ralph rows do not require goal status.

### Decision: Token accounting uses reported model-message usage

Pibo emits a normalized assistant-usage event for every completed assistant model message, including tool-use model steps without final text. Goal runs accumulate reported `totalTokens`, or a normalized sum when total tokens are unavailable.

Accounting is exact for usage reported by Pi/provider messages. The budget is therefore explicitly soft: it cannot stop a provider request before that request returns usage. Each run snapshots remaining tokens before the turn and persists turn usage plus overshoot. An optional pre-turn reserve prevents another run when remaining tokens do not exceed the configured minimum.

Active agent time accumulates run execution. Wall-clock elapsed time begins on first activation and includes waits and paused periods; a never-started paused Goal reports zero elapsed wall-clock time.

### Decision: Goal mode uses structured status; Ralph keeps the marker

Goal prompts instruct the agent to call `update_goal` after a strict completion or blocked audit. Default Goal stop policy observes persisted goal status and token budget. Ralph prompts and the promise-complete condition remain unchanged for compatibility. Explicit custom Goal policies may still include the legacy marker condition.

### Decision: Blocked audit follows Codex prompting

The Goal prompt allows `blocked` only after the same blocking condition recurs for at least three consecutive Goal turns and meaningful progress requires user input or external-state change. As in Codex, this is a model/tool contract rather than a runtime semantic classifier. Pibo persists the structured result and stops continuation.

### Decision: Goal-first discovery is separate from Ralph compatibility

A built-in `loop` skill and `pibo tools guide loop loop` teach same-session Goal lifecycle, token budgets, and native status tools. The existing `ralph-loop` skill and Ralph guide remain available but explicitly describe Ralph as the legacy fresh-session mode.

## Risks and Trade-offs

- A model can call `blocked` before satisfying the prompt contract; Codex has the same trust boundary.
- Uncached input and output usage is accounted after provider messages; cache-read and cache-write tokens remain available as telemetry but do not consume the Goal budget. A single request can still overshoot the soft budget; the reserve reduces pre-turn risk but is not a hard provider limit.
- Existing custom agents need a migration default of enabled to avoid Goal loops that cannot complete structurally.
- `create_goal` from an ordinary session depends on the Web Loop service being active for automatic continuation.

## Migration and Rollback

- Add optional fields to existing job state and runtime/API types; no destructive table rename is required.
- Add `goal_control` to custom-agent storage with default enabled.
- Existing Ralph jobs continue to use markers.
- Existing Goal jobs without explicit status remain operable through derived status and gain structured tools when their profile permits them.
