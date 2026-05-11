# Coverage Analysis: Performance Diagnostics Coverage 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Pibo Session Signals](../capabilities/pibo-session-signals.md), [Chat Web Virtualized Session Scrolling](../capabilities/chat-web-virtualized-session-scrolling.md), [Chat Web Trace Render Diagnostics](../capabilities/chat-web-trace-render-diagnostics.md), [Project Validation Harness](../capabilities/project-validation-harness.md)

## Why

The current source tree contains performance-oriented scripts and diagnostics, but not every diagnostic is a release gate or product capability. Creating another broad capability spec would duplicate existing signal, trace, and scrolling specs.

This analysis records which performance diagnostics are current contracts, which are manual investigation tools, and what future specs should add if any script becomes mandatory for release validation.

## Goal

Future Pibo specs SHALL distinguish required validation checks from diagnostic scripts so agents know when a script is a pass/fail contract and when it is only evidence for an investigation.

## Scope

### In Scope

- `scripts/bench-signal-registry.mjs`
- `scripts/chat-web-performance-check.mjs`
- Existing specs that already mention those scripts.
- Current source-level behavior observable from the scripts.

### Out of Scope

- Running browser, gateway, or Docker-based performance checks in this cron run.
- Defining new performance budgets for Chat Web or session signals.
- Changing source code, package scripts, or CI behavior.

## Current Coverage State

`bench-signal-registry.mjs` is already covered by the Pibo Session Signals spec as an operator-run benchmark. It runs against the compiled `dist/signals/registry.js`, creates a synthetic deep Pibo Session tree, starts one leaf tool, projects repeated identical queue updates, projects repeated tool metadata updates, and prints timing lines.

`chat-web-performance-check.mjs` is already covered by the Chat Web Virtualized Session Scrolling spec as an explicit developer action. It requires a target Chat Web URL and a CDP page endpoint, records browser long tasks while clicking heavy Chat Web actions, writes a JSON report under `docs/reports/` by default, and exits non-zero only when the observed maximum long task exceeds the supplied threshold.

Neither script is currently a general `npm test` or `npm run typecheck` gate. The Project Validation Harness spec covers the normal build/test/typecheck contract separately.

## Findings

### Finding: Signal benchmark has an output-shape contract but no pass/fail budget

The signal benchmark's current contract is diagnostic. It must run after a build and print timing for four phases, but it does not define acceptable millisecond thresholds.

#### Current contract

- Runs with Node against compiled `dist/` output.
- Uses `PIBO_SIGNAL_BENCH_DEPTH` to control synthetic tree depth.
- Uses `PIBO_SIGNAL_BENCH_TOOL_UPDATES` to control repeated queue and tool update counts.
- Prints timing lines for tree creation, leaf-tool propagation, identical queue updates, and tool metadata updates.

#### Future acceptance if promoted to release gate

- Define default depth and update counts for the release check.
- Define platform-aware or historical-baseline thresholds.
- Write results to `docs/reports/` or another durable report path.
- Add a package script or validation harness row that names the check explicitly.

### Finding: Chat Web performance check is threshold-capable but environment-dependent

The Chat Web performance script can fail when a long-task threshold is exceeded, but it depends on an already reachable Chat Web URL and an existing CDP page endpoint. It is not a standalone release check in the current workspace contract.

#### Current contract

- Fails fast with usage text when `--url` or `--cdp-url` is missing.
- Navigates the existing CDP page to the supplied Chat Web URL.
- Records browser long tasks and writes a JSON artifact.
- Uses `--max-long-task-ms`, defaulting to 500 ms, as the failure threshold.

#### Future acceptance if promoted to release gate

- Define how the authenticated browser and target Chat Web environment are acquired.
- Define fixture data or session size before the script runs.
- Define the report retention path and whether generated reports are committed.
- Decide whether the default 500 ms threshold is a product budget or only a local smoke threshold.

### Finding: Trace render diagnostics are correctness diagnostics, not performance budgets

The trace render diagnostics spec covers snapshot collection and replay comparison. It can find visible row mismatches, but it does not define frame-time, long-task, or memory budgets.

#### Future acceptance if performance scope expands

- Add separate requirements for timing or memory only if code captures those metrics.
- Keep row-correctness checks separate from performance checks so failures are actionable.

## Recommended Next Work

1. Keep `bench-signal-registry.mjs` as a diagnostic unless a future change adds thresholds or report output.
2. Keep `chat-web-performance-check.mjs` as a manual/browser validation script unless a future validation harness provisions an authenticated Chat Web page and fixture data.
3. If either script becomes required before merge or release, update the owning capability spec and Project Validation Harness spec in the same change.
4. Avoid adding a new performance capability spec until there is a product-level SLO or mandatory validation flow.

## Success Criteria

- [x] This analysis lives under `docs/specs/coverage/` because no new product capability is needed.
- [x] It inspects the current diagnostic scripts and existing specs before naming gaps.
- [x] It identifies which behaviors are current contracts and which would need future acceptance criteria.
- [x] It avoids duplicating signal, trace, scrolling, and validation-harness specs.

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/` inventory
- `scripts/bench-signal-registry.mjs`
- `scripts/chat-web-performance-check.mjs`
- `docs/specs/capabilities/pibo-session-signals.md`
- `docs/specs/capabilities/chat-web-virtualized-session-scrolling.md`
- `docs/specs/capabilities/chat-web-trace-render-diagnostics.md`
- `docs/specs/capabilities/project-validation-harness.md`
