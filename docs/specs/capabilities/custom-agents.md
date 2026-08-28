# Spec: Custom Agents and Agent Designer

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-08-25
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`, `docs/specs/capabilities/context-files.md`, `docs/specs/capabilities/subagent-delegation.md`, `docs/specs/capabilities/yielded-run-control.md`

## Why

Pibo users need to compose their own agent profiles without changing plugin source code. A custom agent should be a durable app-context profile that selects tools, skills, context files, subagents, MCP servers, Pi packages, model options, thinking options, built-in tools, automatic context, and run control.

The Agent Designer keeps this behavior in the product boundary. Plugin profiles remain read-only. Custom agents are app-context records that become dynamic profiles for routed sessions.

## Goal

Pibo MUST let an authenticated user create, edit, archive, restore, copy, and delete custom agents, and MUST register each active custom agent as a dynamic profile that normal Pibo Sessions can use.

## Background / Current State

The current implementation stores custom agents in SQLite through `src/apps/chat/agent-store.ts`, converts them into runtime profiles in `src/apps/chat/agent-profiles.ts`, exposes Chat Web APIs from `src/apps/chat/web-app.ts`, and renders the Agent Designer in `src/apps/chat-ui/src/App.tsx`.

Custom agents are persisted in `chat-agents.sqlite`. Each active record is registered through the channel context as a profile named by `displayName` / `profileName`, with aliases for the stable agent id and `custom-agent:<id>`. Archived agents remain stored but are removed from runtime profile registration.

## Scope

### In Scope

- App-context custom-agent listing, creation, update, archive, restore, and permanent deletion.
- Dynamic profile registration for active custom agents.
- Agent Designer catalog data for selectable capabilities.
- Selections for runtime instances, native tools, skills, context files, Pibo subagents with per-entry descriptions and runtime settings, harness-native subagents, MCP servers, Pi packages, models, thinking levels, fast mode, built-in tools, automatic context files, and run control.
- Read-only display and copy flow for plugin profiles.
- App-wide organizational folders for custom agents, including folder creation, rename, assignment, and safe deletion.
- Agent-scoped context-file creation from the Agent Designer.
- Broken context-file reporting for saved custom agents.
- Legacy profile-name migration from `custom-agent:<id>` names to valid profile names.
- Deleting sessions that use a permanently deleted custom-agent profile.

### Out of Scope

- Editing plugin profiles in place — plugin profiles are read-only.
- Per-account custom-agent isolation or sharing controls.
- Version history for custom-agent definitions.
- Automatic repair of missing selected tools, packages, skills, or context files.
- Team, role, admin, or per-resource permissions.

## Requirements

### Requirement: Agent catalog is discoverable for the designer

The system MUST expose a catalog that lets the Agent Designer show available profile inputs before saving a custom agent.

#### Current

`GET /api/chat/agent-catalog` returns plugin capability catalog data plus MCP server info, registered Pi packages, and user skills. Bootstrap responses include the same agent catalog when available.

#### Acceptance

- The catalog includes registered native tools, skills, subagents, context files, capability packages, Pibo tools, MCP servers, Pi packages, and user skills.
- The catalog also returns registered profiles so the UI can show read-only profiles and subagent target options.
- The Agent Designer can load even when there are no custom agents.
- Catalog cache invalidation happens after custom-agent or related capability mutations that change visible designer data.

#### Scenario: Open Agent Designer

- GIVEN an authenticated user opens the Agents area
- WHEN the app fetches bootstrap or `/api/chat/agent-catalog`
- THEN the UI can render selectable capabilities and read-only plugin profiles.

### Requirement: Custom agents are durable app-context resources

The system MUST store custom agents as app context resources and MUST list the same active agents for all allowed accounts.

#### Current

`CustomAgentStore` persists rows in `chat_agents`. Legacy controller columns may remain in older stores, but active list/get/create/update/archive/restore/delete paths do not filter by auth account.

#### Acceptance

- Creating an agent stores an id beginning with `agent_`, a profile name, selected capabilities, timestamps, and optional archive state.
- Listing agents through Chat Web returns app context agents for any allowed account.
- Archived agents are excluded by default and included when `includeArchived=true`.
- Dynamic profile synchronization registers all active shared custom agents.

#### Scenario: Allowed user lists custom agents

- GIVEN Account A created a custom agent
- WHEN Account B calls `GET /api/chat/agents`
- THEN that custom agent is returned.

### Requirement: Agent names are valid unique profile names

The system MUST require custom-agent names to be valid profile names and MUST reject names that conflict with existing custom agents or registered plugin profile names or aliases.

#### Current

The web API normalizes `displayName`, validates it with the custom-agent name pattern, checks custom-agent store uniqueness, and checks channel profile names and aliases. Legacy rows whose profile name is `custom-agent:<id>` are migrated to sanitized unique names.

#### Acceptance

- New or renamed agents require a non-empty kebab-case name beginning with a lowercase letter.
- A custom-agent name cannot duplicate another custom agent, including archived agents.
- A custom-agent name cannot conflict with a registered plugin profile name or alias.
- Legacy custom-agent profile names are migrated to unique valid names before listing or reading.

#### Scenario: Plugin profile conflict

- GIVEN a plugin profile named `coding-agent` exists
- WHEN a user tries to create a custom agent named `coding-agent`
- THEN the request fails and no custom agent is stored.

### Requirement: Active custom agents register dynamic profiles

The system MUST register each active custom agent as a runtime profile and MUST remove profile registration when the agent is archived, renamed, or deleted.

#### Current

`ensureCustomAgentProfiles` registers active agents on app initialization. Create and update paths call `upsertProfile`; archive and delete paths call `removeProfile`; rename removes the old profile name before registering the new one.

#### Acceptance

- Creating an active custom agent makes its profile available for new Pibo Sessions.
- Updating a custom agent updates the profile used by future runtime creation.
- Renaming a custom agent removes the old dynamic profile name and registers the new one.
- Archiving an agent removes it from profile registration while preserving the saved definition.
- Restoring an archived agent registers it again.

#### Scenario: Archive removes profile

- GIVEN a custom agent is active and selectable as a session profile
- WHEN the user archives it
- THEN new session creation no longer offers or resolves that profile.

### Requirement: Custom profile creation applies selected capabilities

A dynamic custom-agent profile MUST translate saved agent selections into `InitialSessionContext` behavior for sessions that use the profile.

#### Current

`createCustomAgentProfileDefinition` builds a profile with built-in tool mode and names, automatic context-file setting, MCP servers, Pi packages, run-control package selection, main-agent model and thinking options, compatibility-only legacy subagent profile defaults, fast-mode options, skills, context files, native tools, and subagent definitions with per-entry descriptions, models, thinking levels, and runtime-option overrides. Legacy saved `timeoutMs` values may remain readable and persistable for schema compatibility, but they do not impose a delegated request or yielded-run lifetime.

#### Acceptance

- Selected built-in tool mode and built-in tool names control built-in Pi tool exposure.
- Selected MCP server names and Pi package ids are attached to the runtime profile.
- Run control is enabled only when the custom agent has `runControl: true`.
- Main-agent model overrides are applied when present.
- Legacy profile-level subagent model and thinking fields remain valid compatibility fallbacks for previously saved agents but are not the primary Agent Designer control.
- Legacy per-subagent `timeoutMs` data is compatibility-only and does not create a runtime deadline.
- Global and main thinking/fast options are applied when present.
- Selected native tools and subagent definitions are added to the runtime profile, including each subagent's description, model, thinking level, and runtime-option overrides.

#### Scenario: Agent with run control and package selection

- GIVEN a saved custom agent selects a Pi package and enables run control
- WHEN a new Pibo Session uses that profile
- THEN runtime creation receives the package selection and the run-control capability package.

### Requirement: Agent Designer configures each Pibo subagent independently

The Agent Designer MUST let a user configure the name, parent-visible description, target profile, max depth, model, thinking level, and schema-driven runtime overrides for each Pibo subagent entry. It MUST NOT present one editable profile-wide Subagent Model block as the primary configuration for all entries.

#### Current

Each subagent card contains identity, target, depth, description, model, thinking, and runtime-option controls. The model catalog, available thinking values, and option schema are derived from the selected target profile's runtime instance. Changing the target profile clears model, thinking, and runtime-option values that belonged to the previous target runtime.

#### Acceptance

- Two entries in one parent agent can select different providers, models, thinking levels, and runtime overrides.
- The description is persisted and becomes the delegated-agent catalog description visible to the parent agent.
- The designer does not expose a delegated-agent lifetime timeout; long-running sends are controlled through yielded-run status, wait, read, cancel, observe, and kill operations.
- Leaving model, thinking, or a runtime option unset uses the target profile and Settings fallback chain.
- A newly created child session freezes the selected subagent runtime overrides; reusing that child does not silently adopt later edits.
- The designer does not show one editable global Subagent Model section in Basics.
- Read-only plugin profiles display their saved per-subagent settings without allowing edits.

#### Scenario: Configure research and implementation subagents

- GIVEN a parent custom agent has `researcher` and `implementer` subagent entries
- WHEN the user selects different models, descriptions, and runtime overrides for the two entries
- THEN autosave persists both configurations independently
- AND the parent runtime sees two generated tools with their respective descriptions.

#### Scenario: Override Codex permissions per child

- GIVEN a Codex target profile defaults to Approval mode
- AND one subagent entry selects YOLO while another selects Plan
- WHEN each entry creates a new child Pibo Session
- THEN the YOLO child runs without approvals and with unrestricted host access
- AND the Plan child uses a read-only planning turn
- AND an existing reused child retains the override frozen at its creation.

### Requirement: Runtime-owned controls are capability-driven

The Agent Designer MUST expose automatic-context and harness-native-subagent settings only according to the selected runtime instance's advertised capabilities.

#### Current

The runtime catalog exposes `contextDiscovery` and `nativeSubagents` capability contracts. The designer derives controls from the selected instance, clears stale non-configurable overrides when runtime selection changes, and keeps Pibo subagent selection independent from harness-native subagents.

`autoContextFiles` remains a concrete persisted boolean with default `true`; nullable API input resets it to `true`. `nativeSubagents` is a nullable override and is accepted only when the selected runtime reports `nativeSubagents.configurable: true`.

#### Acceptance

- Automatic-context controls reflect whether the selected runtime reports context discovery as configurable.
- Harness-native-subagent controls appear only for runtimes that report configurable support.
- Selecting a runtime with non-configurable behavior removes stale overrides instead of silently retaining them.
- Pibo subagents and yielded Pibo subagent runs remain separate from harness-native-subagent policy.
- Existing custom-agent rows without the new nullable native-subagent field preserve prior runtime defaults.
- Persisted `autoContextFiles` remains a required boolean and no nullable replacement column is introduced.

#### Scenario: Change from configurable to fixed runtime

- GIVEN a custom-agent draft disables native subagents on a configurable runtime
- WHEN the user selects a runtime whose native subagents are always on or unsupported
- THEN the designer hides the native-subagent switch
- AND clears the stale override before persistence.

### Requirement: Missing skills and context files do not break profile creation

The system MUST tolerate stale skill and context-file references when constructing a custom-agent profile, while still surfacing broken context-file references to the UI.

#### Current

Profile construction skips unknown skills and unknown context files with warnings. Serialization includes `brokenContextFiles` by comparing saved keys with the current capability catalog.

#### Acceptance

- A stale selected skill is skipped instead of preventing profile creation.
- A stale selected context file is skipped instead of preventing profile creation.
- Serialized custom agents include `brokenContextFiles` for context keys missing from the catalog.
- Valid selected skills and context files are still applied when other saved references are missing.

#### Scenario: Context file was removed

- GIVEN a custom agent selected a managed context file that was later deleted
- WHEN the Agent Designer lists the custom agent
- THEN the response marks that key as broken
- AND sessions can still be created with the remaining valid selections.

### Requirement: Pi package selections are validated against the package store

The system MUST reject custom-agent Pi package selections that do not refer to a registered Pibo Pi Package.

#### Current

`CustomAgentStore` sanitizes `piPackages` through `findPiPackage` during create and update, de-duplicates selected package ids, and throws for unknown package ids.

#### Acceptance

- Duplicate package selections are stored once.
- Unknown package ids are rejected on create and update.
- Removing a Pi package from the package store does not silently create a new package record through the agent store.

#### Scenario: Unknown package selection

- GIVEN no package with id `missing-package` exists
- WHEN a user saves a custom agent selecting `missing-package`
- THEN the save fails and the existing custom-agent definition is unchanged.

### Requirement: Built-in tool selections are constrained to supported tools

The system MUST store only supported built-in Pi tool names for a custom agent.

#### Current

The store filters `builtinToolNames` against the default supported built-in tool names and preserves their canonical order.

#### Acceptance

- Duplicate built-in tool names are stored once.
- Unknown built-in tool names are ignored.
- Omitted built-in tool selections default to the supported default set.
- Updating built-in tool selections persists the canonical filtered list.

#### Scenario: Unknown built-in tool name

- GIVEN a save request includes `read`, `bash`, `bash`, and `unknown`
- WHEN the agent is stored
- THEN the saved built-in tool list is `read`, `bash` in canonical order.

### Requirement: Agent Designer supports read-only profiles and copy-to-custom

The UI MUST distinguish read-only plugin profiles from editable custom agents and MUST let users copy an existing profile shape into a custom-agent draft.

#### Current

The Agents area lists active custom agents, optional archived custom agents, and read-only plugin profiles. Rows support copy and create-session actions where allowed. Read-only profile drafts cannot be saved directly.

#### Acceptance

- Plugin profiles appear under a read-only profile section and are not edited in place.
- Custom agents can be edited unless archived.
- Archived custom agents are read-only until restored or copied.
- Copying a profile or custom agent creates a new editable draft without mutating the source.
- Creating a session from an active custom agent uses that custom agent's profile name.

#### Scenario: Copy plugin profile

- GIVEN a user selects a read-only plugin profile
- WHEN the user copies it
- THEN the designer opens an editable custom-agent draft based on selectable profile metadata without changing the plugin profile.

### Requirement: Custom agents can be organized in folders

The Agent Designer MUST let users organize custom agents in app-wide folders without changing profile names, runtime configuration, session compatibility, or archived state.

#### Target

The Agents sidebar uses the standard responsive app-sidebar behavior. It shows custom agents grouped into optional folders plus an unfiled group. Users can create and rename folders, create agents directly inside a folder, and move active or archived custom agents between folders.

#### Acceptance

- The Agents sidebar is visible by default on desktop and closed by default on mobile.
- On mobile, the global sidebar trigger opens the Agents sidebar as a modal drawer with the standard backdrop, Escape handling, focus isolation, and close control.
- Folder names are non-empty, at most 80 characters, and unique case-insensitively.
- Folder assignment is optional and does not alter the custom agent profile name or runtime profile registration.
- An agent can be created inside a folder or moved between folders and the unfiled group.
- Renaming a folder preserves every contained agent assignment.
- A non-empty folder cannot be deleted; users must move its agents first.
- Plugin-managed read-only profiles remain outside custom-agent folders.

#### Scenario: Organize an existing agent

- GIVEN an active custom agent is unfiled
- WHEN the user creates a folder and moves the agent into it
- THEN the sidebar renders the agent in that folder
- AND existing sessions and runtime behavior for the agent remain unchanged.

#### Scenario: Open Agents on mobile

- GIVEN the viewport is 980 pixels wide or narrower
- WHEN the user navigates to Agents
- THEN the agent picker is initially hidden
- AND the global sidebar trigger opens it as the standard modal sidebar.

### Requirement: Agent-scoped context files can be created from the designer

The Agent Designer MUST let users create a managed context file for the current custom-agent draft and attach it to the draft.

#### Current

The UI calls `POST /api/context-files` with scope `agent`, `agentProfileName` equal to the draft profile name, and empty markdown, then appends the returned key to the draft selection.

#### Acceptance

- Creating an agent-scoped context file requires a valid draft profile name.
- The created context file appears in the designer catalog.
- The created context file key is selected on the draft immediately.
- Agent-scoped files for other agents are hidden unless already selected by the current draft.

#### Scenario: Add private agent context

- GIVEN a valid unsaved custom-agent draft named `review-agent`
- WHEN the user creates a new agent-scoped context file from the designer
- THEN the file is scoped to `review-agent` and selected in the draft.

### Requirement: Archive precedes destructive deletion

The system MUST require a custom agent to be archived before permanent deletion, and permanent deletion MUST require typing the agent profile name.

#### Current

`DELETE /api/chat/agents/:id` rejects active agents, requires `confirmName`, deletes sessions for that profile, removes the store record, and removes profile registration.

#### Acceptance

- Deleting an active custom agent fails with a message to archive first.
- Deleting an archived custom agent requires `confirmName` equal to the agent profile name.
- Permanent deletion removes the custom-agent record and dynamic profile registration.
- Permanent deletion removes shared sessions that use that profile, including descendant child sessions.
- Deletion returns the deleted agent id and deleted Pibo Session ids.

#### Scenario: Delete archived agent and sessions

- GIVEN an archived custom agent has sessions that use its profile
- WHEN the user confirms deletion with the exact profile name
- THEN the agent record is deleted, its profile is unregistered, and matching sessions and child sessions are deleted.

### Requirement: Chat Web mutations are authenticated same-origin JSON requests

The system MUST protect custom-agent mutations with the same Chat Web authentication and same-origin JSON checks used by other product mutations.

#### Current

Create, update, archive, restore, and delete routes call `requireSameOriginJsonRequest` and `requireSession`. Per-agent mutations resolve the shared resource by id.

#### Acceptance

- Mutating requests without a valid web session are rejected.
- Mutating requests without JSON content type or same-origin origin are rejected.
- Updating, archiving, restoring, or deleting an unknown agent returns not found.
- Read-only list routes require authentication and return app context agents.

#### Scenario: Cross-account update

- GIVEN Account A created a custom agent
- WHEN Account B sends a PATCH request for that agent id
- THEN the request updates the shared custom agent if the mutation is otherwise valid.

## Edge Cases

- A custom agent can reference a capability that was removed after save; profile construction must skip unknown skills and context files, and the UI must report broken context files.
- Native tool selections are resolved during profile construction; stale native-tool references may fail profile registration until corrected.
- Archived agents keep their names reserved so restoring them does not collide with newer records.
- Renaming an active custom agent affects future session creation but does not automatically migrate existing Pibo Sessions that already store the old profile name.
- Deleting a custom agent removes shared sessions for that profile.
- The store may contain legacy rows with old profile names; listing or reading must migrate them before returning data.

## Constraints

- **Product Boundary:** Pibo owns custom-agent records, dynamic profile registration, and designer APIs. Plugin profiles remain plugin-managed.
- **Security / Privacy:** Custom-agent APIs MUST require authenticated Chat Web sessions. Mutations MUST require same-origin JSON requests; auth is an access gate, not a custom-agent stewardship boundary.
- **Compatibility:** Existing plugin profiles and aliases MUST remain selectable and MUST not be overwritten by custom-agent names.
- **Reliability:** Custom-agent definitions MUST be durable in SQLite and recoverable across gateway restarts.
- **Context Economy:** Runtime profiles load only the selected skills, context files, packages, tools, and automatic context allowed by the custom-agent settings.

## Success Criteria

- [ ] SC-001: An authenticated user can create a valid custom agent and immediately create a Pibo Session with that profile.
- [ ] SC-002: All allowed accounts see the same shared custom agents through Chat Web APIs, with archived agents hidden by default.
- [ ] SC-003: Invalid, duplicate, or plugin-conflicting agent names are rejected before persistence.
- [ ] SC-004: Archiving removes a dynamic profile; restoring registers it again.
- [ ] SC-005: A custom-agent runtime profile applies its selected runtime, tools, skills, context files, Pibo subagents, capability-valid native-subagent behavior, MCP servers, Pi packages, models, thinking options, built-in tools, automatic context, and run control.
- [ ] SC-006: Stale skill and context-file references do not prevent profile creation, and broken context files are visible in serialized agent data.
- [ ] SC-007: Unknown Pi package ids are rejected, and built-in tool selections are filtered to supported built-in tools.
- [ ] SC-008: Permanent deletion requires archive plus exact name confirmation and deletes shared sessions for that profile.
- [ ] SC-009: One parent agent can persist multiple subagent entries with independent descriptions, providers, models, and thinking levels.
- [ ] SC-010: Custom agents can be created in, moved between, and displayed within durable folders while the Agents sidebar follows the standard desktop and mobile behavior.

## Assumptions and Open Questions

### Assumptions

- Authentication is the access gate for custom-agent management; custom agents are app context resources.
- Profile name equality is the correct collision check for dynamic profile registration.
- Custom-agent edits affect future runtime creation; existing active runtimes are not rebuilt automatically.

### Open Questions

- Should native tools, skills, context files, MCP servers, and subagent target profiles all be strictly validated at save time instead of partly at runtime/profile construction?
- Should custom agents have revision history or export/import support?
- Should custom-agent names become separate from profile names so display labels can use spaces while profile ids stay stable?
- Should permanent deletion offer a mode that archives or reassigns sessions instead of deleting them?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Agent catalog is discoverable for the designer | Open Agent Designer | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-002 Custom agents are durable app-context resources | User lists custom agents | `src/apps/chat/agent-store.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-003 Agent names are valid unique profile names | Plugin profile conflict | `src/apps/chat/agent-store.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-004 Active custom agents register dynamic profiles | Archive removes profile | `src/apps/chat/web-app.ts`, `src/apps/chat/agent-profiles.ts` | Implemented |
| REQ-005 Custom profile creation applies selected capabilities | Agent with run control and package selection | `src/apps/chat/agent-profiles.ts`, `src/core/profiles.ts` | Implemented |
| REQ-006 Agent Designer configures each Pibo subagent independently | Configure research and implementation subagents | `src/apps/chat-ui/src/agents/AgentsView.tsx`, `src/apps/chat/agent-store.ts`, `src/core/session-router.ts` | Implemented |
| REQ-007 Runtime-owned controls are capability-driven | Change from configurable to fixed runtime | `src/agent-runtime/capabilities.ts`, `src/apps/chat/agent-store.ts`, `src/apps/chat/agent-profiles.ts`, `src/apps/chat-ui/src/agents/AgentsView.tsx` | Implemented |
| REQ-008 Missing skills and context files do not break profile creation | Context file was removed | `src/apps/chat/agent-profiles.ts`, `src/apps/chat/web-app.ts`, `test/agent-profiles.test.mjs` | Implemented |
| REQ-009 Pi package selections are validated against the package store | Unknown package selection | `src/apps/chat/agent-store.ts`, `test/agent-store.test.mjs` | Implemented |
| REQ-010 Built-in tool selections are constrained to supported tools | Unknown built-in tool name | `src/apps/chat/agent-store.ts`, `test/agent-store.test.mjs` | Implemented |
| REQ-011 Agent Designer supports read-only profiles and copy-to-custom | Copy plugin profile | `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-012 Custom agents can be organized in folders | Organize an existing agent; open Agents on mobile | `src/apps/chat/agent-store.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/agents/AgentsSidebar.tsx` | Implemented |
| REQ-013 Agent-scoped context files can be created from the designer | Add private agent context | `src/apps/chat-ui/src/App.tsx`, `src/plugins/context-files.ts` | Implemented |
| REQ-014 Archive precedes destructive deletion | Delete archived agent and sessions | `src/apps/chat/web-app.ts` | Implemented |
| REQ-015 Chat Web mutations are authenticated same-origin JSON requests | Cross-account update | `src/apps/chat/web-app.ts`, `src/web/http.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/agent-store.test.mjs`, `test/agent-profiles.test.mjs`, `test/subagents.test.mjs`, `test/web-channel.test.mjs`, `test/chat-ui-agent-designer-subagents.test.mjs`, `test/chat-ui-integration.test.mjs`, `test/pi-packages.test.mjs`, and `test/context-files-web.test.mjs`.
