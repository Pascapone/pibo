# Design: Pibo Observability and Debug Telemetry

## Context

The telemetry system exists to make runtime incidents explainable without context overflow. It complements the normalized event log and signal registry. It is not a second transcript store.

The design follows the current Debug CLI pattern:

1. Start with compact discovery.
2. Select one object.
3. Drill into bounded child rows.
4. Treat payload previews as disabled/unavailable by default; if enabled later, fetch them only by explicit id.
5. Prefer JSON for agent-driven loops.

## Goals / Non-Goals

### Goals

- Show where runtime work is stuck: queue, prompt build, provider request, provider stream, tool args, tool exec, continuation, abort, or finish.
- Correlate telemetry to Pibo Sessions, turns, provider requests, tool calls, and normalized events.
- Keep default output small.
- Preserve enough provider-stream facts to diagnose parser, transport, and upstream behavior.
- Prevent accidental secret or transcript dumps.

### Non-Goals

- Replace the Chat Web trace model.
- Implement timeout recovery in this change.
- Provide long-term analytics or dashboards.
- Store every token or every raw event payload indefinitely.

## Decisions

### Decision: Use telemetry records, not raw logs, as the primary model

**Choice:** Store structured telemetry rows for phases, provider requests, provider raw-event summaries, and tool-call progress. Payload preview APIs may exist, but preview capture/storage is disabled or unavailable by default unless explicitly enabled later.

**Rationale:** Rows are queryable, bounded, and easy to expose through CLI pages. Raw log files are hard to correlate and easy to over-dump.

**Alternatives considered:**

- Plain text logs only: simpler, but weak for agent drill-down.
- Full OpenTelemetry stack: too heavy and external for local-first debugging.

### Decision: Separate diagnostic metadata from content payloads

**Choice:** Store diagnostic metadata, counters, timings, safe structural fields, and links in primary telemetry tables. Do not store full provider payloads, transcripts, normalized event payloads, or full tool arguments by default. Optional bounded previews remain a later/explicit choice.

**Rationale:** Most diagnosis needs event type, timing, ids, byte sizes, counts, parser status, and links back to existing session/event evidence. Full raw payloads would duplicate data, grow the local volume, and make debug commands too large.

**Alternatives considered:**

- Store all raw SSE JSON: high storage risk and redundant with existing session/event content.
- Store no payload samples ever: safest for volume, but may make unknown event/parser bugs harder to diagnose.

### Decision: CLI output is cursor-oriented

**Choice:** Provider event listings use sequence ids or cursors with `--after` and `--limit`.

**Rationale:** Provider streams can contain many events. Cursors let agents inspect windows without loading the whole stream.

### Decision: Signals expose hints only

**Choice:** Signal snapshots can include active phase and stale age, but detailed provider/tool facts live in telemetry commands.

**Rationale:** Signals are live UI state. Telemetry is evidence. Mixing them would bloat signal payloads.

### Decision: Correlation ids are first-class

**Choice:** Telemetry rows carry explicit ids rather than relying on timestamps.

**Rationale:** Cloned sessions, parallel tool calls, and simultaneous gateway work make timestamp inference unreliable.

## Conceptual Data Model

V1 stores telemetry in the unified `pibo.sqlite` data store with dedicated telemetry tables. Names below are illustrative and should follow existing Pibo store naming conventions where practical.

The telemetry tables are intentionally separate from session and event rows, but they live in the same SQLite database so debug commands can join session, room, event-log, payload, and telemetry evidence directly. Telemetry must store links and diagnostic metadata, not duplicate full transcripts, normalized event payloads, or full tool arguments.

### `telemetry_turns`

One row per processed message or queued compaction action.

```ts
type TelemetryTurn = {
  turnId: string;
  piboSessionId: string;
  rootSessionId?: string;
  roomId?: string;
  inputEventId?: string;
  source: "user" | "ui" | "rpc" | "system";
  status: "queued" | "running" | "ok" | "error" | "aborted" | "timeout";
  currentPhase?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastProgressAt?: string;
  queuedBehind?: number;
  summary?: string;
};
```

### `telemetry_phases`

Ordered phase rows for a turn.

```ts
type TelemetryPhase = {
  phaseId: string;
  turnId: string;
  piboSessionId: string;
  name:
    | "queued"
    | "message_started"
    | "prompt_build"
    | "provider_request"
    | "provider_stream"
    | "reasoning"
    | "assistant_text"
    | "tool_args"
    | "tool_execution"
    | "continuation"
    | "abort"
    | "finish";
  status: "open" | "ok" | "error" | "aborted" | "timeout";
  startedAt: string;
  endedAt?: string;
  lastProgressAt?: string;
  durationMs?: number;
  providerRequestId?: string;
  toolCallId?: string;
  eventStreamId?: number;
  counters?: Record<string, number>;
  summary?: string;
};
```

### `telemetry_provider_requests`

One row per provider call.

```ts
type TelemetryProviderRequest = {
  providerRequestId: string;
  piboSessionId: string;
  turnId: string;
  phaseId?: string;
  provider: string;
  api: string;
  model: string;
  transport: "sse" | "websocket" | "auto" | "unknown";
  serviceTier?: string;
  status: "started" | "headers" | "streaming" | "completed" | "error" | "aborted" | "timeout";
  startedAt: string;
  responseHeadersAt?: string;
  firstByteAt?: string;
  lastRawEventAt?: string;
  lastNormalizedEventAt?: string;
  completedAt?: string;
  httpStatus?: number;
  upstreamResponseId?: string;
  rawEventCount: number;
  normalizedEventCount: number;
  parseErrorCount: number;
  unknownEventCount: number;
  bytesReceived?: number;
  errorCategory?: string;
  errorMessage?: string;
  captureMode: "metadata_only" | "bounded_preview" | "disabled";
};
```

### `telemetry_provider_events`

One bounded summary row per raw provider event or grouped event, depending on storage pressure.

```ts
type TelemetryProviderEvent = {
  rawEventId: string;
  providerRequestId: string;
  sequence: number;
  receivedAt: string;
  eventType: string;
  byteSize: number;
  parseStatus: "ok" | "invalid_json" | "ignored" | "unknown_type";
  normalizedType?: string;
  eventStreamId?: number;
  itemId?: string;
  toolCallId?: string;
  payloadPreviewRef?: string;
  safeFields?: Record<string, string | number | boolean | null>;
};
```

### `telemetry_tool_calls`

One row per model-generated tool call.

```ts
type TelemetryToolCall = {
  toolCallId: string;
  piboSessionId: string;
  turnId: string;
  providerRequestId?: string;
  toolName: string;
  status: "args_started" | "args_partial" | "args_complete" | "executing" | "ok" | "error" | "aborted" | "timeout";
  argsStartedAt?: string;
  firstDeltaAt?: string;
  lastDeltaAt?: string;
  argsCompletedAt?: string;
  executionStartedAt?: string;
  executionEndedAt?: string;
  argsBytes: number;
  parseStatus: "empty" | "partial" | "valid" | "invalid" | "complete";
  safeArgKeys?: string[];
  eventStreamId?: number;
  errorMessage?: string;
};
```

### `telemetry_payload_previews`

Optional bounded payload previews. V1 should avoid payload previews unless explicitly approved; most diagnosis should rely on metadata, counters, safe fields, and links back to existing session/event/payload evidence. If previews are implemented, they should be short-lived, bounded, and clearly marked.

```ts
type TelemetryPayloadPreview = {
  payloadPreviewRef: string;
  controllerKind: "provider_event" | "provider_request" | "tool_args";
  controllerId: string;
  createdAt: string;
  byteSize: number;
  truncated: boolean;
  redacted?: boolean;
  contentType: "application/json" | "text/plain";
  previewText: string;
  retentionClass: "payload_preview";
};
```

## Capture Points

### Router / Queue

Capture:

- message accepted,
- queue length,
- message started,
- message finished,
- abort/clear/dispose actions,
- queued-behind count.

### Routed Session

Capture:

- active message id,
- phase transitions from normalized Pi events,
- last normalized event time,
- session status snapshots on state changes.

### Provider Call

Capture through stream wrapper and callbacks:

- request start,
- provider/model/api/transport,
- response headers and status,
- first byte / first raw event,
- event type counts,
- parse errors,
- unknown event types,
- upstream response id,
- terminal status.

### Provider Stream Parser

Capture:

- raw event sequence,
- event type,
- byte size,
- parse status,
- safe fields,
- payload preview ref when enabled.

Important: parser telemetry must be best-effort and must not crash the provider stream.

### Tool Call Construction

Capture:

- toolcall start,
- deltas as counters and last-progress timestamps,
- argument byte length,
- parse state,
- top-level safe keys,
- toolcall end.

Do not store full tool args by default.

### Tool Execution

Capture:

- execution start,
- update count and last update,
- finish status,
- duration,
- error category.

## CLI Discovery Design

### Root help

```text
pibo debug telemetry - inspect runtime telemetry

Commands:
  sessions   List sessions with recent telemetry
  session    Inspect one session's telemetry summary
  turn       Inspect one turn timeline
  provider   Inspect one provider request and raw event timeline
  tool       Inspect one tool call
  stale      List active stale work
  stats      Show telemetry counts and sizes
  prune      Prune telemetry by retention and age

Next:
  pibo debug telemetry sessions --active
  pibo debug telemetry session ps_...
  pibo debug telemetry stale
```

### Session summary

Default text output:

```text
Session ps_...
  status: streaming
  queue: 2
  active turn: d3038cbc...
  active phase: tool_args stale 6m12s
  last progress: 2026-05-16T04:30:01.406Z
  provider request: pr_...
  next: pibo debug telemetry turn d3038cbc...

Recent turns:
created_at              turn_id       status    phases  active/stale
2026-05-16T04:28:28Z    d3038cbc...   running   8       tool_args stale
```

### Turn timeline

```text
Turn d3038cbc... (session ps_...)
status: running

phase                 status    start       duration    last_progress      next
queued                ok        04:28:28    0ms         -
provider_request      ok        04:28:32    33s         04:29:05           provider pr_...
tool_args             open      04:30:01    open        04:30:01           tool call_loy...

Next:
  pibo debug telemetry provider pr_...
  pibo debug telemetry tool call_loy...
```

### Provider request summary

```text
Provider request pr_...
  session: ps_...
  turn: d3038cbc...
  model: openai-codex / gpt-5.5
  transport: sse
  status: streaming stale
  http: 200
  first byte: 04:28:32
  last raw event: 04:30:01
  last normalized event: 04:30:01
  upstream response: resp_... or unknown

Raw event counts:
  response.created: 1
  response.output_item.added: 3
  response.function_call_arguments.delta: 12
  unknown: 0
  parse_errors: 0

Next:
  pibo debug telemetry provider pr_... events --limit 20
```

### Provider event list

Default output includes only event metadata:

```text
seq  time       type                                      bytes  parse  normalized          tool
41   04:30:01   response.output_item.added                512    ok     tool_call:start     call_loy...
42   04:30:01   response.function_call_arguments.delta    120    ok     tool_args:delta     call_loy...
```

Payload fetch is explicit:

```text
pibo debug telemetry provider pr_... payload raw_42 --max-bytes 2048
```

## Payload and Redaction Rules

Default telemetry stores metadata and links, not full content bodies. Redaction is only relevant for optional preview paths or display of header/payload-like values. Volume control is the primary V1 requirement.

Always redact values for keys or headers matching:

- `authorization`
- `cookie`
- `set-cookie`
- `api_key`
- `apiKey`
- `token`
- `access_token`
- `refresh_token`
- `client_secret`
- `clientSecret`
- `googleClientSecret`
- `password`
- `secret`

Also redact common bearer/key patterns in strings:

- `Bearer ...`
- `sk-...`
- OAuth access token shapes where safely detectable.

Optional preview output must mark truncation and, when redaction is applied, mark that redaction happened. Redaction should prefer false positives over leaking secrets, but V1 should avoid needing preview content for normal diagnostics.

## Retention

Suggested default retention:

- turn summaries: 30 days,
- phase summaries: 30 days,
- provider request summaries: 14 days,
- provider event summaries: 7 days,
- payload previews: 24 hours,
- incident-pinned records: until explicit prune.

Retention classes:

- `live`
- `diagnostic`
- `provider_event`
- `payload_preview`
- `incident`

## Migration / Rollback

### Migration

- Add schema with idempotent migrations.
- If telemetry tables are missing, debug commands fail with a clear migration/store message.
- Existing event logs remain valid.
- Existing debug commands remain unchanged.

### Rollback

- Telemetry capture can be disabled through config/env.
- Debug telemetry commands can report `telemetry disabled` without affecting other debug commands.
- Data pruning removes telemetry records without touching sessions, transcripts, or normalized event logs.

## Risks / Trade-offs

- Capturing too much raw provider data can duplicate existing content and grow local databases quickly. Mitigate with metadata-first storage, aggregation/sampling, links, and optional bounded previews only when needed.
- Telemetry writes can add overhead to streaming. Mitigate with batched or best-effort writes and bounded payload work.
- Parallel tool-call streams can interleave. Mitigate by tracking provider item ids and tool call ids, not one global current item.
- Too many CLI commands can reduce discoverability. Mitigate with compact help and `next` suggestions.

## Open Questions

- Should a later release enable payload previews as explicit bounded samples for parser/unknown-event diagnostics?
- Should provider event summaries be per-event for all events, aggregated by default, or sampled only for unusual/error events to control disk growth?
- What exact provider/profile settings shape should expose telemetry stale thresholds?
- What provider/phase-specific stale thresholds should ship in V1?
