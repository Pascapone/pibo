---
name: pi-agent-harness
description: Use when designing, specifying, implementing, or reviewing a modular system built around Pi Coding Agent / Pi Agent as an embedded agent engine. Trigger for Pi Agent docking, createAgentSession, custom tools, SessionManager, ResourceLoader, ExtensionRunner, Pi events, OpenClaw-style harnesses, plugin ecosystems, web chat channels, MCP/tool adapters, system prompt ownership, policy layers, or minimal runtimes around packages/coding-agent.
---

# Pi Agent Harness

## Core Idea

Treat Pi Coding Agent as a small, strong inner engine, not as the whole product.

Pi should own the model loop, streaming, tool-call execution plumbing, session persistence, compaction, and extension lifecycle. Your outer runtime should own product policy: channels, user identity, tool catalog, sandbox, prompt contract, plugin API, output delivery, approvals, memory, and UI.

Default rule:

```text
Do not expand Pi into your product.
Embed Pi inside your product.
```

OpenClaw is the reference pattern, but do not copy its breadth by default. Keep the first implementation raw and narrow: one runtime controller, one channel if needed, one tool registry, one prompt builder, one event aggregator, and a small hook surface.

## Source Map

Read only what the task needs. These are the important paths:

Pi product layer:

- `/home/pibo/code/pi-mono/packages/coding-agent/README.md` - product philosophy: minimal core, modes, skills, extensions, explicit tools.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/main.ts` - CLI entry and mode dispatch.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/sdk.ts` - `createAgentSession(...)`, SDK options, model/auth/settings wiring.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/agent-session.ts` - prompt pipeline, event persistence, compaction, tool registry, extension integration.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/session-manager.ts` - append-only JSONL session tree, branch/fork/compaction context.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/resource-loader.ts` - loads context files, skills, prompts, themes, extensions, `SYSTEM.md`, `APPEND_SYSTEM.md`.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/system-prompt.ts` - default prompt builder and tool/context/skill prompt assembly.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/extensions/types.ts` - extension contract and event names.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/core/extensions/runner.ts` - extension lifecycle, stale-context guard, event dispatch.
- `/home/pibo/code/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts` - TUI integration, commands, selectors, rendering of events.

Lower engine layers:

- `/home/pibo/code/pi-mono/packages/agent/src/agent.ts` - stateful agent wrapper, `subscribe`, `prompt`, `steer`, `followUp`.
- `/home/pibo/code/pi-mono/packages/agent/src/agent-loop.ts` - turn loop, streaming, tool execution, event emission.
- `/home/pibo/code/pi-mono/packages/ai/src/stream.ts` - provider dispatch.
- `/home/pibo/code/pi-mono/packages/tui/src/tui.ts` - terminal rendering if building TUI surfaces.

OpenClaw reference pattern:

- `/home/pibo/docs/research/tools/openclaw-pi-agent-docking-concept.md` - concise docking analysis.
- `/home/pibo/code/openclaw/src/agents/pi-embedded-runner/run/attempt.ts` - embedded runner assembly.
- `/home/pibo/code/openclaw/src/agents/pi-tools.ts` - OpenClaw tool catalog assembler.
- `/home/pibo/code/openclaw/src/agents/pi-tool-definition-adapter.ts` - OpenClaw tool to Pi `ToolDefinition` adapter.
- `/home/pibo/code/openclaw/src/agents/pi-embedded-runner/tool-split.ts` - custom-tool authority pattern.
- `/home/pibo/code/openclaw/src/agents/pi-embedded-runner/system-prompt.ts` - external system prompt ownership.
- `/home/pibo/code/openclaw/src/agents/pi-embedded-subscribe.ts` - Pi event subscription to product output.
- `/home/pibo/code/openclaw/src/plugins/types.ts` - broad plugin-hook vocabulary, useful as design reference.

## Mental Model

Pi Coding Agent has four relevant surfaces:

1. Runtime creation via `createAgentSession(...)`.
2. Persistent state via `SessionManager`.
3. Runtime resources via `DefaultResourceLoader` and extensions.
4. Streamed lifecycle events via `session.subscribe(...)` and underlying `agent.subscribe(...)`.

The minimal outer harness should look like this:

```text
User / Channel / Web App
  -> Runtime Controller
    -> Prompt Builder
    -> Tool Registry + Policy + Sandbox + MCP adapters
    -> Hook Runner / Plugin Registry
    -> SessionManager
    -> Pi createAgentSession(... customTools ...)
    -> Event Aggregator
  -> Product Reply / Run Result
```

Keep product boundaries outside Pi. Pi events are internal engine events; transform them into your own run result before sending anything to a web UI, chat channel, API, or queue.

## Minimal Runner Pattern

Start from a thin runner. Add complexity only when a product requirement forces it.

```ts
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

const sessionManager = SessionManager.open(sessionFile, sessionDir, workspaceDir);
const settingsManager = SettingsManager.create(workspaceDir, agentDir);

const resourceLoader = new DefaultResourceLoader({
  cwd: workspaceDir,
  agentDir,
  settingsManager,
  extensionFactories,
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd: workspaceDir,
  agentDir,
  model,
  thinkingLevel,
  sessionManager,
  settingsManager,
  resourceLoader,
  noTools: "builtin",
  customTools,
});

const unsubscribe = session.subscribe((event) => {
  aggregatePiEventIntoProductRun(event);
});

await session.prompt(userText, { source: "rpc" });
```

Notes:

- Use `noTools: "builtin"` when your own custom tools should be the authority and Pi built-ins should not be visible.
- If using an explicit `tools` allowlist in current Pi SDK, include every custom tool name you still want exposed; an empty allowlist can filter custom tools too.
- Use `session.steer(...)` for steering while a run is active, `session.followUp(...)` for queued follow-up work after the agent would otherwise stop.
- Dispose/unsubscribe on session replacement or request shutdown.

## Tool Authority

Do not let the model see raw implementation power. Let it see a curated capability catalog.

Recommended shape:

```text
ProductTool
  -> policy check
  -> sandbox/workspace guard
  -> plugin beforeToolCall hooks
  -> execute
  -> normalize result
  -> plugin afterToolCall hooks
  -> Pi ToolDefinition result
```

Use Pi `customTools` as the transport into the agent loop. Build your own adapter from product tools to Pi `ToolDefinition`:

- preserve `name`, `description`, `parameters`
- accept `toolCallId`, params, abort signal, update callback
- run policy before execution
- return normalized `content[]` tool results
- convert non-abort failures into structured tool errors
- avoid throwing raw product exceptions into the loop

For MCP, browser tools, filesystem tools, subprocesses, message sending, or hosted tools, use the same path: register them in your product registry, apply policy there, then adapt them to Pi custom tools. Do not expose MCP as an ungoverned side channel.

OpenClaw reference: `src/agents/pi-tool-definition-adapter.ts`.

## Prompt Ownership

Pi can build a good default system prompt, but a product harness usually needs one explicit runtime contract.

Own the prompt outside Pi when product behavior depends on:

- channel or delivery rules
- visible tool names
- workspace and sandbox rules
- user identity and trust boundaries
- memory/docs/skills policy
- plugin prompt contributions
- final-output formatting

Minimal prompt builder inputs:

```text
base persona
runtime info
workspace info
visible tool names
channel rules
policy boundaries
optional docs/memory/skills context
plugin prepend/append system context
```

Prefer public hooks first. If you must force a full prompt override, isolate that private-field access in one helper and mark it as version-sensitive. OpenClaw uses this pattern in `src/agents/pi-embedded-runner/system-prompt.ts`.

## Sessions

Treat Pi `SessionManager` as the durable transcript layer.

Important properties:

- sessions are append-only JSONL files
- entries form a tree with `id` and `parentId`
- the current leaf determines the active LLM context
- branch, fork, tree navigation, compaction, labels, model changes, and custom entries are part of the session model
- `buildSessionContext()` resolves the path from root to leaf and inserts compaction summaries

Product guidance:

- Keep product run metadata outside the raw message content unless the model must see it.
- Use custom entries for internal markers that belong in the session file.
- Guard or validate session files if external systems can create or modify them.
- Do not rewrite history casually; branch or append instead.

## Extensions And Hooks

Use Pi extensions for lifecycle integration close to Pi. Use your own plugin API for product integrations.

Pi extension events worth knowing:

- `resources_discover` - add skills, prompt templates, themes.
- `input` - transform or handle user input before prompt/template expansion.
- `before_agent_start` - add custom messages or modify the per-turn system prompt.
- `context` - transform message context before provider request.
- `before_provider_request` / `after_provider_response` - observe or rewrite provider payloads.
- `tool_call` / `tool_result` - mutate or block Pi tool calls and inspect results.
- `tool_execution_start/update/end` - stream product-visible tool status.
- `message_start/update/end` - aggregate assistant/user/tool messages.
- `session_before_compact` / `session_compact` - customize or observe compaction.
- `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_shutdown` - protect session transitions.

Pi extension capabilities:

- `registerTool(...)`
- `registerCommand(...)`
- `registerShortcut(...)`
- `registerFlag(...)`
- custom UI methods when interactive UI exists
- custom message renderers
- provider registration through runtime actions

Stale-context rule: after `newSession`, `fork`, `switchSession`, or `reload`, old extension contexts are invalid. Move post-replacement work into the provided `withSession` callback.

## Product Plugin Layer

For a modular system inspired by OpenClaw, plugins should normally dock into your harness, not directly into Pi.

Start with a tiny hook API:

```ts
type Plugin = {
  id: string;
  tools?: ProductTool[];
  beforePromptBuild?(ctx): PromptPatch | void | Promise<PromptPatch | void>;
  beforeToolCall?(event, ctx): ToolDecision | void | Promise<ToolDecision | void>;
  afterToolCall?(event, ctx): void | Promise<void>;
};
```

Keep V1 hooks boring:

- `beforePromptBuild` can add prepend/append system context.
- `beforeToolCall` can patch params, block, or request approval.
- `afterToolCall` can observe normalized results and side effects.

Add richer hooks only after a real integration needs them. This keeps Pi small and keeps your product policy testable outside the agent loop.

## Event Aggregation

Never wire Pi events directly to a product channel.

Build an aggregator that turns engine events into your product contract:

- final assistant text
- partial assistant updates
- reasoning stream if enabled
- tool start/update/end summaries
- normalized tool results
- usage and model metadata
- compaction/retry status
- side effects such as message sent or file changed
- final run status and error state

This gives you one stable boundary for web chat, CLI, API, queues, or future channels.

## Web-First Minimal Channel

If the product starts as a web chat, keep channel complexity outside the Pi runner:

```text
Web App
  -> HTTP/SSE/WebSocket endpoint
  -> Runtime Controller
  -> Pi Runner
  -> Event Aggregator
  -> Web stream + persisted run result
```

The web channel should provide user/session identity, delivery format, and cancellation. The Pi runner should not know about DOM, routes, Telegram, Slack, WhatsApp, or frontend state. Future channels should reuse the same runtime controller and event aggregator.

## Design Checklist

Before implementing a Pi-based harness, answer these in writing:

- What does Pi own, and what does the product own?
- Where is the session file, and who may write it?
- Which tools are visible to the model for this run?
- Where do sandbox and workspace rules run?
- Which hook can block or mutate a tool call?
- Who builds the final system prompt?
- How are Pi events converted into product output?
- What is the smallest plugin API that satisfies V1?
- What is explicitly not in V1?

If the answer requires adding broad product behavior inside Pi itself, redesign the boundary.

## Common Mistakes

- Do not add channels, approvals, memory, MCP, or plugin policy directly to Pi core just because the outer product needs them.
- Do not rely only on prompt text for security-critical tool policy.
- Do not expose Pi built-in tools and product tools together without a deliberate allowlist.
- Do not let plugins mutate Pi internals directly when a harness hook can express the same behavior.
- Do not treat `agent_end` as a UI-ready response; aggregate and normalize first.
- Do not assume OpenClaw's broad implementation is the desired V1. Copy the docking principle, not the feature surface.
