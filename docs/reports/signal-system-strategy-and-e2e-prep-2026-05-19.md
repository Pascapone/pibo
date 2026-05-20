# Signal System Strategy and E2E Prep

Date: 2026-05-19

## Goal

Prepare a reliable plan for Pibo session signals, unread indicators, and the compact terminal "Working..." animation. The next implementation agents should be able to run browser-backed tests without first debugging Docker, auth, CDP, or the signal tooling.

## Current architecture

### Server-side signal projection

- `src/core/session-router.ts` owns a live `PiboSignalRegistry`.
- `src/signals/projector.ts` projects three input groups:
  - session lifecycle: created, disposed, interrupted, processing, queue, recovery;
  - Pibo output: message, thinking, assistant stream, tools, subagents, compaction, errors;
  - yielded runs.
- `src/signals/registry.ts` keeps an in-memory graph of signal nodes and computes per-session snapshots:
  - `localStatus`, `aggregateStatus`, `phase`, `queuedMessages`;
  - `isLocalActive`, `hasActiveDescendant`, `isTreeActive`, `isSettled`;
  - active tool calls, yielded runs, active children, errors, and compact active telemetry.
- Chat Web exposes:
  - `GET /api/chat/signals/session/:id`;
  - `GET /api/chat/signals/tree/:id`;
  - `GET /api/chat/signals/events?rootPiboSessionId=...` as SSE.

### UI use

- `src/apps/chat-ui/src/App.tsx` subscribes only to the selected session tree while `area === "sessions"`.
- Signal patches update `sessionSignals` and overlay the bootstrap session tree status.
- Session-list dots use `node.status`, `unreadCount`, and recent `lastActivityAt`.
- The compact terminal footer uses:
  - `selectedSessionSignal?.isTreeActive`;
  - OR legacy selected session status;
  - OR running trace rows;
  - OR `selectedTrace?.status === "UNSET"`.

This last fallback is a likely cause of the footer continuing after the final message. Once a signal snapshot exists and says idle, legacy trace/status fallback should not keep the animation alive.

## Main reliability gaps

1. **Activity and attention are mixed.** Running state, unread state, and recent completion pulse all collapse into `node.status` plus `lastActivityAt`. These should be separate UI concepts.
2. **Signals are live-only.** The registry is in memory. It does not rebuild from the event/read model after restart, reload, or missed SSE without explicit reconciliation.
3. **The UI subscribes only to the selected tree.** Background sessions in other rooms rely on navigation/bootstrap polling or mutation side effects, not a broad owner/room signal stream.
4. **The footer has competing truth sources.** `isTreeActive` can be idle while trace rows or `UNSET` still force `Working...`.
5. **Staleness is computed but not acted on.** `activeTelemetry.isStale` exists, but the UI does not distinguish "working", "possibly stuck", and "idle after missed finish".
6. **Debug signal CLI cannot authenticate to Chat Web.** `pibo debug signals tree ...` returns `Unauthenticated` against authenticated gateways unless a browser cookie/header path is added.
7. **Docker workers do not inherit provider auth.** Spark appears in the model catalog, but `authConfigured=false` in the worker, so real model E2E tests need a host/dev gateway with provider auth or a deliberate worker auth-mount strategy.

## Proposed strategy

### 1. Define three independent UI states

Create explicit selectors and avoid overloading `session.status`:

- **Activity:** idle, queued, running, streaming, tool, subagent, run, compacting, blocked, stale.
- **Attention:** unread assistant output, unread error, recently completed pulse, none.
- **Lifecycle:** active, archived, disposed, interrupted, deleted.

The session-list dot should be derived from these in priority order:

1. unread error;
2. active/running;
3. unread completed output;
4. recent completion pulse;
5. idle.

### 2. Make signals the authority for live work

Once a selected-session signal snapshot exists, the compact terminal footer should use that snapshot as the activity source. Legacy trace/status fallback should apply only before the first signal snapshot or when the signal endpoint is unavailable.

Acceptance rule: after a `message_finished`, `session_processing_changed(false)`, `session_error`, `abort`, or `dispose`, `selectedSessionSignal.isTreeActive === false` must hide `Working...` within one render tick or a bounded delay, even if trace status is stale.

### 3. Add reconciliation and staleness policy

- Add a periodic or event-driven reconciler that compares:
  - runtime status from the router;
  - signal snapshot active nodes;
  - trace/read-model tail events.
- If active telemetry is stale, show "possibly stuck" rather than indefinite "working".
- If the router says `processing=false` and queue is zero, settle orphan active nodes and emit a patch.
- Consider durable/replayable signal state from the event stream for restart and reload correctness.

### 4. Split subscription scopes

Keep the selected-tree SSE for detailed state, but add a compact owner/room activity stream or polling fallback for background rows. Background rooms should not depend on the currently selected tree.

### 5. Harden the debug path

Add one of these before broad E2E work:

- `pibo debug signals --cookie <file>` or `--auth-header`;
- a local-only privileged debug endpoint;
- browser-attached signal fetch through CDP.

Without this, agents can inspect trace and events, but not authenticated live signal snapshots from the CLI.

## E2E user stories to test

1. **Selected session, normal completion**
   - Send message using Spark with low/off reasoning.
   - Expect: dot running during response, footer visible, final assistant text rendered, footer hidden after idle signal.

2. **Background session completion**
   - Start a message in session A, switch to session B.
   - Expect: A shows running while active; after finish A shows unread/recent pulse, not running.

3. **Room switch during active response**
   - Start response in room A, switch to room B, return to room A.
   - Expect: no lost idle patch; room unread counts correct.

4. **Reload while active**
   - Start response, reload browser.
   - Expect: bootstrap overlays running from signals; SSE snapshot correct; final idle clears UI.

5. **Queued burst**
   - Send several messages quickly.
   - Expect: queued count increments, phase shows queued/prompting, footer remains until last completion only.

6. **Subagent tree**
   - Trigger a subagent or child session.
   - Expect: parent tree active while child works; parent clears when child settles.

7. **Tool and provider errors**
   - Trigger a tool error and a provider/session error.
   - Expect: tool error does not make the session active forever; provider error becomes unread/error and idle.

8. **Abort/kill/dispose**
   - Abort while streaming.
   - Expect: active nodes settle or interrupt; footer hides; no stale running dot.

9. **Archive/restore while idle and active**
   - Archive and restore sessions and rooms.
   - Expect: no orphan SSE subscription and no running dot for hidden/archived sessions.

10. **Navigation outside sessions**
    - Go to Settings, Agents, and Projects while work runs.
    - Expect: no crashes; returning to Sessions reconciles from snapshot/bootstrap.

## Test harness design

### Deterministic tests

- Keep and extend `test/signal-registry.test.mjs` for projection invariants.
- Keep and extend `test/chat-signals-api.test.mjs` for ownership, SSE order, bootstrap overlay, navigation overlay, and unread behavior.
- Add tests for "signal idle beats stale trace running" at selector level.

### Browser tests

Use Docker workers for browser validation. Host Browser Use currently lacks Chrome/display; the worker path works.

Recommended flow:

```bash
pibo compute spawn --owner <owner-scope> --ttl-seconds 7200 --idle-seconds 1800
curl -L -c /tmp/pibo-dev-cookie.txt http://127.0.0.1:<web-port>/api/auth/sign-in/social

docker exec <worker> bash -lc 'cd /app && eval "$(npm run --silent dev -- tools env browser-use)" && npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner signals-e2e'
docker exec <worker> bash -lc 'cd /app && eval "$(npm run --silent dev -- tools env browser-use)" && browser-use --session <session> open http://127.0.0.1:4788/apps/chat'
docker exec <worker> bash -lc 'cd /app && npm run --silent dev -- debug web targets --cdp-url <worker-cdp-url>'
docker exec <worker> bash -lc 'cd /app && npm run --silent dev -- debug web snapshot --cdp-url <worker-cdp-url> --preset session-list --artifact'
docker exec <worker> bash -lc 'cd /app && npm run --silent dev -- debug web watch --cdp-url <worker-cdp-url> --preset chat-shell --duration 10000 --artifact'
```

### Real Spark tests

Use `openai-codex/gpt-5.3-codex-spark` or the newest Spark model available in the catalog, with reasoning low/off. Do not use `gpt-5.5` for these smoke tests.

Current blocker: the Docker worker catalog lists Spark but provider auth is not configured. Real Spark tests need either:

- a host/dev/prod gateway where the provider is authenticated; or
- an explicit, safe provider-auth mount into a Docker worker.

## Smoke results from this prep

- Build plus targeted tests passed on host:
  - `npm run build`;
  - `node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs`;
  - 34 tests passed.
- Docker worker started and Chat Web health returned OK; the smoke worker was released after copying artifacts.
- Dev auth worked in the worker; browser session was authenticated as the dev user.
- Browser Use in the worker was healthy and could open Chat Web.
- `pibo debug web targets`, `snapshot`, and `watch` worked inside the worker after acquiring a Browser Use lease.
- Captured session-list and chat-shell snapshots showed `data-pibo-debug`, `data-pibo-session-id`, `data-pibo-state`, signal-dot classes, and layout boxes. Copied artifacts to `docs/reports/artifacts/signals-e2e-prep-2026-05-19/web-render/`.
- Direct signal API with a dev-auth cookie returned an idle signal snapshot for the selected session.
- `pibo debug signals` without auth failed with `Unauthenticated`; this is a tooling gap.
- Attempting a Spark-backed message in the worker failed before runtime work because provider auth was missing: `requires configured auth for openai-codex/gpt-5.3-codex-spark`.
- Production gateway had active sessions, so it must not be restarted without user approval.

## Follow-up investigation

The E2E/root-cause pass is documented in `docs/reports/signals-e2e-root-cause-2026-05-19.md`. Its evidence lives in `docs/reports/artifacts/signals-e2e-root-cause-2026-05-19/`.

## Immediate next stories

1. Add authenticated support to `pibo debug signals`.
2. Refactor compact terminal activity selection so an existing idle signal suppresses legacy `UNSET`/running fallbacks.
3. Add selector tests for activity vs attention vs lifecycle.
4. Add a browser E2E script for selected-session send/finish using Spark on an authenticated gateway.
5. Add switch/reload/background-room browser scenarios.
6. Add stale-active watchdog behavior and UI presentation.
7. Decide whether signal state remains live-only or becomes replayable from the event stream.
