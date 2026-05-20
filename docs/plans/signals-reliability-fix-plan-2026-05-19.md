# Plan: Signals Reliability Fix

**Status:** Draft
**Created:** 2026-05-19
**Owner / Source:** User request after E2E/root-cause investigation
**Related reports:**

- `docs/reports/signal-system-strategy-and-e2e-prep-2026-05-19.md`
- `docs/reports/signals-e2e-root-cause-2026-05-19.md`
- `docs/reports/artifacts/signals-e2e-root-cause-2026-05-19/`

## Goal

Make Chat Web session signals reliable for live work, errors, unread attention, model changes, reloads, room/session switches, and the compact terminal `Working...` footer.

## Summary of root causes

1. **Model changes do not update live runtimes.** Chat Web PATCH updates the Pibo Session record, but an already-created routed runtime keeps its old model.
2. **Runtime creation/provider-auth failures can bypass signals.** A message can fail before `message_queued`, `message_started`, or `session_error` reaches the signal registry.
3. **The session-list dot can say Idle while the row is error.** `sessionNodeSignal` hides read errors because it only renders error when `unreadCount > 0`.
4. **The compact terminal footer has competing truth sources.** `selectedSessionSignal.isTreeActive === false` can be overridden by stale legacy status, running rows, or `selectedTrace.status === "UNSET"`.
5. **`pibo debug signals` lacks authenticated access.** The CLI cannot inspect authenticated Chat Web signal endpoints without manual curl/browser workarounds.
6. **Background rows do not receive full signal coverage.** The UI subscribes only to the selected tree; nonselected sessions rely on bootstrap/event-summary reconciliation.

## Non-goals

- Do not copy host provider credentials into Docker without an explicit security decision.
- Do not restart production gateways without user approval and restart-safety checks.
- Do not use GPT-5.5 for smoke tests. Use Spark: `openai-codex/gpt-5.3-codex-spark` or the current authenticated Spark model.
- Do not redesign the full Chat Web state model in one pass. Split activity, attention, and lifecycle enough to fix current symptoms.

## Phase 0: Baseline and guardrails

### Tasks

1. Start from current `upstream/dev` in a focused worktree/branch.
2. Run baseline checks:
   - `npm run build`
   - `node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs`
3. Preserve current reports and root-cause artifacts.
4. Confirm host Spark auth before any live-provider test:
   - model catalog shows `openai-codex/gpt-5.3-codex-spark` with `authConfigured=true`.

### Acceptance

- Baseline tests pass or failures are documented as pre-existing.
- No production gateway restart is attempted.
- No secrets are copied into Docker.

## Phase 1: Fix model selection for live runtimes

### Problem

When a session already has a `RoutedSession`, Chat Web model PATCH changes persisted `activeModel` but not the active runtime. `/status` can still report the old model.

### Target behavior

Changing a session model in Chat Web must update the live runtime or force a safe runtime reset before the next message.

### Implementation options

Prefer option A unless runtime constraints block it.

#### Option A: update live runtime

- Add a router/session-store path that detects `activeModel` changes for a live session.
- Call `RoutedSession.setModel(model)` for the active runtime.
- Keep Pibo Session store and runtime state in sync.
- Ensure telemetry context uses the new model for later turns.

#### Option B: reset live runtime

- On `activeModel` change, dispose/reset cached `RoutedSession` if it is idle.
- Reject or defer model changes while processing.
- Recreate runtime with the new model on next message.

### Acceptance

- GIVEN a live session exists
- WHEN Chat Web PATCH sets `activeModel` to Spark
- THEN `/status.result.activeModel` returns Spark
- AND the next message uses Spark
- AND no duplicate/error signal remains after the change

### Tests

- Add a focused router or web-app test for live model mutation.
- Add a regression test for model change after `/status` created the runtime.
- Run host live Spark smoke once after implementation.

## Phase 2: Project runtime creation and provider-auth failures into signals

### Problem

If runtime creation fails before message processing starts, Chat Web records accepted/failed chat events, but the signal tree can stay idle/no-error.

### Target behavior

Any user-visible message/action failure after Chat Web accepts the request must produce a settled error signal for that Pibo Session.

### Tasks

1. In `sendChatMessage(...)`, when `channelContext.emit(...)` throws, project a signal error through the canonical signal path.
2. Prefer router-level projection if possible, so non-web channels also benefit.
3. Clear queue/activity state when the error occurs before runtime start.
4. Avoid double-reporting when the router already emitted `session_error`.

### Acceptance

- GIVEN a new session with unauthenticated Spark
- WHEN the user sends a message
- THEN the signal snapshot has:
  - `localStatus: "error"`
  - `hasError: true`
  - `isTreeActive: false`
  - `queuedMessages: 0`
- AND Chat Web shows an error state, not Idle.

### Tests

- Add `chat-signals-api` test for emit/runtime-creation failure.
- Add signal-registry test for pre-start provider error settling.

## Phase 3: Separate activity, attention, and lifecycle in the session-list indicator

### Problem

The session row can have `data-pibo-state="error"` while the dot says `Idle`.

### Target behavior

The visible dot must never contradict the row state. Read errors can be quieter than unread errors, but not Idle.

### Minimal selector policy

Priority:

1. Active/running work: running dot.
2. Unread error: strong error dot.
3. Read error: quiet/stable error dot.
4. Unread completed output: unread/completed dot.
5. Recent completion pulse: recent/completed dot.
6. Idle: idle dot.

### Tasks

1. Refactor `sessionNodeSignal(...)` into a small pure selector.
2. Add explicit cases for read errors.
3. Keep current CSS if possible; add one class only if needed, e.g. `session-signal-error-read`.
4. Ensure title/aria label matches state.

### Acceptance

- `node.status === "error"` and `unreadCount` null/0 does not render `session-signal-idle`.
- DOM snapshot shows row state and dot label agree.
- Archived sessions do not show active/running dots unless intentionally included in archived view.

### Tests

- Add pure selector tests if selector is exported.
- Add browser snapshot assertion for read error row.

## Phase 4: Make signals authoritative for the `Working...` footer

### Problem

The compact terminal footer uses signal state plus legacy fallbacks. A stale trace can keep `Working...` visible after signals say idle.

### Target behavior

If a selected-session signal snapshot exists, it is the authority for live activity.

### Selector rule

```ts
if (selectedSessionSignal) return selectedSessionSignal.isTreeActive;
return selectedSessionStatus === "running" || runningCount > 0 || selectedTrace?.status === "UNSET";
```

If signal subscription fails, expose a separate `signalsUnavailable` or `signalsLoaded` state so fallback behavior is explicit.

### Acceptance

- GIVEN a signal snapshot exists with `isTreeActive: false`
- WHEN trace status is stale/UNSET or rows still appear running
- THEN `Working...` is hidden
- GIVEN no signal snapshot exists yet
- THEN legacy fallback can still show temporary working state

### Tests

- Add component/selector test for idle signal suppressing stale fallbacks.
- Add regression test using a trace with `status: "UNSET"` and idle signal.
- Browser watch should show footer removed after final idle patch.

## Phase 5: Add authenticated `pibo debug signals`

### Problem

Agents cannot use `pibo debug signals tree` against authenticated Chat Web. It returns `Unauthenticated`.

### Target behavior

The debug CLI can fetch the same signal snapshot an authenticated browser or curl can fetch.

### Tasks

1. Add `--cookie <path>` support to `pibo debug signals session/tree`.
2. Add `--auth-header <value>` only if needed for non-cookie use.
3. Keep default unauthenticated behavior unchanged.
4. Redact cookie/header values from logs and artifacts.

### Acceptance

- `pibo debug signals tree ps_... --cookie /tmp/dev_cookie.txt --json` succeeds in Docker worker.
- Missing/invalid cookie returns a clear auth error.
- Help text explains the option without leaking cookie examples.

### Tests

- Unit test request header construction.
- Web API integration test can remain unchanged.
- Manual Docker check with dev-auth cookie.

## Phase 6: Add room/owner activity coverage for background rows

### Problem

Only the selected session tree gets detailed SSE patches. Background sessions can miss active/idle transitions until bootstrap catches up.

### Target behavior

Visible background rows show reliable active, idle, error, and unread state across session switches, room switches, reloads, and Settings navigation.

### Implementation options

#### Option A: compact room activity SSE

Add `/api/chat/signals/events?roomId=...&mode=summary` or a new endpoint that emits compact session snapshots for visible room sessions.

#### Option B: owner activity stream

Emit compact updates for all sessions owned by the authenticated user. This is simpler for cross-room navigation but could be noisier.

#### Option C: polling/reconciliation fallback

Poll bootstrap or a compact signal summary every few seconds while Chat Web is open. Use this as a fallback, not the primary live path.

### Recommended path

Implement option A first, with option C as a disconnected-SSE fallback.

### Acceptance

- Start message in session A.
- Switch to session B.
- A shows running while active.
- A changes to completed/unread/error after finish.
- A does not remain running after final idle signal.
- Repeat after room switch and browser reload.

### Tests

- Add API test for room summary signal ownership and patch monotonicity.
- Add browser E2E scenario for background session transition once live Spark/browser path is available.

## Phase 7: Live E2E validation with Spark

### Test matrix

Run with `openai-codex/gpt-5.3-codex-spark` and Thinking `low` or `off`.

1. Selected session normal completion.
2. Selected session reload during response.
3. Background session completion.
4. Room switch during active response.
5. Two quick messages / queue behavior.
6. Provider-auth error.
7. Abort while active.
8. Archive/restore after error.
9. Settings navigation while active.
10. Subagent/child active descendant if a deterministic prompt can trigger it.

### Required evidence

For each story capture:

- request/action used;
- signal snapshots before/during/after;
- browser DOM snapshot or render watch;
- trace/debug summary;
- final pass/fail note.

### Acceptance

- No story ends with `isTreeActive: true` after completion/error/abort.
- `Working...` is visible only while the selected tree is active.
- Session-list dots do not contradict row status.
- Background rows clear running state after finish.
- Reload preserves correct current state.

## Rollout plan

1. Implement Phases 1-4 together if small enough; otherwise split after Phase 2.
2. Run deterministic tests after each phase.
3. Run Docker browser checks with dev auth for non-provider flows.
4. Run host-side live Spark smoke for real provider validation.
5. If Browser UI live Spark is required, choose one:
   - fix host Browser Use/CDP; or
   - explicitly allow a secure provider-auth mount into a worker.
6. Deploy to dev first:
   - `./scripts/deploy-web-dev.sh`
   - `pibo gateway dev restart`
7. Validate dev Chat Web manually/browser-backed.
8. Ask user approval before production deploy/restart.

## Success criteria

- [ ] SC-001: Live runtime model matches Chat Web selected model.
- [ ] SC-002: Provider/runtime creation failures produce settled error signals.
- [ ] SC-003: Error sessions never render an Idle dot.
- [ ] SC-004: Idle selected-session signals suppress stale `Working...` fallbacks.
- [ ] SC-005: `pibo debug signals` can authenticate with a cookie file.
- [ ] SC-006: Background session rows update active/idle/error without selecting that session.
- [ ] SC-007: Real Spark smoke passes with final `isTreeActive=false` and no error.
- [ ] SC-008: Dev gateway validation passes before any production rollout.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Runtime model mutation may not be safe mid-turn | Reject model changes while processing, or queue/reset after idle. |
| Error projection can double-count errors | Deduplicate by event/session/error source in signal registry. |
| Background activity stream can be noisy | Emit compact per-session snapshots only on semantic changes. |
| Cookie debug option can leak secrets | Never print cookie contents; document paths only; redact artifacts. |
| Live Spark tests cost money | Use short prompts, Spark only, Thinking low/off, and bounded timeouts. |
| Host browser remains unavailable | Keep Docker browser validation for UI-only paths and host local-router smoke for real provider paths until browser auth strategy is approved. |

## Open questions

1. Should read errors display the same red dot as unread errors, or a dimmer persistent error dot?
2. Should archiving a session dismiss signal errors, or preserve them for restore?
3. Should model changes be allowed while a session is processing, rejected, or deferred?
4. Should the background activity stream be room-scoped or owner-scoped?
5. Do we want a durable/replayable signal store, or is runtime reconciliation enough for now?
