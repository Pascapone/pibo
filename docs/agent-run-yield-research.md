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

## Current Pibo Decision

Pibo does not expose Codex-specific shell or lifecycle tools in the Codex compatibility profile. The profile uses the native Pibo Run package:

- `bash` is the shell-command tool.
- `pibo_run_*` tools own yielded run lifecycle.
- `pibo_subagent_*` tools own child-agent lifecycle.

The Codex implementation remains useful as a reference for behavior, not for model-visible names.

### Shell Runs

The Pibo `bash` tool should support the same practical workflow: start shell work, return quickly when it is still running, and allow later inspection through the run-control tools.

Relevant Codex files:

- `<HOME>/code/codex/codex-rs/tools/src/local_tool.rs`
- `<HOME>/code/codex/codex-rs/core/src/tools/handlers/unified_exec.rs`
- `<HOME>/code/codex/codex-rs/core/src/unified_exec/mod.rs`
- `<HOME>/code/codex/codex-rs/core/src/unified_exec/process_manager.rs`

Important details:

- `yield_time_ms` is clamped.
- running processes are stored in a process manager
- output is buffered
- later reads drain buffered output
- process IDs are released when processes exit
- cancellation and cleanup are owned by the process manager
- long output is truncated/capped

### Subagents

Pibo uses generated `pibo_subagent_*` tools and yielded runs for child-agent orchestration. The useful Codex behavior is bounded waiting, completion notifications, and resumable inspection. The Codex-specific lifecycle tool names are not part of the Pibo Codex-compat surface.

Relevant Codex files:

- `<HOME>/code/codex/codex-rs/tools/src/agent_tool.rs`
- `<HOME>/code/codex/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `<HOME>/code/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `<HOME>/code/codex/codex-rs/core/src/codex.rs`

Codex also has a mailbox/notification layer for subagent completion. When a child agent completes, Codex can enqueue a notification for the parent thread. This prevents completed child work from being lost if the parent does not immediately wait on the child work.

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

V1 started with subagent runs because Pibo already had routed sessions, `threadKey`, and event streams. V2 generalizes the same `runId` model to yieldable tools, including subagents and process-style tools such as Pi Coding Agent's `bash`.

Bash should be treated as a normal tool conceptually. Implementation-wise it still needs process-manager behavior: output buffering, exit codes, cancellation, and cleanup.

## What Must Not Happen

Long-running work must not disappear.

If an agent starts a run and then finishes its current turn before the run completes, the result still has to be discoverable later. It is not enough to return a handle once and rely on the model remembering forever.

Pibo needs both:

- explicit wait/status/read tools for agent control
- Pibo's native mailbox/notification callback so completed runs are surfaced later
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

- `bash_start`
- `bash_write`
- `pibo_run_wait`
- `pibo_run_status`
- `pibo_run_cancel`

The plugin should expose handles to the agent. It should not primarily expose gateway actions.

## Run Registry

Pibo likely needs an internal run registry in the runtime/tool layer.

Expected responsibilities:

- allocate stable `runId`
- store status
- store metadata such as kind, owner Pibo Session ID, child Pibo Session ID, event id, command, timestamps
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
{"runId":"run_123","kind":"tool","toolName":"pibo_subagent_explorer","status":"completed","summary":"Yielded tool run completed. Use pibo_run_wait or pibo_run_read for details."}
</pibo_run_notification>
```

The notification should be small. It should not inject full stdout, full browser scrape results, or long subagent answers automatically. The agent should use a tool to retrieve details.

This solves the forgetfulness problem without flooding context.

Pibo's native mailbox should cover two related cases:

- completion notification: a run finishes while the agent is still active or before the next turn
- unconsumed-run reminder: the agent turn ends while one or more runs are still running or already completed but not consumed

The reminder is important because the system cannot rely on the agent to remember every `runId`. At turn end, Pibo should inspect the run registry for runs owned by that session that are not consumed. If any exist, the runtime should arrange a compact follow-up message for the agent, either immediately if the run is complete or later when it completes.

Example reminder:

```xml
<pibo_run_notification>
{"runId":"run_123","kind":"tool","toolName":"bash","status":"running","summary":"A yielded tool run started earlier is still running. Continue other work or use pibo_run_wait when blocked."}
</pibo_run_notification>
```

Example completion:

```xml
<pibo_run_notification>
{"runId":"run_123","kind":"tool","toolName":"pibo_subagent_explorer","status":"completed","summary":"A yielded tool run completed. Use pibo_run_read for the result or pibo_run_wait to consume the terminal result."}
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
- Pibo Session ID based inspectability

The current async mode returns `piboSessionId` and `eventId`, but yielded child-agent work should additionally get a structured run handle and use the normal Pibo mailbox callback for completion delivery.

The improved model should:

- register a run before starting the child message
- associate the run with child `piboSessionId` and `eventId`
- complete/fail the run when the child produces a correlated assistant result or error
- put a completion notification into the parent agent mailbox through the normal Pibo callback
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

Pi Coding Agent's `bash` is the process-style yieldable tool. It covers command execution with bounded output, exit code reporting, timeout handling, process-tree cleanup, streaming updates, and full-output access when truncated. Future process tools can add stdin support if a real workflow requires it.

## Things Codex Does Well

- separates start from wait
- uses bounded waits instead of hard global timeouts
- lets the agent decide when to wait again
- treats timeout as a normal state
- stores handles for ongoing work
- uses Pibo's native mailbox path for subagent completion
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
- `piboSessionId` only for Pibo routed sessions
- `threadKey` only for subagent conversation continuity

## Open Questions

- Should future yieldable tools expose cancellation hooks beyond marking a run cancelled?
- Should `pibo_run_wait` return full result content, or only status plus a pointer to `pibo_run_read`?
- Should run notifications trigger a follow-up turn automatically, or only become visible on the next user/agent turn?
- What exact hook should inspect unconsumed runs when an agent turn ends?
- What are the cleanup rules for abandoned runs?
- Which process tools need stdin support beyond `bash`?
- How should nested yielded subagent tool calls be represented in notifications?
- no gateway-first API
- no persistence

This gives Pibo the intended control loop: the agent can start work, continue independently, wait only when blocked, and still receive a compact callback if it forgets to consume a run. It avoids copying the complexity of Codex unified exec before it is needed.
