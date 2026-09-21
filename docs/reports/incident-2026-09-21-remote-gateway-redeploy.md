---
type: "Incident Report"
title: "Incident 2026-09-21: Pibo Remote Gateway redeploy from Beta 4.0 with send and queue failures"
description: "Records the post-reboot redeploy of the FRP-exposed remote gateway from beta/4.0-plugin-system, two composition-migration crashes, the missing gateway-port fix, the end-to-end CONNECTIVITY_OK proof, the oldest_wait_age queue rejection analysis, and a follow-up assessment of recurring send timeouts plus a non-Pibo safety-filter rejection."
tags: ["remote-agent", "gateway", "frp", "incident", "beta-4.0", "plugin-system", "message-queue"]
status: "stable"
authority: "evidentiary"
generated:
  by: "muse-code/muse-spark"
  at: "2026-09-21T17:14:34Z"
sources:
  - id: "deploy-checkout"
    resource: "scope:repository checkout beta/4.0-plugin-system at 47342db6 with uncommitted plugin/compute changes"
    title: "Deployed Beta 4.0 gateway code"
  - id: "remote-home"
    resource: "scope:host gateway home /root/.pibo-remote-oauth-test (pibo.sqlite, pibo-remote-agent.sqlite, remote_tool_calls, gateway log)"
    title: "Remote gateway state, call log, and boot log"
  - id: "plugin-source"
    resource: "scope:repository source src/plugins/backend-loader.ts, src/plugins/manager.ts, src/plugins/default-packages.ts, src/agent-runtime/routed-session.ts, src/remote-agent/service.ts, src/plugins/packaged-remote-agent.ts"
    title: "Composition guard, admission drain, runtime queue admission, and send-port wiring"
---

# Incident 2026-09-21: Pibo Remote Gateway redeploy from Beta 4.0 with send and queue failures

**Date:** 2026-09-20/21 (host reboot 2026-09-20 20:55 CEST; all DB/log timestamps below are UTC).
**Instance:** FRP-exposed Pibo Remote Gateway, home `/root/.pibo-remote-oauth-test`, MCP `127.0.0.1:5790` via FRP proxy `pibo-remote-mcp` (`remotePort 20081`).
**Outcome:** Gateway runs from Beta 4.0 code with the original remote data; send path verified end to end (`CONNECTIVITY_OK`); queue rejection explained, no data loss.

## Timeline

- **2026-09-20 20:55 CEST:** Host reboot. The old vibe-test gateway (`PIBO_HOME=/tmp/pibo-remote-vibe/.pibo`, ports 5788/5789) is gone with `/tmp`. The remote gateway is down (stale `gateway.pid` 85532, no process). FRP client (`pibo-remote-mcp-frpc.service`) comes back healthy by itself: server login OK, proxy `pibo-remote-mcp` → `127.0.0.1:5790` active, only waiting for the local listener.
- **Deploy decision:** Run Beta 4.0 code (`beta/4.0-plugin-system` at `47342db6`, main checkout) against the existing remote home, so rooms, sessions, and remote tokens survive. Pre-checks passed: the branch already contains the `feature/pibo-remote-agent` merge (worktree HEAD `175afcfa` is an ancestor; remote-agent file diff is empty), and `dist/` is in sync with sources (backend, `pibo4-artifacts`, chat-UI asset). Targeted backup first: all `*.sqlite*` plus settings, reaper state, and `remote-agent/` → `/root/.pibo-remote-oauth-test-backup-20260920` (76 MB).
- **Crash 1 — stale plugin SDK symlink:** Boot dies with `Plugin SDK resolution belongs to another package; change it only at a stopped composition boundary` (`src/plugins/backend-loader.ts`). Cause: `plugins/artifacts/node_modules/@pasko70/pibo` still pointed at the old feature worktree. Fix: symlink removed while the gateway was stopped (a valid stopped composition boundary); the new boot recreated it pointing at the Beta checkout.
- **Crash 2 — old plugin revision vs new core:** Boot dies with `Unknown tool "pibo_gateway_send"` from a prior-revision plugin backend during consumer collection. Cause chain: 4 sessions (`ps_e843…`, `ps_d6e2…`, `ps_c034…`, `ps_c5d5…`) held `reserved` plugin admissions orphaned by the reboot; every durable admission counts as an `active` drain blocker (`PluginManager.admissionConsumers`), so all default-plugin updates deferred and the incompatible old backends stayed live. Fix: released exactly those 4 orphans through the product's own API (`releaseSupersededSessionAdmissions`, the same call the router makes on session rebind), offline while the gateway was stopped.
- **Boot OK (PID 1682):** Ports 5788/5789/5790 listen, `mcp-address.json` fresh, `/gateway/status` OK, `/openapi.json` 200, remote-agent UI asset 200, zero deferred plugin updates, 6 interrupted turns recovered.
- **`ECONNREFUSED 127.0.0.1:4789` on `remote_session_send`:** `sendSessionMessage` dials the TCP agent gateway, defaulting to `DEFAULT_GATEWAY_PORT = 4789` (`src/gateway/protocol.ts`, `src/gateway/request.ts`); the packaged plugin takes the override only from `PIBO_REMOTE_AGENT_GATEWAY_PORT` (`src/plugins/packaged-remote-agent.ts`), which was not set, while the agent gateway listens on 5789. All other remote tools bypass that TCP path, matching the symptom (only send failed). Fix: restart with `PIBO_REMOTE_AGENT_GATEWAY_PORT=5789` (PID 16671); variable confirmed in `/proc/16671/environ`.
- **End-to-end proof:** Temporary token (modules `sessions`+`observe`, room `room_3dd92882-…`, id `rt_a5a00633-…`) minted via the product auth API, then `POST /api/remote/session_send` to `ps_d6e27f3f-…` with the operator's connectivity text → `{"ok": true, "reply": "CONNECTIVITY_OK"}`. Token revoked immediately afterwards; plaintext never persisted outside `/tmp` and shredded.
- **Queue-capacity report (read-only analysis, nothing changed):** At 05:09:06Z a send to `ps_d6e27f3f-…` was rejected in 5 ms with `Session runtime queue oldest_wait_age capacity reached (current=872754, limit=600000).` See findings below.

## Findings

1. **No separate remote queue exists.** `src/remote-agent` holds no queue; `remote_session_send` travels the standard path (MCP/REST → TCP agent gateway → session router → per-session runtime queue), identical to a chat-web message. The durable message queue is a separate layer and reported `healthy` throughout.
2. **The rejection came from per-session admission control** (`src/agent-runtime/routed-session.ts`): before enqueue, four dimensions are enforced (single message ≤ 1 MiB, < 64 queued, ≤ 4 MiB total, oldest waiter < 10 min). The session was backlogged behind long-running turns, so the oldest waiter (872 s) tripped the 10-minute limit.
3. **Reply timeouts are not rejections.** Five sends between 04:40Z and 05:26Z returned `Timed out waiting for assistant reply` after 120 s but were accepted and queued; each timeout-looking failure invited a retry, which deepened the backlog until the 05:09 rejection. The consolidated final order (05:26Z) was accepted and observed live as `queuedMessages: 1` behind an actively processing/streaming turn — queued, not lost.
4. **Composition migration across checkouts has two traps:** the `@pasko70/pibo` SDK symlink is pinned to the previous checkout, and reboot-orphaned `reserved` admissions block every default-plugin update. Both are safe to clear at a stopped boundary; the gateway cannot self-heal them because the stale revisions crash the new core first.

## Current state and restart command

Gateway runs detached from the Beta checkout with the remote home. Any restart must set all three variables or the send path breaks again:

```bash
cd /mnt/c/Users/pasca/Coding/pibo
PIBO_HOME=/root/.pibo-remote-oauth-test \
PIBO_REMOTE_AGENT_MCP_PORT=5790 \
PIBO_REMOTE_AGENT_GATEWAY_PORT=5789 \
setsid -f node dist/bin/pibo.js gateway:web --auth local \
  --web-host 127.0.0.1 --web-port 5788 --gateway-port 5789 \
  </dev/null >>/root/.pibo-remote-oauth-test/gateway-remote-stdout.log 2>&1
```

## Addendum 2026-09-21 (evening): recurring timeouts and safety-filter note

An agent using the Pibo Remote tool reported (read-only investigation, nothing changed): send calls again returned reply timeouts (acceptance verified afterwards in the target sessions, no gateway failure derived), and an update of the older `launch-control.json` was rejected by a tool safety filter, so run status moved to `beta4-wave1-revision2-20260921/revision2-control.json`.

**Send timeouts — same known mechanism, now broader.** Between 16:43Z and 17:10Z, nine more `remote_session_send` calls returned `Timed out waiting for assistant reply` (120 s) across seven sessions (`ps_e564…` ×4, `ps_ac85…`, `ps_9372…`, `ps_6a15…`, `ps_cba1…`, `ps_dde7…`, `ps_9ad7…`), plus two `oldest_wait_age` rejections on `ps_ec3ef267-…` (16:42Z/16:46Z, oldest waiter ≈ 35 min vs the 10-minute limit). All timeouts were accepted-but-slow sends, not losses — the agent's handling (verify acceptance, no gateway-failure conclusion) is exactly right and validates finding 3 above. 607 remote calls succeeded in the same window, so the tool path itself is healthy; the constraint is session-side turn duration vs the fixed 120 s MCP reply wait. Live status during analysis: `ps_e564…` processing with 1 queued; `ps_ac85…` processing with **stale telemetry** (`message_started`, `stale=true`) — a turn making no progress, worth watching but left untouched per the read-only constraint; all other involved sessions idle with drained queues.

**`launch-control.json` safety-filter rejection — not Pibo-side.** The `remote_tool_calls` log holds zero failed file calls for that path; the same file was successfully read and edited through the same tool earlier the same day (edits 12:22Z and 15:18Z, read 16:44Z), and the room (`room_86bb3bca-…`) runs in YOLO mode with all modules, i.e. no server-side path fencing applies at all. A Pibo-side rejection would have left an `ok=0` record — none exists — so the safety filter that refused the write lives in the external agent's own toolchain (their harness/client side). It cannot be diagnosed from Pibo logs; the exact client-side error text would be needed. File states confirm the agent's workaround: `beta4-parallel-start-20260920/launch-control.json` still shows `wave1-corrections-running` (last write 15:18Z), while `beta4-wave1-revision2-20260921/revision2-control.json` carries the current statuses (edited 16:54Z, last write 17:06Z).

## Follow-ups (not done)

- Add a systemd unit for this gateway (analogous to `pibo-remote-mcp-frpc.service`) so reboots and env vars are handled automatically. Offered to the operator, awaiting confirmation.
- The deploy tree carries uncommitted changes (`src/plugins/default-packages.ts`, `src/compute/pool/artifacts.ts`, `scripts/build-pibo4-*.mjs`, related tests/docs); the running `dist` includes them.
- `/gateway/status` reports `mode: dev` (no `PIBO_GATEWAY_MODE` set); cosmetic, FRP path unaffected.
- Remote callers should treat the 120 s reply timeout as accepted-unknown rather than failed, to avoid piling duplicate backlog onto busy sessions.

## Verification

- Ports 5788/5789/5790 listening; `/gateway/status` `ok`; `/openapi.json` 200; tab asset 200; `/mcp` without token 401.
- Fresh `mcp-address.json` (pid matches gateway); zero deferred plugin updates in the final boot section; FRP journal shows no `connection refused` since the gateway came up.
- Live `CONNECTIVITY_OK` round trip through the public REST path, then test credential revoked (`{"revoked": true}`).
