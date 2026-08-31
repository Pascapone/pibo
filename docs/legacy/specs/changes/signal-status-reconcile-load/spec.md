---
type: "Historical Record"
title: "Spec: Event-driven global signal status reconciliation"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["signal-status-reconcile-load", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Spec: Event-driven global signal status reconciliation

**Status:** Done
**Created:** 2026-08-07
**Source:** Pibo2 authenticated browser performance validation

## Why

The Chat UI subscribes to the global signal-status SSE feed, which immediately supplies a complete snapshot and then versioned patches. It also fetches the complete `/api/chat/signals/statuses` snapshot every five seconds while visible. On Pibo2 that response is approximately 726 KB, creating repeated transfer, serialization, parsing, and React merge work even when no status changed.

## Goal

Use the global signal SSE feed as the normal synchronization path and reserve full REST snapshots for recovery.

## Scope

### In Scope

- Remove the unconditional five-second global status snapshot timer.
- Keep full snapshot fetches for SSE errors and detected patch-version gaps.
- Reconnect the SSE feed when the page is restored or becomes visible.
- Preserve selected-session signal-tree reconciliation behavior.

### Out of Scope

- Signal payload schema changes.
- Selected-session tree polling.
- Room and trace event streams.

## Requirements

1. A healthy global signal SSE connection MUST NOT cause periodic `/signals/statuses` requests.
2. An SSE error MUST schedule a full snapshot recovery request.
3. A patch version gap MUST request a full snapshot.
4. Page restore and visibility recovery MUST reconnect the SSE feed, whose initial event supplies a snapshot.
5. Existing snapshot ordering and patch application guards MUST remain active.

## Acceptance Criteria

- Source tests prove that no global status interval remains and that error/gap recovery still calls `fetchSignalStatuses`.
- Existing signal status and Chat UI tests pass.
- A real Pibo2 browser watch shows no periodic `/api/chat/signals/statuses` requests during a healthy observation window.
