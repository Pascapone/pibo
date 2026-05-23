# Chat Streaming Regression Knowledge Base

This document records known Chat Web streaming failure modes and the benchmark signals that catch them.

## Known fixed failure modes

### Hosted nginx buffering

**Symptom:** Hosted Chat Web showed visible 20-30 token bursts while direct localhost SSE delivered fine-grained deltas.

**Cause:** The hosted reverse-proxy path buffered `/api/chat/events` into larger network chunks.

**Fix:** Chat event streams set `X-Accel-Buffering: no`.

**Regression signal:**

- Hosted/direct URL comparison shows much worse SSE chunk gaps or text events per chunk.
- `SSE transport` row has high `text/chunk p90` or large `text gap p90` above fixture cadence.

### Stale `EventSource.lastEventId` on live-only deltas

**Symptom:** Browser EventSource received fine-grained events, but Chat Web rendered in large jumps. The live overlay saw very few unique deltas.

**Cause:** Live-only `assistant_delta` frames were sent without their own SSE `id:`. Browser EventSource reused the previous durable cursor as `lastEventId`, and frontend dedupe collapsed distinct live frames.

**Fix:** Live-only frames get connection-local transient ids such as `live:0`, `live:1`, ... . These ids are not durable replay cursors.

**Regression signal:**

- Selected-live EventSource text count is lower than fixture/provider text count.
- Transient id count is zero or much lower than live event count.
- Live overlay enqueue/flush ratios drop while SSE transport remains healthy.

### Same-stream delta dedupe

**Symptom:** Multiple deltas from one assistant stream were treated as duplicates.

**Cause:** Delta identity did not include a frame index.

**Fix:** Streaming frame identity distinguishes separate deltas in the same stream.

**Regression signal:**

- Provider/SSE text count is healthy but live overlay or DOM count is too low.
- Repeated deltas in one stream collapse before rendering.

### Optimistic user echo duplication

**Symptom:** A user prompt appeared twice after the transcript arrived.

**Cause:** Optimistic message identity and transcript-confirmed message identity did not always converge, especially when the transcript user row used a different Pi entry id.

**Fix:** `clientTxnId` is reused as stable send identity, and transcript user rows can confirm optimistic echoes by id or matching text fallback.

**Regression signal:**

- Duplicate user rows after `message_queued` and transcript refresh.
- Integration tests around optimistic user message reconciliation fail.

## Known benchmark/probe pitfalls

### Reconnect transient ids are connection-local

`live:<n>` ids can restart at `live:0` after reconnect. Do not assert global uniqueness across reconnects. Assert that:

- live frames use transient ids, not durable cursors;
- reconnect opens are observed;
- expected text/reasoning deltas survive reconnect.

### Trace catch-up can be transient

When live deltas are suppressed and trace snapshots recover output, the visible snapshot can disappear after a message boundary if it was live-only compactor state rather than durable transcript output.

Gate trace catch-up on:

- trace sample count;
- live trace version count;
- first live trace version latency;
- maximum visible assistant output length during the run.

Do not rely only on final DOM length.

### EventSource probe state can persist across runs

A browser tab can retain the EventSource wrapper between `--runs` iterations. Multi-run summaries must use after-start counters, not cumulative counters.

### SSE fetch probe can race fixture startup

An independent fetch-based SSE probe can compete with the app EventSource if it uses the exact same stream URL and starts too late or blocks fixture POST.

Mitigations:

- add a cache-busting probe query;
- wait briefly for SSE response headers before posting the fixture;
- bound abort/shutdown so partial artifacts are still returned.

### Background CDP tabs throttle timers

Browser timers and `requestAnimationFrame` cadence can collapse when the target tab is backgrounded. Benchmarks should bring the target page to front before measuring.

### Stale gateway/auth state can look like a benchmark failure

If a Docker worker was rebuilt or a gateway PID is stale, CDP/auth failures can masquerade as streaming regressions. Re-establish a fresh worker gateway and authenticated target before comparing metrics.

## Controlled negative profiles

### `batch`

The backend fixture intentionally emits groups of deltas at the same scheduled timestamp after a pause. It should preserve text/reasoning events while triggering batching-related DOM/SSE regressions.

Use it to prove gates catch batched delivery:

```bash
pibo debug web scenario streaming-benchmark --negative-profile batch --artifact
```

### `overlay-drop`

The browser receives all SSE/EventSource input, but a benchmark-only hook drops text/reasoning before live overlay enqueue.

Use it to prove live-pipeline preservation gates catch browser-side loss separately from transport loss:

```bash
pibo debug web scenario streaming-benchmark --negative-profile overlay-drop --artifact
```

## Regression triage checklist

1. Confirm fixture/provider expected counts.
2. Compare provider delta counts to SSE selected-live counts.
3. Compare SSE selected-live counts to debug enqueue/flush counts.
4. Compare live overlay output length to DOM positive updates and max jumps.
5. Check first-latency rows separately from steady cadence rows.
6. Use direct-vs-hosted comparison before changing frontend code for hosted-only symptoms.
7. Use controlled negative profiles when changing gates, so expected failures remain intentional.
