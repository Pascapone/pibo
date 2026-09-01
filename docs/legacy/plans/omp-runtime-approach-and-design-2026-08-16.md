---
type: "Historical Record"
title: "Oh My Pi (OMP) as a Pibo Agent Runtime — Approach & Design"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/plans/omp-runtime-approach-and-design-2026-08-16.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "cdb793c7b8e26ec67660ff5915040ca155db3bde"
  source_bytes: 19797
  source_sha256: "89a9c120dca91be3261b891dbf4eca66f248788651c8c27fdf872ea9c65eddf6"
  source_body_sha256: "89a9c120dca91be3261b891dbf4eca66f248788651c8c27fdf872ea9c65eddf6"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Oh My Pi (OMP) as a Pibo Agent Runtime — Approach & Design

**Status:** Proposed (critic gate pending)
**Date:** 2026-08-16
**Branch:** `feature/omp-runtime`
**Base:** `upstream/dev` @ `93cef82e`

## Problem

Pibo is a thin Node.js (`>=24`) product harness that embeds `@earendil-works/pi-coding-agent` via the Pi agent-runtime adapter. The objective is to run **Oh My Pi (OMP)** — `@oh-my-pi/pi-coding-agent` v17.3.5 (Can Boluk's fork, the basis of `omp.sh`) — as an additional Pibo agent runtime, such that:

- all important OMP engine functions are reachable through Pibo;
- important OMP slash commands are mirrored/surfaced;
- Pibo's skill, context-file, and tools systems keep working for the OMP runtime;
- model **providers are configurable through Pibo**.

## Key constraint discovered during feasibility analysis

**OMP is Bun-only; Pibo is Node.** `@oh-my-pi/pi-coding-agent@17.3.5` publishes raw `src/*.ts` as its `main`/`exports`, requires `bun >=1.3.14`, uses `bun:sqlite`, `Bun.*` globals (274 files), and ships a Bun-targeted CLI bundle (`target: "bun"`). Pibo runs under Node >= 24 and cannot `import` OMP in-process. Its current Pi dependency is a *different* fork lineage (`@earendil-works/pi-*`), so OMP is not a drop-in `pi` adapter replacement.

**Feasibility proven (WSL, Bun 1.3.14):** OMP installs with `bun install`, native Rust N-API addon builds via `bun --cwd=packages/natives run build`, and `bun packages/coding-agent/src/cli.ts --mode rpc` boots and processes JSON-lines-over-stdio RPC (handshake reaches `negotiate_protocol`/`session`; only a missing model credential stops a live turn). This is a real, runnable engine.

## Decision: OMP agent-runtime adapter, stdio RPC bridge

Build a **`omp` agent-runtime adapter** under `src/agent-runtimes/omp/` following the exact structure of the existing `codex-native` adapter (`src/agent-runtimes/codex-native/`). The adapter spawns the OMP CLI in `--mode rpc` as a child process and speaks OMP's **JSON-lines-over-stdio RPC protocol** (from `packages/coding-agent/src/modes/rpc/rpc-{types,frame,mode,messages,input}.ts`). Pibo remains the product/orchestration layer; OMP owns the model loop, native tools, and native session.

This reuses the mature agent-runtime SPI: `AgentRuntimeDriver`/`AgentRuntimeAdapter`/`AgentRuntimeSession`, registry, capabilities, property resources (portable tools, skills, context, MCP), bindings, history, auth, and debug. No changes to generic orchestration are needed because Pibo already dispatches by capability.

### Why RPC bridge (not embed, not ACP)

| Option | Verdict |
|---|---|
| Embed OMP into Node | **Impossible** — Bun-only source. |
| Reuse `pi` adapter with OMP | Wrong lineage; OMP ≠ `@earendil-works/pi-*`. |
| **OMP `--mode rpc` stdio bridge** | **Chosen** — first-class, rich protocol. |
| OMP `--mode acp` | ACP (Agent Client Protocol) is generic/lossy for OMP's rich features; `rpc` is OMP-native and full. |

## OMP RPC protocol essentials (evidence-based)

- **Transport:** newline-delimited JSON; commands on stdin, responses + async events on stdout. `PI_NOTIFICATIONS=off`. One frame per line, ≤ 1 MiB physical; `ready` first; `negotiate_protocol` with `protocolVersion:2` upgrades encoder; oversized frames reassembled via `rpc_chunk` (base64, ≤ 256 KiB chunks, ≤ 64 MiB).
- **Ready frame:** `{type:"ready",protocolVersion:1,supportedProtocolVersions:[1,2],maxFrameBytes,maxReassembledFrameBytes}`.
- **Commands (stdin):** `prompt`, `steer`, `follow_up`, `abort`, `abort_and_prompt`, `new_session`, `get_state`, `set_fast_mode`, `get_available_commands`, `set_todos`, `set_host_tools`, `set_host_uri_schemes`, `set_subagent_subscription`, `get_subagents`, `get_subagent_messages`, `set_model`, `cycle_model`, `get_available_models`, `set_thinking_level`, `cycle_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `set_interrupt_mode`, `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry`, `bash`, `abort_bash`, `get_session_stats`, `export_html`, `switch_session`, `branch`, `get_branch_messages`, `get_last_assistant_text`, `set_session_name`, `handoff`, `get_messages`, `get_messages_page`, `get_login_providers`, `login`.
- **Correlation:** each command may carry `id`; responses match by `id` (`{id?,type:"response",command,success:true,data?}` or `{...success:false,error,code?}`). `bash` is dispatched concurrently → **must match by `id`**. Side-channel frames (host_tool_*, host_uri_*, extension_ui_response) overtake the queue.
- **Streaming:** assistant output as `message_update` frames carrying `assistantMessageEvent` (`start`/`text_start|delta|end`/`thinking_start|delta|end`/`toolcall_start|delta|end`/`done`/`error`) with a full `partial` snapshot; terminal state in `message_end` then `agent_end{isTerminal}`.
- **Events (stdout, ~43 frame types):** `ready`, `response`, `prompt_result`, `available_commands_update`, `command_output`, `session_info_update`, `config_update`, `extension_error`, `session_shutdown`, `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`, `auto_compaction_start/end`, `auto_retry_start/end`, `retry_fallback_*`, `model_changed`, `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`, `irc_message`, `notice`, `thinking_level_changed`, `goal_updated`, `extension_ui_request`, `host_tool_call/cancel`, `host_uri_request/cancel`, `subagent_lifecycle/progress/event`, `rpc_chunk`, `rpc_frame_error`.
- **Host tools** (`set_host_tools`): bidirectional bridge — Pibo registers tool definitions; OMP emits `host_tool_call`/`host_tool_cancel`; Pibo replies `host_tool_result`/`host_tool_update`.
- **Host URI schemes** (`set_host_uri_schemes`): read/write request/cancel/result bridge.
- **Skills/context:** NOT RPC-governed — OMP discovers skills (`.omp/skills`) and context files (`AGENTS.md`) from the session cwd/file system and renders them into its own base prompt. Host steers via `cwd`, on-disk files, and settings.
- **Providers:** configured headlessly via `models.yml` (providers map: baseUrl, apiKey, api, auth, discovery, models, modelOverrides) + env vars + `Settings` (disabledProviders, enabledModels, modelTags); credentials in local SQLite or an auth broker; OAuth login headlessly via `get_login_providers` + `login` (emits `open_url` extension_ui_request for the browser step).
- **Slash commands:** surfaced via `get_available_commands` + `available_commands_update`, sourced from builtins/skills/extensions/custom/mcp_prompt/file (`.omp/commands`).

See `docs/reports/omp-rpc-protocol.md` for the full wire spec and `docs/reports/omp-host-capabilities.md` for host surfaces.

## Adapter structure

Mirror `codex-native` layout under `src/agent-runtimes/omp/`:

| File | Responsibility |
|---|---|
| `config.ts` | `OmpRuntimeConfig` JSON schema + typed parse: `bunExecutable`, `ompEntry`, `ompHome` (isolated per configured instance), session dir, startup timeout, resource env allowlist, model/provider defaults. |
| `process.ts` | Spawn `bun <ompEntry> --mode rpc` as child; readiness handshake; version/config diagnostics; isolated private `ompHome`/session-cwd per session generation; process env isolation + cleanup; idempotent dispose. |
| `client.ts` | JSON-lines RPC client: line framing, `ready` handshake, `negotiate_protocol`→v2, `RpcChunkFrame` reassembly on stdout, per-`id` command correlation, stdout event dispatch (the ~43 frame types normalized into Pibo semantic events), malformed-line resilience. |
| `thread.ts` | Session lifecycle: `new_session`, `switch_session`, `branch`, `get_session_stats`; binding construction (`adapterId=omp`, `runtimeInstanceId`, `nativeSessionId`, `.omp` locator); missing/error states. |
| `turn.ts` | `prompt`/`steer`/`follow_up`/`abort`; `message_update` streaming normalization → assistant deltas/reasoning/tool events; terminal `agent_end{isTerminal}` handling; per-`id` result wait. |
| `host-tools.ts` | Pibo portable tool definitions → `RpcHostToolDefinition`; handle `host_tool_call`/`cancel`; reply `host_tool_result`/`update`. |
| `resource-delivery.ts` | Materialize selected skills into an isolated `.omp/skills` dir under session cwd; deliver context files into `AGENTS.md`/rules; scoped MCP via host surfaces; delivery reports. |
| `models.ts` | Model catalog from `get_available_models`; `set_model`/`set_thinking_level`; reasoning values; context usage. |
| `auth.ts` | Auth status via `get_login_providers`; `login`/logout flows; credential scope = runtime-instance; opaque Pibo flow ids. |
| `history.ts` | Product history primary; `get_messages`/`get_messages_page` behind the adapter for native history inspection/read. |
| `adapter.ts` | Driver descriptor, truthful capability matrix, adapter (`diagnose`, `validateProfile`, `openSession`), session. |
| `plugin.ts` | `definePiboPlugin` registering driver + a configured instance (`omp-native`) + profile. |

## Truthful capability matrix (evidence-based)

From the OMP RPC protocol and host surfaces (a new adapter must not claim unsupported behavior):

- **lifecycle:** persistent, resume (`switch_session`/session dir), attach, listNativeSessions (via session files), fork/clone (`branch`), tree restricted (no full tree RPC) → `tree:false`.
- **input:** text `true`, images `true` (prompt carries `images`), audio `false`, steering `true`.
- **output:** assistantDeltas `true` (message_update), reasoning `true` (thinking_*), toolEvents `true` (tool_execution_*), usage `true` (contextUsage/usage), plans/diffs/rawNativeEvents `false`.
- **tools:** piboManaged via `host-tools` bridge (direct in-RPC delivery); nativeToolInspection `degraded` (observe runtime tool items); nativeToolYielding unsupported.
- **skills:** `materialized` (isolated `.omp/skills` dir) — OMP has no RPC skill-injection command.
- **context:** `materialized` (session-cwd `AGENTS.md`/rules) — OMP has no context injection command.
- **auth:** status, methods `api_key` (immediate) + `device_code`/OAuth (notification via `open_url`); cancel/logout; scope `runtime-instance`.
- **models:** catalog `true`, switchInSession `true`, options schema.
- **reasoning:** supported, OMP thinking levels.
- **approvals:** `supported:false` — no RPC approval command; interactive approvals live in the TUI. Declared honestly with a Designer-facing reason.
- **maintenance:** compaction `true` (`compact`), contextUsage `true`, history `true`, health `true`.

## Mapping to the user's five requirements

1. **All important OMP functions reachable through Pibo:** prompt/steer/abort/compact, models, thinking, history, subagents, host tools, sessions, providers all map 1:1 to OMP RPC commands exposed through adapter capabilities and controls.
2. **Important slash commands mirrored:** `get_available_commands` + `available_commands_update` surface builtin + file + skill slash commands; Pibo exposes them for the OMP runtime (commands that are engine-level like compact/switch/branch become adapter controls; the rest are surfaced from OMP itself so Pibo does not reimplement OMP logic).
3. **Pibo skill/context/tools systems keep working:** skills → materialized `.omp/skills`; context → materialized `AGENTS.md`; tools → host-tools bridge (portable Pibo tools delivered directly; MCP via host surfaces). Uses the existing property-resource services; no global OMP config mutation (session/generation-scoped `cwd` + isolated `ompHome`).
4. **Providers configurable via Pibo:** Pibo config maps to (a) `models.yml` written into the isolated `ompHome` (baseUrl/apiKey/auth/discovery/models), (b) resource env allowlist (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), and (c) `get_login_providers`/`login` OAuth flow surfaced through Pibo auth. No operator hand-edits OMP user-global state.
5. **Production quality & tested:** shared adapter contract suite, deterministic RPC fixtures, process/cleanup/missing/error tests, full-suite + typecheck, and exact WSL Bun+OMP integration validation for a real prompt turn (requires a configured provider credential).

## Worktree & repo hygiene

- Main repo working tree (`C:/Users/pasca/Coding/pibo`) has unrelated user changes — never commit there.
- This design lands in the dedicated worktree `C:/Users/pasca/Coding/pibo/.worktrees/omp-runtime` on branch `feature/omp-runtime` sourced from `upstream/dev`.
- Commits only validated milestones; no merge/publish/deploy as part of this objective.

## Verified feasibility facts (2026-08-16, from OMP source)

- **Home-dir isolation:** `PI_CODING_AGENT_DIR` env var overrides OMP's agent directory per-process (`packages/utils/src/dirs.ts`, `setProfile`/`getAgentDir`); `OMP_PROFILE`/`PI_PROFILE` select named profiles. Pibo can isolate each session's OMP home/cwd via env → satisfies "no user-global mutation".
- **Slash commands over RPC:** OMP's `prompt` command dispatches skill commands via `tryRunRpcSkillCommand` and builtin slash commands (with a text `handle`) via `executeAcpBuiltinSlashCommand` (`modes/rpc/rpc-mode.ts:981-1010`, `slash-commands/acp-builtins.ts`). So slash commands ARE reachable through the RPC bridge; Pibo surfaces the full command list via `get_available_commands` + `available_commands_update`, and engine-level effects (compact/switch/branch/fork/model/thinking) map to dedicated RPC commands. Builtin inventory: modes (auto, budget, cancel, compare, computer, disposition, drop, export, fast, goal, guided-goal, import, loop, model, pause, plan, plan-review, prewalk, providers, queue, resume, scan, scans, security, settings, setup, status, switch, validate, vibe, vision), session (agents, branch, context, fork, help, info, jobs, login, logout, mcp, prompts, reauth, resources, session, stats, todo, tools, tree, usage), lifecycle (compact, debug, diagnose, dirs, exit, fresh, handoff, help, memory, new, resume, retry, shake, ssh, stats), collaboration (advisor, browser, collab, share, status), marketplace (discover, install, installed, marketplace, plugins, remove, update), control (quit).
- **Approvals:** no RPC approval command; interactive approvals live in the TUI → capability `approvals.supported:false` (honest), Designer-facing reason. OMP headless RPC handles tools without an interactive approval surface.
- **Native tools/skills/context:** OMP owns native tools and base prompt; skills (`loadSkills`, `.omp/skills`), context (`loadProjectContextFiles`, `AGENTS.md`) discovered from session cwd and rendered into OMP's base prompt. Pibo materializes selected skills/context into the isolated session cwd; no RPC injection needed — this is the "materialized" delivery mode matching OMP's design.

## MUST-FIX resolutions (from critic approach review — PASS with conditions)

1. **Session-cwd semantics (MUST-FIX #1):** OMP's child process runs with `cwd = the Pibo target project dir` (the user's workspace), so OMP native tools (`bash`, `edit`, `write`, `read`, file discovery) act on the real project — required for "all important OMP functions". Agent state isolation is achieved separately: `PI_CODING_AGENT_DIR=<isolated pibo ompHome>` points OMP's `~/.omp`-equivalent state at a Pibo-owned dir. Therefore `ompHome` (agent/config state) and session cwd (native tool + discovery root) are **two distinct** dirs; the doc's "isolated session cwd" wording is corrected to "isolated ompHome + real project cwd". Pibo writes no files into the real project tree for agent state.
2. **Skills/context materialization merge + precedence (MUST-FIX #2):** Use OMP's native `skills.customDirectories` array (settings-schema.ts:4811) written into the isolated `ompHome` `config.yml`. Pibo materializes ONLY Pibo-selected skills into a dedicated isolated dir `<pibo-omp-home>/skills/pibo/<contributionId>/...` and adds that dir to `skills.customDirectories`. The real project's own `.omp/skills`, `~/.claude/skills`, `~/.agents/skills`, `AGENTS.md` are **untouched** — OMP keeps discovering them natively. Precedence: OMP's own resolver decides (custom dirs are explicit high-priority per OMP, first-wins among customs). No clobbering of project files.
3. **Materialize BEFORE spawn (MUST-FIX #3):** Write the isolated skills dir + `config.yml` (with `skills.customDirectories`, provider config, defaults) in a `prepareOmpSessionPaths` step, **before** spawning the OMP process / issuing `new_session`. OMP reads `config.yml` at startup; no mid-session skill refresh needed. If a profile's skill selection changes mid-session, restart the session generation (binding-preserving) rather than claiming an RPC refresh that does not exist.
4. **`turn.ts` local-only prompt handling (MUST-FIX #4):** The per-`id` prompt wait must treat a `prompt` response carrying `agentInvoked:false` (and `prompt_result {agentInvoked:false}`) as terminal — do NOT await an `agent_end` frame that will never arrive. For `agentInvoked:true`, wait for the terminal `agent_end{isTerminal:true}` after the response confirms the prompt started. Explicit state in the turn controller: pending → await response; `agentInvoked:false` → complete immediately; `agentInvoked:true` → await `agent_end{isTerminal:true}`.
5. **Live-turn credential gate (MUST-FIX #5):** Two-tier verification. Tier-1 (mocked fixtures + shared contract + WSL boot/negotiation/state) is the automated test bar. Tier-2 (real model turn) requires a provider credential; it is a **documented completion gate**: adapter is "production-ready" once Tier-1 passes AND a real provider turn is validated on a disposable runtime (exact evidence in final audit), OR, if no credential exists, the done-bar is explicitly rescoped to Tier-1 + protocol-fixture streaming with live-turn documented as the remaining operator action. Stated explicitly so "done" is unambiguous.
6. **Per-`id` correlation (MUST-FIX #6):** `client.ts` keys every pending request by `id` in a Map; `bash` and side-channel frames never assume queue order (OMP docs: "clients MUST match on `id`", rpc-mode.ts:367-381).
7. **Native-tool governance scope (MUST-FIX #7):** With `approvals.supported:false` and no RPC approval command, OMP native tools (bash/edit/etc.) execute inside the OMP process without Pibo approval. Pibo governs only Pibo-hosted tools via the `host-tool` bridge. The OMP profile therefore keeps OMP's native tools enabled (part of "all important OMP functions"; OMP owns its tool loop) and **disables Pibo's redundant native tools** (`withBuiltinTools("disabled")`), mirroring `codex-native`. Documented in the profile and capability matrix.
8. **OAuth/`extension_ui_request` bridging (MUST-FIX #8):** The headless `login` flow's `open_url` arrives as `extension_ui_request`. V1 declares auth methods truthfully: `api_key` primary (env / `models.yml` key, completion `"immediate"`); OAuth/device-code `open_url` browser step surfaced through Pibo auth UX only if the bridge is implemented, otherwise the method is not advertised. Method list stays truthful.

### Native tool resume + fork/clone/tree
OMP `branch`/`switch_session`/`new_session` are used for fork/switch; `tree` stays `false` (no full tree RPC). Session resume maps OMP's session-file model (under isolated `ompHome`) to Pibo's `RuntimeSessionBinding` via a locator; `resume`/`attach` use `switch_session`/session-dir targeting. Missing session file → binding `state:"missing"`, never auto-recreate.

## Open items / risks

- Live end-to-end validation of a real model turn needs an OMP-compatible provider credential (baseUrl + apiKey). Feasibility with a stubbed/mocked provider covers protocol/vs. process; a real turn needs a key.
- OMP `branch`/tree support is partial — the capability matrix reflects this.
- Bun must be present on the host (or bundled) for the OMP child process to start; config exposes `bunExecutable` with diagnostics.