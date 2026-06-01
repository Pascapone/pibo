# Pibo Cron Jobs Implementation Plan

## Status

Planned. This document describes the implementation approach for room-bound and personal-chat-bound scheduled agent jobs in Pibo.

## Goals

Pibo should support scheduled agent work that users and agents can create, inspect, edit, run manually, pause, and delete.

A scheduled job must target one of two Chat Web destinations:

1. **Room-bound job**: each run creates a new visible Pibo Session in the selected Pibo Room. The run starts in the room's workspace. The user can inspect the session, transcript, tools, and result in that room.
2. **Personal-chat-bound job**: each run creates a new visible Pibo Session in the user's Personal Chat Room. It uses the normal personal-chat workspace behavior and appears in the personal chat.

Each job must let the creator select:

- target: room or personal chat
- agent/profile
- prompt/task
- schedule
- enabled/disabled state
- optional name and description

The product should expose both:

- a human-friendly UI for schedule creation
- an agent/CLI-friendly structured interface that can express the same schedules

## Non-goals for V1

Do not implement these in V1 unless explicitly requested later:

- external channel delivery such as Telegram, Slack, or webhook delivery
- shell-script-only jobs with no agent
- multi-step cron workflows or job dependencies
- recurring jobs that reuse the same agent session across runs
- per-job custom tool allowlists
- per-job model overrides beyond selecting the Pibo profile/agent
- cloud/server distributed scheduling
- editing system crontab entries

V1 should stay product-local and Chat Web-visible.

## Reference implementations reviewed

### OpenClaw

Relevant files:

- `/root/code/openclaw/src/cron/types.ts`
- `/root/code/openclaw/src/cron/service.ts`
- `/root/code/openclaw/src/cron/service/state.ts`
- `/root/code/openclaw/src/cron/service/ops.ts`
- `/root/code/openclaw/src/cron/service/timer.ts`
- `/root/code/openclaw/src/cron/store.ts`
- `/root/code/openclaw/src/cron/run-log.ts`
- `/root/code/openclaw/src/cron/isolated-agent/run.ts`
- `/root/code/openclaw/src/cron/isolated-agent/run-executor.ts`
- `/root/code/openclaw/src/cron/isolated-agent/session.ts`
- `/root/code/openclaw/src/cli/cron-cli/register.cron-add.ts`
- `/root/code/openclaw/src/gateway/server-methods/cron.ts`
- `/root/code/openclaw/src/agents/tools/cron-tool.ts`
- `/root/code/openclaw/ui/src/ui/controllers/cron.ts`
- `/root/code/openclaw/docs/automation/cron-jobs.md`

OpenClaw puts the scheduler in the Gateway process. Jobs persist in a JSON store. The scheduler supports `at`, `every`, and `cron` schedules. It tracks job state, running markers, last result, delivery result, run history, retries, startup catch-up, and manual runs.

OpenClaw distinguishes `sessionTarget="main"` from `sessionTarget="isolated"`. Main-session jobs enqueue a system event and wake the heartbeat. Isolated jobs run a detached agent turn in a cron-specific session.

Pibo should copy the product-level idea, not the exact session-key model. Pibo already has Pibo Rooms, Pibo Sessions, a Pibo Session Store, and a Session Router. Cron runs should create real Pibo Sessions, not rely on string-key conventions.

### Hermes Agent

Relevant files:

- `/root/code/hermes-agent/cron/jobs.py`
- `/root/code/hermes-agent/cron/scheduler.py`
- `/root/code/hermes-agent/hermes_cli/cron.py`
- `/root/code/hermes-agent/tools/cronjob_tools.py`
- `/root/code/hermes-agent/hermes_cli/web_server.py`
- `/root/code/hermes-agent/web/src/pages/CronPage.tsx`

Hermes has a simpler JSON-file scheduler. Its useful ideas are the human-friendly schedule syntax and the explicit job workdir. It accepts relative durations, intervals, cron expressions, and ISO timestamps.

Pibo should adopt the UX idea: humans should not need to write cron expressions for common schedules. The backend should still normalize to a strict schedule model.

## Current Pibo architecture touchpoints

Relevant Pibo files:

- `src/sessions/store.ts`
- `src/sessions/sqlite-store.ts`
- `src/core/session-router.ts`
- `src/core/routed-session.ts`
- `src/gateway/server.ts`
- `src/gateway/web.ts`
- `src/web/channel.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/data/room-service.ts`
- `src/apps/chat/types/rooms.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/reliability/store.ts`
- `src/data/schema.ts`
- `src/data/pibo-store.ts`
- `src/cli.ts`
- `src/core/profiles.ts`
- `src/core/runtime.ts`
- `src/plugins/builtin.ts`

Important existing concepts:

- A Pibo Session is the product-level route identity.
- A Pi Session ID is the engine-level persistence identity.
- A Pibo Room is the Chat Web container.
- Chat Web currently links sessions to rooms through `PiboSession.metadata.chatRoomId`.
- Personal Chat Room is created by `ChatRoomService.ensureDefaultRoom(...)`.
- A session workspace can be set on `PiboSession.workspace`.
- `PiboSessionRouter.emit(...)` accepts `PiboMessageEvent` and routes it to the agent runtime.
- Chat Web indexes router output events and writes them into its event stores.

## Core design

### Runtime behavior

Each cron run creates a new Pibo Session. The session is visible in Chat Web and uses the selected profile.

For a room-bound job:

1. Load the target room.
2. Require that the room still exists and is not archived.
3. Create a Pibo Session with:
   - `channel: "pibo.chat-web"`
   - `kind: "cron"`
   - `profile: job.profile`
   - `ownerScope: job.ownerScope`
   - `workspace: room.workspace ?? getDefaultPiboWorkspace()`
   - `title: job.name`
   - `metadata.chatRoomId = room.id`
   - `metadata.cronJobId = job.id`
   - `metadata.cronRunId = run.id`
   - `metadata.cronTargetKind = "room"`
4. Route the job prompt into the new session as a service message.
5. Let Chat Web indexing persist the transcript and live events.

For a personal-chat-bound job:

1. Ensure the user's Personal Chat Room exists.
2. Create a Pibo Session in that room with:
   - `channel: "pibo.chat-web"`
   - `kind: "cron"`
   - `profile: job.profile`
   - `ownerScope: job.ownerScope`
   - `workspace: getDefaultPiboWorkspace()` unless the personal room has a workspace
   - `metadata.chatRoomId = personalRoom.id`
   - `metadata.cronJobId = job.id`
   - `metadata.cronRunId = run.id`
   - `metadata.cronTargetKind = "personal"`
3. Route the job prompt into that session.

The agent should not deliver the result manually. It should answer normally. Chat Web displays the answer in the new session.

### Prompt envelope

The scheduler should wrap the user-supplied prompt with a small service preface. The preface must be concise and should not hide the user task.

Example:

```text
You are running a scheduled Pibo job.
Job: <job name>
Schedule: <human schedule>
Target: <room or personal chat>

Complete the scheduled task below. Return the result in this session. Do not create another cron job unless the user explicitly requested that in the original task.

Task:
<prompt>
```

The original prompt should remain clearly visible in the session so users can audit what the job did.

### Job target model

```ts
type PiboCronTarget =
  | { kind: "room"; roomId: string }
  | { kind: "personal"; principalId: string };
```

Store `ownerScope` on the job independently from the target. Use it for authorization and listing.

### Schedule model

Use a strict internal model:

```ts
type PiboCronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };
```

Also store optional UI metadata so the editor can restore the user's original choice:

```ts
type PiboCronScheduleUi =
  | { preset: "in"; amount: number; unit: "minutes" | "hours" | "days" }
  | { preset: "at"; localDateTime: string; tz?: string }
  | { preset: "every"; amount: number; unit: "minutes" | "hours" | "days" }
  | { preset: "daily"; time: string; tz?: string }
  | { preset: "weekly"; weekdays: number[]; time: string; tz?: string }
  | { preset: "monthly"; dayOfMonth: number; time: string; tz?: string }
  | { preset: "advanced"; expr: string; tz?: string };
```

The scheduler only uses `schedule`. UI and CLI helpers translate human presets into `schedule`.

### Job model

```ts
type PiboCronJob = {
  id: string;
  ownerScope: string;
  name: string;
  description?: string;
  enabled: boolean;
  target: PiboCronTarget;
  profile: string;
  prompt: string;
  schedule: PiboCronSchedule;
  scheduleUi?: PiboCronScheduleUi;
  deleteAfterRun?: boolean;
  state: PiboCronJobState;
  createdAt: string;
  updatedAt: string;
};

type PiboCronJobState = {
  nextRunAt?: string;
  runningAt?: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastRunId?: string;
  lastPiboSessionId?: string;
  consecutiveErrors?: number;
};
```

### Run model

```ts
type PiboCronRun = {
  id: string;
  jobId: string;
  ownerScope: string;
  piboSessionId?: string;
  status: "queued" | "running" | "ok" | "error" | "skipped";
  reason?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

A run record exists even if session creation fails. That makes failures visible in the UI.

## Persistence design

Use SQLite, not JSON. Pibo already uses SQLite for sessions, Chat Web data, and reliability data.

Preferred V1 option: add cron tables to `PiboReliabilityStore` in `.pibo/pibo-events.sqlite`, because the glossary already defines the reliability store as the place for durable jobs and yielded-run records.

Alternative: create `.pibo/pibo-cron.sqlite`. This is simpler to isolate but adds another store.

Recommended V1: extend `src/reliability/store.ts` with cron-specific tables.

Tables:

```sql
CREATE TABLE IF NOT EXISTS pibo_cron_jobs (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL,
  target_json TEXT NOT NULL,
  profile TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  schedule_ui_json TEXT,
  delete_after_run INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pibo_cron_jobs_owner
  ON pibo_cron_jobs(owner_scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pibo_cron_jobs_enabled_next
  ON pibo_cron_jobs(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS pibo_cron_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  pibo_session_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pibo_cron_runs_job_created
  ON pibo_cron_runs(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pibo_cron_runs_owner_created
  ON pibo_cron_runs(owner_scope, created_at DESC);
```

Keep schedule state inside `state_json` for V1 to reduce migrations. If filtering by next due time becomes a performance problem, add `next_run_at` as a first-class column later.

## Scheduler design

Create a new module tree:

```text
src/cron/
  types.ts
  schedule.ts
  store.ts
  service.ts
  channel.ts
  cli.ts
  tool.ts
```

### `src/cron/schedule.ts`

Responsibilities:

- parse friendly schedule inputs
- validate `at`, `every`, and cron schedules
- compute next run
- format schedule for display

Use a small internal parser first. Add a cron library only if needed. Pibo currently has no cron dependency. If we add one, prefer `croner`, as OpenClaw uses it successfully.

Functions:

```ts
computeNextRunAt(schedule: PiboCronSchedule, now: Date): Date | undefined
parseFriendlySchedule(input: FriendlyScheduleInput, now: Date): { schedule: PiboCronSchedule; scheduleUi?: PiboCronScheduleUi }
formatSchedule(schedule: PiboCronSchedule, scheduleUi?: PiboCronScheduleUi): string
```

### `src/cron/store.ts`

Responsibilities:

- create/update/delete/list jobs
- create/update/list runs
- set and clear running markers
- recompute `nextRunAt`
- enforce owner-scope filters

Important rules:

- A job cannot run twice concurrently.
- A disabled job has no due run.
- A one-shot job is disabled or deleted after success, depending on `deleteAfterRun`.
- A malformed schedule should mark the job as error instead of crashing the scheduler.

### `src/cron/service.ts`

Responsibilities:

- start/stop timer
- find due jobs
- reserve runs
- execute runs with bounded concurrency
- update job state after completion
- expose status/list/add/update/remove/run methods

Use a timer pattern like OpenClaw:

- arm at the nearest due time
- clamp long waits to periodic wakeups, for example 60 seconds
- enforce a minimum re-arm delay when a job is stale to avoid hot loops
- on startup, clear stale `runningAt` markers and recompute future schedules

Do not hold a SQLite transaction while an agent run executes. Reserve the run under lock, then execute outside the lock, then persist the result.

### `src/cron/channel.ts`

Implement a Pibo channel that starts the scheduler with access to `PiboChannelContext`.

Reason: `PiboGatewayServer.createChannelContext()` exposes exactly what cron needs:

- `createSession(...)`
- `updateSession(...)`
- `getSession(...)`
- `listSessions(...)`
- `emit(...)`
- `getProfiles(...)`

The channel should have `auth.mode: "required"` or equivalent product-owned semantics because it operates on user-owned sessions. The channel itself does not accept external messages.

Pseudo-structure:

```ts
export function createPiboCronChannel(options?: PiboCronOptions): PiboChannel {
  let service: PiboCronService | undefined;
  return {
    name: "pibo.cron",
    kind: "cron",
    description: "Runs scheduled Pibo agent jobs.",
    auth: { mode: "required" },
    async start(context) {
      service = new PiboCronService({ context, store, now });
      await service.start();
    },
    async stop() {
      await service?.stop();
      service = undefined;
    },
  };
}
```

The service should expose a singleton lookup for same-process API handlers and CLI gateway calls, or the channel should register gateway/product actions through the plugin registry.

### Run execution function

Pseudo-flow:

```ts
async function executeCronRun(job: PiboCronJob, run: PiboCronRun) {
  const target = await resolveTarget(job);
  const session = context.createSession({
    channel: CHAT_WEB_CHANNEL,
    kind: "cron",
    profile: job.profile,
    ownerScope: job.ownerScope,
    workspace: target.workspace,
    title: job.name,
    metadata: {
      chatRoomId: target.roomId,
      cronJobId: job.id,
      cronRunId: run.id,
      cronTargetKind: job.target.kind,
    },
  });

  await appendCronStartedChatEvent(...);

  await context.emit({
    type: "message",
    piboSessionId: session.id,
    id: randomUUID(),
    source: "service",
    text: buildCronPrompt(job),
  });

  await markRunOk(run.id, session.id);
}
```

Important: `context.emit(...)` returns once the routed session has queued the message, not necessarily after the full assistant reply. To mark completion accurately, either:

1. use `PiboSessionRouter.emitMessageAndWaitForReply(...)` by adding a channel-context helper, or
2. subscribe to router output and wait for `message_finished` or `session_error` for the cron message id.

Recommended: add a narrow `emitAndWaitForReply` helper to `PiboChannelContext`, backed by `PiboSessionRouter.emitMessageAndWaitForReply(...)`. This avoids duplicating event-waiting logic in cron.

Acceptance requires the run record to become `ok` only after the message finishes.

## API design

### Internal service methods

```ts
type PiboCronServiceApi = {
  status(): Promise<PiboCronStatus>;
  listJobs(input: { ownerScope: string; includeDisabled?: boolean }): Promise<PiboCronJob[]>;
  getJob(input: { ownerScope: string; id: string }): Promise<PiboCronJob>;
  addJob(input: PiboCronJobCreate): Promise<PiboCronJob>;
  updateJob(input: { ownerScope: string; id: string; patch: PiboCronJobPatch }): Promise<PiboCronJob>;
  removeJob(input: { ownerScope: string; id: string }): Promise<{ removed: boolean }>;
  runJob(input: { ownerScope: string; id: string; mode: "due" | "force" }): Promise<PiboCronRun>;
  listRuns(input: { ownerScope: string; jobId?: string; limit?: number; offset?: number }): Promise<PiboCronRun[]>;
};
```

### Chat Web API

Add endpoints under `src/apps/chat/web-app.ts` or split them into a new route helper to keep the file manageable.

Proposed endpoints:

- `GET /api/chat/cron/status`
- `GET /api/chat/cron/jobs`
- `POST /api/chat/cron/jobs`
- `GET /api/chat/cron/jobs/:id`
- `PATCH /api/chat/cron/jobs/:id`
- `DELETE /api/chat/cron/jobs/:id`
- `POST /api/chat/cron/jobs/:id/run`
- `GET /api/chat/cron/runs?jobId=<id>`

Authorization:

- Use `requireSession(request, context)`.
- Filter all list/read/update/delete operations by `webSession.ownerScope`.
- For room targets, require room access:
  - create: write access
  - list: owner scope filter plus room visibility
  - update target room: write access to new room
  - delete: job owner scope is enough; if we add room admin rules later, enforce them then

Validation:

- profile must exist in `context.channelContext.getProfiles()`
- room must exist for `target.kind="room"`
- prompt must be non-empty
- schedule must normalize to a future or recurring schedule
- personal target must use the current principal id

## CLI design

Add a top-level `pibo cron` branch in `src/cli.ts`, implemented in `src/cron/cli.ts`.

Discovery must follow Pibo CLI rules: each help level should expose only immediate actions and point to deeper help.

Commands:

```bash
pibo cron
pibo cron status
pibo cron list [--all] [--json]
pibo cron add --room <roomId> --agent <profile> --prompt <text> [schedule]
pibo cron add --personal --agent <profile> --prompt <text> [schedule]
pibo cron edit <id> [fields]
pibo cron pause <id>
pibo cron resume <id>
pibo cron run <id> [--force]
pibo cron remove <id>
pibo cron runs [--job <id>] [--json]
```

Schedule flags:

```bash
--in 20m
--at "2026-05-10T08:00:00-07:00"
--every 2h
--daily 08:00
--weekly mon,wed 09:30
--monthly 1 08:00
--cron "0 8 * * *" --tz Europe/Berlin
```

Examples:

```bash
pibo cron add \
  --room room_abc \
  --agent codex-compat-openai-web \
  --in 20m \
  --prompt "Check the test status and summarize failures."

pibo cron add \
  --personal \
  --agent my-morning-agent \
  --daily 08:00 \
  --tz America/Los_Angeles \
  --prompt "Prepare my morning briefing."
```

CLI can call the same local store/service when running inside the gateway process is unavailable, but V1 should prefer same-origin/Gateway API when the gateway is running. If the gateway is not running, CLI should print a clear message that jobs will not execute until the gateway is started.

## Agent-facing tool design

Register a native Pibo tool, for profiles that include it, similar to Hermes' `cronjob` and OpenClaw's `cron` tool.

Suggested tool name: `cron` or `pibo_cron`. Prefer `cron` if no naming collision exists in Pi profiles.

Actions:

- `status`
- `list`
- `add`
- `update`
- `pause`
- `resume`
- `remove`
- `run`
- `runs`

Schema should accept structured schedule input and friendly schedule input:

```json
{
  "action": "add",
  "target": { "kind": "room", "roomId": "room_..." },
  "profile": "codex-compat-openai-web",
  "name": "Build check",
  "prompt": "Check CI and summarize failures.",
  "schedule": { "kind": "in", "value": "20m" }
}
```

The tool must not let a job created by one owner scope target another owner's room or personal chat.

Tool prompt guidance:

- Always use a self-contained prompt.
- Do not create recursive cron jobs unless the user explicitly asked.
- Use personal target only if the user asks for their personal chat or no current room target is known.
- Use room target when the user says “in this room” or references a room.
- Prefer friendly schedules for simple requests; backend normalizes them.

## UI design

Add a Cron Jobs area to Chat Web.

### Navigation

Provide either:

- a global “Cron Jobs” page in Chat Web, plus target filters, or
- a room settings panel with a cron tab, plus a personal/global cron page.

Recommended V1: global page with filters and a “Create Job” button. Add a room shortcut later.

### Job list

Columns/cards:

- name
- target: room name or Personal Chat
- agent/profile
- schedule summary
- next run
- enabled state
- last status
- last run session link
- actions: run now, pause/resume, edit, delete

Filters:

- target type
- room
- enabled/disabled
- status
- search by name/prompt/profile

### Create/edit form

Fields:

- Name
- Description
- Target:
  - Current room
  - Select room
  - Personal Chat
- Agent/profile selector
- Prompt textarea
- Schedule mode:
  - Once in X minutes/hours/days
  - Once at date/time
  - Every X minutes/hours/days
  - Daily at time
  - Weekly on weekdays at time
  - Monthly on day/time
  - Advanced cron expression
- Timezone selector for wall-clock schedules
- Enabled toggle
- Delete after successful one-shot run toggle

Validation should happen client-side and server-side.

### Run visibility

After a manual “Run now” action, UI should show:

- run record status
- link to the created Pibo Session once available
- error if session creation or routing fails

When a scheduled run creates a session, the room's session list should update through existing Chat Web invalidation/live event behavior. If this does not happen automatically, add a lightweight product event or SSE event to refresh cron/session lists.

## Implementation phases

### Phase 0: Development setup

Before code changes, follow project policy:

1. Run `pibo compute spawn`.
2. Work inside the Docker worker worktree.
3. Use the worker's web and CDP ports for browser checks.
4. Do not develop against the host production gateway.
5. Release the worker only after testing.

Acceptance criteria:

- A Docker compute worker is running.
- All code edits happen inside the worker worktree.
- Test commands run in the worker.

### Phase 1: Types and schedule utilities

Files to add:

- `src/cron/types.ts`
- `src/cron/schedule.ts`
- `test/cron-schedule.test.mjs`

Work:

1. Define job, target, schedule, run, status, create, and patch types.
2. Implement schedule validation.
3. Implement next-run calculation for:
   - `at`
   - `every`
   - `cron`
4. Implement friendly schedule conversion for CLI/UI/tool inputs.
5. Implement schedule display strings.

Acceptance criteria:

- `at` returns the given future time and returns undefined after it passes.
- `every` computes the next future tick from anchor.
- `cron` computes future ticks with timezone support if `croner` is used.
- Invalid schedules return clear validation errors.
- Tests cover DST-sensitive daily schedules if timezone support is added.

### Phase 2: Cron store

Files to add/change:

- `src/cron/store.ts`
- `src/reliability/store.ts`
- `test/cron-store.test.mjs`

Work:

1. Add tables for jobs and runs.
2. Add CRUD methods.
3. Add owner-scoped list/read/update/delete methods.
4. Add run reservation and completion methods.
5. Add schedule recomputation after create/update/run.
6. Add stale running marker recovery.

Acceptance criteria:

- Jobs persist across process restart.
- Listing filters by owner scope.
- A job cannot be read or edited by another owner scope.
- A due job can be reserved exactly once.
- Completing a one-shot job disables or deletes it according to `deleteAfterRun`.
- Completing a recurring job computes a later `nextRunAt`.
- Store tests pass with an in-memory SQLite database.

### Phase 3: Scheduler service

Files to add:

- `src/cron/service.ts`
- `test/cron-service.test.mjs`

Work:

1. Implement timer start/stop.
2. Load due jobs.
3. Reserve runs before execution.
4. Execute jobs outside the store lock.
5. Apply result and re-arm timer.
6. Add manual run support.
7. Add basic timeout handling.
8. Add startup recovery for stale running jobs.

Acceptance criteria:

- Starting the service arms the timer for the next due job.
- Disabled jobs do not run.
- Manual forced run runs even when not due.
- Manual due run skips when not due.
- Running marker prevents duplicate execution.
- Scheduler does not hot-loop on stale or malformed schedules.
- Service stops cleanly and does not leave active timers.

### Phase 4: Gateway/channel integration

Files to add/change:

- `src/cron/channel.ts`
- `src/plugins/builtin.ts`
- `src/channels/types.ts`
- `src/gateway/server.ts`
- maybe `src/core/session-router.ts`

Work:

1. Add a cron channel that starts the scheduler in the gateway.
2. Inject `PiboChannelContext` into the scheduler executor.
3. Add or expose an `emitMessageAndWaitForReply` channel-context helper.
4. Create cron Pibo Sessions with correct room metadata and workspace.
5. Wait for message completion and mark runs accurately.
6. Ensure Chat Web indexes the created session and output.

Acceptance criteria:

- Gateway start starts the cron service.
- Gateway stop stops the cron service.
- A due room-bound job creates a new Pibo Session in the target room.
- The created session workspace equals the room workspace or default workspace.
- A due personal job creates a new Pibo Session in Personal Chat Room.
- Run status becomes `ok` after `message_finished`.
- Run status becomes `error` after `session_error` or execution failure.

### Phase 5: Chat Web API

Files to add/change:

- `src/apps/chat/web-app.ts`
- or new helpers under `src/apps/chat/data/cron-service.ts`
- `src/apps/chat-ui/src/api.ts`
- tests under `test/` if current web app tests support it

Work:

1. Add REST endpoints for status, jobs, runs, and manual run.
2. Validate auth and owner scope.
3. Validate room access.
4. Validate profile exists.
5. Return useful errors.
6. Include derived display fields, such as room name and schedule summary, if useful.

Acceptance criteria:

- Authenticated user can create a job for a room they can write to.
- Authenticated user cannot create a job for another user's room.
- Authenticated user can create a personal job only for self.
- List returns only the user's jobs.
- Update cannot retarget to an unauthorized room.
- Delete removes or disables the job as designed.
- Manual run returns a run id and later exposes the created session id.

### Phase 6: CLI

Files to add/change:

- `src/cron/cli.ts`
- `src/cli.ts`
- tests under `test/cron-cli.test.mjs`

Work:

1. Add progressive `pibo cron` discovery output.
2. Add `status`, `list`, `add`, `edit`, `pause`, `resume`, `run`, `remove`, and `runs`.
3. Implement schedule flags.
4. Implement JSON output.
5. Use clear validation errors.

Acceptance criteria:

- `pibo cron` shows only immediate subcommands.
- `pibo cron add --help` shows schedule and target options.
- `pibo cron add --room ... --in 20m ...` creates a valid job.
- `pibo cron add --personal --daily 08:00 ...` creates a valid job.
- `pibo cron list --json` returns machine-readable jobs.
- `pibo cron run <id> --force` enqueues or starts a manual run.

### Phase 7: Agent-facing cron tool

Files to add/change:

- `src/cron/tool.ts`
- `src/plugins/builtin.ts`
- `src/core/profiles.ts` if `builtInPiboTool` needs another literal
- `src/core/runtime.ts` if the tool needs runtime injection
- tests under `test/cron-tool.test.mjs`

Work:

1. Register a native tool profile.
2. Add a runtime tool definition that calls the cron service or gateway API.
3. Add strict schema validation.
4. Include concise prompt guidance.
5. Add owner-scope enforcement.

Acceptance criteria:

- Profiles that enable the cron tool can add/list/update jobs.
- Tool cannot target unauthorized rooms.
- Tool accepts friendly schedules and normalizes them.
- Tool returns job id, next run, target, and schedule summary.
- Tool errors are actionable and not stack traces.

### Phase 8: Chat Web UI

Files to add/change:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat-ui/src/styles.css`

Work:

1. Add Cron Jobs route/page or panel.
2. Load jobs and runs.
3. Add create/edit form.
4. Add schedule builder.
5. Add target picker.
6. Add profile picker.
7. Add job actions.
8. Add links to run sessions.

Acceptance criteria:

- User can create a room-bound job without typing a cron expression.
- User can create a personal-chat job without typing a cron expression.
- User can select an agent/profile.
- User can edit prompt and schedule.
- User can pause/resume/delete a job.
- User can run a job now.
- After a run starts, the UI shows a link to the created session.
- The created session appears in the correct room.

### Phase 9: End-to-end validation

Run in Docker worker.

Automated checks:

```bash
npm run typecheck
npm test
npm run web-ui:build
```

Manual browser checks:

1. Start worker web gateway.
2. Open Chat Web with the worker URL.
3. Create a room with a custom workspace.
4. Create a room-bound one-shot job scheduled one or two minutes in the future.
5. Verify a new cron session appears in that room.
6. Verify the session workspace is the room workspace.
7. Create a personal-chat one-shot job.
8. Verify the session appears in Personal Chat Room.
9. Create an every-interval job, run it manually, then pause it.
10. Verify pause prevents the next scheduled run.

Acceptance criteria:

- All automated tests pass.
- Manual checks pass in the Docker worker.
- No host production gateway restart is required.
- No dev-auth is used outside Docker worker.

## Failure handling

### Missing room

If a room-bound job targets a deleted room:

- mark run `error`
- set job `lastStatus="error"`
- keep job enabled for V1 unless repeated failures become noisy
- show clear error: `Target room no longer exists`

### Archived room

If target room is archived:

- skip or error the run; choose one and stay consistent
- recommended V1: mark `skipped` with reason `target-room-archived`

### Missing profile

If profile no longer exists:

- mark run `error`
- keep job for user repair
- UI should show “Agent not found”

### Gateway restart during run

On startup:

- clear stale `runningAt` markers
- mark stale runs `error` or `skipped` with reason `interrupted`
- do not replay interrupted one-shot jobs by default
- recurring jobs should compute the next future run

### Agent timeout

V1 should have a default per-run timeout, for example 30 minutes. Timeout should:

- abort the routed session if possible
- mark run `error`
- preserve the partial session for inspection

## Security and permissions

Rules:

- Every job has an `ownerScope`.
- Every list/read/update/delete path filters by `ownerScope`.
- Room targets require access at creation and update time.
- Personal targets must match the authenticated principal.
- A job must not be able to create sessions in another user's room.
- The prompt is visible in the created session for audit.
- The agent-facing tool must not accept raw owner scopes from the model.

Prompt-injection note:

Cron jobs run without a human present. The cron tool should warn agents to use self-contained prompts and avoid scheduling untrusted external content as instructions. V1 does not need Hermes-style prompt scanning, but this is a good V2 hardening item.

## Observability

Add logs for:

- job created, updated, removed
- run reserved
- session created for run
- run finished
- run failed
- scheduler startup and shutdown

Expose status:

```ts
type PiboCronStatus = {
  enabled: boolean;
  jobs: number;
  running: number;
  nextRunAt?: string;
};
```

Add debug CLI later if needed:

```bash
pibo debug cron jobs
pibo debug cron runs --job <id>
```

## Test matrix

### Unit tests

- schedule parsing
- next-run computation
- invalid schedule validation
- store CRUD
- owner-scope enforcement
- run reservation
- one-shot completion
- recurring completion
- stale running recovery

### Integration tests

- room-bound execution creates session with room metadata
- personal execution creates session in Personal Chat Room
- missing room error path
- missing profile error path
- manual force run
- paused job does not run

### UI tests/manual checks

- create job with each schedule preset
- edit job
- pause/resume
- run now
- delete
- session link opens correct Chat Web route

## Rollout plan

1. Land backend types, store, and scheduler behind default-enabled local gateway behavior.
2. Add CLI and tests.
3. Add Chat Web API.
4. Add UI.
5. Validate in Docker worker.
6. Deploy to dev web gateway with `./scripts/deploy-web-dev.sh`.
7. Test with real Better Auth on dev.
8. Ask for approval before production deploy.
9. Deploy production with `./scripts/deploy-web.sh` only after approval.

## Open questions

1. Should V1 expose the cron tool to all default agents, or only selected profiles?
2. Should one-shot jobs delete after success by default or remain disabled for audit?
3. Should a room-bound cron job require room admin access or only write access?
4. Should job output mark the session as unread for the user automatically?
5. Should cron-created sessions appear in the normal session list by default, or behind a “show scheduled runs” filter?
6. Should users be able to choose per-job active model, or is selecting an agent/profile enough for V1?

## Recommended decisions for V1

- Expose cron UI globally in Chat Web.
- Use write access for room-bound job creation.
- Keep completed one-shot jobs disabled by default, not deleted.
- Show cron-created sessions in the normal room session list.
- Mark cron output unread like normal assistant output.
- Do not add per-job model overrides in V1.
- Add the agent-facing cron tool only to profiles that explicitly select it or to the main Pibo default profile after review.
