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

## Known limitations (honest scope)

- **Live model turn (Tier-2)** needs an OMP-compatible provider credential (baseUrl + apiKey). None is present in this environment, so a real text-completion turn could not be exercised end-to-end; the wire, command surfaces, state, models, and providers were validated against the real engine (Tier-1) and full streaming against a frame-faithful fixture. Configure a provider via the `omp` runtime-instance config (`models.yml`/env) to enable live turns.
- **Approvals** declare `unsupported` — OMP's interactive approval surface is TUI-only and intentionally not exposed, so Pibo governs only Pibo-hosted tools (host-tool bridge); OMP native tools run harness-owned.

## Gate records

- Approach: `docs/plans/critic-approach-review-2.md` — PASS (findings addressed)
- Design: `docs/plans/critic-design-review-final.md` — PASS, 8/8 SOUND (resolutions in design doc)
- Implementation: `docs/plans/critic-implementation-review.md` — PASS, 5/5 checks
- Final acceptance: see `docs/reports/omp-runtime-final-acceptance.md` (critic) / this report

The milestone is complete and ready to hand off for upstream PR against `upstream/dev`.