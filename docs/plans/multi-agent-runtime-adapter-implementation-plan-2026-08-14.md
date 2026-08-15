# Multi-Agent Runtime Adapter Implementation Plan

**Status:** Active
**Date:** 2026-08-14
**Change spec:** `docs/specs/changes/multi-agent-runtime-adapters/`
**Source investigation:** `docs/reports/multi-agent-runtime-adapter-architecture-investigation-2026-08-14.md`

## Objective

Deliver a real Pibo-owned runtime adapter architecture, prove complete Pi parity through it, migrate session persistence to opaque runtime bindings, deliver portable Pibo capabilities, and then ship a native Codex App Server adapter with exact Pibo2 evidence.

## Branch and PR sequence

The sequence is intentionally compatibility-first. Later branches may stack while earlier PRs are under review, but their dependency must be explicit.

| Order | Branch topic | Reviewable outcome | Gate before next phase |
|---|---|---|---|
| 1 | `feature/agent-runtime-foundation` | SPI, configured-instance registry, fake adapter, Pi facade, router resolution seam | Full local build/test and contract basics |
| 2 | Pi extraction | Generic routed queue; all Pi-native behavior behind Pi adapter | Full suite plus authenticated Pibo2 Pi parity |
| 3 | Runtime bindings | Additive table, backfill, dual read/write, unbound/missing/CAS | Existing-data migration proof |
| 4 | Runtime profiles/Designer | Frozen runtime selection, options, diagnostics, disabled states | Existing custom-agent compatibility and UI tests |
| 5 | Portable tools/MCP | Pibo tool IR, Pi compiler, scoped MCP bridge | Security/isolation tests and Pi/MCP parity |
| 6 | Skills/context/MCP materialization | Isolated selected resources and delivery reports | No leakage/global mutation; connection proof |
| 7 | History/debug | Runtime-neutral normal trace path; adapter history providers | New-turn no-native-read and old Pi compatibility |
| 8 | Adapter-authoring skill | Built-in skill plus full/partial adapter evals | Registration and eval pass |
| 9 | Native Codex | Official app-server adapter and `codex-native` profile | Local fixtures/contracts/full suite |
| 10 | Pibo2 integration/docs | Exact candidate validation and final audit | Every completion requirement proven |

## Working rules

- Source every topic from current `upstream/dev` or the required reviewed/stacked predecessor.
- Never edit or commit from `/root/code/pibo`; it contains unrelated changes.
- Commit only validated milestones.
- Do not merge, publish, release, or deploy production as part of this goal.
- Install candidates only on disposable Pibo2 for integrated validation.
- Preserve compatibility facades until their replacement paths and consumers are proven.
- Do not start native Codex implementation while a known Pi parity regression remains.

## Milestone 1: Foundation

### Build

1. Add runtime-neutral descriptor, capability, diagnostic, semantic-event, adapter, session, and registry types.
2. Add deterministic fake adapter and reusable contract harness.
3. Add runtime selection to profiles with default `pi`.
4. Register the configured Pi instance through the core plugin.
5. Make `PiboSessionRouter` resolve/open through the runtime registry.
6. Preserve `createPiboRuntime()` and direct Pi callers.

### Verify

- Registry duplicate/config/capability tests.
- Fake adapter lifecycle/queue/correlation/disposal tests.
- Pi facade opens the same in-memory runtime and exposes compatibility handle.
- Existing profile/capability catalog snapshots are additive only.
- `npm run typecheck`.
- `npm test`.

### Exit evidence

- Clean diff.
- Baseline and post-change test summaries.
- Commit SHA and PR URL.

## Milestone 2: Pi extraction and parity

### Build

1. Move event normalization and all Pi-specific turn/recovery behavior into Pi session code.
2. Move fast mode, model/thinking, context usage, compaction, native session operations, and provider usage into capability controls.
3. Keep generic queueing, correlation, lifecycle, product actions, and distribution in `RoutedSession`.
4. Add forbidden-import checks.
5. Move Pi history parsing behind Pi adapter where it blocks generic boundaries, retaining compatibility.

### Verify

- Focused recovery/compaction/steering/actions/session-tree/transcript tests after each move.
- Full test/build/typecheck.
- Old transcript fixture reopens with byte-identical header/id/path.
- Authenticated Pibo2: fresh/resumed session, tool calls, subagents, run reminders, Loop, TUI, Chat Web streaming/trace, restart, debug, telemetry.
- Compare startup, first delta, terminal completion, trace load, and browser rendering with baseline.

### Exit rule

No native Codex code starts until all known Pi regressions are resolved and evidence is recorded.

## Milestone 3: Persistence

### Build

1. Add runtime binding schema/store/API.
2. Backfill Pi rows and dual-write compatibility fields.
3. Support unbound, bound, missing, and error states with CAS.
4. Make session creation freeze configured runtime instance.
5. Update debug/read models/Chat metadata.

### Verify

- Fresh and old database fixtures.
- Duplicate native id per instance rejected; same native id across different instances allowed.
- Concurrent bind race produces one winner and disposes loser resources.
- Missing native session does not auto-create.
- Pibo2 existing-data migration count/id/path comparison.

## Milestone 4: Portable control plane

### Build

1. Add Designer runtime selection and adapter options.
2. Add Pibo tool IR and direct Pi compiler.
3. Add scoped MCP credential registry and bridge.
4. Add isolated skills/context/external-MCP materializers and delivery reports.
5. Add model/auth/reasoning catalog aggregation.
6. Add cross-runtime subagent selection and validation.

### Verify

- Invalid saves fail clearly.
- Disabled states explain genuine limitations.
- Cross-session tool access is denied.
- Selected skill/context/MCP is visible; unselected content is absent.
- Pi direct and MCP fixture produce equivalent Pibo tool results.
- No user-global harness config changes.

## Milestone 7: Runtime-neutral history/debug

### Build

1. Persist and fully hydrate terminal semantic history for every new routed turn.
2. Build generic normalized history/inspection/page contracts and trace projection.
3. Keep Pi JSONL discovery, parsing, and pagination only in the Pi adapter provider.
4. Mark pre-schema-v5 sessions for compatibility fallback without changing ids, transcript paths, or binding revisions.
5. Bind opaque runtime-history cursors to the Pibo Session and frozen runtime binding.
6. Add binding identity, product-history counts, payload hydration, explicit native-history drill-down, and redaction to debug surfaces.

### Verify

- New Pi and fake-runtime turns render with native history inspection/read functions disabled in the normal summary/timeline/compatibility paths.
- Old Pi sessions and paginated native history still render through the adapter.
- Missing native history keeps product history and the Pibo Session visible.
- Large externalized user, assistant, reasoning, and tool payloads reconstruct at full fidelity.
- Cross-session/runtime history cursors are rejected.
- Debug output includes adapter/instance/binding state without locator, config, metadata values, or credentials.

Pibo2 validation: `docs/reports/runtime-neutral-history-trace-debug-validation-2026-08-15.md`.

## Milestone 8: Adapter-authoring skill

### Build

Create and register `pibo-agent-runtime-adapter` with progressive references and checklist.

### Verify

- Full harness eval yields descriptor, capabilities, lifecycle, delivery, tests, and Pibo2 plan.
- Partial harness eval declares unsupported features and Designer behavior instead of inventing support.
- Package contents include the skill.

## Milestone 9: Native Codex

### Protocol preparation

1. Read exact Pibo2 `codex --version` and availability.
2. Run `codex app-server generate-ts` and `generate-json-schema` from that binary.
3. Store fixtures and compatibility metadata.
4. Classify stable versus experimental methods and unsupported Designer capabilities.

### Build

1. Typed stdio JSON-RPC lifecycle and initialize handshake.
2. Thread start/resume/read/list/fork where supported.
3. Turn start/steer/interrupt and event normalization.
4. Approvals and structured user input.
5. Model/reasoning/options/usage.
6. Scoped Pibo MCP bridge plus selected external MCP.
7. Isolated selected skills and context.
8. Pibo subagents and product jobs/loops/workflows.
9. `codex-native` profile; compatibility alias guard.

### Verify locally

- Deterministic protocol fixtures.
- Shared contract suite.
- Process cleanup/start failure/crash/malformed/overload/missing-thread tests.
- Approval/user input/abort/history/model/reasoning/tool events.
- Full build/typecheck/test.

## Milestone 10: Exact Pibo2 integrated validation

Follow the `pibo-v2-server-development` skill and record:

- installed candidate and commit;
- Pibo home, ports, process/binary versions;
- migration before/after counts and sampled ids/locators;
- fresh/resumed Pi and Codex scenarios;
- service restart continuity;
- native plus Pibo MCP tools;
- selected skills/context/external MCP;
- Pibo and cross-runtime subagents;
- Loop/Cron/workflow compatibility;
- approval/user input, abort, process failure, missing binding;
- Designer diagnostics and disabled states;
- Chat Web screenshots/traces/network/console;
- startup/first-delta/completion/trace timings and resource state;
- remaining uncertainty and issue links for unrelated defects.

## Durable progress ledger

Update this table after each meaningful milestone so continuations do not need to re-derive state.

| Date | Milestone | Branch / commit / PR | Verification | Remaining dependency |
|---|---|---|---|---|
| 2026-08-14 | Discovery/spec complete | `feature/agent-runtime-foundation` based on `54176105` | Required project/T3/Codex references inspected; clean-base suite 1,598/1,598 passing | Foundation verification and PR |
| 2026-08-14 | Runtime foundation PR opened | `feature/agent-runtime-foundation`, implementation `a69a0a27`, PR #476 | Full workspace typecheck passed; focused routed Pi 73/73; full suite 1,605/1,605 | Stacked Pi extraction and authenticated Pibo2 parity |
| 2026-08-14 | Pi extraction locally validated | `feature/agent-runtime-pi-parity` at `af90539e` | Generic fake routing and boundaries pass; focused parity 99/99; full suite 1,609/1,609 | Exact candidate install and authenticated Pibo2 Pi parity |
| 2026-08-15 | Runtime bindings validated and PR opened | `feature/agent-runtime-bindings` at `2318a725`, PR #478 | Full suite 1,622/1,622; existing-data migration, restart, stale CAS, debug, signals, UI badge, and rollback validated on Pibo2 | Runtime-aware profiles and Agent Designer |
| 2026-08-15 | Runtime-aware profiles and Designer validated | `feature/agent-runtime-designer` at `5f6277f1`, PR #479 | Typecheck and full suite 1,632/1,632; exact-candidate Pibo2 persistence, API rejection, frozen binding, Context Build, and browser checks passed | Portable capability delivery |
| 2026-08-15 | Portable Pibo tools and MCP bridge validated | `feature/agent-runtime-portable-tools` at `20c3d82d`, PR #483 | Final typecheck and full suite 1,639/1,639; exact-candidate Pibo2 scoped MCP, hijack denial, cancellation, progress, payload, revocation, catalog, Context Build, and browser checks passed | Skills/context/external-MCP materialization |
| 2026-08-15 | Runtime resources materialized and validated | `feature/agent-runtime-materialization`, implementation `25347408`, PR #486 | Final typecheck and full suite 1,645/1,645; exact-candidate selected skill/context/MCP isolation, secret rebinding, protocol inventory, Pi-scoped CLI, restart/resume, Context Build, browser, and awaited deletion cleanup passed on Pibo2 | Runtime-neutral history, trace, and debug |
| 2026-08-15 | Runtime-neutral history, trace, and debug validated | `feature/agent-runtime-history` at `4e50718a`, runtime fix `9a8e6510`, PR #487 | Typecheck/build and full suite 1,656/1,656; schema-v5 migration, product payload fidelity without native JSONL, missing fallback, 21 MB legacy history, cursor isolation, runtime-aware debug/telemetry, restart, browser, and cleanup passed on Pibo2 | Built-in adapter-authoring skill |
| 2026-08-15 | Built-in adapter-authoring skill validated | `feature/agent-runtime-authoring-skill`, implementation `c76d92bd`, PR #488 | Skill validation and package contents passed; focused 25/25 and full suite 1,660/1,660; full/partial GPT-5.6 Sol eval 20/20 with skill versus 9/20 baseline; exact-candidate Pibo2 catalog, Designer, Context Build, restart, browser, and cleanup passed | Restore real-model Pi provider authentication, complete Pi parity, then implement `codex-native` |
| 2026-08-15 | Codex App Server protocol checkpoint 9.1 complete | `feature/agent-runtime-codex-native` at `60dbdee8`, PR #489 | Official Pibo2 Codex 0.147.0 pinned; exact stable TypeScript/JSON Schema generated; full/v2 schema hashes and binary evidence stored; diagnostic credential route fully cleaned and excluded | Pi parity 2.11 remains blocked until approved Pibo2-managed OpenAI authentication is provisioned; do not start 9.2 |

## Completion audit

Before marking the goal complete, produce `docs/reports/multi-agent-runtime-adapter-final-audit-<date>.md` with one row per spec requirement and these columns:

- requirement;
- implemented code paths;
- focused tests;
- full-suite/build evidence;
- migration evidence;
- Pibo2/API/browser evidence;
- PR(s);
- known limitations/uncertainty;
- pass/fail.

Any missing, stale, indirect, or unverified evidence is a failed row, not an assumption of completion.
