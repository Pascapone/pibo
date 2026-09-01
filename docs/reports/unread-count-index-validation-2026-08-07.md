---
type: "Evidence Report"
title: "Unread count index validation — 2026-08-07"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/unread-count-index-validation-2026-08-07.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "cdaf5b8efa6c7dd0ed042ccfcaebd22f85d9f83d"
  source_bytes: 6494
  source_sha256: "11d256c91730e1039a5af62ca1314757aa83e786ea545170a40aa07f8d4e4803"
  source_body_sha256: "11d256c91730e1039a5af62ca1314757aa83e786ea545170a40aa07f8d4e4803"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:unread-count-index-validation-2026-08-07"
  published_at: "2026-09-01T07:57:34Z"
---
# Unread count index validation — 2026-08-07

## Verdict

The authenticated Pibo2 bootstrap/navigation path passes on immutable combined candidate `unread-count-index/2261514f`.

An additive partial SQLite index preserves the existing unread result while reducing a representative 400-session unread query from 71.1 ms to a 1.43 ms median. Controlled browser requests reduced bootstrap median latency by 76.9% and navigation median latency by 72.1%.

No release was performed.

## Original bottleneck

Pibo2 contained:

```text
2,585 active sessions
41 rooms
632,640 event_log rows
10,329 unread-relevant message/error rows
```

`ChatReadStateService.countUnreadMessagesBySession` batches session IDs in groups of 400. Before the change, SQLite used the general index:

```text
SEARCH e USING INDEX idx_event_log_session_stream (session_id=?)
```

A representative 400-session batch took 71.1 ms. Seven batches account for most of the roughly 600 ms authenticated bootstrap/navigation server wait. A read-only global equivalent query measured 0.42–0.48 seconds and returned the expected 1,095 unread event rows at that point in time.

## Implemented behavior

Focused branch `fix/unread-count-index` adds:

```sql
CREATE INDEX IF NOT EXISTS idx_event_log_unread_session_stream
  ON event_log(session_id, stream_id)
  WHERE (retention_class = 'chat_message'
         AND type IN ('user.message.accepted', 'assistant_message'))
     OR type = 'session_error';
```

The change is additive. It does not alter read cursors, event rows, unread semantics, API payloads, or UI behavior.

Focused implementation commit:

```text
f6d2b016 perf: index unread message counts
```

## Automated validation

Focused worktree `/root/code/pibo/.worktrees/unread-count-index`:

```bash
npm run build
node --test test/chat-v2-native-services.test.mjs
npm run typecheck
git diff --check
```

Results:

- V2-native room/session/timeline/command/read-state test passed;
- the test confirms the unread index exists and is partial;
- existing unread-count assertions passed unchanged;
- root, Chat UI, Context Files UI, and VS Code typechecks passed;
- production Chat UI, Context Files UI, and VS Code webview builds passed;
- `git diff --check` passed.

Combined validation candidate:

- 64 focused tests passed;
- full typecheck passed;
- production build and package creation passed.

## Backup, candidate, and rollback

Pre-activation full backup:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260807T044344Z.tar.zst
SHA-256 78f646c58adcf27e4c361e6d415362565f1a82ca2e1433efef0bd676098f2913
restore quick_check: 15 SQLite databases OK
```

Validation branch head:

```text
2261514f perf: index unread message counts
```

Package:

```text
/root/.pibo/candidate-packages/pibo-2261514f.tgz
SHA-256 ab6eeab28abfb35585a329f904964bd44ba2a7f8b6d4262cb83fe9b65ea6e27c
```

Active installation:

```text
/opt/pibo-candidates/unread-count-index/2261514f
```

Activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T045406Z-unread-count-index
```

The running service reports `PIBO_DEPLOY_CANDIDATE=unread-count-index` and `PIBO_DEPLOY_COMMIT=2261514f`.

## Production query-plan result

After candidate activation, schema initialization created the partial index on the existing database. SQLite selected it for the unchanged unread query:

```text
SEARCH e USING INDEX idx_event_log_unread_session_stream (session_id=?)
```

Five representative 400-session batch timings:

```text
1.973 ms
1.286 ms
1.431 ms
1.732 ms
1.322 ms
```

Median: **1.431 ms**. Compared with the 71.1 ms baseline, that is about a **98.0%** reduction for the representative batch.

## Controlled authenticated browser result

Environment:

- public UI/API: `https://pibo2.neuralnexus.me/apps/chat`;
- session: `ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c`;
- room: `room_99a714f3-b7e5-4cb8-a845-893206fa7e6a`;
- authenticated supervised non-headless Chrome over loopback-only CDP;
- ten alternating no-store bootstrap and navigation requests before and after activation.

### Latency

| Endpoint | Baseline p50 | Candidate p50 | p50 reduction | Baseline p95 | Candidate p95 | p95 reduction |
|---|---:|---:|---:|---:|---:|---:|
| Bootstrap | 611.1 ms | 140.9 ms | 470.2 ms / 76.9% | 631.9 ms | 305.1 ms | 326.8 ms / 51.7% |
| Navigation | 605.6 ms | 169.1 ms | 436.5 ms / 72.1% | 614.1 ms | 284.6 ms | 329.5 ms / 53.7% |

### Semantic checks

All 40 controlled responses returned HTTP 200.

Before and after:

```text
room count: 41
selected-room session count: 3
recursive room unread total: 1,098
latest room stream ID: 954784
```

The small response-byte difference after restart came from absent idle runtime-detail state, not unread data. The room/session counts, stream cursor, and unread total were unchanged.

## Single-tab reload profile

Initial traces were distorted by accidental duplicate Chat tabs. Each tab maintained its own health checks, SSE connections, signal reconciliation, and trace/navigation refreshes. The browser was reduced to one authenticated tab before the final profile.

Single-tab Resource Timing on the candidate:

| Request | Queue | TTFB | Download | Total |
|---|---:|---:|---:|---:|
| `/api/chat/bootstrap` | 1.7 ms | 151.6 ms | 2.1 ms | 155.4 ms |
| `/api/chat/trace/timeline` | 1.2 ms | 51.4 ms | 5.3 ms | 57.9 ms |
| selected signal tree | 3.7 ms | 88.0 ms | 2.8 ms | 94.5 ms |

Reload metrics:

```text
LCP: 1,132 ms
TTFB: 7 ms
LCP render delay: 1,125 ms
CLS: 0.00
forced reflow: 44 ms
```

The remaining LCP is render-dominated. Bootstrap unread counting is no longer the dominant server delay; render work and selected trace/signal presentation remain the next optimization scope.

## Evidence

```text
/tmp/pibo2-unread-index-baseline-2026-08-07.json
SHA-256 8b8a9958f5d3120b5d1c5edc2515c7aef77c7847dd3c9a148ad6bdef9d2ca209

/tmp/pibo2-unread-index-post-2026-08-07.json
SHA-256 b1eb578bad7d89b189943c8ca5fe4406c999aece1ce74af3c96c7ec57f9401f8

/tmp/pibo2-authenticated-bootstrap-unread-index-single-tab-2026-08-07.json.gz
SHA-256 e99875141cb935dce34ad458524b4f347348a73333d27e6ccd4214415019f59d
615970 bytes
```

## Remaining scope

- The partial index is compatible with binary rollback, but the additive index remains unless the database backup is restored or it is explicitly dropped.
- This change does not optimize trace projection, signal-tree rendering, DOM/style work, or long-lived multi-tab load.
- LCP remains mostly render delay and requires a separate focused change.
