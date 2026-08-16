# Spec: Animated Terminal working indicator

**Status:** Done
**Created:** 2026-08-07
**Revised:** 2026-08-16
**Source:** User request to restore the earlier decode animation

## Why

The active-turn footer currently shows a static `Working...` label. The earlier Terminal View decoded random printable characters into that label while a bright active position moved through the text, giving long-running turns a distinctive but compact sign of activity.

## Goal

Restore the earlier decode animation without changing the elapsed timer, footer layout, Goal indicator, lifecycle behavior, or accessibility semantics.

## Scope

### In Scope

- Animate `Working...` from random printable characters to its readable target while a Terminal View turn is active.
- Move the earlier bright highlight through the character positions during decoding.
- Preserve the existing status semantics, elapsed timer, Goal indicator, placement, and dimensions.
- Render a stable literal and schedule no scramble interval when reduced motion is requested.

### Out of Scope

- Turn lifecycle and signal correctness.
- Trace row ordering or pagination.
- Other status animations such as compaction.

## Requirements

1. The footer MUST expose the same `role=status`, accessible label, component marker, and active-turn timestamp.
2. The elapsed duration MUST continue updating once per second when a valid start time exists.
3. During an active turn, the working label MUST repeatedly decode random printable characters into `Working...` and visually highlight the active character position.
4. The animation MUST run only while the working state is visible, including when the footer remains mounted only for Goal status.
5. When `prefers-reduced-motion: reduce` is active, the footer MUST render the stable `Working...` target and MUST NOT schedule the scramble interval.

## Acceptance Criteria

- Source tests prove the elapsed timer remains before the animated label and the Goal indicator remains in the same footer layout.
- Existing Terminal timing and session-view tests pass.
- A real Pibo2 streaming turn shows the decode cycle and moving highlight while the elapsed duration continues updating once per second.
- Reduced-motion validation shows stable `Working...` text without character mutations.
