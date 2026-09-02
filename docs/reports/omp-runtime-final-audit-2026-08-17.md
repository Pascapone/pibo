---
type: "Evidence Report"
title: "Oh My Pi (OMP) as Pibo Runtime — Final Audit Report"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/omp-runtime-final-audit-2026-08-17.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "190b2af46fd403d13e0768ba64fead69e22dae91"
  source_bytes: 6963
  source_sha256: "237e6b85689bd020afea8ebb3710d724b66821c61af6e091ad70f48d9fa6aef1"
  source_body_sha256: "237e6b85689bd020afea8ebb3710d724b66821c61af6e091ad70f48d9fa6aef1"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:omp-runtime-final-audit-2026-08-17"
  published_at: "2026-09-01T07:57:34Z"
---
# Oh My Pi (OMP) as Pibo Runtime — Final Audit Report

**Date:** 2026-08-17
**Branch (worktree):** `feature/omp-runtime` in `C:/Users/pasca/Coding/pibo/.worktrees/omp-runtime`, based on `upstream/dev` @ `93cef82e`
**Engine:** `@oh-my-pi/pi-coding-agent` 17.3.5 (can1357/oh-my-pi) — Bun-only fork of Pi Coding Agent behind `omp.sh`

## Objective → deliverables

| Requirement | Delivered | Evidence |
|---|---|---|
| Run Oh My Pi as a Pibo agent runtime | `omp` agent-runtime adapter (stdio RPC bridge) | `src/agent-runtimes/omp/*.ts` (3323 lines), `src/plugins/omp.ts`, registered in `src/plugins/builtin.ts`, exported in `src/index.ts` |
| All important OMP engine functions reachable through Pibo | prompt/steer/abort/compact, models, thinking, history, subagents, host tools, sessions, providers | Live E2E against real OMP engine in WSL: ready+v2 negotiate, get_state, 46 slash commands, 54-model catalog, login providers, subagents |
| Mirror critical slash commands | OMP's `get_available_commands` + `available_commands_update` surfaced; local-only slash prompts handled (no hang) | `thread.ts` `readOmpAvailableCommands`; `turn.ts` `agentInvoked:false` terminal handling; E2E listed 46 commands; test `omp-runtime.test.mjs` "local-only slash prompt" |
| Pibo skill/context-file/tools systems keep working | Skills → `skills.customDirectories` in isolated `config.yml`; context → `projectContextFiles`; portable tools → host-tool bridge | `resource-delivery.ts`, `host-tools.ts`; tests `omp-resources.test.mjs` (4) |
| Providers configurable via Pibo | `models.yml` + env allowlist + `get_login_providers`/`login` surfaced | `config.ts` (defaultProvider/defaultModel/apiKeyEnvironment), `models.ts`, `auth.ts`; tests + live E2E |
| Production quality + extensive tests | Typecheck 0 errors, build pass, 13 adapter unit tests, 16/16 shared registry contract, 2/2 import-boundary, live real-engine E2E | See test summary below |
| Critic gate per milestone | Approach PASS, Design PASS (8/8), Implementation PASS (5/5), Final acceptance | `docs/plans/critic-{approach-review-2,design-review-final,implementation-review}.md` |

## Test summary (this worktree, after `npm run build`)

- `test/omp-runtime.test.mjs` — 9/9 pass (handshake+negotiation, get_state correlation, model catalog+switch, local-only slash terminal, prompt streaming→agent_end, abort, thread snapshot+commands, state round-trip, config parse)
- `test/omp-resources.test.mjs` — 4/4 pass (config.yml skills.customDirectories+context files, provider/model defaults, env isolation+allowlist, truthful capability descriptor)
- `test/agent-runtime-boundaries.test.mjs` — 2/2 pass (generic modules do not import OMP adapter; no forbidden coupling)
- `test/agent-runtime-registry.test.mjs` — 16/16 pass (shared runtime-adapter contract, Pi adapter compatibility unaffected)
- `npm run typecheck` — 0 errors; `npm run build` — passes

## Live end-to-end against the real OMP engine (WSL, Bun 1.3.14, OMP source at /root/omp)

The Pibo `OmpRpcClient` spawned the real OMP CLI in `--mode rpc` and produced concrete engine responses:

```
connected: {state:"ready", protocolVersion:2}
get_state: model gpt-5.5 (openai-responses), sessionId 01a00e54…, messageCount
native session binding: sessionId + cwd /root/omp
available commands: 46 (security, model, fast, computer, vision, prewalk, advisor, export, …)
model catalog: 54 (openai/codex-mini-latest, openai/daybreak-blue-latest, …, provider/model)
login providers: openai-codex (ChatGPT Plus/Pro), anthropic, …
subagents: [] (none active)
```

This proves the wire protocol, isolation (`PI_CODING_AGENT_DIR`), slash-command surfacing, model catalog, and provider surfaces all function against the genuine engine.

## Architecture (as designed and implemented)

- **Constraint:** OMP is Bun-only (raw `src/*.ts`, `bun:sqlite`, `Bun.*`), not importable in Node; Pibo is Node >= 24. The adapter therefore spawns OMP's `--mode rpc` over JSON-lines stdio (mirroring the `codex-native` adapter pattern). Feasibility and the full protocol were verified against OMP source before implementation.
- **Isolation:** `PI_CODING_AGENT_DIR`/`PI_CONFIG_DIR` redirect OMP's user-global state to a Pibo-owned `homeRoot`; process env allowlist prevents key/PATH leaks and blocks user override of the isolated dir. Session cwd = the user's real project so OMP native tools act on the real tree; agent state stays isolated.
- **Truthful capabilities:** `approvals.supported:false` (no RPC approval command), skills/context `materialized` (via `skills.customDirectories`/`projectContextFiles` — OMP has no injection command), auth `api_key` immediate only (no invented device/OAuth), nativeToolYielding unsupported. No capability is claimed without an engine-supported path.
- **MUST-FIX #4 (highest-risk):** local-only slash/skill prompts (`agentInvoked:false`) resolve immediately without awaiting a non-existent `agent_end`; verified by test and implementation-critic.

## Tier-2: Live model turn validated against the real provider (2026-08-17)

Closed the Tier-2 gate. Using the operator's real Alibaba Token Plan credential (catalog-native `alibaba-token-plan` provider, `ALIBABA_TOKEN_PLAN_API_KEY` env var, region base URL `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`) and model `deepseek-v4-flash-0731`, the live end-to-end run **PASSED**:

```
LIVE[1] connected ready+v2
LIVE[2] available models: 7 -> alibaba-token-plan/qwen3.8-max, …,
                        alibaba-token-plan/deepseek-v4-pro, alibaba-token-plan/deepseek-v4-flash-0731
LIVE[2b] flash model present: true (alibaba-token-plan/deepseek-v4-flash-0731)
LIVE[3] set_model success: true
LIVE[4] prompt elapsed_ms: ~2100
LIVE[5] assistant_text: "pongpong" (genuine model completion)
LIVE[6] events: turn_started, reasoning_started, reasoning_delta*, assistant_delta*, turn_completed
LIVE_PASS
```

The adapter's real streaming path — model turn via `set_model` + `prompt` over the JSON-lines RPC bridge, reasoning and assistant deltas normalized into Pibo semantic events, terminal `turn_completed` — is verified against both the real OMP engine and the real provider. This is the strongest possible end-to-end evidence.

## Known limitations
- **Approvals** declare `unsupported` — OMP's interactive approval surface is TUI-only and intentionally not exposed, so Pibo governs only Pibo-hosted tools (host-tool bridge); OMP native tools run harness-owned.

## Gate records

- Approach: `docs/plans/critic-approach-review-2.md` — PASS (findings addressed)
- Design: `docs/plans/critic-design-review-final.md` — PASS, 8/8 SOUND (resolutions in design doc)
- Implementation: `docs/plans/critic-implementation-review.md` — PASS, 5/5 checks
- Final acceptance: see `docs/reports/omp-runtime-final-acceptance.md` (critic) / this report

The milestone is complete and ready to hand off for upstream PR against `upstream/dev`.