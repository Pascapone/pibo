# pibo

Minimal TypeScript wrapper project around Pi Coding Agent.

For the current architecture snapshot, see `docs/architecture.md`.

## Scripts

- `npm run dev` runs the TypeScript entrypoint with `tsx`.
- `npm run profile` prints the active V1 profile with loaded skills and context files.
- `npm run profile -- gateway-producer` prints the gateway producer profile.
- `npm run tui` starts the Pi TUI through the pibo wrapper.
- `npm run tui:gateway` starts the Pi TUI with the gateway producer profile.
- `npm run gateway` starts the local pibo gateway daemon.
- `npm run client -- <sessionKey>` starts a console client connected to the gateway.
- `npm run remote -- <sessionName> [profile]` starts the Pi-TUI remote controller.
- `npm run remote:line -- <sessionName> [profile]` starts the minimal line-based remote client for debugging.
- `npm run build` compiles to `dist/`.
- `npm run start` runs the compiled entrypoint.
- `npm test` builds and runs gateway transport tests.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run clean` removes `dist/`.

## Philosophy

Keep the wrapper thin. Pi Coding Agent should remain the inner engine; pibo adds only the small runtime, tool, prompt, and policy layer we actually need.

## Plugin Layer

`src/plugins/` contains the minimal static plugin layer. Built-in plugins register tools, skills, context files, profiles, gateway actions, and event listeners through `PiboPluginRegistry`.

This is an extension boundary, not a marketplace. Plugins are internal and statically loaded for now, which keeps the runtime simple while leaving room for web auth, new tools, new skills, and future transports.

`src/plugins/example.ts` shows the smallest plugin workflow:

- register a skill from `examples/skills/pibo-example-plugin/SKILL.md`
- register the tool `pibo_example_plugin_note`
- register the channel `pibo-example-channel`
- register the profile `pibo-example-plugin`
- add the plugin to `createDefaultPiboPlugins()` in `src/plugins/builtin.ts`

Try it with:

```bash
npm run profile -- example-plugin
npm run tui -- example-plugin
```

## Channels And Session Bindings

Plugins can register channels through `api.registerChannel(...)`. A channel maps an external transport into pibo events and maps pibo output events back to that transport.

The channel context exposes only the pibo boundary:

- `emit(event)` sends a `PiboInputEvent` to the session router.
- `subscribe(listener)` receives normalized `PiboOutputEvent` values.
- `resolveSession(...)` creates or reuses a persistent session binding.
- `getGatewayActions()` exposes discoverable execution actions for channel UIs.

Gateway session bindings are stored in SQLite by default at `.pibo/session-bindings.sqlite`. The binding remembers the stable `sessionKey`, channel, external id, original profile, optional current profile, and optional workspace.

The built-in remote agent plugin registers the local `remote-agent` channel on `127.0.0.1:4790`. It lets a local controller attach to a pibo session without speaking directly to Pi Coding Agent:

```bash
npm run gateway
npm run remote -- local-a pibo-minimal
```

`npm run remote` runs the Pi-TUI proof-of-concept controller in `src/remote/examples/tui-controller.ts`. The reusable remote pieces live in `src/remote/protocol.ts`, `src/remote/channel.ts`, and `src/remote/session-client.ts`.

The main source folders are:

- `src/core/` for runtime, events, profiles, and session routing
- `src/plugins/` for the static plugin registry and built-in plugins
- `src/channels/` for channel contracts
- `src/sessions/` for session binding storage
- `src/gateway/` for the local TCP gateway transport
- `src/remote/` for the local Pi-like remote-control channel

## V1 Profile

The default profile is registered by the core plugin. It loads the local `pi-agent-harness` skill, registers the two test tools `pibo_echo` and `pibo_workspace_info`, and appends the example context files from `examples/context/`.

## Gateway

The gateway is the current local transport boundary. It owns the session router, accepts newline-delimited JSON frames over TCP, routes messages by `sessionKey`, and broadcasts normalized session events back to connected clients.

The gateway producer profile adds `pibo_gateway_send`, a tool that sends a message into a target gateway session and returns the correlated assistant reply. See `examples/gateway/README.md` for the two supported manual flows.
