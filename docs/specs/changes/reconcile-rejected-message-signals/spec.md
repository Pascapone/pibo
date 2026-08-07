# Spec: Reconcile rejected message signals

**Status:** Implementing
**Created:** 2026-08-07
**Source:** Authenticated Pibo2 failed-Steer reproduction

## Why

The router projects `message_accepted` before dispatching a message. If a Steer request reaches an idle runtime, dispatch throws `PiboSteeringUnavailableError`, but the accepted signal remains active. Chat Web then shows `running` and a `message_started` telemetry hint while gateway runtime state is `processing=false` and `streaming=false`.

## Goal

Remove synthetic accepted-message activity and reconcile the session signal with actual routed-session state whenever message dispatch is rejected.

## Scope

### In Scope

- Router message-dispatch failures after `message_accepted` projection.
- Exact removal of the rejected message node and its synthetic accepted turn.
- Reconciliation with actual processing and queue state.
- Idle-Steer and active-turn regression tests.

### Out of Scope

- Chat event-log retention for `user.message.accepted` and `user.message.failed`.
- Provider or runtime failures that already emit `session_error`.
- Queue/Steer dialog UX, which is covered by the session-overlay change.

## Requirements

1. A rejected message MUST remove its accepted message signal node.
2. A synthetic turn created only for that accepted message MUST be removed before runtime execution starts.
3. Existing active turns MUST remain active when a separate steering message is rejected.
4. The session status and queue count MUST be reconciled from the routed session after rejection.
5. An idle rejected Steer MUST leave no active telemetry hint, active turn, or running session signal.

## Acceptance Criteria

- Signal-registry tests cover idle rejection and rejection while another turn remains active.
- A session-router test proves idle steering rejects with `PiboSteeringUnavailableError` and leaves an idle, settled signal snapshot.
- Typechecks and relevant test suites pass.
- A real Pibo2 Steer submitted after turn completion persists `user.message.failed` but returns the UI and gateway signal to idle without a stale `message_started` hint.
