# Test Plan: Signals Reliability Post-Fix

**Status:** Draft
**Created:** 2026-05-19
**Related plan:** `docs/plans/signals-reliability-fix-plan-2026-05-19.md`

## Goal

Verify that the signal fixes work end to end after implementation: model selection, runtime errors, session-list indicators, `Working...`, reloads, background sessions, and real Spark turns.

## Pre-checks

1. Confirm clean or understood worktree state:

   ```bash
   git status --short
   ```

2. Confirm no unsafe production restart is needed:

   ```bash
   pibo gateway web status
   pibo gateway dev status
   ```

3. Confirm Spark auth on the host before live-provider tests:

   ```bash
   node --import tsx -e "import { loadModelCatalog } from './src/apps/chat/model-catalog.ts'; const c=await loadModelCatalog(process.cwd()); for (const p of c.providers) for (const m of p.models) if (/spark/i.test((m.id||'')+' '+(m.label||''))) console.log({provider:p.id, id:m.id, providerAuth:p.authConfigured, modelAuth:m.authConfigured})"
   ```

   Expected: `openai-codex/gpt-5.3-codex-spark` has auth configured.

## 1. Deterministic regression tests

Run:

```bash
npm run build
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs
```

Expected:

- Build passes.
- Signal tests pass.
- New tests cover:
  - live model mutation;
  - pre-runtime provider/auth failure signal error;
  - idle signal suppresses stale `Working...` fallback;
  - read error dot is not Idle.

## 2. Live Spark runtime smoke

Run the saved or updated host Spark smoke with:

- model: `openai-codex/gpt-5.3-codex-spark`
- thinking: `low` or `off`
- prompt: `Reply exactly OK`

Expected:

- Assistant returns `OK`.
- Events include `message_queued`, `message_started`, `assistant_delta` or `assistant_message`, `message_finished`.
- Final signal:

```json
{
  "localStatus": "idle",
  "aggregateStatus": "idle",
  "isTreeActive": false,
  "queuedMessages": 0,
  "hasError": false
}
```

## 3. Model-change verification

Scenario:

1. Create/open a session.
2. Run `/status` so the runtime exists.
3. Change the model to Spark through Chat Web or API.
4. Run `/status` again.

Expected:

- `/status.result.activeModel` is `openai-codex/gpt-5.3-codex-spark`.
- The next real message uses Spark.
- No stale runtime model remains.

## 4. Provider-auth/runtime failure verification

Use a controlled unauthenticated model/provider in Docker or a test fixture.

Scenario:

1. Create a new session with a model that cannot authenticate.
2. Send a message.
3. Read the signal tree.

Expected:

- Request fails visibly.
- Signal tree shows:
  - `localStatus: "error"`
  - `hasError: true`
  - `isTreeActive: false`
  - `queuedMessages: 0`
- Session list does not show Idle for the error row.

## 5. Browser selected-session flow

Use Docker Browser Use for UI mechanics, and host/dev browser if real Spark credentials are required.

Scenario:

1. Open Chat Web.
2. Select Spark with Thinking low/off.
3. Send a short message.
4. Watch `chat-shell` and `session-list` via CDP.

Expected:

- While active: selected row shows running; footer shows `Working...`.
- After finish: final assistant message is visible; footer disappears.
- Final signal has `isTreeActive: false`.
- No stale `Working...` remains after idle signal.

## 6. Reload verification

Scenario:

1. Start a short Spark message.
2. Reload during or immediately after the response.
3. Inspect bootstrap, signal tree, and DOM.

Expected:

- Bootstrap and signal snapshot agree.
- If work is still active, UI shows running.
- If work finished, UI shows idle/completed, not running.
- Error rows do not show Idle dots.

## 7. Background session and room switch

Scenario:

1. Start a message in session A.
2. Switch to session B or another room before A finishes.
3. Wait for A to finish.
4. Return to A.

Expected:

- A shows running while active even when not selected.
- A changes to completed/unread or error after finish.
- A does not remain running.
- Returning to A shows a settled signal tree.

## 8. Queue and parallel message check

Scenario:

1. Send two short messages quickly in one session.
2. Observe signal snapshots during processing.

Expected:

- `queuedMessages` increments when the second message waits.
- `isTreeActive` remains true until all queued work finishes.
- Final state is idle with queue zero.

## 9. Archive/restore check

Scenario:

1. Produce an error session.
2. Archive it.
3. Restore it.

Expected:

- Archived active list hides the session.
- Restore behavior matches the chosen product decision:
  - either error state persists visibly; or
  - archive dismisses/read-clears the error.
- In no case should restored error state render as Idle.

## 10. Debug CLI verification

Scenario:

1. Log into a Docker worker with dev auth and save cookie.
2. Run:

   ```bash
   pibo debug signals tree <ps_id> --cookie /tmp/dev_cookie.txt --json
   ```

Expected:

- Command returns the same snapshot as `curl -b /tmp/dev_cookie.txt`.
- Invalid/missing cookie returns a clear auth error.
- Cookie contents are never printed.

## Pass criteria

The fix is ready for dev rollout when all are true:

- [ ] Deterministic tests pass.
- [ ] Host Spark smoke passes.
- [ ] Model PATCH updates live runtime or safely resets it.
- [ ] Provider/runtime failures produce error signals.
- [ ] `Working...` follows signal activity and clears on idle.
- [ ] Error rows never render Idle dots.
- [ ] Background rows settle after completion/error.
- [ ] `pibo debug signals --cookie` works.
- [ ] Browser/CDP artifacts are captured for selected-session and reload flows.

## Rollout gate

After the test plan passes locally/Docker:

1. Deploy to dev:

   ```bash
   ./scripts/deploy-web-dev.sh
   pibo gateway dev restart
   ```

2. Repeat browser checks on dev.
3. Ask user approval before production deploy/restart.
