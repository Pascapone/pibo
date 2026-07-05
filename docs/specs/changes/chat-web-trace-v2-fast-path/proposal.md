# Proposal: Chat Web Trace V2 Fast Path

**Status:** Implemented baseline in v1.7.0; follow-up phases remain active
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Requester / Source:** Chat Web trace performance/OOM incidents and expert report
**Related docs:**

- `docs/reports/chat-web-trace-performance-expert-report-2026-07-04.md`
- `docs/reports/gateway-oom-followup-2026-07-04.md`
- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`
- `docs/specs/capabilities/chat-web-virtualized-session-scrolling.md`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/`
- `docs/specs/changes/gateway-resource-protection-workers/`

## Why

Chat Web must feel like a fast local developer console. Users should be able to switch rooms, open large sessions, inspect tool calls, follow live output, and scroll through history without waiting seconds or risking gateway OOM.

The current trace API contract makes that impossible for large sessions. It returns a broad materialized object that can include structure, transcript-derived content, event-log content, raw/debug data, large tool inputs/outputs, live overlays, and nested children. Virtualized rendering helps DOM count, but it happens after the gateway has built, serialized, compressed, transferred, parsed, adapted, cached, and stored the full trace object.

The expert report measured a normal trace request with a 6 MB response taking 8.6 seconds client-side while route-level server timing reported only 155 ms. The missing cost was synchronous JSON serialization, full response buffering, and synchronous gzip in the gateway event loop. Earlier investigations also found trace payloads around 146 MB for image-heavy transcripts.

The trace transport contract must change. Pibo should keep all raw data, but the default Chat Web path must only move compact timeline structure and small previews. Large payloads, raw events, and rebuilds must be explicit, lazy, paginated, and bounded.

## What Changes

Pibo introduced the Trace V2 hot path in `v1.7.0`:

1. A compact timeline API returns small rows, previews, payload references, and cursors.
2. Large input/output/reasoning/error/raw payloads move behind payload refs and range-capable payload endpoints.
3. Raw events move to a separate debug-only paginated API.
4. Normal tail rendering and older-history loading use bounded timeline pages instead of full historical trace refetches.
5. Trace projection remains a later read-model phase that can be built incrementally and later rebuilt in workers.
6. Old full-trace APIs remain temporarily for compatibility but are capped, deprecated, and not used by default Chat Web.
7. Server, network, browser parse, React cache, and render budgets become release gates.

## Capabilities

### New Capabilities

- `trace-v2-read-model`: compact timeline, node detail, payload, raw-event, and projection status queries.
- `trace-payload-store`: payload refs, previews, range reads, hashes, content types, and download metadata.
- `trace-live-patches`: small SSE patch frames for running sessions. This remains a follow-up capability; `v1.7.0` ships live overlay compatibility and bounded timeline refresh behavior, not the final patch protocol.
- `trace-performance-budgets`: hard response, serialization, cache, and browser budgets.
- `trace-projection-jobs`: rebuild/backfill jobs for old sessions and large raw-source scans. This remains a later worker/projection capability.

### Modified Capabilities

- `chat-web-trace-and-terminal-view`: default Chat Web moves from full `PiboSessionTraceView` transport to Trace V2 timeline pages.
- `chat-web-cache-and-live-state`: React Query must not cache unbounded payload bodies by default.
- `chat-web-rooms-and-event-streams`: live stream reconnect/replay must not replay unbounded historical payloads.
- `pibo-data-store-and-ingestion`: large output payloads are stored by reference, not duplicated inline in hot event streams.
- `gateway-resource-protection-workers`: projection rebuild and raw archive inspection run as jobs/workers.

## Non-Goals

- Do not delete raw data. Trace V2 changes default transport, not source retention by itself.
- Do not require a remote observability service.
- Do not require full worker isolation before shipping the compact timeline API.
- Do not rewrite every debug CLI command in the first slice.
- Do not remove old V1 types abruptly; migrate Chat Web first and keep bounded compatibility.

## Success Definition

The `v1.7.0` baseline succeeds when opening or switching to a large session uses bounded timeline responses, first meaningful content appears quickly, large payloads are represented by payload refs and explicit payload reads, raw events are separate and bounded, and the gateway remains responsive under large traces.

The full roadmap succeeds when persistent projection, formal trace live patches, telemetry archive isolation, and worker-protected rebuild/maintenance jobs are also complete.
