# Tasks: Chat Web Trace V2 Fast Path

**Status:** Draft
**Created:** 2026-07-04
**Related spec:** `spec.md`

## Work Estimate

Estimated implementation size: **large**, but it can ship in risk-reducing vertical slices.

Suggested delivery:

- Phase 0 emergency response safety: 1–3 days.
- Phase 1 compact timeline DTO/API: 3–6 days.
- Phase 2 payload refs and payload endpoint: 4–7 days.
- Phase 3 Chat Web migration: 4–8 days.
- Phase 4 live patches and cache policy: 4–8 days.
- Phase 5 persistent projection: 1–3 weeks.
- Phase 6 worker/rebuild integration and validation: 1–2 weeks.

## Phase 0: Emergency Response Safety

### Tasks

- [ ] T0.1 Add response-size and serialization timing instrumentation for trace routes.
- [ ] T0.2 Add hard response cap for old `/api/chat/trace`.
- [ ] T0.3 Ensure old trace endpoint strips or replaces large payload bodies with refs/previews.
- [ ] T0.4 Add trace cache byte budget, not only entry count.
- [ ] T0.5 Add high-memory eviction for trace caches.
- [ ] T0.6 Disable or avoid synchronous `gzipSync` for large JSON responses.
- [ ] T0.7 Add no-store headers/cache mode for dynamic trace responses.
- [ ] T0.8 Warn or fail clearly when gateway runs on unsupported Node version.

### Acceptance

- [ ] A large trace cannot return an unbounded full-tree JSON response.
- [ ] Trace route logs/metrics include handler, serialization, compression, and bytes.
- [ ] Cache memory cannot grow beyond the configured trace budget.

## Phase 1: Trace V2 DTOs and Timeline API

### Tasks

- [ ] T1.1 Define `TraceTimelineNode`, `TracePayloadRef`, `TraceTimelinePage`, `TraceSummary`, and cursor types.
- [ ] T1.2 Add `TraceReadModel` interface.
- [ ] T1.3 Implement adapter over current trace/raw sources that emits compact timeline rows.
- [ ] T1.4 Add `/api/chat/trace/timeline` endpoint.
- [ ] T1.5 Add timeline cursor model for tail, older, and newer pages.
- [ ] T1.6 Enforce timeline node count and byte caps.
- [ ] T1.7 Add tests proving no unbounded `input`/`output` fields appear in timeline rows.

### Acceptance

- [ ] Timeline API returns compact rows for existing sessions.
- [ ] A 10 MB tool result does not enlarge timeline response beyond budget.
- [ ] Timeline pages include stable cursors and version.

## Phase 2: Payload References and Payload Endpoint

### Tasks

- [ ] T2.1 Implement payload ref generation for input/output/reasoning/error/raw payloads.
- [ ] T2.2 Implement preview generation with truncation metadata.
- [ ] T2.3 Implement `TracePayloadStore` adapter.
- [ ] T2.4 Add `/api/chat/trace/payload/:payloadRef` endpoint with offset/limit.
- [ ] T2.5 Add payload access checks matching session access.
- [ ] T2.6 Add download path for full payloads when allowed.
- [ ] T2.7 Add tests for text, JSON, markdown, image/base64 metadata, and corrupt refs.

### Acceptance

- [ ] Expanding a large node loads payload chunks lazily.
- [ ] Payload endpoint is range-limited by default.
- [ ] Payload refs are stable across repeated timeline reads for unchanged data.

## Phase 3: Raw Events API Split

### Tasks

- [ ] T3.1 Add `/api/chat/trace/raw-events` endpoint.
- [ ] T3.2 Move Raw Events UI/sidebar to the raw-events endpoint.
- [ ] T3.3 Remove `includeRawEvents` from normal Chat Web timeline flow.
- [ ] T3.4 Add cursor/limit tests for raw events.
- [ ] T3.5 Add debug warning if old full trace endpoint is used for raw events.

### Acceptance

- [ ] Normal timeline responses never include raw events.
- [ ] Raw Events panel fetches bounded raw event pages independently.

## Phase 4: Chat Web Default View Migration

### Tasks

- [ ] T4.1 Update `useSessionTracePage` or replacement hook to query summary + timeline pages.
- [ ] T4.2 Render compact terminal rows from `TraceTimelineNode` without adapting large payloads into `Span.attributes`.
- [ ] T4.3 Implement upward infinite scroll using Trace V2 cursors.
- [ ] T4.4 Add lazy expansion for payload refs.
- [ ] T4.5 Cancel/ignore stale timeline and payload requests on session switch.
- [ ] T4.6 Tune React Query cache/stale/gc policies for timeline vs payload chunks.
- [ ] T4.7 Add browser validation for large session open, switch, expand, and scroll.

### Acceptance

- [ ] Default Chat Web session view does not call old `/api/chat/trace`.
- [ ] Session switching feels immediate and does not retain unexpanded payload bodies.
- [ ] Upward infinite scroll preloads before top and can load multiple pages.

## Phase 5: Live Patch Model

### Tasks

- [ ] T5.1 Define trace live patch frame types.
- [ ] T5.2 Emit node added/updated/status/preview/payload-ref patches.
- [ ] T5.3 Apply patches on top of loaded timeline pages.
- [ ] T5.4 Avoid full trace/timeline refetch for normal streaming deltas.
- [ ] T5.5 Fix provider request/turn terminal-state gaps.
- [ ] T5.6 Add tests for running turn, error, abort, reconnect, and duplicate transcript echo.

### Acceptance

- [ ] Streaming updates do not force full historical reload.
- [ ] Running status clears reliably when a turn finishes/errors/aborts.
- [ ] Reconnect resumes from cursor or compact delta, not full history.

## Phase 6: Persistent Projection

### Tasks

- [ ] T6.1 Add projection schema: `trace_nodes`, `trace_payloads`, `trace_session_state`.
- [ ] T6.2 Project new events incrementally into trace nodes/payload refs.
- [ ] T6.3 Store source watermarks and projection version.
- [ ] T6.4 Add lazy backfill for old sessions with strict per-request budget.
- [ ] T6.5 Add projection status to summary.
- [ ] T6.6 Add projection diff/debug command against raw sources.
- [ ] T6.7 Add migration tests for old sessions.

### Acceptance

- [ ] Timeline reads use projection for projected sessions.
- [ ] Old sessions open with bounded tail even before full backfill completes.
- [ ] Projection rebuild can repair drift.

## Phase 7: Worker Integration for Heavy Trace Work

### Tasks

- [ ] T7.1 Move full rebuild/backfill/raw export to jobs/workers when worker model is available.
- [ ] T7.2 Add progress, heartbeat, cancellation, and failure state.
- [ ] T7.3 Add resource policy for trace projection rebuild.
- [ ] T7.4 Ensure gateway routes return status/job ids instead of blocking.
- [ ] T7.5 Add stress tests while rebuild job runs.

### Acceptance

- [ ] Gateway health and app shell remain responsive during rebuild.
- [ ] Rebuild can be cancelled.
- [ ] UI shows projection status and progress.

## Phase 8: Compatibility and Deprecation

### Tasks

- [ ] T8.1 Keep V1 full trace endpoint for explicit debug compatibility.
- [ ] T8.2 Add V1 size caps and deprecation metadata.
- [ ] T8.3 Update debug CLI to prefer V2 summary/timeline/payload commands.
- [ ] T8.4 Add docs explaining V1 vs V2 trace behavior.
- [ ] T8.5 Remove default Chat Web dependencies on V1 DTOs.

### Acceptance

- [ ] Existing debug workflows have a bounded migration path.
- [ ] Normal Chat Web is fully V2.
- [ ] Over-budget V1 calls fail safely or return bounded truncated data.

## Verification Plan

- [ ] Unit tests for DTO schema and payload-ref generation.
- [ ] Integration tests for large sessions and payload endpoint.
- [ ] Browser/CDP tests for open/switch/scroll/expand/live update.
- [ ] Route instrumentation tests for serialization/compression timing.
- [ ] Synthetic large-output and large-event fixtures.
- [ ] Gateway resource diagnostics checked during trace stress.

## Implementation Notes

- Ship Phase 0 and Phase 1 before attempting full projection.
- Do not wait for worker isolation to stop full-trace hot-path payloads.
- Do not cache payload chunks as long as timeline rows.
- Treat old V1 endpoint as debug compatibility only.
- Keep UI performance budgets visible in validation reports.
