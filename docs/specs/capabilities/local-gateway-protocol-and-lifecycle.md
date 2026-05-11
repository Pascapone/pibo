# Spec: Local Gateway Protocol and Lifecycle

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md), [Yielded Run Control](./yielded-run-control.md)

## Why

Pibo exposes routed runtimes to local clients, tools, web channels, and operators through a gateway boundary. That boundary must be predictable because it sits between external transports and the Session Router.

The gateway also owns operational lifecycle commands. Production restarts can interrupt active sessions or yielded runs, so restart behavior must be observable and guarded.

## Goal

Specify the local gateway's observable TCP frame protocol, routing behavior, channel startup contract, backpressure policy, diagnostics, and lifecycle safety rules.

## Background / Current State

The current code defines a newline-delimited JSON gateway protocol in `src/gateway/protocol.ts`. `PiboGatewayServer` accepts TCP sockets, validates request and subscription frames, forwards input events to `PiboSessionRouter`, and broadcasts router output events to subscribed clients. Gateway channels receive a `PiboChannelContext` for session store access, route emission, capability discovery, auth, web app registration, and product events.

The CLI exposes local gateway commands plus managed production and dev gateway commands. Managed production restarts are blocked when the status endpoint reports processing or streaming sessions, queued messages, active yielded runs, unavailable status, an unexpected mode, or ambiguous state. Dev gateway restart is less restrictive.

## Scope

### In Scope

- Local TCP gateway frame format and validation.
- Request/response correlation for message and execution input events.
- Router event broadcast and session-scoped subscriptions.
- Slow-client backpressure behavior and gateway diagnostics.
- Channel startup, auth-service dependency checks, and channel context capabilities.
- Operator lifecycle commands for local, production, dev, backup, and fallback gateways.
- Agent-facing gateway send tool behavior where it relies on the gateway protocol.

### Out of Scope

- Chat Web HTTP APIs and SSE semantics — covered by Chat Web specs.
- Auth policy details for Better Auth and dev auth — covered by Web Auth and Same-Origin Host.
- Session Router internals — covered by Pibo Session Routing.
- Gateway process manager implementation outside Pibo CLI commands.

## Requirements

### Requirement: Gateway frames are newline-delimited JSON

The gateway MUST accept and emit one JSON frame per newline over TCP.

#### Current

`encodeFrame` serializes a frame with `JSON.stringify(frame) + "\n"`. The server buffers socket data until newline boundaries, trims each line, ignores empty lines, and parses non-empty lines as JSON.

#### Target

Clients can stream partial socket chunks, multiple frames per chunk, or whitespace around lines without changing frame semantics.

#### Acceptance

A client that sends two valid newline-delimited frames in one socket write receives independent responses for each accepted frame.

#### Scenario: Invalid JSON frame

- GIVEN a connected TCP client
- WHEN the client sends a non-empty line that is not valid JSON
- THEN the gateway returns a response frame with `type: "res"`, `id: "invalid"`, `ok: false`, and an error message.

### Requirement: Request frames validate input events before routing

The gateway MUST route only valid request frames into the Session Router.

#### Current

A request frame must have `type: "req"`, a string `id`, and an event with a non-empty string `piboSessionId`. Message events require string `text`. Execution events require string `action` and optional JSON-compatible `params`.

#### Target

Malformed frames fail before router invocation, and valid frames preserve caller-provided request IDs for response correlation.

#### Acceptance

An invalid request frame returns `ok: false` with `id: "invalid"`. A valid request returns one response with the same frame `id` and `payload` equal to the router output.

#### Scenario: Execution params are not JSON-compatible

- GIVEN a client sends an execution request
- WHEN `params` contains a non-JSON value
- THEN the gateway rejects the frame and does not call the router.

### Requirement: Responses are correlated to request IDs

The gateway MUST emit exactly one response frame for each accepted request frame.

#### Current

`handleLine` awaits `router.emit(frame.event)` and returns `{ type: "res", id: frame.id, ok: true, payload }`. Router errors become `{ ok: false, error: { message } }` using the same request ID.

#### Target

Clients can treat the request frame ID as the only response correlation key.

#### Acceptance

`sendGatewayEvent` resolves when it reads a `res` frame whose `id` matches the generated request ID, and ignores unrelated frames.

#### Scenario: Router rejects a request

- GIVEN a valid request frame
- WHEN the router throws while handling the event
- THEN the gateway returns one response with the same request `id`, `ok: false`, and a human-readable error message.

### Requirement: Subscriptions filter broadcast router events

The gateway MUST support both legacy all-session event streams and session-scoped subscriptions.

#### Current

New connections default to `{ type: "legacy-all" }`. A valid subscribe frame can set `{ type: "session", piboSessionId }`. Broadcasts go only to connections whose subscription matches the output event's `piboSessionId`, except legacy connections receive all events.

#### Target

Modern clients can reduce cross-session noise without breaking old clients.

#### Acceptance

A session subscription for `session-a` receives events for `session-a` and not `session-b`; an unsubscribed legacy client receives both.

#### Scenario: Subscribe to one session

- GIVEN two connected gateway clients
- AND one client sends a session subscription for `session-a`
- WHEN the router emits events for `session-a` and `session-b`
- THEN the subscribed client receives only the `session-a` event.

### Requirement: Backpressure drops only droppable router events

The gateway MUST bound queued data for slow sockets and MUST preserve non-droppable frames until the client is closed.

#### Current

Assistant deltas, thinking deltas, tool execution updates, and `pi_event` frames are droppable. Critical, structural, and response frames are not droppable. When a slow socket exceeds frame or byte limits, the gateway drops a queued droppable event when possible; otherwise it closes the socket for backpressure.

#### Target

Slow UI clients cannot cause unbounded memory growth, and critical events or request responses are not silently discarded.

#### Acceptance

With a small backpressure limit and a forced slow socket, repeated `assistant_delta` broadcasts increase dropped-event diagnostics and keep the queue within the limit. Repeated non-droppable responses close the slow client instead of being dropped.

#### Scenario: Slow client receives live deltas

- GIVEN a socket whose writes are backpressured
- WHEN many `assistant_delta` events are broadcast
- THEN the gateway may drop those delta events
- AND diagnostics show dropped events and bounded queued frames.

### Requirement: Gateway diagnostics expose connection pressure

The gateway MUST expose diagnostics for active connections, slow clients, dropped events, closed slow clients, queue sizes, and current subscriptions.

#### Current

`getDiagnostics()` returns total connections, slow connection count, dropped router events, closed slow clients, and per-connection details including queue size, dropped events, closed-for-backpressure state, and subscription.

#### Target

Operators and tests can distinguish idle gateways, slow consumers, and clients closed for backlog pressure.

#### Acceptance

After a slow-client backpressure event, diagnostics include at least one slow connection or closed slow client and a non-zero dropped event count when droppable events were discarded.

#### Scenario: Inspect active subscriptions

- GIVEN a client subscribed to a session
- WHEN diagnostics are requested
- THEN that connection detail includes the session subscription type and `piboSessionId`.

### Requirement: Channels start only with satisfied auth dependencies

The gateway MUST validate registered channels before starting them.

#### Current

Before listening, `validateChannels` rejects any channel with `auth.mode === "required"` when no auth service is registered. When channels start, the gateway warns if a channel declares `auth.mode === "none"`.

#### Target

A secured channel cannot accidentally run unauthenticated because a plugin forgot to register an auth service.

#### Acceptance

Starting a gateway with a required-auth channel and no auth service fails before accepting socket traffic.

#### Scenario: Required auth channel without auth service

- GIVEN the plugin registry contains a channel requiring auth
- AND no auth service is registered
- WHEN the gateway starts
- THEN startup fails with an error naming the channel and missing auth service.

### Requirement: Channel context is the product boundary for gateway channels

The gateway MUST provide channels with product-level operations instead of direct access to router or store internals.

#### Current

`createChannelContext` exposes event emission, router subscription, session CRUD, runtime status, signal snapshots and subscriptions, gateway actions, profile and capability catalog discovery, dynamic profile and context-file updates, skill registration, product events, auth service access, and registered web apps.

#### Target

Channels implement transports and web apps through the context contract while the gateway keeps ownership of router and session store lifecycles.

#### Acceptance

A channel can create a session, emit a message, list runtime statuses, inspect capability catalog entries, and subscribe to output through context methods without importing `PiboSessionRouter`.

#### Scenario: Channel creates routed session

- GIVEN a channel has a profile name selected by a client
- WHEN it calls `createSession`
- THEN the gateway resolves profile aliases, selects an active model if none is provided, and stores a Pibo Session for subsequent routing.

### Requirement: Managed gateway lifecycle commands are mode-aware

The CLI MUST distinguish production and dev gateway targets and verify their health through the target status endpoint.

#### Current

`pibo gateway web|dev status`, `start`, `restart`, and `doctor` read target ports from `PIBO_GATEWAY_WEB_PORT` or `PIBO_GATEWAY_DEV_PORT`, call `/gateway/status`, and parse `mode`, runtime statuses, active runs, and ambiguity flags.

#### Target

Operators can inspect or manage the intended gateway without confusing production and dev services.

#### Acceptance

Starting a dev gateway is blocked when the target port is reachable but reports production mode.

#### Scenario: Wrong mode on target port

- GIVEN the dev target port responds to `/gateway/status` with `mode: "prod"`
- WHEN an operator runs `pibo gateway dev start`
- THEN the CLI prints that start is blocked because gateway state is ambiguous
- AND exits non-zero.

### Requirement: Production restart is blocked when active work may be interrupted

The CLI MUST block production restarts unless the gateway is idle or the operator explicitly forces the restart with the required confirmation token.

#### Current

`checkActiveWork` reports unsafe when the gateway is unreachable, status is unavailable, mode is wrong, state is ambiguous, any runtime is processing, streaming, or queued, or any yielded run is active. Force requires `--force --confirm restart-active-agents`.

#### Target

Production restarts avoid interrupting active user or agent work by default.

#### Acceptance

`pibo gateway web restart` exits non-zero and prints active-work reasons when any session is processing or any yielded run is active. `--force` without the exact confirmation token is rejected.

#### Scenario: Active yielded run blocks restart

- GIVEN production gateway status includes an active run
- WHEN an operator runs `pibo gateway web restart`
- THEN the CLI refuses to restart and lists the run as a reason.

### Requirement: Local gateway lifecycle uses PID files and graceful shutdown

The local gateway CLI MUST start, stop, restart, and report the default local gateway through the Pibo CLI only.

#### Current

`pibo gateway status` checks `127.0.0.1:4789` and the gateway PID file. `stop` sends `SIGTERM`, waits for the port to close, and uses `SIGKILL` only with `--force`. `restart` stops the current process when reachable, clears the PID file, spawns a detached gateway process, and waits for the port to become reachable.

#### Target

Local gateway management is discoverable and does not rely on ad hoc process control.

#### Acceptance

Stopping a reachable gateway without a PID waits for the port to close and fails with guidance to use `--force` if graceful shutdown does not complete.

#### Scenario: Restart with stale PID file

- GIVEN the default port is not reachable but a stale PID file exists
- WHEN an operator runs `pibo gateway restart`
- THEN the CLI treats the gateway as not running, clears the stale PID file, starts a new detached process, and waits for readiness.

### Requirement: Stable backup installs are explicit and reproducible

The gateway backup CLI MUST create, inspect, update, and remove a stable copy of the current Pibo source for emergency fallback use.

#### Current

`pibo gateway backup install [sourcePath]` copies a source tree to `~/.pibo/stable`, excludes `node_modules` and `.git`, symlinks the backup `.pibo` directory to the normal user `.pibo`, runs `npm install`, runs `npm run build`, and writes `.backup-meta.json` with source path, install time, and git commit when available. `status`, `update`, and `remove` operate on that backup location.

#### Target

Operators can verify which source revision would run as fallback and can refresh or remove that copy without changing the live gateway process.

#### Acceptance

After a successful backup install, `pibo gateway backup status` exits successfully and prints the source path, commit or `unknown`, and install timestamp. When no metadata exists, status exits non-zero and prints that no backup is installed.

#### Scenario: Install from non-package directory

- GIVEN a directory without `package.json`
- WHEN an operator runs `pibo gateway backup install <directory>`
- THEN the command fails before copying, installing dependencies, or writing backup metadata.

### Requirement: Fallback gateway runs only from a valid stable backup

The fallback gateway CLI MUST start a separate gateway/web pair from the stable backup and keep its process identity separate from the normal gateway.

#### Current

`pibo gateway fallback start` requires `~/.pibo/stable` and `~/.pibo/stable/dist/bin/pibo.js`, rejects occupied fallback ports `4790` and `4791`, spawns the backup binary with `PIBO_FALLBACK_MODE=1`, waits until both the TCP gateway and web health endpoint are reachable, and writes `gateway-fallback.pid`. `stop`, `restart`, and `status` use the fallback PID file and fallback ports.

#### Target

Emergency operators can run the stable fallback beside or instead of the normal gateway without overwriting the normal gateway PID file or pretending to be the production service.

#### Acceptance

Starting fallback without an installed and built backup fails with guidance to install or update the backup. A running fallback reports its PID and both fallback endpoints. Stopping fallback clears only the fallback PID file. The resolved fallback gateway options use public host `0.0.0.0`, TCP gateway port `4790`, and web port `4791` so fallback never collides with the default local gateway port.

#### Scenario: Fallback port conflict

- GIVEN a process is already listening on fallback gateway port `4790` or fallback web port `4791`
- WHEN an operator runs `pibo gateway fallback start`
- THEN the command fails before spawning the backup gateway and reports the occupied port.

#### Scenario: Fallback uses dedicated public ports

- GIVEN fallback gateway options are resolved
- WHEN the fallback server is configured
- THEN the TCP gateway listens on `0.0.0.0:4790`
- AND the web gateway listens on `0.0.0.0:4791`.

### Requirement: Agent-facing gateway send waits for the correlated assistant reply

The `pibo_gateway_send` tool MUST send a message to a target Pibo Session through the gateway and return the assistant reply that matches the sent event.

#### Current

The tool calls `sendGatewayMessageAndWaitForReply`, which writes a request frame, accepts response and reply in either order, ignores unrelated assistant messages, and resolves only when both the matching response and matching assistant message are available.

#### Target

Agents can delegate through the gateway without confusing replies from other sessions or earlier messages.

#### Acceptance

If the gateway emits an unrelated assistant message before the correlated assistant message, the tool returns the correlated reply.

#### Scenario: Reply arrives before response

- GIVEN the gateway emits the correlated `assistant_message` before the `res` frame
- WHEN an agent calls `pibo_gateway_send`
- THEN the request still succeeds after the matching response arrives.

## Edge Cases

- Invalid subscribe frames return an invalid request response and keep the previous subscription.
- Socket close or socket error removes the connection from the diagnostics set.
- Fallback gateway mode writes and clears the fallback PID file instead of the normal gateway PID file.
- A channel with `auth.mode === "none"` can start, but startup warns because the channel is unauthenticated.
- Managed gateway status that is reachable but unparsable is unsafe for production restart.
- Gateway request helpers time out instead of waiting forever for missing responses or missing assistant replies.

## Constraints

- **Compatibility:** Existing legacy clients without explicit subscriptions continue to receive all router events.
- **Security / Privacy:** Channels that require auth cannot start without an auth service. Same-origin web auth details remain outside this spec.
- **Performance:** Slow clients must not create unbounded memory growth; droppable live/debug events are bounded by frame and byte limits.
- **Dependencies:** Managed lifecycle commands rely on the configured service manager command and target service names.

## Success Criteria

- [ ] SC-001: Protocol tests cover valid request frames, invalid frames, subscriptions, and request/response correlation.
- [x] SC-002: Backpressure tests prove droppable events are discarded before unbounded queue growth and non-droppable frames are not silently dropped, as covered by `test/gateway-backpressure-subscriptions.test.mjs`.
- [x] SC-003: Channel startup tests fail required-auth channels without an auth service, as covered by `test/channel-runtime.test.mjs`.
- [x] SC-004: Managed gateway CLI tests cover wrong-mode start blocking, production active-work blocking, and force confirmation, as covered by `test/gateway-restart-safety.test.mjs`.
- [x] SC-005: Gateway send tests cover unrelated replies and response/reply ordering, as covered by `test/gateway-request.test.mjs`.
- [ ] SC-006: Backup CLI tests cover install validation, metadata status, update source reuse, and removal.
- [ ] SC-007: Fallback CLI tests cover missing backup, missing build, port conflict, PID separation, readiness wait, and graceful or forced stop.
- [x] SC-008: Fallback option tests prove fallback uses dedicated public gateway and web ports, as covered by `test/web-gateway.test.mjs`.

## Verification Coverage

This section maps current gateway tests to the lifecycle contract so future source-spec runs can target real gaps instead of duplicating gateway behavior.

### Directly Tested

- Session-scoped subscriptions, legacy all-session broadcasts, droppable-event queue bounding, and non-droppable backpressure preservation are covered by `test/gateway-backpressure-subscriptions.test.mjs`.
- Gateway request helpers and `pibo_gateway_send` response/reply ordering are covered by `test/gateway-request.test.mjs`.
- Required-auth channel startup failure and channel context startup flow are covered by `test/channel-runtime.test.mjs`.
- Production active-work restart blocking, idle restart allowance, force confirmation token export, deploy-script restart indirection, and dev start wrong-mode blocking are covered by `test/gateway-restart-safety.test.mjs`.
- Fallback gateway public host and dedicated ports are covered by `test/web-gateway.test.mjs`.

### Source-Inspected Only

- Backup install/update/remove behavior is defined in `src/gateway/backup.ts` and `src/gateway/cli.ts` but lacks focused direct tests in the current test inventory.
- Full fallback process lifecycle behavior for missing backup, missing built binary, port conflict, PID file separation, readiness waiting, and graceful or forced stop is defined in `src/gateway/fallback.ts`, `src/gateway/pidfile.ts`, and `src/gateway/cli.ts` but is not fully covered by direct tests.
- Raw protocol invalid-frame parsing remains specified from `src/gateway/protocol.ts` and `src/gateway/server.ts`; existing tests focus on subscriptions and request helper behavior rather than malformed frame parsing.

### Test Gaps

- Add protocol tests for invalid JSON frames, invalid request shapes, and non-JSON-compatible execution params.
- Add backup CLI tests for invalid install source, metadata status output, update source reuse, and removal.
- Add fallback CLI tests that exercise missing backup/build, occupied ports, PID separation, readiness timeout, and forced shutdown without using the normal gateway PID file.

## Assumptions and Open Questions

### Assumptions

- The TCP gateway is intended for local trusted clients unless wrapped by an authenticated channel or web host.
- `legacy-all` remains the default until all active clients explicitly subscribe by session.
- Production and dev managed gateways report `/gateway/status` with `mode`, `runtimeStatuses`, and `activeRuns` fields.

### Open Questions

- Should the gateway expose a first-class health or diagnostics request over the TCP protocol, or should diagnostics remain process-internal and HTTP-host-specific?
- Should future protocol versions require explicit session subscriptions by default to reduce cross-session event exposure?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 | Invalid JSON frame | `src/gateway/protocol.ts`, `src/gateway/server.ts` | Draft |
| REQ-002 | Execution params are not JSON-compatible | `src/gateway/protocol.ts` | Draft |
| REQ-003 | Router rejects a request | `src/gateway/server.ts`, `src/gateway/request.ts` | Draft |
| REQ-004 | Subscribe to one session | `src/gateway/server.ts`, `test/gateway-backpressure-subscriptions.test.mjs` | Component-tested |
| REQ-005 | Slow client receives live deltas | `src/gateway/server.ts`, `test/gateway-backpressure-subscriptions.test.mjs` | Component-tested |
| REQ-006 | Inspect active subscriptions | `src/gateway/server.ts`, `test/gateway-backpressure-subscriptions.test.mjs` | Component-tested |
| REQ-007 | Required auth channel without auth service | `src/gateway/server.ts`, `src/channels/types.ts`, `test/channel-runtime.test.mjs` | Component-tested |
| REQ-008 | Channel creates routed session | `src/gateway/server.ts`, `test/channel-runtime.test.mjs` | Component-tested |
| REQ-009 | Wrong mode on target port | `src/gateway/cli.ts`, `test/gateway-restart-safety.test.mjs` | Component-tested |
| REQ-010 | Active yielded run blocks restart | `src/gateway/cli.ts`, `test/gateway-restart-safety.test.mjs` | Component-tested |
| REQ-011 | Restart with stale PID file | `src/gateway/cli.ts`, `src/gateway/pidfile.ts` | Source-inspected |
| REQ-012 | Install from non-package directory | `src/gateway/backup.ts`, `src/gateway/cli.ts` | Source-inspected |
| REQ-013 | Fallback port conflict / dedicated public ports | `src/gateway/fallback.ts`, `src/gateway/cli.ts`, `src/gateway/pidfile.ts`, `src/gateway/web.ts`, `test/web-gateway.test.mjs` | Partly component-tested |
| REQ-014 | Reply arrives before response | `src/gateway/tool.ts`, `src/gateway/request.ts`, `test/gateway-request.test.mjs` | Component-tested |

## Verification Basis

This spec is based on current workspace code in `src/gateway/protocol.ts`, `src/gateway/server.ts`, `src/gateway/client.ts`, `src/gateway/request.ts`, `src/gateway/tool.ts`, `src/gateway/cli.ts`, `src/gateway/backup.ts`, `src/gateway/fallback.ts`, `src/gateway/pidfile.ts`, `src/gateway/web.ts`, plugin registry/channel contracts, and gateway-related tests under `test/`, especially `test/gateway-backpressure-subscriptions.test.mjs`, `test/gateway-request.test.mjs`, `test/gateway-restart-safety.test.mjs`, `test/channel-runtime.test.mjs`, and `test/web-gateway.test.mjs`.
