# Spec: Yielded Run Control

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Current Pibo codebase  
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`

## Why

Agents often need to start work that may take longer than a useful model turn: shell commands, delegated subagents, browser checks, or other yieldable tools. Pibo needs a product-level lifecycle for that work so the parent agent can continue, inspect progress, wait when blocked, read terminal results, or cancel work safely.

Yielded run control keeps this lifecycle inside Pibo's product boundary. The Pi Coding Agent still executes tools, but Pibo owns run ids, ownership, reminders, persistence, cancellation semantics, and profile-level exposure through the `pibo-run-control` capability package.

## Goal

Pibo MUST expose a session-owned run-control tool package that starts yieldable tools in the background and lets the same owning Pibo Session list, inspect, wait for, read, acknowledge, or cancel those runs.

## Background / Current State

The current implementation defines `PiboRunRegistry` in `src/runs/registry.ts`, generated `pibo_run_*` tool definitions in `src/runs/tools.ts`, runtime integration in `src/core/runtime.ts`, session-router integration in `src/core/session-router.ts`, and durable storage in `src/reliability/store.ts`.

The capability catalog exposes one package named `pibo-run-control`. When a profile enables it and has yieldable tools, the runtime adds `pibo_run_start`, `pibo_run_list`, `pibo_run_status`, `pibo_run_wait`, `pibo_run_read`, `pibo_run_cancel`, and `pibo_run_ack`.

## Scope

### In Scope

- The `pibo-run-control` capability package and its generated agent-facing tools.
- Starting yieldable tool calls as yielded runs.
- Session-owned run listing, status, bounded waiting, terminal reading, acknowledgement, and cancellation.
- Tracked and detached completion policies.
- Compact service reminders for tracked runs.
- Durable run records and interrupted-run recovery when a reliability store is attached.
- Owner-session cleanup and router disposal behavior.

### Out of Scope

- A user-facing Chat Web run management panel beyond existing trace/session output behavior.
- Distributed execution of yielded runs in a separate worker process.
- Guaranteed cancellation of underlying OS processes beyond Pibo's recorded run cancellation.
- Retrying arbitrary yieldable tools by default.
- Changing the synchronous behavior of tools that are called directly instead of through `pibo_run_start`.

## Requirements

### Requirement: Run-control tools are exposed as one package

The system MUST expose run control through the `pibo-run-control` capability package, not as unrelated individual profile toggles.

#### Current

`PiboPluginRegistry.getCapabilityCatalog()` returns a package named `pibo-run-control`, and profile/runtime code uses `toolPackages.runControl` to decide whether to generate `pibo_run_*` tools.

#### Target

A profile that enables run control can start and manage yielded runs. A profile that does not enable run control does not receive these tools except through compatibility profiles that explicitly enable the package.

#### Acceptance

- The capability catalog lists `pibo-run-control` with all seven `pibo_run_*` tool names.
- Runtime tool generation adds run-control tools only when run control is enabled and yieldable tools exist.
- Profile inspection can list the tools but MUST NOT execute run-control operations.

#### Scenario: Agent profile enables run control

- GIVEN a profile enables `toolPackages.runControl`
- AND the profile has at least one yieldable tool
- WHEN Pibo creates the runtime
- THEN the runtime exposes `pibo_run_start`, `pibo_run_list`, `pibo_run_status`, `pibo_run_wait`, `pibo_run_read`, `pibo_run_cancel`, and `pibo_run_ack`.

### Requirement: Starting a yielded run returns an owned run id

`pibo_run_start` MUST start exactly one selected yieldable tool call and return a run snapshot owned by the current Pibo Session.

#### Current

`createRunToolDefinitions()` builds `pibo_run_start` with a `toolName` enum derived from visible yieldable tools. `PiboSessionRouter.createRunToolController()` records the run in `PiboRunRegistry` under the parent Pibo Session id and executes the wrapped tool asynchronously.

#### Target

The parent agent receives a `runId` immediately and uses later run-control calls to manage the background work.

#### Acceptance

- `toolName` accepts only yieldable tool names visible to the current profile.
- The run id begins with `run_`.
- The initial status is `running` unless recovered durable state says otherwise.
- The run stores the owning Pibo Session id, tool name, completion policy, timestamps, and summary.
- Direct calls to the same yieldable tool remain synchronous and do not create yielded run records.

#### Scenario: Start a background subagent or shell task

- GIVEN a parent Pibo Session has run control and a yieldable tool
- WHEN the agent calls `pibo_run_start` with that tool name and arguments
- THEN Pibo returns a run snapshot for the parent session
- AND the wrapped tool executes without blocking the parent turn on its terminal result.

### Requirement: Run access is scoped to the owning Pibo Session

The system MUST allow only the run owner Pibo Session to inspect, read, acknowledge, wait for, or cancel a run through the run-control controller.

#### Current

`PiboRunRegistry.requireById()` rejects unknown run ids and run ids owned by a different Pibo Session.

#### Target

A run id is not a global capability for other sessions. Cross-session inspection requires lower-level diagnostic code, not agent-facing run-control tools.

#### Acceptance

- `pibo_run_status` for another session's run fails.
- `pibo_run_read` for another session's run fails.
- `pibo_run_cancel` for another session's run fails.
- `pibo_run_list` returns only runs owned by the current Pibo Session.

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
- `pibo_run_list` with `includeDetached: true` includes detached runs owned by the current session.
- `pibo_run_status` can inspect a known detached run id while the record remains available.

#### Scenario: Fire-and-forget background work

- GIVEN the agent intentionally starts a detached yielded run
- WHEN the run finishes
- THEN no service reminder is queued
- AND the agent can still inspect it by id or list it with `includeDetached: true` before pruning removes it.

### Requirement: Waiting is bounded and timeout is normal

`pibo_run_wait` MUST wait only up to a bounded timeout and MUST report timeout as ordinary run state, not as tool failure.

#### Current

`PiboRunRegistry.wait()` clamps timeout to at most 300000 ms and returns `timedOut: true` when the run is still non-terminal after the wait.

#### Target

Agents can block briefly when dependent on a run, then continue other work if the wait times out.

#### Acceptance

- Waiting on an already terminal run returns immediately with `timedOut: false`.
- Waiting on a running run resolves with `timedOut: false` when the run becomes terminal before timeout.
- Waiting on a still-running run after timeout returns the current run snapshot with `timedOut: true`.
- Requested timeouts above 300000 ms are clamped to 300000 ms.

#### Scenario: Long command is still running

- GIVEN a yielded run is running
- WHEN the agent calls `pibo_run_wait` with a short timeout
- THEN the tool returns the run snapshot with `timedOut: true`
- AND the agent can call wait again later or continue other work.

### Requirement: Terminal results are read explicitly

`pibo_run_read` MUST return the result or error details for a terminal run and mark terminal tracked runs consumed.

#### Current

The registry stores successful results as `PiboToolRunResult` and failures as error text. `read()` adds `result` or `error` to the snapshot and marks terminal records consumed.

#### Target

Large or sensitive terminal output is pulled only when the agent asks for it, while compact reminders stay small.

#### Acceptance

- Reading a completed run returns the stored result text and details when present.
- Reading a failed run returns the stored error.
- Reading a non-terminal run returns a snapshot without a terminal result and does not imply completion.
- Reading a terminal run sets `consumed: true` and suppresses future tracked reminders.

#### Scenario: Read completed result

- GIVEN a tracked run completed with text output
- WHEN the owner calls `pibo_run_read`
- THEN the response contains that text
- AND later notifications no longer include that run.

### Requirement: Cancellation records terminal state and suppresses reminders

`pibo_run_cancel` MUST mark a non-terminal run cancelled, consume it for reminder purposes, and unblock any waiters.

#### Current

`PiboRunRegistry.cancel()` changes non-terminal status to `cancelled`, completes timestamps, marks the run consumed, persists the update, and resolves waiters. Router owner cleanup calls `cancelOwnerRuns()`.

#### Target

Cancellation gives the agent a consistent terminal state even when the underlying yieldable tool cannot be forcibly stopped.

#### Acceptance

- Cancelling a running run returns status `cancelled`.
- The cancelled run is marked consumed.
- Waiters on the run resolve with `timedOut: false` and status `cancelled`.
- Cancelling a terminal run leaves it terminal and consumed.
- Disposing or killing an owner session cancels that owner's non-terminal runs.

#### Scenario: Owner session is disposed

- GIVEN a session has running yielded runs
- WHEN the router disposes that session or executes kill-all behavior for it
- THEN Pibo marks those runs cancelled and stops future reminders for them.

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
- THEN Pibo keeps that run so the owner can still receive reminders and read the result.

## Edge Cases

- A wrapped yieldable tool can return a structured error result instead of throwing; run-control MUST convert that into a failed yielded run when the tool result is marked as an error.
- A model may forget a run id; `pibo_run_list` MUST make unconsumed tracked runs discoverable for that session.
- A stale queued reminder can exist after the agent reads a run; router cleanup MUST remove queued service reminders that no longer describe pending run state.
- A session may own both tracked and detached runs; default list output MUST hide detached runs while keeping tracked work visible.
- Multiple runs can complete close together; reminders MAY coalesce them into one compact service message grouped by status.
- Cancelling a run does not guarantee the underlying external side effect stopped immediately; the Pibo record still becomes terminal from the agent's point of view.

## Constraints

- **Product Boundary:** Pibo owns run ids, lifecycle state, notifications, ownership, and durable records. Pi tools remain the execution payload.
- **Security / Privacy:** Agent-facing run-control operations MUST be scoped by owning Pibo Session id.
- **Compatibility:** Direct tool calls remain synchronous. Run control wraps tools only when `pibo_run_start` is used.
- **Context Economy:** Automatic reminders MUST stay compact and MUST NOT include full terminal output.
- **Reliability:** Store-backed recovery MUST prefer marking arbitrary interrupted runs failed over retrying unsafe side effects.

## Success Criteria

- [ ] SC-001: A run-control-enabled profile exposes all seven `pibo_run_*` tools when yieldable tools are available.
- [ ] SC-002: `pibo_run_start` returns a `run_` id and records ownership by the current Pibo Session.
- [ ] SC-003: The owner can list, status, wait, read, acknowledge, and cancel its run; another session cannot.
- [ ] SC-004: Tracked runs produce compact reminders and stop reminding after read, cancel, or current-state acknowledgement.
- [ ] SC-005: Detached runs never remind and are hidden from default list output.
- [ ] SC-006: `pibo_run_wait` treats timeout as normal state and clamps excessive timeouts.
- [ ] SC-007: Store-backed interrupted non-retryable runs recover as failed rather than staying running forever.
- [ ] SC-008: Pruning removes only detached terminal runs or consumed tracked terminal runs after their TTLs.

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
| REQ-002 Starting a yielded run returns an owned run id | Start a background subagent or shell task | `src/runs/tools.ts`, `src/core/session-router.ts`, `src/runs/registry.ts` | Implemented |
| REQ-003 Run access is scoped to the owning Pibo Session | Child cannot read parent run | `src/runs/registry.ts`, `src/core/session-router.ts` | Implemented |
| REQ-004 Tracked runs create compact reminders until handled | Tracked run completes after initial notification | `src/runs/registry.ts`, `src/core/session-router.ts`, `src/shared/trace-engine.ts` | Implemented |
| REQ-005 Detached runs are inspectable but do not remind | Fire-and-forget background work | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-006 Waiting is bounded and timeout is normal | Long command is still running | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-007 Terminal results are read explicitly | Read completed result | `src/runs/registry.ts`, `src/runs/tools.ts` | Implemented |
| REQ-008 Cancellation records terminal state and suppresses reminders | Owner session is disposed | `src/runs/registry.ts`, `src/core/session-router.ts` | Implemented |
| REQ-009 Durable stores recover interrupted runs conservatively | Gateway process dies during a background run | `src/reliability/store.ts`, `src/runs/registry.ts` | Implemented |
| REQ-010 Terminal run records are pruned after policy-specific TTLs | Unread completed run remains available | `src/runs/registry.ts`, `src/reliability/store.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/runs.test.mjs`, `test/subagents.test.mjs`, `test/codex-compat.test.mjs`, `test/debug-cli.test.mjs`, `test/session-router-store.test.mjs`, and `test/web-channel.test.mjs`.
