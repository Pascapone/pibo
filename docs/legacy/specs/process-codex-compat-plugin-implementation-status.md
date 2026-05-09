---
title: Codex Compatibility Plugin Implementation Status
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [process, implementation-status, codex-compat, plugins, profiles, tools, prompt]
---

# Introduction

This document records the current implementation status and revised follow-up plan for the Pibo Codex compatibility plugin after the first implementation pass. It is a companion status document for `spec/spec-architecture-codex-compat-plugin.md`.

The implemented scope is a narrow Codex-compatible model-visible environment. It does not attempt to clone the full Codex product.

## 1. Current Implementation Summary

The current implementation adds a default Pibo plugin and profile that expose a Codex-like runtime contract to the model. The revised plan keeps the narrow Codex-compatible surface but changes the context-file strategy and bundles all web-search follow-up work into one web-search track.

| Area | Status | Notes |
| --- | --- | --- |
| Plugin registration | Implemented | Plugin id is `pibo.codex-compat`. |
| Profile registration | Implemented | Primary profile is `codex-compat`; alias is `codex`. |
| Selective Pi basic tools | Implemented | The profile enables Pi/Pibo `read`, `edit`, and `write`, and intentionally leaves Pi built-in `bash` out so Pibo run-control supplies the shell surface. |
| Project instruction files | Removed from plugin | `AGENTS.md`, `RULES.md`, and `GLOSSARY.md` are project-local files and are no longer registered by the Codex compatibility plugin. |
| Codex base prompt context file | Implemented | The plugin now provides one Codex base-prompt context file at `context/codex-base-prompt.md`. |
| Environment context | Implemented | Prompt hook injects `cwd`, `shell`, `current_date`, `timezone`, and visible subagent roles. |
| Child-agent framing | Implemented | Child sessions receive delegated-agent framing when a parent Pi session id is present. |
| Subagent roles | Implemented through Pibo tools | Roles are `default`, `explorer`, and `worker`, exposed as generated `pibo_subagent_*` tools. |
| Pibo run control | Implemented | The `codex-compat` profile enables the native `pibo-run-control` package and exposes `pibo_run_*` lifecycle tools. |
| Local web search | Implemented | The profile exposes `web_search` as a local Pibo tool backed by DuckDuckGo HTML results. |
| OpenAI provider-backed web search | Optional hook exists, inactive in the default profile | The provider request hook can inject a Responses `web_search` tool when `providerWebSearch` is enabled; the `codex-compat` profile currently sets it to `false`. |
| Browser-use web search | Use existing system capability | The plugin should not add a separate browser runtime. If the profile has access to the system browser-use tool, the agent can use that normal Pibo capability. |

## 2. Implemented Tool Surface

The `codex-compat` profile exposes these model-visible tool names:

| Tool name | Status | Implementation notes |
| --- | --- | --- |
| `read` | Implemented through Pi/Pibo basic tools | Reads files and images through the standard Pi read tool. |
| `edit` | Implemented through Pi/Pibo basic tools | Performs precise exact-text edits through the standard Pi edit tool. |
| `write` | Implemented through Pi/Pibo basic tools | Creates or overwrites files through the standard Pi write tool. |
| `bash` | Implemented through Pibo run package | Pibo run-control provides the shell-command tool for the profile; Pi built-in `bash` is not selected. |
| `apply_patch` | Implemented | Invokes the local `apply_patch` command with a Codex-style patch body. |
| `web_search` | Implemented locally | Executes a local web search request and returns compact titles, URLs, and snippets. Provider delegation remains available as an optional extension path. |
| `view_image` | Implemented | Reads a local image file and returns an inline image tool result. |
| `pibo_subagent_default` | Implemented as generated Pibo tool | Routes to the `default` child-agent role. |
| `pibo_subagent_explorer` | Implemented as generated Pibo tool | Routes to the `explorer` child-agent role. |
| `pibo_subagent_worker` | Implemented as generated Pibo tool | Routes to the `worker` child-agent role. |
| `pibo_run_start` | Implemented through Pibo run package | Starts yieldable tools, including subagents, as yielded runs. |
| `pibo_run_list` | Implemented through Pibo run package | Lists yielded runs owned by the session. |
| `pibo_run_status` | Implemented through Pibo run package | Reads compact yielded-run status. |
| `pibo_run_wait` | Implemented through Pibo run package | Waits a bounded time for yielded runs. |
| `pibo_run_read` | Implemented through Pibo run package | Reads terminal results and consumes tracked reminders. |
| `pibo_run_cancel` | Implemented through Pibo run package | Cancels yielded runs. |
| `pibo_run_ack` | Implemented through Pibo run package | Acknowledges yielded-run updates. |

## 3. Prompt, Context, and Provider Behavior

The Codex compatibility runtime uses a Pi extension hook to wrap the normal Pibo/Pi system prompt.

Implemented prompt additions:

- A `# Codex-Compatible Runtime` section.
- A truthful statement that this is Pibo through the `codex-compat` profile.
- Guidance to use direct execution and normal chat questions when structured planning or input tools are absent.
- A web-search note that says calls and results are visible in the session trace.
- An XML-style `<environment_context>` block.
- Delegated child-agent instructions when the session is a child session.

Revised context-file target:

- Removed the plugin-registered `AGENTS.md`, `RULES.md`, and `GLOSSARY.md` context files.
- Added exactly one Codex base-prompt context file owned by the Codex compatibility plugin.
- Keep project-local instruction discovery outside the plugin so normal Pibo/Pi project context loading remains responsible for repository-specific files.

Implemented local web-search behavior:

- The active `codex-compat` profile exposes `web_search` as a normal local Pibo tool.
- The tool fetches DuckDuckGo HTML search results and parses compact titles, URLs, and snippets.
- `domains` are mapped to `site:` query filters.
- `recency` is accepted for compatibility but is not currently enforced.

Implemented provider behavior:

- If provider web search is enabled for a profile, the runtime mutates Responses-style provider payloads before the request is sent.
- The injected provider tool has `type: "web_search"`.
- Supported visible web-search configuration fields include:
  - `external_web_access`
  - `filters.allowed_domains`
  - `user_location`
  - `search_context_size`
- The default `codex-compat` profile currently does not enable OpenAI provider-backed web search.

## 4. Revised Topic Notes

The following notes reflect the current product direction. Items that are intentionally not wanted are removed from the follow-up list rather than tracked as gaps.

### Removed: `request_user_input`

`request_user_input` is no longer a target for this plugin. Pibo agents can ask normal chat questions, and the current Codex compatibility goal does not require structured blocking choice dialogs. Remove this from candidate work and keep the prompt truthful by not mentioning the tool.

### Removed: Codex Agent Lifecycle Tools

`spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` are no longer targets for this plugin. Pibo already owns agent orchestration through generated subagent tools and the yielded-run package. The Codex compatibility profile should expose Pibo's native `pibo_subagent_*` and `pibo_run_*` tools rather than adding a second Codex-shaped agent-handle layer.

### Codex Base Prompt Context

The plugin exposes a Codex base-prompt context file as its only plugin-owned context file. The previous `AGENTS.md`, `RULES.md`, and `GLOSSARY.md` entries were project-specific and have been removed from the plugin because the normal project context system already handles repository instructions. The base prompt is adapted from the OpenAI Codex CLI prompt and includes a Pibo override note so it does not claim unsupported Codex-only product behavior.

### Web Search Track

All browser, provider search, recency, and cached/live questions should be handled as one web-search project. The plugin should not add a second browser-use runtime; it can rely on Pibo's existing browser-use capability where available. The valuable Codex-specific work is enabling OpenAI provider-backed `web_search` as an optional search provider so Pibo can use the existing OpenAI/Codex subscription path for search when desired.

### OpenAI Search Provider

Pibo model requests continue to run through Pi Coding Agent, so generic model-provider capability detection is not important for this plugin. If OpenAI provider-backed search is enabled, the check should be scoped to the search-provider path: auth, payload shape, fallback behavior, and whether the active account/subscription can use OpenAI web search. The default local search can remain as a fallback while this is investigated.

### Cached Versus Live Search

Codex models cached versus live search through the provider `web_search.external_web_access` setting. Based on Codex's tool shape, this appears to be provider-side behavior rather than a local Codex cache. The exact cost and quota implications for OpenAI-backed search need a separate discussion before deciding whether Pibo exposes cached/live as a profile option.

### `web_search.recency`

`web_search.recency` belongs to the broader web-search track. The local schema accepts it for Codex-shape compatibility, but the implementation does not apply a date filter. The decision should be made together with provider-backed search, cached/live behavior, and whether local search remains a first-class provider.

### Shell Execution

Shell execution uses Pibo run-control's native `bash` tool, which can also be launched through `pibo_run_start` when shell work should be yielded. The profile keeps Pi `read`, `edit`, and `write` active, but does not select Pi built-in `bash`. PTY-backed terminal behavior is intentionally deferred and remains a future run-control parity item.

### Search And File Discovery

The Codex-compatible profile does not enable Pi's separate `grep`, `find`, or `ls` tools by default. Codex-style file discovery remains shell-driven through `bash` and repository tools such as `rg`, `rg --files`, `find`, and `ls`. The separate Pi search/list tools can stay available as future profile options, but they are not part of the v1 default surface.

### Agent Orchestration

Agent orchestration is a Pibo-native concern for this plugin. The model-visible workflow should use `pibo_run_start` to launch yieldable work, including `pibo_subagent_*` tools, and then use `pibo_run_wait`, `pibo_run_read`, `pibo_run_status`, `pibo_run_cancel`, and `pibo_run_ack` for lifecycle management. Completion delivery should use Pibo's existing mailbox/notification callback so finished child or frontend work is announced through the same mechanism used by other Pibo agents.

### Agent Designer Built-in Tools

Custom agents can now keep Pi built-in basic tools in the Basics area while enabling or disabling `read`, `bash`, `edit`, and `write` individually. The legacy all-or-nothing `builtinTools` mode remains for compatibility; per-tool selections are stored separately and only affect runtime allowlisting when the selected set differs from the default.

## 5. Revised Work Tracks

The following tracks replace the old flat gap list.

| Track | Phase | Notes |
| --- | --- | --- |
| Context cleanup and Codex base prompt | Done | Project-local context files were removed from the plugin and one Codex base-prompt context file was added. |
| Web-search project | V2 research and implementation | Bundle OpenAI provider-backed search, local search fallback, cached/live behavior, recency, allowed domains, and browser-use boundaries into one design pass. |
| Shell tool parity | Future | PTY support is intentionally not part of the current implementation; revisit only if terminal-sensitive or interactive programs become important. |
| Prompt and tool-description tuning | V2 | Align tool descriptions and prompt text with observed Codex-tuned model behavior after the context cleanup. |
| Prompt snapshot tests | V2 | Update tests so they assert one Codex base-prompt context file and no plugin-owned project-local context files. |
| Agent orchestration | Done for plugin scope | The plugin uses Pibo generated subagent tools and the native `pibo-run-control` package instead of Codex-specific agent lifecycle tools. Future orchestration changes belong to Pibo's run-system design, not this plugin. |
| Agent Designer built-in tools | Done | Pi built-in basic tools remain in Basics and can be toggled individually. |
| Codex v1 tool surface | Done | The default profile exposes `read`, `edit`, `write`, Pibo run-control `bash`, Codex-compatible patch/search/image tools, generated subagents, and `pibo_run_*`. |

## 6. Validation Performed

The implementation has been validated with:

- `npm run typecheck`
- `npm test`
- `node --test test/codex-compat.test.mjs`

Test coverage currently verifies:

- The default registry exposes the `codex-compat` profile and `codex` alias.
- The profile exposes the expected Codex-compatible coding tool names and Pibo-native run/subagent tools.
- The profile exposes subagent roles `default`, `explorer`, and `worker`.
- The active `codex-compat` profile exposes `read`, `edit`, and `write`.
- The active `codex-compat` profile uses Pibo run-control `bash` and does not select Pi built-in `bash`.
- The profile includes the Codex base-prompt context file and no plugin-owned `AGENTS.md`, `RULES.md`, or `GLOSSARY.md` context files.
- The Codex-compatible prompt includes environment context and child-agent framing.
- The prompt does not imply unavailable plan-mode tools.
- The active `codex-compat` profile exposes `web_search` as a local generated tool.
- The active `codex-compat` profile does not expose `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, or `close_agent`.
- The active `codex-compat` profile exposes Pibo run-control tools and generated `default`, `explorer`, and `worker` subagent tools.
- Provider-backed `web_search` can still be serialized as a Responses tool when explicitly enabled.

## 7. Current File-Level Implementation Map

| File | Responsibility |
| --- | --- |
| `src/plugins/codex-compat.ts` | Registers plugin, profile, visible tool names, the Codex base-prompt context file, and subagent roles. |
| `context/codex-base-prompt.md` | Provides the plugin-owned Codex base-prompt context file. |
| `src/tools/codex-compat.ts` | Implements Codex-compatible patch, web search, and image tools. Shell execution is provided by Pibo run control. |
| `src/core/codex-compat.ts` | Implements prompt wrapping and provider web-search payload injection. |
| `src/core/runtime.ts` | Wires Codex-compatible generated tools, Pibo base prompt ownership, and prompt/provider extension hooks into runtime creation. |
| `src/core/base-prompt.ts` | Owns the Pibo library/custom base prompt state and file locations. |
| `src/core/system-prompt-template.ts` | Expands `{{availableTools}}` and `{{guidelines}}` placeholders from the active runtime tool surface. |
| `context/pibo-system-prompt.md` | Provides the library Pibo base prompt used by default runtime creation. |
| `src/core/profiles.ts` | Adds profile package flags for `codexCompat` and `providerWebSearch`. |
| `src/plugins/builtin.ts` | Adds the Codex compatibility plugin to the default plugin registry. |
| `test/codex-compat.test.mjs` | Adds focused tests for profile shape, prompt behavior, and provider web-search serialization. |

## 8. Product Boundary Notes

The implementation preserves the Pibo product boundary:

- Pibo owns plugin registration and profile selection.
- Pibo owns the visible tool catalog, tool descriptions, generated subagent tools, and yielded-run lifecycle.
- Pibo owns prompt wrapping through Pi extension hooks.
- Pibo owns provider payload mutation before the model request is sent when provider-backed search is enabled.
- Pi Coding Agent remains the inner runtime for sessions, tools, streaming, and provider auth.
- Provider authentication continues through the existing Pi/Pibo model request path.

## 9. Recommended Next Decisions

The plugin context model has been updated: the profile no longer registers project-local files and now exposes exactly one Codex base-prompt context file.

After that, treat web search as one design pass. Decide whether OpenAI provider-backed search should be enabled, how it uses the existing OpenAI/Codex account path, how cached/live mode should be represented, how `recency` should work, and how it coexists with local search and Pibo's existing browser-use capability.

Agent orchestration is not a Codex-compat plugin gap. The plugin should keep using Pibo's run package and generated subagent tools. Any future resume, close, mailbox, or job semantics should be designed as Pibo run-system capabilities first.
