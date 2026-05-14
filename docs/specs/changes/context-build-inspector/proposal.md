# Proposal: Context Build Inspector

## Why

Pibo already assembles runtime context from several systems: the Pibo base prompt, selected tools, generated tool packages, runtime metadata, context files, skills, MCP descriptions, installed CLI tool hints, and runtime extensions. Today this assembly is hard to inspect from Chat Web. Users can edit parts of the context, but they cannot see how those parts become the model-visible startup context.

A read-only Context Build Inspector will make runtime assembly transparent. Users should be able to open it from a session, expand the build tree section by section, and understand where each part came from, what content it contributes, and where it appears in that session's startup context.

## What Changes

Add a new **Build Context** panel inside the Chat Web **Context** tab sidebar. The panel renders a nested, read-only tree of the hydrated runtime context for an explicitly selected session.

The tree starts collapsed. Each node header shows compact metadata, such as source, name, path, byte count, active state, and whether the node is generated or provider-backed. Expanding a leaf node shows the hydrated content that contributes to the runtime context. Expanding a parent node shows child nodes with the same metadata-header pattern.

V1 does not add drag-and-drop or editing. It also does not append a separate final prompt block. The tree itself is the prompt/context representation: when every node is expanded, the user can inspect the full model-visible startup context in assembly order.

## Capabilities

### New Capabilities

- `context-build-inspector`: read-only Chat Web UI and API for inspecting hydrated runtime context assembly.

### Modified Capabilities

- `chat-web-context-area`: gains a new Context sidebar category named **Build Context**.
- `pibo-runtime-assembly-and-inspection`: gains a structured inspection surface for hydrated context build nodes, not only summary profile metadata.

## Impact

- **Code:** Add runtime build snapshot generation, Chat Web API route, API client types, and a new Context panel component.
- **APIs / CLI:** Add a web API for build-context snapshots. CLI support is optional and out of V1 unless implementation chooses to reuse the same snapshot for diagnostics.
- **Data:** No new persistent data in V1. Snapshots are generated on demand.
- **Auth / Security:** The web API requires an authenticated Chat Web session. It must not expose provider secrets, auth tokens, or hidden credentials.
- **Docs:** Add this change spec and update relevant capability specs after implementation.
