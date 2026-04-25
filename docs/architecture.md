# Pibo Architecture

Pibo is a thin TypeScript harness around Pi Coding Agent. Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo owns the outer product boundary: profiles, plugin registration, channels, routing, session bindings, and transport-specific adapters.

## Core Boundary

```text
Channel / Tool / Client
  -> Pibo event
  -> Session router
  -> Routed Pi runtime
  -> Normalized Pibo output event
  -> Channel / Client
```

The core contracts live in:

- `src/core/events.ts` for message, execution, and output events.
- `src/core/profiles.ts` for profile, tool, skill, and context-file selection.
- `src/core/runtime.ts` for creating a Pi Coding Agent runtime from a profile.
- `src/core/session-router.ts` and `src/core/routed-session.ts` for per-session queues and execution actions.

Message events are user input. They are queued per session and sent into Pi.

Execution events are wrapper-level actions such as status, queue clear, abort, and dispose. They are not model messages.

## Plugin Layer

Plugins are static and internal for now. They register capabilities into `PiboPluginRegistry`:

- tools
- skills
- context files
- profiles
- gateway execution actions
- event listeners
- channels

The registry is a catalog. It does not run sessions and does not own transport. Runtime code consumes the catalog when it creates profiles, exposes actions, or starts plugin channels.

## Channels

Channels are plugin-owned adapters. They translate an external transport into pibo events and translate pibo output events back to that transport.

The channel context intentionally exposes only:

- `emit(event)` to route a `PiboInputEvent`.
- `subscribe(listener)` to observe `PiboOutputEvent` values.
- `resolveSession(input)` to create or reuse a persistent binding.
- `getGatewayActions()` to discover execution actions for channel UIs.

Session bindings are stored in SQLite by default at `.pibo/session-bindings.sqlite`. A binding keeps a stable `sessionKey` separate from the original agent profile and channel identity.

## Remote Agent Channel

The built-in `pibo.remote-agent` plugin starts the local `remote-agent` channel on `127.0.0.1:4790`.

```text
Controller
  -> remote_attach(sessionName, profile)
  -> capabilities(gateway actions)
  -> remote_input(message | execution)
  -> Session router
  -> Pi runtime
  -> remote_event
```

The reusable pieces are:

- `src/remote/protocol.ts` for newline-delimited frame types.
- `src/remote/channel.ts` for the server-side channel.
- `src/remote/session-client.ts` for client-side attach, discovery, request/response correlation, and remote events.
- `src/remote/client.ts` for the minimal line-based debug client.

## Remote TUI Example

`src/remote/examples/tui-controller.ts` is intentionally an example, not a product direction. It proves that a Pi Coding Agent TUI can act as a local remote controller by using Pi extension hooks:

- `session_start` attaches to the `remote-agent` channel.
- `input` intercepts normal TUI input and forwards it as remote messages.
- discovered gateway actions are registered as Pi extension slash commands.
- autocomplete is filtered to the remote commands plus `/quit`.
- remote output is rendered back into the TUI as styled custom messages.

This is useful as a reference for future channel adapters, but Pi TUI is not treated as the long-term primary remote UI. A dedicated web or terminal client can reuse the same channel and `RemoteAgentSessionClient` without coupling itself to Pi TUI internals.

## Current Scripts

```bash
npm run gateway
npm run client -- <sessionKey>
npm run remote -- <sessionName> [profile]
npm run remote:line -- <sessionName> [profile]
npm run tui -- [profile]
npm run profile -- [profile]
```

`npm run remote` runs the Pi-TUI proof-of-concept controller. `npm run remote:line` runs the simpler debug client.
