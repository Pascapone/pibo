# Orion App Server 2.4.1 — Official Surface Fixture

Treat this file as the supplied official protocol/schema evidence for the eval. Do not assume methods not listed here.

## Transport and lifecycle

- Command: `orion app-server --stdio --home <isolated-directory>`.
- Newline-delimited JSON-RPC 2.0 over stdin/stdout; diagnostics use stderr.
- `initialize` returns server version and protocol version. Client sends `initialized`.
- `thread/create` returns stable `threadId` and accepts per-thread model, reasoning effort, developer instructions, project instructions, additional skill roots, and MCP server definitions.
- `thread/resume` resumes an existing `threadId` or returns error code `thread_not_found`.
- `thread/read` returns paginated normalized native items and opaque `nextCursor`.
- `thread/list` is paginated.
- `thread/fork` forks at a native item id.
- No clone method and no native branch-tree navigation method are defined.
- `thread/delete` deletes one native thread.

## Turns and events

- `turn/start` accepts text and image parts and returns `turnId`.
- `turn/steer` appends text to an active turn.
- `turn/interrupt` interrupts one active turn.
- Notifications include `turn.started`, `turn.completed`, `turn.failed`.
- Assistant notifications include indexed `assistant.delta` and `assistant.completed`.
- Reasoning notifications include indexed `reasoning.delta` and `reasoning.completed`.
- Native tool notifications include `tool.call`, `tool.started`, `tool.progress`, and `tool.completed`, with stable `toolCallId`.
- `usage.updated` reports input, output, reasoning, cache-read, and total token counts plus context window.
- `plan.updated` and `diff.updated` are documented.
- No audio input and no structured-output schema parameter are defined.

## Models, reasoning, auth, approvals

- `model/list` returns model ids, display names, reasoning values, and supported input modalities.
- `turn/start` may select one listed model. `thread/setModel` changes the default model for later turns.
- Reasoning values are `low`, `medium`, `high`.
- `auth/status` reports provider names and configured booleans; it never returns tokens.
- `approval.requested` requires `approval/respond` with the same request id.
- `userInput.requested` carries typed questions/options and requires `userInput/respond`.
- `thread/compact` compacts native context.
- `thread/status` reports context token usage.

## Native prompt and tools

- Orion owns its base prompt and standard tools `read_file`, `write_file`, `shell`, and `web_search`.
- Per-thread developer/project instructions are additive. Setting them does not replace the base prompt.
- `thread/create` has `preserveNativeTools`, default `true`. Pibo must leave it true.

## MCP, skills, and context

- `thread/create.mcpServers` accepts per-thread stdio or Streamable HTTP definitions and environment-variable references.
- `mcp/status` reports connected/failed state and tool/resource/template inventory per server.
- `thread/create.additionalSkillRoots` accepts isolated directories containing `SKILL.md` packages.
- Developer/project instruction fields accept ordered text contributions.
- `--home` isolates all generated Orion state for the process. Orion does not require changes to user-global config.

## Process behavior

- One app-server process may host multiple threads. Requests and notifications include `threadId` and `turnId`.
- `shutdown` followed by `exit` performs graceful process shutdown.
- The server documents a 4 MiB maximum JSON-RPC message and returns `server_overloaded` when its pending-request limit is reached.
