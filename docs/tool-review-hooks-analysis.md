# Tool Review Hooks Analysis

Date: 2026-05-02

This document analyzes where a Tool Review feedback loop can dock into the current Pibo and Pi Coding Agent architecture. It is intentionally an analysis and design document, not an implementation plan.

## Summary

The best V1 anchor is Pibo, not Pi Coding Agent core.

Pibo already has the three surfaces needed for a manual Tool Review:

- Normalized tool lifecycle output events from `RoutedSession`.
- Gateway Actions with slash-command metadata in `PiboPluginRegistry`.
- Chat Web command routing through `/api/chat/action`.

Pi Coding Agent has deeper extension hooks that can block, mutate, or observe tool calls before and after execution. Those hooks are useful for future low-level policy or tool instrumentation, but Tool Review is product feedback policy. It should start at the Pibo Product Boundary so it can use Pibo Session IDs, Chat Web storage, profile metadata, and review ledger state without pushing product behavior into Pi core.

## Existing Pibo Hook Surfaces

### 1. Normalized Runtime Events

Source files:

- `src/core/routed-session.ts`
- `src/core/events.ts`
- `src/core/session-router.ts`

`RoutedSession` subscribes to the Pi runtime session and normalizes engine events into `PiboOutputEvent` values. Relevant event types are:

- `tool_call`
- `tool_execution_started`
- `tool_execution_updated`
- `tool_execution_finished`
- `session_error`
- `message_started`
- `message_finished`
- `assistant_message`

This is the most useful surface for Tool Review because it is already product-level and includes `piboSessionId`, `eventId`, `toolCallId`, `toolName`, arguments, result, and `isError`.

Strengths:

- Stable Pibo event contract.
- Already consumed by Chat Web read models and event logs.
- Independent from Pi internal event shape.
- Good enough to count tool calls, successes, and failures.

Limitations:

- It observes after Pi has emitted events; it is not a pre-execution policy hook.
- Error details are only as good as normalized tool results.
- It cannot prove a loaded skill was actively used by the model.

### 2. Plugin Event Listener

Source files:

- `src/plugins/types.ts`
- `src/plugins/registry.ts`
- `src/core/session-router.ts`

Plugins can call `api.onEvent(listener)` and receive `PiboOutputEvent` values through `pluginRegistry.notifyEvent(event)`.

This is a good surface for a future automatic trigger engine that watches tool errors and usage while sessions run.

Strengths:

- No channel-specific coupling.
- Can observe all routed sessions.
- Listener failures are collected and do not stop other listeners.

Limitations:

- Current listener is observe-only.
- It does not have built-in access to persisted historical event windows unless paired with stores.
- It should not directly trigger model turns without a clear queueing contract.

### 3. Product Event Surface

Source files:

- `src/plugins/types.ts`
- `src/plugins/registry.ts`
- `src/channels/types.ts`

Pibo already has a separate product-event surface with `emitProductEvent` and `onProductEvent`. It is distinct from router output events.

This is the right conceptual home for internal Workflow Events such as:

- `tool-review.requested`
- `tool-review.skipped`
- `tool-review.completed`
- `tool-review.policy_matched`
- `tool-review.ledger_updated`

Strengths:

- Avoids pretending internal review lifecycle events are assistant output.
- Can notify UI or stores without adding noise to model transcript.
- Matches the existing distinction between product lifecycle and routed agent output.

Limitations:

- Current product event storage and replay are less central than Chat Web event storage.
- A review-specific durable ledger would still be needed.

### 4. Gateway Actions And Slash Commands

Source files:

- `src/plugins/types.ts`
- `src/plugins/registry.ts`
- `src/plugins/builtin.ts`
- `src/core/routed-session.ts`

Pibo Gateway Actions are registered by plugins. Each action can expose `slashCommands`, and `RoutedSession.executeAction` dispatches execution events through the registered action.

Current examples include:

- `status` through `/status`
- `thinking` through `/thinking`
- `session.current` through `/session-current`
- `session.clone` through `/clone`

This is the correct V1 surface for `/tool-review`.

Strengths:

- Already discoverable by Chat Web.
- Actions are wrapper-level and do not become model messages.
- Unknown actions fail explicitly.
- Parameters are JSON-serializable through web and gateway boundaries.

Limitations:

- The current Chat Web parser only has special argument handling for `/thinking`; richer slash-command parsing would need to be added if commands like `/tool-review --force pibo_exec` should map to structured params in the browser.

### 5. Chat Web API And Composer

Source files:

- `src/apps/chat/web-app.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`

Chat Web obtains `capabilities.actions` from bootstrap responses and turns `slashCommands` into composer commands. When a command is submitted, it posts to `/api/chat/action`, which emits a Pibo execution event.

Current flow:

```text
Gateway Action metadata
  -> bootstrap capabilities.actions
  -> Chat Web slash command menu
  -> POST /api/chat/action
  -> PiboInputEvent type=execution
  -> RoutedSession.executeAction
  -> execution_result output event
```

This path already reaches from Webchat App to Pibo Session routing.

Strengths:

- No new transport is needed for manual review.
- Slash commands are not mixed with normal user messages when recognized.
- Action results already become traceable execution command nodes.

Limitations:

- Browser command parsing is currently shallow.
- Chat Web hides `/tree` in the command list; similar command-specific UI choices may be needed later.
- The API validates JSON serializability but does not validate action-specific params.

### 6. Chat Web Event Storage And Debug CLI

Source files:

- `src/apps/chat/read-model.ts`
- `src/apps/chat/event-log.ts`
- `src/apps/chat/trace.ts`
- `src/debug/events.ts`
- `src/debug/session.ts`

Chat Web persists normalized Pibo output events and can rebuild traces from Pi transcript data plus raw Pibo events. The debug CLI can inspect session and event data, including fields such as `toolName`, `toolCallId`, and `result.details.status`.

This is a practical source for reviewing completed sessions.

Strengths:

- Review can be reconstructed after the run.
- Debug CLI already establishes a compact event-inspection pattern.
- Chat trace already groups tool calls and execution command nodes.

Limitations:

- Review-specific ledger state does not exist yet.
- Some event stores are read models, not canonical transcripts.
- Retention policies may prune live deltas; Tool Review should rely on durable trace events and final tool results when possible.

## Existing Pi Coding Agent Hook Surfaces

### 1. Pi Extension Events

Source files:

- `<HOME>/code/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
- `<HOME>/code/pi-mono/packages/coding-agent/src/core/extensions/runner.ts`

Pi extensions expose many lifecycle events:

- `resources_discover`
- `session_start`
- `input`
- `before_agent_start`
- `context`
- `before_provider_request`
- `after_provider_response`
- `agent_start`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_call`
- `tool_result`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `session_before_compact`
- `session_compact`
- `session_before_switch`
- `session_before_fork`
- `session_before_tree`
- `session_tree`
- `session_shutdown`

The most relevant hooks for Tool Review are `tool_call`, `tool_result`, and the `tool_execution_*` events.

Strengths:

- Can observe tools before and after execution.
- `tool_call` can block or mutate tool input.
- `tool_result` can modify result content, details, or error state.
- `before_agent_start` can add a custom message or alter the per-turn system prompt.

Limitations:

- This is engine-proximate and should not become Pibo product policy by default.
- It is session-runtime local, not naturally a cross-session product ledger.
- Pi extension slash commands are primarily interactive Pi TUI commands, not Chat Web commands.

### 2. Lower-Level Agent Hooks

Source files:

- `<HOME>/code/pi-mono/packages/agent/src/types.ts`
- `<HOME>/code/pi-mono/packages/agent/src/agent-loop.ts`

The lower-level agent loop supports:

- `beforeToolCall`
- `afterToolCall`
- `transformContext`
- `getSteeringMessages`
- `getFollowUpMessages`
- event subscription for `tool_execution_start`, `tool_execution_update`, and `tool_execution_end`

These are the deepest hooks available.

Strengths:

- Best place for execution policy, blocking, and result overrides.
- Has validated tool arguments before execution.
- Can change the loop behavior before final tool-result messages are emitted.

Limitations:

- Too low-level for a product feedback loop.
- Pibo Session, Chat Web, review ledger, and slash commands are outside this layer.
- Using this layer first would couple review behavior to engine internals.

## Where Slash Commands Should Dock

For Chat Web, slash commands should dock at Pibo Gateway Actions.

Reasoning:

- Chat Web already discovers Gateway Action slash commands through bootstrap capabilities.
- The Web App already posts recognized commands to `/api/chat/action`.
- Gateway Actions already execute at the wrapper layer and return `execution_result`.
- Tool Review is not ordinary user prompt text; it is a wrapper-level operation that may decide whether to start a review turn.

Pi extension commands are useful for Pi TUI or direct Pi interactive mode, but they are not the right first abstraction for Webchat App commands. If the same review behavior is needed in local TUI later, Pibo should expose the same `tool.review` execution action through the routed local adapter rather than duplicating review logic as a Pi extension command.

## Trigger Point Options

### Manual Slash Command

Recommended for V1.

Trigger:

```text
/tool-review
/tool-review --force
/tool-review pibo_exec
/tool-review --all
```

Internal representation:

```json
{
  "action": "tool.review",
  "params": {
    "mode": "eligible",
    "force": false,
    "reason": "manual"
  }
}
```

Benefits:

- Easy to reason about.
- No accidental extra model turns.
- Good first validation of review prompts, summaries, and ledger behavior.

### Error Threshold Trigger

Future automatic trigger.

Potential rules:

- Review a specific tool when that tool has at least 2 failed executions in one Pibo Session.
- Review the session when total tool failures reach 5 across all tools.
- Review immediately when a watchlisted tool fails once.

Best hook:

- Observe `tool_execution_finished` in a plugin event listener or router-level workflow observer.
- Emit an internal `tool-review.policy_matched` Workflow Event.
- Queue a review request only when the session is idle or after `message_finished`.

Key concern:

- Do not inject a review while the agent is still in the middle of a tool loop unless that behavior is explicitly desired. The first automatic version should wait for `message_finished`.

### Periodic Or Sample Trigger

Future automatic trigger.

Potential rules:

- Every third or fourth run, review eligible tools.
- Review only new tools or tools below the positive-streak threshold.
- Skip entirely when all tools used in the session are suppressed by positive streak.

Best hook:

- Count `message_finished` events per Pibo Session.
- Evaluate eligibility after a natural turn boundary.

Key concern:

- Periodic review must not become noisy. It should be suppressed by the Review Ledger.

### Watchlist Trigger

Future automatic trigger.

Potential rules:

- `always`: review whenever used.
- `first-error`: review on any error.
- `until-positive-streak`: review until the tool reaches a configured Positive Streak.

Best hook:

- Same as error and periodic triggers, but with per-tool policy loaded from the Review Ledger or config.

Key concern:

- Watchlist policy should be product state, not prompt text.

## Review Control Model

The flexible control mechanism should be data-driven and small.

Suggested conceptual model:

```ts
type WorkflowEvent = {
  type: string;
  piboSessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type ToolReviewPolicy = {
  defaultPositiveStreakSuppression: number;
  sessionErrorThreshold: number;
  perToolErrorThreshold: number;
  periodicRunInterval?: number;
  watchlist: Record<string, ToolWatchPolicy>;
};

type ToolWatchPolicy = {
  mode: "off" | "always" | "first-error" | "until-positive-streak";
  positiveStreakTarget?: number;
};
```

This should not become a broad second event system on day one. The useful boundary is:

- Pibo output events remain the runtime observation stream.
- Product events or a small workflow observer can represent review lifecycle.
- Review ledger state drives suppression and watchlist decisions.

The important design property is that new triggers can be added by evaluating policies over normalized events and ledger state, without changing Chat Web, Pi core, or tool definitions.

## Tool Review Data Sources

Recommended source order:

1. Live/in-memory Pibo events for the active turn if available.
2. Chat Web raw Pibo event log for persisted web sessions.
3. Reliability store `pibo.output` events for operational replay where available.
4. Pi transcript JSONL only as supplementary context, not as the primary tool usage contract.

Rationale:

- Normalized Pibo events are the product contract.
- Chat Web trace already combines transcript and Pibo events for UI reconstruction.
- Pi transcript shape may change independently from Pibo product needs.

## Review Prompt Shape

The reviewing agent should receive compact structured context, not a raw event dump.

Suggested prompt sections:

- Session identity: Pibo Session ID, profile, selected time window.
- Review reason: manual, error threshold, watchlist, or periodic.
- Target list and eligibility reasons.
- Per-tool usage summaries.
- Error samples with short messages.
- Existing ledger state.
- Required output schema.

The review should ask for:

- What worked well.
- What created friction.
- Whether the tool description, parameters, result format, or error visibility should change.
- Whether no action is needed.
- Concrete recommendations scoped to tool improvement.

The output should remain structured enough to update the ledger.

## Skill Handling

The user request mentions tools and skills. The current runtime can inspect loaded skills through profile/runtime inspection, but there is no reliable runtime event that says "the model used this skill".

Therefore:

- V1 Tool Review should review tools with observable execution events.
- Loaded skills may be listed as context metadata.
- Skill-specific review should be manual or profile-level unless future instrumentation records skill usage.
- A future skill review could review skill clarity after a session, but it should be labeled as inferred, not observed.

## Recommended Ownership Boundary

### Keep In Pibo

- Slash command registration.
- Review action dispatch.
- Review eligibility.
- Review ledger.
- Error threshold policies.
- Watchlist policies.
- Product Workflow Events.
- Chat Web display and trace integration.
- Review result persistence.

### Keep In Pi Coding Agent

- Model loop.
- Tool execution.
- Raw extension hooks.
- Session JSONL.
- Compaction.
- Direct Pi TUI extension commands.

### Use Pi Hooks Later Only If Needed

Use Pi `tool_call` or lower-level `beforeToolCall` only if Pibo must block, mutate, or annotate tool calls before execution. That is a different requirement from reviewing completed usage.

## Open Design Questions

- Should Tool Review create a normal service message in the same Pibo Session, or should it run as a separate reviewer subagent/profile to avoid contaminating the main assistant transcript?
- Should Review Ledger be global per workspace, scoped per profile, scoped per owner, or a combination?
- Should "Positive Review" be fully model-reported, rule-derived from findings, or both?
- How much raw tool result content is safe to include in review prompts by default?
- Should Tool Review results appear as trace nodes, product events, or both?
- Should automatic review requests wait for explicit user approval before adding model work to a session?

## Initial Recommendation

Start with a Pibo Gateway Action named `tool.review` exposed as `/tool-review`. Make it collect normalized tool usage for the selected Pibo Session, apply eligibility and positive-streak suppression, and return either a skipped result or a compact review request/result.

Do not modify Pi core for this. Add Pi-level hooks only later if review findings show that tools need pre-execution blocking, argument patching, or richer low-level instrumentation.
