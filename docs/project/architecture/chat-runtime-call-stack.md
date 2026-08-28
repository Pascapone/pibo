# Chat Runtime Call Stack

**Last reviewed:** 2026-08-25

This note traces one Chat Web message through Pibo's runtime-neutral router and either the Pi or native Codex adapter. The matching Mermaid diagram is [`chat-runtime-flow.mmd`](./chat-runtime-flow.mmd). The broader architecture is documented in [`agent-runtime-adapters.md`](./agent-runtime-adapters.md).

## Short version

```text
Composer.submit
  -> POST /api/chat/message
  -> Chat Web validates and persists user.message.accepted
  -> channelContext.emit
  -> PiboSessionRouter.emit
  -> RoutedSession.enqueueMessage / drain
  -> frozen RuntimeSessionBinding
  -> prepare portable tools + runtime resources for one generation
  -> AgentRuntimeDriver.openSession
  -> AgentRuntimeSession.prompt
     -> Pi adapter: Pi AgentSession / native Pi loop
     -> Codex adapter: official App Server turn/start JSON-RPC
  -> AgentRuntimeSemanticEvent
  -> RoutedSession normalizes/correlates product output
  -> PiboSessionRouter.emitOutput
  -> product history, telemetry, signals, reliability, SSE
  -> Chat UI live trace
```

## Main flow

### 1. Browser and Chat API

1. The React composer posts a normal message to `/api/chat/message`; slash commands use `/api/chat/action`.
2. Chat Web authenticates the request, resolves the Pibo Session and room, deduplicates `clientTxnId`, and prepares annotations or attachments.
3. It persists `user.message.accepted` and the durable user message before runtime execution.
4. It calls `channelContext.emit({ type: "message", piboSessionId, ... })`.

### 2. Router and frozen binding

1. `PiboSessionRouter.emit()` finds or creates a `RoutedSession` keyed only by `PiboSession.id`.
2. Session creation resolves the profile, active model, and persisted `RuntimeSessionBinding`.
3. If the session is new, Pibo validates the selected configured runtime instance and persists an `unbound` binding. Profile edits do not change an existing binding.
4. The router creates one live generation id and prepares:
   - selected portable Pibo tools;
   - a runtime resource session for selected skills, context, and external MCP;
   - Pibo-managed subagent tools;
   - adapter-scoped model/options and environment.
5. The configured runtime driver opens or resumes the native session and returns a generic `AgentRuntimeSession` plus effective capabilities.
6. The router persists native identity/state with compare-and-set revision.

### 3. Queue and turn lifecycle

1. `RoutedSession.enqueueMessage()` appends input and emits `message_queued` immediately.
2. `drain()` processes one active message at a time and emits `message_started`.
3. The routed session invokes `runtimeSession.prompt(text, options)`.
4. The adapter owns native turn behavior:
   - Pi invokes its existing `AgentSession.prompt()` and Pi model/tool loop.
   - Codex sends stable App Server `turn/start` and consumes official notifications/server requests.
5. Abort, steering, model/reasoning controls, approvals, structured input, compaction, history, fork, and related operations dispatch only when the live capability snapshot supports them.

### 4. Semantic events and product output

Adapters emit Pibo-owned semantic events rather than product-routed events. `RoutedSession` adds Pibo Session identity, active-message correlation, content indices, tool ids, request ids, and terminal state.

Examples:

- assistant/reasoning deltas and terminal messages;
- tool call/start/update/finish;
- usage and context updates;
- approval or structured-input requests;
- warnings and normalized failures.

One native turn produces at most one product terminal outcome. Late or duplicate native terminal notifications are ignored after settlement.

### 5. Persistence and browser return path

`PiboSessionRouter.emitOutput()` updates telemetry and signals, notifies plugins, and publishes to subscribers. Chat Web then:

1. persists normalized events/messages and externalizes large payloads;
2. updates reliability state and live projections;
3. forwards compact events over `/api/chat/events` SSE;
4. serves runtime-neutral trace/timeline reads from product history;
5. lets the UI reconcile optimistic state with the canonical stream.

Native Pi transcripts and Codex threads remain resume state. Product-visible history for new routed turns does not require parsing native history.

## Provider-auth control path

```text
Settings > Providers
  -> GET/POST /api/chat/provider-auth
  -> explicit configured runtimeInstanceId + providerId
  -> PiboSessionRouter / AgentRuntimeAdapterRegistry capability dispatch
     -> Pi adapter: Pi AuthStorage and compatible OAuth/API-key operations
     -> codex-native adapter: private App Server account/* JSON-RPC
  -> Pibo-owned status/flow/result (no native ids or credentials)
  -> target-specific UI state and runtime-session cache invalidation
```

Provider settings are product/account scoped and do not emit conversation execution events. Legacy Terminal/TUI `login.*` actions enter through `/api/chat/action`, but Pibo resolves the supplied valid session's frozen runtime binding and rejects a conflicting target instead of bypassing routing.

## Pi branch

```text
AgentRuntimeSession.prompt
  -> Pi adapter
  -> Pi AgentSession.prompt
  -> Pi Agent Core runAgentLoop
  -> pi-ai provider stream
  -> Pi built-in or selected direct Pibo tools
  -> Pi adapter event normalization
  -> AgentRuntimeSemanticEvent
```

The Pi adapter retains the Pi base prompt, built-in tool policy, auth/model registry, packages, skills/context loading, extensions, compaction, recovery, transcript persistence, and native session operations.

## Native Codex branch

```text
AgentRuntimeSession.prompt
  -> codex-native adapter
  -> private Codex App Server process
  -> turn/start JSON-RPC
  -> native model loop and standard tools
  -> selected Pibo/external MCP through isolated thread config
  -> App Server notifications and server requests
  -> Codex adapter event normalization
  -> AgentRuntimeSemanticEvent
```

The adapter preserves Codex's native system prompt and standard tools. Pibo context is additive through supported developer/project channels. Selected skills use isolated extra roots. The generated Pibo MCP server has a generation-scoped credential and exact allowlist; external MCP retains native policy.

## Subagent branch

```text
model calls pibo_run_start(toolName: pibo_agents_send_message, arguments: { name, sessionName, message, threadKey? })
  -> yielded-run wrapper returns run ID
  -> shared Pibo delegated-send target
  -> Pibo delegated-agent router
  -> create/reuse child Pibo Session by bounded thread key and set its title from trimmed sessionName
  -> child freezes target profile runtime binding
  -> normal router/runtime flow
  -> child result settles the yielded run
```

`pibo_agents_send_message` is not directly callable. `name` selects the configured agent, `threadKey` selects reusable child identity, and required `sessionName` is its mutable human-readable title. The name is trimmed, must contain non-whitespace text, and is limited to 40 Unicode code points. `pibo_run_start` exposes the yielded target's argument schema and rejects invalid target input before admission or run persistence. `pibo_agents_list_agents`, `pibo_agents_observe`, and `pibo_agents_kill` manage direct child agents. Parent interruption cancels active child work recursively but does not delete reusable child identity; normal parent-turn completion, bounded `pibo_run_wait` expiry, and stale telemetry leave the child request running.

## Failure paths

- **Unsupported control:** generic dispatch returns an explicit capability diagnostic; it does not emulate silently.
- **Provider/protocol failure:** the adapter emits a normalized error and settles the message once. A later turn may recover on the same binding.
- **Interrupted Codex turn:** the adapter interrupts and recycles the App Server so a provider connection cannot remain live.
- **Missing native state:** the binding becomes `missing`; product history remains and no replacement native session is created.
- **Resource failure:** required failed or unsupported contributions block startup; generated files alone do not count as delivery.
- **Router disposal/rebind:** credentials are revoked, child work is cancelled, processes are stopped within bounds, and generation files are removed.

## Important source boundaries

- `src/agent-runtime/` — Pibo-owned contracts, capabilities, registry, errors, history, and testing support.
- `src/agent-runtimes/pi/` — Pi adapter and Pi-native concerns.
- `src/agent-runtimes/codex-native/` — official Codex App Server protocol, process, account auth, thread, turn, requests, models, history, and resource delivery.
- `src/core/session-router.ts` / `src/core/routed-session.ts` — product routing, queues, generation lifecycle, semantic-event correlation, controls, and output.
- `src/tools/` — portable Pibo tool contracts and session-scoped MCP bridge.
- `src/apps/chat/` — authenticated API, provider-auth control plane, product history, runtime-aware read models, workflows, and integration surfaces.
