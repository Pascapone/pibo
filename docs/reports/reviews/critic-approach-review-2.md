---
type: "Evidence Report"
title: "Critic Review 2 — \"OMP as Pibo Runtime\" Approach & Design"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/plans/critic-approach-review-2.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "22dec11b0736127e60f5604c253fd9d497a8f916"
  source_bytes: 11714
  source_sha256: "7d5f312d3c08aeb2d89a81d649e7a79b307332d6dc87d04dc5232747810203df"
  source_body_sha256: "7d5f312d3c08aeb2d89a81d649e7a79b307332d6dc87d04dc5232747810203df"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:reviews:critic-approach-review-2"
  published_at: "2026-09-01T07:57:34Z"
---
# Critic Review 2 — "OMP as Pibo Runtime" Approach & Design

**Reviewer:** CriticApproach2 (fresh; prior review discarded)
**Date:** 2026-08-16
**Artifact reviewed:** `docs/plans/omp-runtime-approach-and-design-2026-08-16.md`, `docs/reports/omp-rpc-protocol.md`
**Scope:** verify the implementer's assertions against OMP source (`modes/rpc/`, `utils/src/dirs.ts`, `slash-commands/acp-builtins.ts`) and the Pibo SPI (`src/agent-runtime/`, `src/agent-runtimes/{codex-native,pi}/`, `src/plugins/codex-native.ts`).

---

## VERDICT: **PASS**

The process-RPC-bridge architecture is architecturally correct and evidence-backed. Every load-bearing assertion I checked against source holds: Bun-only constraint, `PI_CODING_AGENT_DIR` isolation, slash-command dispatch over RPC, `models.yml` provider config, capability matrix (truthful), and faithful SPI reuse. No invented capability and no broken invariant invalidates the chosen approach.

PASS is conditional: the MUST-FIX list below (see §Ordered MUST-FIX) must be resolved during implementation and re-reviewed at the gate. None of them overturns the architecture decision, but several are required to honestly meet the "production quality + extensive testing" claim.

---

## Findings per point

### (a) Process-RPC-bridge architecture — CORRECT

Verified evidence:
- **Bun-only is real.** `dirs.ts` imports `engines.bun` from package.json and calls `Bun.hash` (line `hashPath`). `rpc-frame.ts` uses `Buffer`; the codebase is advertised as Bun (`target:"bun"`). A Node `<24` import bridge is impossible; embedding is correctly rejected.
- **`PI_CODING_AGENT_DIR` isolation is real.** `dirs.ts` resolves `dirs.agentDir` through `DirResolver` honoring `process.env.PI_CODING_AGENT_DIR`; `getAgentDir()`, `getAgentDbPath()`, `getHistoryDbPath()`, `getSessionsDir()` all derive from it. Isolating `ompHome` per runtime instance via env therefore does satisfy "no user-global mutation" of `~/.omp` for agent state.
- **Slash commands ARE reachable over RPC.** `rpc-mode.ts` `case "prompt"` calls `tryRunRpcSkillCommand` (→ `{agentInvoked:true}` for matched loaded skill) then `executeAcpBuiltinSlashCommand` (→ handled-`false` route to `session.prompt`; builtin with residual prompt via `watchAndReportLocalOnlyPromptResult`). `acp-builtins.ts` confirms builtins with a text `handle` are dispatched, others filtered from the advertised list. The doc's citation (rpc-mode.ts:981-1010) is accurate.
- **`models.yml` provider config is real.** `model-registry.ts:251` → `ModelsConfigFile.relocate(path.join(getAgentDir(), "models.yml"))`. Because `getAgentDir()` is env-overridable, writing `models.yml` into the isolated `ompHome` correctly configures providers headlessly.

**Unresolved tension (must be decided, not a blocker of the bridge):**
- OMP runs **native bash/file tools at `sessionManager.getCwd()`** (`bash-runner.ts:77`, `session-tools.ts:1011`), and also discovers skills/context from that cwd. The design says "isolated private ompHome / session-cwd per session generation" (`process.ts`). These two readings conflict: an isolated **throwaway** cwd detaches OMP's native tools and skill/context discovery from the user's real project (native tools act on a scratch tree); pointing cwd at the user project means Pibo writes `.omp/skills` and `AGENTS.md` into the *real* project tree, colliding with the project's own OMP files. The design must pick one coherent cwd semantics and a combined-context strategy — see MUST-FIX #2/#3.
- **Native tools run ungated.** `approvals.supported:false` (verified: no RPC approval command in the command inventory) plus OMP's own bash/edit/computer tools executing inside the OMP process means Pibo's governance/approval layer does **not** gate OMP's native tools — only Pibo-hosted tools via the `host_tool` bridge are governed. The `pi` adapter already ships `approvals.supported:false`, so this is precedented, but the design should state explicitly how far ("all important OMP functions" incl. ungated bash) the product intends to go.

### (b) Capability matrix — TRUTHFUL (verified)

- `approvals.supported:false` — correct: no approval command exists in the RPC inventory. Consistent with `pi` adapter (`adapter.ts:127-130`).
- `skills`/`context` = `materialized` — correct: there is **no RPC injection command** for either; OMP discovers `.omp/skills` and `AGENTS.md`/rules from session cwd (`session-tools.ts:1011` discovery with `cwd`, `loadProjectContextFiles`). Materialization is the only delivery mode.
- `models` catalog + switch (verified `get_available_models`, `set_model`), `reasoning` thinking levels (verified `set_thinking_level`), `history` via `get_messages(_page)` (verified both commands), `images` via `prompt.images` (verified `command.images`).
- `tree:false` — honest, given OMP `branch` is partial and there is no full tree RPC.
- Minor over-caution (not a bug): `get_state` exposes `dumpTools` (full static native-tool inventory via `toolWireSchema`), so `nativeToolInspection:"degraded"` could be claimed more optimistically. "degraded" is the safe, truthful floor — acceptable.

### (c) SPI reuse and file layout — CORRECT

- The SPI already models every capability the adapter declares: `capabilities.ts` (`tools.piboManaged`/`nativeToolInspection`/`nativeToolYielding`, `skills`/`context` as `AgentRuntimeCapabilityDelivery` with `materialized` mode, `approvals`, `models`, `reasoning`, `maintenance`), `resource-service.ts`/`resources.ts` (property resources), `history.ts`, `auth.ts`, `context-build.ts`, `profile-validation.ts`, `testing/contract.ts`.
- `codex-native/` is a faithful structural precedent: `config/process/client/thread/turn/resource-delivery/models/auth/history/adapter/plugin`. The proposed `omp/` file set mirrors it. `plugin.ts` mirrors `plugins/codex-native.ts` (driver + instance + profile registration). Correct reuse — no second convention invented.

### (d) Testability without a model credential — PARTIAL / AMBIGUOUS

- Shared adapter contract suite exists (`agent-runtime/testing/contract.ts`), deterministic RPC fixtures and WSL real-process boot/negotiation are reasonable and coherent.
- **Gap:** the WSL real-process integration proves boot → `ready` → `negotiate_protocol`, **not** a live turn. Every streaming path that constitutes the actual product (text/thinking `message_update` normalization, `host_tool_call` round-trip, `turn_end`→`agent_end{isTerminal}`, reasoning windows, local-only slash returns) is then covered only by mocked fixtures — which can encode a misunderstanding of the real wire. This is admitted as an open item ("needs a provider credential"). To honestly claim "production quality + extensive testing", the design must either (i) require a credential for a real-turn validation as a completion gate, or (ii) explicitly rescope: mocked-fixture + boot validation is the "done" bar and live-turn is a follow-up milestone. Leaving this ambiguous makes the milestone non-falsifiable. See MUST-FIX #5.

### (e) Concrete gaps/risks (see ordered list below)

Beyond (d): local-only slash return semantics, skills-refresh timing (no RPC refresh command), `bash`-command late correlation, OAuth `extension_ui_request` browser step surfacing, Bun presence on host.

---

## Ordered MUST-FIX list

1. **Resolve session-cwd semantics before implementation** (`process.ts`). Decide whether the OMP child's cwd is (a) an isolated sandbox (native tools detached from user project — must then disable/steer OMP native tools and document the tree boundary) or (b) the Pibo target project dir (must then guard against clobbering the real `.omp/` and `AGENTS.md`). State one choice; do not conflate `ompHome` (agent state, isolated — correct) with session cwd (native tool + discovery root). Current text implies both and is incoherent under either reading.
2. **Define skills/context materialization merge + precedence** (`resource-delivery.ts`). OMP natively discovers cwd-level AND user-level skills and context. Pibo materializing its own `.omp/skills`/`AGENTS.md` into the same cwd collides with the project's real OMP files (or, in the fallback, is invisible to a detached cwd). Specify: which files Pibo owns, what happens to pre-existing project AGENTS.md / `.omp/skills`, and how Pibo-selected + project-native content combine.
3. **Materialize skills BEFORE spawn; identify a refresh trigger.** There is **no RPC command** to refresh skills mid-session — `session.refreshSkills()` (`agent-session.ts:4581`) is only reachable via `reloadPluginState` (slash/command-change paths). Materializing skills into the cwd while a session is already running will not surface them until a reload. The design must write skills before `new_session`, or add a reload path.
4. **`turn.ts` must handle local-only prompts without hanging.** `tryRunRpcSkillCommand` → `prompt {agentInvoked:true}` and handled builtin → `prompt {agentInvoked:false}` both return **without any `agent_start`/`agent_end` stream**. The per-`id` turn wait must treat a prompt response carrying `agentInvoked:false` (or `prompt_result {agentInvoked:false}`) as terminal and not await an `agent_end` frame. This is the highest-likelihood integration bug in the streaming path.
5. **Make the live-turn credential an explicit completion gate or rescope the "done" bar.** "Production quality + extensive testing" is currently unprovable without a real OMP-provider turn. Name either (i) a credential-backed real turn as a pre-merge requirement, or (ii) the reduced bar (boot/negotiation + mocked-fixture streaming) and demote live-turn to a follow-up milestone. Do not leave "done" ambiguous.
6. **`client.ts`: enforce per-`id` (not order) correlation for backgrounded commands.** `bash` is dispatched concurrently and its `response` arrives late out of queue order; side-channel frames (`extension_ui_response`, `host_tool_*`, `host_uri_*`) overtake the serial queue. Turn/request correlation must key on `id`, never assume queue order for `bash`.
7. **Specify native-tool governance scope.** With `approvals.supported:false`, state that Pibo governs only Pibo-hosted tools (host_tool bridge) and OMP native tools (bash/edit/computer/claude, etc.) run without Pibo approval — or explicitly disable/steer OMP native tools if the product requires gating. Current text discloses the capability but not the operational consequence.
8. **Define OAuth/`extension_ui_request` bridging.** The headless `login` flow emits `open_url` as an `extension_ui_request`; surface it through Pibo auth or declare device-code/OAuth out of scope for v1. Otherwise the `auth.methods` entry is aspirational.

## Not blocking
- `nativeToolInspection:"degraded"` could be raised to nearer-native via `get_state.dumpTools`; safe as-is.
- Bun presence/native-build prerequisite is a documented config/diagnostics concern, not a design defect.
- The `pi` adapter ([`/codex`/`pi`] precedent) confirms `approvals.supported:false` is acceptable to the product.

---

*Evidence anchors: `modes/rpc/rpc-mode.ts` (`case "prompt"` dispatch, `negotiate_protocol`), `slash-commands/acp-builtins.ts` (reserved names/handle gate), `utils/src/dirs.ts` (`getAgentDir`, `PI_CODING_AGENT_DIR`, `Bun.hash`, `engines.bun`), `config/model-registry.ts:251` (`models.yml` at `getAgentDir()`), `session/session-tools.ts:1011` (skills discovery at `getCwd()`), `session/bash-runner.ts:77` (cwd-rooted bash), `rpc-frame.ts:5-11` (frame/chunk limits), `src/agent-runtime/capabilities.ts`, `src/agent-runtimes/{pi,codex-native}/adapter.ts` (capability matrices), `src/plugins/codex-native.ts` (plugin pattern), `src/agent-runtime/testing/contract.ts` (shared contract suite).*
