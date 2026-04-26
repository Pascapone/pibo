# Agent Run Yield Research

This document captures the current findings about long-running agent tools, Codex-style yielding, and how the idea should translate into Pibo. It is intentionally a research note, not an implementation spec.

Implementation spec and V1 status live in `docs/agent-run-yield-spec.md`.

## Core Problem

Some agent work takes longer than a single convenient tool call:

- terminal commands that keep running
- browser automation or scraping jobs
- subagents or agent teams
- long validation, indexing, or background workflows

The agent should be able to start this work, wait for an initial window, continue with other useful work if it is still running, and later decide whether to wait again, inspect status, debug, or cancel.

The important boundary is that this is agent tooling, not gateway behavior. The gateway receives messages and execution requests from channels. The yield mechanism belongs in the Pi Coding Agent tool catalog exposed to the agent.

The target behavior is not "keep an LLM tool call open while the model keeps thinking". Current provider tool-calling APIs do not work that way. The target behavior is "return a handle quickly, let the agent continue, and make the runtime responsible for tracking the handle until the result is consumed or cleaned up".

## What Codex Does

Codex has two related patterns.

### Unified Exec

Codex exposes:

- `exec_command`
- `write_stdin`

`exec_command` starts a command and waits for `yield_time_ms`. If the command exits within that window, Codex returns the output and exit code. If it keeps running, Codex stores the process and returns a `session_id`.

The agent can later call `write_stdin` with the `session_id`. Passing empty input is effectively a poll/wait. Passing input interacts with the running process.

Relevant Codex files:

- `/home/pibo/code/codex/codex-rs/tools/src/local_tool.rs`
- `/home/pibo/code/codex/codex-rs/core/src/tools/handlers/unified_exec.rs`
- `/home/pibo/code/codex/codex-rs/core/src/unified_exec/mod.rs`
- `/home/pibo/code/codex/codex-rs/core/src/unified_exec/process_manager.rs`

Important details:

- `yield_time_ms` is clamped.
- running processes are stored in a process manager
- output is buffered
- later reads drain buffered output
- process IDs are released when processes exit
- cancellation and cleanup are owned by the process manager
- long output is truncated/capped

### Subagents

Codex exposes:

- `spawn_agent`
- `wait_agent`
- `send_input`
- `close_agent`

`spawn_agent` starts an agent and returns an identifier. `wait_agent` waits for a bounded time. If nothing is ready, it returns a timeout result rather than failing. The agent can later wait again.

Relevant Codex files:

- `/home/pibo/code/codex/codex-rs/tools/src/agent_tool.rs`
- `/home/pibo/code/codex/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `/home/pibo/code/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `/home/pibo/code/codex/codex-rs/core/src/codex.rs`

Codex also has a mailbox/notification layer for subagent completion. When a child agent completes, Codex can enqueue a notification for the parent thread. This prevents completed child work from being lost if the parent does not immediately call `wait_agent`.

Relevant concepts:

- `SUBAGENT_NOTIFICATION`
- mailbox sequence subscription
- deferred mailbox delivery
- next-turn injection

## Important Mental Model

A model cannot keep reasoning while one of its tool calls is still open. A tool call with `yield_time_ms: 300000` blocks the model for up to five minutes.

Parallelism only appears after a tool call returns a handle:

1. Agent starts work with a short initial wait.
2. Tool returns either a completed result or a running handle.
3. Agent continues other work.
4. Agent later calls a wait/status/read tool with the handle.

This means Pibo should encourage short initial waits for side work. Long waits are still useful when the agent is blocked and explicitly chooses to wait.

This is a general provider/API limitation, not just a Codex implementation detail. OpenAI, Anthropic, and Gemini all expose the same broad client-tool pattern:

1. The model emits one or more tool calls.
2. The application executes those calls.
3. The application sends tool results back in a later model input.
4. The model continues from those results.

"Parallel tool use" in provider APIs means the model may request multiple independent tool calls in one turn so the application can execute them concurrently. It does not mean the same model inference continues generating while one client-side tool call is still pending.

OpenAI background mode is also different from this feature. It can run a long model response asynchronously and let the application poll the response object, but it does not solve client-side tool execution returning into an already-running reasoning step.

## Target Pibo Behavior

Pibo should support three execution shapes:

- synchronous tool execution: the agent calls a tool and waits for the direct result
- parallel synchronous execution: the agent emits multiple independent tool calls and the tool runner executes them concurrently before the next model step
- asynchronous run execution: the agent starts a run, receives a `runId`, continues working, and later waits, reads status, reads output, or cancels

The asynchronous run flow should look like this:

1. Agent starts long-running work with a run tool.
2. The tool returns quickly with a `runId` and a compact status.
3. The agent continues any useful independent work.
4. If later work depends on the run result, the agent calls `pibo_run_wait` with a bounded timeout.
5. If `pibo_run_wait` times out, the agent can either continue other work or wait again.
6. When the run completes, the result is stored in the run registry until the agent consumes it or cleanup rules remove it.

The agent remains in control of the explicit workflow. It decides whether to start a run, how long to wait, whether to poll status, whether to do other work first, and whether to cancel.

The runtime still has to provide a safety net. Agents can forget handles, stop early, hit context pressure, or fail to check a run before ending a turn. A run must therefore not depend only on the model remembering to call `pibo_run_wait`.

## Run Kinds

The same run-control concept applies to multiple kinds of long-running work:

- subagent tool calls
- generic yieldable tool calls
- bash or process tool calls

V1 started with subagent runs because Pibo already had routed sessions, `threadKey`, and event streams. V2 generalizes the same `runId` model to yieldable tools, including subagents and process-style tools such as `pibo_exec`.

Bash should be treated as a normal tool conceptually. Implementation-wise it still needs process-manager behavior: output buffering, exit codes, cancellation, and cleanup.

## What Must Not Happen

Long-running work must not disappear.

If an agent starts a run and then finishes its current turn before the run completes, the result still has to be discoverable later. It is not enough to return a handle once and rely on the model remembering forever.

Pibo needs both:

- explicit wait/status/read tools for agent control
- a lightweight mailbox/notification path so completed runs are surfaced later
- turn-end tracking so unconsumed runs are not silently forgotten

## Pibo Direction

The right shape is a plugin that registers Pi tools. The plugin owns run orchestration for the capabilities it exposes.

Possible plugin name:

- `pibo.async-runs`
- `pibo.run-control`

Implemented tools:

- `pibo_run_start`
- `pibo_run_wait`
- `pibo_run_status`
- `pibo_run_read`
- `pibo_run_cancel`
- `pibo_run_ack`
- `pibo_run_read`
- `pibo_run_cancel`

For processes later:

- `pibo_exec_start`
- `pibo_exec_write`
- `pibo_run_wait`
- `pibo_run_status`
- `pibo_run_cancel`

The plugin should expose handles to the agent. It should not primarily expose gateway actions.

## Run Registry

Pibo likely needs an internal run registry in the runtime/tool layer.

Expected responsibilities:

- allocate stable `runId`
- store status
- store metadata such as kind, owner session, child session key, event id, command, timestamps
- hold buffered result or output summary
- support wait with timeout
- support status snapshot
- support result consumption tracking
- support cancellation
- emit or enqueue completion notifications
- expose unconsumed runs for turn-end safety checks

V1 can be in-memory only. Persistence can be added later if a concrete need appears.

Suggested status values:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

Timeout is not a failure. A wait timeout should return a normal result like:

```json
{
  "status": "running",
  "timedOut": true
}
```

## Mailbox / Notification

When a run completes, Pibo should enqueue a compact notification for the owning agent session.

Example:

```xml
<pibo_run_notification>
{"runId":"run_123","kind":"tool","toolName":"pibo_subagent_qa_researcher","status":"completed","summary":"Yielded tool run completed. Use pibo_run_wait or pibo_run_read for details."}
</pibo_run_notification>
```

The notification should be small. It should not inject full stdout, full browser scrape results, or long subagent answers automatically. The agent should use a tool to retrieve details.

This solves the forgetfulness problem without flooding context.

The mailbox should cover two related cases:

- completion notification: a run finishes while the agent is still active or before the next turn
- unconsumed-run reminder: the agent turn ends while one or more runs are still running or already completed but not consumed

The reminder is important because the system cannot rely on the agent to remember every `runId`. At turn end, Pibo should inspect the run registry for runs owned by that session that are not consumed. If any exist, the runtime should arrange a compact follow-up message for the agent, either immediately if the run is complete or later when it completes.

Example reminder:

```xml
<pibo_run_notification>
{"runId":"run_123","kind":"tool","toolName":"pibo_exec","status":"running","summary":"A yielded tool run started earlier is still running. Continue other work or use pibo_run_wait when blocked."}
</pibo_run_notification>
```

Example completion:

```xml
<pibo_run_notification>
{"runId":"run_123","kind":"tool","toolName":"pibo_subagent_qa_researcher","status":"completed","summary":"A yielded tool run completed. Use pibo_run_read for the result or pibo_run_wait to consume the terminal result."}
</pibo_run_notification>
```

Whether this notification should automatically trigger a follow-up turn or only be injected into the next natural turn is an implementation question. The design requirement is that completed or still-running runs remain visible without trusting the model's memory.

## Gateway Boundary

The gateway should not be the primary control surface for this feature.

The gateway can still observe or debug runs later if needed, but the core interaction is:

```text
Pi agent
  -> Pibo run tools
  -> Run registry / process manager / subagent router
  -> tool result back to the agent
```

Channels and web apps may display run state eventually, but they should not own the execution model.

## Subagent Integration

Current Pibo subagents already have:

- generated tools
- `sync` and `async` modes
- routed sessions
- `threadKey`
- session-key based inspectability

The current async mode returns `sessionKey` and `eventId`, but it does not provide a structured wait handle or mailbox guarantee.

The improved model should:

- register a run before starting the child message
- associate the run with child `sessionKey` and `eventId`
- complete/fail the run when the child produces a correlated assistant result or error
- put a completion notification into the parent agent mailbox
- allow `pibo_run_wait` to retrieve the child result

## Process Integration

Process execution is more complex than subagents.

A Codex-like process runner needs:

- child process lifecycle
- stdout/stderr buffering
- output caps
- stdin interaction
- exit code tracking
- cancellation
- cleanup/pruning of old processes
- sandbox/approval policy if commands can mutate the system

`pibo_exec` is the first process-style yieldable tool. It covers command execution with bounded output, exit code reporting, timeout handling, and run-registry storage. Future process tools can add streaming output or stdin support if a real workflow requires it.

## Things Codex Does Well

- separates start from wait
- uses bounded waits instead of hard global timeouts
- lets the agent decide when to wait again
- treats timeout as a normal state
- stores handles for ongoing work
- has a mailbox path for subagent completion
- keeps full results out of automatic notifications
- supports interactive process sessions

## Things To Be Careful With

Codex has separate implementations for process yielding and subagent waiting. For Pibo, a small shared run registry could reduce duplication, but only if it stays simple.

Potential pitfalls:

- over-generalizing the run abstraction too early
- injecting large results into context
- losing completed runs after turn end
- relying on the agent to remember every `runId`
- confusing provider parallel tool calls with asynchronous run handles
- making gateway actions the main interface
- giving all profiles async tools even when not needed
- not cleaning up abandoned runs
- ambiguous naming between Pi sessions, Pibo sessions, process sessions, and run handles

## Naming Notes

Avoid calling this `session yield` in Pibo internals. `Session` already means too many things:

- Pi session
- Pibo routed session
- browser session
- process session
- subagent session

Use:

- `runId` for the generic handle
- `processId` only for process-specific execution
- `sessionKey` only for Pibo routed sessions
- `threadKey` only for subagent conversation continuity

## Open Questions

- Should future yieldable tools expose cancellation hooks beyond marking a run cancelled?
- Should `pibo_run_wait` return full result content, or only status plus a pointer to `pibo_run_read`?
- How much mailbox behavior can be implemented cleanly with the current Pi SDK hooks?
- Should run notifications trigger a follow-up turn automatically, or only become visible on the next user/agent turn?
- What exact hook should inspect unconsumed runs when an agent turn ends?
- What are the cleanup rules for abandoned runs?
- Which process tools need streaming output or stdin support beyond `pibo_exec`?
- How should nested yielded subagent tool calls be represented in notifications?
- no gateway-first API
- no persistence

This gives Pibo the intended control loop: the agent can start work, continue independently, wait only when blocked, and still receive a compact callback if it forgets to consume a run. It avoids copying the complexity of Codex unified exec before it is needed.
