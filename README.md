# pibo

Minimal TypeScript wrapper project around Pi Coding Agent.

## Scripts

- `npm run dev` runs the TypeScript entrypoint with `tsx`.
- `npm run profile` prints the active V1 profile with loaded skills and context files.
- `npm run profile -- gateway-producer` prints the gateway producer profile.
- `npm run tui` starts the Pi TUI through the pibo wrapper.
- `npm run tui:gateway` starts the Pi TUI with the gateway producer profile.
- `npm run gateway` starts the local pibo gateway daemon.
- `npm run client -- <sessionKey>` starts a console client connected to the gateway.
- `npm run build` compiles to `dist/`.
- `npm run start` runs the compiled entrypoint.
- `npm test` builds and runs gateway transport tests.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run clean` removes `dist/`.

## Philosophy

Keep the wrapper thin. Pi Coding Agent should remain the inner engine; pibo adds only the small runtime, tool, prompt, and policy layer we actually need.

## V1 Profile

The default profile is defined in `src/profiles.ts`. It loads the local `pi-agent-harness` skill, registers the two test tools `pibo_echo` and `pibo_workspace_info`, and appends the example context files from `examples/context/`.

## Gateway

The gateway is the current local transport boundary. It owns the session router, accepts newline-delimited JSON frames over TCP, routes messages by `sessionKey`, and broadcasts normalized session events back to connected clients.

The gateway producer profile adds `pibo_gateway_send`, a tool that sends a message into a target gateway session and returns the correlated assistant reply. See `examples/gateway/README.md` for the two supported manual flows.
