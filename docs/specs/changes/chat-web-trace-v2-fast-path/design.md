# Design: Chat Web Trace V2 Fast Path

**Status:** Draft
**Created:** 2026-07-04
**Related spec:** `spec.md`

## Design Summary

Trace V2 separates hot-path structure from cold-path payloads. The gateway serves compact timeline pages and small live patches. Large payloads, raw events, transcript slices, and rebuild work are accessed explicitly through bounded APIs or jobs.

The first implementation can be vertical and incremental:

1. Add DTOs and bounded timeline API backed by current raw sources.
2. Add payload refs and payload endpoint.
3. Move Chat Web default session view to the new API.
4. Add persistent projection tables and live patch integration.
5. Move rebuild/backfill/debug scans to workers.

## Target Architecture

```text
Raw sources:
  Pi transcript files
  Chat event_log
  Pibo reliability event stream
  live runtime snapshots
  optional telemetry archives

Projection layer:
  TraceReadModel
  compact trace node rows
  payload refs/previews
  projection state/watermarks

Hot Chat Web path:
  summary -> tiny JSON
  timeline page -> compact rows
  live patches -> small SSE frames
  payload expand -> lazy range request

Heavy path:
  rebuild/backfill/raw-export/archive-inspect -> job/worker
```

## Public Module Interface

Introduce a module such as `TraceReadModel` or `TraceQueryService`.

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

HTTP and React code should not know whether a row came from transcript, event log, reliability event stream, payload store, or live overlay.

## DTOs

### Timeline Node

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
  depth: number;
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

Hard rule: no `unknown` payload fields in this DTO.

### Payload Ref

```ts
type TracePayloadRef = {
  ref: string;
  contentType: "text/markdown" | "text/plain" | "application/json" | "application/x-ndjson" | "application/octet-stream";
  byteLength: number;
  preview: string;
  truncatedPreview: boolean;
  hash?: string;
};
```

### Timeline Page

```ts
type TraceTimelinePage = {
  piboSessionId: string;
  version: string;
  projectionStatus: "ready" | "stale" | "rebuilding" | "failed";
  cursor: {
    before?: string;
    after?: string;
    hasOlder: boolean;
    hasNewer: boolean;
  };
  nodes: TraceTimelineNode[];
  responseBudget: {
    nodeLimit: number;
    truncatedByBytes: boolean;
  };
};
```

## API Routes

### Summary

```text
GET /api/chat/trace/summary?piboSessionId=...
```

Small status object. No nodes, raw events, or payload bodies.

### Timeline

```text
GET /api/chat/trace/timeline?piboSessionId=...&cursor=tail&limit=120
```

Returns compact rows. Supports `cursor=tail`, `before=<cursor>`, and `after=<cursor>`.

### Node Detail

```text
GET /api/chat/trace/node/:nodeId
```

Returns bounded metadata for debug panels. Still no large payload bodies.

### Payload

```text
GET /api/chat/trace/payload/:payloadRef?offset=0&limit=65536
```

Returns a chunk and metadata. Large payloads use range reads or download.

### Raw Events

```text
GET /api/chat/trace/raw-events?piboSessionId=...&cursor=...&limit=80
```

Debug-only, paginated, separate from timeline.

## Storage Model

### First Slice: Adapter over Existing Sources

The first slice may generate compact rows from current trace engine/output events, as long as it:

- strips large payloads into refs/previews before response;
- avoids full transcript reads when serving a page;
- enforces byte budgets before returning;
- stores large payloads or refs in an explicit payload adapter.

This enables fast UX before full projection tables exist.

### Persistent Projection Tables

#### `trace_nodes`

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

#### `trace_payloads`

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

#### `trace_session_state`

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

## Payload Storage Strategy

Use a simple adapter:

```ts
type TracePayloadStore = {
  put(input: TracePayloadWriteInput): Promise<TracePayloadRef>;
  getChunk(input: TracePayloadChunkInput): Promise<TracePayloadChunk>;
  stat(ref: string): Promise<TracePayloadRef>;
};
```

Possible storage kinds:

- `inline_small`: very small values only;
- `sqlite_blob`: moderate values if safe;
- `file`: large payload bodies;
- `transcript_slice`: pointer to transcript byte range plus hash/fingerprint;
- `event_payload`: pointer to existing event payload only if bounded access is possible.

The first implementation can choose file-backed payloads for large tool outputs to avoid growing hot SQLite rows.

## Response Serialization and Compression

Trace APIs need response accounting beyond route handler timing:

- estimate payload size before `JSON.stringify` where possible;
- measure `JSON.stringify` duration;
- measure compression duration and output bytes;
- avoid synchronous `gzipSync` for over-budget JSON;
- prefer no compression, async streaming, or range payload endpoints for large payloads;
- expose metrics in Server-Timing and gateway diagnostics.

## Frontend Design

### State Split

React state separates:

- summary query;
- timeline pages;
- live patch overlay;
- expanded payload chunks;
- raw events panel state.

Timeline pages may be cached with count/byte limits. Payload chunks use shorter cache times and are evicted aggressively.

### Rendering

The compact terminal renders `TraceTimelineNode` rows directly or through a lightweight adapter. It must not adapt large payloads into `Span.attributes` for normal display.

### Infinite Scroll

Upward infinite scroll uses timeline cursors, not event-log-only cursors. It must prefetch before the user hits the top, but it must not load older pages on initial bottom mount.

### Live Updates

SSE patches update rows by `nodeId`. A patch can update preview/status/payloadRef without refetching historical pages.

## Migration Strategy

### Compatibility

- Keep V1 `PiboTraceNode` and `PiboSessionTraceView` temporarily.
- Add V2 DTOs alongside V1.
- Add adapters for tests and transitional UI.
- Mark V1 full trace endpoint as compatibility/debug-only once Chat Web migrates.

### Old Sessions

Old sessions can open before full projection backfill:

1. summary returns projection status;
2. timeline tail is built within strict budget;
3. if more work is needed, schedule projection job;
4. UI shows available tail plus rebuild/backfill state.

## Resource and Worker Integration

Projection rebuilds, legacy transcript scans, raw exports, and payload backfills use the job/worker model from `gateway-resource-protection-workers` when available. Until then, they must be budgeted and cancellable or refused from the gateway request path.

## Observability

Add metrics:

- trace summary/timeline/payload/raw response bytes;
- serialization/compression duration;
- timeline node count;
- payload ref count and bytes;
- cache entries and estimated bytes;
- projection status counts;
- live patch rates;
- old V1 endpoint usage.

Expose through resource diagnostics without scanning large payloads.

## Validation

### Synthetic Fixtures

- 10,000 small events;
- one 10 MB tool result;
- 1,000 tool calls;
- large assistant markdown;
- large reasoning;
- child sessions and yielded runs;
- running session with live deltas.

### Browser Checks

- open large session;
- reload app;
- switch sessions repeatedly;
- expand large tool result;
- scroll upward while live updates arrive;
- inspect network payload sizes and browser memory.

## Release Gates

A release must not claim to fix trace performance until:

- default Chat Web does not call old full trace endpoint;
- timeline responses are bounded;
- large payloads load only on expansion;
- raw events are separate;
- no large JSON route uses synchronous `gzipSync`;
- no normal trace request performs full transcript read;
- live patches do not force full timeline reload;
- diagnostics expose route bytes, heap, event-loop delay, and cache sizes.
