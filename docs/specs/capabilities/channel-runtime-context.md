# Spec: Channel Runtime Context

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-17  
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Pibo Session Routing](./pibo-session-routing.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md)

## Why

Channels are Pibo's transport adapters. They let web, local, messaging, and custom front ends talk to routed runtimes without reaching through to Pi Coding Agent directly.

The channel boundary needs its own behavior contract because it joins several product systems: plugin registration, auth services, session storage, runtime routing, signal snapshots, dynamic profiles, context files, skills, product events, and registered web apps. A channel must receive enough authority to serve its transport, but not bypass Pibo-owned routing and ownership rules.

## Goal

The gateway MUST start plugin-registered channels with a single Pibo-owned channel context that routes runtime work, session mutations, catalog reads, auth, signals, yielded-run inspection, Ralph stop-condition discovery, product events, and web-app discovery through the product boundary.

## Background / Current State

`PiboGatewayServer` creates a plugin registry, session store, and `PiboSessionRouter` during startup. It validates channel auth requirements, starts the configured auth service, listens on the gateway socket, then starts each plugin channel with a `PiboChannelContext`.

The context exposes router operations (`emit`, `subscribe`, status, signals, yielded-run snapshots), session-store operations, plugin-registry catalog and mutation operations, Ralph stop-condition discovery, the selected auth service, and registered web apps. When a channel creates a session, the gateway resolves profile aliases and freezes the active model from the profile and local model defaults before the session is stored.

## Scope

### In Scope

- Plugin channel lifecycle under the gateway server.
- Channel auth-mode validation before startup.
- The runtime/session/catalog/signal/run-control/Ralph/auth/web-app operations exposed through `PiboChannelContext`.
- Session creation behavior performed on behalf of channels.
- Shutdown ordering for started channels and gateway-owned services.

### Out of Scope

- Transport-specific wire protocols such as TCP frames or HTTP request routing — covered by gateway and web-host specs.
- Runtime internals after a routed session receives an input event.
- UI behavior inside registered web apps.
- External auth provider internals.

## Requirements

### Requirement: Required-auth channels start only with an auth service

The gateway MUST reject startup when any registered channel declares `auth.mode = "required"` and the plugin registry has no auth service.

#### Current

`PiboGatewayServer.validateChannels` checks registered channels before creating a listening server. The gateway starts the registry auth service before channel startup.

#### Acceptance

- A required-auth channel without an auth service fails gateway startup with a clear channel name in the error.
- A required-auth channel with an auth service can start.
- A channel with `auth.mode = "none"` can start, but startup logs a warning.

#### Scenario: Required web channel without auth

- GIVEN a plugin registers a web channel with `auth.mode = "required"`
- AND no plugin registers an auth service
- WHEN the gateway starts
- THEN startup fails before the channel receives a context

### Requirement: Channels start after router and session store are ready

The gateway MUST start channels only after the session store, session router, auth service, and listening gateway server are initialized.

#### Current

Startup creates the session store and router, subscribes gateway broadcasts to router output, starts the auth service, opens the TCP server, and only then calls `channel.start(context)` for each registered channel unless `startChannels` is disabled.

#### Acceptance

- During `channel.start`, `context.createSession`, `context.emit`, and catalog read methods are usable.
- If `startChannels` is false, registered channels are not started.
- Started channels are tracked so shutdown only calls `stop` on channels that actually started.

#### Scenario: Channel creates a session during startup

- GIVEN a plugin channel creates a Pibo Session from its `start` method
- WHEN the gateway starts successfully
- THEN the session is stored through the gateway session store
- AND the session profile has been resolved to its canonical profile name

### Requirement: Channel context routes input through the session router

The channel context MUST submit user and execution input events through the `PiboSessionRouter` and expose router output subscriptions without exposing Pi Coding Agent directly.

#### Current

`context.emit` delegates to `router.emit`. `context.subscribe` delegates to `router.subscribe`. Runtime status and signal snapshots also delegate to router-owned registries.

#### Acceptance

- A channel-submitted message input is queued by the routed Pibo Session identified by `piboSessionId`.
- A channel-submitted execution input returns the router action result for the addressed session.
- A channel subscription receives normalized Pibo output events, not provider-native events.

#### Scenario: Channel sends a message

- GIVEN a channel has a valid Pibo Session ID
- WHEN it calls `context.emit` with a message event
- THEN the router handles the message for that session
- AND the returned output event is scoped to the same Pibo Session ID

### Requirement: Channel-created sessions resolve profile and active model once

When a channel creates a session, the gateway MUST resolve profile aliases to a canonical profile and persist an active model chosen from explicit input or current model defaults.

#### Current

`createChannelContext().createSession` resolves `input.profile` through the plugin registry, creates that profile context, and sets `activeModel` to `input.activeModel` or `selectRequestedModelProfile(profileContext, loadPiboModelDefaults())`.

#### Acceptance

- Creating a session with a profile alias stores the canonical profile name.
- Creating a session with `activeModel` preserves that model exactly.
- Creating a session without `activeModel` stores the model selected from the resolved profile and current model defaults when a model is available.

#### Scenario: Alias profile is canonicalized

- GIVEN the registry maps alias `codex` to `codex-compat-openai-web`
- WHEN a channel creates a session with profile `codex`
- THEN the stored session profile is `codex-compat-openai-web`

### Requirement: Channel context exposes product catalogs without activating resources

The channel context MUST let channels inspect gateway actions, profiles, capability catalog entries, auth service, and web apps without activating runtime resources by inspection alone.

#### Current

The context delegates `getGatewayActions`, `getProfiles`, `createProfile`, `getCapabilityCatalog`, `getRalphStopConditionDefinitions`, `getRalphStopConditionInfos`, `auth`, and `getWebApps` to the plugin registry. Runtime creation happens only when routed session work requires a runtime or a channel explicitly calls `createProfile`.

#### Acceptance

- Calling catalog read methods does not create or mutate a Pibo Session.
- Calling `getWebApps` returns registered app definitions for the host channel to dispatch.
- Gateway action, profile, capability, and Ralph stop-condition lists reflect the plugin registry's current state.

#### Scenario: Web host discovers apps

- GIVEN the web-host channel has started
- WHEN it calls `context.getWebApps()` for request routing
- THEN it receives the registered web apps without creating a runtime

### Requirement: Channel context exposes runtime status, run-control, and signal inspection

The context MUST let channels inspect routed runtime status, yielded-run snapshots, and signal trees through router-owned APIs without owning router internals.

#### Current

The context exposes `getSessionRuntimeStatus`, `listSessionRuntimeStatuses`, `listRuns`, `snapshotSignalSession`, `snapshotSignalTree`, and `subscribeSignalTree` as delegates to the gateway-owned `PiboSessionRouter`.

#### Acceptance

- A channel can list runtime statuses and yielded-run snapshots for UI/status rendering.
- A channel can snapshot or subscribe to a signal tree through the router boundary.
- These reads do not create new sessions or bypass router ownership.

#### Scenario: Web channel inspects active work

- GIVEN a web channel has started
- WHEN it calls `context.listRuns()` and `context.snapshotSignalTree(rootSessionId)`
- THEN the data comes from router-owned registries and remains scoped to Pibo session identifiers.

### Requirement: Channel context controls dynamic product resources through registry methods

The context MUST allow authorized channels and apps to mutate dynamic profiles, context files, skills, and product events only through registry-owned methods.

#### Current

The context exposes `upsertProfile`, `removeProfile`, `upsertContextFile`, `removeContextFile`, `registerSkill`, `unregisterSkill`, `emitProductEvent`, and `subscribeProductEvents` as delegates to the plugin registry.

#### Acceptance

- Dynamic profile updates go through registry validation and affect subsequent profile discovery.
- Dynamic context-file and skill updates go through registry APIs instead of bypassing the catalog.
- Product event subscribers receive registry-emitted product events.

#### Scenario: Custom agent profile is registered

- GIVEN a web app creates or updates a custom agent
- WHEN it calls `context.upsertProfile` with the generated profile definition
- THEN the profile becomes visible through `context.getProfiles()`

### Requirement: Shutdown stops channels before disposing router-owned work

Gateway shutdown MUST stop started channels before stopping auth, destroying socket clients, disposing routed sessions, and closing the owned session store.

#### Current

`PiboGatewayServer.stop` calls `stopChannels`, stops the auth service, unsubscribes router broadcasts, destroys TCP connections, closes the server, disposes routed sessions, and closes the owned session store.

#### Acceptance

- A channel `stop` method is called at most once for each successful `start`.
- Channels stop in reverse startup order.
- After shutdown, channel context operations fail through gateway not-started guards instead of using stale router or session store state.

#### Scenario: Started channel is stopped

- GIVEN a plugin channel started successfully
- WHEN the gateway stops
- THEN the channel's `stop` hook is called
- AND the router is disposed after channel stop completes

## Edge Cases

- If a channel throws during startup after earlier channels started, future cleanup must not assume unstarted channels have `stop` state.
- Optional context methods may be absent from non-gateway test contexts; channel implementations should treat optional members as optional unless the channel contract requires them.
- Auth mode `trusted-local` still relies on the transport boundary to decide who can reach the channel; it is not a authenticated-user auth substitute.
- Dynamic registry mutations affect future discovery and runtime creation; existing routed runtimes may keep their already assembled runtime context.

## Constraints

- **Security / Privacy:** Required-auth channels cannot start without an auth service. Owner-scoped behavior must be enforced by the channel or app before it calls context mutations that affect user data.
- **Compatibility:** The context is TypeScript-level API for Pibo channels; adding fields must preserve existing channel implementations.
- **Performance:** Catalog reads and signal snapshots should be lightweight enough for UI polling or status endpoints.
- **Dependencies:** Channel context behavior depends on the plugin registry, session store, model defaults, session router, and optional auth service.

## Success Criteria

- [x] SC-001: Gateway startup rejects required-auth channels when no auth service is registered, as covered by `test/channel-runtime.test.mjs`.
- [x] SC-002: A plugin channel can create a canonicalized Pibo Session during startup, as covered by `test/channel-runtime.test.mjs`.
- [ ] SC-003: Channel-submitted input events route through `PiboSessionRouter` and emit normalized Pibo output events.
- [ ] SC-004: Channel catalog reads expose registered resources without creating runtimes.
- [ ] SC-005: Gateway shutdown calls started channel `stop` hooks before router disposal.
- [ ] SC-006: Channel runtime status, yielded-run, Ralph stop-condition, and signal-tree context methods match `PiboChannelContext` and `PiboGatewayServer.createChannelContext`.

## Assumptions and Open Questions

### Assumptions

- Channel implementations are trusted product/plugin code, not untrusted third-party scripts.
- The gateway remains the owner that assembles channel context; channels should not construct their own routers or session stores.

### Open Questions

- Should `auth.mode = "trusted-local"` receive stronger validation based on bind host or transport type?
- Should dynamic registry mutation methods require app-space parameters for auditability?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Required-auth channels start only with an auth service | Required web channel without auth | `src/gateway/server.ts`, `src/channels/types.ts`, `test/channel-runtime.test.mjs` | Draft |
| REQ-002 Channels start after router and session store are ready | Channel creates a session during startup | `src/gateway/server.ts`, `test/channel-runtime.test.mjs` | Draft |
| REQ-003 Channel context routes input through the session router | Channel sends a message | `src/gateway/server.ts`, `src/core/session-router.ts`, `src/core/events.ts` | Draft |
| REQ-004 Channel-created sessions resolve profile and active model once | Alias profile is canonicalized | `src/gateway/server.ts`, `src/core/model-defaults.ts`, `src/plugins/registry.ts` | Draft |
| REQ-005 Channel context exposes product catalogs without activating resources | Web host discovers apps | `src/gateway/server.ts`, `src/plugins/registry.ts`, `src/web/channel.ts`, `src/ralph/types.ts` | Source-inspected |
| REQ-006 Channel context exposes runtime status, run-control, and signal inspection | Web channel inspects active work | `src/channels/types.ts`, `src/gateway/server.ts`, `src/core/session-router.ts` | Source-inspected |
| REQ-007 Channel context controls dynamic product resources through registry methods | Custom agent profile is registered | `src/gateway/server.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat/agent-profiles.ts` | Draft |
| REQ-008 Shutdown stops channels before disposing router-owned work | Started channel is stopped | `src/gateway/server.ts`, `test/channel-runtime.test.mjs` | Draft |

## Verification Basis

This spec was refreshed against the current implementation in `src/channels/types.ts`, `src/gateway/server.ts`, `src/core/session-router.ts`, `src/core/model-defaults.ts`, `src/plugins/registry.ts`, `src/ralph/types.ts`, `src/web/channel.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat/agent-profiles.ts`, and `test/channel-runtime.test.mjs`.
