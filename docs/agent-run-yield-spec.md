# Agent Run Yield Spec

This spec turns the research note in `docs/agent-run-yield-research.md` into the implementation direction for Pibo. V1 was scoped to subagent runs. V2 generalizes yielded runs so any registered yieldable tool can run through the same run-control lifecycle.

Implementation status: yielded runs are implemented in `src/runs/`, `src/core/session-router.ts`, and `src/core/runtime.ts`.

## Goal

Pibo should let an agent start long-running subagent work, continue doing other useful work, and later inspect, wait for, read, cancel, or intentionally ignore that work.

The runtime must remember started work even when the agent forgets the handle or ends its current turn.

## Non-Goals

- Do not replace normal synchronous tool calls.
- Do not replace provider-level parallel tool execution.
- Do not build a generic process runner in V1.
- Do not make the gateway the primary control surface.
- Do not automatically inject full subagent results into agent context.
- Do not persist runs to disk in V1.

## Execution Shapes

Pibo supports three complementary execution shapes:

```text
synchronous tool call
  -> agent waits for the direct tool result

parallel synchronous tool calls
  -> the model emits independent tool calls and the runner executes them together

yielded run
  -> agent starts long-running work, receives runId, and continues
```

Yielded runs are an add-on. Normal tools still run synchronously when called directly. Run-control tools are exposed when a profile has yieldable tools.

## Core Model

`sessionKey` identifies a routed Pibo conversation. `sessionId` is the short technical Pi session identity behind that route and is used for Pi persistence and provider cache affinity.

`runId` identifies one concrete unit of long-running work.

```text
parent agent
  -> pibo_run_start(toolName, arguments)
  -> run registry allocates runId
  -> selected yieldable tool runs in the background
  -> tool returns runId quickly
  -> parent agent continues
```

The agent controls when to wait or read. The runtime controls memory, reminders, cleanup, and completion notifications.

## Completion Policies

Every yielded run has a completion policy.

```text
tracked
  Default. Runtime reminds the owning agent until the run is read, cancelled, or acknowledged.

detached
  Fire-and-forget. Runtime does not remind the owning agent automatically.
```

`tracked` must be the default. `detached` must be explicit and should be described as appropriate only when the result is not needed for the current answer or later follow-up.

Future policy, not V1:

```text
blocking
  Agent may not final-answer until the run is read, cancelled, or explicitly acknowledged.
```

## Tools

Pibo exposes run control as agent tools.

```text
pibo_run_start
pibo_run_list
pibo_run_status
pibo_run_wait
pibo_run_read
pibo_run_cancel
pibo_run_ack
```

`pibo_run_start` starts any yieldable tool as a yielded run. Its `toolName` parameter is generated as an enum of the yieldable tools visible to the current profile. The same tool can still be called directly for synchronous execution.

Suggested parameters:

```ts
type PiboRunStartParams = {
  toolName: string;
  arguments: unknown;
  completionPolicy?: "tracked" | "detached";
};
```

Generated per-subagent tools are normal synchronous tools and are yieldable. `pibo_exec` is also a normal synchronous tool and can be yielded with `pibo_run_start`.

`pibo_run_list` returns a compact snapshot of runs owned by the current agent session.

Suggested parameters:

```ts
type PiboRunListParams = {
  includeConsumed?: boolean;
  includeDetached?: boolean;
};
```

`pibo_run_status` returns one run snapshot.

`pibo_run_wait` waits for a bounded time. Timeout is a normal result, not a failure.

```json
{
  "runId": "run_123",
  "status": "running",
  "timedOut": true
}
```

`pibo_run_read` returns the terminal result or error details. Reading a tracked completed run marks it consumed.

`pibo_run_cancel` cancels the run if possible and marks it consumed for reminder purposes.

`pibo_run_ack` marks a run as intentionally seen. For a completed run, it suppresses future reminders without reading the full result. For a running run, it suppresses reminders until a later state change.

## Run Registry

The runtime needs an in-memory run registry.

Responsibilities:

- allocate stable `runId`
- store owner parent `sessionKey`
- store run kind, currently `tool`
- store completion policy
- store status
- store wrapped `toolName`
- store timestamps
- store compact summary
- store terminal result or error
- track whether the result was consumed
- support bounded wait
- support cancellation
- expose unconsumed tracked runs
- emit compact mailbox notifications when state changes
- resolve waiters when a run reaches a terminal state
- cancel owned running runs when the owner session or router is disposed
- prune detached terminal runs and consumed terminal tracked runs after short TTLs

Suggested statuses:

```text
queued
running
completed
failed
cancelled
```

Implemented shape:

```ts
type PiboRunRecord = {
  runId: string;
  kind: "tool";
  ownerSessionKey: string;
  toolName: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  completionPolicy: "tracked" | "detached";
  consumed: boolean;
  summary?: string;
  result?: unknown;
  error?: string;
  notifiedStatus?: "queued" | "running" | "completed" | "failed" | "cancelled";
  acknowledgedStatus?: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
```

## Mailbox

The mailbox is a small notification queue for each parent agent session. It should contain compact run updates, not full results.

Example completion notification:

```xml
<pibo_run_notification>
{"completed":[{"runId":"run_123","kind":"tool","toolName":"pibo_exec","status":"completed","summary":"pibo_exec run completed."}],"running":["run_456","run_789"]}
</pibo_run_notification>
```

Tracked runs create mailbox notifications. Notifications are compact service messages with a `<pibo_run_notification>` wrapper.

Detached runs do not create automatic mailbox notifications.

Mailbox entries should be coalesced where possible. If three runs finish while the parent is idle, the next follow-up turn should receive one compact snapshot, not three separate turns.

Notifications mark that the agent was told about the current state. They do not consume the run. A tracked run remains eligible for later turn-end reminders until the agent reads, cancels, or acknowledges it.

## Turn-End Safety

When a parent agent turn ends, the runtime must inspect the run registry for unconsumed tracked runs owned by that parent session.

If none exist, the turn can finish normally.

If tracked runs exist, the parent session becomes:

```text
idle_with_pending_runs
```

The runtime does not block indefinitely at turn end. Runs continue in the background.

The runtime arranges a compact reminder or later follow-up:

```text
Tracked runs still exist:
- completed: ready to read
- failed: ready to inspect
- running: still in progress
```

The agent can then choose to read, wait, cancel, ack, or continue.

## Follow-Up Scheduling

The scheduler keeps parent-agent turns sequential.

Rule:

```text
Only one active turn per parent session.
```

When a tracked run changes state:

```text
if parent session is idle:
  enqueue or start one follow-up turn with compact mailbox snapshot

if parent session is active:
  store mailbox notification only
  deliver it at the next safe turn boundary
```

If multiple runs complete while the parent is idle, they should be delivered together.

If a run completes while the parent is already processing another run result, the new completion should not be injected into the middle of that turn. It waits in the mailbox.

Service notifications do not immediately trigger another service notification. Natural parent turns can re-surface unconsumed tracked runs; `pibo_run_ack` suppresses reminders for the run's current state.

## Multiple Runs

Multiple yielded runs can be active at the same time.

Example:

```text
run_1 pibo_exec running
run_2 pibo_subagent_qa_researcher completed
run_3 pibo_subagent_qa_reviewer running
```

The next automatic follow-up should provide a compact snapshot:

```text
Completed:
- run_2: use pibo_run_read

Still running:
- run_1
- run_3
```

The agent may read `run_2`, wait for `run_1`, leave `run_3` running, or acknowledge any run it does not currently need.

## Tool Run Flow

Each yielded run maps to one wrapped tool call.

Start flow:

```text
1. Allocate runId.
2. Register run as running before starting the wrapped tool.
3. Start the wrapped tool in the background.
4. Return runId to parent agent.
```

Completion flow:

```text
1. Wrapped tool resolves or throws.
2. Registry updates run status to completed or failed.
3. Registry stores terminal result or error.
4. If completionPolicy is tracked, enqueue compact mailbox notification for ownerSessionKey.
5. Scheduler decides whether to start a follow-up turn now or defer.
```

## Fire-And-Forget

Detached runs are explicit fire-and-forget work.

Behavior:

- run is created and inspectable
- run can still be listed with `includeDetached: true`
- run can still be cancelled by `runId`
- completion does not notify the parent automatically
- turn-end safety ignores it
- cleanup may prune it earlier than tracked runs

Detached should be used only when the result is not needed by the parent agent.

## Cleanup

V1 uses simple in-memory cleanup.

Implemented defaults:

- keep consumed terminal tracked runs briefly for debugging, currently 5 minutes
- keep unconsumed terminal tracked runs until read, acked, cancelled, or router shutdown
- prune detached terminal runs after a short TTL, currently 1 minute
- cancel owned running runs when the owning session is disposed
- cancel all running runs when the router is disposed

Exact TTLs can be implementation constants until there is a product need for configuration.

## Agent Prompt Contract

The visible tool descriptions should teach the model these rules:

- Use yielded runs for long-running yieldable tool work.
- Use tracked runs when the result may matter later.
- Use detached only when the result is intentionally not needed.
- Use `pibo_run_read` to retrieve full results.
- Do not assume a wait timeout means failure.
- When reminded about runs, decide explicitly: read, wait, cancel, ack, or continue.

## Current Success Criteria

- A parent agent can start multiple yielded tool runs.
- The parent can continue after receiving each `runId`.
- The parent can list, wait, read, cancel, and ack runs.
- A completed tracked run does not paste full output into context automatically.
- A completed tracked run creates a compact notification.
- If the parent ends a turn after starting tracked runs, the runtime does not lose them.
- If multiple runs complete, notifications are coalesced and delivered sequentially.
- Detached runs do not create reminders or follow-up turns.
- Direct synchronous tool calls still work.
- Subagent tools can be called directly or yielded through `pibo_run_start`.

## Open Questions

- Should automatic follow-up turns remain service-message based, or should a future Pi hook expose a more explicit internal follow-up channel?
- Should `pibo_run_cancel` eventually propagate cancellation into wrapped tools that support cancellation?
- Should `pibo_run_ack` require a short reason for completed-but-unread tracked runs?
