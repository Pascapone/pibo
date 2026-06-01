# Design: Context Build Inspector

## Summary

The Context Build Inspector is a read-only nested tree inside Chat Web's Context area. It explains how Pibo builds startup context for an explicitly selected session.

The UI does not render one duplicated final prompt. Instead, it renders ordered expandable nodes. When all nodes are expanded, the user can inspect the full represented context piece by piece.

## User Experience

### Location

Add a new sidebar item inside the existing Context area:

```text
Context
  Context Files
  Base Prompt
  Compaction Prompt
  Pibo Tools
  MCP Tools
  Build Context
```

The item opens `ContextBuildView` in the main panel.

### Default State

- The panel loads only when a session is selected through View Context.
- If no session is selected, the panel shows an empty-state hint and does not load a default profile preview.
- All top-level nodes start collapsed.
- The header shows profile, session source, active model when available, generated timestamp, and diagnostics count.

### Controls

- `Refresh`: regenerate the snapshot.
- `Expand all`: expand all nodes.
- `Collapse all`: collapse all nodes.
- `Copy section`: copy one node's hydrated content or rendered subtree.
- `Profile selector`: optional in V1 if selected-session profile is not enough.
- `Search`: optional in V1, useful for large trees.

### Node Pattern

Each node uses a trace-style card:

```text
▸ Runtime Session Context              generated · runtime · locked · 312 B
  pibo://runtime/session-context.md
```

Collapsed headers show:

- icon by kind
- title
- order index or sequence marker
- badges: active, generated, provider-backed, managed, plugin, pi, skipped, warning, error
- source/path/provider metadata
- byte count or child count

Expanded nodes show either:

1. child nodes, if the node is a parent, or
2. hydrated content in a monospaced code well, if the node is a leaf.

A node may contain both a short explanatory note and child nodes when needed.

## Visual Design

Follow `DESIGN.md`.

### Surfaces

- Main panel background: deep terminal charcoal.
- Node cards: panel teal black with thin slate borders.
- Expanded code/text content: near-black code well.
- Active/focused controls: Terminal Cyan.
- Warning/error diagnostics: Warning Orange / Error Red.

### Typography

- Headers: compact uppercase labels, 12px to 14px.
- Metadata: monospaced 10px to 12px, muted slate.
- Hydrated content: monospaced 12px.
- Body notes: 13px to 14px.

### Nesting

- Indent child nodes by a small fixed amount, about 12px per depth.
- Keep parent-child containment visible with left borders or lightly tinted nested containers.
- Avoid large gaps between nested nodes.

### Empty and Error States

- Empty state: quiet technical message, no marketing copy.
- Error state: concise error card with diagnostics and retry action.
- Loading: compact spinner or pulsing dot.

## Snapshot Data Model

Introduce a structured build snapshot. Names are illustrative and can be refined during implementation.

```ts
export type PiboContextBuildSnapshot = {
  version: 1;
  generatedAt: string;
  profileName: string;
  piboSessionId?: string;
  piboRoomId?: string;
  cwd: string;
  activeModel?: { provider: string; id: string };
  summary: {
    topLevelNodes: number;
    totalNodes: number;
    warnings: number;
    errors: number;
  };
  nodes: PiboContextBuildNode[];
  diagnostics: PiboContextBuildDiagnostic[];
};

export type PiboContextBuildNode = {
  id: string;
  parentId?: string;
  order: number;
  kind:
    | "prompt_section"
    | "tool_surface"
    | "tool"
    | "tool_prompt_snippet"
    | "tool_prompt_guidelines"
    | "tool_definition"
    | "provider_payload"
    | "context_files"
    | "context_file"
    | "skills"
    | "skill"
    | "runtime_extension"
    | "diagnostic"
    | "metadata";
  title: string;
  source:
    | "library"
    | "custom"
    | "managed"
    | "plugin"
    | "generated"
    | "pi"
    | "provider"
    | "runtime"
    | "profile";
  state?: "active" | "disabled" | "skipped" | "warning" | "error";
  badges?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  path?: string;
  key?: string;
  provider?: string;
  bytes?: number;
  children?: PiboContextBuildNode[];
  hydratedText?: string;
  schemaJson?: unknown;
  payloadJson?: unknown;
  notes?: string[];
  redacted?: boolean;
  approximate?: boolean;
};

export type PiboContextBuildDiagnostic = {
  type: "info" | "warning" | "error";
  message: string;
  nodeId?: string;
};
```

## Logical Tree Shape

The exact top-level order must follow actual assembly order for the inspected profile. A typical tree can look like this:

```text
Prompt / Runtime Shell
  Codex Compatibility Wrapper           generated, only when enabled
  Pibo Base Prompt                      library/custom
  Available Tools Marker                generated from selected tools
  Guidelines Marker                     generated from selected tools and guidelines

Tool Prompt Surface
  read                                  pi built-in
    Prompt Snippet
    Tool Definition
  bash                                  pi built-in
    Prompt Snippet
    Prompt Guidelines
    Tool Definition
  web_search                            provider-backed native tool
    Prompt Contribution
    Provider Payload
  pibo_run_start                        generated run-control tool
    Tool Definition

Context Files
  AGENTS.md                             pi auto context
  pibo://runtime/session-context.md     generated runtime context
  managed context file                  managed/plugin/profile-selected
  .pibo/context/installed-pibo-tools.md generated installed tool context
  .pibo/context/enabled-mcp-servers.md  generated MCP context

Skills
  pibo-docker-system                    skill markdown / prompt contribution
  writing-clearly-and-concisely         skill markdown / prompt contribution

Runtime Extensions
  Pibo system prompt template           generated/rendering
  Codex compatibility                   generated/wrapper
  Native web search provider adapter    provider prompt + payload

Diagnostics
  warnings and errors
```

This is a logical example. The implementation must preserve actual order. For example, Codex compatibility wraps the base prompt before the web-search extension appends its prompt contribution.

## Backend Design

### New Inspection Function

Add a function near runtime assembly, for example:

```ts
inspectPiboContextBuild(options: PiboRuntimeOptions): Promise<PiboContextBuildSnapshot>
```

The function should reuse runtime assembly inputs instead of reimplementing profile logic.

It should:

1. Resolve the profile and runtime cwd.
2. Load base prompt mode and source.
3. Resolve selected tools and generated tools.
4. Load and merge context files in runtime order.
5. Load selected skills.
6. Capture deterministic Pibo extension prompt contributions.
7. Capture provider-safe payload descriptions.
8. Return diagnostics.
9. Dispose temporary runtime resources.

### Avoiding Runtime Mutation

Use non-persistent inspection mode or an equivalent dry-run. The function must not send a user prompt, create user-visible sessions, or append transcript events.

### Prompt Contributions

Pibo controls some prompt contributions directly:

- Pibo base prompt template markers from `src/core/system-prompt-template.ts`
- runtime session context from `createSessionContextFile()`
- context-file merge order from `mergeContextFiles()`
- web-search prompt addition from `src/tools/web-search.ts`
- Codex compatibility wrapper from `src/core/codex-compat.ts`

Where possible, expose these as structured nodes from the same helper functions that create them. If a contribution cannot be split into exact sub-spans, mark the node with `approximate: true` and explain the boundary in `notes`.

### Tool Contributions

Tool nodes should use runtime session inspection data plus profile data:

- active names from `runtime.session.getActiveToolNames()`
- registered tools from `runtime.session.getAllTools()`
- profile tools from `InitialSessionContext.tools`
- generated Pibo tool names from subagent, run-control, Codex-compatible, and runtime tool helpers
- provider-backed metadata from `ToolProfile.providerTool`

Tool schema must be shown as structured JSON when available. If Pi tool definitions do not expose all prompt snippets or guidelines directly, show the available information and mark missing internals clearly.

### Context Files

Context-file nodes must come from `resourceLoader.getAgentsFiles().agentsFiles` after Pibo's override has run. This ensures the displayed order matches runtime merge order.

Each context file leaf shows:

- path
- source if known
- byte count
- hydrated content

For generated files, such as `pibo://runtime/session-context.md`, source is `generated` or `runtime`.

### Skills

Skill nodes should come from `resourceLoader.getSkills().skills`. Each skill node should show:

- name
- file path
- source kind when available
- markdown or prompt contribution
- diagnostics when loading failed

### Diagnostics

Return diagnostics both globally and attached to nodes when possible. Reuse existing `AgentSessionRuntimeDiagnostic` data, but adapt it to node ids where possible.

## Web API Design

Add an authenticated Chat Web endpoint. Exact route can be refined, but this shape is recommended:

```http
GET /api/chat/context-build?piboSessionId=<id>
```

Rules:

- Requires Chat Web session auth.
- `piboSessionId` is required, and the caller must have access to that session.
- Profile preview without a session is out of scope for V1.
- Response:

```json
{
  "snapshot": { "version": 1, "nodes": [] }
}
```

## Frontend Design

### Components

Suggested files:

```text
src/apps/chat-ui/src/context/ContextBuildView.tsx
src/apps/chat-ui/src/context/ContextBuildNodeCard.tsx
src/apps/chat-ui/src/context/contextBuildTypes.ts
```

### Rendering

- Use a recursive node-card renderer.
- Keep expansion state in the component.
- Use stable node ids for expansion state.
- Use lazy rendering for large leaf content.
- Render `schemaJson` and `payloadJson` with the existing JSON renderer pattern when feasible.
- Render `hydratedText` in a preformatted code well.

### Header

The main panel header should include:

- `Build Context`
- profile name
- session id when present
- active model when present
- generated timestamp
- warning/error counters
- controls: Refresh, Expand all, Collapse all

### Badges

Use compact badges:

- `ACTIVE`
- `GENERATED`
- `MANAGED`
- `PLUGIN`
- `PI`
- `PROVIDER`
- `PROVIDER-BACKED`
- `LOCKED`
- `SKIPPED`
- `APPROX`
- `WARNING`
- `ERROR`

## Security and Redaction

The snapshot must not expose:

- API keys
- OAuth tokens
- cookies
- auth headers
- bearer tokens
- provider credential store paths or contents
- hidden environment values

Provider payload nodes should show only safe, user-meaningful configuration. For web search, safe fields include provider id, tool kind, search context size, allowed domains, blocked domains, user-location metadata if already configured as non-secret, and source-inclusion settings.

## Testing Strategy

### Unit Tests

- Snapshot contains runtime session context node.
- Context-file order matches `mergeContextFiles()` behavior.
- Duplicate context paths are deduplicated or diagnosed.
- Provider-backed web search appears without a local definition.
- No final prompt duplicate node exists.
- Redaction removes secret-like fields.

### API Tests

- Unauthenticated request fails.
- Authenticated request returns a snapshot for an accessible session.
- Unauthorized session request fails.
- Response includes diagnostics when runtime inspection returns diagnostics.

### UI Tests

- Build Context sidebar item appears in Context area.
- Nodes start collapsed.
- Expanding parent reveals child nodes.
- Expanding leaf reveals hydrated content.
- Expand all reveals nested content without rendering a duplicate final prompt block.
- Error and loading states render with existing design language.

## Rollout

1. Implement backend snapshot generation behind tests.
2. Add web API.
3. Add Chat Web UI route/panel.
4. Test in a Docker compute worker.
5. Deploy to dev web gateway.
6. Deploy production only after dev validation and user approval.
