---
title: Tool Review Feedback Loop Specification
version: 0.1
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [process, tools, review, feedback-loop, web-chat, gateway-actions]
---

# Introduction

This specification defines a Pibo-owned Tool Review process that lets an agent review tool usage in a Pibo Session, identify friction, and produce structured feedback for improving tools, tool visibility, and agent-facing workflows.

The first version is manually triggered by a Chat Web slash command. Automatic triggers based on tool errors, repeated usage, and watchlist policies are part of the extensible design target but are not required for the first manual command.

## 1. Purpose & Scope

The purpose is to create a repeatable review loop for agent-facing capabilities. A review inspects observed tool execution events, asks the agent to reflect on what worked and what did not, and records enough structured review state to avoid repeatedly reviewing tools that have already been assessed positively.

This specification covers:

- Manual Tool Review through a Pibo Gateway Action exposed as a Chat Web slash command.
- Review eligibility rules for force, target-specific, error-triggered, and positive-streak-suppressed reviews.
- Data contracts for tool usage summaries, review requests, review results, and review ledger state.
- Requirements for future automatic triggers.

This specification does not require implementing automatic review scheduling in V1. It also does not require changing Pi Coding Agent core.

## 2. Definitions

- **Tool Review**: A wrapper-level process that summarizes tool usage and asks an agent to evaluate tool and workflow quality.
- **Tool Review Trigger**: A condition or manual command that requests a Tool Review.
- **Review Target**: One tool, a set of tools, or all reviewable tools in a Pibo Session.
- **Reviewable Tool**: A capability with observable runtime usage through `tool_call`, `tool_execution_started`, `tool_execution_updated`, or `tool_execution_finished` events.
- **Positive Review**: A Tool Review result that contains no required change, no blocker, and no unresolved friction for the reviewed target.
- **Positive Streak**: The count of consecutive Positive Reviews for one Review Target.
- **Review Ledger**: Pibo-owned persistent state that stores review outcomes, positive streaks, last reviewed timestamps, and last known error timestamps.
- **Watchlist Policy**: A per-tool policy that can make a tool reviewable more aggressively than the default rules.
- **Force Review**: A manual review mode that ignores positive-streak suppression.
- **Workflow Event**: A Pibo-owned internal event describing product workflow state, such as review requested, review skipped, review completed, or review policy matched. This is distinct from user-visible Chat Web events and from Pi Coding Agent engine events.
- **Skill**: A profile resource loaded into the runtime. Current Pibo can observe which skills were loaded, but it cannot reliably observe whether the model actively used a skill during a run unless future instrumentation is added.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Pibo MUST expose a manual Tool Review as a Gateway Action so Chat Web can surface it as a slash command.
- **REQ-002**: The V1 slash command SHOULD be `/tool-review`.
- **REQ-003**: The Tool Review action MUST accept optional JSON parameters for mode, target names, and force behavior.
- **REQ-004**: A Tool Review MUST operate on a Pibo Session ID, not directly on a Pi Session ID.
- **REQ-005**: A Tool Review MUST derive observed tool usage from normalized Pibo output events when possible.
- **REQ-006**: A Tool Review MUST include tool execution errors where `tool_execution_finished.isError === true`.
- **REQ-007**: A Tool Review MUST include a compact per-tool usage summary: calls, completed executions, errors, latest status, and event references.
- **REQ-008**: A Tool Review MUST avoid sending full unbounded tool payloads to the reviewing agent.
- **REQ-009**: A Tool Review MUST redact or truncate arguments and results according to a fixed review payload budget.
- **REQ-010**: A Tool Review MUST support reviewing one explicit tool target.
- **REQ-011**: A Tool Review MUST support reviewing all eligible tool targets in the session.
- **REQ-012**: A Force Review MUST include requested targets even when they have reached the positive-streak suppression threshold.
- **REQ-013**: Non-force automatic review eligibility MUST skip tools whose Positive Streak is greater than or equal to the configured suppression threshold and that have no new errors since the last positive review.
- **REQ-014**: The default suppression threshold SHOULD be 5 consecutive Positive Reviews.
- **REQ-015**: A target with new errors since its last positive review MUST be eligible even when its Positive Streak is above the suppression threshold.
- **REQ-016**: A session-level automatic trigger SHOULD become eligible when total tool errors in the session reach a configured threshold.
- **REQ-017**: The default session-level error threshold SHOULD be 5 tool errors.
- **REQ-018**: A per-tool automatic trigger SHOULD become eligible when one tool reaches a configured error threshold.
- **REQ-019**: The default per-tool error threshold SHOULD be 2 errors for the same tool in one session.
- **REQ-020**: Watchlist Policy MUST allow a specific tool to be reviewed on first error, always reviewed when used, or always reviewed until removed from the watchlist.
- **REQ-021**: If no targets are eligible and no Force Review is requested, the action MUST return a structured skipped result.
- **REQ-022**: If only one tool is eligible, the review request MUST focus on that single tool.
- **REQ-023**: If several tools are eligible, the review request MUST group them by error severity and recent usage.
- **REQ-024**: Review output MUST distinguish between required fixes, optional improvements, and no-action observations.
- **REQ-025**: Review output MUST update the Review Ledger for each reviewed target.
- **REQ-026**: A Positive Review MUST increment the target's Positive Streak.
- **REQ-027**: A review with required fixes or unresolved friction MUST reset or suspend the target's Positive Streak.
- **REQ-028**: Tool Review MUST be implemented at the Pibo Product Boundary unless a future requirement needs Pi-level mutation or blocking before tool execution.
- **CON-001**: Pibo MUST NOT modify Pi Coding Agent core for the V1 manual Tool Review.
- **CON-002**: Pibo MUST NOT treat skill loading as proof that a skill was used.
- **CON-003**: Review prompts MUST be compact enough to avoid turning Tool Review into a large context burden.
- **GUD-001**: Prefer storing structured review results over free-form-only review prose.
- **GUD-002**: Prefer Gateway Actions for user-requested reviews because Chat Web already discovers slash commands from gateway action metadata.
- **GUD-003**: Automatic triggers should enqueue review requests as workflow events or service messages only after manual review behavior is stable.

## 4. Interfaces & Data Contracts

### Gateway Action

```ts
type ToolReviewActionName = "tool.review";
type ToolReviewSlashCommand = "tool-review";
```

### Tool Review Params

```ts
type ToolReviewParams = {
  mode?: "eligible" | "all" | "target" | "errors";
  targetToolNames?: string[];
  force?: boolean;
  includePositiveSuppressed?: boolean;
  reason?: "manual" | "error-threshold" | "watchlist" | "periodic";
};
```

Rules:

- `mode: "eligible"` reviews only targets selected by eligibility rules.
- `mode: "all"` reviews all tools observed in the session unless positive-streak suppression applies.
- `mode: "target"` requires `targetToolNames`.
- `mode: "errors"` reviews only tools with observed errors.
- `force: true` bypasses positive-streak suppression.
- `includePositiveSuppressed: true` may include suppressed targets in the returned summary without asking the agent to review them.

### Tool Usage Summary

```ts
type ToolUsageSummary = {
  toolName: string;
  callCount: number;
  executionCount: number;
  successCount: number;
  errorCount: number;
  latestToolCallId?: string;
  latestEventId?: string;
  latestStatus: "called" | "running" | "succeeded" | "failed";
  firstSeenAt?: string;
  lastSeenAt?: string;
  sampleArgs?: unknown;
  sampleResult?: unknown;
  errorSamples: Array<{
    toolCallId: string;
    eventId?: string;
    message: string;
  }>;
};
```

### Review Eligibility

```ts
type ToolReviewEligibility = {
  toolName: string;
  eligible: boolean;
  reasons: Array<
    | "forced"
    | "explicit-target"
    | "new-tool"
    | "tool-error-threshold"
    | "session-error-threshold"
    | "watchlist-always"
    | "watchlist-first-error"
    | "periodic-sample"
  >;
  suppressedReasons: Array<"positive-streak" | "no-usage" | "no-new-errors">;
  positiveStreak: number;
};
```

### Review Result

```ts
type ToolReviewResult = {
  piboSessionId: string;
  reviewId: string;
  reason: "manual" | "error-threshold" | "watchlist" | "periodic";
  status: "completed" | "skipped";
  reviewedTools: string[];
  skippedTools: ToolReviewEligibility[];
  summary: string;
  findings: Array<{
    toolName: string;
    severity: "none" | "low" | "medium" | "high";
    category: "description" | "parameters" | "result" | "error-handling" | "workflow" | "visibility" | "policy";
    observation: string;
    recommendation?: string;
    required: boolean;
  }>;
  ledgerUpdates: Array<ToolReviewLedgerUpdate>;
};
```

### Review Ledger

```ts
type ToolReviewLedgerEntry = {
  targetType: "tool" | "skill" | "capability-package";
  targetName: string;
  positiveStreak: number;
  lastReviewedAt?: string;
  lastPositiveReviewAt?: string;
  lastNonPositiveReviewAt?: string;
  lastErrorAt?: string;
  lastReviewId?: string;
  watchlist?: {
    mode: "off" | "always" | "first-error" | "until-positive-streak";
    positiveStreakTarget?: number;
  };
};

type ToolReviewLedgerUpdate = {
  targetName: string;
  previousPositiveStreak: number;
  nextPositiveStreak: number;
  positive: boolean;
  lastReviewedAt: string;
};
```

## 5. Acceptance Criteria

- **AC-001**: Given Chat Web receives bootstrap capabilities, When the Tool Review action is registered with slash command `tool-review`, Then the composer can display `/tool-review`.
- **AC-002**: Given a user submits `/tool-review`, When the command is recognized, Then Chat Web sends `POST /api/chat/action` with action `tool.review`.
- **AC-003**: Given a session contains one failed `pibo_exec` execution, When `/tool-review` is run with default params, Then `pibo_exec` is eligible for review.
- **AC-004**: Given a target tool has Positive Streak 5 and no new errors, When default `/tool-review` runs, Then that tool is skipped with suppressed reason `positive-streak`.
- **AC-005**: Given a target tool has Positive Streak 5 and a new failed execution, When default `/tool-review` runs, Then that tool is eligible.
- **AC-006**: Given `/tool-review --force` is represented as `force: true`, When the action runs, Then positive-streak suppression is ignored.
- **AC-007**: Given `/tool-review pibo_exec` is represented as `mode: "target"` and `targetToolNames: ["pibo_exec"]`, When the action runs, Then only `pibo_exec` is reviewed unless it has no observable usage.
- **AC-008**: Given no tools were used and no force target is provided, When the action runs, Then it returns status `skipped`.
- **AC-009**: Given all observed tools are positive-streak suppressed and no force is provided, When the action runs, Then no reviewing agent turn is triggered.
- **AC-010**: Given a watchlist policy of `always` for a tool, When that tool appears in session usage, Then it is eligible regardless of positive streak unless the review mode explicitly excludes it.
- **AC-011**: Given a completed review with no required findings for a tool, When the ledger is updated, Then the tool's Positive Streak increments by one.
- **AC-012**: Given a completed review with a required finding for a tool, When the ledger is updated, Then the tool's Positive Streak is reset or suspended.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for eligibility and ledger updates; integration tests for Gateway Action discovery and Chat Web action routing.
- **Frameworks**: Node.js built-in test runner and TypeScript type checking.
- **Focused Areas**:
  - Gateway Action registration and slash command metadata.
  - Tool usage aggregation from normalized `PiboOutputEvent` records.
  - Positive-streak suppression.
  - Force and target-specific review params.
  - Skipped review behavior.
- **Suggested Commands**: `npm run typecheck`, `node --test test/plugin-registry.test.mjs`, `node --test test/web-channel.test.mjs`, and a future focused Tool Review test file.

## 7. Rationale & Context

Pibo already normalizes Pi tool execution events and exposes Gateway Actions to Chat Web. This makes Pibo the correct first home for Tool Review. The review loop is product policy: it decides when to ask for reflection, how to store review history, and how to avoid repetitive reviews. Pi Coding Agent should remain the execution engine unless a future requirement needs to block or mutate a tool before execution.

Positive-streak suppression prevents a stable tool from consuming review attention forever. Force Review remains necessary because maintainers sometimes need to inspect a tool even when recent reviews were positive.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent event stream through Pibo `RoutedSession`.

### Infrastructure Dependencies

- **INF-001**: Pibo Session Store for session identity and ownership.
- **INF-002**: Chat Web event storage or reliability event storage for reconstructing recent tool usage.
- **INF-003**: A future Review Ledger store.

### Technology Platform Dependencies

- **PLT-001**: Existing Pibo Gateway Action and Chat Web slash command discovery.

## 9. Examples & Edge Cases

### Manual Eligible Review

```json
{
  "type": "execution",
  "piboSessionId": "ps_demo",
  "action": "tool.review",
  "params": {
    "mode": "eligible",
    "reason": "manual"
  }
}
```

### Force Review For One Tool

```json
{
  "type": "execution",
  "piboSessionId": "ps_demo",
  "action": "tool.review",
  "params": {
    "mode": "target",
    "targetToolNames": ["pibo_exec"],
    "force": true,
    "reason": "manual"
  }
}
```

### Skipped Result

```json
{
  "status": "skipped",
  "reviewedTools": [],
  "skippedTools": [
    {
      "toolName": "pibo_echo",
      "eligible": false,
      "reasons": [],
      "suppressedReasons": ["positive-streak", "no-new-errors"],
      "positiveStreak": 5
    }
  ]
}
```

### Skill Edge Case

A session profile may load `pi-agent-harness`, but Tool Review must not claim that the skill was used unless a future event explicitly records skill usage. V1 may include loaded skills as context metadata only.

## 10. Validation Criteria

- The action is discoverable in `capabilities.actions`.
- The slash command routes through `/api/chat/action`, not `/api/chat/message`.
- Tool summaries are derived from normalized Pibo output events.
- Positive-streak suppression can be tested without invoking a model.
- Force and target-specific review behavior can be tested without invoking a model.
- No Pi Coding Agent core change is required for V1.

## 11. Related Specifications / Further Reading

- [spec-schema-events-and-gateway.md](./spec-schema-events-and-gateway.md)
- [spec-architecture-runtime-boundary.md](./spec-architecture-runtime-boundary.md)
- [spec-infrastructure-web-auth-chat.md](./spec-infrastructure-web-auth-chat.md)
- [docs/architecture.md](../docs/architecture.md)
- [docs/tool-review-hooks-analysis.md](../docs/tool-review-hooks-analysis.md)
