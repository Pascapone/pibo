# Signals Reliability Fix Validation

**Date:** 2026-05-19
**Branch/worktree:** `signals-reliability-fix` / `/root/code/pibo/.worktrees/signals-reliability-fix`
**Related plan:** `docs/plans/signals-reliability-post-fix-test-plan-2026-05-19.md`

## Summary

Implemented and validated the main signal reliability fixes:

- live Chat Web model PATCH now synchronizes the active runtime before persisting the model change;
- message emit/runtime creation failures are projected as `session_error` signals;
- `session_error` clears queued signal count;
- read error rows no longer render an idle session-list dot;
- compact terminal `Working...` now treats selected-session signals as authoritative when available;
- Chat Web adds a bounded navigation reconciliation poll for visible background rows;
- `pibo debug signals` accepts `--cookie <path>` and `--auth-header <value>`; cookie files may be raw header values or curl/Netscape cookie jars.

## Checks run

### Deterministic build and tests

Host:

```bash
npm run build
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs
```

Result: pass, 37/37 tests.

Docker dev worker:

```bash
docker exec pibo-dev-signals-reliability-fix bash -lc 'cd /workspace && npm run build >/tmp/pibo-final-build.log && node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs'
```

Result: pass, 37/37 tests.

### Live Spark smoke

Host Spark auth was confirmed for `openai-codex/gpt-5.3-codex-spark`.

Smoke:

- model: `openai-codex/gpt-5.3-codex-spark`
- thinking: `low`
- prompt: `Live Spark post-fix signal smoke test. Reply with exactly: OK`

Result: pass.

Evidence:

- `docs/reports/artifacts/signals-reliability-fix-validation-2026-05-19/live-spark-host/summary.json`
- `docs/reports/artifacts/signals-reliability-fix-validation-2026-05-19/live-spark-host/result.json`

Summary:

```json
{
  "ok": true,
  "activeModel": { "provider": "openai-codex", "id": "gpt-5.3-codex-spark" },
  "thinking": "low",
  "assistant": [{ "type": "assistant_delta", "text": "OK" }, { "type": "assistant_message", "text": "OK" }],
  "finalSignal": { "localStatus": "idle", "aggregateStatus": "idle", "isTreeActive": false, "queuedMessages": 0, "hasError": false }
}
```

### Debug signals auth

Started a Docker dev-auth Chat Web gateway on the worker mapped web port and logged in with dev auth. Verified:

```bash
PIBO_GATEWAY_URL=http://127.0.0.1:4882 npm run --silent dev -- debug signals tree <ps_id> --cookie /tmp/dev_cookie_signals_fix.txt --json
```

Result: pass. The cookie file was a curl/Netscape cookie jar; the CLI parsed it and returned the signal tree. Cookie contents were not saved in repo artifacts.

### Browser/CDP status

Docker Browser Use health check passed:

```bash
docker exec pibo-dev-signals-reliability-fix bash -lc 'cd /workspace && npm run --silent dev -- tools browser-use health'
```

Result: pass.

Full authenticated browser scenario was not completed because no authenticated browser template/lease existed in the dev worker. The API, dev-auth, signal debug CLI, build, deterministic tests, and live Spark runtime smoke all passed.

## Test-plan checklist status

- [x] Deterministic tests pass.
- [x] Host Spark smoke passes.
- [x] Model PATCH updates live runtime before persistence path completes.
- [x] Provider/runtime failures produce error signals.
- [x] `Working...` follows selected signal activity when a signal snapshot exists.
- [x] Error rows do not render Idle dots.
- [x] Background rows receive bounded navigation reconciliation while sessions view is visible.
- [x] `pibo debug signals --cookie` works with a curl cookie jar.
- [ ] Full Browser/CDP selected-session and reload artifacts captured. Blocked by missing authenticated Browser Use template in this worker.

## Rollout note

No production gateway restart or deploy was performed. Dev/prod deployment remains gated by user approval and the project deployment process.
