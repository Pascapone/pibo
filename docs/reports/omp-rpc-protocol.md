# OMP RPC Server — JSON-lines-over-stdio Protocol (reference)

Source: Oh My Pi `packages/coding-agent/src/modes/rpc/` (rpc-types.ts, rpc-frame.ts, rpc-mode.ts, rpc-messages.ts, rpc-input.ts) at `@oh-my-pi/pi-coding-agent` 17.3.5. Paths relative to `C:/Users/pasca/Coding/oh-my-pi` (also `/root/omp`).

## 1. Transport & handshake

Newline-delimited JSON. Commands on stdin; responses + async events on stdout, one object per line. `PI_NOTIFICATIONS="off"` keeps stdout a pure JSON channel (rpc-mode.ts:671-679).

**Size limits** (rpc-frame.ts:7-11): `MAX_RPC_FRAME_BYTES = 1024*1024` (1 MiB physical line incl. newline); `MAX_RPC_REASSEMBLED_BYTES = 64*1024*1024`; `RPC_CHUNK_PAYLOAD_BYTES = 256*1024` (base64 per chunk).

**Ready frame** (first on stdout, rpc-mode.ts:691-697):
```json
{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}
```
**Negotiation**: client sends `{"id"?,"type":"negotiate_protocol","protocolVersion":2}`; server replies `{id?,type:"response",command:"negotiate_protocol",success:true,data:{protocolVersion:2}}` (rpc-mode.ts:972-978). Encoder starts at v1; after successful negotiate the server sets v2 (rpc-mode.ts:701-702). Any other version → `error(id,"negotiate_protocol","Unsupported RPC protocol version: <v>")`.

- v1: no chunking; frames > 1 MiB → `overflowFrame` (response: success:false error; non-response: agent_end compaction, `SHRINK_PASSES` truncation, then overflow).
- v2: frame still > 1 MiB after agent_end compaction → emitted as `rpc_chunk`.

**Chunking on stdout (v2)** (`encodeChunkedRpcFrames`): `RpcChunkFrame` `{type:"rpc_chunk",chunkId:string,index:number,count:number,byteLength:number,data:string}`. `data` = base64 of ≤256 KiB slice of UTF-8 JSON bytes; `byteLength` = total reassembled JSON length; `count = ceil(byteLength/256KiB)`; `index 0..count-1` in order. ByteLength in `[MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES]`.

**Client rules**:
- stdin: always send plain JSON ≤ 1 MiB (incl newline). v2 chunking on stdin optional; if used must match reassembly rules.
- stdout: detect `rpc_chunk` (v2) and reassemble by `(chunkId, index, count, byteLength)`.

## 2. Stdout frame inventory (43 types)

**(a) Protocol/control**: `ready`, `response`, `prompt_result`, `available_commands_update`, `command_output`, `session_info_update`, `config_update`, `extension_error`, `session_shutdown`.
**(b) Session events** (`AgentSessionEvent`): `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `auto_compaction_start`, `auto_compaction_end`, `auto_retry_start`, `auto_retry_end`, `retry_fallback_applied`, `retry_fallback_succeeded`, `model_changed`, `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`, `irc_message`, `notice`, `thinking_level_changed`, `goal_updated`.
**(c) Extension UI**: `extension_ui_request` (methods: select, confirm, input, editor, cancel, notify, setStatus, setWidget, setTitle, set_editor_text, open_url).
**(d) Bidirectional host**: stdout `host_tool_call`, `host_tool_cancel`, `host_uri_request`, `host_uri_cancel`; client→server `host_tool_update`, `host_tool_result`, `host_uri_result`.
**(e) Subagent**: `subagent_lifecycle`, `subagent_progress`, `subagent_event` (gated by `set_subagent_subscription`).

**Response/correlation**: one `response` per request. Success `{id?,type:"response",command,success:true,data?}`. Error `{id?,type:"response",command:string,success:false,error:string,code?:string}`. Ordinary commands serialize in order through `RpcInputDispatcher`; **`bash` dispatched in background** → respond late, MUST match on `id`. Side-channel frames (extension_ui_response, host_tool_*, host_uri_*) overtake the queue. **Always match on `id`.**

**Success payloads** (per command): `negotiate_protocol`→{protocolVersion:2}; `prompt`→{agentInvoked?}; `steer/follow_up/abort/abort_and_prompt` void; `new_session`→{cancelled}; `get_state`→RpcSessionState; `set_fast_mode`→{enabled,active}; `get_available_commands`→{commands[]}; `set_todos`→{todoPhases}; `set_host_tools`→{toolNames[]}; `set_host_uri_schemes`→{schemes[]}; `set_subagent_subscription`→{level}; `get_subagents`→{subagents[]}; `get_subagent_messages`→RpcSubagentMessagesResult; `set_model`→Model; `cycle_model`→{model,thinkingLevel,isScoped}|null; `get_available_models`→{models[]}; `set_thinking_level` void; `cycle_thinking_level`→{level}|null; `set_steering_mode/set_follow_up_mode/set_interrupt_mode` void; `compact`→CompactionResult; `set_auto_compaction/set_auto_retry/abort_retry` void; `bash`→BashResult; `abort_bash` void; `get_session_stats`→SessionStats; `export_html`→{path}; `switch_session`→{cancelled}; `branch`→{text,cancelled}; `get_branch_messages`→{messages:[{entryId,text}]}; `get_last_assistant_text`→{text:null|string}; `set_session_name` void; `handoff`→RpcHandoffResult|null; `get_messages`→{messages[]}; `get_messages_page`→RpcMessagesPage; `get_login_providers`→{providers:[{id,name,available,authenticated}]}; `login`→{providerId}.

## 3. AgentSessionEvent union (session/agent-session-events.ts:12-42)

```ts
export type AgentSessionEvent =
  | Exclude<AgentEvent, { type: "agent_end" }>
  | (Extract<AgentEvent, { type: "agent_end" }> & { isTerminal?: boolean })
  | { type: "auto_compaction_start"; reason; action }
  | { type: "auto_compaction_end"; action; result; aborted; willRetry; errorMessage?; skipped? }
  | { type: "auto_retry_start"; attempt; maxAttempts; delayMs; errorMessage; errorId? }
  | { type: "auto_retry_end"; success; attempt; finalError?; retryErrors? }
  | { type: "retry_fallback_applied"; from; to; role }
  | { type: "retry_fallback_succeeded"; model; role }
  | { type: "model_changed" }
  | { type: "ttsr_triggered"; rules }
  | { type: "todo_reminder"; todos; attempt; maxAttempts }
  | { type: "todo_auto_clear" }
  | { type: "irc_message"; message }
  | { type: "notice"; level; message; source? }
  | { type: "thinking_level_changed"; thinkingLevel; configured?; resolved? }
  | { type: "goal_updated"; goal; state? };
```

`AgentEvent` (agent/src/types.ts:864-885):
```ts
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[]; telemetry?; coverage? } // + optional isTerminal
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId; toolName; args; intent? }
  | { type: "tool_execution_update"; toolCallId; toolName; args; partialResult }
  | { type: "tool_execution_end"; toolCallId; toolName; result; isError? };
```
Async continuation (compaction/todo/advisor) emits non-terminal `agent_end {isTerminal:false, willContinue:true}` then resumes; final = `agent_end {isTerminal:true}`.

## 4. Prompt / steer / follow_up / abort (rpc-mode.ts:981-1128)

- `prompt {message,images?,streamingBehavior?:"steer"|"followUp"}` → `{success:true}` immediately, events stream async. Skill command → `{agentInvoked:true}`; slash builtin non-agent → `{agentInvoked:false}`; else `session.prompt(...)` with `prompt_result` emission.
- `steer`/`follow_up`: await then success. steer=interrupt+steer; follow_up=queue non-interrupting.
- `abort`: `await session.abort({reason:USER_INTERRUPT_LABEL})` then success; interrupts running turn → streaming stops, terminal agent_end.
- `abort_and_prompt`: abort then prompt, success immediately.
- **`prompt_result`** `{type:"prompt_result",id?,agentInvoked:boolean}`: emitted ONLY via `reportLocalOnlyPromptResult` when `session.prompt` resolves with `agentInvoked:false`. If agent invoked, no prompt_result — the agent_start/agent_end stream is the evidence. Prompt error → `error(id,"prompt",...)`.

**Event order (invoked prompt):** turn_start → message_start(user) → assistant message_start/message_update*/message_end → tool_execution_start/update/end per call → turn_end → agent_end. Async continuation → non-terminal agent_end then more; final agent_end{isTerminal:true}.

## 5. Streaming model events

Deltas arrive as `message_update` frames (NOT rpc_chunks). `{type:"message_update", message:<full partial AgentMessage>, assistantMessageEvent:AssistantMessageEvent}`. `AssistantMessageEvent` (ai/src/types.ts:1244-1259):
```ts
| { type: "start"; partial }
| { type: "text_start"; contentIndex; partial }
| { type: "text_delta"; contentIndex; delta; partial }
| { type: "text_end"; contentIndex; content; partial }
| { type: "thinking_start"; contentIndex; partial }
| { type: "thinking_delta"; contentIndex; delta; partial }
| { type: "thinking_end"; contentIndex; content; partial }
| { type: "image_end"; contentIndex; content; partial }
| { type: "toolcall_start"; contentIndex; partial }
| { type: "toolcall_delta"; contentIndex; delta; partial }
| { type: "toolcall_end"; contentIndex; toolCall; partial }
| { type: "done"; reason: "stop"|"length"|"toolUse"; message }
| { type: "error"; reason: "aborted"|"error"; error }
```
- text → text_start/delta(delta)/text_end(content) by contentIndex.
- reasoning/thinking → thinking_start/delta(delta)/end(content).
- tool call args → toolcall_start/delta(incremental JSON)/end(toolCall).
- `partial` = full current assistant message snapshot (shared immutable).

## 6. State / model / thinking

`get_state` → RpcSessionState `{model?, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, interruptMode, sessionFile?, sessionId, sessionName?, autoCompactionEnabled, fastModeEnabled, fastModeActive, tokensPerSecond, messageCount, queuedMessageCount, todoPhases, systemPrompt?, dumpTools?, contextUsage?}`.
`get_available_models` → `{models:Model[]}` (awaits background refresh). `set_model {provider,modelId}` → resolves catalog (waits in-flight discovery on cold start); rejects `Model not found: provider/model`. `cycle_model` → `{model,thinkingLevel,isScoped}|null`. `set_thinking_level {level}` → void + `thinking_level_changed`. `cycle_thinking_level` → `{level}|null`. Env `PI_RPC_EMIT_TITLE=1` opts into setTitle.

## 7. Startup

Selected via **`--mode rpc`** (also `rpc-ui`). NO `rpc` positional subcommand — client spawns `bun dist/cli.js --mode rpc` (rpc-client.ts:288-301); optional `--provider`, `--model`, `--session-dir` passthrough. main.ts: rejects `@file`, disables piped stdin for protocol modes, forces `PI_NO_TITLE=1`, applies RPC default setting overrides, dispatches `runRpcMode` (main.ts:1761-1765). `runRpcMode` sets `PI_NOTIFICATIONS=off`, emits `ready`, subscribes events, emits `available_commands_update`, enters stdin loop. stdin EOF → drain, `session.dispose` (emits `session_shutdown`), exit(0).

## 8. Side-channel frames client must also parse

`available_commands_update {commands[]}` (startup + on change); `command_output {text}`; `session_info_update {title,sessionId}`; `config_update {model,thinkingLevel}`; `extension_error {extensionPath,event,error}`; `session_shutdown`; `rpc_frame_error` / overflow failure responses.

## Host surfaces (skills/context/providers)

- **Host tools** (`set_host_tools`): register `RpcHostToolDefinition`; OMP emits `host_tool_call`/`host_tool_cancel` matched by Snowflake id; client replies `host_tool_result`/`host_tool_update`. Inbound id is the correlation key.
- **Host URI schemes** (`set_host_uri_schemes`): read/write request/cancel/result.
- **Skills**: NOT RPC-governed. Discovered from session cwd via capability/discovery (`loadSkills`, `loadSkillsFromDir`, `.omp/skills`), rendered into base prompt. Host steers via `cwd` + on-disk files + `skills.*` settings.
- **Context files**: NOT RPC-governed. `loadProjectContextFiles` (AGENTS.md and rules), `buildSystemPrompt providedContextFiles` option. Host delivers via session cwd `AGENTS.md`/rules.
- **Slash commands**: `get_available_commands` + `available_commands_update`, sourced from builtin/skill/extension/custom/mcp_prompt/file (loadSlashCommands over `.omp/commands`). `RpcAvailableSlashCommand {name, aliases?, description?, input?{hint?}, subcommands?, source}`.
- **Providers**: headless config via `models.yml` (providers map: baseUrl, apiKey, api, auth, discovery, models, modelOverrides) + Settings (disabledProviders, enabledModels, modelTags) + env vars; credentials in local SQLite (`AuthStorage`/`SqliteAuthCredentialStore`) or an auth broker; OAuth login headlessly via `get_login_providers` (→ `[{id,name,available,authenticated}]`) + `login` (→ `open_url` extension_ui_request for the browser step).