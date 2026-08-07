# Spec: Stable Terminal working indicator

**Status:** Done
**Created:** 2026-08-07
**Source:** Pibo2 real-agent Terminal View validation

## Why

The active-turn footer currently replaces characters in `Working...` with random printable ASCII every 55 ms. In a real long-running agent turn this looks like corrupted terminal output, continuously mutates the DOM, and continues the JavaScript motion even when the user requests reduced motion.

## Goal

Show a stable, readable active-turn label while retaining the once-per-second elapsed-time update.

## Scope

### In Scope

- Render the literal `Working...` while a Terminal View turn is active.
- Remove the random-character timer and helper functions.
- Preserve the existing status semantics, elapsed timer, placement, and dimensions.

### Out of Scope

- Turn lifecycle and signal correctness.
- Trace row ordering or pagination.
- Other status animations such as compaction.

## Requirements

1. The footer MUST expose the same `role=status`, accessible label, component marker, and active-turn timestamp.
2. Visible working text MUST remain `Working...` for the full active turn.
3. The footer MUST NOT schedule a random-character interval or mutate individual working-label characters.
4. The elapsed duration MUST continue updating once per second when a valid start time exists.

## Acceptance Criteria

- Source tests prove the stable literal is rendered and the scramble hook/helpers are absent.
- Existing Terminal timing and session-view tests pass.
- A real Pibo2 streaming turn shows no random characters over a bounded DOM watch.
