---
type: "Evidence Report"
title: "Agent Runtime Foundation Validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/agent-runtime-foundation-validation-2026-08-14.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "478fa8bd5d41af95a264d71d20e2ec2b08264ebf"
  source_bytes: 2625
  source_sha256: "d36dbec4f0e24c4af929dd01d4c41098ca3fc73862a624676ac7358cd6a08c98"
  source_body_sha256: "d36dbec4f0e24c4af929dd01d4c41098ca3fc73862a624676ac7358cd6a08c98"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:agent-runtime-foundation-validation-2026-08-14"
  published_at: "2026-09-01T07:57:34Z"
---
# Agent Runtime Foundation Validation

**Status:** Passed
**Date:** 2026-08-14
**Branch:** `feature/agent-runtime-foundation`
**Validated implementation commit:** `a69a0a27`
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
