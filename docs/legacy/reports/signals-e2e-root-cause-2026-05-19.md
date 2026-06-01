# Signals E2E Root-Cause Report

Date: 2026-05-19

## Scope

I ran the signal strategy end to end with the existing debug tools, a Docker Chat Web worker, Browser Use, CDP render snapshots, signal APIs, and deterministic tests. The goal was not to patch code yet, but to find concrete causes and produce evidence that the next fix pass can use.

Evidence lives in:

- `docs/reports/artifacts/signals-e2e-root-cause-2026-05-19/`
- earlier prep report: `docs/reports/signal-system-strategy-and-e2e-prep-2026-05-19.md`

## Environment

- Docker worker: `signals-e2e-1779226028`.
- Worker was released after artifact capture.
- Browser/CDP worked inside the worker.
- Dev auth worked as `dev@pibo.local`.
- Spark model was present in the catalog, but no provider auth was configured in the worker.
- Host model catalog did have `openai-codex/gpt-5.3-codex-spark` authenticated, so I ran one real host-side Spark runtime smoke after the Docker investigation.

Spark catalog evidence:

```json
{"provider":"openai-codex","id":"gpt-5.3-codex-spark","modelAuth":false,"supportsReasoning":true}
```

Because provider auth was false in Docker, I did not run GPT-5.5 and did not force a paid real-model test from the worker. The later host-side Spark smoke used the already configured host `openai-codex` auth without copying secrets into Docker.

## Validation run

Host deterministic validation passed:

```bash
npm run build
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs
```

Result: 34/34 tests passed.

## Live Spark host smoke

After confirming the host catalog reported `openai-codex/gpt-5.3-codex-spark` as authenticated, I ran a separate local-router smoke using host credentials, Thinking `low`, and a minimal prompt: `Live Spark signal smoke test. Reply with exactly: OK`.

Evidence:

- `docs/reports/artifacts/signals-e2e-root-cause-2026-05-19/live-spark-host/summary.json`
- `docs/reports/artifacts/signals-e2e-root-cause-2026-05-19/live-spark-host/result.json`

Result summary:

```json
{
  "ok": true,
  "statusBeforeActiveModel": { "provider": "openai-codex", "id": "gpt-5.3-codex-spark" },
  "statusBeforeThinking": "low",
  "assistant": [{ "type": "assistant_delta", "text": "OK" }, { "type": "assistant_message", "text": "OK" }],
  "finalSignal": { "localStatus": "idle", "aggregateStatus": "idle", "isTreeActive": false, "queuedMessages": 0, "hasError": false }
}
```

Observed signal timeline for the real Spark turn:

```text
idle -> queued -> running -> streaming -> running -> streaming -> running -> idle
```

This proves the core runtime + real Spark + signal projection path works when the runtime is created with Spark before start. It does not invalidate the UI/root-cause findings: Chat Web model PATCH can still diverge from an already-created runtime, Docker still lacks provider auth, and Browser UI E2E still needs a host browser or a safe worker auth strategy.

## E2E observations

### 1. Browser/CDP/debug tooling path works

Inside Docker, Browser Use and `pibo debug web` worked. Captured snapshots include:

- `chat-shell` before and after actions;
- `session-list` after signal error and after reload;
- render watches around `/status` and message error attempts.

Host Browser Use remains unsuitable for this work because it lacks Chrome/display. Docker is the reliable path.

### 2. `pibo debug signals` cannot inspect authenticated Chat Web signals

In the worker:

```bash
PIBO_GATEWAY_URL=http://127.0.0.1:4788 npm run --silent dev -- debug signals tree ps_... --json
```

returned:

```text
Unauthenticated
```

Direct signal API calls with the dev-auth cookie worked. The CLI has no cookie/header path, so agents cannot use it for authenticated Chat Web signal snapshots without a workaround.

### 3. Wrapper `/status` updates the terminal but does not exercise live activity signals

Posting `/api/chat/action` with `action: "status"` rendered a terminal Status card. The signal tree stayed at version 1 with `localStatus: "idle"` and `isTreeActive: false`.

This is expected for a fast wrapper action, but it means `/status` is not a good E2E substitute for model streaming or queue behavior.

### 4. Model selection can diverge from the live runtime

Repro:

1. Create/open a session.
2. Run `/status`, which creates a live routed runtime.
3. Patch the session model through Chat Web's session PATCH path:

   ```json
   {"activeModel":{"provider":"openai-codex","id":"gpt-5.3-codex-spark"}}
   ```

4. Run `/status` again.

Observed `/status` result after the patch:

```json
{"provider":"unknown","id":"unknown"}
```

The persisted Pibo session said Spark, but the live runtime still said `unknown/unknown`.

Likely cause:

- `TerminalModelCard.tsx` calls `patchSession(piboSessionId, { activeModel })`.
- `web-app.ts` PATCH updates the Pibo Session record only.
- The existing `RoutedSession` is not reset and `RoutedSession.setModel(...)` is not called.

Impact:

- The UI can claim a model is selected while the runtime uses another model.
- Spark E2E tests can produce misleading failures.
- A user can believe they changed to a cheap model, while the active runtime has not changed.

### 5. New sessions with unauthenticated Spark can fail before signals exist

Repro:

1. Create a new session.
2. Patch `activeModel` to `openai-codex/gpt-5.3-codex-spark` in the unauthenticated worker.
3. Send a message or run `/status`.

Observed response:

```json
{"error":"Profile \"codex-compat-openai-web\" requires configured auth for openai-codex/gpt-5.3-codex-spark."}
```

Observed signal tree:

```json
{"localStatus":"idle","hasError":false,"queuedMessages":0}
```

Cause:

- Runtime creation validates provider auth before router message processing starts.
- The failure happens before the signal projector sees `message_queued`, `message_started`, or `session_error`.

Impact:

- The Chat API appends `user.message.accepted` / `user.message.failed` events, but the signal tree remains idle/no-error.
- UI error handling depends on local mutation error state or bootstrap refresh, not live signals.
- This is a real gap for provider-auth failures and model misconfiguration.

### 6. Provider/runtime error signals settle correctly, but the session-list dot lies

Repro:

1. Use a session whose runtime already exists.
2. Patch the Pibo Session active model to Spark.
3. Send a message.

Observed signal after the provider error:

```json
{
  "localStatus": "error",
  "aggregateStatus": "error",
  "isTreeActive": false,
  "queuedMessages": 0,
  "hasError": true,
  "errors": 1
}
```

This part is good: the signal registry settles activity and records an error.

But the session-list DOM after reload showed:

```text
session-row ... state=error
span name="Idle" class="session-signal ... session-signal-idle"
```

Cause:

`sessionNodeSignal(...)` only shows an error dot when both are true:

```ts
node.status === "error" && (node.unreadCount ?? 0) > 0
```

The selected/read session had `status: "error"` but `unreadCount: null`, so the visible dot became Idle.

Impact:

- A session can be in error state while the dot says Idle.
- This hides signal failures exactly where users need attention.
- It also mixes activity, unread attention, and lifecycle in one dot.

### 7. The Working footer still has competing truth sources

Source finding:

```ts
const signalWorking = selectedSessionSignal?.isTreeActive ?? false;
const isStreaming = signalWorking || selectedSessionStatus === "running" || runningCount > 0 || selectedTrace?.status === "UNSET";
```

If a signal snapshot exists and says idle, the footer can still remain active because `selectedSessionStatus`, running trace rows, or `UNSET` override it.

I could not fully reproduce long-running `Working...` with real streaming in the unauthenticated worker, but the code path still explains the original symptom. The correct selector should treat an available signal snapshot as authoritative for live activity and use legacy fallbacks only before signals load or when signals fail.

### 8. Reload preserves signal-derived error state, but preserves the wrong dot too

After reload on the errored session:

Signal API:

```json
{"localStatus":"error","hasError":true,"isTreeActive":false,"errors":1}
```

Bootstrap selected session:

```json
{"status":"error","unreadCount":null}
```

DOM:

```text
session-row ... state=error
span name="Idle" class="session-signal-idle"
```

Reload/resubscribe works for the selected tree. The presentation selector is the problem.

### 9. Archive/restore does not clear live signal errors

Archiving the errored session hid it from active bootstrap results. The signal tree still reported:

```json
{"localStatus":"error","hasError":true,"isTreeActive":false}
```

Restoring the session brought back `status: "error"`. This may be acceptable, but it should be an explicit product decision. If archive means "dismiss", signal errors need a read/dismiss/lifecycle distinction.

### 10. Background and room-switch stories remain structurally under-covered

Code finding:

- `App.tsx` subscribes to `subscribeSignalTree(selectedPiboSessionId)` only while `area === "sessions"`.
- Background session rows rely on bootstrap/event-summary updates, not a room/owner signal stream.

Impact:

- A background session can miss fine-grained active/idle patches.
- Room switching and Settings navigation can drop the selected-tree signal subscription.
- On return, the selected tree resubscribes, but nonselected sessions depend on bootstrap reconciliation.

This needs a real provider-auth run to prove with streaming messages, but the subscription shape is clear from the code.

## User-story matrix

| Story | Result | Notes |
|---|---:|---|
| Selected session, real Spark completion | Partial pass | Host local-router Spark smoke passed with real `openai-codex/gpt-5.3-codex-spark`, Thinking `low`, final signal idle/no-error. Full Browser UI E2E remains blocked by host browser/CDP and Docker provider auth. |
| Selected session, provider error | Reproduced | Signals settle to error/idle; dot says Idle. |
| Reload selected session | Reproduced | Signal state reloads; dot remains wrong. |
| Runtime model change | Reproduced | Pibo Session model changed; live runtime model did not. |
| New session with unauth Spark | Reproduced | API fails before signal projection; signal tree stays idle/no-error. |
| Session archive/restore | Reproduced | Archived session hidden; signal error remains live; restore returns error status. |
| Background session active/complete | Not fully run | Needs provider-auth streaming. Code shows selected-tree-only SSE gap. |
| Room switch during active work | Not fully run | Needs provider-auth streaming. Same selected-tree-only gap. |
| Parallel queued messages | Deterministic only | Unit tests cover queue settling; real streaming blocked by auth. |
| Settings navigation while active | Code-analyzed | `area !== "sessions"` clears `sessionSignals`; return relies on resubscribe/bootstrap. |
| Subagent tree | Deterministic only | Unit tests cover active descendant aggregation. |

## Root causes to fix first

### RC1: Model PATCH does not update an already-created runtime

Fix options:

1. When `activeModel` changes, call a router/runtime action that invokes `RoutedSession.setModel(...)` if the session is live.
2. Or reset/dispose the cached routed session on model changes before first/next message.
3. Also update telemetry extension model context if it is model-bound.

Acceptance:

- Patch model to Spark.
- Run `/status`.
- `/status.result.activeModel` must match Spark.

### RC2: Provider-auth/runtime-creation failures bypass signals

Fix options:

1. Project a `session_error` when `channelContext.emit(...)` throws after `user.message.accepted`.
2. Or make router/runtime creation failures flow through the signal projector.
3. Preserve `queuedMessages: 0` and `isTreeActive: false` after the error.

Acceptance:

- New session with unauthenticated model.
- Send message.
- Signal snapshot must show `localStatus: "error"`, `hasError: true`, `isTreeActive: false`.

### RC3: Session-list dot hides read errors as Idle

Fix:

- Split activity from attention.
- At minimum, `node.status === "error"` should not render `session-signal-idle`.
- If read errors should be visually quieter, add a separate read-error style, not Idle.

Acceptance:

- Error session with `unreadCount: 0/null` renders an error or read-error dot.
- `data-pibo-state="error"` and dot label/class must agree.

### RC4: Working footer ignores authoritative idle signals

Fix:

- If `selectedSessionSignal` exists, derive live working from `selectedSessionSignal.isTreeActive` only.
- Use `selectedSessionStatus`, running rows, and `UNSET` only before signal bootstrap or when the signal endpoint failed.

Acceptance:

- After signal snapshot says `isTreeActive: false`, `Working...` disappears even if trace status is stale/UNSET.

### RC5: Authenticated signal debugging is missing

Fix:

Add one of:

- `pibo debug signals --cookie <file>`;
- `--auth-header`;
- a browser-CDP-backed fetch mode;
- or a local privileged debug endpoint.

Acceptance:

- In a Docker worker, the debug CLI can fetch the same signal snapshot as `curl -b <cookie>`.

### RC6: Selected-tree-only subscriptions leave background rows weak

Fix options:

1. Add a compact room/owner activity SSE stream.
2. Or poll/reconcile all visible session rows periodically.
3. Keep selected-tree SSE for detailed active descendants.

Acceptance:

- Session A runs while Session B or another room is selected.
- A's row shows running, then unread/completed/error, then not running.

## Recommended fix order

1. Fix model PATCH/runtime divergence.
2. Project signals for emit/runtime creation failures.
3. Fix session-list dot selector for read errors.
4. Fix Working footer selector precedence.
5. Add authenticated `pibo debug signals`.
6. Add room/owner activity stream for background rows.
7. Run a real Spark E2E suite on a gateway with provider auth.

## Commands worth keeping

```bash
# Signal deterministic tests
npm run build
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs

# Docker/browser path
pibo compute spawn --name signals-e2e-$(date +%s) --ttl-seconds 7200 --idle-seconds 1800
curl -L -c /tmp/signals_e2e_cookie.txt http://127.0.0.1:<webPort>/api/auth/sign-in/social

docker exec <worker> bash -lc 'cd /app && eval "$(npm run --silent dev -- tools env browser-use)" && npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner signals-e2e'
docker exec <worker> bash -lc 'cd /app && npm run --silent dev -- debug web targets --cdp-url http://127.0.0.1:<cdpPortInsideContainer>'
docker exec <worker> bash -lc 'cd /app && npm run --silent dev -- debug web snapshot --cdp-url http://127.0.0.1:<cdpPortInsideContainer> --preset session-list --include-layout --artifact'

# Signal API with worker cookie
curl -b /tmp/signals_e2e_cookie.txt http://127.0.0.1:<webPort>/api/chat/signals/tree/<piboSessionId>
```
