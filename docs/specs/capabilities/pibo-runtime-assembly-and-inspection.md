# Spec: Pibo Runtime Assembly and Profile Inspection

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/runtime-prompt-and-compaction.md`, `docs/specs/capabilities/model-provider-auth-and-session-selection.md`, `docs/specs/capabilities/yielded-run-control.md`

## Why

Pibo embeds Pi Coding Agent, but the product boundary decides which profile, tools, context, model, session identity, and product metadata reach each runtime. That assembly step must be predictable because every routed session, local TUI session, Custom Agent, subagent, scheduled job, and profile inspection depends on it.

Operators and agents also need a safe way to inspect a profile before running it. Inspection must show what would be active without executing subagents or yielded tools.

## Goal

Pibo MUST assemble Pi Coding Agent runtimes from Pibo profiles in a deterministic, profile-gated, inspectable way while preserving Pibo Session identity, model selection, context-file ordering, generated tools, and diagnostics.

## Background / Current State

The current implementation is centered on `src/core/runtime.ts`. `createPiboRuntime()` builds an `AgentSessionRuntime` from an `InitialSessionContext`, loads profile-selected context files and skills, injects Pibo runtime context, creates generated Pibo tools, applies provider and prompt extensions, resolves the selected model, and returns diagnostics from package and resource loading.

`inspectPiboProfile()` creates a non-persistent runtime with inert inspection controllers where needed, then reports selected skills, tools, subagents, Pi packages, context files, and diagnostics. The root CLI exposes this through `pibo profile [profile]` in `src/cli.ts`.

`inspectPiboContextBuild()` in `src/core/context-build.ts` creates a non-persistent inspection runtime and returns a redacted, ordered Build Context snapshot with prompt sections, tool prompt surfaces, runtime extensions, context files, skills, diagnostics, and approximate token counts. Chat Web exposes this for managed sessions through `GET /api/chat/context-build` and renders it in the Context area's Build Context panel.

## Scope

### In Scope

- Runtime creation through `createPiboRuntime()`.
- Pi session manager selection for persistent and in-memory runtimes.
- Profile-selected skills, context files, native tools, built-in tools, tool packages, subagents, MCP server context, curated CLI tool context, and Pi packages.
- Pibo runtime session context injection.
- Model and thinking-level resolution from active session model, profile, and model defaults.
- Generated Pibo tools for subagents, yielded runs, Codex compatibility, and persistent code runtime.
- Runtime diagnostics, profile inspection output, and Build Context snapshot inspection.
- Direct local TUI startup guardrails for profiles that require routed runtime services.

### Out of Scope

- Session Router queueing, hierarchy, and gateway behavior — covered by session routing and gateway specs.
- The detailed behavior of each generated tool package — covered by subagent, yielded-run, runtime-tool, and Codex-compatible specs.
- Chat Web UI catalog rendering — covered by Custom Agents and Chat Web specs.
- Pi Coding Agent internals beyond the assembly contracts Pibo controls.

## Requirements

### Requirement: Runtime creation uses the requested Pibo profile

The system MUST create each runtime from the supplied Pibo profile or from the default core profile when no profile is supplied.

#### Current

`createPiboRuntime()` defaults to `createDefaultPiboProfile()` and otherwise uses the provided `InitialSessionContext`.

#### Acceptance

- A supplied profile controls profile name, selected skills, tools, subagents, context files, built-in tool allowlist, model preferences, and package selections.
- Omitting the profile creates the default Pibo profile.
- Runtime assembly does not silently activate unselected profile resources.

#### Scenario: Custom profile starts runtime

- GIVEN a profile selects one context file and disables one tool
- WHEN Pibo creates a runtime with that profile
- THEN the runtime loads the selected context file
- AND the disabled tool is not active.

### Requirement: Pi session persistence follows the profile session id

The system MUST reopen an existing Pi session when persistent mode is enabled and the profile names an existing Pi Session ID.

#### Current

`createSessionManager()` searches `SessionManager.list(cwd)` for `profile.sessionId`. It opens the existing session when found, creates a persistent session when persistence is enabled, or uses an in-memory session otherwise.

#### Acceptance

- Persistent runtimes with an existing `profile.sessionId` reuse the same Pi session file.
- Persistent runtimes with a new `profile.sessionId` create a new Pi session with that id.
- Non-persistent runtimes use in-memory session storage.
- Parent Pi session id is passed when the profile has `parentSessionId`.

#### Scenario: Reopen persisted runtime

- GIVEN a persistent runtime wrote transcript data for Pi session `pi-1`
- WHEN Pibo creates another persistent runtime in the same workspace with `profile.sessionId = pi-1`
- THEN the second runtime uses the original session file and Pi Session ID.

### Requirement: Product runtime context is always injected as an agent context file

The system MUST inject Pibo-managed runtime identifiers into the runtime context without requiring a profile-selected file.

#### Current

`createSessionContextFile()` creates `pibo://runtime/session-context.md` with app context context, Pibo Session ID, Pibo Room ID, and timezone. It must not expose auth identity id or app partition as product stewardship. `createPiboRuntime()` merges it into the agent context files.

#### Acceptance

- Every runtime gets a `pibo://runtime/session-context.md` context file.
- Missing values are rendered as `unknown`, except timezone defaults to `UTC`.
- App partitions of the form `user:<id>` expose `<id>` as the user id when no explicit user id is provided.
- Runtime context injection does not depend on profile `autoContextFiles`.

#### Scenario: Scheduled room job starts a session

- GIVEN runtime options include app context compatibility context, Pibo Session ID, Pibo Room ID, and timezone
- WHEN the scheduled job runtime starts
- THEN the context includes those exact product identifiers for the agent.

### Requirement: Context files merge deterministically and deduplicate by path

The system MUST merge Pi-provided context files with Pibo-provided context files in a stable order and MUST keep only the first file for each path.

#### Current

`mergeContextFiles()` appends Pibo session context, profile context files, installed CLI tool context, and MCP agent context after the base Pi context files, skipping duplicate paths already seen.

#### Acceptance

- Base Pi agent files remain before Pibo-added files.
- Pibo session context precedes profile-managed context files.
- Curated CLI tool and MCP context files are appended only when present.
- Duplicate paths are ignored after the first occurrence.

#### Scenario: Duplicate context path

- GIVEN Pi base context already contains path `A.md`
- AND a selected Pibo context file also resolves to `A.md`
- WHEN runtime context is assembled
- THEN the base context content for `A.md` remains the one loaded file.

### Requirement: Skills and Pi packages are loaded only through selected profile resources

The system MUST pass only enabled profile skill paths and selected Pi package runtime options into Pi Coding Agent resource loading.

#### Current

`getEnabledSkillPaths()` filters disabled skills and resolves paths relative to the runtime workspace. `getPiPackageRuntimeOptions()` contributes package resource-loader options and diagnostics for the profile's package selections.

#### Acceptance

- Disabled profile skills are not added to `additionalSkillPaths`.
- Relative skill paths and context paths resolve from the runtime workspace.
- Pi package diagnostics are returned with runtime diagnostics.
- Package resources do not load merely because packages are registered globally.

#### Scenario: Disabled selected skill

- GIVEN a profile contains skill `review-helper` with `enabled: false`
- WHEN Pibo creates or inspects the runtime
- THEN `review-helper` is not loaded and is not listed as an active skill.

### Requirement: Tool activation is profile-gated and generated tools are explicit

The system MUST expose only selected built-in tools, selected native tool definitions, and generated tools implied by enabled profile packages or subagents.

#### Current

`getEnabledToolDefinitions()` filters disabled tools, adds runtime tool definitions when selected, generates subagent tools when a subagent runner is available, adds Codex-compatible tools when that package is enabled, wraps yieldable tools in run-control tools when run control is enabled, and computes a built-in tool allowlist.

#### Acceptance

- Disabled native tools are not active.
- If built-in tools are disabled, Pi built-ins are disabled while generated Pibo tools can still be supplied explicitly.
- If the profile selects fewer than the default built-in tool names, only those selected built-ins plus custom generated tools are allowed.
- Run-control tools are generated only when run control is enabled, a controller exists, and there is at least one yieldable tool.
- Provider-backed tools can appear active without local Pi function definitions.

#### Scenario: Run control wraps yieldable tools

- GIVEN a profile enables run control and has a yieldable `bash` tool
- WHEN the runtime is created with a run-control controller
- THEN normal `bash` is available
- AND `pibo_run_start`, status, wait, read, cancel, and ack tools are available for yielded execution.

### Requirement: Runtime extensions are assembled from Pibo prompt, compatibility, and provider tool needs

The system MUST install Pibo-managed runtime extensions according to profile behavior.

#### Current

`getProfileExtensionFactories()` always adds Pibo system-prompt and compaction-prompt extensions, adds web-search provider extensions for selected provider-backed tools, and adds the Codex compatibility extension when the profile enables the Codex compatibility package.

#### Acceptance

- Pibo system prompt and compaction prompt extensions are present for normal and Codex-compatible profiles.
- Codex compatibility extension is present only when the profile enables that package.
- Child profiles pass child-session framing into the Codex compatibility extension.
- Provider-backed web search adds its provider extension without registering a local function tool definition.

#### Scenario: Provider-backed web search selected

- GIVEN a profile selects Pibo native tool `web_search`
- WHEN runtime extensions are assembled
- THEN the OpenAI provider request can receive the provider web-search tool configuration
- AND profile inspection marks `web_search` active even without a local definition.

### Requirement: Model and thinking selection are resolved before Pi runtime use

The system MUST resolve the model and thinking level during runtime creation and reject unknown or unauthenticated requested models.

#### Current

`resolveProfileModel()` prefers `options.activeModel`, then selected model defaults/profile settings. It finds the model in Pi's model registry and checks configured auth. Thinking level comes from runtime options or selected model defaults.

#### Acceptance

- A persisted Pibo Session active model overrides current global defaults.
- Unknown provider/model pairs fail runtime creation with a clear error.
- Models without configured auth fail runtime creation with a clear error.
- If no model is requested, Pi Coding Agent may use its own default.
- Explicit runtime thinking level overrides selected default thinking level.

#### Scenario: Session active model survives default change

- GIVEN a Pibo Session stores active model `openai/gpt-a`
- AND global defaults later change to `openai/gpt-b`
- WHEN the session runtime is created
- THEN Pibo requests `openai/gpt-a`.

### Requirement: Diagnostics are returned with runtime and inspection results

The system MUST surface resource and package diagnostics instead of hiding assembly problems.

#### Current

Runtime diagnostics include Pi package diagnostics, service diagnostics, skill/resource diagnostics, and extension load errors. Resource collisions are normalized to warnings.

#### Acceptance

- Package diagnostics appear in `runtime.diagnostics`.
- Resource loader skill diagnostics appear in `runtime.diagnostics`.
- Extension loading errors name the failing extension path.
- Profile inspection returns the same diagnostic list without starting real delegated work.

#### Scenario: Broken extension package

- GIVEN a selected package contributes an extension that fails to load
- WHEN profile inspection runs
- THEN the inspection output contains an error diagnostic naming that extension.

### Requirement: Profile inspection is non-executing and complete enough for discovery

The system MUST inspect selected runtime resources without letting generated tools perform real work.

#### Current

`inspectPiboProfile()` creates inert subagent and run-control controllers when needed. It reports loaded skills, profile tools, generated Pibo tools, selected subagents, selected Pi packages, loaded context files with byte counts, and diagnostics, then disposes the runtime.

#### Acceptance

- Inspection lists each profile tool with `hasDefinition`, `registered`, and `active` flags.
- Inspection includes generated Pibo tools that are active but not explicitly named in the profile.
- Inspection lists subagents with target profiles and active state.
- Inspection lists loaded context file paths and byte counts.
- Attempting to execute an inspection-only subagent or yielded run fails instead of performing work.
- The CLI command `pibo profile [profile]` returns this inspection as JSON.

#### Scenario: Inspect profile with subagent

- GIVEN a profile selects subagent `explorer`
- WHEN an operator runs `pibo profile <profile>`
- THEN the JSON includes subagent `explorer`
- AND includes generated tool `pibo_subagent_explorer`
- AND no child Pibo Session is created.

### Requirement: Build Context snapshots are read-only, ordered, and redacted

The system MUST expose an inspection snapshot that explains startup context assembly without mutating runtime, session, prompt, context-file, or transcript state.

#### Current

`inspectPiboContextBuild()` calls `createPiboRuntime()` with `persistSession: false`, uses inert subagent and run-control controllers when needed, omits requested model auth resolution for inspection, reads loaded runtime resources, redacts secret-like values in text, metadata, schema, payload, and diagnostics, estimates direct and subtree tokens, and disposes the runtime in a `finally` block. Chat Web requires an authenticated shared session for `GET /api/chat/context-build?piboSessionId=...` and passes the selected session's profile, active model, workspace, app context compatibility context, room id, and timezone into the snapshot.

#### Acceptance

- Snapshot generation does not create a user-visible Pibo Session or append transcript entries.
- Context-file nodes preserve runtime merge order after Pi auto context, runtime session context, profile context files, installed tool context, MCP context, and deduplication.
- Tool nodes distinguish prompt snippets, prompt guidelines, callable schemas, generated-tool origin, and provider-backed payloads.
- Provider-backed `web_search` appears as active without requiring a local function definition.
- Secret-like values are redacted from node content, metadata, payloads, schemas, and diagnostics.
- Snapshot generation disposes temporary runtime resources.

#### Scenario: Inspect managed session startup context

- GIVEN Chat Web has an authenticated user and an managed Pibo Session
- WHEN the user requests that session's Build Context snapshot
- THEN the response contains ordered prompt, tool, context-file, skill, extension, and diagnostic nodes
- AND no new transcript or visible session is created.

### Requirement: Direct TUI refuses profiles that need routed services

The system MUST prevent direct Pi TUI startup for profiles that require routed Pibo services not available in direct mode.

#### Current

`runPiboTui()` detects enabled subagents and requires both a subagent runner and run-control controller. Without them it prints an error and tells the operator to use the routed TUI.

#### Acceptance

- Direct TUI startup works for profiles that do not need routed subagent services.
- Direct TUI startup refuses profiles with enabled subagents when routed controllers are missing.
- The refusal sets a non-zero process exit code and names the routed TUI alternative.

#### Scenario: Subagent profile in direct TUI

- GIVEN profile `review-parent` enables a subagent
- WHEN an operator starts `pibo tui review-parent`
- THEN Pibo does not start an unusable runtime
- AND the output points to `tui:routed`.

## Edge Cases

- Context file reads can fail; runtime creation must fail instead of silently omitting an explicitly selected context file.
- Profiles may select only provider-backed tools; profile and context-build inspection must not mark them missing merely because they lack local definitions.
- Runtime tool sessions created by a locally managed runtime registry must be closed when the Pi session is disposed.
- Empty profile built-in tool selections must not accidentally re-enable all Pi built-ins.
- Malformed or missing user settings must have been sanitized before runtime options provide timezone.

## Constraints

- **Compatibility:** Pibo runtime assembly must remain compatible with Pi Coding Agent `createAgentSessionRuntime`, `createAgentSessionServices`, and `SessionManager` contracts.
- **Security / Privacy:** Runtime context may expose product identifiers and app context context to the agent, but it must not include app partition, auth identity id, provider secrets, or web auth tokens.
- **Performance:** Profile and Build Context inspection may instantiate a runtime but must dispose it and must not perform long-running subagent or yielded work.
- **Dependencies:** Model lookup, auth status, resource loading, and session persistence depend on Pi Coding Agent services.

## Success Criteria

- [ ] SC-001: A runtime created with a custom profile activates only selected skills, context files, tools, packages, and generated tools.
- [ ] SC-002: Persistent runtime creation reopens an existing Pi session when `profile.sessionId` matches an existing session file.
- [ ] SC-003: Every inspected or running profile includes `pibo://runtime/session-context.md` with sanitized product identifiers.
- [ ] SC-004: Unknown or unauthenticated requested models fail runtime creation before the agent starts work.
- [ ] SC-005: `pibo profile [profile]` emits JSON covering skills, tools, generated tools, subagents, packages, context files, and diagnostics without executing delegated work.
- [ ] SC-006: Build Context inspection emits a redacted ordered snapshot for an managed session without mutating session or transcript state.
- [ ] SC-007: Direct TUI startup rejects profiles that need subagent routing and points to `tui:routed`.

## Assumptions and Open Questions

### Assumptions

- Pi Coding Agent remains responsible for low-level model invocation, transcript persistence, resource loading mechanics, and TUI rendering.
- Pibo profile definitions are validated by the plugin registry, Custom Agent flows, and package/skill/context managers before runtime creation where possible.

### Open Questions

- Should profile inspection explicitly mark missing selected context files before runtime creation fails, or is fail-fast creation enough?
- Should runtime diagnostics be persisted on the Pibo Session record for later Chat Web display?
- Should direct TUI support more generated Pibo tools through local controllers instead of refusing routed-only profiles?

## Traceability

| Requirement | Scenario / Story | Code / Test Basis | Status |
|---|---|---|---|
| REQ-001 Runtime creation uses requested profile | Custom profile starts runtime | `src/core/runtime.ts`, `test/codex-compat.test.mjs`, `test/subagents.test.mjs` | Implemented |
| REQ-002 Pi session persistence follows profile session id | Reopen persisted runtime | `src/core/runtime.ts`, `test/session-router-store.test.mjs` | Implemented |
| REQ-003 Product runtime context is injected | Scheduled room job starts a session | `src/core/runtime.ts`, router runtime options | Implemented |
| REQ-004 Context files merge deterministically | Duplicate context path | `src/core/runtime.ts` | Implemented |
| REQ-005 Skills and Pi packages are selected | Disabled selected skill | `src/core/runtime.ts`, `test/pi-packages.test.mjs`, `test/user-skills.test.mjs` | Implemented |
| REQ-006 Tool activation is profile-gated | Run control wraps yieldable tools | `src/core/runtime.ts`, `test/runs.test.mjs`, `test/runtime-tool.test.mjs` | Implemented |
| REQ-007 Extensions are assembled | Provider-backed web search selected | `src/core/runtime.ts`, `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-008 Model and thinking selection are resolved | Session active model survives default change | `src/core/runtime.ts`, `test/session-model-source-of-truth.test.mjs` | Implemented |
| REQ-009 Diagnostics are returned | Broken extension package | `src/core/runtime.ts` | Implemented |
| REQ-010 Profile inspection is non-executing | Inspect profile with subagent | `src/core/runtime.ts`, `src/cli.ts`, `test/subagents.test.mjs` | Implemented |
| REQ-011 Build Context snapshots are read-only, ordered, and redacted | Inspect managed session startup context | `src/core/context-build.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/context/ContextBuildView.tsx`, `test/context-build-inspector.test.mjs` | Implemented |
| REQ-012 Direct TUI refuses routed-only profiles | Subagent profile in direct TUI | `src/core/runtime.ts` | Implemented |

## Verification Basis

This spec is based on the current behavior in `src/core/runtime.ts`, `src/core/context-build.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/context/ContextBuildView.tsx`, `src/cli.ts`, `src/core/session-router.ts`, `src/tools/web-search.ts`, `src/tools/runtime/tool.ts`, `src/subagents/tool.ts`, `src/runs/tools.ts`, and related tests including `test/context-build-inspector.test.mjs`, `test/session-router-store.test.mjs`, `test/codex-compat.test.mjs`, `test/subagents.test.mjs`, `test/runtime-tool.test.mjs`, and `test/session-model-source-of-truth.test.mjs`.
