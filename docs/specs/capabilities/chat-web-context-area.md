# Spec: Chat Web Context Area

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Context Files](./context-files.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md), [Curated CLI Tools](./curated-cli-tools.md), [MCP Server Integration](./mcp-server-integration.md), [Chat Web Bootstrap and Navigation API](./chat-web-bootstrap-and-navigation-api.md)

## Why

Chat Web has a dedicated Context area for resources that shape future agent runs: managed context files, runtime prompts, installed curated-tool hints, and MCP agent-facing descriptions. These panels affect runtime behavior but are not chat transcripts, room state, or general user settings.

A clear Context-area contract prevents UI navigation, catalog data, and resource editors from drifting into duplicate settings surfaces or hidden runtime mutations.

## Goal

Chat Web MUST expose runtime-context resources through one bounded Context area, with panel-specific behavior delegated to the owning capability and with catalog-derived read-only views separated from editable resource stores.

## Background / Current State

`src/apps/chat-ui/src/App.tsx` defines a top-level `context` area and six context panels: `context-files`, `base-prompt`, `compaction-prompt`, `pibo-tools`, `mcp-tools`, and `build-context`. The sidebar labels the panels as Context Files, Base Prompt, Compaction Prompt, Pibo Tools, MCP Tools, and Build Context. The current route model has one `/context` route; the selected panel is React state, not a URL path segment, with an optional `piboSessionId` route value for Build Context inspection.

The main pane renders the owning view for the selected panel:

- `ContextFilesView` for managed and plugin context files.
- `BasePromptView` for the workspace base prompt mode and custom content.
- `CompactionPromptView` for the workspace compaction prompt mode and custom content.
- `PiboToolsView` for installed curated-tool context snippets from the agent catalog.
- `McpToolsView` for configured MCP server metadata and Pibo-managed descriptions.
- `ContextBuildView` for a read-only selected-session runtime context snapshot.

The Chat Web bootstrap/catalog API builds context-facing catalog data from the channel capability catalog, `listMcpServerInfos()`, installed Pi packages, and user skills.

## Scope

### In Scope

- Top-level Chat Web Context area behavior.
- Context sidebar panel list, counts, selected-session Build Context entry, and panel selection.
- Routing behavior for `/context` and cross-area links that open a specific context editor.
- Separation between editable resource panels and read-only catalog-derived context panels.
- Bootstrap/catalog data required by Context panels.
- Selected-session Build Context navigation and read-only rendering.

### Out of Scope

- Context-file storage, revisions, diffing, and plugin linking — covered by Context Files.
- Prompt parsing, persistence, validation, and runtime rendering — covered by Runtime Prompt and Compaction Configuration.
- Curated CLI installation and shell usage — covered by Curated CLI Tools.
- MCP config, CLI calls, runtime injection, and server validation — covered by MCP Server Integration.
- General settings panels for providers, Pi packages, user skills, and timezone — covered by Chat Web Settings Area.

## Requirements

### Requirement: Context is a distinct top-level Chat Web area

The Chat Web shell MUST expose Context as a top-level area separate from Sessions, Projects, Cron, Agents, and Settings.

#### Current

`Area` includes `"context"`, the primary navigation renders a Context item, and `navigateToRoute({ area: "context" })` navigates to `/context`.

#### Target

Users can reach runtime-context resources without opening a chat session, agent designer, or settings panel.

#### Acceptance

- The primary navigation contains a Context entry.
- Selecting Context navigates to `/context`.
- The Context area renders the Context sidebar and a context panel instead of the session trace pane.
- Opening `/context` does not require a selected Pibo Session.

#### Scenario: Open Context from navigation

- GIVEN the user is viewing a room session
- WHEN the user selects Context in the primary navigation
- THEN the browser navigates to `/context`
- AND the app renders the Context sidebar and selected Context panel.

### Requirement: Context panel selection is bounded

The Context sidebar MUST expose only the supported context panels and MUST render exactly one selected panel.

#### Current

`ContextPanel` is one of `context-files`, `base-prompt`, `compaction-prompt`, `pibo-tools`, `mcp-tools`, or `build-context`. `ContextSidebar` has one button for each value, and the main pane chooses one corresponding component.

#### Target

Users cannot enter an unsupported Context panel state through normal UI actions, and each supported panel has an explicit controller.

#### Acceptance

- The sidebar shows Context Files, Base Prompt, Compaction Prompt, Pibo Tools, MCP Tools, and Build Context.
- Selecting a sidebar item updates the selected panel without changing the top-level area.
- The main pane renders only the component for the active panel.
- Unsupported panels are not exposed in the sidebar.

#### Scenario: Switch from prompts to tools

- GIVEN the Context area is showing Base Prompt
- WHEN the user selects Pibo Tools
- THEN the active sidebar item changes to Pibo Tools
- AND the main pane renders installed curated-tool context snippets.

#### Scenario: Switch to Build Context

- GIVEN the Context area is open
- WHEN the user selects Build Context
- THEN the active sidebar item changes to Build Context
- AND the main pane renders the read-only Build Context panel.

### Requirement: Cross-area links open the correct Context panel

Actions outside the Context area that edit or inspect context resources MUST navigate to Context and select the resource-owning panel.

#### Current

`openContextFileEditor(key)` stores the selected context-file key, selects `context-files`, and navigates to `/context`. `openMcpToolsEditor(name)` stores the selected MCP server name, selects `mcp-tools`, and navigates to `/context`. `viewSessionContext(piboSessionId)` selects `build-context` and navigates to `/context?piboSessionId=<id>` through the route helper.

#### Target

Agent Designer and catalog links can send users to the correct editor without adding duplicate editors to those areas.

#### Acceptance

- A context-file edit action from another area opens `/context` with the Context Files panel selected and the requested file key available to `ContextFilesView`.
- An MCP tools edit action from another area opens `/context` with the MCP Tools panel selected and the requested server name available to `McpToolsView`.
- A View Context action opens `/context` with the Build Context panel selected and the requested Pibo Session ID available to `ContextBuildView`.
- These links do not mutate the underlying context resource before the destination editor or inspector loads.

#### Scenario: Edit agent context file

- GIVEN the Agent Designer lists a context file for a draft agent
- WHEN the user chooses to edit that file
- THEN Chat Web opens `/context`
- AND the Context Files panel receives the selected file key.

#### Scenario: View session build context

- GIVEN a session row or session action menu exposes View Context
- WHEN the user chooses View Context
- THEN Chat Web opens the Context area with Build Context selected
- AND the selected Pibo Session ID is passed to the Build Context view.

### Requirement: Catalog-derived context views are read-only unless their owning capability supports editing

The Context area MUST distinguish read-only catalog hints from panels that edit Pibo-managed resource state.

#### Current

`PiboToolsView` renders installed curated-tool names, descriptions, and snippets from `agentCatalog.piboTools`; it has no mutation controls. `McpToolsView` receives MCP server records and an `onServerSaved` callback for description updates. Prompt and context-file panels call their own APIs for supported edits.

#### Target

Users can inspect which context snippets enter agent runtimes without confusing catalog output with editable runtime state.

#### Acceptance

- Pibo Tools shows the number of installed tools and renders an empty state when no tools are installed.
- Pibo Tools does not offer install, remove, or edit controls; those remain CLI/curated-tool behavior.
- MCP Tools may save Pibo-managed server descriptions but does not expose full MCP config editing.
- Prompt and context-file panels remain the only Context panels that edit prompt files or managed context-file documents.

#### Scenario: No curated tools installed

- GIVEN the bootstrap catalog contains `piboTools: []`
- WHEN the user opens the Pibo Tools context panel
- THEN the panel shows that no curated Pibo Tools are installed
- AND no install form is shown.

### Requirement: Context counts come from bootstrap/catalog data

The Context sidebar MUST show counts for installed curated tools and configured MCP servers using the current bootstrap agent catalog.

#### Current

`ContextSidebar` receives `toolCount={bootstrap.agentCatalog?.piboTools.length ?? 0}` and `mcpServerCount={bootstrap.agentCatalog?.mcpServers.length ?? 0}`. `buildAgentCatalog()` loads MCP server info and includes catalog-provided `piboTools`.

#### Target

The Context sidebar summarizes context-resource availability without issuing separate UI-only count requests.

#### Acceptance

- If bootstrap lacks an agent catalog, the Pibo Tools and MCP Tools counts render as `0`.
- If bootstrap includes installed Pibo tool hints, the Pibo Tools count equals the number of catalog entries.
- If bootstrap includes MCP server infos, the MCP Tools count equals the number of configured server entries.
- After a successful MCP description save, the bootstrap-side MCP server entry is updated without requiring a full app reload.

#### Scenario: Catalog contains MCP servers

- GIVEN bootstrap returns three MCP server records
- WHEN the Context sidebar renders
- THEN the MCP Tools count is `3`.

### Requirement: Context routing remains shallow unless panel URLs are implemented deliberately

The app MUST treat `/context` plus optional selected-session query state as the current public Context route and MUST NOT imply that unsupported panel-specific URLs are stable.

#### Current

`ChatAppRoute` represents Context as `{ area: "context", piboSessionId?: string }` without a panel field. Panel selection is held in `contextPanel` state. Unlike Settings, Context does not define `/context/<panel>` routes.

#### Target

Deep links to the Context area stay stable while future panel-specific routing can be added as an explicit compatibility change.

#### Acceptance

- Programmatic navigation to general Context uses `/context`.
- View Context navigation may include the selected Pibo Session ID in the Context route query state.
- Panel changes do not update the browser path in the current implementation.
- Tests or docs must not rely on `/context/pibo-tools`, `/context/mcp-tools`, `/context/build-context`, or similar routes until the route model adds them.

#### Scenario: Switch panel without route change

- GIVEN the browser URL is `/context`
- WHEN the user switches from Context Files to MCP Tools
- THEN the URL remains `/context`
- AND the MCP Tools panel renders.

## Edge Cases

- Bootstrap may load before `agentCatalog` is present; counts and panels must tolerate missing catalog data.
- A selected context-file key or MCP server name may no longer exist by the time the editor loads; the owning view must show its existing missing-resource behavior.
- The Context area must remain usable without a selected session because prompt, context-file, tool, and MCP metadata are not session-local views; Build Context shows a no-session empty state until a session is selected.
- Browser refresh on `/context` restores the default Context Files panel unless future code persists or routes panel selection.

## Constraints

- **Compatibility:** `/context` is the only current public Context route.
- **Security / Privacy:** All editable Context APIs must remain authenticated and same-origin protected by their owning capability.
- **Separation of concerns:** Context area composition must not duplicate CLI installation, MCP config editing, prompt parsing, or context-file revision logic.
- **Performance:** Counts and read-only panel data should use bootstrap/catalog state instead of extra per-panel count requests.

## Success Criteria

- [ ] SC-001: Chat Web navigation can open `/context` without a selected Pibo Session.
- [ ] SC-002: The Context sidebar exposes exactly the six supported panels and renders one active panel at a time.
- [ ] SC-003: Context-file, MCP, and View Context actions from other areas select the correct Context panel and pass the selected key/name/session id.
- [ ] SC-004: Pibo Tools is read-only and handles the empty installed-tools state.
- [ ] SC-005: Context sidebar counts match bootstrap catalog `piboTools` and `mcpServers` lengths.
- [ ] SC-006: Panel switching does not create undocumented `/context/<panel>` routes.

## Assumptions and Open Questions

### Assumptions

- The current shallow `/context` route is intentional until panel-specific deep links are added.
- Runtime-context resources are grouped by their effect on future agent context, not by shared storage implementation.

### Open Questions

- Should Context panel selection be URL-addressable like Settings panels?
- Should the selected Context panel persist in browser storage between visits?
- Should the Pibo Tools panel link directly to CLI guide commands as copyable snippets?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Context is a distinct top-level Chat Web area | Open Context from navigation | `src/apps/chat-ui/src/App.tsx` | Draft |
| REQ-002 Context panel selection is bounded | Switch from prompts to tools; Switch to Build Context | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Source-backed |
| REQ-003 Cross-area links open the correct Context panel | Edit agent context file; View session build context | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Source-backed |
| REQ-004 Catalog-derived context views are read-only unless their owning capability supports editing | No curated tools installed | `src/apps/chat-ui/src/context/PiboToolsView.tsx`, `src/apps/chat-ui/src/context/McpToolsView.tsx`, prompt/context views | Draft |
| REQ-005 Context counts come from bootstrap/catalog data | Catalog contains MCP servers | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat/web-app.ts` | Draft |
| REQ-006 Context routing remains shallow unless panel URLs are implemented deliberately | Switch panel without route change | `src/apps/chat-ui/src/App.tsx` | Draft |

## Verification Basis

This spec is based on current workspace code in `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/context/ContextBuildView.tsx`, `src/apps/chat-ui/src/context/PiboToolsView.tsx`, `src/apps/chat-ui/src/context/McpToolsView.tsx`, `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/chat-ui/src/context/BasePromptView.tsx`, `src/apps/chat-ui/src/context/CompactionPromptView.tsx`, `src/apps/chat/web-app.ts`, and the existing related specs named above.
