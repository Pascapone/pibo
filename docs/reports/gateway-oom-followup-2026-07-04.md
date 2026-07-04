# Report: Gateway OOM Follow-up — 2026-07-04

**Status:** Draft
**Source:** Local Windows gateway OOM after installing `@pasko70/pibo@latest` and starting `pibo gateway:web --auth local`
**Related specs:**

- `docs/specs/changes/telemetry-opt-in-archive-isolation/`
- `docs/specs/changes/gateway-resource-protection-workers/`

## Summary

A new local gateway OOM occurred after the gateway had been running for about `19,266,203 ms` (~5h 21m). The process reached the V8 heap limit around 4 GB and crashed with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.

This is not the same symptom as the earlier production telemetry-retention stall. The earlier issue involved a huge `telemetry_provider_events` table and synchronous retention work. The new local evidence points to unbounded or over-large in-process data paths: trace materialization/cache, event replay, and large reliability event payloads.

## Environment Notes

The terminal showed:

```text
npm i -g @pasko70/pibo@latest
@pasko70/pibo@1.6.0
required node >=24
current node v22.16.0
pibo gateway:web --auth local
```

`latest` was still `1.6.0`, so it did not include the local `fix/trace-tail-performance` branch. That means known old behavior was still present:

- large trace responses for certain sessions could reach ~146 MB;
- trace materialization could read/parse huge transcript files before slicing;
- gateway trace cache could hold multiple large trace objects;
- browser/session switching could request multiple traces.

Node `v22.16.0` is below the package engine requirement. This is not proven to be the root cause, but it reduces confidence in runtime behavior and should be flagged by startup diagnostics.

## Local Store Findings

Current local `~/.pibo` store sizes after prior cleanup:

```text
pibo.sqlite             ~306 MB
pibo.sqlite-wal         ~6 MB
pibo-events.sqlite      ~665 MB
pibo-events.sqlite-wal  ~9 MB
```

`pibo.sqlite` telemetry is no longer the largest local issue:

```text
telemetry_provider_events: 69,020 rows
max received_at: 2026-07-04T13:15:28.792Z
```

`pibo-events.sqlite` is a stronger suspect for future heap pressure:

```text
pibo_event_stream rows: 61,139
payload_json sum: ~629 MB
largest payload_json: ~4.8 MB
main topic: pibo.output
largest event type: tool_execution_finished
```

This means Pibo currently stores large tool-output events in the reliability event stream. Any route, debug command, replay, cache, or listener that loads many reliability events into JS objects can create multi-GB heap pressure.

## Likely Failure Mechanisms

### 1. Old trace materialization/cache in published 1.6.0

The OOM happened with published `1.6.0`, not the local trace-tail branch. Large problem sessions previously produced trace payloads around 146 MB. If multiple large traces are materialized and retained in a cache, the default V8 heap can be exhausted.

### 2. Reliability event stream stores full large output payloads

The `pibo.output` reliability stream duplicates large `tool_execution_finished` payloads. This is operationally dangerous even if detailed telemetry is disabled. It is not enough to isolate `telemetry_provider_events`; Pibo must also bound reliability/event-stream payloads and move large payload bodies to a payload store or archive.

### 3. SSE/replay/listener paths may replay too much

Earlier investigation found that `/api/chat/events` can replay historical events on connect. If that replay includes large or numerous events, repeated browser reconnects can create high allocation churn and browser/gateway memory pressure.

### 4. Missing always-on gateway self-observability

The process crashed without an operator-visible trend of heap, RSS, event-loop delay, cache sizes, listener counts, or large payload writes. Pibo needs bounded self-observability that remains on even when detailed telemetry is off.

## Immediate Recommendations

1. Do not treat the current trace-tail fix as deployed until it is released and installed. `@pasko70/pibo@latest` still means published package behavior.
2. Run supported Node `>=24` for gateway testing and warn/fail clearly on unsupported engines.
3. Add hard size bounds to reliability `pibo.output` payloads. Large payloads should become payload references plus previews, not inline JSON in `pibo-events.sqlite`.
4. Add gateway self-observability:
   - heap used/total;
   - RSS/external/arrayBuffers;
   - event-loop delay;
   - active SSE streams/listeners;
   - trace cache entry count and estimated bytes;
   - transient replay buffer size and estimated bytes;
   - large event/payload write counters;
   - DB file/WAL sizes;
   - top growing stores.
5. Expose self-observability through a lightweight endpoint and CLI command, and persist a small rolling ring buffer to disk.
6. Add warning thresholds and emergency degradation:
   - disable trace cache when heap is high;
   - reject or shrink large trace/replay responses;
   - force bounded previews for large output events;
   - emit operator-visible warnings before crash.
7. Move heavy retention/maintenance work out of the gateway, but do not wait for full worker isolation before shipping heap/cache/payload guardrails.

## Spec Implications

The two draft specs are directionally right, but they need stronger phase ordering:

1. **Phase 0: Gateway survival and observability.** Add memory telemetry, payload/caches/replay bounds, and emergency degradation first.
2. **Phase 1: Stop new hot-path bloat.** Disable or gate detailed telemetry and bound reliability output payloads.
3. **Phase 2: Move heavy maintenance to jobs/workers.** Retention, pruning, archive inspection, exports.
4. **Phase 3+: Worker isolation.** Move agent/runtime work behind resource-protected workers.

Full process isolation is important, but the current OOM can recur before that architecture exists. The next implementation should prioritize bounded hot paths and self-observability.

## Open Questions

- Which route or UI interaction was active during the final heap climb?
- Did the browser repeatedly reconnect SSE/event streams?
- How many trace cache entries were present near OOM?
- Was the gateway serving old 1.6 trace code or the local fixed branch?
- Which `pibo.output` event types must remain in reliability storage, and which can be summarized?

## Proposed Release Gates

Before the next release that claims to fix this class of issue:

- [ ] Large problem sessions open without trace responses over a low-MB budget.
- [ ] Trace cache has byte/count limits and high-memory eviction.
- [ ] Reliability event payloads over a threshold are stored by reference or preview only.
- [ ] Gateway exposes memory/cache/listener/store metrics.
- [ ] A synthetic large-output workload does not grow gateway heap without bound.
- [ ] Unsupported Node versions produce a clear startup warning or failure.
