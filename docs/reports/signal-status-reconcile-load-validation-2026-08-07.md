---
type: "Evidence Report"
title: "Signal status reconciliation validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/signal-status-reconcile-load-validation-2026-08-07.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "db6548c824cc91a252474f0839bd0990ec8e12b2"
  source_bytes: 3112
  source_sha256: "0bf0472f6cb60f865e84195aa00dc54941c6bc454db000f763025263d4ec7aab"
  source_body_sha256: "0bf0472f6cb60f865e84195aa00dc54941c6bc454db000f763025263d4ec7aab"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:signal-status-reconcile-load-validation-2026-08-07"
  published_at: "2026-09-01T07:57:34Z"
---
# Signal status reconciliation validation

**Date:** 2026-08-07  
**Branch:** `fix/signal-status-reconcile-load`  
**Fix commit:** `495134b1`  
**Base:** `upstream/dev` at `8e6df91f`

## Finding

The authenticated Chat UI already maintained `/api/chat/signals/status-events`, whose initial SSE event is a complete global snapshot and whose later events are versioned patches. In parallel, the UI fetched `/api/chat/signals/statuses` every five seconds while visible.

On Pibo2 with 2,586 stored sessions, each full status response decoded to 726,110 bytes. A controlled 21-second CDP window observed four status snapshots totaling 2,904,440 decoded bytes. The same window also fetched four selected-tree snapshots totaling 103,400 bytes.

## Change

The global status SSE feed is now the normal synchronization path. Full REST snapshots remain available only when:

- the SSE connection reports an error; or
- applying a patch detects a version gap.

Page restore and visibility recovery still reconnect the SSE feed, whose first event provides a fresh snapshot. Selected-session tree reconciliation remains unchanged.

## Local validation

- production build: passed;
- focused signal API/UI tests: 21 passed, 0 failed;
- combined candidate tests: 55 passed, 0 failed;
- core, Chat UI, Context Files UI, and VS Code typechecks: passed.

## Pibo2 validation

A validation-only candidate combined machine auth, the stable Terminal indicator, and this focused fix:

- candidate commit: `6e605603`;
- package SHA-256: `9511411dd47177ca93cb0a599449b2da7e445d662a72249f36cd1ba6dabd45c0`;
- candidate path: `/opt/pibo-candidates/signal-status-reconcile-load/6e605603`;
- rollback path: `/root/.pibo-deploy-rollbacks/20260807T021105Z-signal-status-reconcile-load`.

The reusable candidate install and activation scripts performed checksum verification, idle-gateway enforcement, Pibo-CLI restart, readiness checks, and rollback preservation. Machine-auth bootstrap remained successful.

After loading the candidate in a fresh authenticated non-headless Chrome session, a visible 21-second CDP window observed:

| Request | Before | After |
| --- | ---: | ---: |
| `/api/chat/signals/statuses` | 4 requests / 2,904,440 decoded bytes | 0 requests / 0 bytes |
| `/api/chat/signals/tree/...` | 4 requests / 103,400 decoded bytes | 0 requests in the idle selected-session window |
| Browser protocol | HTTP/1.1 before host fix | HTTP/2 after nginx enablement |

The regular health probe continued every five seconds. No global status snapshot polling returned while the SSE connection remained healthy.

## Related transport correction

Before HTTP/2 was enabled, one optimistic message POST spent 25.065 seconds waiting in Chrome before `requestStart` because several HTTP/1.1 long-lived streams occupied the per-origin connection pool. Server wait after dispatch was 1.066 seconds. Enabling HTTP/2 on the production nginx virtual host removed that browser connection-slot bottleneck; nginx syntax validation and graceful reload passed. Rollback is preserved at `/root/.pibo-deploy-rollbacks/20260807T015914Z-nginx-http2`.
