# Spec: Chat Web Trace Render Diagnostics

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Debug CLI](./debug-cli.md), [Chat Web Browser Shell State](./chat-web-browser-shell-state.md)

## Why

Trace rendering bugs are hard to diagnose because the browser transforms server trace nodes through several layers before rows appear on screen. A wrong row order, dropped node, stale live patch, or expansion mismatch can be caused by backend trace materialization, frontend adaptation, tree filtering, row visibility, or browser state.

Pibo therefore needs an opt-in diagnostics contract that captures enough browser render state to replay and compare trace rows without collecting data during normal use.

## Goal

Chat Web MUST provide opt-in, bounded trace render snapshots and an authenticated replay endpoint so operators can compare server trace state with the browser's visible trace rows.

## Background / Current State

The browser implementation is centered on `src/apps/chat-ui/src/tracing/snapshotCollector.ts`, `src/apps/chat-ui/src/App.tsx`, and `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`. Snapshot collection is enabled only when `localStorage.getItem("pibo.chat.traceDebug") === "true"`. When enabled, the app records backend trace-node ids on tab visibility changes and visible row ids during trace timeline rendering. Snapshots are held in memory, merged briefly, de-duplicated, bounded per Pibo Session, and exposed through `window.__piboTraceSnapshots` for manual export or clearing.

The server exposes `POST /api/chat/debug/trace-at-sequence` from `src/apps/chat/web-app.ts`. It requires same-origin JSON, an authenticated web session, a valid Pibo Session, and then rebuilds a trace from stored events up to the requested sequence. The diagnostic checker in `src/debug/trace-render-check.ts` loads exported snapshots, calls that replay API, runs the frontend adaptation and trace-tree processing code, and reports row-id mismatches.

## Scope

### In Scope

- Browser-side opt-in trace snapshot collection.
- Snapshot content, merging, de-duplication, retention, export, and clearing behavior.
- Authenticated server replay of a trace at a requested event sequence.
- Offline consistency checks that compare captured visible rows with replayed and simulated frontend rows.

### Out of Scope

- Normal trace API materialization and compact terminal behavior — covered by the trace and terminal spec.
- General Debug CLI store, event, job, run, and signal commands — covered by the debug-cli spec.
- Durable upload or server-side storage of browser snapshots — current code keeps snapshots in browser memory only.

## Requirements

### Requirement: Snapshot collection is explicit and browser-local

The system MUST collect trace render snapshots only when the current browser explicitly enables trace debugging.

#### Current

`isTraceSnapshotCollectionEnabled()` reads `localStorage["pibo.chat.traceDebug"]` and returns true only for the string value `"true"`. Collection callers return without recording when this flag is absent, false, or unreadable.

#### Target

Normal Chat Web usage does not create render diagnostics. A user or operator can enable diagnostics in one browser without changing server state or other browsers.

#### Acceptance

- With no `pibo.chat.traceDebug` local-storage value, no backend or visible-row snapshots are recorded.
- With `pibo.chat.traceDebug` set to `"true"`, eligible trace render and visibility events record snapshots.
- Local-storage read failures disable collection instead of breaking trace rendering.

#### Scenario: Operator enables collection

- GIVEN an operator sets `localStorage.setItem("pibo.chat.traceDebug", "true")`
- WHEN the selected trace renders
- THEN the browser records visible-row snapshot data for that Pibo Session.

### Requirement: Snapshots capture comparable trace layers

The system MUST record stable row identifiers and metadata that let a checker compare server trace nodes with visible browser rows.

#### Current

`collectBackendNodes()` flattens `PiboTraceNode` trees and records ids, a digest, node type, order key, and parent id. `collectVisibleRows()` records visible row ids, a digest, depth, span type, status, and expansion overrides. Snapshots may also include trace version, latest stream id, and the last raw event id.

#### Target

A snapshot export contains enough information to identify which layer lost, reordered, or changed visible rows without requiring a full browser session recording.

#### Acceptance

- Backend-node layers include flattened Pibo trace node ids in display source order.
- Visible-row layers include rendered row ids and their visible depths.
- Snapshot metadata includes the Pibo Session ID, trigger, timestamp, and available trace freshness markers.

#### Scenario: Visibility-triggered backend snapshot

- GIVEN trace debugging is enabled and a trace view is loaded
- WHEN the tab visibility changes
- THEN the browser records a backend-node layer with the current trace version and latest stream id when available.

### Requirement: Snapshot buffers are bounded and de-duplicated

The system MUST prevent render diagnostics from growing without bound or storing repeated identical snapshots.

#### Current

`snapshotCollector.ts` keeps an in-memory buffer per Pibo Session, merges layers for the same session and trigger for 50 ms, drops snapshots with no layers, suppresses consecutive duplicates with the same trigger, trace version, and layer id sequences, and caps each session at 5000 snapshots.

#### Target

Long debugging sessions remain usable and avoid filling memory with identical render states.

#### Acceptance

- Two layer updates for the same session and trigger inside the merge window produce one pending snapshot.
- A consecutive duplicate snapshot is not appended.
- When a session exceeds the per-session limit, the oldest snapshot is removed.

#### Scenario: Repeated unchanged render

- GIVEN trace debugging is enabled
- AND the visible row id sequence does not change across repeated renders
- WHEN the same render trigger fires repeatedly
- THEN the snapshot buffer keeps at most one consecutive copy of that row sequence.

### Requirement: Browser exports do not require server mutation

The system MUST let an operator inspect, export, or clear collected snapshots from the browser without writing them to Pibo stores.

#### Current

When `window` exists, `snapshotCollector.ts` exposes `window.__piboTraceSnapshots` with `getSnapshots`, `exportSnapshots`, `exportAsJson`, and `clearSnapshots`. `exportAsJson` downloads a JSON file in the browser; clearing deletes only in-memory buffers.

#### Target

Diagnostics are operator-controlled artifacts. They are not durable product events and are not sent to the server unless an operator explicitly uses a separate checker or support workflow.

#### Acceptance

- Exporting all snapshots returns JSON keyed by Pibo Session ID.
- Exporting one session returns `{ piboSessionId, snapshots }`.
- Clearing one session does not clear other sessions; clearing with no id removes all buffers.

#### Scenario: Export one session

- GIVEN snapshots exist for `ps_a` and `ps_b`
- WHEN an operator exports snapshots for `ps_a`
- THEN the export contains only `ps_a` snapshots.

### Requirement: Trace replay is authenticated and same-origin protected

The system MUST rebuild diagnostic trace views only for authenticated users and valid same-origin JSON requests.

#### Current

`POST /api/chat/debug/trace-at-sequence` calls `requireSameOriginJsonRequest`, `requireSession`, validates `piboSessionId` and numeric `eventSequence`, rejects unknown sessions, lists managed sessions, loads trace events before or at the sequence, and returns a rebuilt trace view.

#### Target

Diagnostic replay cannot be used as an unauthenticated cross-site trace oracle.

#### Acceptance

- Non-JSON or cross-site requests are rejected before trace reconstruction.
- Missing `piboSessionId` or `eventSequence` returns a 400 error.
- Unknown or inaccessible sessions do not return trace nodes.
- Valid requests return a trace view reconstructed only from events up to the requested sequence.

#### Scenario: Invalid replay body

- GIVEN an authenticated browser sends same-origin JSON
- WHEN the body omits `eventSequence`
- THEN the endpoint returns a 400 error and no trace view.

### Requirement: Consistency checks report row mismatches without mutating state

The diagnostic checker MUST compare exported browser visible rows with replayed server trace rows and fail when mismatches or replay errors occur.

#### Current

`src/debug/trace-render-check.ts` parses snapshot JSON, optionally filters one Pibo Session, calls the replay API, adapts the replayed trace through `adaptTrace()`, processes it through `processSpanTree()`, flattens visible spans, reports the first row-id difference, totals OK, mismatch, and error counts, and exits non-zero on mismatch or error.

#### Target

An operator can run a reproducible check that pinpoints the first visible row divergence while leaving Pibo stores and browser state unchanged.

#### Acceptance

- A snapshot file with matching visible rows exits successfully.
- A snapshot file with a row-order or row-presence mismatch prints the first differing index.
- Replay API failures are counted as errors and cause a non-zero exit.
- The checker does not write to Pibo databases or modify browser snapshots.

#### Scenario: First mismatch is reported

- GIVEN an exported snapshot whose visible row ids differ from replayed simulated rows
- WHEN the checker runs against the replay API
- THEN it prints the session id, timestamp, trigger, first differing index, frontend id, and simulated id.

## Edge Cases

- Snapshot collection must tolerate missing current trace data and skip collection instead of throwing.
- The replay checker uses the available snapshot size as a coarse replay point when no explicit event sequence exists; this can identify divergence but may not prove the exact event that caused it.
- Snapshot exports may contain message or tool content through metadata in future layers; operators should treat exported JSON as sensitive debugging data.
- The dormant trace timeline and active terminal view can evolve separately; diagnostics must identify which view produced the visible-row layer.

## Constraints

- **Security / Privacy:** Replay endpoints require authenticated same-origin JSON requests. Browser snapshot exports are local operator artifacts and must not be uploaded automatically.
- **Performance:** Snapshot collection is disabled by default, bounded per session, and de-duplicates repeated states.
- **Compatibility:** The checker reuses frontend adaptation modules so diagnostic comparisons follow the same row projection code as the browser.
- **Product Boundary:** Diagnostics use Pibo Session IDs and trace versions, not Pi Session IDs, as their public correlation keys.

## Success Criteria

- [ ] SC-001: With trace debugging disabled, rendering and tab visibility changes do not append snapshots.
- [ ] SC-002: With trace debugging enabled, backend-node and visible-row layers include stable ids, digests, and trace metadata when available.
- [ ] SC-003: Snapshot buffers merge near-simultaneous layers, suppress consecutive duplicates, and cap each session at 5000 snapshots.
- [ ] SC-004: `window.__piboTraceSnapshots` can get, export, download, and clear snapshots without server writes.
- [ ] SC-005: `POST /api/chat/debug/trace-at-sequence` rejects unauthenticated, cross-site, malformed, and unknown-session requests.
- [ ] SC-006: `src/debug/trace-render-check.ts` exits non-zero and reports the first differing row when replayed frontend simulation does not match exported visible rows.

## Assumptions and Open Questions

### Assumptions

- Trace render diagnostics are intended for operator debugging, not for normal user-facing telemetry.
- Browser-local snapshot buffers are acceptable because the current need is short-lived investigation of visible rendering issues.

### Open Questions

- Should snapshots include an explicit event sequence rather than inferring one from layer sizes?
- Should the replay endpoint be hidden behind a development or debug-mode flag in production gateways?
- Should the active compact terminal view emit its own visible-row diagnostic layer, separate from the dormant Trace Timeline view?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Snapshot collection is explicit and browser-local | Operator enables collection | `src/apps/chat-ui/src/tracing/snapshotCollector.ts` | Draft |
| REQ-002 Snapshots capture comparable trace layers | Visibility-triggered backend snapshot | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`, `src/apps/chat-ui/src/tracing/snapshotCollector.ts` | Draft |
| REQ-003 Snapshot buffers are bounded and de-duplicated | Repeated unchanged render | `src/apps/chat-ui/src/tracing/snapshotCollector.ts` | Draft |
| REQ-004 Browser exports do not require server mutation | Export one session | `src/apps/chat-ui/src/tracing/snapshotCollector.ts` | Draft |
| REQ-005 Trace replay is authenticated and same-origin protected | Invalid replay body | `src/apps/chat/web-app.ts` | Draft |
| REQ-006 Consistency checks report row mismatches without mutating state | First mismatch is reported | `src/debug/trace-render-check.ts`, `src/apps/chat-ui/src/tracing/adapt.ts`, `src/apps/chat-ui/src/tracing/traceTree.ts` | Draft |

## Verification Basis

This spec was derived from current source code in `src/apps/chat-ui/src/tracing/snapshotCollector.ts`, `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`, `src/apps/chat-ui/src/tracing/adapt.ts`, `src/apps/chat-ui/src/tracing/traceTree.ts`, `src/apps/chat/web-app.ts`, and `src/debug/trace-render-check.ts`. Existing specs under `docs/specs/` were inspected to avoid duplicating the broader trace rendering, browser shell, and Debug CLI contracts.
