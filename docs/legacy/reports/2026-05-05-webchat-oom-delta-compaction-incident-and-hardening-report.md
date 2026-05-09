# Webchat OOM / Delta Compaction Incident and Hardening Report

Date: 2026-05-05

## Executive Summary

The Chat Web App became slow/unresponsive and showed sessions as permanently running because the gateway had to process millions of persisted streaming delta events. These events (`assistant_delta`, `thinking_delta`, `tool_execution_updated`) are useful for live browser streaming, but should not be durable trace history.

Root cause:

- Live streaming deltas were persisted into the durable Chat and Reliability SQLite stores.
- Trace/session APIs later loaded and materialized these rows into Node.js objects, JSON payloads, trace nodes, caches, and SSE replay paths.
- This caused gateway memory growth, high CPU, slow UI responses, stuck-looking running sessions, and difficult restarts/fallback transitions.

Immediate remediation completed:

- Backed up production SQLite databases.
- Deleted all live-only delta rows from production Chat and Reliability stores.
- Deployed the delta-compaction code path that prevents new live-only deltas from being durably persisted.
- Verified `liveOnlyRows: 0` after migration.
- Verified main gateway health is back to `mode: main`.

Current state:

- Main gateway is running.
- Live-only delta rows: `0`.
- Current logical Chat event count is about 37k rows per Chat store table, down from millions of live-only rows.
- Gateway memory is around 500-600 MB after restart, with substantially more headroom than before.

## User-Visible Symptoms

Observed symptoms before remediation:

- Sessions stayed green/pulsing as if always running.
- New-message state did not reliably turn blue.
- Sessions did not visually settle after model work stopped.
- Session content/trace views loaded poorly or not at all.
- Hard refresh did not fix the issue.
- Main gateway entered a bad state and fallback was shown:
  - `Recovery Mode: Main gateway is down. You are connected to a fallback instance.`

These symptoms were consistent with a gateway under heavy memory/CPU pressure and trace APIs trying to process too much historical event data.

## Root Cause

The database did not become dangerous merely because the SQLite file was large. The critical failure mode was:

1. During model output, Pibo emits many fine-grained streaming events.
2. These events included:
   - `thinking_delta`
   - `assistant_delta`
   - `tool_execution_updated`
3. They were historically stored durably in SQLite.
4. On trace/session load, the gateway materialized large sets of these rows into memory.
5. The browser trace model and server trace model then had to reduce/render/replay too much data.
6. Node.js memory and CPU usage rose until the gateway became unstable.

In short:

> DB contains millions of fine-grained delta rows → trace/API loads many of them → Node.js materializes them into objects/JSON/trace structures → memory grows → gateway becomes slow or unstable.

## Quantitative Findings Before Cleanup

The dry-run before apply reported:

```json
{
  "chat": {
    "liveOnlyRows": 1655288,
    "assistant_delta": 269485,
    "thinking_delta": 1356850,
    "tool_execution_updated": 28953
  },
  "reliability": {
    "liveOnlyRows": 1087535,
    "assistant_delta": 167649,
    "thinking_delta": 903304,
    "tool_execution_updated": 16582
  }
}
```

The largest contributor was `thinking_delta`.

Gateway/system observations around the incident:

- Main gateway previously reached roughly 2.4-2.7 GB memory peak.
- Gateway stop/restart behavior became slow or stuck-looking under load.
- Fallback service activated while main was down/stopping.

## Remediation Performed

### Backup

A production backup was created before mutation:

```text
~/.pibo/backups/delta-compaction-20260505T225644Z
```

Files:

- `web-chat.sqlite`
- `pibo-events.sqlite`
- `SHA256SUMS`
- `dry-run-before.json`
- `apply.json`
- `dry-run-after.json`
- `web-live-only-after.txt`

### Apply

Command class used:

```bash
pibo debug events compact-deltas --apply --json
```

Rows deleted:

- Chat store: `1,655,288`
- Reliability store: `1,087,535`

### Verification After Apply

Post-cleanup dry-run:

```json
{
  "results": [
    {
      "store": "chat",
      "liveOnlyRows": 0,
      "plannedDeletes": 0
    },
    {
      "store": "reliability",
      "liveOnlyRows": 0,
      "plannedDeletes": 0
    }
  ]
}
```

Current logical row counts observed after cleanup:

```text
web_chat_events      36,718
chat_events          37,157
web_chat_sessions       114
reliability rows     44,584
```

Current largest sessions are around 1k-2k durable events, not hundreds of thousands or millions.

## Code-Level Fixes Implemented

The durable persistence policy was changed so that live-only deltas remain live browser events but are not written to durable stores for new runs.

Key concepts:

- Live-only events:
  - `assistant_delta`
  - `thinking_delta`
  - `tool_execution_updated`
- Persistable/canonical events:
  - `assistant_message`
  - `thinking_started`
  - `thinking_finished`
  - `tool_call`
  - `tool_execution_started`
  - `tool_execution_finished`
  - `message_started`
  - `message_finished`
  - etc.

Key files:

- `src/apps/chat/output-event-policy.ts`
- `src/apps/chat/output-compactor.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/event-log.ts`
- `src/apps/chat/read-model.ts`
- `src/apps/chat/stream.ts`
- `src/apps/chat-ui/src/traceLiveReducer.ts`
- `src/debug/delta-compaction.ts`

Behavior after fix:

- Browser still receives live streaming deltas.
- Durable stores defensively reject live-only delta rows.
- Output compactor creates canonical final events where possible.
- Trace loading is bounded.
- Raw-event trace responses are not cached in the same way as normal trace views.
- A debug command can inspect/clean legacy live-only rows.

## Testing Performed

Validation completed before and during deployment:

- `npm run typecheck` passed.
- `npm test` passed: 254/254.
- Docker Compute browser verification passed.
- Two isolated Docker E2E agent workers tested browser login/UI and compaction scenarios.
- Self Docker worker tested API/browser UX and dist-level compaction behavior.
- Production dry-run/apply/post-dry-run verified delta rows are gone.

Report for Docker E2E/UX validation:

- `reports/2026-05-05-webchat-oom-e2e-ux-validation.md`

## Current Headroom

Current observed gateway state after remediation:

- Main gateway: active/running.
- Gateway memory: about 500-600 MB RSS during observation.
- Gateway peak since restart: about 1 GB.
- Host available memory: about 2.4 GB.
- Live-only rows: 0.

This is substantially healthier than the incident state, where the gateway reached multiple GB and had difficulty stopping/restarting cleanly.

## Disk Size vs Logical Data Size

Important distinction:

- SQLite files are still physically large:
  - `web-chat.sqlite`: about 1.7 GB
  - `pibo-events.sqlite`: about 881 MB
- But most of that space is now SQLite freelist/free internal space after deletes.

Observed SQLite freelist estimates:

- `web-chat.sqlite`
  - `page_count`: 422,601
  - `freelist_count`: 380,889
  - `page_size`: 4096
  - Most pages are free internally.
- `pibo-events.sqlite`
  - `page_count`: 225,360
  - `freelist_count`: 202,584
  - `page_size`: 4096
  - Most pages are free internally.

This means the logical data has been reduced, but disk files have not yet been compacted. This does not recreate the same RAM problem by itself, but it wastes disk and can affect some I/O behavior.

## Remaining Risks

### 1. Stuck Running Sessions

At least one session remained marked `running` after cleanup. This can happen if a process was interrupted, if final events were missed, or if historical status got stuck.

Risk:

- UI status lights may remain misleading even when no model work is active.

Recommended hardening:

- Add a watchdog/doctor that marks old `running` sessions as `idle` or `error` when there is no active backend run and no recent durable activity.

### 2. Other Durable Event Growth

The delta problem is fixed, but other canonical events still grow:

- tool calls
- tool starts/finishes
- thinking starts/finishes
- assistant messages
- execution results
- session errors

These are expected and much lower cardinality than deltas, but they can still grow over time.

Recommended hardening:

- Add retention/pruning policy for old trace events.
- Keep chat messages and canonical summaries longer than low-value operational details.

### 3. Reliability Store Retention

The Reliability store still contains durable event-stream rows. It should not retain every low-level trace event forever unless a named consumer still needs it.

Recommended hardening:

- Define retention windows/classes.
- Add scheduled prune for consumed trace events.
- Keep audit-important rows longer than transient operational rows.

### 4. Disk Bloat After Deletes

SQLite files remain physically large until rewritten/vacuumed.

Recommended hardening:

- Schedule a maintenance window for `VACUUM` or backup/rewrite.
- Always backup first.
- Keep gateway stopped during the rewrite.

### 5. Trace Load Latency

Bounded trace loading reduces worst-case memory use, but initial trace load can still be improved.

Recommended hardening:

- True trace pagination/infinite scroll.
- Initial load should fetch recent canonical events first.
- Older events should load on demand.

## Recommended Next Steps

### Immediate Operational Checks

1. Reset fallback failed state if needed:

```bash
systemctl reset-failed pibo-web-fallback
```

2. Monitor live-only row recurrence:

```bash
npm run dev -- debug events compact-deltas --dry-run --json
```

Expected:

```text
liveOnlyRows: 0
```

3. Monitor gateway memory:

```bash
systemctl status pibo-web --no-pager
```

Healthy target for current workload:

- Around hundreds of MB RSS.
- Investigate if it climbs past ~1.5 GB.

### Short-Term Hardening

1. Add/automate a Chat doctor command:
   - count live-only rows
   - count stuck running sessions
   - report largest sessions by event count
   - report SQLite freelist ratio

2. Add stuck-running cleanup:
   - no active run + old updated_at + status running => mark idle/error.

3. Add monitoring/alert thresholds:
   - live-only rows > 0
   - gateway RSS > 1.5 GB
   - session event count > 10k
   - SQLite freelist > 50% for long periods

### Medium-Term Performance Work

1. Implement trace pagination.
2. Add tool event compaction/summarization for long sessions.
3. Add reliability retention policy.
4. Add scheduled VACUUM/backup-rewrite maintenance.
5. Consider per-session trace summaries for old turns.

## Conclusion

The incident was caused by live streaming delta events being durably persisted and later loaded/processed as trace history. This created millions of rows and drove Node.js memory growth when trace/session views were opened or replayed.

The acute issue is remediated:

- Legacy live-only rows were backed up and deleted.
- New live-only rows should no longer be durably persisted.
- Post-cleanup verification shows `liveOnlyRows: 0`.
- Gateway is healthy again and has significantly more memory headroom.

However, long-term product health still needs retention, watchdog, pagination, and DB maintenance work so the system stays fast as usage grows.
