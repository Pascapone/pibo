# Spec: Continuous Ralph Jobs

**Status:** Draft  
**Created:** 2026-05-11  
**Updated:** 2026-05-17  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code; 2026-05-17 compute/browser resource incident analysis  
**Related docs:** `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`, `docs/specs/capabilities/scheduled-pibo-jobs.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/changes/extensible-ralph-stop-conditions/spec.md`, `docs/specs/changes/compute-browser-resource-lifecycle/spec.md`

## Why

Pibo supports recurring cron-style jobs, but it also has a separate Ralph capability for continuous agent work. A Ralph job repeats the same task in fresh routed sessions until the user stops it, cancels the current run, reaches a maximum iteration count, or the agent returns the explicit completion token.

This capability needs a separate behavior contract because it owns a dedicated store, a trusted-local channel, Chat Web APIs, a Chat Web area, and an operator CLI. It is not a duplicate of scheduled jobs: Ralph is continuous and self-stopping, not time-scheduled.

## Goal

Ralph MUST let an allowed operator create, inspect, start, stop, cancel, and delete continuous Pibo agent jobs that run in visible Chat Web sessions with shared-app target and completion behavior.

## Background / Current State

The current code registers `pibo.ralph` as a plugin channel in the web gateway. The channel starts a `PiboRalphService`, which uses `pibo-ralph.sqlite` by default to persist jobs and runs.

A job stores target, profile, prompt, optional maximum completed run attempts, optional stop policy, enabled state, runtime overrides, and run state. Legacy stores may retain an owner value for migration compatibility. When the service reserves a run, it first evaluates before-run stop conditions, creates a routed Pibo Session with `kind: "ralph"`, channel metadata for the target Chat room, and `ralphJobId` / `ralphRunId` metadata, sends a service-authored message containing the job prompt, and waits for the correlated session to finish.

Stop behavior is now policy-driven. Built-in stop conditions cover maximum completed run attempts, a completion marker that must appear on its own line in a successful final answer, and fact-count checks. Plugins can register additional stop conditions; policy evaluation supports `any` and `all` modes, per-condition enablement, fail-closed errors, timeouts, and persisted condition state.

Chat Web exposes `/api/chat/ralph/*` endpoints, registered stop-condition metadata, built-in job templates, and a `/ralph` UI area. The CLI exposes `pibo ralph` management commands, including conditions, templates, and stop-policy subcommands for local operator use.

## Scope

### In Scope

- Durable Ralph job and run records.
- Shared-app CLI and Chat Web management operations.
- Continuous run reservation, routed session creation, run completion, and interruption recovery.
- Room and shared default Chat targets.
- Stop, cancel, maximum-iteration, timeout, stop-policy, and completion-marker behavior.
- Chat Web Ralph API and UI behavior visible to users.
- Built-in Ralph templates and registered stop-condition metadata.

### Out of Scope

- Time-based scheduling — covered by scheduled Pibo jobs.
- General Pibo Session routing semantics — covered by Pibo Session Routing.
- Full Chat Web room membership design — covered by Chat Web rooms and same-origin web auth specs.
- Provider/model selection beyond storing and resolving the selected profile.

## Requirements

### Requirement: Ralph jobs are durable shared-app product records

The system MUST persist each Ralph job with a stable id, name, optional description, enabled flag, target, profile, prompt, optional maximum iterations, optional stop policy, optional runtime overrides, state, and timestamps. Legacy owner fields are compatibility metadata only.

#### Current

`PiboRalphStore` stores jobs in `pibo_ralph_jobs` under `pibo-ralph.sqlite` by default. Job ids use the `ralph_` prefix. Empty profile, prompt, or required target ids are rejected. Legacy owner fields are normalized to the shared app compatibility value when old schemas require them. `maxIterations` must be a positive integer when provided. `stopPolicy` is normalized before persistence and can be cleared back to the default policy. Runtime overrides may include `modelOverride`, `thinkingLevel`, and tri-state `fastMode`.

#### Target

All Ralph job management surfaces preserve the same shared-app validation semantics.

#### Acceptance

- Creating a job with a blank prompt fails.
- Creating a job with `maxIterations: 0` fails.
- Creating or editing a job with runtime overrides persists and returns those overrides.
- Editing a job can clear `modelOverride`, `thinkingLevel`, `fastMode`, `maxIterations`, and `stopPolicy` to return to inherited defaults.
- Listing jobs returns shared-app jobs for any allowed account.
- A job without an explicit name receives a name derived from the prompt, capped by current store behavior.

#### Scenario: Create a stopped room job

- GIVEN room `room_1` exists and is not archived
- WHEN the user creates a Ralph job for `room_1` with profile `default`, prompt `Check the repo`, and no `enabled` flag
- THEN the store creates a shared `ralph_` job
- AND the job is initially stopped
- AND its state includes `completedIterations: 0`.

### Requirement: Ralph targets resolve to visible Chat Web rooms

The system MUST resolve every run to a Chat Web room before creating the routed session.

#### Current

Room targets require an existing non-archived room. Shared default targets call `ensureDefaultRoom` and use the shared Chat room.

#### Target

Ralph never starts hidden or orphan sessions. Each run is placed into a room that any allowed account can open in Chat Web.

#### Acceptance

- A run against a missing room fails and records an error.
- A run against an archived room fails and records an error.
- A shared default target creates or reuses the shared default Chat room.
- Chat Web normalizes deprecated personal target inputs to the shared default target.

#### Scenario: Shared default target creates default room

- GIVEN the shared app has no default Chat room
- WHEN a Ralph job uses the shared default target
- THEN the room service creates or returns the shared default room
- AND the Ralph session metadata includes that room id.

### Requirement: Run reservation is exclusive and bounded by service capacity

The Ralph service MUST reserve due enabled jobs without starting more active runs than its configured concurrency limit.

#### Current

`PiboRalphService.tick()` computes capacity from `maxConcurrentRuns - activeRuns`. `PiboRalphStore.reserveDueRuns()` orders enabled jobs by update time and calls `reserveJob()` inside `BEGIN IMMEDIATE` to avoid double reservation. A job with `state.runningAt` or a reached `maxIterations` is not reserved.

#### Target

Concurrent scheduler ticks or manual starts do not produce duplicate running runs for the same job.

#### Acceptance

- A job already marked running is not reserved again.
- If capacity is zero, no due job is reserved.
- Manual start enables the job and reserves at most one run.
- Reached `maxIterations` prevents new reservations.

#### Scenario: Duplicate tick

- GIVEN one enabled Ralph job is due
- AND two scheduler paths try to reserve it at the same time
- WHEN the store reservation runs
- THEN at most one `rrun_` run is created
- AND the job state has one `runningAt` and one `lastRunId`.

### Requirement: Each run creates a routed Ralph session and correlated service message

The system MUST execute each reserved run through a new routed Pibo Session and wait only for output correlated to that run's service message.

#### Current

`executeJob()` creates a session with channel `pibo.chat-web`, kind `ralph`, the job profile, target workspace, title, optional active model override, and metadata including `chatRoomId`, `ralphJobId`, `ralphRunId`, `ralphTargetKind`, and optional initial thinking/fast-mode overrides. `emitMessageAndWait()` emits a `message` input with source `service` and an event id prefixed by `ralph_msg_`, then listens only to output events with the same Pibo Session id and event id when present.

#### Target

A Ralph run is visible as normal Chat Web session activity while still preserving run-level correlation.

#### Acceptance

- The run record receives the created Pibo Session id after session creation.
- A job model override becomes the created session's active model.
- Job thinking and fast-mode overrides become the created session's initial runtime settings.
- Assistant deltas and final messages from unrelated sessions do not complete the run.
- The run completes when the correlated session emits `message_finished`.
- The final answer is the final assistant message when present, otherwise accumulated deltas.

#### Scenario: Session finishes normally

- GIVEN a reserved Ralph run has created Pibo Session `ps_1`
- WHEN that session emits a correlated assistant message followed by `message_finished`
- THEN the Ralph run completes with status `ok`
- AND the run stores `piboSessionId: "ps_1"`.

#### Scenario: Runtime overrides apply to a run

- GIVEN a Ralph job has `modelOverride`, `thinkingLevel`, and `fastMode`
- WHEN Ralph starts a new run
- THEN the created Pibo Session uses the job model override as its active model
- AND the session starts with the job thinking and fast-mode settings instead of inherited defaults.

### Requirement: Completion controls stop continuous work deterministically

The system MUST stop a Ralph job after the current run when requested, when the maximum completed run-attempt count is reached, or when the effective stop policy returns a terminal action.

#### Current

The service evaluates the effective stop policy before reserving a run and after a run settles. The default policy includes the max-iterations condition when `maxIterations` is configured and always includes the completion-marker condition. The marker condition only stops after an `ok` run whose final answer includes the marker on its own line. `completeRun()` increments `completedIterations` for every completed run attempt, including `ok`, `error`, and `cancelled`, stores the stop evaluation summary, persists condition state, and disables the job when `stopAfterRun` is true or when legacy `maxIterations` is reached. `requestStop()` disables the job and records `stopRequestedAt` without aborting the current session.

#### Target

Users, agents, templates, and plugins can end a Ralph loop without creating another run.

#### Acceptance

- Stop disables the job and lets an already running session finish.
- A successful run whose final answer includes the completion marker on its own line disables the job and records reason `promise-complete`.
- The completion marker does not stop the job when it appears inline as quoted or explanatory text.
- A job with `maxIterations: 1` stops after one completed run attempt regardless of outcome.
- Failed and cancelled runs increment the completed run-attempt counter used by `maxIterations`.
- Stop evaluation state and the last evaluation summary are persisted on the job state.

#### Scenario: Agent promises completion

- GIVEN a Ralph job is enabled with no max iteration limit
- WHEN a successful run finishes with the completion marker on its own line
- THEN the run status is `ok`
- AND the job is disabled
- AND the run completion reason is `promise-complete`.

### Requirement: Stop policies are extensible and inspectable

The system MUST let jobs use a normalized stop policy made of registered stop-condition types while exposing the registered condition catalog to operators and Chat Web.

#### Current

`src/ralph/stopping.ts` evaluates policies with `mode: "any"` or `mode: "all"`. Conditions run only in supported phases, can be disabled per instance, can provide per-condition state, can fail closed, and can be bounded by `timeoutMs`. The built-in plugin registers the current condition definitions through the plugin registry. Chat Web exposes `GET /api/chat/ralph/conditions`; the CLI exposes `pibo ralph conditions` and `pibo ralph policy show|set|clear`.

#### Target

New stop criteria can be added through plugins without hard-coding every stopping rule into the Ralph service or UI.

#### Acceptance

- Duplicate stop-condition types fail during plugin registration.
- A policy with a missing condition type records a skipped decision and continues unless another condition stops the job.
- `any` mode stops when any enabled applicable condition returns a stop action.
- `all` mode stops only when all enabled applicable conditions return a stop action.
- Condition errors continue by default and stop when the instance is marked `failClosed`.
- Policy state and the last evaluation summary are visible in job state.
- Chat Web and CLI can list built-in and plugin-provided condition metadata.

#### Scenario: Custom stop condition reaches threshold

- GIVEN a plugin registers a stateful after-run stop condition
- AND a job policy references that condition
- WHEN the condition returns `continue` on the first run and `stop-after-run` on the second run
- THEN Ralph persists the condition state after each evaluation
- AND disables the job after the second run.

### Requirement: Cancel aborts the current session and records cancellation

The system MUST distinguish stop-after-current-run from cancel-now behavior.

#### Current

`requestCancel()` disables the job and records `stopRequestedAt` and `cancelRequestedAt`. The service aborts a running session by emitting an execution event with action `abort` for the last Pibo Session id. The in-memory `cancelledRuns` set maps the run to a cancelled outcome.

#### Target

A cancel request prevents future runs and makes the current run terminal as cancelled when the abort path takes effect.

#### Acceptance

- Cancel disables the job.
- If the job has a running session, Ralph emits an abort execution event for that session.
- A cancelled run completes with status `cancelled` and no non-cancel error.
- A cancel request for an unknown job returns not found through API/service surfaces.

#### Scenario: User cancels active run

- GIVEN a Ralph job is running in Pibo Session `ps_1`
- WHEN the owner cancels the job
- THEN Ralph emits an abort execution event to `ps_1`
- AND the job remains disabled
- AND the run outcome is `cancelled` when the run settles.

### Requirement: Errors, timeouts, and gateway restarts leave auditable run state

The system MUST record run failures with enough state for Chat Web, CLI, and operators to understand the last outcome.

#### Current

`emitMessageAndWait()` times out after `runTimeoutMs`, defaulting to 30 minutes. Session errors are remembered and included in timeout errors. `recoverInterruptedRuns()` marks old running jobs as failed after a cutoff and records `Ralph run was interrupted by gateway restart` with reason `interrupted`.

#### Target

Unexpected interruption does not leave a job permanently marked running without an inspectable run outcome.

#### Acceptance

- A timed-out run completes with status `error` unless it was cancelled.
- A non-cancel error increments `consecutiveErrors`.
- A later successful run resets `consecutiveErrors` to zero.
- Restart recovery marks stale running runs as error with reason `interrupted`.

#### Scenario: Gateway restarts during active run

- GIVEN a Ralph job has `runningAt` older than the recovery cutoff and a `lastRunId`
- WHEN the Ralph service starts and recovers interrupted runs
- THEN that run is completed with status `error`
- AND the job no longer has `runningAt`
- AND the error explains that the run was interrupted by gateway restart.

### Requirement: Chat Web Ralph API is authenticated, shared-app, and same-origin protected

The Chat Web API MUST allow any allowed account to manage shared Ralph jobs and MUST require same-origin JSON requests for mutations.

#### Current

`handleChatRalphApiRequest()` uses the shared app context, requires JSON content type and matching `Origin` for POST/PATCH/DELETE and start/stop/cancel actions, validates room existence/state for room targets, and resolves requested profiles from the channel context profile list.

#### Target

A browser user cannot bypass same-origin mutation guards, target missing or archived rooms, or submit cross-site mutations.

#### Acceptance

- `GET /api/chat/ralph/jobs` returns shared app jobs.
- Mutating requests without `Content-Type: application/json` fail.
- Mutating requests without an Origin header or with a different Origin fail.
- A missing or archived room target fails.
- An unknown profile fails before job creation or update.

#### Scenario: Cross-site mutation is rejected

- GIVEN an authenticated browser session at the Chat Web origin
- WHEN a request from a different Origin tries to create a Ralph job
- THEN the API returns a forbidden error
- AND no Ralph job is created.

### Requirement: Ralph management is discoverable through CLI and Chat Web UI

The system MUST expose Ralph status, job management, stop conditions, templates, and run history through both local CLI commands and the Chat Web Ralph area.

#### Current

`pibo ralph` prints a compact discovery surface. Commands include `status`, `list`, `add`, `edit`, `conditions`, `templates`, `policy show|set|clear`, `start`, `stop`, `cancel`, `remove`, and `runs`, with JSON output options on command paths. Chat Web includes a `/ralph` route and `RalphArea` that lists jobs, shows running counts, loads job templates, edits job details, edits per-job model/thinking/fast-mode overrides, edits stop-policy JSON, performs start/stop/cancel/delete, and lists runs.

#### Target

Agents and users can operate Ralph without reading source code.

#### Acceptance

- Running `pibo ralph` with no subcommand shows the immediate command list and next suggested command.
- CLI list, runs, conditions, templates, and policy commands can output machine-readable JSON where applicable.
- Chat Web displays an empty state when no Ralph jobs exist.
- Chat Web refreshes status, jobs, run history, registered conditions, and templates.
- Chat Web explains the completion-marker stop behavior to users creating jobs.
- Chat Web lets users set or unset per-job model, thinking-level, fast-mode, and stop-policy overrides.

#### Scenario: User opens Ralph area with no jobs

- GIVEN the shared app has no Ralph jobs
- WHEN the user opens `/apps/chat/ralph`
- THEN the UI shows zero jobs, zero running jobs, and an empty job list state
- AND the user can create a new Ralph job from the page.

### Requirement: Ralph-owned compute resources are policy-managed

Ralph jobs that use Docker compute workers or browser automation MUST bind those resources to job/run metadata and MUST release, idle-retain, or recycle them by policy.

#### Current

Ralph job prompts can instruct agents to reuse or not release containers, but prompt text is not machine-enforced resource lifecycle. Disabled jobs and completed runs do not necessarily expose retained worker/browser cleanup state.

#### Target

Ralph resource ownership is explicit. Pibo labels or records assigned workers, browser leases, and cleanup state. Stop, cancel, max-iteration, and promise-complete paths apply deterministic cleanup policy regardless of prompt wording.

#### Acceptance

- Ralph job/run records or linked metadata include assigned compute worker ids when Docker workers are used.
- Worker containers include Ralph job/run labels when a Ralph loop owns or uses them.
- Ralph releases active browser leases after each run when the lease is no longer needed.
- Promise-complete, max-iteration stop, stop request, and cancel paths mark associated workers as released, idle-retained, or dirty according to policy.
- Prompt text such as “do not release container” cannot disable hard TTL, browser-pool reap, Docker resource limits, or dirty-worker recycling.
- CLI/API status can show disabled jobs that still have retained workers or cleanup failures.

#### Scenario: Completed Ralph loop releases browser resources

- GIVEN a Ralph loop used a compute worker for browser verification
- WHEN the loop stops with reason `promise-complete`
- THEN Ralph releases or reaps the worker browser pool
- AND records whether the worker was released, idle-retained, or marked dirty.

## Resource lifecycle obligations

This capability participates in the compute/browser resource lifecycle change. It must follow the canonical model in `docs/project/compute-browser-resource-operating-model.md` and the rollout checks in `docs/project/compute-browser-resource-rollout-checklist.md`.

- Ralph jobs and runs that use compute/browser resources must record assigned worker ids, browser lease ids when known, cleanup status, and retained/dirty reasons.
- Ralph-owned compute containers must carry `pibo.ralph.jobId` and `pibo.ralph.runId` labels when Ralph owns or directly assigns the worker. Legacy compute owner labels, when present, are compatibility metadata only.
- Run completion, promise-complete, max-iteration, stop, cancel, and interrupted-run paths must release browser leases and mark workers released, idle-retained, or dirty according to policy.
- CLI/API status must show disabled jobs with retained resources or cleanup failures.
- Prompt text cannot override Docker resource budgets, hard TTLs, browser-pool reaping, or dirty-worker recycling.

## Edge Cases

- A run can have no Pibo Session id if target resolution or session creation fails before attachment.
- `removeJob` deletes the job record and relies on database behavior for existing run rows; consumers SHOULD treat old runs as historical diagnostics when present.
- `startJob` may return undefined if the job is unknown, already running, or has reached `maxIterations`.
- Deprecated `--owner-scope` inputs are ignored compatibility options; normal CLI operations do not require them.
- The current Chat Web delete call sends an empty JSON body to satisfy mutation request requirements.
- The completion marker is exact and case-sensitive, and the built-in condition requires it on its own line.
- A Ralph prompt may request worker reuse for debugging, but machine-enforced TTL, resource limits, and cleanup policy still apply.

## Constraints

- **Compatibility:** Ralph job ids and run ids remain opaque strings; callers MUST NOT parse them beyond displaying or passing them back.
- **Security / Privacy:** Chat Web API operations require authenticated same-origin requests. Local CLI operations rely on trusted local access; auth account values do not partition Ralph jobs.
- **Performance:** The service polls on a timer and limits concurrent active runs by configuration.
- **Durability:** `pibo-ralph.sqlite` is a Pibo-owned store under Pibo home unless an explicit path is provided.
- **Routing:** Ralph-created sessions use Pibo Session IDs and Chat room metadata; Pi Session IDs are not the public run identity.
- **Runtime defaults:** Unset Ralph runtime overrides inherit the selected agent and current model defaults.

## Success Criteria

- [ ] SC-001: A Ralph job can be created, listed, started, stopped, cancelled, and removed through shared-app API or CLI surfaces.
- [ ] SC-002: Each successful run creates a visible routed Pibo Session with Ralph metadata, selected runtime overrides, and a stored run record.
- [ ] SC-003: Stop, cancel, max iterations, stop-policy, timeout, restart recovery, and completion-marker outcomes are distinguishable in job/run state.
- [ ] SC-004: Cross-origin, invalid target, and invalid profile operations fail without creating or mutating jobs.
- [ ] SC-005: Chat Web and CLI expose enough status and run history to diagnose the current Ralph loop state.
- [ ] SC-006: Built-CLI verification covers `pibo ralph` discovery output and at least one JSON-producing management path without using the live default store.
- [ ] SC-007: Ralph resource policy tests cover worker labels/metadata, browser-lease release, idle retention, dirty-worker marking, and prompt text not overriding hard cleanup policy.

## Verification Coverage

### Directly Tested

- `test/ralph-runtime-overrides.test.mjs` verifies Ralph store persistence and clearing for runtime overrides.
- `test/ralph-runtime-overrides.test.mjs` verifies the Ralph service passes model, thinking-level, and fast-mode overrides to created sessions.
- `test/ralph-stop-conditions.test.mjs` verifies plugin registry exposure, fact-count stop decisions, `any`/`all` policy composition, stateful custom conditions, max-iteration behavior after failed outcomes, own-line completion-marker matching, and service preservation of promise-complete and max-iteration stop behavior through stop policies.
- `test/ralph-templates.test.mjs` verifies built-in templates use explicit stop policies and that template prompt text avoids exposing the literal completion marker directly where the policy can carry the rule.

### Source-Inspected Only

- Store validation, shared-app listing, run reservation, completion state, restart recovery, stop-policy persistence, condition state, and run history beyond direct tests are source-inspected from `src/ralph/store.ts`.
- Routed session creation, target resolution, message correlation, timeout, stop, cancel, and stop-policy evaluation beyond direct tests are source-inspected from `src/ralph/service.ts` and `src/ralph/stopping.ts`.
- Chat Web API shared-app access, same-origin mutation checks, profile validation, room access checks, stop-condition/template endpoints, stop-policy normalization, and run listing are source-inspected from `src/apps/chat/ralph-api.ts`.
- CLI discovery, templates, conditions, policy management, and management command output are source-inspected from `src/ralph/cli.ts`, `src/ralph/templates.ts`, and `src/cli.ts`.
- Chat Web Ralph navigation, empty state, form behavior, and run display are source-inspected from `src/apps/chat-ui/src/RalphArea.tsx`, `src/apps/chat-ui/src/api.ts`, `src/apps/chat-ui/src/types.ts`, `src/apps/chat-ui/src/App.tsx`, and `src/apps/chat-ui/src/main.tsx`.

### Test Gaps

- Add isolated store tests for invalid job input, shared listing, max-iteration reservation blocking, stop/cancel state, stop-policy clearing, and interrupted-run recovery.
- Add a service-level test with a fake channel context to verify routed session metadata, service message correlation, timeout handling, before-run stop evaluation, and cancel abort emission.
- Add Chat Web API tests for cross-origin rejection, shared listing, invalid profile rejection, room state checks, shared default target normalization, stop-policy validation, conditions/templates endpoints, and start/stop/cancel error paths.
- Add built-CLI tests for `pibo ralph` discovery output, deprecated owner-scope no-op behavior, `add --json`, `list --json`, `conditions --json`, `templates --json`, `policy show|set|clear`, and `runs --json` against a temporary `--store` path.
- Add a UI-level test or browser check for the `/ralph` empty state, completion-marker guidance, template loading, stop-policy JSON editor, save/start/stop/cancel controls, and run-history rendering.

### Recommended Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Store validation and shared visibility | Reject blank profile/prompt/target ids; reject non-positive `maxIterations`; normalize and clear stop policies; persist and clear runtime overrides; default names are prompt-derived and capped; shared-app `listJobs`, `getOwnedJob` compatibility, `updateJob`, `removeJob`, and `listRuns` include historical owner rows. | REQ-001, REQ-006, REQ-009 | `test/ralph-store.test.mjs`, `test/ralph-runtime-overrides.test.mjs`, `test/ralph-stop-conditions.test.mjs` |
| Store reservation and state transitions | Reserve only enabled non-running jobs; return no reservation at capacity-equivalent duplicate reservation; block jobs that reached `maxIterations`; `requestStop` disables without clearing `runningAt`; `requestCancel` records both stop and cancel timestamps. | REQ-003, REQ-005, REQ-007 | `test/ralph-store.test.mjs` |
| Store completion and recovery | Successful completion increments `completedIterations`; error completion increments `consecutiveErrors`; later success resets `consecutiveErrors`; stop-policy and max-iteration paths disable the job; `recoverInterruptedRuns` marks stale running runs as `error` with reason `interrupted`. | REQ-005, REQ-006, REQ-008 | `test/ralph-store.test.mjs`, `test/ralph-stop-conditions.test.mjs` |
| Stop-condition evaluation | Default policies include max-iterations when configured and the completion-marker condition; custom conditions compose in `any` and `all` modes; stateful conditions persist state; condition errors honor fail-open/fail-closed behavior. | REQ-005, REQ-006 | `test/ralph-stop-conditions.test.mjs` |
| Service target and session creation | Room target fails for missing or archived rooms; shared default target creates/reuses the shared default room; created sessions use channel `pibo.chat-web`, kind `ralph`, shared app compatibility context, profile, workspace, title, `chatRoomId`, `ralphJobId`, `ralphRunId`, and `ralphTargetKind`. | REQ-002, REQ-004 | `test/ralph-service.test.mjs` |
| Service message correlation | Ralph emits one service message with an id prefixed `ralph_msg_`; unrelated sessions and unrelated event ids do not complete the run; correlated deltas plus `message_finished` complete the run; final assistant message overrides accumulated deltas. | REQ-004 | `test/ralph-service.test.mjs` |
| Service stop, cancel, timeout | Completion-marker stop evaluation disables future runs only for successful own-line marker output; `stopJob` disables but does not abort the current session; `cancelJob` emits an `abort` execution event for the last running Pibo Session and completes as `cancelled`; timeout records an error unless the run was cancelled. | REQ-005, REQ-007, REQ-008 | `test/ralph-service.test.mjs`, `test/ralph-stop-conditions.test.mjs` |
| Chat Web API security and validation | GET lists shared jobs; POST/PATCH/DELETE and start/stop/cancel reject missing JSON content type, missing Origin, and foreign Origin; room targets require an existing non-archived room; shared default targets normalize deprecated personal inputs; unknown profiles and invalid stop policies fail before persistence. | REQ-001, REQ-002, REQ-009 | `test/chat-ralph-api.test.mjs` |
| Chat Web API operations | Create returns `201`; start returns `202` with a run when service is available; start returns `503` when service is missing; stop/cancel/delete return bounded not-found behavior; conditions/templates endpoints return catalog data; run listing clamps invalid or excessive limits through store behavior and rejects an unknown `jobId`. | REQ-007, REQ-009, REQ-010 | `test/chat-ralph-api.test.mjs` |
| CLI discovery and JSON paths | `pibo ralph` with no subcommand prints compact command discovery and `Next: pibo ralph add --help`; deprecated owner-scope inputs warn/no-op; `status --json`, `add --json`, `list --json`, `conditions --json`, `templates --json`, `policy show|set|clear`, and `runs --json` use a temporary `--store` and produce parseable JSON. | REQ-001, REQ-010 | `test/ralph-cli.test.mjs` |
| Built-in templates | Templates provide safe starter prompts and explicit default stop policies for standard, PRD-batch, and single-run jobs. | REQ-010 | `test/ralph-templates.test.mjs` |
| Chat Web UI smoke | `/ralph` shows zero-job empty state; creation form explains completion-marker behavior; template loading, stop-policy JSON editing, save/start/stop/cancel/delete controls call the matching API paths; run history displays run status, session id when present, stop evaluation, and error text when present. | REQ-005, REQ-006, REQ-010 | component test or browser check |

## Assumptions and Open Questions

### Assumptions

- Ralph is intentionally continuous and immediate; it is not a replacement for cron-style scheduled Pibo jobs.
- The completion marker is the current user-visible stop contract, but the built-in condition only stops when it appears on its own line in a successful final answer.
- The web gateway is the normal host for the Ralph channel and service.

### Open Questions

- Should non-cancel consecutive errors ever auto-disable a job after a threshold?
- Should deleting a job also delete or tombstone its historical runs?
- Should Chat Web expose direct navigation from a run row to the created Pibo Session?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001: Durable shared-app records | Create a stopped room job | Current `PiboRalphStore` behavior, including `stopPolicy` normalization | Source-backed |
| REQ-002: Targets resolve to Chat rooms | Personal target creates default room | Current `PiboRalphService.resolveTarget` and Chat API behavior | Source-backed |
| REQ-003: Exclusive bounded reservation | Duplicate tick | Current `reserveJob` and service capacity behavior | Source-backed |
| REQ-004: Routed session execution | Session finishes normally | Current `executeJob` / `emitMessageAndWait` behavior | Source-backed |
| REQ-005: Deterministic completion controls | Agent promises completion | Current `completeRun`, `evaluateRalphStopPolicy`, and built-in stop conditions | Source-backed |
| REQ-006: Extensible stop policies | Custom stop condition reaches threshold | `src/ralph/stopping.ts`, plugin registry stop-condition registration, `test/ralph-stop-conditions.test.mjs` | Source-backed |
| REQ-007: Cancel aborts active session | User cancels active run | Current `requestCancel` and `abortJobIfRunning` behavior | Source-backed |
| REQ-008: Auditable errors and recovery | Gateway restarts during active run | Current timeout and recovery behavior | Source-backed |
| REQ-009: Authenticated shared-app API | Cross-site mutation is rejected | Current `handleChatRalphApiRequest` behavior | Source-backed |
| REQ-010: Discoverable management | User opens Ralph area with no jobs | Current CLI, templates, conditions, policy commands, and `RalphArea` behavior | Source-backed |
| REQ-011: Ralph-owned compute resources are policy-managed | Completed Ralph loop releases browser resources | Compute/browser resource lifecycle change | Draft |

## Verification Basis

Source files inspected for this spec:

- `src/ralph/types.ts`
- `src/ralph/store.ts`
- `src/ralph/service.ts`
- `src/ralph/stopping.ts`
- `src/ralph/templates.ts`
- `src/ralph/channel.ts`
- `src/ralph/plugin.ts`
- `src/ralph/cli.ts`
- `src/apps/chat/ralph-api.ts`
- `src/apps/chat-ui/src/RalphArea.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/gateway/web.ts`
- `src/cli.ts`
- `test/ralph-runtime-overrides.test.mjs`
- `test/ralph-stop-conditions.test.mjs`
- `test/ralph-templates.test.mjs`
