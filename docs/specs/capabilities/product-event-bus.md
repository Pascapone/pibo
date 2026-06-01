# Spec: Product Event Bus

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Channel Runtime Context](./channel-runtime-context.md), [Context Files](./context-files.md)

## Why

Pibo plugins need a lightweight way to announce product-level changes that are not runtime transcript output. Context Files uses this path to refresh browser views after web edits, external file changes, source adoption, and revision changes. Without a clear contract, plugins could confuse product events with routed session output or expose inconsistent live-update behavior through web apps.

## Goal

Define the behavior of the in-process product event bus that plugins, gateway channel context, and web apps use to emit and subscribe to product-level state changes.

## Background / Current State

The plugin registry stores product event listeners in memory. A product event contains a `type`, `source`, optional `actorId`, JSON object `payload`, and registry-supplied `id` and `createdAt` defaults. Gateway channel context exposes `emitProductEvent` and `subscribeProductEvents` to channels and web apps.

The Context Files app is the current concrete consumer. It emits `context-file.*` events for web actions and filesystem polling, exposes them over `/api/context-files/events` as `pibo-product` SSE frames, sends a ready frame when the SSE stream opens, filters events by prefix, and sends heartbeat comments while connected.

## Scope

### In Scope

- In-process product event emission and listener notification.
- Event identity, timestamp, source, actor, and payload contracts.
- Channel context exposure of product-event emission and subscription.
- Context Files product-event filtering and SSE projection behavior.
- Listener failure containment.

### Out of Scope

- Durable product-event storage — current code keeps this bus in memory only.
- Runtime `PiboOutputEvent` delivery — that remains the session router and gateway event contract.
- Cross-process event fan-out — current behavior does not synchronize product events across gateway processes.
- A global taxonomy for every future product event type — this spec defines the shared bus and the current Context Files namespace.

## Requirements

### Requirement: Product events are product-level, not routed session output

The system MUST use product events for product state changes that are not normalized runtime output events.

#### Current

`PiboPluginRegistry` keeps separate listener sets for runtime output events and product events. `notifyEvent` handles `PiboOutputEvent`, while `emitProductEvent` handles `PiboProductEventInput`.

#### Target

Consumers can subscribe to product state changes without receiving assistant messages, tool events, or thinking events from routed sessions.

#### Acceptance

- Emitting a product event notifies only product-event listeners.
- Notifying a runtime output event notifies only runtime event listeners.
- Product-event payloads do not require a Pibo Session ID unless a specific event namespace defines one.

#### Scenario: Context file update does not enter the transcript

- GIVEN a Context Files web request saves a managed context file
- WHEN the service emits `context-file.updated`
- THEN context-file subscribers receive a product event
- AND no routed session output event is emitted for that save.

### Requirement: Event identity and timestamps are completed by the registry

The system MUST return a complete product event from each emission, assigning an id and creation timestamp when the caller does not provide them.

#### Current

`emitProductEvent` copies the input and defaults `id` to `randomUUID()` and `createdAt` to the current ISO timestamp.

#### Target

Emitters may provide deterministic ids and timestamps for replay-like use cases, but ordinary emitters can omit both fields and still produce complete events.

#### Acceptance

- A product event emitted without `id` returns an event with a non-empty id.
- A product event emitted without `createdAt` returns an event with an ISO timestamp string.
- A product event emitted with explicit `id` or `createdAt` preserves those values.

#### Scenario: Web mutation emits a complete event

- GIVEN a web app emits `context-file.created` with source `web` and a payload
- WHEN the registry accepts the event
- THEN the returned event includes the same type, source, payload, generated id, and generated `createdAt`.

### Requirement: Event sources are bounded

The system MUST classify product-event producers with one of the supported source values: `core`, `plugin`, `web`, `filesystem`, or `agent`.

#### Current

`PiboProductEventSource` is a TypeScript union with those five values. Context Files currently emits `web`, `filesystem`, and `plugin` ready events.

#### Target

Product-event consumers can make source-aware decisions without parsing free-form producer names.

#### Acceptance

- Type-level contracts reject arbitrary source names in TypeScript callers.
- Context Files browser clients can ignore self-originated `web` events when local editor state already reflects the change.
- Filesystem polling events use source `filesystem`.

#### Scenario: Browser ignores its own save event

- GIVEN a Context Files browser tab saves a file through the web API
- WHEN it receives the resulting `context-file.updated` SSE frame with source `web`
- THEN it refreshes file lists as needed
- AND does not overwrite the editor from that self-originated event.

### Requirement: Channel context exposes product events without exposing the registry

The system MUST expose product-event emission and subscription through `PiboChannelContext` so web apps and channels can use the bus without owning the plugin registry.

#### Current

Gateway server channel context maps `emitProductEvent` to `pluginRegistry.emitProductEvent` and `subscribeProductEvents` to `pluginRegistry.onProductEvent`.

#### Target

A web app receives enough context to publish and subscribe to product events, while registry stewardship and listener storage stay inside the gateway boundary.

#### Acceptance

- Started gateway channels receive optional `emitProductEvent` and `subscribeProductEvents` functions.
- A subscriber receives future product events until it calls the returned unsubscribe function.
- Unsubscribed listeners do not receive later product events.

#### Scenario: SSE stream unregisters on disconnect

- GIVEN a browser opens `/api/context-files/events`
- WHEN the stream starts
- THEN the web app subscribes to product events through channel context
- WHEN the stream is cancelled
- THEN the subscription is removed.

### Requirement: Listener failures are contained

The system MUST continue notifying remaining listeners when one product-event listener throws, and MUST record the listener error for diagnostics.

#### Current

`emitProductEvent` catches listener exceptions and appends the message to the registry `eventErrors` list.

#### Target

One broken plugin or web-app subscriber cannot prevent other product-event consumers from receiving the same event.

#### Acceptance

- If a product-event listener throws, `emitProductEvent` still returns the emitted event.
- Later listeners registered in the same registry still run.
- The registry diagnostic error list includes the thrown error message.

#### Scenario: Faulty listener does not block context-file updates

- GIVEN two product-event listeners are registered
- AND the first listener throws for `context-file.external_updated`
- WHEN the event is emitted
- THEN the second listener still receives the event
- AND the registry records the first listener's error.

### Requirement: Context Files exposes a namespaced SSE projection

The Context Files app MUST expose only context-file product events over its event stream and MUST format them as Server-Sent Events named `pibo-product`.

#### Current

The Context Files event stream sends a `context-file.ready` frame, subscribes to product events, filters events whose type starts with `context-file.`, writes matching events as `event: pibo-product` with the product event id, and sends heartbeat comments every 25 seconds.

#### Target

Browser clients receive live context-file state changes without seeing unrelated product events or requiring polling for normal web edits.

#### Acceptance

- Opening the stream returns `text/event-stream; charset=utf-8` with no-cache headers.
- The stream sends an initial `pibo-product` frame with type `context-file.ready`.
- Events outside the `context-file.` namespace are not written to the stream.
- Matching events use the product event id as the SSE id when present.
- Heartbeat comments keep long-lived connections active.

#### Scenario: Non-context event is filtered

- GIVEN a Context Files SSE stream is open
- WHEN the registry emits `custom-agent.updated`
- THEN the stream does not send that event
- WHEN the registry emits `context-file.metadata_updated`
- THEN the stream sends one `pibo-product` frame for it.

### Requirement: Filesystem polling emits state-change events only on observed changes

The Context Files watcher MUST emit filesystem-sourced product events only when a tracked context file snapshot changes.

#### Current

The watcher records snapshots from listed context files, polls every second, compares existence, version, update time, bytes, link state, source hash, and active revision id, and emits either `context-file.external_updated` or `context-file.source_orphaned`.

#### Target

Browsers learn about external file changes without receiving a continuous stream of unchanged-state events.

#### Acceptance

- Starting the watcher seeds snapshots without emitting changes for existing state.
- A changed managed or plugin-backed file snapshot emits `context-file.external_updated`.
- A transition into orphaned source state emits `context-file.source_orphaned`.
- Unchanged snapshots emit no event.

#### Scenario: Plugin source disappears

- GIVEN a managed context file is linked to a plugin source
- AND the previous link state was not `orphaned`
- WHEN polling observes that the source is now orphaned
- THEN the watcher emits `context-file.source_orphaned` with source `filesystem`.

## Edge Cases

- Product event delivery is best-effort and in-process; gateway restart drops listeners and undelivered events.
- Event payloads must be JSON objects; binary content or full file bodies should stay out of product events.
- Browser clients must tolerate SSE disconnects and reload state from HTTP APIs.
- The ready SSE frame is not emitted through the registry and may not include a registry id.
- Listener error storage is diagnostic only; it does not retry failed listeners.

## Constraints

- **Compatibility:** Existing Context Files clients expect `pibo-product` SSE event names and `context-file.*` payloads.
- **Security / Privacy:** Web apps must expose product events only through authenticated same-origin routes when the app requires authentication. Event payloads should include metadata needed for refresh, not secret file contents.
- **Performance:** Product-event listeners run synchronously during emission; handlers should remain bounded and defer expensive work.
- **Dependencies:** The current bus depends on the plugin registry instance and gateway channel context. It does not depend on the reliable event core.

## Success Criteria

- [ ] SC-001: Unit tests or registry-level checks verify id/timestamp defaulting and preservation.
- [ ] SC-002: Unit tests verify product-event listener unsubscribe and failure containment.
- [ ] SC-003: Context Files event-stream tests verify ready frames, namespace filtering, SSE ids, and heartbeat behavior.
- [ ] SC-004: Context Files watcher tests verify unchanged snapshots do not emit and changed/orphaned snapshots emit the expected event types.
- [ ] SC-005: Documentation and tests keep product events distinct from `PiboOutputEvent` routing.

## Assumptions and Open Questions

### Assumptions

- The product event bus is intentionally local to one gateway process for now.
- Context Files remains the first concrete namespace and should not force a broader durable event taxonomy.
- Future product-event namespaces will define their own payload schemas before exposing browser streams.

### Open Questions

- Should product events eventually mirror into the Reliable Event Core for replay or debugging?
- Should registry diagnostics expose product-event listener errors separately from runtime output listener errors?
- Should there be a central event-type naming convention beyond prefix namespacing?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Product events are product-level, not routed session output | Context file update does not enter the transcript | Add registry separation test | Pending |
| REQ-002 Event identity and timestamps are completed by the registry | Web mutation emits a complete event | Add event defaulting test | Pending |
| REQ-003 Event sources are bounded | Browser ignores its own save event | Add Context Files browser/SSE behavior test | Pending |
| REQ-004 Channel context exposes product events without exposing the registry | SSE stream unregisters on disconnect | Add channel context subscription test | Pending |
| REQ-005 Listener failures are contained | Faulty listener does not block context-file updates | Add failure containment test | Pending |
| REQ-006 Context Files exposes a namespaced SSE projection | Non-context event is filtered | Add event-stream test | Pending |
| REQ-007 Filesystem polling emits state-change events only on observed changes | Plugin source disappears | Add watcher polling test | Pending |

## Verification Basis

This spec is based on the current source code in:

- `src/plugins/types.ts`
- `src/plugins/registry.ts`
- `src/channels/types.ts`
- `src/gateway/server.ts`
- `src/plugins/context-files.ts`
- `src/apps/context-files-ui/src/main.tsx`
- `src/apps/chat-ui/src/context/ContextFilesView.tsx`
