# Tasks: Chat Web Trace V2 Fast Path

**Status:** v1.7.0 baseline shipped; later phases pending
**Created:** 2026-07-04
**Updated:** 2026-07-05
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

**v1.7.0 status:** Shipped for the Chat Web gateway hot path.

### Tasks

- [x] T0.1 Add response-size and serialization timing instrumentation for trace routes.
- [x] T0.2 Add hard response cap for old `/api/chat/trace`.
- [x] T0.3 Ensure old trace endpoint strips or replaces large payload bodies with refs/previews by rejecting over-budget V1 responses and directing callers to V2.
- [x] T0.4 Add trace cache byte budget, not only entry count, for Trace V2 timeline page cache.
- [x] T0.5 Add eviction for trace timeline page cache by estimated bytes.
- [x] T0.6 Disable or avoid synchronous `gzipSync` for large JSON responses.
- [x] T0.7 Add no-store headers/cache mode for dynamic Trace V2 responses.
- [x] T0.8 Warn or fail clearly when gateway runs on unsupported Node version.

### Acceptance

- [x] A large trace cannot return an unbounded full-tree JSON response.
- [x] Trace route logs/metrics include handler timing, JSON serialization timing, response bytes, and compression-skip behavior for large bodies.
- [x] Cache memory cannot grow beyond the configured trace timeline page budget.

## Phase 1: Trace V2 DTOs and Timeline API

**v1.7.0 status:** Shipped for the default Chat Web session view.

### Tasks

- [x] T1.1 Define `TraceTimelineNode`, `TracePayloadRef`, `TraceTimelinePage`, `TraceSummary`, and cursor types.
- [ ] T1.2 Add formal `TraceReadModel` interface. The v1.7.0 slice shipped route-level/query helpers first.
- [x] T1.3 Implement adapter over current trace/raw sources that emits compact timeline rows.
- [x] T1.4 Add `/api/chat/trace/timeline` endpoint.
- [x] T1.5 Add timeline cursor model for tail and older pages. Newer-page cursor remains reserved for future use.
- [x] T1.6 Enforce timeline node count and byte caps.
- [x] T1.7 Add tests proving no unbounded `input`/`output` fields appear in timeline rows.

### Acceptance

- [x] Timeline API returns compact rows for existing sessions.
- [x] A 10 MB tool result does not enlarge timeline response beyond budget.
- [x] Timeline pages include cursors and version.

## Phase 2: Payload References and Payload Endpoint

**v1.7.0 status:** API and first expansion path shipped; richer full-payload UX remains.

### Tasks

- [x] T2.1 Implement payload ref generation for input/output/reasoning/error/raw payloads.
- [x] T2.2 Implement preview generation with truncation metadata.
- [x] T2.3 Implement payload adapter backed by the existing Pibo data-store payload service.
- [x] T2.4 Add `/api/chat/trace/payload/:payloadRef` endpoint with offset/limit.
- [x] T2.5 Add payload access checks matching session access.
- [ ] T2.6 Add download path for full payloads when allowed.
- [ ] T2.7 Add broader tests for markdown, image/base64 metadata, corrupt refs, and download policy. Text/JSON/large payload chunk coverage exists.

### Acceptance

- [x] Expanding a large node loads the first payload chunk lazily.
- [x] Payload endpoint is range-limited by default.
- [x] Payload refs are stable for unchanged stored payload content through payload-store deduplication.

## Phase 3: Raw Events API Split

**v1.7.0 status:** Shipped.

### Tasks

- [x] T3.1 Add `/api/chat/trace/raw-events` endpoint.
- [x] T3.2 Move Raw Events UI/sidebar to the raw-events endpoint.
- [x] T3.3 Remove `includeRawEvents` from normal Chat Web timeline flow.
- [x] T3.4 Add cursor/limit tests for raw events.
- [x] T3.5 Add compatibility/deprecation signaling when old full trace endpoint is used.

### Acceptance

- [x] Normal timeline responses never include raw events.
- [x] Raw Events panel fetches bounded raw event pages independently.

## Phase 4: Chat Web Default View Migration

**v1.7.0 status:** Shipped for default terminal rendering and older-history loading.

### Tasks

- [x] T4.1 Update `useSessionTracePage` or replacement hook to query summary + timeline pages.
- [x] T4.2 Render default terminal from Trace V2-derived bounded trace nodes without adapting large payload bodies into normal row state.
- [x] T4.3 Implement upward infinite scroll using Trace V2 cursors.
- [x] T4.4 Add lazy expansion for payload refs. First chunk loads on expansion; further-chunk UI remains follow-up.
- [x] T4.5 Cancel/ignore stale timeline and payload requests on session switch through session-keyed query/local state reset and cancelled payload effects.
- [x] T4.6 Tune React Query cache/stale/gc policies for bounded timeline/raw pages; payload chunk cache remains minimal.
- [x] T4.7 Add browser validation for large session open, switch, expand, and scroll.

### Acceptance

- [x] Default Chat Web session view does not call old `/api/chat/trace`.
- [x] Session switching feels immediate and does not retain unexpanded payload bodies.
- [x] Upward infinite scroll preloads before top and can load multiple pages.

## Phase 5: Live Patch Model

**v1.7.0 status:** Pending as a formal Trace V2 patch protocol. Existing live overlay behavior remains compatibility infrastructure.

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

**v1.7.0 status:** Pending.

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

**v1.7.0 status:** Pending; deliberately not part of the hot-path release.

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

**v1.7.0 status:** Partially shipped.

### Tasks

- [x] T8.1 Keep V1 full trace endpoint for explicit debug compatibility.
- [x] T8.2 Add V1 size caps and deprecation metadata.
- [ ] T8.3 Update debug CLI to prefer V2 summary/timeline/payload commands.
- [x] T8.4 Add docs explaining V1 vs V2 trace behavior.
- [ ] T8.5 Remove default Chat Web dependencies on V1 DTOs completely. The released UI still adapts Trace V2 pages into the existing trace/terminal row pipeline as a compatibility layer.

### Acceptance

- [ ] Existing debug workflows have a bounded migration path.
- [x] Normal Chat Web uses V2 APIs.
- [x] Over-budget V1 calls fail safely or return bounded guidance.

## Verification Plan

- [x] Unit tests for DTO schema and payload-ref generation.
- [x] Integration-style tests for large timeline pages and payload endpoint helpers.
- [x] Browser/CDP validation for open/switch/scroll/expand on a large real session during the v1.7.0 release pass.
- [x] Route instrumentation coverage for response bytes and JSON serialization timing through response helpers.
- [x] Synthetic large-output and large-event fixtures for the Trace V2 hot path.
- [x] Gateway resource diagnostics checked during trace stress.
- [ ] CI-grade browser/CDP regression fixture that can run without the operator's live session.
- [ ] Worker/projection stress validation once later phases exist.

## Implementation Notes

- Ship Phase 0 and Phase 1 before attempting full projection.
- Do not wait for worker isolation to stop full-trace hot-path payloads.
- Do not cache payload chunks as long as timeline rows.
- Treat old V1 endpoint as debug compatibility only.
- Keep UI performance budgets visible in validation reports.
