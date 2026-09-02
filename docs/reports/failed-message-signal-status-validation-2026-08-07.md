---
type: "Evidence Report"
title: "Failed message signal reconciliation validation — 2026-08-07"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/failed-message-signal-status-validation-2026-08-07.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "db0b066c83e12a4a6be943ce3bea332b8cc522a4"
  source_bytes: 6019
  source_sha256: "73fafc7a3dd7f051dc98369b232ea065d728107da33920847fd2a16f2bccdf3c"
  source_body_sha256: "73fafc7a3dd7f051dc98369b232ea065d728107da33920847fd2a16f2bccdf3c"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:failed-message-signal-status-validation-2026-08-07"
  published_at: "2026-09-01T07:57:34Z"
---
# Failed message signal reconciliation validation — 2026-08-07

## Verdict

The authenticated Pibo2 invalid-Steer race passes on immutable combined candidate `failed-message-signal-status/a4c3cb50`.

A second message was accepted optimistically while a turn was active. The delivery dialog was left open until that turn completed, then **Steer** was selected against the now-idle runtime. The API correctly persisted `user.message.accepted` followed by `user.message.failed`; the optimistic row rolled back; the dialog closed immediately; and the session signal reconciled to `idle` instead of remaining falsely `running`.

No release was performed.

## Original failure

Before this fix, the same post-acceptance dispatch failure left signal projection at `message_started` / `running` even though gateway runtime state reported:

```text
processing=false
streaming=false
queued=0
```

The failed message itself was already persisted correctly as an accepted command followed by `user.message.failed`. The defect was limited to signal projection after the accepted command failed to dispatch.

## Implemented behavior

Focused branch `fix/failed-message-signal-status` adds one internal signal input, `message_rejected`, and projects it when message dispatch throws after command acceptance.

The projection:

- removes the rejected optimistic message node;
- removes the synthetic accepted turn only when it belongs to that rejected message;
- preserves an unrelated real active turn;
- reconciles actual runtime `processing` and queue state;
- leaves the existing `user.message.failed` persistence and HTTP error semantics unchanged.

Focused implementation commit:

```text
6bb9c37b fix: reconcile signals after rejected messages
```

## Automated validation

Focused worktree `/root/code/pibo/.worktrees/failed-message-signal-status`:

```bash
npm run build
node --test test/signal-registry.test.mjs test/session-router-store.test.mjs
npm run typecheck
git diff --check
```

Results:

- 56 tests passed;
- root, Chat UI, Context Files UI, and VS Code typechecks passed;
- production Chat UI, Context Files UI, and VS Code webview builds passed;
- `git diff --check` passed.

Combined validation branch `/root/code/pibo/.worktrees/pibo2-terminal-validation`:

```bash
npm run build
node --test \
  test/chat-ui-session-overlay-cache.test.mjs \
  test/chat-ui-current-trace-view.test.mjs \
  test/chat-ui-terminal-message-timing.test.mjs \
  test/signal-registry.test.mjs \
  test/session-router-store.test.mjs
npm run typecheck
git diff --check
```

Results:

- 63 tests passed;
- full typecheck passed;
- production build passed;
- package creation passed.

## Backup, candidate, and rollback

Pre-activation full server backup:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260807T041018Z.tar.zst
SHA-256 d4e37fdac2996ef5d3a82d77591483946fc2b1146951947e22b82979993527d5
restore quick_check: 15 SQLite databases OK
```

Validation branch head:

```text
a4c3cb50 fix: reconcile signals after rejected messages
```

Package:

```text
/root/.pibo/candidate-packages/pibo-a4c3cb50.tgz
SHA-256 468801b080fc9082c9c0519a747e71fe0bd280f6939dbada094844b8242858e7
```

Active installation:

```text
/opt/pibo-candidates/failed-message-signal-status/a4c3cb50
```

Activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T042012Z-failed-message-signal-status
```

The running service reported `PIBO_DEPLOY_CANDIDATE=failed-message-signal-status` and `PIBO_DEPLOY_COMMIT=a4c3cb50`.

## Real browser scenario

Environment:

- public UI: `https://pibo2.neuralnexus.me/apps/chat`;
- room: `room_99a714f3-b7e5-4cb8-a845-893206fa7e6a`;
- session: `ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c`;
- authenticated supervised non-headless Chrome over loopback-only CDP;
- real OpenAI-backed agent turn and real public Web/API path.

Steps:

1. Send a first message instructing the agent to run `sleep 8` and then return `FIRST_DONE`.
2. While the turn is running, send `SECOND_REJECTED_SIGNAL_PROBE...` so the Queue/Steer dialog opens.
3. Wait until the first turn has persisted `message_finished` and gateway status reports `processing=false`.
4. Click the still-open **Steer** action.
5. Sample dialog, optimistic row, Terminal footer, sidebar status, persisted events, live signal snapshot, and gateway state.

## Measured result

| Check | Result |
|---|---:|
| Dialog closed | 23.7 ms |
| Optimistic rejected row first visible | 23.7 ms |
| Optimistic rejected row removed | 67.1 ms |
| Transient runtime-working badge removed | 67.1 ms |
| Stale `Working...` footer | Never observed |
| Dialog reopened | No, through 3,047.5 ms |
| Rejected row reappeared | No, through 3,047.5 ms |
| Final signal status | `idle` |
| Final `isTreeActive` | `false` |
| Final gateway runtime | `processing=false`, `streaming=false`, `queued=0` |

Persisted rejected-message events:

```text
954629  2026-08-07T04:22:44.714Z  user.message.accepted
954630  2026-08-07T04:22:44.719Z  user.message.failed
```

Failure message:

```text
The active session cannot accept steering right now.
```

No `message_started` event was persisted for the rejected probe. The live signal snapshot generated after the failure contained:

```json
{
  "piboSessionId": "ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c",
  "updatedAt": "2026-08-07T04:22:44.719Z",
  "status": "idle",
  "isTreeActive": false
}
```

## Evidence

```text
/tmp/pibo2-failed-message-signal-watch-2026-08-07.json
SHA-256 3f8edf4c51a475483d7a1d0da2f9db23eeeec59cb41301db5fc8124c49714b40

/root/code/pibo/docs/reports/artifacts/pibo2-failed-message-signal-status-2026-08-07.png
SHA-256 c3b3335c6a2522e7374dba10df6c6fee13c830d2c9125cb0988e9acaa170152a
235721 bytes
```

## Remaining scope

This validation proves the failed-message signal reconciliation and UI rollback path. It does not replace the separate ongoing investigations into live-versus-reload equivalence, historical pagination, span ordering, slow historical-span loading, or authenticated bootstrap/render performance.
