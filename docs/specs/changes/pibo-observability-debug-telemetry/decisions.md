# Decisions: Pibo Observability and Debug Telemetry

**Status:** Draft decisions in progress
**Created:** 2026-05-16
**Source:** User review before Ralph implementation loop

## Decided

1. **Telemetry store location**
   - Store telemetry in the unified `pibo.sqlite` data store, next to sessions, rooms, chat messages, event log rows, payload metadata, observations, and navigation projections.
   - Do not create `pibo-telemetry.sqlite`.
   - Rationale: telemetry must be directly joinable with session/event/debug data so operators can move from session to telemetry and from telemetry back to session/event evidence without cross-database plumbing.

2. **Schema shape**
   - Add dedicated telemetry tables inside `pibo.sqlite` rather than extending existing session/event rows.
   - Telemetry tables should use explicit correlation fields and indexes for joins to `sessions`, `event_log`, payload metadata, room ids, provider request ids, tool call ids, run ids, and event stream ids where available.

3. **Session/event/telemetry linking**
   - Telemetry must not duplicate full session transcripts, chat messages, normalized event payloads, or full tool arguments.
   - Store metadata, phases, timings, counters, ids, statuses, byte counts, and compact summaries.
   - Provide bidirectional lookup paths:
     - from a Pibo Session id to related turns/phases/provider/tool telemetry,
     - from telemetry rows back to the related session, normalized event rows, payload metadata, and tool/run ids when available.
   - Use join tables only where a real many-to-many relationship exists; prefer direct foreign/correlation columns for common one-to-many paths.

4. **Telemetry write failure behavior**
   - Telemetry writes are best-effort. Capture failures must not abort or break normal runtime/provider/tool execution.

5. **Retention defaults**
   - Use the proposed default retention classes and durations unless later implementation review changes them:
     - turn summaries: 30 days
     - phase summaries: 30 days
     - provider request summaries: 14 days
     - provider event summaries: 7 days, if per-event summaries are enabled
     - payload previews: 24 hours, if payload previews are enabled

6. **Payload preview default**
   - V1 should be summary-only by default.
   - Preview storage/capture is disabled or unavailable unless a later explicit decision enables bounded previews.
   - CLI/service behavior must handle disabled previews cleanly instead of falling back to raw payload reads.

7. **Incident pinning**
   - Include a simple `incident` retention class in V1.

8. **Stale detection behavior**
   - Stale detection is read-only in V1. It must not abort, retry, mutate, or clear sessions.

9. **Provider-aware stale configuration**
   - Stale thresholds should be configurable per provider/profile.
   - Add a minimal Provider Settings config option for telemetry stale threshold behavior.
   - V1 may use a small config shape first, but it must support provider-specific thresholds rather than one hard-coded global timeout.
   - Stale/status output should show the applied threshold and whether it came from provider/profile config or a default.

10. **Dependency instrumentation policy**
    - Prefer Pibo-managed wrappers/seams. Do not edit `node_modules` directly.
    - During implementation, inspect Pi agent/provider extension points before introducing patches.

11. **Provider event storage policy**
    - Provider telemetry captures provider-side stream metadata, not another copy of Pibo normalized events.
    - Metadata telemetry is independent of raw Pi event forwarding settings; disabling raw event forwarding must not disable V1 summary telemetry unless telemetry itself is explicitly disabled.
    - Do not store full raw provider event bodies by default.
    - Prefer request-level counters, first/last timestamps, event-type counts, parse/unknown counters, byte counts, and bounded samples only when needed for errors or unknown events.
    - Storage volume must be treated as a first-class constraint.

12. **Safe provider fields**
    - Use an allowlist for compact structural fields such as provider event type, response id, item id, item type, output index, tool call id, tool name, status, sequence, byte size, and parse status.
    - Do not store full assistant text, full tool arguments, full request bodies, or full provider payloads by default.

13. **Tool argument storage policy**
    - Do not duplicate full tool arguments in telemetry by default.
    - Store argument byte length, first/last delta timestamps, parse status, completion status, safe top-level keys when cheaply available, and links back to session/event/payload evidence.

14. **CLI namespace**
    - Use `pibo debug telemetry ...`.

15. **CLI JSON support**
    - JSON output is required for telemetry commands from the start.

16. **Chat Web/UI V1 scope**
    - No Chat Web telemetry UI in V1. V1 is CLI-only for telemetry drill-down.

17. **Runtime enablement**
    - Telemetry should be on by default so incidents can be diagnosed after they happen.

18. **Signals V1 scope**
    - No UI surface in V1. If signal/status metadata is added for CLI/stale discovery, keep it compact: active phase, last progress time, stale age, and queue depth.

## Pending clarification

1. Exact per-provider/per-phase stale threshold defaults.
2. Exact provider settings config shape for telemetry stale thresholds.
3. Whether provider event summaries are per-event for all events, aggregated by default, or sampled only for unusual/error events.
4. Final Ralph execution order after PRD QA.
