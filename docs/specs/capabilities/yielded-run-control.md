# Spec: Yielded Run Control

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-08-25
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`

## Why

Agents often need to start work that may take longer than a useful model turn: shell commands, delegated subagents, browser checks, or other yieldable tools. Pibo needs a product-level lifecycle for that work so the parent agent can continue, inspect progress, wait when blocked, read terminal results, or cancel work safely.

Yielded run control keeps this lifecycle inside Pibo's product boundary. The Pi Coding Agent still executes tools, but Pibo owns run ids, stewardship, reminders, persistence, cancellation semantics, and profile-level exposure through the `pibo-run-control` capability package.

## Goal

Pibo MUST expose a session-managed run-control tool package that starts yieldable tools in the background and lets the same owning Pibo Session list, inspect, wait for, read, acknowledge, or cancel those runs.

## Background / Current State

The current implementation defines `PiboRunRegistry` in `src/runs/registry.ts`, generated `pibo_run_*` tool definitions in `src/runs/tools.ts`, runtime integration in `src/core/runtime.ts`, session-router integration in `src/core/session-router.ts`, and durable storage in `src/reliability/store.ts`.

## Decision: Run-reminder turns keep the full active toolset (2026-08)

This decision supersedes the earlier attempt to capability-scope run-reminder service turns. Do not reintroduce it.

- **Never strip an awake agent's tools.** A run-reminder turn MUST retain the same active agent toolset as the session it serves (Bash, file tools, browser, Goal tools, subagents, `pibo_run_start`, and run-control tools). The agent must be able to write, use Bash, and manage its runs while handling a reminder.
- **Do not cap by capability.** The previous guard that reduced run-reminder turns to only `pibo_run_status/wait/read/cancel/ack` is deprecated. It caused a hard tool-loss failure (see context-guard resume inheriting the narrowed scope) that froze sessions and dead-ended tasks. Revoking tools is not an acceptable control.
- **Bound autonomously, do not hobble.** An autonomous wake-up is bounded by deterministic per-turn limits (max tool executions, provider rounds, total tokens, a 15-minute wall-clock duration, repeated identical calls) that trip a `run_reminder_limit_exceeded` abort, and by causal provenance binding that keeps the turn tied to its originating Goal run. These bounds stop runaway loops without removing legitimate tools.
- **Turn bounds are not run deadlines.** Reminder-turn limits stop only the autonomous service turn. They do not cancel or time out the wrapped yielded run or a delegated child request, which may continue after the reminder turn ends.
- **Security is via causal scope, not tool denial.** The legitimate risk from an auto-triggered wake-up is autonomous drift after the originating Goal ends. That is controlled by revalidating the turn against active Goal authority and by refusing to reactivate paused or terminal Goals, not by hiding the toolset.

This is the standing product decision. Any future change that proposes to withhold Bash or other tools inside a reminder turn must be reviewed as a regression of this decision.

The capability catalog exposes one package named `pibo-run-control`. When a profile enables it and has yieldable tools, the runtime adds `pibo_run_start`, `pibo_run_list`, `pibo_run_status`, `pibo_run_wait`, `pibo_run_read`, `pibo_run_cancel`, and `pibo_run_ack`. Pibo also auto-enables this management surface when delegated agents are available because delegated sends are yielded-only.

## Scope

### In Scope

- The `pibo-run-control` capability package and its generated agent-facing tools.
- Starting yieldable tool calls as yielded runs.
- Session-managed run listing, status, bounded waiting, terminal reading, acknowledgement, and cancellation.
- Tracked and detached completion policies.
- Compact service reminders for tracked runs.
- Durable run records and interrupted-run recovery when a reliability store is attached.
- Controller-session cleanup and router disposal behavior.

### Out of Scope

- A user-facing Chat Web run management panel beyond existing trace/session output behavior.
- Distributed execution of yielded runs in a separate worker process.
- Guaranteed cancellation of underlying OS processes beyond Pibo's recorded run cancellation.
- Retrying arbitrary yieldable tools by default.
- Changing the synchronous behavior of tools that are called directly instead of through `pibo_run_start`, except that delegated send is intentionally no longer directly exposed.

## Requirements

### Requirement: Run-control tools are exposed as one package

The system MUST expose run control through the `pibo-run-control` capability package, not as unrelated individual profile toggles.

#### Current

`PiboPluginRegistry.getCapabilityCatalog()` returns a package named `pibo-run-control`, and profile/runtime code uses `toolPackages.runControl` to decide whether to generate `pibo_run_*` tools.

#### Target

A profile that enables run control can start and manage yielded runs. A profile with available delegated agents receives the run-management tools automatically so it can start the yielded-only send target. Other profiles that do not enable run control do not receive these tools except through compatibility profiles that explicitly enable the package.

#### Acceptance

- The capability catalog lists `pibo-run-control` with all seven `pibo_run_*` tool names.
- Runtime tool generation adds run-control tools when run control is enabled and yieldable tools exist, or when a delegated send target is available.
- Profile inspection can list the tools but MUST NOT execute run-control operations.

#### Scenario: Agent profile enables run control

- GIVEN a profile enables `toolPackages.runControl`
- AND the profile has at least one yieldable tool
- WHEN Pibo creates the runtime
- THEN the runtime exposes `pibo_run_start`, `pibo_run_list`, `pibo_run_status`, `pibo_run_wait`, `pibo_run_read`, `pibo_run_cancel`, and `pibo_run_ack`.

### Requirement: Starting a yielded run returns an managed run id

`pibo_run_start` MUST start exactly one selected yieldable tool call and return a run snapshot managed by the current Pibo Session.

#### Current

`createRunToolDefinitions()` builds `pibo_run_start` with a `toolName` enum derived from visible yieldable tools. `PiboSessionRouter.createRunToolController()` records the run in `PiboRunRegistry` under the parent Pibo Session id and executes the wrapped tool asynchronously.

#### Target

The parent agent receives a `runId` immediately and uses later run-control calls to manage the background work.

#### Acceptance

- `toolName` accepts only yieldable tool names visible to the current profile.
- The run id begins with `run_`.
- The initial status is `running` unless recovered durable state says otherwise.
- The run stores the owning Pibo Session id, tool name, completion policy, timestamps, and summary.
- Direct calls to ordinary yieldable tools remain synchronous and do not create yielded run records.
- Delegated send is not a direct runtime tool; its run ID is its request ID.

#### Scenario: Start a background subagent or shell task

- GIVEN a parent Pibo Session has run control and a yieldable tool
- WHEN the agent calls `pibo_run_start` with that tool name and arguments
- THEN Pibo returns a run snapshot for the parent session
- AND the wrapped tool executes without blocking the parent turn on its terminal result.

### Requirement: Run access is scoped to the owning Pibo Session

The system MUST allow only the run controller Pibo Session to inspect, read, acknowledge, wait for, or cancel a run through the run-control controller.

#### Current

`PiboRunRegistry.requireById()` rejects unknown run ids and run ids managed by a different Pibo Session.

#### Target

A run id is not a global capability for other sessions. Cross-session inspection requires lower-level diagnostic code, not agent-facing run-control tools.

#### Acceptance

- `pibo_run_status` for another session's run fails.
- `pibo_run_read` for another session's run fails.
- `pibo_run_cancel` for another session's run fails.
- `pibo_run_list` returns only runs managed by the current Pibo Session.

#### Scenario: Child cannot read parent run

- GIVEN a parent session owns `run_A`
- AND a child session has its own run-control tools
- WHEN the child calls `pibo_run_read` for `run_A`
- THEN Pibo rejects the call as an unknown run for that child session.

### Requirement: Tracked runs create compact reminders until handled

Tracked runs MUST produce compact service reminders when their state needs agent attention, and reminders MUST stop when the run is read, cancelled, or acknowledged for its current state.

#### Current

`PiboRunRegistry.createNotification()` groups tracked runs by `completed`, `failed`, `cancelled`, and `running`. `PiboSessionRouter` sends a service message wrapped in `<pibo_run_notification>` with run ids, tool names, statuses, summaries, and instructions.

#### Target

The model sees enough information to decide whether to wait, read, cancel, acknowledge, or ignore for now without flooding context with full tool output.

#### Acceptance

- Tracked is the default completion policy.
- A tracked running run can notify once for the current state unless turn-end reminders intentionally include already-notified runs.
- Completion, failure, or cancellation creates a new notifiable state.
- `pibo_run_read` consumes terminal runs and suppresses future reminders.
- `pibo_run_ack` suppresses reminders for the current state; if the run is terminal, it also marks the run consumed.
- Reminder text contains compact metadata only; full results require `pibo_run_read`.

#### Scenario: Tracked run completes after initial notification

- GIVEN a tracked run has already produced a running reminder
- WHEN the wrapped tool completes
- THEN Pibo emits a new completed reminder
- AND the reminder instructs the agent to call `pibo_run_read` for the result.

### Requirement: Run-reminder turns retain the full active toolset

A run-reminder service turn MUST run with the same active agent toolset as the session it serves. It MUST be able to write files, use Bash, invoke browser/MCP tools, subagents, Goal tools, and start runs while handling a reminder.

#### Current

An earlier guard narrowed reminder turns to the five run-management tools (`pibo_run_status/wait/read/cancel/ack`). This caused a hard tool-loss failure after context-guard resume and is being removed.

#### Target

Reminders keep the full toolset and are instead bounded by deterministic per-turn limits (max tool executions, provider rounds, total tokens, duration, repeated identical calls) that abort with `run_reminder_limit_exceeded`, and by causal provenance that revalidates the turn against active Goal authority.

#### Acceptance

- A run-reminder turn exposes the same tools as the owning session (including Bash and write tools).
- Reminder turns are never capability-scoped; the toolset is not narrowed.
- An out-of-control reminder turn stops via `run_reminder_limit_exceeded`, not by having its tools removed.
- A run reminder whose originating Goal is no longer active cannot resume the old objective.
- No reminder turn can create new runs purely from a `<pibo_run_notification>` without causal authority.

#### Scenario: Agent keeps Bash while acknowledging a reminder

- GIVEN a tracked run has completed
- WHEN the run-reminder turn processes the notification
- THEN the turn can still call `bash`, `pibo_run_read`, and write tools
- AND the turn reaches a bounded terminal state without losing its toolset.

### Requirement: Detached runs are inspectable but do not remind

Detached runs MUST be available for explicit inspection while never producing automatic reminders.

#### Current

`needsNotification()` excludes runs whose completion policy is not `tracked`. Default listing excludes detached runs unless `includeDetached` is true.

#### Target

Detached is reserved for intentional fire-and-forget work. Agents can still list or inspect detached runs when they opt in.

#### Acceptance

- `pibo_run_start` accepts `completionPolicy: "detached"`.
- Detached runs do not create pending notifications while running or terminal.
- `pibo_run_list` excludes detached runs by default.
- `pibo_run_list` with `includeDetached: true` includes detached runs managed by the current session.
- `pibo_run_status` can inspect a known detached run id while the record remains available.

#### Scenario: Fire-and-forget background work

- GIVEN the agent intentionally starts a detached yielded run
- WHEN the run finishes
- THEN no service reminder is queued
- AND the agent can still inspect it by id or list it with `includeDetached: true` before pruning removes it.

### Requirement: Waiting is bounded and timeout is normal

`pibo_run_wait` MUST wait only up to a bounded timeout and MUST report timeout as ordinary run state, not as tool failure. Omitting `timeoutMs` waits for 30000 ms; every call is capped at 300000 ms.

#### Current

The generated tool defaults `timeoutMs` to 30000 ms. `PiboRunRegistry.wait()` clamps it to at most 300000 ms and returns `timedOut: true` when the run is still non-terminal after the wait.

#### Target

Agents can block briefly when dependent on a run, then continue other work if the wait times out.

#### Acceptance

- Waiting on an already terminal run returns immediately with `timedOut: false`.
- Waiting on a running run resolves with `timedOut: false` when the run becomes terminal before timeout.
- Waiting on a still-running run after timeout returns the current run snapshot with `timedOut: true`.
- Omitting `timeoutMs` waits for 30000 ms.
- Wait timeout never cancels or changes the lifetime of the wrapped tool, including a delegated child request that continues for hours.
- Requested timeouts above 300000 ms are clamped to 300000 ms.

#### Scenario: Long command is still running

- GIVEN a yielded run is running
- WHEN the agent calls `pibo_run_wait` with a short timeout
- THEN the tool returns the run snapshot with `timedOut: true`
- AND the agent can call wait again later or continue other work.

### Requirement: Execution timeouts are durable and distinct

A yielded run with a recognized execution-timeout argument MUST persist that timeout at start and MUST use terminal status `timed_out` when the wrapped tool reaches it. Timeout classification MUST remain distinct from a bounded `pibo_run_wait` timeout, which leaves the run active. `pibo_agents_send_message` has no execution-timeout argument, and legacy `SubagentProfile.timeoutMs` data MUST NOT be copied into the yielded run.

#### Acceptance

- `pibo_run_start` persists and returns `timeoutMs` and `timeoutAt` when the selected tool has a recognized configured timeout argument.
- A delegated send started through `pibo_run_start` has no implicit `timeoutMs` or `timeoutAt`; their absence is expected even for multi-hour work.
- A configured execution timeout ends with status `timed_out`, not `failed`.
- Timeout metadata records whether startup was unconfirmed (`startup`) or output proved successful startup before lifetime expiry (`lifetime`).
- Notifications, status, list, read, debug output, signals, and trace projections preserve the timeout status and metadata.
- A known long-lived foreground service command started with a finite timeout produces an immediate warning.

#### Managed service lifecycle

Do not use a finite foreground yielded Bash run as the owner of a gateway or similar daemon. On the host, manage gateways through `pibo gateway web|dev start/status/restart`. In a disposable Docker worker, launch the service as a detached/background process and validate it with a separate bounded health check; the short startup check may be tracked, while the daemon itself must not depend on the lifetime of a bounded foreground tool call.

### Requirement: Terminal results are read explicitly

`pibo_run_read` MUST return the result or error details for a terminal run and mark terminal tracked runs consumed.

#### Current

The registry stores successful results as `PiboToolRunResult` and failures as error text. `read()` adds `result` or `error` to the snapshot and marks terminal records consumed.

#### Target

Large or sensitive terminal output is pulled only when the agent asks for it, while compact reminders stay small.

#### Acceptance

- Reading a completed run returns the stored result text and details when present.
- A delegated-send result contains the complete final assistant message plus request, agent, thread, and event identity.
- A Bash result follows Pi's bounded inline-output contract and retains `fullOutputPath` details when complete output was externalized.
- Reading a failed run returns the stored error.
- Reading a non-terminal run returns a snapshot without a terminal result and does not imply completion.
- Reading a terminal run sets `consumed: true` and suppresses future tracked reminders.

#### Scenario: Read completed result

- GIVEN a tracked run completed with text output
- WHEN the controller calls `pibo_run_read`
- THEN the response contains that text
- AND later notifications no longer include that run.

### Requirement: Cancellation records terminal state and suppresses reminders

`pibo_run_cancel` MUST propagate cancellation to the active yieldable tool, wait for bounded settlement, and only then mark a non-terminal run cancelled and consumed. Delegated sends MUST cancel their exact message event rather than aborting unrelated work on the shared child session.

#### Current

The run controller invokes the cancellation handler captured by `pibo_run_start` before changing explicit-cancel state. The handler aborts the active tool signal, terminates any dedicated systemd unit, and waits a bounded interval for execution settlement. A delegated handler removes or aborts its exact queued or active child message and waits for that message to settle.

#### Target

A successful cancellation response means Pibo has stopped the requested cancellable execution and released its gateway work admission, not merely changed stored run status. Negative cancellation acknowledgement and bounded-settlement failure remain explicit errors and MUST NOT be reported as successful cancellation.

#### Acceptance

- Cancelling a running run returns status `cancelled`.
- The cancelled run is marked consumed.
- Waiters on the run resolve with `timedOut: false` and status `cancelled`.
- Cancelling a terminal run leaves it terminal and consumed.
- Cancellation fails explicitly if execution does not settle within the bounded cleanup interval.
- A rejected child abort fails explicitly and the run is not stored as successfully cancelled.
- Cancelling one queued delegated request does not abort another active request on the same child session or dispatch the cancelled request later.
- Disposing or killing a controller session, disposing a session subtree, and disposing the router enumerate active runs without mutating them, then persist and publish `cancelled` only after each run's cancellation and execution settlement is confirmed.
- Rejected or bounded non-settling teardown cancellation leaves the run non-cancelled, does not release waiters as cancelled, and does not emit a cancelled notification.

#### Scenario: Controller session is disposed

- GIVEN a session has running yielded runs
- WHEN the router disposes that session or executes kill-all behavior for it
- THEN Pibo first waits for bounded confirmed cancellation settlement
- AND only successful settlements become cancelled and stop future reminders.

### Requirement: Durable stores recover interrupted runs conservatively

When a reliability store is attached, run-control MUST persist run records and recover interrupted running runs on registry startup.

#### Current

`PiboReliabilityStore.createRun()` writes `pibo_runs` rows and an associated `runs` queue job. `PiboRunRegistry` loads persisted runs and calls `recoverInterruptedRuns()` during construction. Non-retryable interrupted runs become failed; retryable runs can be queued for retry.

#### Target

A process restart does not leave inspectable run records permanently stuck in `running` when their job claim has expired.

#### Acceptance

- Starting a run writes a durable `pibo_runs` record when the store is attached.
- Completed, failed, cancelled, acknowledged, and consumed states are persisted.
- On startup, unexpired claimed running runs remain running.
- Expired non-retryable running runs become failed with an interruption error.
- Retryable interrupted runs may become queued only when explicitly marked retryable with more than one allowed attempt.

#### Scenario: Gateway process dies during a background run

- GIVEN a run was persisted as running
- AND its durable job claim has expired after process death
- WHEN a new registry starts with the same reliability store
- THEN the run is recovered as failed unless it was explicitly retryable.

### Requirement: Terminal run records are pruned after policy-specific TTLs

The registry MUST prune only terminal records that no longer need normal agent attention.

#### Current

`PiboRunRegistry.prune()` removes detached terminal runs after the detached TTL and consumed tracked terminal runs after the consumed TTL. Unconsumed tracked terminal runs remain available for reminder and read.

#### Target

Run state stays small without losing unread tracked results.

#### Acceptance

- Running runs are not pruned.
- Unconsumed tracked terminal runs are not pruned.
- Consumed tracked terminal runs are pruned after the consumed terminal TTL.
- Detached terminal runs are pruned after the detached terminal TTL.
- Store-backed registries also prune matching durable records.

#### Scenario: Unread completed run remains available

- GIVEN a tracked run completed but has not been read or acknowledged
- WHEN pruning runs
- THEN Pibo keeps that run so the controller can still receive reminders and read the result.

## Edge Cases

- A wrapped yieldable tool can return a structured error result instead of throwing; run-control MUST convert that into a failed yielded run when the tool result is marked as an error.
- A model may forget a run id; `pibo_run_list` MUST make unconsumed tracked runs discoverable for that session.
- A stale queued reminder can exist after the agent reads a run; router cleanup MUST remove queued service reminders that no longer describe pending run state.
- A session may own both tracked and detached runs; default list output MUST hide detached runs while keeping tracked work visible.
- Multiple runs can complete close together; reminders MAY coalesce them into one compact service message grouped by status.
- Cancellation cannot roll back an external side effect that already completed, but Pibo MUST NOT publish `cancelled` until the cancellable execution itself has confirmed termination.

## Constraints

- **Product Boundary:** Pibo owns run ids, lifecycle state, notifications, stewardship, and durable records. Pi tools remain the execution payload.
- **Security / Privacy:** Agent-facing run-control operations MUST be scoped by owning Pibo Session id. Run-reminder turns MUST keep the owner's full toolset; security comes from causal Goal binding and per-turn bounds, never from withholding Bash or other tools.
- **Compatibility:** Direct tool calls remain synchronous. Run control wraps tools only when `pibo_run_start` is used.
- **Context Economy:** Automatic reminders MUST stay compact and MUST NOT include full terminal output.
- **Reliability:** Store-backed recovery MUST prefer marking arbitrary interrupted runs failed over retrying unsafe side effects.

## Success Criteria

- [ ] SC-001: A run-control-enabled profile exposes all seven `pibo_run_*` tools when yieldable tools are available.
- [ ] SC-002: `pibo_run_start` returns a `run_` id and records stewardship by the current Pibo Session.
- [ ] SC-003: The controller can list, status, wait, read, acknowledge, and cancel its run; another session cannot.
- [ ] SC-004: Tracked runs produce compact reminders and stop reminding after read, cancel, or current-state acknowledgement.
- [ ] SC-005: Detached runs never remind and are hidden from default list output.
- [ ] SC-006: `pibo_run_wait` treats timeout as normal state and clamps excessive timeouts.
- [ ] SC-007: Store-backed interrupted non-retryable runs recover as failed rather than staying running forever.
- [ ] SC-008: Pruning removes only detached terminal runs or consumed tracked terminal runs after their TTLs.
- [ ] SC-009: Configured execution timeouts persist at start, terminate as `timed_out`, preserve startup-versus-lifetime classification, and warn for finite foreground service runs.

## Assumptions and Open Questions

### Assumptions

- The owning Pibo Session id is the correct authorization boundary for agent-facing run-control operations.
- Arbitrary yieldable tools are not safe to retry unless explicitly marked retryable by future code.
- Compact service reminders are the primary product UI for agents; human-facing run management can build on the same state later.

### Open Questions

- Should future cancellation propagate AbortSignal or process-level termination consistently to every yieldable tool?
- Should run-control expose per-tool retry declarations instead of the current conservative default?
- Should Chat Web show a dedicated yielded-run panel for humans, separate from trace nodes and service messages?
- Should terminal result retention be configurable per profile or per run?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Run-control tools are exposed as one package | Agent profile enables run control | `src/plugins/registry.ts`, `src/core/runtime.ts`, `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-002 Starting a yielded run returns an managed run id | Start a background subagent or shell task | `src/runs/tools.ts`, `src/core/session-router.ts`, `src/runs/registry.ts` | Implemented |
| REQ-003 Run access is scoped to the owning Pibo Session | Child cannot read parent run | `src/runs/registry.ts`, `src/core/session-router.ts` | Implemented |
| REQ-004 Tracked runs create compact reminders until handled | Tracked run completes after initial notification | `src/runs/registry.ts`, `src/core/session-router.ts`, `src/shared/trace-engine.ts` | Implemented |
| REQ-004b Run-reminder turns retain the full active toolset | Agent keeps Bash while acknowledging a reminder | `src/core/session-router.ts`, `src/agent-runtime/routed-session.ts` | In implementation |
| REQ-005 Detached runs are inspectable but do not remind | Fire-and-forget background work | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-006 Waiting is bounded and timeout is normal | Long command is still running | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-007 Terminal results are read explicitly | Read completed result | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-008 Cancellation records terminal state and suppresses reminders | Controller session is disposed | `src/runs/registry.ts`, `src/core/session-router.ts` | Implemented |
| REQ-009 Durable stores recover interrupted runs conservatively | Gateway process dies during a background run | `src/reliability/store.ts`, `src/runs/registry.ts` | Implemented |
| REQ-010 Terminal run records are pruned after policy-specific TTLs | Unread completed run remains available | `src/runs/registry.ts`, `src/reliability/store.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/runs.test.mjs`, `test/subagents.test.mjs`, `test/codex-compat.test.mjs`, `test/debug-cli.test.mjs`, `test/session-router-store.test.mjs`, and `test/web-channel.test.mjs`. Reminder toolset and run-reminder bound coverage lives in `test/session-quiescence.test.mjs` and `test/loop-turn-provenance.test.mjs`.
