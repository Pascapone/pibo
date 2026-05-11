# Spec: Core Plugin Profiles and Built-In Harness Skill

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Codex-Compatible Runtime Profile](./codex-compatible-runtime-profile.md), [Operator CLI Discovery and Dispatch](./operator-cli-discovery-and-dispatch.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md)

## Why

Pibo's plugin registry is assembled from a small set of built-in plugins before any web, gateway, or custom-agent behavior runs. That assembly defines which profiles, skills, gateway actions, and native tools are available by default.

Most surrounding capabilities already specify the large surfaces, such as routed sessions, gateway actions, Codex compatibility, and model selection. This spec captures the remaining core contract: the default registry composition, the built-in Pi Agent Harness skill, the Kimi pinned profile, and the parked gateway-producer profile used only by explicit CLI compatibility paths.

## Goal

Pibo MUST expose a deterministic core plugin registry whose default profiles and parked compatibility profiles are discoverable, scoped, and assembled only from registered capabilities.

## Background / Current State

`src/plugins/builtin.ts` defines the `pibo.core` plugin. It registers the built-in `pi-agent-harness` skill, the provider-backed `web_search` tool, the persistent `runtime` tool, the pinned `pibo-kimi-coding` profile, and core gateway actions. It then composes the Codex compatibility plugin into the default registry.

The gateway-producer plugin is intentionally not part of the default registry. It is available through `createGatewayProducerPiboPluginRegistry()` and through the CLI compatibility aliases `gateway-producer` and `pibo-gateway-producer`.

## Scope

### In Scope

- Default plugin-registry composition from `pibo.core` and `pibo.codex-compat`.
- Built-in `pi-agent-harness` skill registration and resolution.
- `pibo-kimi-coding` profile and aliases.
- Default profile selection for CLI profile/TUI entry points.
- Parked `pibo-gateway-producer` profile availability through explicit compatibility paths.

### Out of Scope

- Detailed gateway action behavior — covered by gateway, session-control, model-provider, thinking, and compaction specs.
- Codex-compatible profile internals — covered by the Codex-compatible runtime profile spec.
- User-installed skills — covered by User Skills.
- Gateway protocol details for `pibo_gateway_send` — covered by Local Gateway Protocol and Lifecycle.

## Requirements

### Requirement: Default registry composition is deterministic

The default Pibo plugin registry MUST load the core plugin and Codex compatibility plugin, and MUST NOT load the gateway-producer plugin.

#### Current

`createDefaultPiboPlugins()` returns `[piboCorePlugin, piboCodexCompatPlugin]`. `createDefaultPiboPluginRegistry()` creates a registry from that list.

#### Target

Default profile creation and capability catalog inspection see the same built-in resources every time and do not expose parked compatibility profiles unless explicitly requested.

#### Acceptance

- The default registry resolves `codex` through the Codex compatibility plugin.
- The default registry exposes core registered tools such as `web_search` and `runtime`.
- The default registry exposes core gateway action metadata.
- The default registry does not expose `pibo-gateway-producer` as a normal default profile.

#### Scenario: Default profile catalog

- GIVEN a process creates the default Pibo plugin registry
- WHEN it inspects registered profiles and capability metadata
- THEN Codex-compatible resources and core resources are present
- AND gateway-producer resources are absent.

### Requirement: Built-in Pi Agent Harness skill is registered by core

The core plugin MUST register `pi-agent-harness` as a built-in skill at the repository skill path.

#### Current

`pibo.core` registers skill `pi-agent-harness` with path `skills/builtin/pi-agent-harness/SKILL.md` and kind `builtin`.

#### Target

Profiles that explicitly include the skill can rely on a stable skill name and path, and the capability catalog can distinguish it from user skills.

#### Acceptance

- The capability catalog includes skill `pi-agent-harness` with kind `builtin`.
- The skill path resolves to an existing `SKILL.md` file in the workspace/package.
- A user skill with another name remains cataloged as kind `user` and does not overwrite the built-in skill.
- A duplicate plugin skill name is rejected by the registry's uniqueness rules.

#### Scenario: Inspect built-in skill

- GIVEN the default registry is created
- WHEN the capability catalog is requested
- THEN it includes `pi-agent-harness`
- AND the entry is attributed as a built-in/plugin skill, not as a user-owned skill.

### Requirement: Base core profiles can include the harness skill without implicit tool broadening

Core profiles that use the core base-profile builder MUST add the harness skill while exposing only their selected tools and model constraints.

#### Current

`createBaseProfileBuilder()` creates an `InitialSessionContextBuilder` and adds `context.getSkill("pi-agent-harness")`. `pibo-kimi-coding` and `pibo-gateway-producer` use this builder. The Codex-compatible profile does not use this builder and owns its own context-file/prompt compatibility layer.

#### Target

The built-in skill can guide Pi-harness design work without automatically adding file, shell, MCP, or gateway tools.

#### Acceptance

- A base-built core profile includes `pi-agent-harness` in its profile skills.
- Adding the harness skill does not add native tools, built-in tool names, subagents, or Pi packages by itself.
- Codex-compatible profile behavior remains governed by its own spec and does not implicitly gain this skill unless its plugin selects it in future code.

#### Scenario: Inspect Kimi profile skills

- GIVEN the default registry resolves `pibo-kimi-coding`
- WHEN the profile is inspected
- THEN `pi-agent-harness` appears in the skill list
- AND no gateway-producer tool appears in that profile.

### Requirement: Kimi coding profile is pinned and aliasable

The core plugin MUST expose a Kimi profile that is pinned to the `kimi-coding` provider and `kimi-for-coding` model.

#### Current

`pibo.core` registers profile `pibo-kimi-coding` with aliases `kimi` and `kimi-coding`, description text that names the auth requirement, and `.withModel({ provider: "kimi-coding", id: "kimi-for-coding" })`.

#### Target

Operators can select the Kimi coding profile by canonical name or alias and get the same model pin without relying on global model defaults.

#### Acceptance

- `pibo-kimi-coding`, `kimi`, and `kimi-coding` all resolve to canonical profile name `pibo-kimi-coding`.
- The profile active model pin is provider `kimi-coding`, id `kimi-for-coding`.
- The profile includes the harness skill.
- Runtime model auth validation still applies when the pinned model is used.

#### Scenario: Select Kimi alias

- GIVEN a CLI or routed runtime asks for profile `kimi`
- WHEN the default registry creates the profile
- THEN the profile name is `pibo-kimi-coding`
- AND its model selection is pinned to `kimi-coding/kimi-for-coding`.

### Requirement: CLI default profile uses Codex compatibility

The operator CLI profile and TUI entry points MUST default to the Codex-compatible profile when no profile argument is supplied.

#### Current

`createCliProfile()` calls `createDefaultPiboPluginRegistry().createProfile(profileName ?? "codex-compat-openai-web")` unless the requested profile is a gateway-producer compatibility alias.

#### Target

CLI behavior stays aligned with the default coding-agent experience while still allowing explicit registered profile selection.

#### Acceptance

- `pibo profile` with no profile argument inspects `codex-compat-openai-web`.
- `pibo tui` with no profile argument starts the Codex-compatible profile path.
- Supplying `kimi` or `pibo-kimi-coding` selects the Kimi profile through the default registry.
- Unknown profile names fail through registry profile resolution instead of silently falling back.

#### Scenario: Inspect default CLI profile

- GIVEN an operator runs the profile inspection command without arguments
- WHEN the CLI creates its profile
- THEN the inspected profile is `codex-compat-openai-web`.

### Requirement: Gateway producer profile is parked behind explicit compatibility aliases

The gateway producer profile MUST be available only through the parked gateway-producer registry and explicit CLI compatibility aliases.

#### Current

`piboGatewayProducerPlugin` registers native gateway tools and profile `pibo-gateway-producer` with alias `gateway-producer`. `createGatewayProducerPiboPluginRegistry()` composes core, gateway-producer, and Codex compatibility plugins. `createCliProfile()` special-cases `gateway-producer` and `pibo-gateway-producer` to call `createGatewayProducerPiboProfile()`.

#### Target

Normal default registries do not expose a gateway-send capable profile, but legacy/operator flows that intentionally request it continue to work.

#### Acceptance

- `createGatewayProducerPiboPluginRegistry().createProfile("gateway-producer")` resolves canonical profile `pibo-gateway-producer`.
- The gateway producer profile includes `pibo_gateway_send` and the harness skill.
- The default registry does not require gateway-producer resources to create normal profiles.
- CLI requests for `gateway-producer` or `pibo-gateway-producer` use the parked profile path.

#### Scenario: Explicit gateway producer selection

- GIVEN an operator requests `pibo profile gateway-producer`
- WHEN the CLI creates the profile
- THEN it uses the parked gateway-producer registry
- AND the resulting profile exposes `pibo_gateway_send`.

## Edge Cases

- If the built-in harness skill file is missing from a packaged install, runtime inspection should surface resource-loader diagnostics rather than silently pretending the skill loaded.
- A future custom or plugin profile may select `pi-agent-harness`, but that does not change the default Codex-compatible profile contract unless the Codex spec is updated.
- The Kimi pinned profile can still fail at runtime if provider credentials are missing; this spec only owns profile selection and model pinning.
- Gateway-producer alias handling is intentionally narrower than general alias resolution because the profile is not in the default registry.

## Constraints

- **Compatibility:** Existing aliases `codex`, `kimi`, `kimi-coding`, `gateway-producer`, and `pibo-gateway-producer` must keep their current meanings where their registry composition includes them.
- **Security / Privacy:** Gateway-send capability must not appear in the default profile registry by accident.
- **Product Boundary:** Built-in skills and profiles are Pibo-owned registry resources; user skills and custom agents remain separate product records.
- **Dependencies:** Runtime loading of skill content depends on Pi Coding Agent resource loading from resolved profile paths.

## Success Criteria

- [ ] SC-001: Default registry inspection shows core and Codex resources but no default gateway-producer profile.
- [ ] SC-002: Capability catalog inspection shows `pi-agent-harness` as a built-in/plugin skill with an existing skill file.
- [ ] SC-003: `pibo-kimi-coding`, `kimi`, and `kimi-coding` resolve to the same pinned profile.
- [ ] SC-004: CLI profile/TUI defaults select `codex-compat-openai-web` when no profile is supplied.
- [ ] SC-005: Explicit gateway-producer CLI aliases expose `pibo_gateway_send` only through the parked registry path.

## Assumptions and Open Questions

### Assumptions

- The default coding-agent experience remains the Codex-compatible profile, not the Kimi pinned profile.
- The harness skill is guidance content, not a security or tool-enablement mechanism.
- Gateway-producer remains a compatibility profile rather than a normal selectable default profile.

### Open Questions

- Should the built-in harness skill be selected by the Codex-compatible profile, or is the Codex base prompt intentionally sufficient for that profile?
- Should `pibo profile` expose a command to list parked profiles separately from default registry profiles?
- Should packaged-install tests assert that every built-in skill path exists after `npm run build` and install?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Default registry composition is deterministic | Default profile catalog | `src/plugins/builtin.ts`, `test/plugin-registry.test.mjs` | Source-backed |
| REQ-002 Built-in Pi Agent Harness skill is registered by core | Inspect built-in skill | `src/plugins/builtin.ts`, `skills/builtin/pi-agent-harness/SKILL.md` | Source-backed |
| REQ-003 Base core profiles can include the harness skill without implicit tool broadening | Inspect Kimi profile skills | `src/plugins/builtin.ts`, `src/core/profiles.ts` | Source-backed |
| REQ-004 Kimi coding profile is pinned and aliasable | Select Kimi alias | `src/plugins/builtin.ts`, `src/plugins/registry.ts` | Source-backed |
| REQ-005 CLI default profile uses Codex compatibility | Inspect default CLI profile | `src/cli.ts`, `src/plugins/builtin.ts` | Source-backed |
| REQ-006 Gateway producer profile is parked behind explicit compatibility aliases | Explicit gateway producer selection | `src/cli.ts`, `src/plugins/builtin.ts`, `test/plugin-registry.test.mjs` | Partially tested |

## Verification Basis

This spec is based on current workspace code in:

- `src/plugins/builtin.ts`
- `src/plugins/registry.ts`
- `src/core/profiles.ts`
- `src/core/runtime.ts`
- `src/cli.ts`
- `skills/builtin/pi-agent-harness/SKILL.md`
- `test/plugin-registry.test.mjs`
- `test/codex-compat.test.mjs`
