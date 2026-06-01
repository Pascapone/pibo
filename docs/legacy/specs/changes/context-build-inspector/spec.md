# Spec: Context Build Inspector

**Status:** Done
**Created:** 2026-05-13  
**Owner / Source:** User request in Pibo session `ps_5abe41b9-745c-4dbc-b84b-9d6061a54be7`  
**Related docs:** `GLOSSARY.md`, `DESIGN.md`, `docs/specs/capabilities/chat-web-context-area.md`, `docs/specs/capabilities/pibo-runtime-assembly-and-inspection.md`, `docs/specs/capabilities/runtime-prompt-and-compaction.md`, `docs/specs/capabilities/context-files.md`, `docs/specs/capabilities/custom-agents.md`

## Why

Pibo users need to understand what context a new agent session receives. The current Context area exposes editable resources, such as base prompts and context files, but it does not show the hydrated build output or the exact assembly order.

The inspector must make context construction explainable. A user should be able to start from collapsed high-level sections, expand into nested subsections, and verify source, order, and hydrated content without reading implementation code.

## Goal

Pibo MUST provide a read-only Chat Web Build Context panel that shows the hydrated, ordered, nested runtime context tree for an explicitly selected session.

## Background / Current State

Runtime assembly is centered on `src/core/runtime.ts`. `createPiboRuntime()` loads profile context files and skills, injects `pibo://runtime/session-context.md`, merges automatic Pi context files, installed CLI tool context, and MCP context, resolves tools and generated tool definitions, and registers prompt/provider extensions.

`inspectPiboProfile()` reports summary data: active skills, tools, subagents, Pi packages, loaded context file paths and byte counts, and diagnostics. `inspectPiboContextBuild()` now exposes full hydrated text, nested prompt sections, tool prompt contributions, provider payload summaries, runtime extensions, context files, skills, diagnostics, and assembly-order nodes for selected-session inspection.

Chat Web has a Context area with sidebar categories for Context Files, Base Prompt, Compaction Prompt, Pibo Tools, MCP Tools, and Build Context. `GET /api/chat/context-build?piboSessionId=...` requires an authenticated owned session and returns the snapshot rendered by `ContextBuildView`.

Source refresh classification (2026-05-17): this change spec is implemented in current code. Historical `Current` subsections below describe the proposal-time baseline where they say no Build Context UI existed.

## Scope

### In Scope

- A new **Build Context** category in the Chat Web Context tab sidebar.
- On-demand, authenticated web API for a context build snapshot.
- Read-only, nested, expandable UI tree.
- Hydrated leaf content for context files, runtime context, prompt sections, tool prompt contributions, skills, MCP context, installed CLI tool context, and deterministic Pibo runtime extension prompt contributions.
- Metadata headers for every node.
- Assembly-order rendering.
- Default collapsed state for all sections.
- Copy controls for individual leaf content or subtrees when safe.
- Diagnostics for missing, disabled, generated, provider-backed, skipped, or unavailable contributions.

### Out of Scope

- Drag-and-drop reordering — planned for a later version after V1 proves the read-only model.
- Editing context from the Build Context tree — users continue editing through existing Context panels.
- A duplicate final prompt block — the fully expanded tree is the representation.
- Historical transcript inspection — this feature describes startup context for a new runtime, not past turns.
- Provider secrets, auth tokens, OAuth data, API keys, and raw private credentials.
- Runtime compaction prompt execution details — the compaction prompt remains a separate Context panel and does not contribute to normal startup context.

## Definitions

### Build Context Tree

The ordered tree of sections and nested subsections that together explain the model-visible startup context and related provider/tool surfaces for a new runtime.

### Hydrated Content

The concrete text, schema, or provider-safe payload that Pibo would send or make visible during runtime startup for the inspected session. Hydrated content has already resolved templates, generated runtime metadata, selected context files, selected skill markdown, and deterministic Pibo extension prompt contributions.

### Leaf Node

A node with no child nodes. A leaf node displays its hydrated content when expanded.

### Parent Node

A node that contains child nodes. A parent node displays child nodes when expanded and may also display a short description of how those children are assembled.

## Requirements

### Requirement: Build Context appears as its own Context sidebar category

Chat Web MUST add **Build Context** as a distinct sidebar category inside the existing Context tab.

#### Current

The Context sidebar includes Context Files, Base Prompt, Compaction Prompt, Pibo Tools, and MCP Tools.

#### Target

The Context sidebar includes a **Build Context** item that opens the read-only inspector.

#### Acceptance

- The new category is visible only inside the Context area.
- Selecting it does not leave the Context area or switch to Settings, Sessions, Projects, or Chat.
- The sidebar label uses concise operational text: `Build Context`.

#### Scenario: Open Build Context panel

- GIVEN the user is authenticated in Chat Web
- WHEN the user opens the Context tab
- THEN the Context sidebar includes `Build Context`
- WHEN the user selects it
- THEN the main panel renders the Build Context Inspector.

### Requirement: Snapshot generation is read-only

The system MUST generate Build Context snapshots without mutating persisted runtime, profile, prompt, context-file, session, or transcript state.

#### Current

`inspectPiboProfile()` creates a non-persistent runtime for inspection and disposes it.

#### Target

Build Context snapshot generation uses non-persistent inspection or equivalent side-effect-free assembly.

#### Acceptance

- Generating a snapshot does not create a new user-visible Pibo Session.
- Generating a snapshot does not append transcript entries.
- Generating a snapshot does not save prompt or context-file changes.
- Generated local runtime resources are disposed after inspection.

#### Scenario: Inspect without mutating sessions

- GIVEN the user opens **View Context** for an existing session
- WHEN the API generates the snapshot
- THEN no new Chat Web session appears in the session list
- AND no transcript file receives a user or assistant message.

### Requirement: Tree starts collapsed and expands progressively

The UI MUST render all top-level Build Context sections collapsed by default and allow progressive expansion into nested sections.

#### Current

No Build Context UI exists.

#### Target

Users inspect context by expanding headers. Parent nodes reveal child nodes. Leaf nodes reveal hydrated content.

#### Acceptance

- All top-level sections are collapsed by default.
- Expanding a parent node shows child nodes, not a flat text dump.
- Expanding a leaf node shows hydrated content in a code/text well.
- The UI provides `Expand all` and `Collapse all` controls.
- Expanding every node reveals the full represented startup context without needing a separate final prompt block.

#### Scenario: Progressive prompt discovery

- GIVEN the Build Context tree is loaded
- WHEN the user expands `Tool Prompt Surface`
- THEN the UI shows nested tool nodes
- WHEN the user expands a tool node
- THEN the UI shows that tool's prompt-visible text, schema, guidelines, or provider-safe payload sections as available.

### Requirement: Every node has a metadata header

Each Build Context node MUST show enough metadata in its collapsed header to explain what it is and where it came from.

#### Current

Profile inspection only returns summary lists.

#### Target

Each node header is useful without expansion.

#### Acceptance

Each node header includes, when applicable:

- title or name
- source kind, such as `library`, `custom`, `managed`, `plugin`, `generated`, `pi`, `provider`, or `runtime`
- path, key, or provider id
- active, disabled, generated, provider-backed, locked, or skipped state
- byte count or child count
- order index within its parent

#### Scenario: Collapsed context file node

- GIVEN a selected managed context file is present in the snapshot
- WHEN its node is collapsed
- THEN the header shows its label, source `managed`, path or key, byte count, and order.

### Requirement: Hydrated content is visible at leaf nodes

Leaf nodes MUST expose the concrete content that contributes to the startup context or provider/tool surface.

#### Current

The user can inspect source files separately but cannot inspect generated runtime content or hydrated prompt contributions in one ordered tree.

#### Target

Leaf nodes show final hydrated content for that specific contribution.

#### Acceptance

- Runtime context shows the generated `pibo://runtime/session-context.md` text.
- Context-file leaves show loaded file contents after path resolution and deduplication.
- Skill leaves show loaded skill markdown or the skill prompt contribution that Pi receives.
- Tool leaves show prompt snippets, prompt guidelines, tool definition/schema, and provider-safe payload contributions as separate nested leaves when present.
- Extension leaves show deterministic prompt text they add, prepend, wrap, or otherwise contribute.
- Empty or non-text contributions state why no prompt-visible text exists.

#### Scenario: Inspect runtime session context

- GIVEN runtime options include owner scope, Pibo Session ID, Pibo Room ID, and timezone
- WHEN the user expands the runtime session context leaf
- THEN the hydrated content shows those exact sanitized values.

### Requirement: Tool Prompt Surface distinguishes text, schema, and provider payload

The Tool Prompt Surface section MUST separate prompt-visible text from function/tool definitions and provider-backed payload contributions.

#### Current

Tools can appear as Pi built-ins, Pibo native tools, generated subagent tools, run-control tools, runtime tools, Codex-compatible tools, or provider-backed native tools.

#### Target

Users can see what each tool contributes and through which channel.

#### Acceptance

- The Tool Prompt Surface parent summarizes active, generated, built-in, native, and provider-backed tool counts.
- Each tool has a child node.
- A tool node may contain nested leaves for:
  - prompt snippet
  - prompt guidelines
  - tool definition/schema
  - provider payload
  - generated-tool source
  - diagnostics
- Provider-backed tools do not appear missing merely because they lack a local function definition.
- Tool schemas and provider payloads are redacted if they could expose secrets.

#### Scenario: Provider-backed web search

- GIVEN the inspected session's profile selects `web_search`
- WHEN the user expands `Tool Prompt Surface` and then `web_search`
- THEN the UI shows it as provider-backed
- AND shows the Pibo web-search prompt contribution
- AND shows a safe summary of the OpenAI web-search provider configuration.

### Requirement: Context-file order matches runtime merge order

The Context Files section MUST show the order Pibo actually uses after automatic context discovery, generated runtime context injection, profile context-file loading, installed CLI context, MCP context, and deduplication.

#### Current

`mergeContextFiles()` keeps base Pi context files first, then appends Pibo session context, profile context files, installed CLI tool context, and MCP agent context while skipping duplicate paths after the first occurrence.

#### Target

The Build Context tree shows this merge order and explains skipped duplicates.

#### Acceptance

- Pi automatic context files appear before Pibo-added context files when enabled.
- `pibo://runtime/session-context.md` appears before profile-selected context files.
- Installed CLI tool context and MCP context appear after profile-selected context files when present.
- Duplicate context paths are shown as skipped diagnostics or omitted with a summary diagnostic.
- Disabled automatic context files are reflected in metadata.

#### Scenario: Duplicate context file path

- GIVEN Pi auto context already loads `AGENTS.md`
- AND a profile-selected context file resolves to the same path
- WHEN the snapshot is generated
- THEN the first loaded file remains in order
- AND the duplicate is visible as skipped or reported in diagnostics.

### Requirement: No duplicate final prompt block

The Build Context Inspector MUST NOT append a separate final prompt preview block in V1.

#### Current

No Build Context UI exists.

#### Target

The expanded tree itself is the final inspectable representation.

#### Acceptance

- There is no top-level `Final Prompt`, `Full Prompt`, or equivalent duplicated text block.
- Any copy-all action copies the tree in assembly order, but the UI does not render a second complete copy.
- Documentation and UI copy explain that fully expanding the tree reveals the represented startup context.

#### Scenario: Fully expanded tree

- GIVEN the user clicks `Expand all`
- WHEN every node is visible
- THEN the user can inspect each contribution in order
- AND the UI does not render a second full prompt below the tree.

### Requirement: The UI follows the Pibo Trace Terminal design system

The Build Context Inspector MUST follow `DESIGN.md`.

#### Current

Chat Web already uses compact dark panels, sidebar categories, technical cards, and code wells.

#### Target

Build Context uses the same operational console language.

#### Acceptance

- The panel uses compact technical headers, thin borders, and Terminal Cyan active states.
- Hydrated content renders in dark code wells using monospaced text.
- Parent-child nesting uses small indentation and visible containment.
- Badges are small, uppercase, and functional.
- Empty, loading, and error states are quiet and operational.

#### Scenario: Nested tool inspection

- GIVEN `Tool Prompt Surface` is expanded
- WHEN nested tool nodes render
- THEN they visually match trace-style inspectable cards with metadata, badges, and expandable bodies.

### Requirement: Snapshot access is authenticated and redacted

The API MUST require a valid Chat Web session and MUST redact secrets from all snapshot nodes.

#### Current

Chat Web APIs require authenticated sessions for context and prompt management.

#### Target

Build Context follows the same access boundary and adds explicit redaction.

#### Acceptance

- Unauthenticated requests fail before snapshot generation.
- Provider API keys, OAuth tokens, cookies, auth headers, and secrets never appear in node content or metadata.
- Provider payload nodes expose safe configuration only, such as provider id, tool kind, search context size, and non-secret options.
- Errors must not include raw secret-bearing objects.

#### Scenario: Provider auth configured

- GIVEN OpenAI auth is configured
- WHEN the user opens a provider-backed tool node
- THEN the node shows auth/provider status only
- AND no key, token, cookie, or bearer value appears.

### Requirement: Diagnostics are first-class tree content

Warnings and errors from runtime inspection MUST be visible in the Build Context panel.

#### Current

`inspectPiboProfile()` returns diagnostics, but Chat Web does not show them in a context-build tree.

#### Target

Diagnostics appear both as a summary and, when possible, near the affected node.

#### Acceptance

- Fatal errors show an error state with a concise message.
- Non-fatal warnings appear in a Diagnostics section and on affected nodes.
- Missing context files, skipped duplicates, unavailable models, extension load errors, and malformed resources are represented.
- Diagnostics use existing warning/error color semantics.

#### Scenario: Missing selected context file

- GIVEN the inspected session's profile references a context file path that cannot be read
- WHEN snapshot generation handles the issue
- THEN the UI shows an error or warning naming the missing resource without exposing unrelated secrets.

## Edge Cases

- A profile may disable automatic context files; the tree must show that Pi auto context is disabled.
- A profile may select provider-backed tools only; the Tool Prompt Surface must still explain them.
- Custom base prompts may omit Pibo template markers; the tree must not invent a marker contribution that does not exist.
- Custom base prompts may include `{{availableTools}}` or `{{guidelines}}`; the tree must represent the hydrated inserted content at the marker location when feasible.
- Codex compatibility may wrap the base prompt; the tree must show wrapper contributions in actual assembly order.
- Web search may append prompt text and modify provider payloads; both must be represented separately.
- Some Pi internals may expose only aggregate prompt options; V1 may show a faithful structured approximation when exact sub-span boundaries are unavailable, but it must label approximations clearly.
- Large context files must remain usable. The UI may virtualize, collapse, or lazy-render large text blocks.

## Constraints

- **Compatibility:** Runtime behavior must not change. The inspector observes assembly; it does not become an alternate assembly path.
- **Security / Privacy:** No secrets, tokens, cookies, API keys, or hidden auth data may appear in snapshots.
- **Performance:** Snapshot generation should be fast enough for interactive use and must dispose temporary runtime resources. Large hydrated content should render lazily or virtualized.
- **Design:** The UI must follow `DESIGN.md` and match the existing Chat Web Context area.
- **V1 Scope:** Read-only only. Reordering and editing are deferred.

## Success Criteria

- [ ] SC-001: Chat Web Context sidebar includes a **Build Context** category.
- [ ] SC-002: Opening Build Context generates a read-only snapshot without creating a visible session or transcript entries.
- [ ] SC-003: All top-level sections are collapsed by default and can be expanded progressively.
- [ ] SC-004: Every node header shows useful metadata while collapsed.
- [ ] SC-005: Leaf nodes show hydrated content, schema, or provider-safe payload for their contribution.
- [ ] SC-006: Tool Prompt Surface separates prompt text, tool schema, generated-tool origin, and provider payload.
- [ ] SC-007: Context-file order matches runtime merge and deduplication order.
- [ ] SC-008: No duplicate final prompt block is rendered.
- [ ] SC-009: Snapshot output is authenticated and redacted.
- [ ] SC-010: UI styling follows `DESIGN.md`.

## Assumptions and Open Questions

### Assumptions

- V1 targets startup context for a new or inspected runtime, not context after previous turns or compaction.
- The inspector is session-based. It uses the selected session's profile, workspace, room metadata, owner scope, timezone, and active model when available.
- If exact sub-span boundaries inside Pi's final prompt are unavailable, Pibo can expose structured contribution nodes that accurately name the source and hydrated content.
- Copy actions are allowed because they do not mutate runtime state.

### Open Questions

None blocking for V1. Implementation may decide whether to add a CLI command that prints the same snapshot as JSON.

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Build Context sidebar category | Open Build Context panel | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Implemented |
| REQ-002 Read-only snapshot generation | Inspect without mutating sessions | `src/core/context-build.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-003 Collapsed progressive tree | Progressive prompt discovery | `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Implemented |
| REQ-004 Metadata headers | Collapsed context file node | `src/core/context-build.ts`, `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Implemented |
| REQ-005 Hydrated content leaves | Inspect runtime session context | `src/core/context-build.ts`, `test/context-build-inspector.test.mjs` | Implemented |
| REQ-006 Tool Prompt Surface separation | Provider-backed web search | `src/core/context-build.ts`, `src/tools/web-search.ts`, `test/context-build-inspector.test.mjs` | Implemented |
| REQ-007 Context-file order | Duplicate context file path | `src/core/runtime.ts`, `src/core/context-build.ts` | Implemented |
| REQ-008 No final prompt duplicate | Fully expanded tree | `src/core/context-build.ts`, `src/apps/chat-ui/src/context/ContextBuildView.tsx`, `test/context-build-inspector.test.mjs` | Implemented |
| REQ-009 Design-system alignment | Nested tool inspection | `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Implemented |
| REQ-010 Auth and redaction | Provider auth configured | `src/apps/chat/web-app.ts`, `src/core/context-build.ts` | Implemented |
| REQ-011 Diagnostics | Missing selected context file | `src/core/context-build.ts`, `src/apps/chat-ui/src/context/ContextBuildView.tsx` | Implemented |
