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

