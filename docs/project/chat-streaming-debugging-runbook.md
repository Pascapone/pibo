---
type: "Guide"
title: "Chat Streaming Debugging Runbook"
description: "Guides deterministic diagnosis of Chat Web streaming behavior from provider output through the rendered DOM."
tags: ["chat-web", "debugging", "streaming"]
status: "draft"
authority: "directive"
migration_lineage:
  source_path: "docs/project/chat-streaming-debugging-runbook.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "623b091404ae34ce161213fd7bf3c316d6b5a854"
  source_bytes: 6151
  source_sha256: "611bea6e7d170b6459b740e4836003bbe37802dac9ba2135edf23642c41dfba8"
  source_body_sha256: "611bea6e7d170b6459b740e4836003bbe37802dac9ba2135edf23642c41dfba8"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-08-31T22:47:46Z"
---
# Chat Streaming Debugging Runbook

This runbook describes how to diagnose Chat Web streaming regressions without guessing which layer is responsible.

## Layer model

Inspect streaming from upstream to user-visible output:

1. **Provider/Pi telemetry**: provider request, normalized text/reasoning deltas, byte sizes, gaps, parse errors, first text latency.
2. **Pibo output stream**: normalized `assistant_delta`, `thinking_delta`, final message, and message boundary events.
3. **Chat SSE transport**: `/api/chat/events` delivery, response headers, SSE ids, network chunking, text events per chunk.
4. **Browser EventSource**: selected live stream events, `lastEventId`, reconnects, transient `live:<n>` ids.
5. **Live overlay / React state**: enqueue, flush, overlay update, trace refresh, current output length.
6. **DOM**: visible assistant text update count, positive character jumps, update gaps, first visible latency, long tasks.

The DOM layer is the user-visible result. Provider and transport layers explain whether bad DOM cadence is caused upstream or in the browser.

## Standard deterministic benchmark

Use the backend fixture when you want a reproducible live stream through the real Chat Web SSE path without provider credentials:

```bash
pibo debug web scenario streaming-benchmark \
  --backend-fixture \
  --fixture-mix reasoning-text \
  --assert \
  --artifact
```

Use repeated runs before comparing tuning changes:

```bash
pibo debug web scenario streaming-benchmark \
  --backend-fixture \
  --fixture-mix reasoning-text \
  --runs 5 \
  --assert \
  --artifact
```

When live trace compute is too small to measure on the default fixture, seed a larger live overlay before counters reset. Backend fixture DOM metrics are scoped to the active fixture message and ignore debug prelude rows, so larger preludes can profile overlay compute without turning delayed prelude rendering into DOM max-jump failures:

```bash
pibo debug web scenario streaming-benchmark \
  --backend-fixture \
  --fixture-mix reasoning-text \
  --fixture-prelude-messages 20 \
  --runs 5 \
  --assert \
  --artifact
```

Compare hosted dev against the current direct target when a dev URL is configured:

```bash
PIBO_DEV_PUBLIC_URL=<dev-chat-url> \
pibo debug web scenario streaming-benchmark \
  --backend-fixture \
  --fixture-mix reasoning-text \
  --compare-hosted-if-configured \
  --assert \
  --artifact
```

Render an archived artifact without CDP/browser access:

```bash
pibo debug web report streaming-benchmark \
  --from path/to/artifact.json \
  --compact
```

Write reviewer-ready outputs:

```bash
pibo debug web report streaming-benchmark \
  --from path/to/artifact.json \
  --compact \
  --output docs/reports/artifacts/streaming/summary.md \
  --json-output docs/reports/artifacts/streaming/summary.json
```

## Real-provider smoke

When provider credentials and telemetry are available, attach provider/Pi metrics after the benchmark window:

```bash
pibo debug web scenario streaming-benchmark \
  --provider-selected-session \
  --duration 5000 \
  --artifact
```

If you already know the request or session id:

```bash
pibo debug web scenario streaming-benchmark --provider-request-id pr_... --artifact
pibo debug web scenario streaming-benchmark --provider-session-id ps_... --artifact
pibo debug web scenario streaming-benchmark --provider-turn-id turn_... --artifact
```

Provider telemetry is non-fatal when unavailable, so deterministic worker runs can still validate the benchmark without credentials.

## Decision table

| Symptom | First check | Likely layer | Next action |
| --- | --- | --- | --- |
| Provider emits large deltas | Provider delta byte/gap stats | Provider/Pi | Do not smooth in Chat Web until provider behavior is understood. |
| Direct SSE is fine, hosted SSE arrives in large chunks | direct-vs-hosted URL comparison, `X-Accel-Buffering` | Proxy/SSE transport | Verify `/api/chat/events` response headers and hosted proxy buffering. |
| SSE has fine text events but EventSource loses deltas | selected-live EventSource counts, transient ids, `lastEventId` | Browser EventSource / frame identity | Check `live:<n>` ids and stale durable cursor reuse. |
| EventSource is healthy but overlay counters drop | enqueue/flush/overlay ratios | Live overlay / React state | Inspect batching, dedupe, and overlay update cadence. |
| Overlay is healthy but DOM jumps are large | DOM positive updates, char jumps, long tasks | Rendering/DOM | Profile React/Markdown rendering and virtualization. |
| Trace catch-up appears briefly then disappears | trace samples and `dom.lengthMax` | Trace snapshot fallback | Gate on max visible live snapshot, not only final durable transcript. |
| Benchmark flakes at startup | fixture start, SSE first event, probe errors | Probe setup | Refresh auth/CDP target, restart worker gateway, or inspect probe races. |

## Reading benchmark output

Prefer these rows in compact reports:

- **Provider/Pi**: upstream cadence and parse health.
- **SSE transport**: text/reasoning preservation, chunk gaps, text events per chunk.
- **EventSource selected-live**: browser-delivered live frames, transient id count, and reconnect replay/cursor-lag/duplicate fields when `liveSince` is used.
- **Live overlay**: enqueue/flush/overlay preservation ratios plus first live text, flush, and overlay latencies.
- **Markdown render**: renderer invocation count/plain/CommonMark/GFM parser/GFM fast/full split and total/max duration for assistant Markdown hosts when debug streaming is enabled; full-path timing includes synchronous ReactMarkdown parse and tree building, while GFM fast counts direct renderers, such as simple strikethrough and simple task-list output with guarded strong/code spans and simple link labels with strong, emphasis, inline code, strong-wrapped emphasis, or emphasis-wrapped strong, that intentionally bypass `remark-gfm`.
- **DOM**: visible positive updates, max jump, p90 gap, first visible latency.
- **Score**: aggregate smoothness plus regression/warning count.

Treat a single run as a smoke test. Treat medians from `--runs N` as comparison evidence.
