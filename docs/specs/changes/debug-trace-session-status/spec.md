# Spec: Separate debug trace lifecycle from historical node failures

**Status:** Implementing
**Created:** 2026-08-07

## Problem

`pibo debug trace` currently reports the whole trace as `error` whenever any historical node failed. A successfully completed, idle session can therefore appear failed because one intermediate tool call returned an error that the agent later recovered from.

## Requirements

1. Overall trace status MUST describe the current session lifecycle: `running`, terminal `error`, or `done`.
2. The newest persisted `message_started`, `message_finished`, or `session_error` event MUST take precedence over a stale session-store row; the session store remains the fallback.
3. Historical error nodes MUST remain visible and countable without changing a successfully completed lifecycle to `error`.
4. `pibo debug failures` and trace drill-down commands MUST continue exposing every failed node.
5. Text and JSON output MUST report the lifecycle source and number of error nodes separately.

## Acceptance Criteria

- An idle session with historical error nodes reports `status: done` and a non-zero `nodeErrors` count.
- A stale idle session row with a newer `message_started` event reports `running` from `event-log`.
- A running session reports `running`.
- A terminally failed session reports `error`.
- Existing trace reconstruction and failure inspection tests continue to pass.
