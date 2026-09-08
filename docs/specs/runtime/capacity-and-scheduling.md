---
type: "Specification"
title: "Runtime Capacity and Durable Message Scheduling"
description: "Defines bounded durable admission, room fairness, cold-start and provider reservations, and capacity diagnostics."
tags: ["runtime", "capacity", "performance", "admission"]
status: "stable"
authority: "normative"
generated: { by: "openai/codex", at: "2026-09-08T17:55:23Z" }
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "800bb6ec5dd0b13b64c6333719ac1a88239d1462"
  requirements:
    - id: "RUN-CAP-001"
      status: "implemented"
      sources:
        - path: "src/data/message-command-store.ts"
          symbol: "MessageCommandStore"
        - path: "src/data/bounded-worker-client.ts"
          symbol: "BoundedWorkerClient"
      tests:
        - path: "test/message-command-store.test.mjs"
          name: "room rotation and database-wide slots preserve control capacity across dispatch owners"
        - path: "test/storage-worker-isolation.test.mjs"
          name: "storage fairness remembers Rooms across drained bursts without delaying control work"
      failures:
        - "Overload rejects before a new accepted event; explicit cancellation fences unstarted claims and preserves dispatched ownership."
      confidence: "high"
    - id: "RUN-CAP-002"
      status: "implemented"
      sources:
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
      tests:
        - path: "test/runtime-routed-session.test.mjs"
          name: "cold-start ramps remain bounded across rooms and do not activate historical sessions"
        - path: "test/runtime-routed-session.test.mjs"
          name: "bounded active runtime pool evicts idle generations and can reopen their durable sessions"
        - path: "test/runtime-routed-session.test.mjs"
          name: "abort acknowledges a blocked cold start before adapter initialization settles"
      failures:
        - "Queue capacity and wait deadlines fail explicitly; an already-opening adapter is cleaned up when it returns, not forcibly interrupted in process."
      confidence: "high"
    - id: "RUN-CAP-003"
      status: "implemented"
      sources:
        - path: "src/core/provider-capacity.ts"
          symbol: "createProviderCapacityExtension"
        - path: "src/core/runtime-capacity.ts"
          symbol: "RuntimeCapacity"
      tests:
        - path: "test/runtime-capacity.test.mjs"
          name: "Pi releases the provider request before tools and reacquires for the next round"
        - path: "test/runtime-capacity.test.mjs"
          name: "Pi capacity failure aborts explicitly because extension handler errors alone do not stop HTTP"
        - path: "test/runtime-capacity.test.mjs"
          name: "nested provider work retains slots when parent turns occupy their entire budget"
      failures:
        - "Provider-hook refusal explicitly aborts Pi; conservative non-Pi reservations do not establish SDK-internal request isolation."
      confidence: "high"
    - id: "RUN-CAP-004"
      status: "implemented"
      sources:
        - path: "src/core/session-router.ts"
          symbol: "getRuntimeCapacityStatus"
        - path: "src/data/message-command-store.ts"
          symbol: "queueStatus"
      tests:
        - path: "test/message-command-store.test.mjs"
          name: "receipt polling retains an older active turn after a long stream of terminal steering receipts"
        - path: "test/runtime-routed-session.test.mjs"
          name: "queue clear persists the same ingress-plus-runtime count that its caller receives"
        - path: "test/web-channel.test.mjs"
          name: "clear_queue cancels undispatched durable receipts without cancelling an initializing message"
      failures:
        - "Receipt queries remain Session-authorized and bounded; adapter-owned timing components are labeled as combined measurements."
      confidence: "high"
    - id: "RUN-CAP-005"
      status: "implemented"
      sources:
        - path: "src/data/message-command-store.ts"
          symbol: "MessageCommandStore.health"
        - path: "src/data/chat-storage-worker.ts"
          symbol: "startupReconciliation"
      tests:
        - path: "test/message-command-store.test.mjs"
          name: "bounded startup reconciliation settles supported evidence, retains ambiguity, and exposes blocked successors"
        - path: "test/message-command-store.test.mjs"
          name: "byte and wait-age limits reject new work while preserving duplicate receipts and steering"
        - path: "test/message-command-store.test.mjs"
          name: "health summaries remain operationally bounded across large terminal history"
      public: ["durableMessageQueue", "command_reconciliation_required"]
      failures:
        - "Blocked successors do not contribute wait age, but still consume count and byte capacity until bounded startup policy terminalizes them."
        - "Health storage failure is ambiguous/degraded rather than healthy."
      confidence: "high"
---

# Scope

Own the resource budgets and dispatch policy between durable Chat admission, runtime creation, and provider execution. The [Composer contract](/specs/web/composer-delivery-files-and-media.md) owns HTTP receipt semantics; the [adapter contract](/specs/runtime/adapter-contract.md) owns runtime capabilities. These bounds are not a measured guarantee for every workload or adapter.

# Requirements and invariants

## Requirement: RUN-CAP-001

Normal durable commands are admitted only below all count, payload-byte and oldest-wait thresholds. An unchanged duplicate resolves its original receipt even when capacity is exhausted. Rejection commits no new accepted event. Already accepted records are retained, including explicit failure and uncertain-outcome records.

| Scope | Normal count | Normal bytes | Oldest accepted/unstarted wait |
|---|---:|---:|---:|
| Gateway database | 1,000 | 64 MiB | 60 minutes |
| Room | 256 | 16 MiB | 15 minutes |
| Session | 64 | 4 MiB | 10 minutes |

Steering uses a separate budget: 64 commands/4 MiB globally, 16/1 MiB per Room, four/1 MiB per Session, and a one-minute oldest-wait threshold. The existing one-MiB single-message limit still applies. These are pre-admission refusal thresholds, not deadlines that delete accepted messages.

SQLite transactions enforce at most ten normal claims and five per Room across dispatch owners, plus two Steering claims and one per Room. Persisted Room rotation and Session stream-order FIFO select candidates. Steering can bypass a normal active Turn; it cannot become a queued normal Turn. The predecessor query uses a covering Session/state/stream/delivery index so completed command history is not scanned for every claim. Schema v11 stores the dispatch clock and Room rotation state. Older readers that do not support this schema must refuse it.

Explicit admission wakes survive an in-flight empty claim. Persisted terminal output releases local ownership and wakes the next dispatch immediately; idle fallback polling is 50 ms, with a separate ten-second lease renewal cadence for the 30-second ownership lease. Storage failure backs polling off to one second and bounds warning frequency.

Storage RPC scheduling rotates Rooms within an aged priority class. Its bounded recent-Room history survives drained bursts. A one-millisecond idle admission window collects competing Room heads; control RPCs bypass that window. The Chat writer reserves eight of 128 pending entries and 256 KiB of its eight-MiB pending-byte budget for short control operations. General pressure therefore does not consume the entire control allowance. Count, byte and age limits remain enforced on every priority. One RPC is in flight; existing output durability and uncertainty rules remain authoritative.

`clear_queue` cancels accepted/unstarted durable commands before invoking the runtime action, fences their claims and includes them in the cleared count before output emission, so the returned result and persisted/live command output agree. It does not relabel an initializing or running command as never dispatched. Runtime queue admission also checks 64 waiting messages, four MiB aggregate text, a one-MiB message limit and ten-minute oldest wait before its acceptance callback.

## Requirement: RUN-CAP-002

Each router deduplicates starts per Session and defaults to two concurrent cold starts, one per Room. A bounded room-round-robin wait queue defaults to 64 entries and a 60-second capacity-wait deadline. No historical Sessions are prewarmed.

The active routed-runtime pool defaults to 32 entries. At capacity, creation can evict an idle generation after rechecking identity and runtime state; otherwise it fails explicitly before dispatch. Persisted Sessions and bindings survive eviction. A pending generation is not eligible for eviction. The existing idle timeout and bounded runtime disposal still apply.

Abort and clear-queue actions on an inactive runtime do not require a cold-start slot. Abort cancels its pending start reservation immediately. If the adapter was already opening, the result is acknowledged first and that generation is disposed when initialization returns, before message execution. An uncooperative adapter opening is not forcibly interrupted by this in-process mechanism; additional host isolation is a separate contract.

## Requirement: RUN-CAP-003

Provider capacity is separate from cold starts and the existing yielded-run resource guard. The default provider pool limit is ten with five per Room. Up to two global places and one Room place are reserved for nested Sessions, subject to leaving at least one ordinary place. Waiting work has count and time bounds, and cancellation removes a waiter without borrowing a running operation's permit. Idle provider keys are removed; at most 64 provider keys can be active.

For Pi, an extension acquires at `before_provider_request`, keyed by the actual model provider, and holds through the response stream. Assistant-message completion releases the slot before tool work. HTTP errors, abort and shutdown release it; a later round or retry reacquires. A rejected wait explicitly aborts Pi because merely throwing from an extension handler does not prevent its HTTP request.

Adapters without this Pi request hook use a conservative routed-prompt reservation, reacquired for each fallback attempt. A missing model provider uses the runtime-instance identity as its key; this does not prove provider-wide enforcement across instances with unknown provider identity. The conservative reservation can span tool work; nested-session capacity is reserved for the normal one-level delegation profile. Arbitrary nesting and SDK-internal parallel requests require separate adapter evidence.

## Requirement: RUN-CAP-004

The gateway status response includes active and initializing runtime counts, capacity limits, waiting counts/ages, provider reservations, and at most 32 recent initialization timing records. Timing phases separate binding/profile resolution, portable-history preparation, resources/tools, and adapter open/binding work. Adapter-owned auth and native-history work remain included in the adapter phase where no finer hook exists.

The authenticated Session receipt page includes queue count, bytes, oldest unstarted wait and Session limits. It preserves up to 70 active/uncertain receipts alongside 64 recent terminal receipts, so terminal Steering traffic cannot hide an older running Turn. Receipt contents stay compact and do not include message payloads.

## Requirement: RUN-CAP-005: FIFO barriers are explicit and isolated from wait-age overload

An interrupted normal predecessor is an explicit Session-scoped reconciliation barrier. New normal admission checks that barrier before committing and fails non-retryably. Existing unstarted normal successors are terminalized as failed/not-dispatched by bounded startup recovery while live owned claims are left untouched. Neither action weakens per-Session FIFO or executes an ambiguous command.

Global and Room oldest-wait calculations count only dispatchable accepted or waiting-slot commands. A successor blocked by an interrupted predecessor therefore cannot age into Room-wide or database-wide overload for unrelated Sessions. Genuine count, byte, and dispatchable wait-age exhaustion remains `command_overloaded` and retryable. Blocked rows continue to consume count and bytes until the explicit terminalization policy runs; this avoids hiding retained durable storage.

Durable queue health uses trigger-maintained state/delivery totals and bounded indexed operational reads. It separately reports interrupted predecessors, FIFO-blocked successors, dispatchable and blocked wait age, expired owned leases, global/Room/Session admission reasons, storage availability, affected command/Session/Room identities, and truncation metadata. It never reads message payload bodies or scans event history. Healthy dispatchable backlog remains distinct from a barrier. Storage timeout or unavailability is ambiguous/degraded.

# Configuration and compatibility

`PiboSessionRouterOptions.runtimeCapacity` supports cold starts, provider concurrency, per-Room provider concurrency, wait count/time and active-runtime capacity. Positive integer environment overrides are `PIBO_GATEWAY_MAX_COLD_STARTS`, `PIBO_GATEWAY_MAX_PROVIDER_TURNS`, `PIBO_GATEWAY_MAX_PROVIDER_TURNS_PER_ROOM`, `PIBO_GATEWAY_MAX_RUNTIME_WAITERS`, `PIBO_GATEWAY_MAX_RUNTIME_WAIT_MS`, and `PIBO_GATEWAY_MAX_ACTIVE_RUNTIMES`. Effective values appear in status. The provider environment names cover both Pi request permits and conservative adapter Turn permits.

Capacity rejection is explicit. A known pre-dispatch refusal becomes a failed durable receipt; an unclear dispatch result stays interrupted and requires reconciliation. Changing a resource limit does not establish a larger accepted capacity profile. Maintenance budgets and retention are owned by their respective maintenance contracts, and production cleanup is not enabled by this feature.
