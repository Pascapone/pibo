# Coverage Analysis: Ralph Verification Gap Analysis 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Continuous Ralph Jobs](../capabilities/continuous-ralph-jobs.md), [Scheduled Pibo Jobs](../capabilities/scheduled-pibo-jobs.md), [Chat Web Rooms and Event Streams](../capabilities/chat-web-rooms-and-event-streams.md), [Web Auth and Same-Origin Host](../capabilities/web-auth-and-same-origin-host.md)

## Why

The durable Ralph behavior is already specified in `continuous-ralph-jobs.md`, so a second capability spec would duplicate the contract. The remaining risk is verification: Ralph spans a SQLite store, a gateway-started channel service, Chat Web same-origin APIs, a React management area, and a local CLI, but the current test inventory has no focused Ralph test file.

This coverage analysis turns that gap into testable follow-up work without changing the source behavior contract.

## Goal

Future Ralph verification SHOULD prove the existing Continuous Ralph Jobs contract through focused store, service, API, CLI, and UI tests before Ralph is treated as fully covered by direct tests.

## Scope

### In Scope

- Verification gaps for current Ralph source behavior.
- Testable acceptance targets for the existing Ralph capability spec.
- Source-backed boundaries between Ralph and already covered scheduled-job, room, routing, and auth behavior.

### Out of Scope

- New Ralph product behavior — the source and `continuous-ralph-jobs.md` remain the behavior authority.
- Time-based cron scheduling — covered by scheduled Pibo jobs.
- End-to-end browser automation in this scheduled run — this run is documentation-only.

## Current Coverage State

- `docs/specs/capabilities/continuous-ralph-jobs.md` covers Ralph's durable behavior at capability level.
- The repository test listing inspected in this run contains no Ralph-focused test file and no direct `Ralph`/`ralph` assertions under `test/`.
- Ralph source behavior is implemented across `src/ralph/*`, `src/apps/chat/ralph-api.ts`, `src/apps/chat-ui/src/RalphArea.tsx`, and Chat Web route wiring.
- Existing adjacent tests cover similar seams for cron schedules/stores, gateway/session behavior, Chat Web integration, and same-origin web behavior, but they do not prove Ralph-specific state transitions.

## Findings and Future Work

### Finding: Ralph store behavior is the first direct-test gap

`PiboRalphStore` owns the durable job/run invariants. These invariants are local, deterministic, and can be verified without a gateway or model provider.

#### Acceptance for future verification

- Creating a job rejects blank owner scope, profile, prompt, room id, personal principal id, and non-positive `maxIterations`.
- Job listing is owner-scoped and defaults to enabled jobs only unless disabled jobs are requested.
- `reserveRun` and `reserveDueRuns` create one running `rrun_` record, set `runningAt`, and refuse duplicate reservation while running.
- `completeRun` increments `completedIterations` only for `ok`, disables the job at `maxIterations`, resets `consecutiveErrors` after success, and increments it after errors.
- `requestStop` and `requestCancel` disable the job and set the expected state timestamps without deleting run history.
- `recoverInterruptedRuns` converts stale running jobs into error runs with reason `interrupted`.

### Finding: Ralph service behavior needs a fake channel-context harness

`PiboRalphService` turns reserved jobs into routed Pibo Sessions and correlated service messages. The important behavior can be tested with a fake `PiboChannelContext` and in-memory stores instead of a real gateway.

#### Acceptance for future verification

- Starting the service recovers interrupted runs and schedules work without exceeding `maxConcurrentRuns`.
- A reserved room target creates a `kind: "ralph"` Pibo Session with Chat room metadata, `ralphJobId`, `ralphRunId`, and `ralphTargetKind`.
- A personal target creates or reuses the owner's default personal room and uses that room's workspace when present.
- Only output events for the created Pibo Session and correlated message id finish the run.
- A final answer containing `<promise>COMPLETE</promise>` completes the run as `ok`, stores reason `promise-complete`, and disables the job.
- Cancel emits an `abort` execution event for the running Pibo Session and records a cancelled terminal outcome.
- Timeout and session-error paths complete the run as error unless cancellation is active.

### Finding: Chat Web Ralph API needs owner and same-origin tests

`handleChatRalphApiRequest` enforces owner scope, profile resolution, room access, archived-room rejection, same-origin JSON mutations, and service availability for start/stop/cancel.

#### Acceptance for future verification

- `GET /api/chat/ralph/jobs` returns only jobs for the authenticated owner scope.
- Mutating create, patch, delete, start, stop, and cancel requests require same-origin JSON.
- Creating or patching a room target requires write access and rejects archived rooms.
- Personal targets reject a principal id different from the authenticated user.
- Unknown profile names fail before a job is created or patched.
- `/start`, `/stop`, and `/cancel` return service-unavailable when the Ralph service is not running, and not-found for jobs outside the owner scope.
- `/runs?jobId=` rejects a job id not owned by the caller.

### Finding: Ralph CLI discovery and store operations are unverified

The Ralph CLI has progressive discovery output and direct store mutations. It is agent-facing and should be tested like other command families.

#### Acceptance for future verification

- `pibo ralph` with no subcommand prints compact discovery text and points to `pibo ralph add --help`.
- Commands that need ownership fail with an explicit `--owner-scope` requirement when no owner scope is provided.
- `add --personal --start --json` creates an enabled personal job in a supplied test store path.
- `list --all --json`, `runs --json`, `stop`, `cancel`, `remove`, and `status --json` operate only on the supplied test store path.
- Invalid `--max-iterations` fails before a malformed job is persisted.

### Finding: Ralph UI behavior is currently source-inspected only

`RalphArea` exposes user-visible state and actions, but current coverage does not directly verify the React behavior.

#### Acceptance for future verification

- Empty state renders when no jobs exist.
- Selecting a job loads its latest runs and closes the mobile sidebar when supplied.
- Saving a new room job posts the selected room target, profile, prompt, optional description, and optional max iterations.
- Editing an existing job patches the selected job rather than creating a duplicate.
- Start, stop, cancel, and delete call the expected API helpers and refresh the selected job/runs.
- Personal-target drafts submit a personal target for the current user without requiring the user to type a principal id.
- API errors remain visible without clearing the user's draft.

## Coverage Decision

Do not create another Ralph capability spec. The existing `continuous-ralph-jobs.md` is the owning behavior contract. The next useful work is a focused Ralph verification suite, starting with store tests because they are deterministic and cover the largest state-transition surface.

## Success Criteria

- [ ] SC-001: A future Ralph store test covers validation, owner scoping, reservation, completion, stop/cancel, max-iteration, and restart recovery behavior.
- [ ] SC-002: A future Ralph service test uses a fake channel context to prove session creation, event correlation, promise-complete stopping, cancellation, timeout, and target resolution.
- [ ] SC-003: A future Chat Web Ralph API test proves same-origin JSON, owner scope, room access, profile validation, and service availability handling.
- [ ] SC-004: A future Ralph CLI test proves progressive discovery and store-path-isolated command behavior.
- [ ] SC-005: A future Ralph UI/component test proves the main management workflows and error persistence.

## Verification Basis

This analysis is based on current workspace inspection of:

- `docs/specs/capabilities/continuous-ralph-jobs.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `src/ralph/types.ts`
- `src/ralph/store.ts`
- `src/ralph/service.ts`
- `src/ralph/channel.ts`
- `src/ralph/cli.ts`
- `src/apps/chat/ralph-api.ts`
- `src/apps/chat-ui/src/RalphArea.tsx`
- `src/apps/chat-ui/src/api.ts`
- current `test/` file inventory and `Ralph`/`ralph` grep results
