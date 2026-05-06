---
title: MCP Agent Context and Designer Integration
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [architecture, mcp, agent-designer, context, cli]
---

# Introduction

This specification defines the implemented integration of configured MCP servers into Pibo's Agent Designer and runtime context. MCP servers remain external operator-managed integrations, but custom agents can opt into short model-visible hints that tell the agent which MCP servers exist and how to discover or call them through `pibo mcp`.

## 1. Purpose & Scope

This specification covers:

- Adding an MCP Servers section to the Agent Designer.
- Adding agent-facing MCP server descriptions to `mcp_servers.json`.
- Allowing descriptions to be set through the MCP CLI and the Chat Web Context area.
- Persisting selected MCP servers on custom agents.
- Injecting selected MCP server hints into the Pi Coding Agent context.

This specification does not require MCP tools to become native Pi custom tools. Direct MCP tool adapter work is out of scope for this first integration.

## 2. Definitions

- **MCP CLI**: The `pibo mcp` operator CLI for configuring, discovering, and calling external Model Context Protocol servers.
- **MCP Server**: An external stdio or HTTP Model Context Protocol server configured in `mcp_servers.json`.
- **MCP Tool Context**: A short agent-facing text that explains why a configured MCP server exists and how an agent should begin discovery.
- **MCP Agent Context**: A generated context document injected into a runtime profile when a custom agent selects one or more described MCP servers.
- **Agent Designer**: The Chat Web App UI used to create and edit custom agents.
- **MCP Tools View**: The Chat Web Context area used to view and edit MCP tool context metadata.
- **Custom Agent**: A user-owned profile stored in `.pibo/chat-agents.sqlite` and registered dynamically with the Pibo plugin registry.
- **Registry Description**: An MCP server description supplied by a curated registry preset and treated as read-only in the UI.
- **User Description**: An MCP server description supplied manually through CLI or UI and editable by the user.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The Agent Designer MUST expose an `MCP Servers` selection section near the existing profile capability sections, preferably directly below `Subagents`.
- **REQ-002**: The `MCP Servers` section MUST list configured MCP servers from the active `mcp_servers.json` lookup path.
- **REQ-003**: The Agent Designer MUST show whether each MCP server has an agent-facing description.
- **REQ-004**: A configured MCP server without a description MUST be visible with a warning or missing-description state.
- **REQ-005**: The Agent Designer MUST NOT inline-edit MCP server descriptions; it MUST provide a navigation action to the Context area's `MCP Tools` view.
- **REQ-006**: A user MUST be able to add or edit a user-owned MCP server description from the CLI.
- **REQ-007**: A user MUST be able to add or edit user-owned MCP tool context from the Chat Web Context area's `MCP Tools` view.
- **REQ-007A**: Registry-provided MCP server descriptions MUST be read-only in the `MCP Tools` view.
- **REQ-008**: Custom agents MUST persist selected MCP server names separately from native tools, skills, packages, context files, and subagents.
- **REQ-009**: A runtime MUST inject MCP agent context only for MCP servers selected by the active custom agent.
- **REQ-010**: A runtime MUST NOT inject MCP agent context for every configured MCP server by default.
- **REQ-011**: A runtime MUST NOT inject MCP server tool schemas, full server instructions, or full config values into model context.
- **REQ-012**: MCP agent context MUST include the selected server name, the short description, and compact discovery commands such as `pibo mcp info <server>` and `pibo mcp call <server> <tool> '<json>'`.
- **REQ-013**: The MCP server catalog exposed to Chat Web MUST be built from local config metadata and MUST NOT connect to MCP servers while rendering the Agent Designer.
- **REQ-014**: MCP server descriptions SHOULD be short and bounded. The initial maximum SHOULD match the curated Pibo Tools snippet limit of 480 characters unless implementation constraints require a different limit.
- **REQ-015**: Existing configured MCP servers without descriptions MUST continue to work for CLI list, info, grep, and call commands.
- **REQ-016**: The `pibo mcp` CLI help MUST remain progressively discoverable.
- **CON-001**: MCP servers remain external processes or HTTP services configured outside the Pibo plugin runtime.
- **CON-002**: This feature provides model-visible hints, not MCP-to-native-tool execution.
- **CON-003**: The generated MCP context must be opt-in per custom agent.
- **CON-004**: The MCP server config can contain machine-specific paths and environment variables; UI and context output MUST avoid leaking full sensitive config unless explicitly requested by existing config commands.
- **GUD-001**: The Agent Designer should disable or discourage selecting an MCP server without a description, because such a selection would add little value to model context.
- **GUD-002**: The UI should use the existing compact technical panel style and squared controls defined in `DESIGN.md`.

## 4. Interfaces & Data Contracts

### 4.1 MCP Config Metadata

MCP server config should support an optional Pibo-owned metadata object:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "pibo": {
        "description": "Access project files through the configured filesystem MCP server.",
        "descriptionSource": "user"
      }
    }
  }
}
```

Valid `descriptionSource` values:

- `user`: Description was set manually through CLI or UI and is editable.
- `registry`: Description was supplied by a curated registry preset and is read-only.

### 4.2 CLI Surface

The MCP config command surface should add:

```bash
pibo mcp config describe <server> "<description>"
```

Out of scope for this implementation:

- `pibo mcp config undescribe <server>`
- native Pi custom tools generated from MCP tool schemas
- direct MCP connections during Agent Designer catalog rendering

`pibo mcp config help` should list the immediate commands only. Detailed metadata schema examples should stay behind `pibo mcp config schema`.

### 4.3 Agent Catalog

`PiboCapabilityCatalog` should add:

```ts
type PiboMcpServerInfo = {
  name: string;
  transport: "stdio" | "http";
  description?: string;
  descriptionSource?: "user" | "registry";
  hasDescription: boolean;
  editable: boolean;
};
```

The Chat Web `AgentCatalog` should expose:

```ts
mcpServers: PiboMcpServerInfo[];
```

### 4.4 Custom Agent Data

`CustomAgentDefinition` should add:

```ts
mcpServers: string[];
```

The custom agent store should persist this value in a new `mcp_servers_json` column with migration support for existing databases.

### 4.5 Runtime Context

Selected MCP servers with descriptions produce a synthetic context file:

```text
.pibo/context/enabled-mcp-servers.md
```

Example generated content:

```md
# Enabled MCP Servers

These MCP servers are enabled for this agent. Use the MCP CLI for discovery and calls.

## filesystem
Access project files through the configured filesystem MCP server.

Discover: `npm run dev -- mcp info filesystem`
Call: `npm run dev -- mcp call filesystem <tool> '<json>'`
```

The runtime skips selected servers that are missing from the active config or do not have a description. If no selected server can produce useful context, no synthetic MCP context file is injected.

## 5. Acceptance Criteria

- **AC-001**: Given a configured MCP server without `pibo.description`, when the Agent Designer loads, then the MCP server appears with a missing-description warning.
- **AC-002**: Given a user opens an MCP server from the Agent Designer, when they click Edit, then Chat Web navigates to Context > MCP Tools with that server prioritized.
- **AC-002A**: Given a user enters valid MCP tool context in Context > MCP Tools, when it is saved, then the active MCP config contains the description with `descriptionSource: "user"`.
- **AC-003**: Given a user runs `pibo mcp config describe filesystem "..."`, when the command succeeds, then the description is written without changing command, args, env, cwd, url, headers, allowedTools, or disabledTools.
- **AC-004**: Given a custom agent selects `filesystem`, when the custom agent is saved, then its stored definition includes `mcpServers: ["filesystem"]`.
- **AC-005**: Given a custom agent selects a described MCP server, when a runtime is built for that profile, then `.pibo/context/enabled-mcp-servers.md` is present in loaded context files.
- **AC-006**: Given a custom agent selects no MCP servers, when a runtime is built, then no MCP server context file is injected.
- **AC-007**: Given an MCP server has `descriptionSource: "registry"`, when Context > MCP Tools renders it, then the description is visible but not editable.
- **AC-008**: Given the Agent Designer requests the MCP catalog, when MCP servers are configured, then the backend must not start stdio server processes or make HTTP MCP requests.

## 6. Test Automation Strategy

- **Unit tests**:
  - MCP config metadata parsing and preservation.
  - CLI `config describe` behavior and validation.
  - MCP server catalog generation from local config.
  - MCP context document generation.
  - Custom agent store migration and persistence for `mcpServers`.

- **Integration tests**:
  - Chat Web agent create/update API persists `mcpServers`.
  - Runtime profile inspection includes `.pibo/context/enabled-mcp-servers.md` only when selected.
  - Agent catalog includes MCP server metadata without establishing MCP connections.

- **UI tests/manual checks**:
  - Agent Designer renders MCP Servers below Subagents.
  - Missing-description state is visible.
  - Agent Designer MCP rows navigate to Context > MCP Tools for editing.
  - User descriptions can be edited in Context > MCP Tools.
  - Registry descriptions are read-only in Context > MCP Tools.

Focused commands include:

```bash
node --test test/mcp-cli.test.mjs
node --test test/agent-store.test.mjs
node --test test/mcp-agent-context.test.mjs
node --test test/web-channel.test.mjs
```

Full validation:

```bash
npm run typecheck
npm test
```

## 7. Rationale & Context

Pibo currently has two separate external capability surfaces:

- `pibo tools` manages curated external CLI tools and injects a short installed-tool context document into runtimes.
- `pibo mcp` manages external MCP servers but does not currently expose them through profiles or runtime context.

The desired integration is to make MCP visible and selectable in the same Agent Designer mental model as native tools, skills, packages, context files, and subagents, while editing the model-visible MCP text in the Context area alongside other context sources. The model should receive only a short hint that an MCP server exists. This preserves the current operator-CLI boundary and avoids turning MCP servers into ungoverned runtime tool side channels.

Native MCP tool adapters can be designed later as a separate product capability with explicit policy, sandbox, permissions, and execution normalization.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Configured MCP servers - External stdio or HTTP MCP services invoked only through existing `pibo mcp` CLI paths.

### Infrastructure Dependencies

- **INF-001**: `mcp_servers.json` - Local ignored config file used as the source of truth for MCP server definitions and Pibo-owned MCP metadata.
- **INF-002**: `.pibo/chat-agents.sqlite` - Custom agent store requiring migration for selected MCP server names.

### Technology Platform Dependencies

- **PLT-001**: Chat Web App - Agent Designer UI must consume the extended agent catalog and custom agent API.
- **PLT-002**: Pi Coding Agent resource loading - Runtime context injection should reuse the existing additional agents-file pattern used for installed Pibo Tools.

## 9. Examples & Edge Cases

### Existing Manual MCP Server Without Description

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Expected UI state:

- Server is listed.
- Transport is `stdio`.
- Description is missing.
- Edit/Add description action opens Context > MCP Tools.
- Selection should be disabled or warning-gated until a description exists.

### Registry-Owned Description

```json
{
  "mcpServers": {
    "example": {
      "command": "<HOME>/.pibo/mcp-tools/example/.venv/bin/example-mcp",
      "pibo": {
        "description": "Search example service records through the curated MCP preset.",
        "descriptionSource": "registry"
      }
    }
  }
}
```

Expected UI state:

- Description is visible.
- Description edit action is disabled.
- Server can be selected for custom agent context.

### Removed MCP Server

If a custom agent references an MCP server that no longer exists in the active config, the runtime skips context injection for that missing server. If all selected servers are missing or undescribed, the synthetic MCP context file is not injected.

## 10. Validation Criteria

- Existing MCP CLI behavior remains compatible.
- Existing custom agents load after database migration.
- Existing profiles without MCP selections produce identical runtime context except for unrelated generated ordering differences.
- The Agent Designer can render with an empty `mcp_servers.json`.
- The Agent Designer can render when no MCP config file existed before the backend created one.
- Model-visible context never includes raw MCP server environment variables, headers, or full config JSON.

## 11. Related Specifications / Further Reading

- [Pibo Operator CLI Specification](./spec-tool-operator-cli.md)
- [Pibo Runtime Boundary Specification](./spec-architecture-runtime-boundary.md)
- [Pibo MCP Documentation](../docs/mcp.md)
- [Installed Pibo Tool Context](../docs/pibo-tools-context.md)
- [Pibo Glossary](../GLOSSARY.md)
