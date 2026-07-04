# Expert Report: Chat Web Trace Performance and Gateway Responsiveness

**Status:** Draft
**Date:** 2026-07-04
**Author:** Codex investigation session
**Scope:** Local Pibo WebUI sluggishness, high CPU, memory growth, trace payload bloat, and architectural remediation
**Primary affected surface:** Chat Web App trace/session view at `http://127.0.0.1:4788/`
**Related reports/specs:**

- `docs/reports/gateway-oom-followup-2026-07-04.md`
- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`
- `docs/specs/changes/gateway-resource-protection-workers/`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/`

## Executive Summary

The current Chat Web trace architecture is not only suffering from an implementation hot spot; it is shaped around a data contract that cannot remain snappy for large developer sessions.

The investigation observed the Web Gateway becoming intermittently unresponsive while serving normal Chat Web requests. Simple page reloads sometimes took 15-25 seconds or timed out. During the same period the gateway Node process on port `4788` consumed roughly one full CPU core and grew from about 2 GB private memory to more than 3.2 GB after trace requests. The most important measured request was:

```text
GET /api/chat/trace?piboSessionId=ps_70cc...&pageSize=80
client time: 8644 ms
response size: 6,149,205 bytes
server-timing trace handler: 155.7 ms
```

This mismatch matters. The route handler measured itself as fast, but the client waited 8.6 seconds and the gateway heap grew. The hidden cost occurs after the route-level timer: synchronous `JSON.stringify`, full response buffering, and synchronous `gzipSync` compression of a multi-megabyte trace object. A later parallel small trace test timed out after 120 seconds and correlated with another large gateway memory increase.

The immediate root cause is that the normal Trace API returns too much data in one object. The deeper root cause is that Pibo currently treats a trace response as a full materialized execution tree containing structure, large message/tool payloads, raw debug data, live overlays, transcript-derived content, and event-log-derived content. Virtualized rendering helps the DOM, but it does not help the server heap, JSON serialization, network transfer, browser JSON parsing, React Query cache, or local React state.

My recommendation is to build Trace V2 as a read-optimized projection with lazy payload access. Keep the raw data, but remove large content from the hot-path timeline response. The timeline should return compact rows plus payload references. Expanding a node should fetch its payload on demand. Raw events should be a separate debug API. Historical trace data should come from a persistent projection, and live streaming should be applied as small patches. Expensive rebuilds and large inspections should run in workers or bounded background jobs, not inside the Web Gateway event loop.

## Investigation Constraints

The user explicitly requested analysis only during the live incident:

- no restart;
- no kill/abort/dispose;
- no process termination;
- no live gateway mutation;
- no file edits during the diagnostic phase.

The investigation used read-only diagnostics, process inspection, HTTP latency checks, Pibo debug CLI commands, source inspection, and local store size inspection. This report is the first created artifact.

## Observed Runtime State

### Gateway process and resource distribution

At the time of the second slowdown, port ownership showed:

```text
Port 4788 -> PID 68532 node.exe
Command: pibo gateway:web --auth local
Start time: 2026-07-04 21:39:52 local

Port 4808/4809 -> PID 65076 node.exe
Command: node dist/bin/pibo.js gateway:web --auth local --web-host 127.0.0.1 --web-port 4808 --gateway-port 4809
```

CPU and memory sampling showed:

```text
PID 68532 node.exe, Web Gateway on 4788:
  CPU: ~105-112% of one core over repeated 5 second samples
  Working set: grew to ~3238 MB
  Private memory: grew to ~3270 MB

PID 65076 node.exe, secondary dev gateway on 4808/4809:
  CPU: ~2-3% of one core
  Private memory: ~173 MB

Unity:
  Private memory: ~5917 MB
  CPU at sampling time: low single-digit percent
```

Conclusion: the immediate UI hang was dominated by the main Web Gateway process on `4788`, not by the secondary dev gateway and not by Unity CPU at the sampled moments.

### HTTP latency symptoms

The gateway was reachable but intermittently event-loop blocked:

```text
GET /                       18,299 ms
GET /                       timeout after 25,003 ms
GET /                       15,842 ms
GET /apps/chat                 816 ms
GET /apps/chat               6,777 ms
GET /apps/chat              19,346 ms
```

These endpoints are small. When simple app-shell requests fluctuate between sub-second, many seconds, and timeout, the failure mode is not a single slow DB query for a specific trace API. It is process-level event-loop starvation and/or heap pressure in the Web Gateway.

### Active Pibo Sessions

During the slowdown, these sessions were active:

```text
ps_70ccbee2-1060-4396-8419-225f4d71e6ff
  title: Performance
  status: running / streaming
  active turn: turn_web-mr6rrmrj-4948e43f-4a46-4c67-9f10-c5ed89debbd2
  context: investigating Pibo OOM, trace, local stores, gateway memory

ps_8a645ba0-a34d-4e55-b85c-041431156a9d
  title: Cell Classes
  status: running / streaming
  active turn: turn_web-mr6rt5fd-19772b55-c605-477e-a3ad-f159086468d6
  context: Unity/MCP work, AssetDatabase refresh, compile checks
```

`ps_70cc...` was the largest trace problem session. It had thousands of stored events and was actively analyzing the performance issue, creating additional trace/debug output while the WebUI was being inspected.

### Store sizes

Relevant local stores under `C:\Users\pasca\.pibo`:

```text
backups/perf-tracing-20260704-130338/pibo.sqlite      1716.1 MB
pibo-events.sqlite                                     634.2 MB
backups/perf-tracing-20260704-130338/pibo-events.sqlite 622.7 MB
pibo.sqlite                                            292.5 MB
pibo-events.sqlite-wal                                   8.4 MB
pibo.sqlite-wal                                          5.8 MB
```

`ps_70cc...` itself observed the reliability DB contents:

```text
pibo_event_stream: 61139 rows
pibo_dead_jobs: 54 rows
pibo_jobs: 3 rows
pibo_runs: 1 row
```

The reliability event stream and trace/event logs are large enough that any unbounded replay, serialization, cache, or projection path can create large heap pressure.

### Engine version mismatch

The gateway was running:

```text
pibo version: 1.6.0
node version: v22.16.0
package engines: node >=24
```

This is not proven as the root cause of the trace response bloat. However, it is a real operational risk and should be treated as a separate release-gate issue. A production-ish gateway should warn or fail clearly when running below the declared engine requirement, especially where SQLite, streams, compression, and memory behavior are involved.

## Current Code Path Findings

### Trace API builds a broad trace object

Current trace route:

- `src/apps/chat/web-app.ts`
  - `/api/chat/trace/summary`
  - `/api/chat/trace`
  - cache key by session/version/limit/page cursor
  - calls `buildTraceView(...)`
  - returns `responseJson({ ...trace, rawEvents: [] })`

Relevant code:

```text
src/apps/chat/web-app.ts:4798  GET /api/chat/trace
src/apps/chat/web-app.ts:4853  listTraceEvents(...)
src/apps/chat/web-app.ts:4859  buildTraceView(...)
src/apps/chat/web-app.ts:4885  responseJson({ ...trace, rawEvents: [] })
```

The route-level server timing is measured before response JSON serialization. This hides the cost that actually hurt the gateway during the incident.

### Trace materialization still loads transcript entries

`buildTraceView` currently loads transcript entries from the Pi session:

```text
src/apps/chat/trace.ts:201  buildTraceView(...)
src/apps/chat/trace.ts:203  const allEntries = metadata.sessionPath ? readEntries(metadata.sessionPath) : [];
src/apps/chat/trace.ts:401  readEntries(path)
src/apps/chat/trace.ts:403  readFileSync(path, "utf8")
src/apps/chat/trace.ts:404  parseSessionEntries(content)
```

This means trace requests can synchronously read and parse transcript files. Even when event pagination exists, transcript-derived nodes can still make the response large and expensive.

### Trace node type allows large payloads everywhere

Current shared trace type:

```text
src/shared/trace-types.ts:23  PiboTraceNode
  input?: unknown
  output?: unknown
  children: PiboTraceNode[]
```

The type is convenient, but it makes the default API contract unsafe. Every timeline node can carry unbounded input/output payloads. A page-size limit on events does not guarantee a small response if a single transcript message or tool result is large, or if the node tree includes nested content from multiple sources.

### UI adapts all payloads into Span attributes

Frontend adapter:

```text
src/apps/chat-ui/src/tracing/adapt.ts:97   spanAttributes(...)
src/apps/chat-ui/src/tracing/adapt.ts:99   summary -> attributes.content
src/apps/chat-ui/src/tracing/adapt.ts:100  input -> attributes.input/args/arguments
src/apps/chat-ui/src/tracing/adapt.ts:105  output -> attributes.output/result
src/apps/chat-ui/src/tracing/adapt.ts:115  assistant output -> attributes.content
src/apps/chat-ui/src/tracing/adapt.ts:118  user output -> attributes.content
src/apps/chat-ui/src/tracing/adapt.ts:121  reasoning output -> attributes.reasoning
```

Then React renders payloads with `MarkdownRenderer` or `JsonRenderer`:

```text
src/apps/chat-ui/src/tracing/SpanNode.tsx:383  SpanContent
src/apps/chat-ui/src/tracing/SpanNode.tsx:387  content = attributes.content || attributes.input || attributes.output || attributes.message
src/apps/chat-ui/src/tracing/SpanNode.tsx:417  MarkdownRenderer / JsonRenderer
src/apps/chat-ui/src/tracing/SpanNode.tsx:429  JsonRenderer for tool output
```

The UI virtualizes visible rows, which is useful for DOM performance, but it still receives, parses, adapts, caches, and stores the full trace object before virtualization helps.

### React Query caches large trace pages

Current frontend trace fetch:

```text
src/apps/chat-ui/src/tracing/use-session-trace-page.ts:60  useQuery tracePageQuery
src/apps/chat-ui/src/tracing/use-session-trace-page.ts:65  getTrace(...)
src/apps/chat-ui/src/tracing/use-session-trace-page.ts:102 setBaseTraceView(trace)
src/apps/chat-ui/src/cache.ts:7 DEFAULT_TRACE_EVENTS_PAGE_SIZE = 2000
```

The trace response may be retained in React Query and local React state. This doubles down on memory pressure in the browser, and the server still bears the response build/serialization/compression cost.

### responseJson and sendWebResponse are synchronous-heavy for large JSON

Current JSON response helper:

```text
src/web/http.ts:18 responseJson(payload)
src/web/http.ts:19 new Response(JSON.stringify(payload), ...)
```

Current response sender:

```text
src/web/http.ts:81 sendWebResponse(...)
src/web/http.ts:85 if compressEncoding...
src/web/http.ts:86 readResponseBody(webResponse)
src/web/http.ts:88 gzipSync(body, { level: 1 })
src/web/http.ts:168 readResponseBody(...)
src/web/http.ts:176 Buffer.concat(chunks)
```

For a large trace response, this creates multiple large in-memory copies:

1. the trace object graph;
2. the string produced by `JSON.stringify`;
3. the `Response` body bytes;
4. the concatenated `Buffer`;
5. the gzip output buffer.

It also blocks the event loop during `JSON.stringify` and `gzipSync`. The measured behavior is consistent with this path.

## Incident Timeline Reconstruction

### Earlier performance session

`ps_70cc...` started around `2026-07-04T10:56:02Z` with a user request to investigate why Pibo became slower over hours/days, with suspicion around tracing. That session then generated extensive debugging and implementation work.

Observed aggregate characteristics:

```text
event_log rows for ps_70cc...: thousands
trace nodes: about 1295 in one earlier rebuild
bash tool calls: hundreds
read tool calls: over 100
pibo_run_start attempts: multiple
context_length_exceeded errors around 2026-07-04T17:52:59Z
```

The session itself became a large trace workload while investigating trace performance.

### Later local hang

During the second reported hang, the active turn in `ps_70cc...` was analyzing a gateway OOM and local store sizes. It emitted assistant messages about:

- `pibo.sqlite` telemetry no longer exploding;
- `pibo-events.sqlite` being a larger local store;
- `pibo 1.6.0` running under Node `v22.16.0`;
- local gateway OOM after several hours;
- need for heap observability and hard in-process bounds.

In parallel, `ps_8a645...` was running Unity/MCP operations.

This matters because the Web Gateway was not merely serving a passive UI. It was also actively hosting agent runtime/session state, tool telemetry, live output, and trace rendering for two active sessions.

## Root Cause Analysis

### Finding 1: The normal trace response can be multi-megabyte even with small page size

The strongest direct measurement:

```text
GET /api/chat/trace?piboSessionId=ps_70cc...&pageSize=80
response size: 6.15 MB
client duration: 8.64 s
server-timing trace handler: 155.7 ms
```

This disproves the assumption that `pageSize` alone bounds the response. The trace object includes payload-bearing nodes derived from transcripts and event projection. A small event page can still produce a large trace.

Confidence: High.

### Finding 2: Handler timing does not include the expensive response work

The route's `server-timing` value is assembled before `responseJson` serializes the payload and before `sendWebResponse` buffers/compresses it. Therefore, current timing instrumentation underreports the actual cost that users feel.

Confidence: High.

### Finding 3: The Web Gateway event loop is blocked by synchronous serialization/compression

`JSON.stringify` and `gzipSync` are synchronous. When applied to multi-megabyte trace payloads, they block the single Node event loop. This explains why unrelated app-shell requests are delayed by 15-25 seconds while the gateway is otherwise "reachable."

Confidence: High.

### Finding 4: The broad trace contract creates systemic payload bloat

The current `PiboTraceNode` can carry arbitrary `input` and `output`. The frontend adapter preserves those payloads into `Span.attributes`, and the UI caches the whole trace page. This makes large trace responses a product contract, not an incidental bug.

Confidence: High.

### Finding 5: Virtualized rendering is necessary but insufficient

The UI uses `react-virtuoso`, which is appropriate for DOM row count. However, virtualization occurs after the entire response has already been built, serialized, transferred, parsed, adapted, and cached. The performance boundary is too late.

Confidence: High.

### Finding 6: Active provider/turn telemetry can remain non-terminal

Both current active turns showed `missingTerminalEvent=true`. Provider request state in `ps_70cc...` had multiple requests still marked `streaming` even after later requests started. This creates stale/running inconsistencies between runtime state, persisted telemetry, and UI expectations.

This is not the primary cause of the large JSON payload, but it makes caching and live status less stable. It can keep sessions marked active, invalidate tail cache versions, and encourage more live trace refresh work.

Confidence: Medium-high.

### Finding 7: Unsupported Node version is a real operational risk

Running `pibo@1.6.0` under Node `v22.16.0` despite `engines.node >=24` is not enough to explain the architecture failure, but it should not be allowed silently for gateway operation. It can change stream, SQLite, compression, and memory behavior relative to what the package declares.

Confidence: Medium.

## Why This Matters for Developer Experience

Pibo's target users are developers and operators. They are accustomed to local terminals, fast IDEs, and interactive logs. A Chat Web trace view that feels like a remote, high-latency dashboard will not meet that expectation.

The trace/session surface is not a secondary debug tool; it is the primary trust surface. It explains what the agent did, what tools ran, what failed, and whether work is still alive. If this surface blocks the gateway, users lose both visibility and control.

The correct product standard is console-like responsiveness:

- first meaningful content quickly;
- small incremental updates;
- no full-session reload on streaming changes;
- details on demand;
- large output accessible but not in the hot path;
- gateway health preserved under large sessions.

## Architectural Assessment

### Current architecture

Current flow:

```text
Pi transcript + Chat Web event_log + live snapshots + session metadata
  -> buildTraceView(...)
  -> nested PiboTraceNode tree with input/output payloads
  -> responseJson(JSON.stringify(full tree))
  -> sendWebResponse(read full body + gzipSync)
  -> browser response.json()
  -> adaptTrace(...) into spans
  -> React Query cache + local React state
  -> virtualized rendering
```

This architecture optimizes for implementation convenience and a single complete object model. It does not optimize for hot-path payload size, event-loop responsiveness, or progressive UI.

### Target architecture

Target flow:

```text
Raw sources remain append-only:
  Pi transcript
  Chat Event Log / Raw Pibo Event Log
  Pibo Reliability Store
  optional telemetry archives

Trace Projection builds compact read model:
  trace_nodes
  trace_edges
  trace_payloads
  trace_session_state
  optional trace_segments

Chat Web hot path:
  summary -> tiny JSON
  timeline page -> compact rows, bounded size
  live stream -> small patches
  node expansion -> lazy payload fetch
  raw events -> separate debug endpoint
```

The target architecture keeps all data but changes what is served by default.

## Recommended Design: Trace V2 Read Model

### Principle 1: Structure is hot-path; payload is cold-path

Timeline rows should be small and predictable. A trace row should include:

```ts
type TraceTimelineNode = {
  nodeId: string;
  parentId?: string;
  piboSessionId: string;
  type: TraceNodeType;
  status: "running" | "done" | "error";
  title: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  orderKey: TraceOrderKey;
  depth?: number;
  hasChildren: boolean;
  childCount?: number;
  preview?: {
    text: string;
    source: "summary" | "payload" | "error";
    truncated: boolean;
  };
  payloadRefs?: {
    input?: TracePayloadRef;
    output?: TracePayloadRef;
    reasoning?: TracePayloadRef;
    error?: TracePayloadRef;
    raw?: TracePayloadRef;
  };
  linkedPiboSessionId?: string;
  toolCallId?: string;
  runId?: string;
};
```

Hard rule: no unbounded `unknown` payloads in the default timeline node.

### Principle 2: Payload references are first-class

Large content should move to a payload store:

```ts
type TracePayloadRef = {
  ref: string;
  contentType: "text/markdown" | "text/plain" | "application/json" | "application/x-ndjson";
  byteLength: number;
  preview: string;
  truncatedPreview: boolean;
  hash?: string;
};
```

Payload access:

```text
GET /api/chat/trace/payload/:ref
GET /api/chat/trace/payload/:ref?offset=0&limit=65536
```

This enables:

- lazy expansion;
- range loading for very large tool outputs;
- copy/download without rendering everything;
- safe redaction and content-type handling;
- caching by payload hash/ref.

### Principle 3: Raw events are debug data, not normal timeline data

Raw event access should be separate:

```text
GET /api/chat/trace/raw-events?piboSessionId=...&cursor=...&limit=...
```

The normal trace timeline should never include raw events, even behind `includeRawEvents=true`. If the UI shows a Raw Events sidebar, it should fetch raw events independently and progressively.

### Principle 4: Historical trace and live trace are separate streams

Historical trace:

```text
GET /api/chat/trace/timeline?piboSessionId=...&cursor=tail&limit=120
```

Live updates:

```text
SSE /api/chat/events or /api/chat/trace/live
event: trace_node_added
event: trace_node_updated
event: trace_payload_preview_updated
event: trace_session_state
```

The UI should overlay live patches on the stable base page. A streaming update should not force a full trace fetch or reserialize historical payloads.

### Principle 5: Projection rebuild is bounded work

Full trace rebuilds, transcript reparse, legacy migration, raw event scans, and payload backfills are heavy work. They must be:

- bounded by per-request budget if done inline;
- otherwise scheduled as worker jobs;
- resumable;
- cancellable;
- observable through job status;
- unable to block gateway health/app-shell requests.

## Proposed TraceReadModel Interface

Introduce a deep module, for example `TraceReadModel` or `TraceQueryService`, with a small public interface.

```ts
interface TraceReadModel {
  getSummary(input: TraceSummaryInput): Promise<TraceSummary>;
  listTimeline(input: TraceTimelineInput): Promise<TraceTimelinePage>;
  getNode(input: TraceNodeInput): Promise<TraceNodeDetail>;
  getPayload(input: TracePayloadInput): Promise<TracePayloadChunk>;
  listRawEvents(input: TraceRawEventsInput): Promise<TraceRawEventsPage>;
  applyEvent(input: TraceEventApplyInput): Promise<TraceProjectionUpdate>;
  ensureProjection(input: TraceProjectionEnsureInput): Promise<TraceProjectionStatus>;
}
```

### What callers should not know

`web-app.ts` and React code should not need to know:

- whether a node came from transcript or event log;
- whether the projection is hot, stale, or being backfilled;
- whether payload lives in SQLite, file store, or transcript offset;
- how to dedupe transcript echoes;
- how to join child sessions and run-control nodes;
- how to apply live patches to the persistent projection;
- how large payloads are stored.

### Hidden implementation

The module hides:

- transcript parsing and offset tracking;
- event-log projection;
- payload extraction and preview generation;
- trace node ordering and nesting;
- backfill/rebuild status;
- cache and memory policy;
- raw event access limits;
- live overlay reconciliation.

### Dependency strategy

This is a local-substitutable module:

- persistence uses SQLite/file-system adapters;
- tests can use in-memory SQLite/temp dirs;
- the public interface can be tested without HTTP or React;
- heavy rebuild adapter can later move to worker backend without changing HTTP/UI contracts.

## Proposed Storage Model

### `trace_nodes`

Compact, indexed timeline records:

```text
node_id TEXT PRIMARY KEY
pibo_session_id TEXT NOT NULL
parent_id TEXT
type TEXT NOT NULL
status TEXT NOT NULL
title TEXT NOT NULL
started_at TEXT
completed_at TEXT
duration_ms INTEGER
order_source TEXT
order_major INTEGER
order_minor INTEGER
order_phase INTEGER
event_sequence INTEGER
stream_id INTEGER
stream_frame_index INTEGER
tool_call_id TEXT
run_id TEXT
linked_pibo_session_id TEXT
preview_text TEXT
preview_truncated INTEGER
payload_input_ref TEXT
payload_output_ref TEXT
payload_reasoning_ref TEXT
payload_error_ref TEXT
stable_key TEXT
source TEXT
updated_at TEXT NOT NULL
```

Indexes:

```text
(pibo_session_id, order_major, order_minor, order_phase, node_id)
(pibo_session_id, event_sequence)
(pibo_session_id, status)
(tool_call_id)
(run_id)
```

### `trace_edges`

Optional if parent IDs are not enough:

```text
pibo_session_id TEXT
parent_node_id TEXT
child_node_id TEXT
kind TEXT
sort_key TEXT
```

### `trace_payloads`

Large content and structured payloads:

```text
payload_ref TEXT PRIMARY KEY
pibo_session_id TEXT NOT NULL
node_id TEXT
kind TEXT NOT NULL
content_type TEXT NOT NULL
byte_length INTEGER NOT NULL
preview_text TEXT
preview_truncated INTEGER NOT NULL
storage_kind TEXT NOT NULL -- inline_small | sqlite_blob | file | transcript_slice | event_payload
storage_locator TEXT
hash TEXT
created_at TEXT NOT NULL
```

The first implementation can store small payloads inline or in SQLite. The important contract is that timeline responses contain refs, not full bodies.

### `trace_session_state`

Projection version and backfill state:

```text
pibo_session_id TEXT PRIMARY KEY
projection_version TEXT NOT NULL
latest_event_sequence INTEGER
latest_stream_id INTEGER
transcript_fingerprint TEXT
status TEXT NOT NULL -- ready | stale | rebuilding | failed
dirty_since_sequence INTEGER
last_projected_at TEXT
last_error TEXT
```

## API Contract Recommendation

### Summary

```text
GET /api/chat/trace/summary?piboSessionId=...
```

Response target: under 5 KB.

Fields:

```ts
type TraceSummary = {
  piboSessionId: string;
  piSessionId: string;
  title: string;
  version: string;
  status: "idle" | "running" | "error";
  nodeCount: number;
  latestEventSequence?: number;
  latestStreamId?: number;
  projectionStatus: "ready" | "stale" | "rebuilding" | "failed";
  runningNodeIds: string[];
  errorCount: number;
  toolErrorCount: number;
};
```

### Timeline page

```text
GET /api/chat/trace/timeline?piboSessionId=...&cursor=tail&limit=120
```

Response target: under 256 KB hard cap; normally 20-100 KB.

Fields:

```ts
type TraceTimelinePage = {
  piboSessionId: string;
  version: string;
  cursor: {
    before?: string;
    after?: string;
    hasOlder: boolean;
    hasNewer: boolean;
  };
  nodes: TraceTimelineNode[];
};
```

### Node details

```text
GET /api/chat/trace/node/:nodeId
```

Returns additional metadata but still bounded. Useful for debug panels and linked sessions.

### Payload

```text
GET /api/chat/trace/payload/:payloadRef?offset=0&limit=65536
```

Response should support:

- text range;
- JSON preview;
- download for full payload;
- `content-range` style metadata;
- maximum inline render size.

### Raw events

```text
GET /api/chat/trace/raw-events?piboSessionId=...&cursor=...&limit=80
```

Raw events should be explicitly debug-only and never piggybacked onto timeline.

## Performance Budgets

These budgets should be part of the acceptance criteria.

### Gateway budgets

```text
GET /api/chat/trace/summary
  p50 <= 30 ms
  p95 <= 100 ms
  response <= 5 KB

GET /api/chat/trace/timeline tail
  p50 <= 80 ms
  p95 <= 200 ms
  response <= 256 KB hard cap
  no synchronous full transcript read
  no unbounded payload fields

GET /api/chat/trace/payload normal payload
  p95 <= 300 ms for <= 1 MB payload
  range support for larger payloads

Gateway health/static app shell
  remains responsive while projection rebuilds or payload inspection runs
```

### Browser budgets

```text
initial session view JSON parse <= 50 ms typical
initial visible timeline render <= 200 ms perceived
no full trace reparse on each streaming delta
React Query must not cache unbounded payload bodies by default
```

### Memory budgets

```text
trace timeline response object <= bounded by node count and preview size
trace cache byte limit, not only entry count
high-memory mode evicts trace caches and refuses large debug payloads
large payloads are referenced, not duplicated across response/cache/state
```

## Migration Plan

### Phase 0: Stop the bleeding

Purpose: reduce current gateway risk before the full projection exists.

Actions:

1. Lower default trace page size from `2000` to a small number such as `80` or `120`.
2. Add response-size guardrails for `/api/chat/trace`.
3. Strip or truncate large `input`/`output` fields in the default trace response.
4. Add `payloadRef` placeholders for large values.
5. Disable synchronous gzip for large JSON or move compression to async streaming.
6. Add gateway self-observability:
   - heap used/total;
   - RSS;
   - event-loop delay;
   - response sizes by route;
   - trace cache entry count and estimated bytes;
   - top large trace sessions;
   - DB/WAL sizes.
7. Warn/fail on unsupported Node versions for gateway execution.

This phase can be backward-compatible if the old fields are still present for small payloads and replaced only when they exceed a threshold.

### Phase 1: Split API contracts

Purpose: stop using full `PiboSessionTraceView` as the normal UI transport.

Actions:

1. Add `/api/chat/trace/timeline`.
2. Add `/api/chat/trace/payload/:ref`.
3. Add `/api/chat/trace/raw-events`.
4. Update Chat Web to use the timeline endpoint for the default session view.
5. Keep old `/api/chat/trace` for debug/backward compatibility, with strict size caps.
6. Move Raw Events sidebar to the raw-events endpoint.

### Phase 2: Persistent trace projection

Purpose: avoid rebuilding the trace from transcript + events on every request.

Actions:

1. Create projection tables.
2. Populate projection on new events.
3. Lazy-backfill old sessions on first access within a strict budget.
4. Add projection status to summary.
5. Make full rebuild a job, not a request.
6. Add tests that a large old session opens with a bounded response.

### Phase 3: Live patch model

Purpose: prevent active sessions from invalidating/reloading the full timeline.

Actions:

1. Emit small trace patch frames over SSE.
2. Apply patches on top of stable timeline pages in the UI.
3. Persist/merge patches into projection when the turn settles.
4. Fix provider request terminal-state gaps so sessions stop appearing active after completion.

### Phase 4: Worker and archive integration

Purpose: align with the broader resource-protection and telemetry-archive specs.

Actions:

1. Move projection rebuild, transcript backfill, raw event export, retention, and archive inspection to workers.
2. Add job progress for rebuilds.
3. Keep gateway routes as bounded status/query endpoints.
4. Add resource policies for trace rebuild and telemetry/debug inspection.

## Compatibility Strategy

The existing `PiboTraceNode` and `PiboSessionTraceView` are consumed by:

- Chat Web terminal/trace UI;
- debug CLI;
- tests;
- local/fake CLI session sources;
- shared terminal view model.

Do not remove them abruptly. Instead:

1. Introduce new V2 DTOs alongside the current types.
2. Build adapters:
   - V1 trace view -> V2 timeline for transitional tests;
   - V2 timeline + payload fetch -> current UI span model where needed.
3. Migrate Chat Web first, because it is the user-facing hot path.
4. Keep debug CLI on V1 temporarily if needed, but make it explicit and bounded.
5. Add deprecation warnings for old full trace endpoint when payload exceeds threshold.

## Validation Plan

### Synthetic fixtures

Create fixtures for:

1. session with 10,000 small events;
2. session with one 10 MB tool result;
3. session with 1,000 tool calls;
4. session with large assistant markdown;
5. session with large reasoning;
6. session with child sessions and yielded runs;
7. running session with live deltas.

### Automated checks

Required tests:

- timeline response has no unbounded `input`/`output`;
- timeline response remains under size budget;
- payload endpoint returns content by ref;
- raw events endpoint is separate and bounded;
- old trace endpoint refuses or truncates over-budget responses;
- trace projection can rebuild incrementally;
- live patch updates one node without full timeline reload;
- provider requests become terminal at turn finish/error/abort;
- gateway static route remains responsive during trace rebuild job.

### Browser checks

Use Playwright/CDP against a dev worker:

- open large trace session;
- reload app;
- switch sessions;
- expand large tool result;
- scroll while live updates arrive;
- inspect memory and network payload sizes.

### Operational checks

Add CLI/debug commands:

```bash
pibo debug trace summary <session>
pibo debug trace projection <session>
pibo debug trace payload <ref> --head
pibo debug resources gateway
```

## Release Gates

A release should not claim this class of issue is fixed until:

- [ ] Default Chat Web session load does not call the old full trace endpoint.
- [ ] Timeline responses are hard-capped and normally below 100 KB.
- [ ] A single large tool output does not enlarge the timeline response beyond budget.
- [ ] Large payloads are loaded only on expansion.
- [ ] Raw events are fetched through a separate bounded endpoint.
- [ ] No route uses synchronous `gzipSync` on large JSON in the gateway event loop.
- [ ] No normal trace request performs full synchronous transcript read for a large session.
- [ ] Gateway exposes heap, event-loop delay, trace cache size, and route response-size diagnostics.
- [ ] Active streaming updates do not force full historical trace reload.
- [ ] Provider request/turn terminal states are closed reliably.
- [ ] Unsupported Node versions fail or warn loudly before gateway operation.

## Risk Assessment

### Risk: Overbuilding a tracing subsystem

The proposed projection is larger than a local hotfix. However, the current architecture has already shown OOM and gateway starvation symptoms. The complexity exists today but is spread across route handlers, trace builders, frontend adapters, caches, and response helpers. A deeper TraceReadModel consolidates that complexity behind a smaller interface.

### Risk: Losing debugging detail

The proposal does not delete data. It changes default transport. Payloads and raw events remain available through explicit APIs. This is a better debug model because expensive data access becomes intentional and inspectable.

### Risk: Migration cost

The migration is real. The safest path is vertical:

1. bounded V2 timeline endpoint;
2. UI uses it;
3. payload refs;
4. persistent projection;
5. worker rebuild.

Each step reduces risk independently.

### Risk: Projection drift

Any read model can drift from raw sources. Mitigation:

- store projection version and source watermarks;
- provide rebuild jobs;
- include debug diff command comparing projection against raw events;
- keep raw sources authoritative.

## Expert Recommendation

Do not keep trying to optimize the current full trace tree contract. It is the wrong boundary for a fast developer UI.

The product should move to Trace V2:

```text
compact timeline first,
payloads on demand,
raw events separate,
live patches incremental,
projection persistent,
heavy rebuilds isolated.
```

This directly addresses the measured failure mode:

- `6 MB` timeline responses become small bounded pages;
- `JSON.stringify` and `gzipSync` no longer see huge hot-path objects;
- browser JSON parsing and React caching stop receiving full payload bodies;
- streaming does not invalidate/reload history;
- raw data is preserved for debug;
- gateway remains a responsive control plane instead of becoming a trace-rendering worker.

The broader worker-isolation and telemetry-archive specs are still important, but they do not replace this change. Worker isolation protects the gateway from heavy jobs. Telemetry archive isolation protects the gateway from debug telemetry bloat. Trace V2 protects the primary Chat Web workflow itself.

For Pibo's developer experience, this should be treated as a top-tier architecture priority.
