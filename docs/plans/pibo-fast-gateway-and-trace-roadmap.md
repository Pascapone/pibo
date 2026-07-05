# Plan: Pibo Fast Gateway and Trace Architecture Roadmap

**Status:** Active roadmap; v1.7.0 shipped Phases 0-2 hot-path baseline
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Source:** Chat Web trace performance incidents, OOM follow-up, expert report, and Umbau specs

## Purpose

This plan orders the performance/reliability work so Pibo becomes fast before it becomes elaborate. The goal is a Chat Web UI that feels like a local terminal: quick first content, smooth session switching, incremental live updates, and details on demand.

As of `v1.7.0`, the first performance release has shipped the new hot-path philosophy:

- structure is the hot path;
- payloads and raw events are cold paths;
- normal Chat Web uses compact Trace V2 timeline pages;
- large payloads are exposed by payload refs and explicit range reads;
- raw events are fetched through a separate bounded debug endpoint;
- gateway caches, replay buffers, reliability payloads, and route responses have survival guardrails.

This does not mean the whole roadmap is complete. Persistent projection, true SSE trace patches, telemetry capture/archive isolation, and full worker resource isolation remain follow-up architecture.

## Source Specs

- `docs/specs/changes/chat-web-trace-v2-fast-path/`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/`
- `docs/specs/changes/gateway-resource-protection-workers/`

## Target End State

### Gateway

The gateway is a responsive control plane. It serves UI, auth, lightweight APIs, summaries, timeline pages, job status, and cancellation. It does not build huge trace objects, scan raw archives, run retention, execute tools, or compress huge JSON in its event loop.

### Trace UI

Chat Web renders compact timeline pages. Payloads are lazy. Raw events are separate. Live updates are patches. Infinite scroll uses trace cursors and preloads before the user reaches the top. Session switching cancels stale requests and does not keep full payloads in memory.

### Data

Operational data remains available by default. Verbose telemetry is opt-in and isolated. Reliability/event-stream payloads are bounded and reference large bodies. Trace projection stores compact rows and payload refs. Raw sources remain authoritative and rebuildable.

### Workers

Heavy work runs as jobs: projection rebuilds, telemetry archive inspection, retention/prune, exports, and eventually agent/runtime/tool execution. Workers have resource policies and cancellation. Gateway stays responsive under worker load.

### Observability

Pibo always exposes bounded self-observability: heap, RSS, event-loop delay, active streams, trace cache bytes, replay buffer bytes, route response sizes, DB/WAL sizes, large payload counters, and recent warnings. Diagnostics must not parse large payloads.

## Phased Delivery

## Phase 0: Survival Guardrails

**v1.7.0 status:** Shipped for the Chat Web gateway hot path.

Ship before claiming any fix.

- Add gateway memory/resource diagnostics.
- Add trace route response/serialization/compression timing.
- Add trace cache byte budgets and eviction.
- Add replay buffer byte budgets and metrics.
- Bound reliability `pibo.output` inline payloads.
- Store large operational output as payload refs/previews.
- Warn/fail on unsupported Node versions for gateway use.
- Avoid synchronous `gzipSync` for large JSON.

### Shipped Baseline

- Gateway diagnostics expose process memory, event-loop delay, stream/listener counts, trace timeline cache bytes, transient replay buffer bytes, reliability payload buckets, and recent warnings.
- Trace timeline page cache and transient replay buffers have byte/count budgets and eviction.
- Reliability `pibo.output` writes are compacted when over the inline budget and large values move to payload refs/previews.
- Large JSON responses skip synchronous gzip above the configured sync-compression threshold.
- Trace response helpers report serialized byte size and JSON serialization timing.
- Unsupported Node versions now produce startup/runtime warning behavior as part of gateway hardening.

### Exit Criteria

- Synthetic large trace and large tool-output workloads do not OOM the gateway.
- Operator can see memory/cache/payload pressure before failure.
- Normal app shell remains responsive during trace stress.

## Phase 1: Trace V2 Hot Path

**v1.7.0 status:** Shipped for the default Chat Web terminal path.

- Add Trace V2 DTOs.
- Add `/api/chat/trace/timeline`.
- Add hard timeline response caps.
- Add payload refs in timeline rows.
- Keep old full trace endpoint bounded and debug-only.

### Shipped Baseline

- Added shared Trace V2 DTOs for timeline nodes, payload refs, timeline pages, payload chunks, and raw event pages.
- Added `/api/chat/trace/timeline`, with tail and `before` cursor reads, response byte cap, no-store headers, and ETag/version handling for tail reads.
- The default Chat Web trace hook calls the timeline endpoint instead of old `/api/chat/trace`.
- Timeline rows contain bounded inline-small payloads plus refs for larger payloads; they do not carry unbounded raw event bodies.
- Old `/api/chat/trace` remains as compatibility/debug and returns `413` when the estimated V1 response exceeds the compatibility budget.

### Exit Criteria

- Default Chat Web session view no longer calls old `/api/chat/trace`.
- Timeline pages are normally below 100 KB and hard-capped.
- Large tool output does not enlarge the timeline response.

## Phase 2: Lazy Payloads and Raw Event Split

**v1.7.0 status:** Shipped as the first lazy split. UX for richer payload expansion/download remains a follow-up.

- Add `/api/chat/trace/payload/:ref` with range reads.
- Add `/api/chat/trace/raw-events`.
- Move Raw Events UI to separate paginated endpoint.
- Add payload chunk caching policy and eviction.

### Shipped Baseline

- Added `/api/chat/trace/payload/:payloadRef?offset=...&limit=...` with default and maximum range limits.
- Added `/api/chat/trace/raw-events` with pagination limits and a hard response byte cap.
- Raw Events UI reads the raw-events endpoint independently from the normal timeline.
- React Query stores bounded timeline/raw pages; payload chunks are fetched explicitly through the payload API and are not part of the default timeline cache.

### Remaining Follow-up

- Add a richer explicit download path for full payloads where allowed.
- Add direct UI affordances for loading additional payload chunks beyond the first rendered preview.
- Add stricter payload chunk cache eviction if payload-expansion UX begins caching chunks longer than the current query defaults.

### Exit Criteria

- Expanding a large node fetches payload chunk(s), not full history.
- Raw events never piggyback on normal timeline.
- Browser memory remains stable when large payloads are not expanded.

## Phase 3: Live Patch Model

**v1.7.0 status:** Partial. Live overlay and bounded timeline refresh behavior exist, but the formal SSE trace patch protocol is not complete.

- Emit trace node patches over SSE.
- Apply patches to loaded timeline pages.
- Stop full trace/timeline reloads for normal streaming deltas.
- Fix stale provider/turn terminal states.

### Exit Criteria

- Active streaming updates do not reload historical pages.
- Session status settles correctly after finish/error/abort.
- Reconnect resumes from cursor or compact delta.

## Phase 4: Persistent Projection

**v1.7.0 status:** Not shipped. The current implementation is still an adapter over existing trace/raw sources with bounded tail transcript reads.

- Add `trace_nodes`, `trace_payloads`, and `trace_session_state`.
- Project new events incrementally.
- Lazy-backfill old sessions with strict budgets.
- Add projection status and rebuild affordance.

### Exit Criteria

- Projected sessions read from compact indexed rows.
- Old large sessions open with bounded tail while backfill proceeds.
- Projection drift can be diagnosed and repaired.

## Phase 5: Telemetry Isolation

**v1.7.0 status:** Not shipped except for overlapping hot-path reliability payload bounds and gateway diagnostics.

- Disable detailed telemetry by default.
- Add explicit capture runs.
- Store active capture in isolated DB/archive path.
- Archive and inspect telemetry explicitly and bounded.
- Treat legacy live telemetry as inert unless operator runs offline tools.

### Exit Criteria

- Fresh install writes no detailed provider-event telemetry by default.
- Large telemetry archive cannot affect gateway startup/bootstrap.
- Archive maintenance never runs in the request path.

## Phase 6: Worker Resource Protection

**v1.7.0 status:** Not shipped. Full worker isolation intentionally remains after hot-path fixes.

- Add job model for long work.
- Move maintenance, retention, export, trace rebuild, and telemetry inspection to workers.
- Add systemd/cgroups backend first for Linux production.
- Add Windows Job Object or clearly reported fallback.
- Add Docker backend optionally.

### Exit Criteria

- Gateway remains responsive while heavy jobs run.
- Jobs expose progress, heartbeat, cancellation, and failure state.
- Resource-limit violations stop the worker/job, not the gateway.

## Release Gates

A release may claim the Phase 0-2 Chat Web trace/gateway hot-path issue is fixed only when:

- default Chat Web session load uses Trace V2 timeline;
- timeline responses are bounded and payload-free by default;
- large payloads load only on expansion;
- raw events are separate and paginated;
- live updates do not reload full history for normal tail updates;
- gateway diagnostics expose memory, event-loop, cache, replay, payload, and route byte metrics;
- no large JSON response uses synchronous gateway-event-loop compression;
- unsupported Node versions fail or warn before gateway operation;
- synthetic large-session and large-tool-output tests pass;
- browser validation confirms fast open/switch/scroll/expand behavior.

The broader architecture is complete only when later releases also ship persistent projection, formal trace live patches, telemetry archive isolation, and worker resource protection.

## Non-Negotiable Rules

- Structure is hot path; payloads are cold path.
- Debug detail is opt-in and bounded.
- Retention and archive maintenance never run in request handlers.
- UI virtualization does not justify unbounded server/browser payloads.
- Gateway self-observability must stay available when detailed telemetry is off.
- Raw sources remain authoritative; projections are rebuildable.
