# Spec: Scheduled Pibo Jobs

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`

## Why

Pibo needs a durable way to run agent work later or on a repeating schedule. Scheduled jobs let a user ask an agent to perform recurring room or shared default Chat tasks without keeping a browser interaction open.

The behavior crosses the product boundary: jobs are configured through Chat Web or the operator CLI, persisted in a Pibo-managed store, executed by a channel service, and materialized as normal routed Pibo Sessions.

## Goal

Pibo MUST persist scheduled agent jobs, reserve due runs without double execution, create visible Chat Web sessions for each run, and record run outcomes.

## Background / Current State

The current implementation defines a cron subsystem under `src/cron/`. It stores jobs and runs in SQLite, supports one-shot, interval, and five-field cron schedules, exposes `pibo cron` CLI operations, and exposes Chat Web APIs under `/api/chat/cron/*`. A `pibo.cron` channel starts `PiboCronService`, which polls due jobs and sends a generated task prompt into a newly created Pibo Session.

The Chat Web UI has a `Cron` area that lists jobs, builds schedules, targets Shared Chat or a Room, saves jobs, triggers manual runs, and shows recent runs.

## Scope

### In Scope

- Cron job creation, update, delete, list, pause, resume, status, and run history.
- Schedule parsing and next-run computation for one-shot, interval, daily, weekly, monthly, and raw cron schedules.
- Room and shared default Chat targets.
- App-context Chat Web and CLI store operations.
- Scheduled and manual run reservation.
- Creation of a routed Pibo Session for each run.
- Run completion, error recording, interrupted-run recovery, and one-shot cleanup behavior.

### Out of Scope

- Distributed scheduler coordination across multiple machines.
- Calendar UI beyond the current schedule builder concepts.
- Editing an already-created run.
- Retrying failed cron runs automatically beyond the next scheduled occurrence.
- Guaranteeing real-time execution at the exact scheduled millisecond.
- Creating nested cron jobs from a cron run unless the original task explicitly asks for it.

## Requirements

### Requirement: Jobs are durable app-context records

The system MUST store cron jobs with target, profile, prompt, schedule, enabled flag, delete-after-run flag, timestamps, and scheduler state. Legacy controller fields are compatibility metadata only.

#### Current

`PiboCronStore` persists jobs in `pibo_cron_jobs` and run records in `pibo_cron_runs`.

#### Acceptance

- Creating a valid job returns an id beginning with `cron_`.
- Listing jobs returns app-context jobs for any allowed account.
- Disabled jobs remain stored but are excluded from default active lists.

#### Scenario: Create a room-targeted job

- GIVEN a user has write access to a non-archived room
- WHEN the user creates a cron job with target `{ kind: "room", roomId }`
- THEN the job is stored with the room target, selected profile, prompt, schedule, and computed `state.nextRunAt` when enabled.

#### Scenario: Invalid job input

- GIVEN a create or update request with an empty profile, prompt, or required target id
- WHEN the store validates the job
- THEN it rejects the request with a validation error and does not write a partial job.

### Requirement: Schedules are validated before persistence

The system MUST reject schedules that cannot produce a valid future run for enabled jobs.

#### Current

`validateSchedule`, `parseFriendlySchedule`, and `computeNextRunAt` support `at`, `every`, and five-field `cron` schedules plus friendly UI presets.

#### Acceptance

- `every` schedules shorter than one minute are rejected.
- `at` schedules must parse as dates.
- Cron expressions must contain exactly five fields.
- Cron time zones must be valid IANA time zones when supplied.
- Enabled one-shot jobs scheduled in the past cannot be created with a future `nextRunAt`.

#### Scenario: Repeating interval

- GIVEN a job with `schedule.kind = "every"`, `everyMs = 600000`, and an anchor time
- WHEN the scheduler computes the next run after the current time
- THEN `state.nextRunAt` is the next interval boundary after now.

#### Scenario: Friendly weekly schedule

- GIVEN a weekly UI schedule with weekdays and `HH:MM`
- WHEN the schedule is normalized
- THEN Pibo stores a five-field cron expression and keeps `scheduleUi` so the UI can render the original preset.

### Requirement: The scheduler reserves due work atomically

The system MUST reserve due jobs before execution so one scheduler tick does not start the same job twice.

#### Current

`reserveDueRuns` opens an immediate transaction, skips jobs with `state.runningAt`, creates a running run record, and writes `runningAt`, `lastRunAt`, and `lastRunId` to the job state.

#### Acceptance

- A due job with no `runningAt` can be reserved once.
- A due job with `runningAt` is skipped.
- Reservation creates a `crun_` run with status `running`.
- The scheduler respects its configured maximum concurrent runs.

#### Scenario: Concurrent capacity is full

- GIVEN the service has `activeRuns` equal to `maxConcurrentRuns`
- WHEN the scheduler ticks
- THEN no additional due jobs are reserved in that tick.

### Requirement: Each run creates a visible routed Pibo Session

The system MUST execute each reserved run by creating a Pibo Session through the channel context and emitting one service-authored message into that session.

#### Current

`PiboCronService.executeJob` creates a session with channel `pibo.chat-web`, kind `cron`, the job profile, target workspace, title, and cron metadata. It then emits the generated cron prompt and waits for `message_finished` or `session_error`.

#### Acceptance

- Each successful run records the created `piboSessionId` on the run and in job state.
- The created session metadata includes `chatRoomId`, `cronJobId`, `cronRunId`, and `cronTargetKind`.
- The generated prompt identifies the job name, formatted schedule, target kind, and task text.
- The generated prompt tells the agent not to create another cron job unless explicitly requested by the scheduled task.

#### Scenario: Room target execution

- GIVEN a cron job targets an existing non-archived room
- WHEN the run executes
- THEN the new Pibo Session is associated with that room and uses the room workspace when present.

#### Scenario: Shared default target execution

- GIVEN a cron job targets Shared Chat
- WHEN the run executes
- THEN Pibo ensures the shared default room exists and creates the cron session in that room.

### Requirement: Target access and safety are enforced

The system MUST prevent Chat Web users from creating or changing jobs that target missing or archived rooms. Deprecated default-chat targets normalize to the shared default target.

#### Current

`handleChatCronApiRequest` validates same-origin JSON mutations, room existence, archived-room state, profile names, prompt length, and shared default target normalization.

#### Acceptance

- JSON mutations without `Content-Type: application/json` are rejected.
- JSON mutations without a same-origin `Origin` header are rejected.
- Archived room targets are rejected.
- Unknown profiles are rejected.
- Deprecated personal cron targets are normalized to the shared default target.

#### Scenario: Archived room

- GIVEN a room is archived
- WHEN a user tries to create a cron job targeting that room
- THEN the request fails and no job is created.

### Requirement: Run outcomes update both run and job state

The system MUST complete each run with `ok`, `error`, or `skipped` state and update the parent job state consistently.

#### Current

`completeRun` writes the run status, optional session id, reason, error, completion time, next run time, last status, last error, last session id, and consecutive error count.

#### Acceptance

- Successful repeating jobs compute a new future `nextRunAt`.
- Successful one-shot `at` jobs are disabled after completion.
- One-shot jobs with `deleteAfterRun` are removed after a successful run.
- Error runs increment `consecutiveErrors` and preserve the error text.
- Non-error completions reset `consecutiveErrors` to zero.

#### Scenario: Gateway restart recovery

- GIVEN a job has been marked running longer than the recovery cutoff
- WHEN the cron store recovers interrupted runs
- THEN the last run is completed as `error` with an interruption reason, or the stale running marker is cleared when no run id exists.

### Requirement: CLI management is progressively discoverable

The `pibo cron` CLI MUST provide compact discovery output and focused subcommands for local operator management.

#### Current

`runCronCli` exposes `status`, `list`, `add`, `pause`, `resume`, `remove`, and `runs`.

#### Acceptance

- `pibo cron` or `pibo cron --help` prints only the cron command surface and a next-step hint.
- Normal commands do not require `--app-space`; deprecated app-space inputs are ignored compatibility options.
- `status` can read the store without legacy app-space compatibility input.
- `add` accepts exactly one schedule source among friendly flags or a raw cron expression.
- `--json` outputs machine-readable objects where supported.

#### Scenario: Pause and resume

- GIVEN an controller has an enabled cron job
- WHEN the controller runs `pibo cron pause <id>`
- THEN the job is disabled and has no next scheduled run.
- WHEN the controller runs `pibo cron resume <id>`
- THEN the job is enabled and `nextRunAt` is recomputed from the current time.

### Requirement: Chat Web exposes cron APIs and UI

Chat Web MUST expose authenticated APIs and a visible Cron area for managing scheduled Pibo Sessions.

#### Current

The API lives under `/api/chat/cron/*`, and `CronArea` provides the UI for job lists, status, schedule building, target selection, prompt entry, save/delete, manual run, and recent runs.

#### Acceptance

- `GET /api/chat/cron/status` returns scheduler and store status.
- `GET /api/chat/cron/jobs` returns app context jobs.
- `POST /api/chat/cron/jobs` creates a job after validation.
- `GET/PATCH/DELETE /api/chat/cron/jobs/:id` operate on app context jobs by id.
- `POST /api/chat/cron/jobs/:id/run` starts a manual run when the cron service is running.
- `GET /api/chat/cron/runs` lists app context runs, optionally filtered by job.
- The UI can select Shared Chat or a Room target and select a registered agent profile.

#### Scenario: Manual run from Chat Web

- GIVEN a saved shared cron job exists and the cron service is running
- WHEN the user clicks Run now
- THEN the API returns `202` with a running run record and the run later appears in recent runs with its final status.

### Requirement: Chat Web schedule builder maps form state to backend schedules

The Cron area MUST let users create and edit schedules through stable presets while sending only schedule shapes accepted by the backend API.

#### Current

`CronArea` stores a browser draft, renders preset cards for `in`, `at`, `every`, `daily`, `weekly`, `monthly`, and raw `cron`, previews the generated schedule, and converts the draft to `CronJobInput` before save.

#### Target

Users can round-trip an existing cron job through the UI without losing its target, profile, prompt, one-shot cleanup flag, schedule preset, timezone, or stored advanced cron expression.

#### Acceptance

- New drafts default to an enabled Shared Chat daily schedule, the first available non-archived room option, and the first visible agent profile.
- One-shot `in` and `at` drafts are sent as friendly schedule inputs that the backend normalizes to absolute `at` schedules.
- Recurring daily, weekly, monthly, interval, and raw cron drafts are sent as backend-supported cron inputs with optional timezone.
- Weekly drafts require at least one weekday before previewing or saving a generated cron expression.
- Existing jobs with `scheduleUi` hydrate the matching preset controls instead of forcing raw cron editing.
- Existing jobs without `scheduleUi` hydrate from stored `at`, `every`, or five-field cron values when possible and fall back to raw cron when not recognized.

#### Scenario: Edit an existing weekly job

- GIVEN a saved job has `scheduleUi.preset = "weekly"`, weekdays, time, and timezone
- WHEN the user opens the job in the Cron area
- THEN the weekly preset is selected with the stored weekdays, time, and timezone
- AND saving without changes sends an equivalent backend schedule.

### Requirement: Chat Web run history remains bounded and navigable

The Cron area MUST show recent shared run status and provide a direct path from a completed cron run to its created Pibo Session when one exists.

#### Current

`CronArea` loads status, jobs, and up to 100 runs, filters visible runs by selected job in the browser, and renders a session link for runs with `piboSessionId`.

#### Target

Users can inspect recent job outcomes without scanning unrelated rooms, and can open the visible session created by a scheduled run.

#### Acceptance

- Initial Cron area load fetches scheduler status, jobs including disabled jobs, and the latest runs in parallel.
- Selecting a job refreshes run history filtered by that job id.
- Running a job manually refreshes history for the selected job after the API accepts the run.
- Recent-run rows display status, start time, optional session link, and error text.
- Session links use `/apps/chat/sessions/<piboSessionId>` and do not expose unrelated run payload data.
- API run-list requests filter by existing shared job id when supplied.

#### Scenario: Open a completed cron session

- GIVEN a selected job has a recent run with `status = "ok"` and `piboSessionId`
- WHEN the user clicks the session link in Recent runs
- THEN Chat Web navigates to that Pibo Session's normal session route.

## Edge Cases

- A target room can be deleted after job creation; execution MUST fail the run rather than creating a session in an unknown room.
- A target room can be archived after job creation; execution MUST fail the run rather than writing into the archived room.
- The cron service may be unavailable while the store remains readable; status MUST still return store status and manual run MUST return service unavailable.
- A running job may outlive a gateway process; recovery MUST mark stale runs as interrupted after the cutoff.
- Cron expressions may produce no next run within the implementation search window; enabled jobs without a future run MUST be rejected or left without a next run only when disabled or completed.
- Schedule UI metadata may be absent; formatting MUST fall back to the stored schedule.

## Constraints

- **Compatibility:** Cron-created sessions MUST use normal Pibo Session routing and Chat Web room metadata instead of a separate transcript system.
- **Security / Privacy:** Chat Web mutation APIs MUST require authenticated same-origin JSON requests. Auth account values do not partition Cron jobs; deprecated default-chat targets normalize to the shared default target.
- **Performance:** The scheduler SHOULD poll at bounded intervals and reserve only up to configured capacity per tick.
- **Reliability:** Store writes that reserve or complete runs MUST be transactional enough to avoid duplicate running records for the same job.
- **Product Boundary:** Cron jobs are Pibo product objects. The Pi Coding Agent only receives the generated task prompt inside the created routed session.

## Success Criteria

- [ ] SC-001: A user can create an enabled repeating job from Chat Web and see `nextRunAt` in the job list.
- [ ] SC-002: A due job creates exactly one visible cron-kind Pibo Session per reserved run.
- [ ] SC-003: A successful run records `ok`, `completedAt`, and the created `piboSessionId`.
- [ ] SC-004: A failed run records `error`, increments `consecutiveErrors`, and does not lose the run record.
- [ ] SC-005: `pibo cron list` lists app context jobs and excludes disabled jobs by default.
- [ ] SC-006: Chat Web rejects cron job mutations for archived or inaccessible rooms.
- [ ] SC-007: Interrupted running jobs are recovered as errors after service restart and cutoff.
- [ ] SC-008: Existing Chat Web cron jobs with friendly schedule metadata round-trip through the schedule builder without changing their effective backend schedule.
- [ ] SC-009: Recent-run history in Chat Web filters by selected job and links completed runs to their created Pibo Session.

## Assumptions and Open Questions

### Assumptions

- The active gateway process is the only scheduler controller in normal local deployments.
- Authentication is only the app access gate; Cron jobs and runs are app context resources.
- A cron run is complete when the initial generated message finishes or the session errors; follow-up user interaction happens in the created session outside the cron scheduler.

### Open Questions

- Should failed one-shot jobs remain enabled for manual retry, or should they become disabled after a failure?
- Should the scheduler publish product events for job and run lifecycle changes through the Reliable Event Core?
- Should cron runs support configurable timeout per job instead of only a service-wide timeout?
- Should job prompts have a structured template version stored with the run for auditability?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Jobs are durable app-context records | Create a room-targeted job; invalid input | `src/cron/types.ts`, `src/cron/store.ts` | Implemented |
| REQ-002 Schedules are validated before persistence | Repeating interval; friendly weekly schedule | `src/cron/schedule.ts` | Implemented |
| REQ-003 The scheduler reserves due work atomically | Concurrent capacity is full | `src/cron/store.ts`, `src/cron/service.ts` | Implemented |
| REQ-004 Each run creates a visible routed Pibo Session | Room target execution; shared default target execution | `src/cron/service.ts` | Implemented |
| REQ-005 Target access and safety are enforced | Archived room | `src/apps/chat/cron-api.ts` | Implemented |
| REQ-006 Run outcomes update both run and job state | Gateway restart recovery | `src/cron/store.ts` | Implemented |
| REQ-007 CLI management is progressively discoverable | Pause and resume | `src/cron/cli.ts`, `src/cli.ts` | Implemented |
| REQ-008 Chat Web exposes cron APIs and UI | Manual run from Chat Web | `src/apps/chat/cron-api.ts`, `src/apps/chat-ui/src/CronArea.tsx` | Implemented |
| REQ-009 Chat Web schedule builder maps form state to backend schedules | Edit an existing weekly job | `src/apps/chat-ui/src/CronArea.tsx`, `src/apps/chat/cron-api.ts`, `src/cron/schedule.ts` | Implemented |
| REQ-010 Chat Web run history remains bounded and navigable | Open a completed cron session | `src/apps/chat-ui/src/CronArea.tsx`, `src/apps/chat-ui/src/api.ts`, `src/apps/chat/cron-api.ts` | Implemented |

## Verification Basis

This spec is based on the current workspace code in:

- `src/cron/types.ts`
- `src/cron/store.ts`
- `src/cron/schedule.ts`
- `src/cron/service.ts`
- `src/cron/cli.ts`
- `src/cron/channel.ts`
- `src/apps/chat/cron-api.ts`
- `src/apps/chat-ui/src/CronArea.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat/types/rooms.ts`
