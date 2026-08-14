# Agent Runtime Foundation Validation

**Status:** Passed
**Date:** 2026-08-14
**Branch:** `feature/agent-runtime-foundation`
**Base:** `upstream/dev` at `54176105c2f0c752a3d6de017fbebb40e301e565`

## Scope

This report covers the first compatibility milestone only:

- Pibo-owned runtime descriptor, capability, semantic-event, lifecycle, and error contracts;
- configured runtime instance registry separated from live sessions;
- default profile runtime selection;
- plugin registration and capability-catalog inspection;
- deterministic fake adapter and reusable contract exerciser;
- Pi adapter facade over the existing Pi runtime;
- routed Pi runtime creation resolved through the configured runtime registry;
- unchanged public `createPiboRuntime`, profile inspection, and direct-TUI paths.

It does **not** claim completion of Pi extraction, runtime-binding persistence, portable capability delivery, native Codex, or Pibo2 parity.

## Compatibility checks

- The default configured runtime instance is `pi`.
- The existing `codex` alias still resolves to `codex-compat-openai-web`, whose runtime instance remains `pi`.
- The Pi adapter opens the requested existing Pi session id without rewriting it.
- Custom plugin registries that historically supplied only profiles/actions retain the implicit built-in runtime fallback during the migration.
- Generic runtime registration validates ids, config, descriptor capabilities, and advertised live-session controls.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Clean base full suite | Pass: 1,598/1,598 | `npm test` in detached clean worktree at `54176105`; 12 suites, 0 failures, 391.6s |
| Full workspace typecheck | Pass | `npm run typecheck` (workflows, root TypeScript, Chat UI, Context Files UI, and VS Code) |
| Foundation build | Pass | `npm run build` as the first stage of `npm test` |
| Focused adapter tests | Pass: 7/7 | `node --test test/agent-runtime-registry.test.mjs` |
| Focused routed Pi tests | Pass: 73/73 | Adapter, router, steering, actions, quiescence, recovery, and subagent tests |
| Post-change full suite | Pass: 1,605/1,605 | `npm test`; 12 suites, 0 failures, 329.3s |

## Known transitional boundary

`PiboSessionRouter` now resolves and opens the configured runtime through the registry, but the current `RoutedSession` still consumes the Pi compatibility handle. The next Pi-extraction milestone moves Pi event normalization, recovery, fast mode, native session controls, and transcript behavior into the Pi adapter and leaves generic queueing/correlation in the router.
