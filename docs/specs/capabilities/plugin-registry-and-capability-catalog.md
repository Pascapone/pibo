# Spec: Plugin Registry and Capability Catalog

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/context-files.md`, `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/capabilities/yielded-run-control.md`

## Why

Pibo is built from plugins. Plugins register tools, profiles, skills, subagents, context files, gateway actions, channels, auth services, web apps, Ralph stop conditions, and event listeners. Runtime creation, Chat Web, context-file editing, gateway actions, Ralph job control, and agent design all depend on one consistent product-facing registry.

The registry must reject ambiguous registrations early and expose a stable capability catalog so UIs and profiles can discover what an agent may select without activating everything in the catalog.

## Goal

The plugin registry MUST provide a deterministic, collision-safe registration boundary and a read-only capability catalog for product surfaces that need to inspect available Pibo capabilities.

## Background / Current State

Current code defines `PiboPluginRegistry` as the central in-process registry. Built-in registries are assembled from `piboCorePlugin`, `piboCodexCompatPlugin`, and, for the gateway producer profile only, `piboGatewayProducerPlugin`. Profiles are created by resolving a profile name or alias and then calling the profile definition with a build context that can fetch registered tools, skills, context files, and subagents by name.

The capability catalog includes registered native tools, skills, subagents, context files, the `pibo-run-control` capability package, installed curated Pibo CLI tool context hints, configured MCP server metadata placeholder data, locally registered Pi packages, and registered Ralph stop-condition definitions. Catalog membership alone does not imply runtime activation.

## Scope

### In Scope

- Plugin registration and duplicate detection.
- Profile name and alias resolution.
- Capability catalog contents and metadata.
- Gateway action and slash-command registration rules.
- Auth service, channel, and web app registration boundaries.
- Plugin event and product-event listener behavior.
- Ralph stop-condition definition registration and catalog metadata.

### Out of Scope

- The detailed behavior of individual built-in profiles — covered by profile-specific and routing specs.
- Runtime execution of selected tools or subagents — covered by routed-session, yielded-run, and subagent specs.
- Chat Web UI flows that consume the catalog — covered by Chat Web and custom-agent specs.
- MCP server config behavior — covered by the MCP server integration spec.

## Requirements

### Requirement: Plugins register through a scoped API

The system MUST register each plugin exactly once by plugin id and MUST expose registration methods only through a plugin-scoped API during plugin initialization.

#### Current

`PiboPluginRegistry.create({ plugins })` constructs a registry, rejects repeated plugin ids, records the plugin display name, and calls each plugin's `register(api)` function.

#### Target

Every capability registered through the plugin API is associated with the registering plugin where the capability type supports plugin attribution.

#### Acceptance

- Creating a registry with the same plugin id twice fails before a second plugin can contribute ambiguous capability data.
- A native tool registered by a plugin appears in the catalog with that plugin id and plugin display name.
- A plugin skill appears with kind `plugin` unless it is explicitly a user skill.

#### Scenario: Plugin attribution is visible

- GIVEN a plugin named `Test Plugin` with id `test.plugin`
- WHEN it registers native tool `test_tool`
- THEN the capability catalog lists `test_tool` with `pluginId: "test.plugin"` and `pluginName: "Test Plugin"`

### Requirement: Registered resources are globally unique unless explicitly upserted

The system MUST reject duplicate registrations for resource kinds that are addressed by one global key.

#### Current

The registry rejects duplicate tools, subagents, skills, profiles, gateway actions, channels, web app names, context-file keys, Ralph stop-condition types, and plugin ids. Context files and profiles also have explicit upsert or removal paths for dynamic product state.

#### Target

Ambiguous product capabilities fail during registration, not when a runtime or UI later tries to use them.

#### Acceptance

- Registering two native tools with the same name throws a duplicate-tool error.
- Registering two gateway actions with the same action name throws a duplicate-action error.
- Registering two Ralph stop conditions with the same type throws a duplicate stop-condition error.
- `upsertProfile` replaces the named dynamic profile and refreshes only that profile's aliases.
- `upsertContextFile` replaces the context file at its resolved key.

#### Scenario: Duplicate tool is rejected

- GIVEN a plugin registration function
- WHEN it registers `same_tool` twice
- THEN registry creation fails with a duplicate tool error

### Requirement: Profile aliases resolve deterministically

The system MUST resolve profile aliases to their canonical profile names before creating, removing, or validating profiles.

#### Current

Profile aliases are stored separately from profiles. An alias cannot equal an existing profile name, and one alias cannot point to different profiles. `resolveProfileName` reports the requested unknown name and lists available canonical profile names.

#### Target

Profiles are discoverable by canonical name while compatibility aliases remain usable for session creation and migration.

#### Acceptance

- `createProfile("codex")` resolves to the canonical Codex-compatible profile.
- Attempting to register an alias that conflicts with a profile name or another profile alias fails.
- Removing a profile removes aliases that pointed to that profile.

#### Scenario: Legacy alias creates canonical session context

- GIVEN the default plugin registry
- WHEN a caller creates profile `codex`
- THEN the returned session context uses the canonical profile name `codex-compat-openai-web`

### Requirement: Profile creation uses only registered capabilities

The system MUST create profiles through a build context that can fetch registered tools, skills, context files, and subagents by key and fails for missing entries.

#### Current

`createProfile(name)` resolves the profile, then passes a build context with `getTool`, `getTools`, `getSkill`, `getContextFile`, `getSubagent`, and `getSubagents`. Each lookup throws an unknown-resource error when the key is absent.

#### Target

Profiles cannot silently reference capabilities that are not registered in the current registry composition.

#### Acceptance

- A profile that references an unknown tool fails during profile creation.
- A profile that references a registered skill receives the registered skill metadata.
- Profile info is computed from the actual session context produced by the profile definition.

#### Scenario: Missing selected capability is not ignored

- GIVEN a plugin-defined profile that calls `context.getTool("missing")`
- WHEN the profile is created
- THEN creation fails with an unknown tool error

### Requirement: Capability catalog is descriptive and non-activating

The system MUST expose a capability catalog that describes available capabilities without causing those capabilities to be selected for a runtime.

#### Current

`getCapabilityCatalog()` returns native tools, skills, subagents, context files, capability packages, installed curated CLI tool contexts, MCP server entries, and Pi package registrations. Tests assert that a registered Pi package appears in the catalog while the default Codex profile still has no selected Pi packages.

#### Target

Agent Designer, settings UIs, and channel contexts can list available capabilities without mutating profiles or agent sessions.

#### Acceptance

- Registered Pi packages appear in `catalog.piPackages` with install status and diagnostics.
- A catalog Pi package does not appear in a created profile unless the profile selected it.
- Native tools report whether they are yieldable, whether they have a local function definition, and whether they are provider-backed.
- The run-control package appears as one named package with all `pibo_run_*` tool names.
- Registered Ralph stop conditions appear in `catalog.ralphStopConditions` with type, name, description, phases, option schema, defaults, and plugin attribution.

#### Scenario: Catalog package does not activate runtime package

- GIVEN a Pi package stored as registered but not selected by a profile
- WHEN the default profile is created
- THEN the package appears in the catalog but not in the session context's `piPackages`

### Requirement: User skills remain distinct from plugin skills

The system MUST preserve user-skill identity when user skills are registered dynamically.

#### Current

The plugin API adds plugin kind and plugin id to skills unless a skill has kind `user`. The catalog reports user skills with kind `user` and no plugin id or plugin name.

#### Target

User-managed skills can coexist with plugin-provided skills without being attributed to the plugin that performed dynamic registration.

#### Acceptance

- Registering a skill with kind `user` keeps kind `user`.
- The catalog entry for a user skill has no plugin id or plugin name.

#### Scenario: User skill attribution is not overwritten

- GIVEN a registry
- WHEN `personal-helper` is registered as a user skill
- THEN the skill catalog lists it as kind `user` and does not claim plugin stewardship

### Requirement: Gateway action slash commands are explicit and collision-free

The system MUST register slash commands only for visible gateway actions and MUST reject invalid or duplicate slash commands.

#### Current

Hidden actions do not register slash commands. Visible slash commands must be non-empty, must not start with `/`, must not contain whitespace, and must be unique across all visible gateway actions and within one action.

#### Target

Gateway command routing is deterministic and slash-command text never ambiguously maps to multiple actions.

#### Acceptance

- `getGatewayActionInfos()` excludes hidden actions.
- Duplicate slash commands across actions fail during registry creation.
- Slash commands with leading `/` or whitespace fail during registration.

#### Scenario: Duplicate slash command fails fast

- GIVEN two gateway actions with slash command `same`
- WHEN the plugin registry is created
- THEN creation fails with a duplicate slash command error

### Requirement: Web app routes do not overlap

The system MUST reject web app mount paths and API prefixes that cannot be routed unambiguously by the same-origin web host.

#### Current

Each web app has a `mountPath` and `apiPrefix`. Both must start with `/`, must not end with `/` unless equal to `/`, and must not overlap with any route from another web app.

#### Target

Registered web apps can be served by one host without prefix-shadowing or routing ambiguity.

#### Acceptance

- Two web apps cannot share the same name.
- A route `/apps/chat/admin` conflicts with an existing route `/apps/chat`.
- A route not starting with `/` fails validation.

#### Scenario: Nested web app mount is rejected

- GIVEN a registered web app mounted at `/apps/chat`
- WHEN another web app tries to mount at `/apps/chat/admin`
- THEN registration fails with a route-overlap error

### Requirement: Only one auth service may own the registry

The system MUST allow at most one auth service in a plugin registry.

#### Current

`registerAuthService` stores one service and rejects any later service with an error that names the existing service.

#### Target

A web gateway or channel context cannot accidentally choose between competing auth services.

#### Acceptance

- A registry with one auth service exposes that service through `getAuthService()`.
- Registering a second auth service fails during plugin registration.

#### Scenario: Duplicate auth service is rejected

- GIVEN a plugin that calls `registerAuthService` twice
- WHEN registry creation runs
- THEN creation fails and reports the already registered auth service

### Requirement: Ralph stop conditions are registered through plugins

The system MUST let plugins register discoverable Ralph stop-condition definitions and MUST reject ambiguous stop-condition types.

#### Current

`registerRalphStopCondition()` validates non-empty type and name, requires at least one supported phase, stores the condition with plugin attribution, rejects duplicate condition types, and exposes definitions through `getRalphStopConditionDefinitions()`, `getRalphStopConditionInfos()`, and `getCapabilityCatalog().ralphStopConditions`.

#### Target

Ralph can discover plugin-provided stop conditions without hard-coding every stop policy into the Ralph CLI or Chat Web code.

#### Acceptance

- A stop condition with a blank type, blank name, or no supported phase is rejected.
- Two stop conditions with the same type cannot both register.
- Catalog entries include plugin id and plugin name when registered through a plugin.
- Returning catalog metadata does not start or evaluate a Ralph job.

#### Scenario: Duplicate Ralph stop condition fails fast

- GIVEN a plugin registers stop condition type `promise-complete`
- WHEN another plugin registers the same type
- THEN registry creation fails with a duplicate stop-condition error

### Requirement: Plugin listener failures are contained

The system MUST call registered output-event and product-event listeners and MUST contain listener failures so one failing listener does not crash event dispatch.

#### Current

`notifyEvent` and `emitProductEvent` catch listener exceptions and append the error message to registry event errors. `emitProductEvent` also fills missing ids with UUIDs and missing creation times with the current ISO timestamp.

#### Target

Plugin event integrations remain observable while failures are reported through registry diagnostics.

#### Acceptance

- A listener receives output events passed to `notifyEvent`.
- A product event emitted without an id receives a generated id.
- A product event emitted without `createdAt` receives an ISO timestamp.
- A throwing listener records an event error without preventing later listeners from being attempted.

#### Scenario: Product event is normalized

- GIVEN a product event input without id or creation time
- WHEN the registry emits it
- THEN the returned event includes an id, `createdAt`, original type, source, actor id, and payload

## Edge Cases

- Context-file keys default to `key`, then `label`, then `path`; collisions at the resolved key are duplicate context files.
- Managed context files are not re-attributed to the registering plugin when they are upserted.
- Provider-backed native tools may have no local function definition but still appear as available native tools.
- Ralph stop-condition catalog entries describe policy metadata only; evaluation remains managed by Ralph.
- Hidden gateway actions can still be fetched by name, but they do not appear in discovery output and do not claim slash commands.
- A registry composition can intentionally differ by environment, such as the gateway producer registry exposing `pibo-gateway-producer` while the default registry does not.

## Constraints

- **Compatibility:** Existing profile aliases such as `codex` and `gateway-producer` must continue to resolve where their registry composition includes the target profile.
- **Security / Privacy:** Capability catalog output must describe capabilities and local metadata, but must not include secret auth credentials or API keys.
- **Performance:** Catalog creation should remain a bounded in-memory read plus existing local catalog lookups; it should not start runtimes or network calls.
- **Dependencies:** Capability catalog Pi package entries come from the local Pi package store; curated Pibo CLI tool hints come from installed tool registry state.

## Success Criteria

- [ ] SC-001: Default registry creation succeeds and exposes the expected built-in profiles, core native tools, gateway actions, and Codex-compatible profile aliases.
- [ ] SC-002: Duplicate plugin ids, duplicate resource keys, duplicate slash commands, duplicate auth services, and overlapping web routes fail during registration.
- [ ] SC-003: `getCapabilityCatalog()` returns descriptive capability metadata, including Ralph stop-condition metadata, without changing any created profile's selected capabilities.
- [ ] SC-004: Profile creation fails when a profile definition references an unregistered capability.
- [ ] SC-005: Plugin and product event listener errors are captured in registry diagnostics instead of escaping event dispatch.

## Assumptions and Open Questions

### Assumptions

- The plugin registry remains in-process and registry composition is chosen by the caller, such as CLI, local client, gateway server, or web gateway.
- Catalog consumers treat catalog entries as selectable options, not active runtime state.

### Open Questions

- Should MCP server metadata in `PiboCapabilityCatalog.mcpServers` be populated directly by the registry or injected by channel/web contexts that know the active MCP configuration?
- Should duplicate profile aliases be reported through a catalog validation command before runtime startup for easier operator debugging?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Plugins register through a scoped API | Plugin attribution is visible | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-002 Registered resources are globally unique unless explicitly upserted | Duplicate tool is rejected | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-003 Profile aliases resolve deterministically | Legacy alias creates canonical session context | `src/plugins/registry.ts`, `src/plugins/builtin.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-004 Profile creation uses only registered capabilities | Missing selected capability is not ignored | `src/plugins/registry.ts`, `src/core/profiles.ts` | Specified |
| REQ-005 Capability catalog is descriptive and non-activating | Catalog package does not activate runtime package | `src/plugins/registry.ts`, `src/pi-packages/store.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-006 User skills remain distinct from plugin skills | User skill attribution is not overwritten | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-007 Gateway action slash commands are explicit and collision-free | Duplicate slash command fails fast | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-008 Web app routes do not overlap | Nested web app mount is rejected | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-009 Only one auth service may own the registry | Duplicate auth service is rejected | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Specified |
| REQ-010 Ralph stop conditions are registered through plugins | Duplicate Ralph stop condition fails fast | `src/plugins/registry.ts`, `src/plugins/types.ts`, `src/ralph/types.ts` | Source-backed |
| REQ-011 Plugin listener failures are contained | Product event is normalized | `src/plugins/registry.ts`, `src/plugins/types.ts` | Specified |
