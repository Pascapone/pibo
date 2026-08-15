# Pi Runtime Adapter Parity Validation

**Status:** Local parity passed; authenticated Pibo2 validation pending
**Date:** 2026-08-14
**Branch:** `feature/agent-runtime-pi-parity`
**Validated implementation commit:** `af90539e`
**Dependency:** PR #476 (`feature/agent-runtime-foundation`)

## Implemented boundary

- `PiboSessionRouter` now owns product session lookup, queue lifecycle, correlation, signals, telemetry hooks, subagent hierarchy, run control, and output distribution through `RuntimeRoutedSession`.
- `RuntimeRoutedSession` consumes only `AgentRuntimeSession` and capability-gated controls. It has no direct Pi/Codex package or adapter import.
- Pi runtime assembly and routed Pi behavior now live under `src/agent-runtimes/pi/`.
- The Pi adapter owns event normalization, prompt settlement, skill expansion, run-reminder tool scope, context-guard continuation, durable provider recovery, transcript-integrity continuation, fast-mode patches, compaction, status, models, thinking, provider/context usage, and native session controls.
- `src/core/runtime.ts` and `src/core/routed-session.ts` are explicit deprecated compatibility facades only.
- Existing direct JavaScript compatibility tests can still inspect the Pi runtime handle through the generic routed-session compatibility property.
- Deprecated `pi_event` output remains opt-in through adapter-declared compatibility metadata rather than an adapter-id branch in generic orchestration.

## Deterministic non-Pi proof

A registered fake adapter now routes through the production `PiboSessionRouter` without a Pi compatibility handle. Tests prove:

- queued prompts remain ordered;
- assistant events correlate to the active Pibo message id;
- status comes from the generic runtime session;
- unadvertised native clone control fails with `AgentRuntimeCapabilityUnavailableError`;
- generic runtime/router source files do not import Pi, Codex, or adapter implementations.

## Local verification

| Check | Result | Evidence |
|---|---|---|
| Root/workspace typecheck | Pass | `npm run typecheck` |
| Build | Pass | `npm run build` through `npm test` |
| Focused extraction/parity tests | Pass: 99/99 | Registry/fake, generic routing, Pi steering/actions/recovery/compaction/quiescence/subagents/transcript/fast mode |
| Full suite | Pass: 1,609/1,609 | 12 suites, 0 failures, 322.1s |
| Import boundaries | Pass: 2/2 | `test/agent-runtime-boundaries.test.mjs` |
| Generic fake routing | Pass: 2/2 | `test/runtime-routed-session.test.mjs` |
| Existing Pi reopen fixture | Pass | Same requested Pi id and transcript file reused by `createPiboRuntime` compatibility facade |

## Remaining parity gate

Before native Codex implementation begins, the exact candidate must pass authenticated Pibo2 scenarios for:

- existing and fresh Pi sessions;
- real streamed turns and tool calls;
- selected skills/user skills, context files, MCP, subagents, and run reminders;
- Loop/runtime restart continuity;
- session status, thinking, fast mode, compact, fork/clone/tree/switch where safe;
- Chat Web trace/rendering, debug/session inspection, telemetry, and signals;
- startup, first-delta, completion, and trace-load timing compared with the currently installed baseline.

No native Codex adapter work is claimed or started by this milestone.
