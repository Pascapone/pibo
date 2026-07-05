# Report: Chat Web Trace V2 Spec Sync - 2026-07-05

**Status:** Completed documentation pass for the v1.7.0 release baseline
**Scope:** Chat Web trace/gateway performance specs and directly related capability contexts
**Release baseline:** `@pasko70/pibo@1.7.0`, tag `v1.7.0`

## Summary

The specs now reflect the new Trace V2 performance philosophy:

- structure is the hot path;
- payloads are cold path;
- raw events are separate debug data;
- normal Chat Web does not use the old full `/api/chat/trace` path;
- gateway diagnostics and byte budgets are survival guardrails, not optional telemetry;
- full worker isolation remains later architecture and was intentionally not part of the first fix.

## Shipped in v1.7.0

- Gateway diagnostics for memory, event-loop delay, stream/listener counts, trace cache bytes, transient replay buffer bytes, reliability payload buckets, externalized payload count, and recent warnings.
- Trace timeline page cache byte/count budgets and transient replay buffer byte/count budgets.
- Reliability `pibo.output` inline payload budget with large-value externalization to payload refs/previews.
- Large JSON responses skip synchronous gzip above the configured sync-compression size limit.
- Compact Trace V2 DTOs and `/api/chat/trace/timeline`.
- Default Chat Web session view uses Trace V2 timeline pages instead of old full `/api/chat/trace`.
- Timeline pages are hard-capped and carry previews, inline-small payloads, payload refs, cursor metadata, and version metadata.
- `/api/chat/trace/payload/:payloadRef` supports bounded range reads.
- `/api/chat/trace/raw-events` is separate and bounded.
- Upward infinite scrolling loads older Trace V2 pages automatically near the top and keeps the manual "Load older trace history" button out of the normal UI.
- Payload refs load the first chunk lazily when terminal details are expanded.
- Old `/api/chat/trace` remains compatibility/debug-only and fails safely when estimated response size exceeds the budget.

## Still Pending

- Formal `TraceReadModel` interface/module boundary.
- First-class full payload download route and richer multi-chunk payload UI.
- Broader payload tests for markdown, image/base64 metadata, corrupt refs, and download policy.
- Formal Trace V2 SSE patch frame protocol.
- Persistent projection tables: `trace_nodes`, `trace_payloads`, `trace_session_state`.
- Worker/job-backed trace rebuild, backfill, raw export, and payload backfill.
- Debug CLI migration to prefer V2 summary/timeline/payload commands.
- Full telemetry opt-in capture/archive isolation.
- Full gateway resource-protection worker model, resource policies, crash-context files, and platform isolation backends.

## Specs Updated

- `GLOSSARY.md`
- `docs/plans/pibo-fast-gateway-and-trace-roadmap.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/proposal.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/spec.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/design.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/tasks.md`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/spec.md`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/tasks.md`
- `docs/specs/changes/gateway-resource-protection-workers/spec.md`
- `docs/specs/changes/gateway-resource-protection-workers/tasks.md`
- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`
- `docs/specs/capabilities/chat-web-virtualized-session-scrolling.md`
- `docs/specs/capabilities/chat-web-cache-and-live-state.md`
- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/pibo-data-store-and-ingestion.md`

## Validation

This pass was source-inspected against the released implementation paths:

- `src/apps/chat/trace-v2.ts`
- `src/apps/chat/web-app.ts`
- `src/web/http.ts`
- `src/apps/chat-ui/src/tracing/use-session-trace-page.ts`
- `src/apps/chat-ui/src/tracing/trace-v2-adapter.ts`
- `src/apps/chat-ui/src/api-trace-signals.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`
- `test/trace-v2-fast-path.test.mjs`
- `test/chat-ui-trace-infinite-scroll.test.mjs`
- `test/chat-ui-trace-page-merge.test.mjs`
