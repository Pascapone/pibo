# Preserve session overlays validation — 2026-08-07

## Verdict

The authenticated Pibo2 steer → switch session → return path passes on immutable candidate `preserve-session-overlays/600151ee`.

On the first return render, the accepted optimistic user message and Terminal `Working...` footer were both present, while the Queue/Steer dialog remained closed. The persisted delivery event was `message_steered` at stream ID `954543`.

No release was performed.

## Original failure

The real Pibo2 UI reproduced three visible failures after choosing Steer and immediately switching away and back:

- the delivery dialog remained open while delivery and refetch work completed;
- the accepted optimistic user message disappeared temporarily;
- the active Terminal footer disappeared temporarily.

A precise baseline watch observed the footer returning after 660 ms, the message after 725 ms, and the dialog closing after 877 ms.

## Confirmed causes

1. A single `liveTraceOverlay` was cleared on every session change.
2. Queue/Steer selection closed the dialog only after awaited delivery and refetch work.
3. Base traces and overlays were restored through effect-driven state updates instead of being selected synchronously from session caches.
4. Reconciliation treated `latestStreamId` as proof that every older overlay event existed in a bounded 50-event tail page. A steered message omitted from that page could therefore be discarded without exact confirmation evidence.
5. Compact Terminal keyed `Virtuoso` by session, forcing a virtual-list remount on every switch and delaying cached rows on return.
6. Overlay cache entries were not mirrored on every live mutation, and failure rollback did not clean an off-screen session cache.

## Implemented behavior

The focused branch `fix/preserve-session-overlays` now:

- captures the pending send plan and closes the delivery dialog before awaiting delivery;
- caches base traces and live overlays by Pibo session;
- mirrors every non-null live-overlay mutation into the session cache;
- selects cached base traces and overlays synchronously for the selected session;
- preserves overlay events across bounded tail pages until exact event or transcript confirmation exists;
- removes failed optimistic events from visible or off-screen cached overlays;
- keeps cached trace content visible during navigation loading;
- resets sticky-scroll state without remounting Compact Terminal's virtual list.

Focused commits:

```text
27b612f4 fix(chat): preserve optimistic sends across session switches
aa4df746 fix(chat): restore cached traces before paint
62e4b3ba fix(chat): retain trace pages across navigation
fd15edf6 fix(chat): keep cached trace visible while switching
70eb2932 fix: preserve bounded optimistic trace overlays
6f8cc6d4 fix: mirror live overlays into the session cache
7e10f744 fix: reuse terminal virtualization across sessions
```

## Automated validation

Run from `/root/code/pibo/.worktrees/preserve-session-overlays`:

```bash
node --test \
  test/chat-ui-session-overlay-cache.test.mjs \
  test/chat-ui-current-trace-view.test.mjs \
  test/chat-ui-terminal-message-timing.test.mjs
npm run typecheck
npm run build
git diff --check
```

Results:

- 8 tests passed;
- root, Chat UI, Context Files UI, and VS Code typechecks passed;
- production Chat UI, Context Files UI, and VS Code webview builds passed;
- `git diff --check` passed.

The combined validation branch also passed the same focused tests and Chat UI typecheck before packaging.

## Candidate

Validation branch head:

```text
600151ee fix: reuse terminal virtualization across sessions
```

Package:

```text
/root/.pibo/candidate-packages/pibo-600151ee.tgz
SHA-256 a657e0a5cbf6e215f34df4be24830a6dc9f8ecf5074f4ad27b25b79fc08856e2
```

Active installation:

```text
/opt/pibo-candidates/preserve-session-overlays/600151ee
```

Activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T034613Z-preserve-session-overlays
```

## Real browser result

Environment:

- public UI: `https://pibo2.neuralnexus.me/apps/chat`;
- active session: `ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c`;
- idle switch target: `ps_39f6035d-fada-4cfb-a557-416188529f81`;
- authenticated headful Chrome over loopback-only CDP;
- delivery: Steer;
- message: `Also include the temporary-database cleanup guarantees in the final verification caveats.`

Measured result:

| Check | Result |
|---|---:|
| Dialog close after Steer click | 17 ms |
| Switch to idle session | 23 ms |
| Return switch | 79 ms |
| Optimistic text visible at return | 0 ms / first sample |
| Terminal footer visible at return | 0 ms / first sample |
| Delivery dialog visible at return | No |
| Sidebar status reconciliation | `loading` → `running` by 75 ms |
| Persisted delivery | `message_steered`, stream ID `954543` |

All samples from 1 ms through 116 ms after return retained both text and footer without reopening the dialog.

Evidence:

```text
/tmp/pibo2-overlay-final-watch-2026-08-07.json
/root/code/pibo/docs/reports/artifacts/pibo2-overlay-final-2026-08-07.png
SHA-256 b787bc8d97746216bbcda3007c9425b0e6eaa017cb5baf629ca278048ab0fc2c
279762 bytes
```

## Browser harness hardening used by this validation

The server-development skill was updated independently of the product branch:

- Chrome runs in transient `pibo2-headful-chrome.service` with `Restart=always`;
- a forced `SIGKILL` recovered CDP in about 1.56 seconds;
- machine-session cookies now use their explicit signed expiry and survived the forced restart;
- Chrome restarts toward Chat Web and requests last-session restoration;
- the generated browser environment sets `MCP_DAEMON_TIMEOUT=86400`, avoiding Pibo MCP's default 60-second idle teardown during long investigations;
- status reports Chrome main PID, restart count, and diagnostic-log bytes.

## Follow-up finding outside this fix

Two deliberately invalid Steer attempts occurred after the previous turn had already finished. The API persisted `user.message.accepted` followed by `user.message.failed`, but the session signal remained at `message_started`/`running` while gateway runtime state was `processing=false` and `streaming=false`.

This stale failed-send lifecycle signal is a separate status-semantics defect. It did not affect the final valid-steer result above, which was verified while gateway runtime was genuinely processing and persisted `message_steered`. It should be addressed in a separate focused change.
