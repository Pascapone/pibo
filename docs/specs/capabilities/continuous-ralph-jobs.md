# Spec: Continuous Ralph Jobs

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`, `docs/specs/capabilities/scheduled-pibo-jobs.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/changes/extensible-ralph-stop-conditions/spec.md`

## Why

Pibo supports recurring cron-style jobs, but it also has a separate Ralph capability for continuous agent work. A Ralph job repeats the same task in fresh routed sessions until the user stops it, cancels the current run, reaches a maximum iteration count, or the agent returns the explicit completion token.

This capability needs a separate behavior contract because it owns a dedicated store, a trusted-local channel, Chat Web APIs, a Chat Web area, and an operator CLI. It is not a duplicate of scheduled jobs: Ralph is continuous and self-stopping, not time-scheduled.

## Goal

Ralph MUST let an owner create, inspect, start, stop, cancel, and delete continuous Pibo agent jobs that run in visible Chat Web sessions with bounded ownership, target, and completion behavior.

## Background / Current State

The current code registers `pibo.ralph` as a plugin channel in the web gateway. The channel starts a `PiboRalphService`, which uses `pibo-ralph.sqlite` by default to persist jobs and runs.

A job stores owner scope, target, profile, prompt, optional maximum successful iterations, enabled state, and run state. When the service reserves a run, it creates a routed Pibo Session with `kind: "ralph"`, channel metadata for the target Chat room, and `ralphJobId` / `ralphRunId` metadata. It sends a service-authored message containing the job prompt and waits for the correlated session to finish.

Chat Web exposes `/api/chat/ralph/*` endpoints and a `/ralph` UI area. The CLI exposes `pibo ralph` management commands for local operator use.

## Scope

### In Scope

- Durable Ralph job and run records.
- Owner-scoped CLI and Chat Web management operations.
- Continuous run reservation, routed session creation, run completion, and interruption recovery.
- Room and personal targets.
- Stop, cancel, maximum-iteration, timeout, and promise-complete behavior.
- Chat Web Ralph API and UI behavior visible to users.

### Out of Scope

- Time-based scheduling — covered by scheduled Pibo jobs.
- General Pibo Session routing semantics — covered by Pibo Session Routing.
- Full Chat Web room membership design — covered by Chat Web rooms and same-origin web auth specs.
- Provider/model selection beyond storing and resolving the selected profile.

## Requirements

### Requirement: Ralph jobs are durable owner-scoped product records

The system MUST persist each Ralph job with a stable id, owner scope, name, optional description, enabled flag, target, profile, prompt, optional maximum iterations, optional runtime overrides, state, and timestamps.

#### Current

`PiboRalphStore` stores jobs in `pibo_ralph_jobs` under `pibo-ralph.sqlite` by default. Job ids use the `ralph_` prefix. Empty owner scope, profile, prompt, room target id, or personal principal id are rejected. `maxIterations` must be a positive integer when provided. Runtime overrides may include `modelOverride`, `thinkingLevel`, and tri-state `fastMode`.

#### Target

All Ralph job management surfaces preserve the same ownership and validation semantics.

#### Acceptance

- Creating a job with a blank prompt fails.
- Creating a job with `maxIterations: 0` fails.
- Creating or editing a job with runtime overrides persists and returns those overrides.
- Editing a job can clear `modelOverride`, `thinkingLevel`, `fastMode`, and `maxIterations` to return to inherited defaults.
- Listing jobs for one owner scope does not return another owner's jobs.
- A job without an explicit name receives a name derived from the prompt, capped by current store behavior.

#### Scenario: Create a stopped room job

- GIVEN owner scope `user:a` has write access to room `room_1`
- WHEN the user creates a Ralph job for `room_1` with profile `default`, prompt `Check the repo`, and no `enabled` flag
- THEN the store creates a `ralph_` job owned by `user:a`
- AND the job is initially stopped
- AND its state includes `completedIterations: 0`.

### Requirement: Ralph targets resolve to visible Chat Web rooms

The system MUST resolve every run to a Chat Web room before creating the routed session.

#### Current

Room targets require an existing non-archived room. Personal targets call `ensureDefaultRoom` for the owner/principal and use the resulting personal Chat room.

#### Target

Ralph never starts hidden or orphan sessions. Each run is placed into a room that the owner can open in Chat Web.

#### Acceptance

- A run against a missing room fails and records an error.
- A run against an archived room fails and records an error.
- A personal target creates or reuses the owner's default personal room.
- Chat Web rejects a personal target whose principal differs from the authenticated owner.

#### Scenario: Personal target creates default room

- GIVEN owner scope `user:a` has no existing personal room
- WHEN a Ralph job with target `{ kind: "personal", principalId: "user:a" }` runs
- THEN the room service creates or returns the default personal room
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

`executeJob()` creates a session with channel `pibo.chat-web`, kind `ralph`, the job profile, owner scope, target workspace, title, optional active model override, and metadata including `chatRoomId`, `ralphJobId`, `ralphRunId`, `ralphTargetKind`, and optional initial thinking/fast-mode overrides. `emitMessageAndWait()` emits a `message` input with source `service` and an event id prefixed by `ralph_msg_`, then listens only to output events with the same Pibo Session id and event id when present.

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

The system MUST stop a Ralph job after the current run when requested, when the maximum completed run-attempt count is reached, or when the final answer contains the exact promise-complete token.

#### Current

The service prompt tells the agent that returning `<promise>COMPLETE</promise>` stops Ralph. `completeRun()` increments `completedIterations` for every completed run attempt, including `ok`, `error`, and `cancelled`, disables the job when `maxIterations` is reached, and disables the job when `stopAfterRun` is true. `requestStop()` disables the job and records `stopRequestedAt` without aborting the current session.

#### Target

Users and agents can end a Ralph loop without creating another run.

#### Acceptance

- Stop disables the job and lets an already running session finish.
- A successful run containing `<promise>COMPLETE</promise>` disables the job and records reason `promise-complete`.
- A job with `maxIterations: 1` stops after one completed run attempt regardless of outcome.
- Failed and cancelled runs increment the completed run-attempt counter used by `maxIterations`.

#### Scenario: Agent promises completion

- GIVEN a Ralph job is enabled with no max iteration limit
- WHEN a run finishes with final answer containing `<promise>COMPLETE</promise>`
- THEN the run status is `ok`
- AND the job is disabled
- AND the run completion reason is `promise-complete`.

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
- A cancel request for an unknown owned job returns not found through API/service surfaces.

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

### Requirement: Chat Web Ralph API is authenticated, owner-scoped, and same-origin protected

The Chat Web API MUST allow only the authenticated owner to manage their Ralph jobs and MUST require same-origin JSON requests for mutations.

#### Current

`handleChatRalphApiRequest()` uses the authenticated `webSession.ownerScope`, requires JSON content type and matching `Origin` for POST/PATCH/DELETE and start/stop/cancel actions, validates room write access for room targets, and resolves requested profiles from the channel context profile list.

#### Target

A browser user cannot create or mutate another owner's Ralph job, target a room they cannot write to, or submit cross-site mutations.

#### Acceptance

- `GET /api/chat/ralph/jobs` returns only jobs owned by the current owner scope.
- Mutating requests without `Content-Type: application/json` fail.
- Mutating requests without an Origin header or with a different Origin fail.
- A room target without write access fails.
- An unknown profile fails before job creation or update.

#### Scenario: Cross-site mutation is rejected

- GIVEN an authenticated browser session at the Chat Web origin
- WHEN a request from a different Origin tries to create a Ralph job
- THEN the API returns a forbidden error
- AND no Ralph job is created.

### Requirement: Ralph management is discoverable through CLI and Chat Web UI

The system MUST expose Ralph status, job management, and run history through both local CLI commands and the Chat Web Ralph area.

#### Current

`pibo ralph` prints a compact discovery surface. Commands include `status`, `list`, `add`, `edit`, `start`, `stop`, `cancel`, `remove`, and `runs`, with JSON output options on command paths. Chat Web includes a `/ralph` route and `RalphArea` that lists jobs, shows running counts, edits job details, edits per-job model/thinking/fast-mode overrides, performs start/stop/cancel/delete, and lists runs.

#### Target

Agents and users can operate Ralph without reading source code.

#### Acceptance

- Running `pibo ralph` with no subcommand shows the immediate command list and next suggested command.
- CLI list and runs commands can output machine-readable JSON.
- Chat Web displays an empty state when no Ralph jobs exist.
- Chat Web refreshes status, jobs, and run history periodically.
- Chat Web exposes the exact promise-complete token to users creating jobs.
- Chat Web lets users set or unset per-job model, thinking-level, and fast-mode overrides.

#### Scenario: User opens Ralph area with no jobs

- GIVEN the authenticated owner has no Ralph jobs
- WHEN the user opens `/apps/chat/ralph`
- THEN the UI shows zero jobs, zero running jobs, and an empty job list state
- AND the user can create a new Ralph job from the page.

## Edge Cases

- A run can have no Pibo Session id if target resolution or session creation fails before attachment.
- `removeJob` deletes the job record and relies on database behavior for existing run rows; consumers SHOULD treat old runs as historical diagnostics when present.
- `startJob` may return undefined if the job is unknown, belongs to another owner, is already running, or has reached `maxIterations`.
- CLI operations require an owner scope from `--owner-scope` or `PIBO_OWNER_SCOPE`.
- The current Chat Web delete call sends an empty JSON body to satisfy mutation request requirements.
- The promise-complete token is exact and case-sensitive.

## Constraints

- **Compatibility:** Ralph job ids and run ids remain opaque strings; callers MUST NOT parse them beyond displaying or passing them back.
- **Security / Privacy:** Chat Web API operations are scoped to `webSession.ownerScope`; local CLI operations rely on explicit owner scope and trusted local access.
- **Performance:** The service polls on a timer and limits concurrent active runs by configuration.
- **Durability:** `pibo-ralph.sqlite` is a Pibo-owned store under Pibo home unless an explicit path is provided.
- **Routing:** Ralph-created sessions use Pibo Session IDs and Chat room metadata; Pi Session IDs are not the public run identity.
- **Runtime defaults:** Unset Ralph runtime overrides inherit the selected agent and current model defaults.

## Success Criteria

- [ ] SC-001: A Ralph job can be created, listed, started, stopped, cancelled, and removed through owner-scoped API or CLI surfaces.
- [ ] SC-002: Each successful run creates a visible routed Pibo Session with Ralph metadata, selected runtime overrides, and a stored run record.
- [ ] SC-003: Stop, cancel, max iterations, timeout, restart recovery, and promise-complete outcomes are distinguishable in job/run state.
- [ ] SC-004: Cross-owner, cross-origin, invalid target, and invalid profile operations fail without creating or mutating jobs.
- [ ] SC-005: Chat Web and CLI expose enough status and run history to diagnose the current Ralph loop state.
- [ ] SC-006: Built-CLI verification covers `pibo ralph` discovery output and at least one JSON-producing management path without using the live default store.

## Verification Coverage

### Directly Tested

- `test/ralph-runtime-overrides.test.mjs` verifies Ralph store persistence and clearing for runtime overrides.
- `test/ralph-runtime-overrides.test.mjs` verifies the Ralph service passes model, thinking-level, and fast-mode overrides to created sessions.

### Source-Inspected Only

- Store validation, owner-scoped listing, run reservation, completion state, restart recovery, and run history beyond runtime override persistence are source-inspected from `src/ralph/store.ts`.
- Routed session creation, target resolution, message correlation, timeout, stop, cancel, and promise-complete behavior beyond runtime override propagation are source-inspected from `src/ralph/service.ts`.
- Chat Web API ownership, same-origin mutation checks, profile validation, room access checks, and run listing are source-inspected from `src/apps/chat/ralph-api.ts`.
- CLI discovery and management command output are source-inspected from `src/ralph/cli.ts` and `src/cli.ts`.
- Chat Web Ralph navigation, empty state, form behavior, and run display are source-inspected from `src/apps/chat-ui/src/RalphArea.tsx`, `src/apps/chat-ui/src/api.ts`, `src/apps/chat-ui/src/types.ts`, `src/apps/chat-ui/src/App.tsx`, and `src/apps/chat-ui/src/main.tsx`.

### Test Gaps

- Add isolated store tests for invalid job input, owner filtering, max-iteration reservation blocking, stop/cancel state, promise-complete disabling, and interrupted-run recovery.
- Add a service-level test with a fake channel context to verify routed session metadata, service message correlation, timeout handling, and cancel abort emission.
- Add Chat Web API tests for cross-origin rejection, cross-owner filtering, invalid profile rejection, room access checks, personal target ownership, and start/stop/cancel error paths.
- Add built-CLI tests for `pibo ralph` discovery output, missing owner scope errors, `add --json`, `list --json`, and `runs --json` against a temporary `--store` path.
- Add a UI-level test or browser check for the `/ralph` empty state, promise-complete token visibility, save/start/stop/cancel controls, and run-history rendering.

### Recommended Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Store validation and ownership | Reject blank owner/profile/prompt/target ids; reject non-positive `maxIterations`; persist and clear runtime overrides; default names are prompt-derived and capped; owner-scoped `listJobs`, `getOwnedJob`, `updateJob`, `removeJob`, and `listRuns` exclude other owners. | REQ-001, REQ-008 | `test/ralph-store.test.mjs`, `test/ralph-runtime-overrides.test.mjs` |
| Store reservation and state transitions | Reserve only enabled non-running jobs; return no reservation at capacity-equivalent duplicate reservation; block jobs that reached `maxIterations`; `requestStop` disables without clearing `runningAt`; `requestCancel` records both stop and cancel timestamps. | REQ-003, REQ-005, REQ-006 | `test/ralph-store.test.mjs` |
| Store completion and recovery | Successful completion increments `completedIterations`; error completion increments `consecutiveErrors`; later success resets `consecutiveErrors`; promise-complete and max-iteration paths disable the job; `recoverInterruptedRuns` marks stale running runs as `error` with reason `interrupted`. | REQ-005, REQ-007 | `test/ralph-store.test.mjs` |
| Service target and session creation | Room target fails for missing or archived rooms; personal target creates/reuses default room; created sessions use channel `pibo.chat-web`, kind `ralph`, owner scope, profile, workspace, title, `chatRoomId`, `ralphJobId`, `ralphRunId`, and `ralphTargetKind`. | REQ-002, REQ-004 | `test/ralph-service.test.mjs` |
| Service message correlation | Ralph emits one service message with an id prefixed `ralph_msg_`; unrelated sessions and unrelated event ids do not complete the run; correlated deltas plus `message_finished` complete the run; final assistant message overrides accumulated deltas. | REQ-004 | `test/ralph-service.test.mjs` |
| Service stop, cancel, timeout | `<promise>COMPLETE</promise>` completes with reason `promise-complete` and disables future runs; `stopJob` disables but does not abort the current session; `cancelJob` emits an `abort` execution event for the last running Pibo Session and completes as `cancelled`; timeout records an error unless the run was cancelled. | REQ-005, REQ-006, REQ-007 | `test/ralph-service.test.mjs` |
| Chat Web API security and validation | GET lists only current-owner jobs; POST/PATCH/DELETE and start/stop/cancel reject missing JSON content type, missing Origin, and foreign Origin; room targets require write access and reject archived rooms; personal targets must match current owner; unknown profiles fail before persistence. | REQ-001, REQ-002, REQ-008 | `test/chat-ralph-api.test.mjs` |
| Chat Web API operations | Create returns `201`; start returns `202` with a run when service is available; start returns `503` when service is missing; stop/cancel/delete return bounded not-found behavior; run listing clamps invalid or excessive limits through store behavior and rejects another owner's `jobId`. | REQ-007, REQ-008 | `test/chat-ralph-api.test.mjs` |
| CLI discovery and JSON paths | `pibo ralph` with no subcommand prints compact command discovery and `Next: pibo ralph add --help`; owner-scoped commands fail without `--owner-scope` or `PIBO_OWNER_SCOPE`; `status --json`, `add --json`, `list --json`, and `runs --json` use a temporary `--store` and produce parseable JSON. | REQ-001, REQ-009 | `test/ralph-cli.test.mjs` |
| Chat Web UI smoke | `/ralph` shows zero-job empty state; creation form exposes the exact `<promise>COMPLETE</promise>` token; save/start/stop/cancel/delete controls call the matching API paths; run history displays run status, session id when present, and error text when present. | REQ-005, REQ-006, REQ-009 | component test or browser check |

## Assumptions and Open Questions

### Assumptions

- Ralph is intentionally continuous and immediate; it is not a replacement for cron-style scheduled Pibo jobs.
- The exact token `<promise>COMPLETE</promise>` is the current user-visible stop contract.
- The web gateway is the normal host for the Ralph channel and service.

### Open Questions

- Should non-cancel consecutive errors ever auto-disable a job after a threshold?
- Should deleting a job also delete or tombstone its historical runs?
- Should Chat Web expose direct navigation from a run row to the created Pibo Session?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001: Durable owner-scoped records | Create a stopped room job | Current `PiboRalphStore` behavior | Draft |
| REQ-002: Targets resolve to Chat rooms | Personal target creates default room | Current `PiboRalphService.resolveTarget` and Chat API behavior | Draft |
| REQ-003: Exclusive bounded reservation | Duplicate tick | Current `reserveJob` and service capacity behavior | Draft |
| REQ-004: Routed session execution | Session finishes normally | Current `executeJob` / `emitMessageAndWait` behavior | Draft |
| REQ-005: Deterministic completion controls | Agent promises completion | Current `completeRun` and promise-complete behavior | Draft |
| REQ-006: Cancel aborts active session | User cancels active run | Current `requestCancel` and `abortJobIfRunning` behavior | Draft |
| REQ-007: Auditable errors and recovery | Gateway restarts during active run | Current timeout and recovery behavior | Draft |
| REQ-008: Authenticated API | Cross-site mutation is rejected | Current `handleChatRalphApiRequest` behavior | Draft |
| REQ-009: Discoverable management | User opens Ralph area with no jobs | Current CLI and `RalphArea` behavior | Draft |

## Verification Basis

Source files inspected for this spec:

- `src/ralph/types.ts`
- `src/ralph/store.ts`
- `src/ralph/service.ts`
- `src/ralph/channel.ts`
- `src/ralph/plugin.ts`
- `src/ralph/cli.ts`
- `src/apps/chat/ralph-api.ts`
- `src/apps/chat-ui/src/RalphArea.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/gateway/web.ts`
- `src/cli.ts`
