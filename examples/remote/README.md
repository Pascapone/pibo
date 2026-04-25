# Remote Agent Examples

The remote agent channel is the local control path for pibo sessions. It demonstrates how a channel can turn another process into a pibo event producer and output consumer.

Terminal 1:

```bash
npm run gateway
```

The gateway starts the normal TCP gateway and the local remote agent channel.

Terminal 2:

```bash
npm run remote -- local-a pibo-minimal
```

This starts the Pi-TUI proof-of-concept controller from `src/remote/examples/tui-controller.ts`. It attaches through the `remote-agent` channel and resolves a persistent session binding:

```text
channel: remote-agent
externalId: local-a
sessionKey: remote-agent:local-a
originalProfile: pibo-minimal
```

Current built-in remote execution commands available in the TUI:

```text
/status
/clear
/abort
```

The controller discovers gateway execution commands during attach and registers them as Pi extension commands, so they appear in slash autocomplete. Pi TUI built-in commands such as `/quit` remain local to the controller. Other input is sent as a normal pibo message event. Skill commands such as `/skill:name ...` are passed through as messages so the core Pi session can expand them.

This example is useful for learning the channel contract:

- `src/remote/protocol.ts` defines the frame format.
- `src/remote/channel.ts` accepts controller connections and routes frames into pibo events.
- `src/remote/session-client.ts` handles attach, discovery, request/response correlation, and event delivery.
- `src/remote/examples/tui-controller.ts` adapts Pi TUI extension hooks into that client.

The Pi TUI controller is intentionally a proof of concept. It gives a native-feeling demo, but future production UIs should normally build directly on the channel and session-client contracts rather than depending on Pi TUI behavior.

For the minimal line-based debug client:

```bash
npm run remote:line -- local-a pibo-minimal
```
