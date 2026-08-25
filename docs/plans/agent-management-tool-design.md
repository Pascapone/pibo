# Agent Management Tool and CLI Design

**Status:** Accepted; updated for yielded-only dispatch
**Date:** 2026-08-23
**Updated:** 2026-08-25
**Capability spec:** [Agent Delegation and Management](../specs/capabilities/subagent-delegation.md)

## Design Decisions

### Stable tools, dynamic catalog

Every session with one or more available delegated agents receives the same four definitions:

```text
pibo_agents_send_message
pibo_agents_list_agents
pibo_agents_observe
pibo_agents_kill
```

Agent names are data, not tool names. `pibo_agents_send_message.name` uses a dynamic JSON-schema enum. The send tool's model-visible description carries one compact catalog:

```text
Available agents:
- explorer: Inspect the repository and report relevant findings.
- worker: Implement focused changes and verify them.
```

A missing description is rendered as `Targets profile <targetProfile>.` No inferred capability text is added.

### Agent identity

`agentId` is the child Pibo Session ID. This avoids another identity store and gives traces, signals, debug CLI, and management tools one correlation key.

A child remains a regular session:

```text
channel: pibo.subagents
kind: subagent
parentId: <calling session>
metadata.subagentName: <configured name>
metadata.threadKey: <resolved key>
metadata.subagentToolName: pibo_agents_send_message
metadata.agentStatus: active | killed
```

Legacy metadata is accepted during lookup, but new children use the shared tool name.

## Tool Contracts

### `pibo_agents_send_message`

Input:

```json
{
  "name": "explorer",
  "message": "Find the routing boundary.",
  "threadKey": "routing"
}
```

- `name`: required enum of available configured names.
- `message`: required string.
- `threadKey`: optional stable continuation key, schema limit 256 characters and router limit 512 UTF-8 bytes.

`pibo_agents_send_message` is yielded-only and is never exposed as a direct foreground tool. The run wrapper returns a run ID immediately, while its background execution waits for the child reply without an implicit lifetime deadline. The terminal result includes name, `agentId`, resolved thread, complete reply, child reply event, and routed event ID.

Dispatch uses existing run control:

```json
{
  "toolName": "pibo_agents_send_message",
  "arguments": {
    "name": "worker",
    "message": "Implement and test the focused change.",
    "threadKey": "implementation"
  },
  "completionPolicy": "tracked"
}
```

The caller uses `pibo_run_status`, bounded `pibo_run_wait`, or `pibo_run_read`; no separate agent wait protocol is introduced. `pibo_run_wait` defaults to 30 seconds and is capped at 300 seconds per call. An expired wait, normal parent-turn completion, or stale telemetry leaves the delegated request running. Legacy `SubagentProfile.timeoutMs` values do not create a request or run deadline.

### `pibo_agents_list_agents`

Input: empty object.

Output:

```json
{
  "availableAgents": [
    { "name": "explorer", "description": "...", "profile": "explorer-profile" }
  ],
  "agents": [
    {
      "agentId": "ps_...",
      "name": "explorer",
      "profile": "explorer-profile",
      "threadKey": "routing",
      "status": "idle",
      "createdAt": "...",
      "updatedAt": "...",
      "activeModel": { "provider": "openai", "id": "gpt-5.6-luna" }
    }
  ]
}
```

`running` means the routed child is processing, streaming, or queued. `killed` is persisted in child metadata. Every other managed child is `idle`, including an idle-evicted runtime.

### `pibo_agents_observe`

Input:

```json
{
  "agentIds": ["ps_..."],
  "names": ["worker"],
  "threadKeys": ["implementation"],
  "eventTypes": ["tool_call", "tool_execution_finished", "assistant_message"],
  "kinds": ["tool", "message"],
  "since": "2026-08-23T15:00:00.000Z",
  "until": "2026-08-23T16:00:00.000Z",
  "textContains": "test",
  "afterSequence": 120,
  "order": "asc",
  "limit": 50,
  "includeDetails": false
}
```

Array fields use OR semantics internally. Different fields combine with AND semantics. Exact values are not treated as prefixes or regular expressions. `textContains` is the only substring filter and is case-insensitive.

Normalized observation:

```json
{
  "sequence": 121,
  "createdAt": "2026-08-23T15:21:11.000Z",
  "agentId": "ps_...",
  "name": "worker",
  "threadKey": "implementation",
  "eventType": "tool_execution_finished",
  "kind": "tool",
  "role": "tool",
  "text": "npm test",
  "toolName": "bash",
  "toolCallId": "tool_...",
  "isError": false
}
```

`includeDetails: true` adds the normalized source event under `details`. Default output omits it. Normalized text is bounded to 4 KiB and details to 32 KiB per observation. The journal is router-global, monotonic, and bounded to the newest 5,000 delegated-child observations.

`afterSequence` is exclusive. Cursor pages always select the oldest unseen matching records first. `order: desc` reverses only that selected page, so `nextAfterSequence` never skips unseen records. The result sets `truncated` when another matching page exists or when the caller's cursor predates retained history. On retention loss, the next cursor advances through the known eviction boundary even if no retained record matches.

Kinds map as follows:

| Event | Kind | Role |
|---|---|---|
| `message_queued`, `message_steered`, `message_started`, `assistant_delta`, `assistant_message`, `message_finished` | `message` | actor/assistant |
| `thinking_*` | `thinking` | assistant |
| `tool_*`, `subagent_session` | `tool` | tool/agent |
| `session_error` | `error` | system |
| `execution_result`, `compaction_*` | `lifecycle` | system |
| everything else | `event` | omitted |

### `pibo_agents_kill`

Input:

```json
{ "agentId": "ps_..." }
```

The controller verifies direct ownership, persists `metadata.agentStatus = "killed"`, disposes the child subtree, and cancels runs belonging to the subtree. The result lists killed session and run IDs. Killed children are excluded from future thread reuse. Disposal is retried on repeated kill calls after a partial failure, and descendant traversal is iterative and cycle-safe.

## Ownership Model

All list, observe, and kill operations begin with direct children matching:

```text
kind = subagent
channel = pibo.subagents
parentId = caller Pibo Session ID
```

`agentIds` are validated against that set before filtering. Nested child sessions are terminated with their direct parent, but they are not independently manageable by the grandparent's shared tools.

## Live Observation Storage

The router records normalized observations before notifying external listeners. Only output events whose session is a direct or nested delegated child are journaled under their direct managing parent. A fixed-size FIFO bound prevents unbounded memory growth.

The model tool consumes this live authoritative journal. Persisted operator debugging uses the existing SQLite session and event log; it does not scrape runtime-native transcripts.

## Debug CLI

Progressive discovery:

```text
pibo debug --help
  -> pibo debug agents --help
    -> pibo debug agents <parent-session-id> --help
      -> pibo debug agents <parent-session-id> list --help
      -> pibo debug agents <parent-session-id> observe --help
```

List options:

```text
--name <name>
--status <running|idle|killed>
--json
```

Observe options are repeatable where plural:

```text
--agent-id <ps_...>
--name <name>
--thread-key <key>
--event-type <type>
--kind <message|thinking|tool|error|lifecycle|event>
--since <ISO timestamp>
--until <ISO timestamp>
--contains <text>
--after-sequence <n>
--order <asc|desc>
--limit <1..200>
--details
--json
```

CLI observation sequence uses persisted `event_log.stream_id`, explicitly labeled `streamId` in JSON. Persisted rows are streamed rather than loaded as one unbounded array, and normal text/details use the same bounds as the live tool. Cursor pagination follows the same oldest-unseen rule. The model tool's live `sequence` is not claimed to survive a router restart.

## Legacy and UI

- Deprecated `createSubagentToolName`, `createSubagentToolDefinitions`, runner types, and `subagentRunner` option shapes remain source-visible for migration. External callers can still invoke the legacy factory, while Pibo-owned runtime assembly rejects the old controller option with a direct `agentsController` migration error.
- Existing `subagent_session` events and child-session trace cards remain.
- Their `toolName` changes to `pibo_agents_send_message` for new delegations.
- Trace materialization must read agent name from the link event or `args.name`, not from a generated tool suffix.
- `codex-compat` receives only the minimal replacement of invalid `pibo_subagent_*` wording; no new legacy-specific catalog mechanism is added.
