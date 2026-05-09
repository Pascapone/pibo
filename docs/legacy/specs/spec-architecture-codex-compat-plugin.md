---
title: Pibo Codex Compatibility Plugin Specification
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [architecture, design, plugins, profiles, tools, prompt, subagents, auth]
---

# Introduction

This specification defines a narrow Codex-compatibility layer for Pibo. The goal is not to clone the full Codex product. The goal is to make a Codex-tuned model experience a Pibo runtime that keeps useful Codex-compatible coding affordances while using Pibo's native agent orchestration model: Pibo subagents, yielded runs, run notifications, and run-control tools.

## 1. Purpose & Scope

This specification covers:

- A new `codex-compat` plugin and profile set for Pibo.
- Codex-like model-visible tools, tool names, and tool descriptions.
- Local `web_search` with an optional provider-backed path using the same authentication path already used by Pibo and Pi when provider search is enabled.
- Codex-like subagent roles exposed through Pibo's native subagent and yielded-run system.
- Codex-like prompt assembly, including one Codex base-prompt context file and environment context.
- A phased implementation plan and acceptance criteria.

This specification does not cover:

- Codex marketplace or plugin-install UX.
- Codex plan mode.
- Codex approval popups or TUI parity.
- Codex app-server parity.
- A full clone of Codex internal runtime behavior that is not visible to the model.

Assumptions:

- Pibo continues to embed Pi Coding Agent as the inner engine.
- Pibo remains the owner of plugin registration, profile building, prompt ownership, routing, auth, and transport boundaries.
- The existing Pibo auth stack for model providers remains the single source of truth for provider authentication.

## 2. Definitions

- **Codex compatibility plugin**: A Pibo plugin that exposes a Codex-like agent-facing environment without recreating the full Codex product.
- **Agent-visible parity**: Parity focused only on what the model can see: instructions, tools, skills, subagents, context files, and runtime metadata.
- **Codex-compatible profile**: A Pibo profile that selects the Codex-like tool surface, skills, subagents, and prompt contract.
- **Local web search**: A `web_search` tool exposed to the model and executed by Pibo as a local HTTP search-result fetch.
- **OpenAI provider-backed web search**: An optional `web_search` path executed by OpenAI through the Responses API rather than by a local browser stack.
- **Compatibility alias**: A tool or profile name chosen to match Codex naming even when the underlying implementation is different.
- **Root agent**: The main routed Pibo session for the user-facing conversation.
- **Child agent**: A delegated agent session created through the Codex-compatible multi-agent tool surface.
- **Base prompt**: The static system or developer instruction layer that defines model behavior before project-specific context is injected.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Pibo MUST implement Codex compatibility as a narrow plugin and profile layer, not as a fork of Pi Coding Agent.
- **REQ-002**: The Codex-compatible environment MUST prioritize model-visible parity over human UI parity.
- **REQ-003**: The Codex compatibility layer MUST reuse Pibo's existing provider authentication path and MUST NOT introduce a second independent auth flow for model-backed tools.
- **REQ-004**: `web_search` MUST be exposed as a Codex-compatible model-visible tool. The default implementation MAY be local, and OpenAI provider-backed search MAY be enabled by profile configuration.
- **REQ-005**: The Codex-compatible `web_search` tool MUST support the same visible control concepts as Codex:
  - cached vs live external web access when provider-backed search is enabled
  - optional allowed domains
  - optional user location
  - optional search context size
- **REQ-006**: The Codex compatibility layer MUST expose a Codex-like core tool surface with these names unless a technical blocker is documented:
  - `read`
  - `edit`
  - `write`
  - `bash` through Pibo run-control, not Pi built-in bash
  - `apply_patch`
  - `web_search`
  - `view_image`
- **REQ-007**: The Codex compatibility layer MUST NOT expose `request_user_input` in this plugin. Agents should ask normal chat questions when user clarification is needed.
- **REQ-008**: Codex-compatible subagents MUST expose roles `default`, `explorer`, and `worker`.
- **REQ-009**: Child-agent prompt framing MUST state that the child agent is part of a team, may continue delegated work, and returns its final result to the parent.
- **REQ-010**: The compatibility profile MUST continue to use the existing `SKILL.md` skill system.
- **REQ-011**: The compatibility plugin MUST register exactly one plugin-owned context file for the Codex base prompt.
- **REQ-012**: The compatibility prompt builder MUST inject an explicit environment context block with at least `cwd`, `shell`, `current_date`, `timezone`, and visible subagent role information.
- **REQ-013**: The compatibility layer MUST allow selective reuse of the extracted static Codex base prompt, but MUST remove instructions that depend on product features Pibo does not implement.
- **REQ-014**: The implementation MUST preserve the current Pibo product boundary: tools, routing, prompt ownership, auth, and policy remain Pibo responsibilities.
- **REQ-015**: The compatibility tool descriptions MUST be close enough to Codex that a Codex-tuned model can infer expected behavior without additional translation.
- **REQ-016**: The first implementation MUST prefer a single `codex-compat` profile over many variants.
- **REQ-017**: The first implementation MUST avoid introducing marketplace, connector, or plugin-install semantics into the model prompt.
- **REQ-018**: Compatibility work MUST remain surgical. Existing non-Codex profiles and unrelated plugin behavior MUST remain unchanged unless directly required for shared infrastructure.
- **REQ-019**: The compatibility plugin MUST NOT register project-local instruction files such as `AGENTS.md`, `RULES.md`, or `GLOSSARY.md`. Normal Pibo/Pi project-context loading owns repository-specific files.
- **REQ-020**: Web-search follow-up work MUST be handled as one design track covering OpenAI provider-backed search, local search fallback, cached/live behavior, recency, allowed domains, and browser-use boundaries.
- **REQ-021**: The compatibility profile MUST enable Pibo's native `pibo-run-control` package and expose generated `pibo_run_*` tools for yielded run lifecycle management.
- **REQ-022**: The compatibility profile MUST expose Pibo generated subagent tools for the `default`, `explorer`, and `worker` roles using `pibo_subagent_*` names.
- **REQ-023**: The compatibility profile MUST NOT expose Codex-specific agent lifecycle tools `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, or `close_agent`.
- **REQ-024**: Pibo run-control completion delivery MUST use Pibo's native mailbox and notification mechanism. The compatibility plugin MUST NOT add a separate Codex mailbox implementation.
- **REQ-025**: PTY-backed shell execution is out of scope for the first Codex-compat implementation. It MAY be revisited as a future Pibo run-control enhancement.
- **REQ-026**: Agent Designer MUST allow custom agents to enable or disable each Pi built-in basic tool individually while keeping the controls grouped in the Basics section.
- **REQ-027**: The default `codex-compat` profile MUST enable Pi/Pibo `read`, `edit`, and `write`, MUST leave Pi built-in `bash` out, and MUST use Pibo run-control `bash` as the shell tool.
- **REQ-028**: The default `codex-compat` profile MUST NOT enable Pi `grep`, `find`, or `ls` by default. File discovery remains shell-driven through `bash` and commands such as `rg`.
- **CON-001**: Pibo MUST NOT implement a local browser runtime purely to satisfy `web_search` parity.
- **CON-002**: Codex compatibility MUST NOT require Plan mode, Codex-specific TUI state, or approval popups.
- **CON-003**: Compatibility naming MAY use Codex names for coding tools, but agent orchestration MUST use Pibo-native `pibo_subagent_*` and `pibo_run_*` names.
- **CON-004**: The plugin MUST NOT import OpenAI Codex's app-server, TUI, approval, marketplace, connector, or plugin-install subsystems.
- **GUD-001**: Prefer thin adapters over new abstractions when existing Pibo plugin/profile/runtime extension points are sufficient.
- **GUD-002**: Prefer one shared prompt builder path with a Codex-compat mode over a second unrelated prompt stack.
- **PAT-001**: Treat the compatibility layer as a translation surface:
  - Codex-like names and instructions outside
  - Pibo and Pi implementation details inside
- **PAT-002**: Reuse existing routed child-session machinery and Pibo yielded runs for subagents instead of building a second delegation system.

## 4. Interfaces & Data Contracts

### 4.1 Plugin and Profile Shape

The implementation should add a new plugin registration unit and one primary profile.

```ts
type PiboPlugin = {
  id: string;
  name?: string;
  register(api: PiboPluginApi): void;
};

type PiboProfileDefinition = {
  name: string;
  aliases?: readonly string[];
  description?: string;
  create(context: PiboProfileBuildContext): InitialSessionContext;
};
```

Recommended initial identifiers:

| Kind | Recommended name |
| --- | --- |
| Plugin id | `pibo.codex-compat` |
| Main profile | `codex-compat` |
| Optional alias | `codex` |

### 4.2 Tool Surface Contract

The compatibility profile should expose this initial tool surface:

| Visible tool name | Implementation strategy | Notes |
| --- | --- | --- |
| `read` | Pi/Pibo basic read tool | Standard file and image reading surface. |
| `edit` | Pi/Pibo basic edit tool | Standard exact-text file edit surface. |
| `write` | Pi/Pibo basic write tool | Standard file creation and overwrite surface. |
| `bash` | Pibo run-control yieldable shell tool | Provided by the native Pibo run-control package; Pi built-in `bash` is not selected. |
| `apply_patch` | New Pibo freeform patch tool | Match Codex patch flow closely. |
| `web_search` | Local Pibo tool by default; optional OpenAI provider-backed tool | No local browser/browser-use runtime owned by the plugin. |
| `view_image` | Pibo local image view tool | Follow current local-file image viewing semantics. |
| `pibo_subagent_default` | Generated Pibo subagent tool | Routes to the `default` child-agent role. |
| `pibo_subagent_explorer` | Generated Pibo subagent tool | Routes to the `explorer` child-agent role. |
| `pibo_subagent_worker` | Generated Pibo subagent tool | Routes to the `worker` child-agent role. |
| `pibo_run_start` | Generated Pibo run-control tool | Starts yieldable tools, including generated subagent tools, as yielded runs. |
| `pibo_run_list` | Generated Pibo run-control tool | Lists yielded runs owned by the current Pibo Session. |
| `pibo_run_status` | Generated Pibo run-control tool | Reads compact yielded-run status. |
| `pibo_run_wait` | Generated Pibo run-control tool | Waits a bounded time for a yielded run. |
| `pibo_run_read` | Generated Pibo run-control tool | Reads terminal yielded-run results and consumes tracked reminders. |
| `pibo_run_cancel` | Generated Pibo run-control tool | Cancels a yielded run and suppresses future reminders. |
| `pibo_run_ack` | Generated Pibo run-control tool | Acknowledges yielded-run updates without reading full results. |

Non-goals for this plugin include `request_user_input`, `update_plan`, `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`, Codex approval popups, Codex TUI parity, Codex app-server parity, Codex marketplace behavior, connector semantics, and plugin-install semantics.

### 4.3 Web Search Contract

The visible provider-backed `web_search` contract should map to the provider request shape used by Codex:

```ts
type CodexCompatibleWebSearchConfig = {
  external_web_access: boolean;
  filters?: {
    allowed_domains?: string[];
  };
  user_location?: {
    type: "approximate";
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
  };
  search_context_size?: "low" | "medium" | "high";
};
```

When provider-backed search is enabled, the runtime MUST convert this visible contract into the provider's Responses API request format and MUST continue using Pibo's provider auth token resolution path.

### 4.4 Prompt Assembly Contract

The compatibility prompt builder should assemble:

1. static Codex-compatible base instructions
2. tool-use instructions for the visible Codex-like tool set
3. child-agent instructions when the session is a delegated child
4. one plugin-owned Codex base-prompt context file
5. explicit environment context
6. visible skills section
7. optional visible plugin section only if needed for model guidance

The compatibility plugin must not explicitly register project-local files such as `AGENTS.md`, `RULES.md`, or `GLOSSARY.md`. Those files remain the responsibility of the normal Pibo/Pi project-context loader.

Recommended environment context shape:

```xml
<environment_context>
  <cwd>/absolute/path</cwd>
  <shell>bash</shell>
  <current_date>2026-05-02</current_date>
  <timezone>Europe/Berlin</timezone>
  <subagents>default, explorer, worker</subagents>
</environment_context>
```

### 4.5 Initial File-Level Integration Targets

| File | Planned responsibility |
| --- | --- |
| `src/plugins/builtin.ts` | Register the new compatibility plugin or include it in default plugin creation. |
| `src/plugins/types.ts` | Reuse existing plugin/profile contracts; extend only if compatibility metadata is required. |
| `src/core/profiles.ts` | Reuse existing profile selection model. |
| `src/core/runtime.ts` | Inject compatibility prompt resources and compatibility tools into runtime creation. |
| `src/subagents/tool.ts` | Reuse or wrap for Codex-compatible subagent tool names and descriptions. |
| New prompt-builder file under `src/core/` | Assemble Codex-compatible system/developer prompt sections. |
| New compatibility tool files under `src/plugins/` or `src/tools/` | Implement `apply_patch`, `view_image`, and `web_search` as needed. Shell execution is provided by Pibo run control's `bash` tool. |
| `src/apps/chat-ui/src/App.tsx` | Agent Designer exposes Pi built-in basic tools as a foldable Basics group with per-tool toggles. |

## 5. Acceptance Criteria

- **AC-001**: Given the `codex-compat` profile is created, When it is inspected, Then the visible tool names include the Codex-compatible coding tools and Pibo-native `pibo_run_*` and `pibo_subagent_*` orchestration tools defined by this specification.
- **AC-002**: Given the `codex-compat` profile is inspected, When context files are listed, Then the plugin-owned context files include the Codex base prompt and do not include `AGENTS.md`, `RULES.md`, or `GLOSSARY.md`.
- **AC-003**: Given a normal model turn under `codex-compat`, When the prompt is assembled, Then it includes an explicit environment context block with cwd, shell, date, timezone, and subagent role visibility.
- **AC-004**: Given the default `codex-compat` profile is active, When `web_search` is inspected, Then it is available as a local generated tool rather than a local browser stack.
- **AC-005**: Given provider-backed web search is enabled, When auth is required, Then the same provider authentication path used by Pibo and Pi model requests is reused.
- **AC-006**: Given provider-backed web search is enabled and the session runs in a constrained mode that prefers cached web access, When the `web_search` provider tool spec is generated, Then it sets the cached/live equivalent consistently.
- **AC-007**: Given a delegated child agent is started through Pibo subagent tooling, When the child session prompt is built, Then it includes team-oriented child-agent instructions distinct from the root session.
- **AC-008**: Given the compatibility profile uses subagents, When the model sees available roles, Then `default`, `explorer`, and `worker` are visible and documented.
- **AC-009**: Given the compatibility profile is enabled, When unrelated existing profiles are created, Then their existing capabilities remain unchanged.
- **AC-010**: Given static Codex prompt content is imported, When the compatibility prompt is rendered, Then instructions that depend on unsupported Codex-only product features are absent.
- **AC-011**: Given `request_user_input` is intentionally out of scope, When the compatibility prompt is assembled, Then the instructions do not imply the tool is available.
- **AC-012**: Given the compatibility tool surface includes `apply_patch`, When the model edits files manually, Then the visible editing contract matches the patch-based flow expected by Codex-tuned behavior.
- **AC-013**: Given Codex-specific agent lifecycle tools are intentionally out of scope, When the compatibility profile is inspected, Then `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` are not active tools.
- **AC-014**: Given a custom agent is edited in Agent Designer, When the Basics built-in tools group is expanded, Then `read`, `bash`, `edit`, and `write` can be enabled or disabled individually.
- **AC-015**: Given the default `codex-compat` profile is active, When runtime active tools are listed, Then `read`, `edit`, `write`, Pibo run-control `bash`, Codex-compatible patch/search/image tools, generated subagents, and `pibo_run_*` are active.
- **AC-016**: Given the default `codex-compat` profile is active, When runtime active tools are listed, Then Pi `grep`, `find`, and `ls` are not active by default.

## 6. Test Automation Strategy

- **Test Levels**: Unit and integration tests.
- **Frameworks**: Existing Node.js and TypeScript test/tooling already used by Pibo.
- **Primary Commands**: `npm test`, `npm run typecheck`.
- **Focused Test Areas**:
  - compatibility profile inspection
  - prompt assembly snapshots
  - optional provider request serialization for OpenAI-backed `web_search`
  - child-agent prompt framing
  - tool registration and name visibility
  - Pibo run-control and generated subagent tool visibility
  - auth reuse for provider-backed web search
- **Snapshot Scope**:
  - visible tool inventory for `codex-compat`
  - rendered prompt sections
  - generated web-search provider request body when provider-backed search is enabled
- **Regression Scope**:
  - existing default profile creation
  - existing subagent execution
  - existing run-control package behavior

## 7. Rationale & Context

Codex-tuned models are sensitive to the visible runtime contract. Tool names alone are not enough. The model also relies on tool descriptions, prompt sections, subagent framing, explicit runtime context, and a familiar skill system.

Pibo already has the correct architectural boundary for this work:

- profiles already select tools, skills, subagents, and context files
- runtime creation already injects custom tools and skills
- subagents already map to routed child sessions
- yielded runs already provide tracked/detached lifecycle, notifications, wait/read/cancel/ack semantics, and trace reconstruction
- provider-backed model calls already exist and already own authentication

The compatibility layer therefore does not require a new agent runtime. It requires a new compatibility translation surface.

Local `web_search` is the current default because it keeps the Codex-compatible tool visible without adding a second provider dependency to the profile. Codex itself exposes `web_search` as a provider tool contract with cached/live controls, so Pibo keeps an optional provider-backed path available for future use. Reusing Pibo and Pi provider auth remains mandatory if provider-backed search is enabled because a second auth path would create operational drift and inconsistent model access.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent - inner runtime for turns, tools, sessions, and streaming.
- **EXT-002**: Model provider Responses API - required for normal model turns and optional provider-backed `web_search`.

### Third-Party Services

- **SVC-001**: Existing configured model provider - must support the Responses-style tool contract used by normal model turns.
- **SVC-002**: Optional search provider - required only when Pibo enables provider-backed `web_search` instead of local search.

### Infrastructure Dependencies

- **INF-001**: Existing Pibo provider auth and request pipeline - required for all provider-backed compatibility features.

### Data Dependencies

- **DAT-001**: Codex base-prompt context file owned by the compatibility plugin.
- **DAT-002**: Existing `SKILL.md` skill directories and paths.

### Technology Platform Dependencies

- **PLT-001**: Existing Pibo plugin/profile/runtime architecture.
- **PLT-002**: Existing Pibo routed subagent session infrastructure.

### Compliance Dependencies

- **COM-001**: The compatibility prompt and tool surface must remain truthful about implemented capabilities and must not claim Codex-only behaviors that do not exist in Pibo.

## 9. Examples & Edge Cases

### 9.1 Recommended Rollout Sequence

1. Add `pibo.codex-compat` plugin registration and a single `codex-compat` profile.
2. Implement prompt builder support for Codex-compatible base instructions and environment context.
3. Add default local `web_search` and keep provider delegation optional.
4. Add Codex-compatible shell and patch tools.
5. Add Codex-compatible subagent role exposure and collab tool adapters.
6. Update tests so the profile exposes the Codex base-prompt context file and no plugin-owned project-local instruction files.

### 9.2 Edge Case: Structured User Input

The compatibility prompt must not reference `request_user_input`. If clarification is needed, the model should ask concise direct questions in the normal conversation.

### 9.3 Edge Case: Provider-Backed Search Without Support

If provider-backed `web_search` is enabled and the configured search provider path cannot accept OpenAI-style `web_search`, the profile must either:

- fall back to the local `web_search` implementation, or
- fail profile activation with an explicit configuration error for provider-backed search.

Silent fallback to an unrelated local browser search path is not acceptable.

### 9.4 Edge Case: Child Agent Prompt Drift

If child agents reuse the root prompt unchanged, Codex-tuned delegation behavior will drift. The child prompt must explicitly mark the session as delegated child work.

## 10. Validation Criteria

- The repository contains a saved `codex-compat` architecture spec in `spec/`.
- A compatibility plugin id and primary profile name are defined and documented.
- Prompt snapshots show Codex-compatible environment and Codex base-prompt context sections.
- Profile inspection confirms the Codex base-prompt context file is present and `AGENTS.md`, `RULES.md`, and `GLOSSARY.md` are not plugin-owned context files.
- Provider request snapshots show `web_search` serialized as a provider tool request when OpenAI provider-backed search is enabled.
- Tests confirm provider auth reuse rather than a second auth path when provider-backed search is enabled.
- Profile inspection confirms the expected compatibility tool names and role visibility.
- Existing non-compat profiles continue to pass their current tests.

## 11. Related Specifications / Further Reading

- [spec-architecture-runtime-boundary.md](<HOME>/code/pibo/spec/spec-architecture-runtime-boundary.md)
- [spec-architecture-pibo-session-model.md](<HOME>/code/pibo/spec/spec-architecture-pibo-session-model.md)
- [docs/architecture.md](<HOME>/code/pibo/docs/architecture.md)
- [docs/codex-harness-analysis.md](<HOME>/code/pibo/docs/codex-harness-analysis.md)
