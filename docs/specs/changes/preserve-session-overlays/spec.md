# Spec: Preserve optimistic sends across session switches

**Status:** Implementing
**Created:** 2026-08-07
**Source:** Pibo2 authenticated steering/session-switch reproduction

## Why

During a running turn, choosing Steer and immediately switching to another session clears the single live trace overlay. Returning to the original session temporarily hides the accepted optimistic message and active footer until trace and signal recovery complete. The delivery dialog also remains visible until post-send refetches finish.

## Goal

Keep each session's live overlay across navigation and close delivery choice UI immediately after Queue or Steer is selected.

## Requirements

1. Switching away MUST retain the current session overlay in a session-keyed cache.
2. Switching back MUST restore that overlay before network refetch completion.
3. Confirmed events MUST still be trimmed from cached overlays when the base trace advances.
4. Queue or Steer selection MUST close the delivery dialog before awaiting network/refetch work.
5. Send failure MUST still remove the optimistic event, restore composer text, and show the error.

## Acceptance Criteria

- Unit tests prove overlay cache restore and reconciliation.
- Source tests prove delivery uses a captured plan and closes before awaiting.
- A real Pibo2 steer-switch-return watch keeps the optimistic message visible and dialog closed on return.
