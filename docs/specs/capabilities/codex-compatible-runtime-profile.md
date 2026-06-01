# Spec: Codex-Compatible Runtime Profile

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** `GLOSSARY.md`, [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Yielded Run Control](./yielded-run-control.md), [Subagent Delegation](./subagent-delegation.md), [Native Web Search Provider Adapter](./native-web-search-provider-adapter.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md)

## Why

Pibo's default operator experience depends on a profile that feels familiar to Codex-style coding agents while remaining honest about Pibo's own product boundary. The profile must expose a compact, safe tool surface, route long-running work through Pibo run control, support delegated child agents, and add only the compatibility prompt needed to explain those differences.

Without a dedicated contract, future profile or runtime changes could accidentally reintroduce unsupported Codex tools, hide Pibo-specific run-control behavior, or make the `codex` alias behave differently from the canonical profile used by routed sessions.

## Goal

Define the observable behavior of the Codex-compatible profile, its generated runtime tools, and its system-prompt compatibility layer as implemented in the current workspace.

## Background / Current State

The `pibo.codex-compat` plugin registers two local native tools, a plugin context file, three subagent definitions, and the canonical `codex-compat-openai-web` profile with alias `codex`. The profile enables the `codexCompat` and `runControl` tool packages, selects Pibo's provider-backed `web_search`, selects the persistent `runtime` tool, and limits Pi built-in tools to `read`, `edit`, and `write` while adding a run-control `bash` tool at runtime.

Runtime creation adds Codex compatibility tool definitions and a prompt extension only when the profile enables the `codexCompat` tool package. Profile inspection reports generated Pibo tools, subagent tools, run-control tools, and provider-backed tools without executing them.

## Scope

### In Scope

- The canonical Codex-compatible profile and its `codex` alias.
- Profile-selected built-in tools, native tools, context files, subagents, and tool packages.
- Runtime activation of `apply_patch`, `view_image`, run-control `bash`, yielded-run tools, subagent tools, provider-backed `web_search`, and persistent `runtime`.
- Codex compatibility system-prompt framing, environment context, and child-agent instructions.
- Behavior of the local `apply_patch` and `view_image` tools.

### Out of Scope

- Provider-specific web-search request serialization — covered by `native-web-search-provider-adapter.md`.
- General run-control stewardship, reminder, and pruning semantics — covered by `yielded-run-control.md`.
- Subagent session hierarchy and delegation lifecycle — covered by `subagent-delegation.md`.
- Custom-agent editing of Codex-like profiles — covered by `custom-agents.md`.
- Full Pi Coding Agent built-in tool behavior outside the profile allowlist.

## Requirements

### Requirement: The Codex alias resolves to one canonical Pibo profile

The registry MUST resolve `codex` to the canonical profile name `codex-compat-openai-web`.

#### Current

`piboCodexCompatPlugin` registers `codex-compat-openai-web` with alias `codex`.

#### Acceptance

A profile lookup for `codex` returns an initial session context whose `profileName` is `codex-compat-openai-web`.

#### Scenario: Operator selects alias

- GIVEN the default Pibo plugin registry is loaded
- WHEN a runtime or inspection creates profile `codex`
- THEN the returned profile uses canonical name `codex-compat-openai-web`
- AND downstream session records store the canonical profile identity.

### Requirement: The default tool surface is compact and Pibo-managed

The Codex-compatible profile MUST expose only the supported Pibo and Pi tools selected by the profile and generated runtime packages.

#### Current

The profile allows Pi built-ins `read`, `edit`, and `write`; enables `codexCompat` and `runControl`; selects `apply_patch`, `web_search`, `view_image`, and `runtime`; and selects three registered subagents. Runtime generation adds run-control `bash`, yielded-run tools, and `pibo_subagent_*` tools.

#### Acceptance

Profile inspection or runtime startup shows active `read`, `edit`, `write`, `bash`, `apply_patch`, `view_image`, `runtime`, `web_search`, `pibo_run_*`, and `pibo_subagent_default|explorer|worker` tools, and does not expose unsupported legacy Codex tools such as `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, or `close_agent`.

#### Scenario: Inspect default profile

- GIVEN the Codex-compatible profile is inspected
- WHEN the active tool list is read
- THEN `apply_patch`, `web_search`, `view_image`, and `runtime` are active
- AND `pibo_run_start`, `pibo_run_read`, and the other run-control tools are active
- AND `pibo_subagent_default`, `pibo_subagent_explorer`, and `pibo_subagent_worker` are active
- AND unsupported Codex agent-control tools are absent.

### Requirement: Shell execution goes through yielded run control

The profile MUST provide shell execution as the run-control `bash` tool rather than as a direct Codex compatibility tool.

#### Current

Runtime creation adds the run-control `bash` tool when the profile enables `runControl` and a run controller is present. `pibo_run_start` includes `bash` among yieldable tools.

#### Acceptance

An active Codex-compatible runtime has a direct `bash` tool for normal use and can start `bash` through `pibo_run_start`; the `codexCompat` tool package itself contributes only `apply_patch` and `view_image` local tool definitions.

#### Scenario: Start background shell work

- GIVEN a Codex-compatible runtime has run control enabled
- WHEN the agent inspects `pibo_run_start` parameters
- THEN `bash` is an allowed `toolName`
- AND long shell work can be yielded and read later through run-control tools.

### Requirement: Provider-backed web search remains selected but locally undefined

The profile MUST select `web_search` as a stable Pibo native tool while allowing the provider adapter to supply execution through the model provider.

#### Current

The profile selects the registered `web_search` native tool. The tool has provider metadata and no local Pi function definition.

#### Acceptance

Profile inspection reports `web_search` as registered and active with `hasDefinition=false`, and runtime provider extensions handle activation when the selected model provider supports it.

#### Scenario: Inspect web-search activation

- GIVEN the Codex-compatible profile selects `web_search`
- WHEN profile inspection lists active tools
- THEN `web_search` is active
- AND it is represented as provider-backed rather than as a local function tool.

### Requirement: Compatibility prompt describes Pibo behavior without inventing unsupported tools

The runtime MUST prepend Codex compatibility instructions that describe the actual Pibo tool surface and environment without claiming unavailable plan-mode or user-input tools.

#### Current

`createCodexCompatExtension` adds a `# Codex-Compatible Runtime` section, instructs agents to use `pibo_run_*` and `pibo_subagent_*` tools, mentions `web_search` generically when selected, and appends an environment block with cwd, shell, current date, timezone, and known subagent names.

#### Acceptance

A rendered prompt includes the compatibility heading, cwd, shell, current date, timezone, and subagent names; references selected `web_search` generically; and does not mention unavailable tools such as `update_plan` or `request_user_input` as if they exist.

#### Scenario: Render main-agent prompt

- GIVEN the Codex-compatible extension receives a base prompt
- WHEN the runtime starts a main session
- THEN the final system prompt includes the Pibo compatibility section
- AND the base prompt remains included after the compatibility section
- AND unsupported Codex-only tools are not advertised.

### Requirement: Child sessions get delegated-agent framing

When the profile is used for a child Pibo Session, the compatibility prompt MUST include delegated-child instructions.

#### Current

Runtime extension creation passes `isChildSession` when the profile has a parent session id. The prompt builder adds a `Delegated Child Agent` section only for child sessions.

#### Acceptance

A child runtime prompt tells the agent it is a delegated child that should complete delegated work, continue the child thread when the parent sends more input, and return a concise final result for the parent.

#### Scenario: Start child runtime

- GIVEN a subagent creates a child session using the Codex-compatible target profile
- WHEN the child runtime system prompt is rendered
- THEN it includes delegated-child framing
- AND a main session using the same profile does not include that section.

### Requirement: `apply_patch` executes patch text in the requested workspace

The `apply_patch` tool MUST run the workspace patch helper with the provided patch text and report the executed working directory and exit status.

#### Current

The tool accepts `patch` and optional `workdir`, resolves relative workdirs against runtime cwd, spawns `apply_patch`, writes patch text to stdin, collects stdout and stderr, and marks the result as an error when the process exits non-zero.

#### Acceptance

A successful patch returns text output, `details.cwd`, `details.exitCode`, and `isError=false`; a failed patch returns collected output with `isError=true` and the non-zero exit code.

#### Scenario: Patch with relative workdir

- GIVEN the runtime cwd is `/repo`
- WHEN the agent calls `apply_patch` with `workdir: "packages/app"`
- THEN the helper runs in `/repo/packages/app`
- AND the tool result includes that resolved cwd.

### Requirement: `view_image` returns local images as inline image content

The `view_image` tool MUST read a local image path and return an inline image result with a MIME type inferred from the file extension.

#### Current

The tool resolves relative paths against runtime cwd, reads the file, base64-encodes it, uses `image/jpeg` for `.jpg` and `.jpeg`, `image/webp` for `.webp`, `image/gif` for `.gif`, and `image/png` for other extensions, and records path and detail in result details.

#### Acceptance

A valid image path returns one image content item with base64 data, inferred MIME type, and result details containing the resolved path and optional `detail` value.

#### Scenario: Inspect JPEG screenshot

- GIVEN the runtime cwd is `/repo`
- WHEN the agent calls `view_image` with `path: "screenshots/page.jpg"`
- THEN the tool reads `/repo/screenshots/page.jpg`
- AND the result content has MIME type `image/jpeg`.

## Edge Cases

- If profile inspection lacks executable controllers, generated run-control and subagent tools MUST still be visible but MUST not execute.
- If no run controller is supplied at runtime, yielded-run tools and run-control `bash` are not activated even when the profile package is selected.
- If `web_search` is selected but the active provider cannot serialize it, provider adapter errors belong to the provider integration contract, not this profile contract.
- If `apply_patch` is aborted, the spawned helper receives `SIGTERM` and the tool reports the resulting process outcome.
- `view_image` does not validate image bytes beyond reading the file and assigning the extension-derived MIME type.

## Constraints

- **Compatibility:** The `codex` alias must remain stable for CLI, TUI, web, and scheduled job users that select it.
- **Security / Privacy:** The profile must not expose file or shell tools beyond the selected built-in and generated Pibo tool surface.
- **Truthfulness:** Prompt instructions must describe implemented Pibo behavior and must not advertise unavailable Codex-specific tools.
- **Dependencies:** `apply_patch` requires an `apply_patch` executable in the runtime environment.
- **Provider boundary:** Provider-backed tools are represented in profile metadata and activated by provider extensions, not local function definitions.

## Success Criteria

- [ ] SC-001: Registry tests verify `codex` resolves to `codex-compat-openai-web` and selects the expected tools, subagents, context file, and tool packages.
- [ ] SC-002: Profile inspection verifies active generated Pibo tools and the absence of unsupported Codex agent-control tools.
- [ ] SC-003: Runtime tests verify `bash` is available directly and as a yieldable run-control tool.
- [ ] SC-004: Prompt tests verify environment context, generic `web_search` wording, absence of unsupported tool claims, and child-agent framing.
- [ ] SC-005: Tool tests verify `apply_patch` cwd resolution, exit-code reporting, and error marking.
- [ ] SC-006: Tool tests verify `view_image` path resolution, MIME inference, base64 image output, and detail preservation.

## Assumptions and Open Questions

### Assumptions

- The current canonical default coding profile remains `codex-compat-openai-web` unless a future spec changes the product default.
- The compatibility prompt is intentionally additive and should preserve the downstream Pibo base prompt and context-file content.
- `default`, `explorer`, and `worker` are the stable Codex-compatible subagent names for this profile.

### Open Questions

- Should `apply_patch` enforce a maximum patch size before spawning the helper?
- Should `view_image` reject unsupported extensions or invalid image bytes instead of defaulting to `image/png`?
- Should `codexCompat` become a documented capability package in the capability catalog separate from the profile that currently uses it?

## Traceability

| Requirement | Scenario / Story | Source / Test Basis | Status |
|---|---|---|---|
| REQ-001 The Codex alias resolves to one canonical Pibo profile | Operator selects alias | `src/plugins/codex-compat.ts`, `src/plugins/registry.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-002 The default tool surface is compact and Pibo-managed | Inspect default profile | `src/plugins/codex-compat.ts`, `src/core/runtime.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-003 Shell execution goes through yielded run control | Start background shell work | `src/core/runtime.ts`, `test/codex-compat.test.mjs`, `test/runs.test.mjs` | Implemented |
| REQ-004 Provider-backed web search remains selected but locally undefined | Inspect web-search activation | `src/plugins/codex-compat.ts`, `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-005 Compatibility prompt describes Pibo behavior without inventing unsupported tools | Render main-agent prompt | `src/core/codex-compat.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-006 Child sessions get delegated-agent framing | Start child runtime | `src/core/runtime.ts`, `src/core/codex-compat.ts`, `src/subagents/tool.ts`, `test/codex-compat.test.mjs`, `test/subagents.test.mjs` | Implemented |
| REQ-007 `apply_patch` executes patch text in the requested workspace | Patch with relative workdir | `src/tools/codex-compat.ts` | Implemented |
| REQ-008 `view_image` returns local images as inline image content | Inspect JPEG screenshot | `src/tools/codex-compat.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `src/plugins/codex-compat.ts`, `src/core/codex-compat.ts`, `src/core/runtime.ts`, `src/core/profiles.ts`, `src/tools/codex-compat.ts`, `src/tools/web-search.ts`, `src/plugins/builtin.ts`, `test/codex-compat.test.mjs`, `test/plugin-registry.test.mjs`, `test/runs.test.mjs`, and `test/subagents.test.mjs`.
