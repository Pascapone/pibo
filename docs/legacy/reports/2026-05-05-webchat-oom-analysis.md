# Webchat OOM Analysis Report

Date: 2026-05-05
Re-analysis: 2026-05-05
System: Pibo Web Gateway on `pibo.neuralnexus.me`
Host: configured production host
Service: `pibo-web.service`

## Summary

The original outage was caused by memory exhaustion on the server. The kernel OOM killer terminated a process inside the `pibo-web.service` cgroup. The immediate operational factor was a small host with about 3.8 GiB RAM and originally no swap. The underlying product issue remains credible: unbounded Chat Web event growth, durable mirroring of high-volume deltas into multiple stores, and expensive trace reconstruction that still loads all stored events for a selected session into memory.

A new read-only review of the current code and local Pibo stores shows that the system has changed, but not in a way that removes the root cause:

- Chat Web now has more sessions, rooms, events, and larger databases than in the original report.
- `thinking_delta` and `assistant_delta` still dominate the event volume.
- Each output event is still written into the Chat Event Log, the Chat Web Read Model, and the `pibo.output` topic in the Pibo Reliability Store.
- The Chat Event Log still has retention support in code, but no `chat_retention_policies` rows are configured in the inspected store.
- The trace endpoint still calls `listAllEvents(...)` for the selected Pibo Session before building the Chat Web Trace View.
- The server-side trace cache still keeps up to 128 trace views.

The original operational mitigation remains only a mitigation: reboot plus swap restored availability and reduces crash likelihood, but it does not bound product-level memory or storage growth.

## Re-analysis Scope and Limitations

This re-analysis used:

- current repository code under `/root/code/pibo`
- local Pibo SQLite stores under `/root/.pibo`
- the Pibo Debug CLI for reliability-store inspection where possible
- direct read-only SQLite inspection via Node's `node:sqlite`

Limitations:

- SSH access to the configured production host failed, so current production `systemd`, kernel, cgroup, and process memory state could not be rechecked directly.
- The database numbers below are from the locally available `/root/.pibo` stores in this environment. They appear to be the same class of live Pibo stores used by the original analysis, but they should be confirmed on the production host when SSH access is available.
- No product code was changed as part of this analysis.

## Confirmed Original Incident Evidence

### Kernel OOM evidence

Previous-boot kernel logs showed:

- OOM kill inside `task_memcg=/system.slice/pibo-web.service`
- killed process name `MainThread`
- `total-vm:2019688kB`
- `anon-rss:669376kB`

This directly tied the original outage to the Pibo web service.

### Service state after original reboot

Observed after the original reboot:

- `pibo-web.service` active and running
- `nginx.service` active and running
- `https://pibo.neuralnexus.me/apps/chat` returned HTTP 200
- host memory: about 3.8 GiB RAM
- original swap before mitigation: `0B`

### Host hardening previously applied

Mitigation applied on the server:

- created `/swapfile`
- enabled 4 GiB swap
- added swap entry to `/etc/fstab`
- set `vm.swappiness=10`

This reduces the chance of a full host outage during future memory spikes, but it does not remove the product-level growth pattern.

## Current Data Findings

### 1. Chat Web event volume has grown further

Current local database sizes:

- `/root/.pibo/web-chat.sqlite`: about 1.3 GiB
- `/root/.pibo/pibo-events.sqlite`: about 722 MiB

Original report sizes:

- `/root/.pibo/web-chat.sqlite`: about 1.2 GiB
- `/root/.pibo/pibo-events.sqlite`: about 644 MiB

Current counts in `web-chat.sqlite`:

- `web_chat_events`: 759,703 rows
- `chat_events`: 760,001 rows
- `web_chat_sessions`: 73 rows
- `pibo_rooms`: 4 rows
- `chat_retention_policies`: 0 rows

Original counts:

- `web_chat_events`: 704,773 rows
- `chat_events`: 705,010 rows
- `web_chat_sessions`: 57 rows
- `pibo_rooms`: 3 rows
- `chat_retention_policies`: 0 rows

The store has therefore grown by roughly:

- +54,930 `web_chat_events`
- +54,991 `chat_events`
- +16 indexed Chat Web sessions
- +1 room

This confirms ongoing growth after the original incident.

### 2. Delta events still dominate storage

Current top event types in `web_chat_events`:

- `thinking_delta`: 616,877
- `assistant_delta`: 109,676
- `tool_call`: 8,329
- `tool_execution_updated`: 8,049
- `tool_execution_started`: 4,163
- `tool_execution_finished`: 4,130
- `thinking_started`: 3,432
- `thinking_finished`: 3,426
- `assistant_message`: 512
- `message_queued`: 396

Current delta total:

- `thinking_delta` + `assistant_delta`: 726,553 rows
- share of `web_chat_events`: about 95.6%

This is essentially the same failure shape as before: durable storage is overwhelmingly made up of streaming deltas rather than final user-facing messages.

### 3. The Chat Event Log retention classes are also delta-heavy

Current `chat_events` retention class counts:

- `live_delta`: 726,664
- `trace_event`: 32,062
- `chat_message`: 1,399

This means the Chat Event Log is mostly storing live delta frames. These are useful for live streaming/resume/debugging, but they are the least safe class to retain indefinitely.

### 4. The Pibo Reliability Store has also grown

Current `pibo-events.sqlite` observations:

- `pibo_event_stream`: about 1.027 million rows during inspection
- `pibo.output`: effectively all rows in the stream
- `pibo_event_consumers`: 0 rows

Current retention classes in `pibo_event_stream`:

- `live_delta`: about 984,420
- `trace_event`: about 41,513
- `chat_message`: about 1,422

The exact total and grouped counts shifted slightly between queries, which is consistent with concurrent writes while the store was being inspected. The important point is stable: almost all Pibo Reliability Store rows are still `pibo.output`, and most of those are `live_delta`.

No consumer offsets were present in `pibo_event_consumers`, so non-destructive retention based on consumer progress has no useful floor to preserve against. Manual or policy-driven pruning therefore needs explicit semantics for this topic.

### 5. Large sessions still exist

Current top `web_chat_events` session counts:

- `ps_ba80c22c-9d5a-48b2-a20d-ecac521182c7`: 63,934
- `ps_164ce23a-ef32-466e-879e-c72461bf1ce1`: 53,130
- `ps_6369ed3f-4b61-4f84-846f-465da4b0e48a`: 53,081
- `ps_09011451-48a2-42ff-ab87-a95bfc151853`: 51,097
- `ps_b0012c63-9f7d-428d-9a48-73640d6c7165`: 44,415
- `ps_b5b20423-e41c-48be-8149-ff5358a3835f`: 43,070
- `ps_12510775-5822-4205-a03f-0b93928fed76`: 38,734
- `ps_afc3c320-6bef-45e0-8392-a8ede837df7b`: 35,539
- `ps_a6c4e5a5-cb2d-408b-9a4e-afc7156c6933`: 34,518
- `ps_fbd52e8d-55fa-4ce2-a947-55e64331675a`: 31,653

The largest session is unchanged from the original report at 63,934 events, but there are now more sessions overall and multiple sessions remain in the 30k-53k range.

## Current Code Findings

### 1. Output events are still triply persisted

In `src/apps/chat/web-app.ts`, `ensureEventIndexing(...)` still subscribes to `context.channelContext` output events and writes each event to three places:

1. `state.eventLog.appendOutputEvent(...)` → `chat_events`
2. `state.readModel.recordEvent(...)` → `web_chat_events`
3. `state.reliabilityStore.append(...)` → `pibo_event_stream`, topic `pibo.output`

The retention classifier still maps `assistant_delta` and `thinking_delta` to `live_delta` for the reliability store.

This means the ingestion multiplier described in the original report is still present.

### 2. Chat Event Log retention exists but is not active by default

`src/apps/chat/event-log.ts` still provides:

- `chat_retention_policies`
- `upsertRetentionPolicy(...)`
- `getRetentionPolicy(...)`
- `purgeExpired(...)`

But the inspected store has:

- `chat_retention_policies`: 0 rows

Also, no current runtime call path was found that automatically installs a default policy and periodically executes `purgeExpired(...)` inside the Chat Web runtime.

So the schema supports retention, but the observed runtime state is still effectively unbounded.

### 3. The Chat Web Read Model has no retention path for raw Pibo events

`src/apps/chat/read-model.ts` still records every output event into `web_chat_events` via `recordEvent(...)`.

It supports:

- listing latest events with `listEvents(...)`
- listing all events for a session with `listAllEvents(...)`
- deleting entire sessions with `deleteSessions(...)`

But it does not expose an age/class-based purge path for `web_chat_events`. Since `web_chat_events` does not store `retention_class`, raw delta pruning would need either event-type pruning or a migration/classification strategy.

### 4. `/api/chat/trace` still loads full session event history

In `src/apps/chat/web-app.ts`, the `/api/chat/trace` handler still does:

- calculate a compact version from the latest event sequence and latest stream id
- check ETag / 304
- check the server-side trace cache
- if there is no cache hit, call `state.readModel.listAllEvents(selectedSession.id)`
- pass the full event array into `buildTraceView(...)`

`src/apps/chat/trace.ts` then reads Pi session transcript entries and calls `buildTraceViewFromEvents(...)` with the full event array.

This means the server-side memory risk remains: a trace cache miss for a large session still materializes all stored raw Pibo events for that session before building the trace.

### 5. Raw event response limits do not bound trace-build memory

The `/api/chat/trace` endpoint parses `rawEventsLimit` with a maximum of 1,000. The Chat UI currently asks for `includeRawEvents=true&rawEventsLimit=10000`, but the server clamps that to 1,000.

That helps bound the number of raw events returned to the browser. It does not bound server-side trace construction, because the server still calls `listAllEvents(...)` first and builds the trace from all events.

### 6. Client-side trace behavior has changed but does not solve the server OOM path

The Chat UI now uses raw trace events and live `RAW_EVENT` stream frames to rebuild a selected trace view client-side with `buildTraceViewFromEvents(...)`.

This may reduce some repeated server trace fetches during live updates, but it introduces a separate consideration:

- the initial server trace response still requires full-history server reconstruction on cache miss
- browser-side reconstruction is bounded by the raw events retained in the query data, not by the full server store
- React Query keeps trace data for 30 minutes (`TRACE_GC_TIME_MS`)

This is relevant to browser memory and UI correctness, but it does not remove the backend OOM risk from full-history server trace builds.

### 7. Server-side trace cache still has memory risk

`TRACE_CACHE_MAX_ENTRIES` remains 128.

The cache key includes:

- Pibo Session ID
- trace version
- raw/compact mode
- raw events limit

Large trace views can therefore remain retained in the long-lived Node process. ETag handling and cache hits help avoid repeated rebuild work, but a high cardinality of sessions/versions/options can still hold many trace objects in memory.

### 8. Reliability-store pruning exists as an operator tool, not automatic runtime cleanup

`src/reliability/store.ts` exposes `prune(...)`, and the Debug CLI exposes:

- `pibo debug events stats`
- `pibo debug events prune --topic ... --retention ... --before ...`

This is useful for operator cleanup. It is not the same as automatic product retention. The inspected runtime still mirrors all output events into `pibo.output` without an observed automatic pruning loop.

## Updated Likely Cause Chain

The most likely sequence is still:

1. Long or active Chat Web sessions produce very large numbers of `thinking_delta` and `assistant_delta` events.
2. Those events are persisted repeatedly across the Chat Event Log, Chat Web Read Model, and Pibo Reliability Store.
3. No active default retention policy removes high-volume `live_delta` data from the inspected Chat Event Log.
4. The Chat Web Read Model keeps raw Pibo events without age/class-based pruning.
5. The Pibo Reliability Store mirrors the same high-volume delta stream into `pibo.output`, with no consumer offsets observed and no automatic pruning observed.
6. Large session traces are rebuilt from full session history on server cache miss.
7. The server-side trace cache can retain large trace views.
8. On a small host, especially under repeated trace access or active session growth, anonymous JS heap plus SQLite/file-cache pressure can again push the host toward severe memory pressure or OOM.

The new data strengthens the original conclusion because the stores have grown further while the same structural risk areas remain.

## What Has Improved or Changed

Observed changes since the original report:

- More Chat Web sessions and rooms exist.
- The stores are larger.
- The Debug CLI has usable reliability event stats/prune commands.
- The Chat UI appears to do more client-side trace patching/reconstruction from raw events and live stream frames.
- The trace endpoint uses ETag/versioning and server-side cache checks before rebuilding.
- Raw events returned to the browser are server-clamped to at most 1,000 even if the UI asks for 10,000.

These changes may improve UX, observability, and some repeated fetch behavior, but they do not address the central backend memory/storage amplification.

## What Is Still Not Fixed

The underlying issue remains:

- event growth is still structurally unbounded in the inspected runtime state
- delta events still dominate storage volume
- every output event is still mirrored into multiple durable stores
- Chat Event Log retention has no configured policy rows in the inspected store
- Chat Web Read Model raw events have no retention class and no age/class purge path
- `/api/chat/trace` still loads full session event history into memory on cache miss
- server-side trace cache can still retain many large trace views
- Pibo Reliability Store `pibo.output` still accumulates `live_delta` rows

Swap makes the system more tolerant of spikes, but it does not change the growth curve.

## Recommended Next Steps

### Immediate product fixes

1. Stop durably storing every `thinking_delta` and `assistant_delta` in all three stores.
2. Decide which store is authoritative for each event class:
   - Chat Event Log for user-visible/resumable room events
   - Chat Web Read Model for projection/debug data only
   - Pibo Reliability Store for operational replay only when there is a consumer/retention contract
3. Add and install a default Chat Event Log retention policy for `live_delta`.
4. Execute Chat Event Log retention automatically in the web runtime with small bounded batches.
5. Add an explicit retention/pruning story for `web_chat_events`, especially `assistant_delta` and `thinking_delta`.
6. Add an explicit retention/pruning story for `pibo.output` `live_delta` rows.
7. Change `/api/chat/trace` so cache misses do not require loading every raw event for large sessions.
8. Reduce or redesign the server-side trace cache, ideally with memory-aware sizing instead of entry-count-only sizing.

### Immediate operational cleanup

1. Confirm current production DB counts directly on the configured production host once SSH access is available.
2. Prune old `live_delta` rows from `pibo_event_stream` where product/replay requirements allow it.
3. Prune old `live_delta` rows from `chat_events` where stream resume requirements allow it.
4. Plan a safe cleanup strategy for `web_chat_events`, because it currently has no retention class column.
5. Consider SQLite `VACUUM` or `VACUUM INTO` after cleanup, with downtime or careful disk-space planning.

### Capacity recommendation

The current workload remains risky for a 4 GiB host. Even with 4 GiB swap, the safer medium-term option is either:

- reduce event/storage/memory amplification in the product, or
- move the service to a larger machine,

preferably both.

## Final Assessment

The original outage was not a random crash. The re-analysis confirms the same coherent failure mode is still present:

- high-volume delta generation
- repeated durable mirroring of those deltas
- no active retention in the inspected Chat Event Log
- no raw-event retention path in the Chat Web Read Model
- growing Pibo Reliability Store `pibo.output` backlog
- expensive full-history server trace reconstruction
- server-side caching of potentially large trace views
- small host memory envelope

The situation has likely worsened in storage terms because the event stores are larger than before. Some UI/cache behavior has changed, but the backend root cause has not been eliminated.
