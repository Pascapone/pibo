# Chat Streaming Benchmark Specification

## Purpose

The Chat Streaming Benchmark gives agents and reviewers a repeatable way to measure Chat Web streaming smoothness across provider, transport, browser, React/live-overlay, and DOM layers.

It is designed to answer one question: **where did fine-grained streaming become chunky, delayed, or lost?**

## CLI surface

Primary command:

```bash
pibo debug web scenario streaming-benchmark [options]
```

Report command:

```bash
pibo debug web report streaming-benchmark --from artifact.json [--compact] [--output report.md] [--json-output report.json] [--json]
```

## Modes

### Observation mode

Runs against the current Chat Web target and observes live streaming state for a duration.

Useful options:

- `--duration ms`
- `--provider-request-id pr_...`
- `--provider-session-id ps_...`
- `--provider-turn-id turn_...`
- `--provider-selected-session`
- `--artifact`

### Browser fixture mode

`--fixture` navigates the target to a deterministic in-browser stream fixture. It does not exercise the real Chat Web SSE path, but it is useful for DOM/timer baseline checks.

### Backend fixture mode

`--backend-fixture` posts to `/api/chat/debug/streaming-fixture` and drives deterministic live-only events through the real Chat Web `/api/chat/events` path.

This is the default deterministic regression mode because it exercises:

- authenticated Chat Web app;
- `/api/chat/events` SSE transport;
- Browser EventSource;
- live overlay enqueue/flush;
- React render cadence;
- visible assistant DOM updates.

### URL comparison mode

`--compare-url <url>` runs the same backend fixture at the current target and another Chat URL.

`--compare-hosted` resolves the compare URL from `PIBO_DEV_PUBLIC_URL`, `PIBO_DEV_BASE_URL`, or `.env.developer-host`.

`--compare-hosted-if-configured` performs the comparison when configured and records a skip warning otherwise. Use this in portable Ralph/CI loops.

## Fixtures

### Profiles

`--fixture-profile` selects the deterministic timing profile:

- `steady`: one delta per cadence interval.
- `jitter`: deterministic uneven cadence around the configured interval.
- `burst`: bursty arrival pattern with short gaps inside bursts.
- `batch`: intentional stress profile where groups of deltas share a timestamp after a pause.

### Mixes

`--fixture-mix` selects content type:

- `text`: assistant text deltas only.
- `reasoning-text`: reasoning deltas plus assistant text deltas.

### Simulations

`--simulate-reconnect` reloads the app with an EventSource probe, forces live stream closes, and checks reconnect/transient id behavior.

`--simulate-trace-catchup` suppresses backend live text deltas while compacting output into trace snapshots. It verifies trace snapshot recovery rather than fine-grained DOM cadence.

## Negative profiles

Negative profiles are controlled failures. They imply assertion mode and required regression patterns.

### `batch`

```bash
pibo debug web scenario streaming-benchmark --negative-profile batch
```

Expands to a backend batch reasoning/text fixture. Expected failures include DOM batching and, depending on timing, SSE text-events-per-chunk batching.

### `overlay-drop`

```bash
pibo debug web scenario streaming-benchmark --negative-profile overlay-drop
```

Preserves SSE/EventSource input but drops text/reasoning before live-overlay enqueue through a benchmark-only in-page hook. Expected failures are live-pipeline preservation failures, not transport failures.

## Metrics

### Provider/Pi

Collected when provider telemetry is requested and available:

- provider request id, session id, turn id, provider/model;
- raw and normalized event counts;
- parse and unknown event counts;
- text/reasoning delta counts;
- delta byte stats;
- inter-delta gap stats;
- first byte/text/reasoning latency.

### SSE transport

Collected by an in-page fetch-based SSE probe:

- status and headers, including `X-Accel-Buffering`;
- chunk byte stats;
- chunk gap stats;
- text/reasoning event counts;
- text events per network chunk;
- text event gap stats;
- SSE id counts split by transient, durable, and other.

### Browser EventSource

Collected by an in-page EventSource wrapper:

- selected-live stream event count;
- text/reasoning count after start;
- transient id count;
- reconnect/open/error observations;
- first event/text/reasoning latency.

### Live pipeline

Collected from `window.__piboStreamingDebug` when `?debugStreaming=1` or local storage enables debug streaming:

- live open/error count;
- event, enqueue, flush, flushed-event, overlay-update, overlay-event counts;
- current output and trace base output lengths;
- trace refresh count/duration;
- first text, enqueue, flush, and overlay-update latency;
- preservation ratios normalized by fixture/provider/debug expected input.

### DOM

Collected from visible assistant Markdown hosts:

- text length start/end/max;
- update and positive update counts;
- positive character jump stats;
- DOM update gap stats;
- first and last visible latency;
- rAF gap stats;
- Long Task count and duration.

## Gates

`--assert` exits non-zero when unexpected regressions are present.

Healthy deterministic backend fixture gates include:

- fixture starts successfully;
- debug counters are available;
- SSE/EventSource preserve expected text and reasoning events;
- transient `live:<n>` ids are present for live-only frames;
- DOM positive update count is high enough for fixture count;
- DOM p90 gap tracks fixture cadence;
- DOM max jump stays small for steady fixtures;
- first visible latency is bounded;
- long tasks remain bounded;
- provider telemetry, when available, has no parse/unknown/truncation issues and preserves provider deltas through SSE/EventSource.

URL comparison gates additionally check relative degradation:

- selected-live/SSE event loss;
- smoothness drop;
- fixture-normalized DOM/SSE cadence lag;
- cross-layer first-latency deltas.

Expected regressions can be declared with `--expect-regression <substring>`. Unexpected or missing expected regressions fail assertion mode.

## Artifact review

Artifacts can be reviewed without browser access:

```bash
pibo debug web report streaming-benchmark --from artifact.json
pibo debug web report streaming-benchmark --from artifact.json --compact
```

Compact single/group reports include rows for:

- Provider/Pi;
- Provider ratios;
- SSE transport;
- Cadence lag;
- EventSource selected-live;
- Live overlay;
- DOM;
- Score.

Compact URL comparison reports include rows for:

- smoothness;
- DOM gap and cadence lag;
- SSE chunk gap and cadence lag;
- selected-live text/reasoning preservation;
- live-pipeline ratios;
- cross-layer first latency.

Machine-readable report output uses stable `rows`:

- single/group rows: `metric`, `preservation`, `cadenceLatency`;
- URL comparison rows: `metric`, `primaryP50`, `compareP50`, `delta`.

## Recommended PR validation

For changes touching streaming transport, live overlay, trace fallback, Markdown rendering, or virtualization, run at least:

```bash
npm run typecheck
npm run build
node --test test/debug-cli.test.mjs test/web-channel.test.mjs test/trace-live-reducer.test.mjs
pibo debug web scenario streaming-benchmark --backend-fixture --fixture-mix reasoning-text --assert --artifact
```

Use `--runs 5` when comparing performance or smoothness changes.
