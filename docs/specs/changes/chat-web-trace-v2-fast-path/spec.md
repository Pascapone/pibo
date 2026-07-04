# Spec: Chat Web Trace V2 Fast Path

**Status:** Draft
**Created:** 2026-07-04
**Requester / Source:** Chat Web trace performance/OOM incidents and expert report
**Related docs:**

- `proposal.md`
- `design.md`
- `tasks.md`
- `docs/reports/chat-web-trace-performance-expert-report-2026-07-04.md`
- `docs/reports/gateway-oom-followup-2026-07-04.md`
- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`

## Why

The trace/session surface is the primary trust surface for Pibo. It shows what the agent did, what tools ran, why work is slow or failed, and whether anything is still alive. It must feel instant, even for large sessions.

The current full trace contract can carry unbounded payloads. It makes the gateway build and serialize large trees, makes the browser parse and cache large objects, and makes session switching feel slow. Trace V2 defines a new fast path: compact timeline first, payloads on demand, raw events separate, live patches incremental, projection persistent, heavy rebuilds isolated.

## Goal

Chat Web MUST load and update large trace/session histories through bounded compact timeline pages and lazy payload access, without default full-trace materialization, unbounded JSON serialization, or large payload caching in the gateway or browser.

## Background / Current State

Current flow:

```text
Pi transcript + event_log + reliability store + live snapshots
  -> buildTraceView(...)
  -> nested PiboTraceNode tree with input/output payloads
  -> responseJson(JSON.stringify(full tree))
  -> sendWebResponse(full body + gzipSync)
  -> browser response.json()
  -> adaptTrace(...)
  -> React Query + React state
  -> virtualized rendering
```

This puts the performance boundary too late. Virtualization helps rendered rows, but not server heap, serialization, compression, transfer, browser parse, or cache memory.

## Scope

### In Scope

- Trace V2 API contracts for summary, timeline, node detail, payload, raw events, and projection status.
- Compact timeline DTOs without unbounded `input`/`output` fields.
- Payload refs, previews, range reads, content types, and download metadata.
- Default Chat Web terminal/trace view migration to Trace V2 timeline pages.
- Browser cache/state rules for timeline and payload bodies.
- Live patch model for active sessions.
- Persistent or lazily materialized trace projection design.
- Response serialization/compression safety for trace APIs.
- Performance budgets and validation gates.
- Transitional compatibility for old `/api/chat/trace`.

### Out of Scope

- Deleting raw transcripts, event logs, reliability events, or telemetry archives.
- Full telemetry capture/archive lifecycle — covered by `telemetry-opt-in-archive-isolation`.
- Full runtime worker isolation — covered by `gateway-resource-protection-workers`.
- Replacing SQLite entirely.
- Redesigning the visual style of the terminal UI beyond data-loading behavior.

## Definitions

### Hot Path

The request/response/render path used by normal Chat Web room/session opening, switching, scrolling, and live following.

### Cold Payload

Large or detailed content not required to draw the default timeline row, such as full tool output, full arguments, large assistant markdown, raw provider chunks, image data, or raw events.

### Trace Timeline Node

A compact row-level trace DTO containing identity, ordering, status, title, preview, and payload refs, but no unbounded payload bodies.

### Trace Payload Ref

A stable reference to cold payload content with content type, byte length, preview, truncation metadata, and optional hash.

### Trace Projection

A read-optimized representation of trace structure and payload refs derived from transcripts, event logs, reliability events, live stream frames, and session metadata.

## Requirements

### Requirement: Default timeline nodes are bounded

The default timeline API MUST NOT return unbounded `input`, `output`, `reasoning`, `raw`, or arbitrary `unknown` payload fields.

#### Current

`PiboTraceNode` can carry `input?: unknown` and `output?: unknown`. Large tool results or transcript payloads can enter normal trace responses.

#### Target

Timeline rows include compact structure, status, ordering, preview text, and payload refs. Payload bodies are retrieved separately.

#### Acceptance

- Timeline node JSON schema contains no unbounded payload fields.
- A single 10 MB tool result does not increase the timeline page beyond the hard response budget.
- Tests fail if default timeline rows include raw payload bodies over the inline threshold.

#### Scenario: Large tool output row

- GIVEN a session contains a tool call with a 10 MB result
- WHEN Chat Web requests the timeline page
- THEN the tool row includes a short preview and an output payload ref
- AND the response remains below the timeline size cap.

### Requirement: Payload access is explicit, lazy, and range-capable

The system MUST expose cold payloads through explicit payload endpoints with size/range limits.

#### Target

Payload endpoint shape:

```text
GET /api/chat/trace/payload/:payloadRef?offset=0&limit=65536
```

Payload metadata includes:

- ref;
- content type;
- byte length;
- preview;
- truncation flag;
- optional hash;
- range information.

#### Acceptance

- Expanding a large node triggers a payload request, not a full timeline reload.
- Payload responses are range-limited by default.
- Full payload download is explicit and may use a download route.
- React Query does not cache unbounded payload bodies by default.

#### Scenario: Expand large tool result

- GIVEN the timeline row has an output payload ref
- WHEN the user expands the row
- THEN Chat Web fetches the first payload chunk
- AND offers further chunks/download when the payload is larger than the render limit.

### Requirement: Raw events are separate debug data

The normal timeline API MUST NOT include raw events. Raw events MUST be fetched through a separate debug endpoint.

#### Target

```text
GET /api/chat/trace/raw-events?piboSessionId=...&cursor=...&limit=80
```

#### Acceptance

- Default timeline response has no `rawEvents` field or has an always-empty debug placeholder.
- Raw event endpoint is paginated and bounded.
- Raw event UI panels fetch raw events independently from timeline pages.

#### Scenario: Open raw events panel

- GIVEN the terminal timeline is visible
- WHEN the user opens Raw Events
- THEN the UI requests `/api/chat/trace/raw-events`
- AND the existing timeline page is not refetched or enlarged.

### Requirement: Summary is tiny and fast

Trace summary MUST be a small, bounded status document suitable for frequent refreshes.

#### Target Budget

```text
response <= 5 KB
p50 <= 30 ms
p95 <= 100 ms
```

#### Acceptance

- Summary contains title, status, counts, projection status, running node ids, error counts, and version.
- Summary does not include payload previews, raw events, or full nodes.

### Requirement: Timeline pages are hard-capped

Timeline page responses MUST have hard size and node-count caps.

#### Target Budget

```text
normal response: 20-100 KB
hard cap: 256 KB
limit default: 80-120 nodes
no synchronous full transcript read
no unbounded payload fields
```

#### Acceptance

- Requests that would exceed the hard cap are truncated with cursor metadata or rejected with a clear bounded error.
- Server instrumentation measures route handler, serialization, compression, and total response bytes.
- Tests include sessions with 10,000 small events and one large payload.

### Requirement: Chat Web default session view uses Trace V2

The default Chat Web terminal/trace session surface MUST use Trace V2 summary/timeline/payload APIs, not the old full trace endpoint.

#### Acceptance

- Opening a session in Chat Web does not call old `/api/chat/trace` for default rendering.
- Session switching cancels or ignores stale timeline/payload requests.
- Large payload expansion does not replace the base timeline state.
- Browser memory does not grow with unexpanded payload bodies.

#### Scenario: Switch between large sessions

- GIVEN two sessions each contain large tool outputs
- WHEN the user switches between them repeatedly
- THEN Chat Web fetches compact timeline pages
- AND does not accumulate full payload bodies in React Query or local state.

### Requirement: Historical timeline and live patches are separate

Live updates MUST arrive as small patches and MUST NOT force full historical timeline reloads.

#### Target

Live patch frames may include:

- node added;
- node updated;
- node status changed;
- preview updated;
- payload ref added;
- session state changed.

#### Acceptance

- A streaming assistant delta updates the active node or preview without refetching the historical page.
- Finished turns settle into projection without duplicating transcript/event echoes.
- Active sessions stop appearing active when provider requests finish, error, abort, or are cancelled.

### Requirement: Projection work is bounded and observable

Trace projection rebuild, transcript backfill, raw event scans, and payload extraction MUST either complete within a strict inline budget or run as jobs.

#### Acceptance

- First access to an old session returns a bounded page or projection status, not a long blocking request.
- Full rebuild has job status and can be cancelled.
- Gateway health/app-shell endpoints remain responsive during rebuild.

### Requirement: Response serialization and compression are safe

Trace endpoints MUST NOT synchronously serialize or gzip large JSON bodies in the gateway event loop.

#### Acceptance

- Trace response helpers enforce size budgets before serialization where possible.
- Large debug/payload responses use streaming, range reads, or no compression rather than `gzipSync` on full buffers.
- Instrumentation records serialization/compression time and response bytes.

### Requirement: Old full trace endpoint is bounded compatibility only

The old `/api/chat/trace` endpoint MAY remain temporarily, but it MUST not be used by normal Chat Web and MUST enforce strict payload/response caps.

#### Acceptance

- Old endpoint logs or returns deprecation metadata when used.
- Over-budget V1 responses are truncated or rejected with actionable guidance.
- Debug CLI use is explicit and paginated.

## Edge Cases

- Missing Pi transcript: timeline uses event/projection data and reports missing transcript metadata.
- Stale projection: summary reports `stale` and timeline returns last safe projection plus rebuild affordance.
- Corrupt payload ref: row remains visible; expansion shows bounded error.
- Running sessions: live patches overlay tail page without invalidating older pages.
- Huge single markdown output: row preview remains bounded; payload endpoint chunks content.
- Image/base64 output: timeline stores metadata and preview only; full image access is explicit.
- Reconnect after long downtime: live stream resumes from cursor or requests compact delta pages, not full history.

## Constraints

- **Performance:** Default UI requests must stay within stated response and memory budgets.
- **Compatibility:** V1 DTOs remain during migration but are not the Chat Web fast path.
- **Security / Privacy:** Payload refs require the same session access checks as timeline rows.
- **Debuggability:** Raw data remains available through explicit bounded debug APIs.
- **Resource safety:** Projection rebuild and archive inspection align with worker/resource specs.

## Success Criteria

- [ ] SC-001: Default Chat Web session load uses Trace V2 timeline, not old full trace.
- [ ] SC-002: Timeline responses contain no unbounded payload bodies.
- [ ] SC-003: Timeline response is normally below 100 KB and hard-capped at 256 KB.
- [ ] SC-004: A 10 MB tool output only loads on expansion through payload API.
- [ ] SC-005: Raw events are fetched separately and bounded.
- [ ] SC-006: Live updates do not trigger full historical trace reloads.
- [ ] SC-007: No trace route uses synchronous `gzipSync` on large JSON.
- [ ] SC-008: Browser session switching does not retain unexpanded large payloads.
- [ ] SC-009: Gateway diagnostics show trace response bytes, cache bytes, serialization time, and event-loop delay.
- [ ] SC-010: Large-session browser validation shows fast perceived load and stable memory.

## Assumptions and Open Questions

### Assumptions

- SQLite can remain the local projection store if query contracts are bounded and indexed.
- Old raw sources remain authoritative; projection can be rebuilt.
- Payload refs can initially point to existing payload store/file/transcript slices before a richer payload store is complete.

### Open Questions

- What exact inline preview threshold should ship first: 4 KB, 8 KB, or 16 KB?
- Should payload refs be content-addressed, node-addressed, or both?
- Should timeline use flat rows with depth or nested rows plus expansion cursors?
- Which payload types may be downloaded but never rendered inline?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Bounded timeline nodes | Large tool output row | Phase 1 | Pending |
| Lazy payload access | Expand large tool result | Phase 2 | Pending |
| Raw events separate | Open raw events panel | Phase 2 | Pending |
| Live patches | Streaming assistant update | Phase 4 | Pending |
| Projection jobs | Old session rebuild | Phase 5 | Pending |
| Safe serialization | Large response handling | Phase 0 | Pending |
