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
| 2026-08-15 | Codex App Server protocol checkpoint 9.1 complete | `feature/agent-runtime-codex-native` at `60dbdee8`, PR #489 | Official Pibo2 Codex 0.147.0 pinned; exact stable TypeScript/JSON Schema generated; full/v2 schema hashes and binary evidence stored; diagnostic credential route fully cleaned and excluded | Pi parity 2.11 remained blocked pending approved target-managed authentication |
| 2026-08-15 | Pi parity gate 2.11 closed | `feature/agent-runtime-codex-native` exact candidate `c764dc0d`, PR #489 | Pibo2-managed OAuth; real baseline/candidate text and Bash parity; public-Web SSE/tool turn; unchanged Pi binding across restart; prior-tool-history recovery; model/thinking/usage/Fast controls; trace check and sanitized screenshot pass | Implement native Codex task 9.2 through the official App Server |
| 2026-08-15 | Codex App Server stdio client 9.2 validated | `feature/agent-runtime-codex-client` implementation `30509335`, PR #490 stacked on PR #489 | Typed stable JSONL handshake/correlation/server requests/notifications; bounded backpressure, retries, messages, pending work, stderr, timeouts, crashes, and shutdown; focused 15/15; full 1,675/1,675; exact Pibo2 `0.147.0` initialize + `model/list` pass with isolated cleanup | Process/version diagnostics and private runtime homes in task 9.3 |
| 2026-08-15 | Codex process and isolation foundation 9.3 validated | `feature/agent-runtime-codex-process` implementation `9a58ded0`, PR #491 stacked on PR #490 | Config/version diagnostics, private configured-instance Codex homes, isolated session-generation process homes/env, protected overrides, exact-home verification, bounded cleanup; focused 23/23; full 1,683/1,683; exact Pibo2 `0.147.0` two-instance process/model-list/cleanup pass | Thread lifecycle, bindings, and native history controls in task 9.4 |
| 2026-08-15 | Codex thread lifecycle and native history 9.4 validated | `feature/agent-runtime-codex-thread` implementation `1155529a`, PR #492 stacked on PR #491 | Stable start/bind/resume/read/list/fork/clone, CAS and missing state, scoped redacted native history, exact empty-thread boundary; focused 31/31; full 1,691/1,691; exact Pibo2 `0.147.0` durable resume/history/fork/clone/process-restart/missing cleanup pass | Turn start, event normalization, failure, steering, and interrupt in task 9.5 |
| 2026-08-15 | Codex native turn lifecycle 9.5 validated | `feature/agent-runtime-codex-turn` implementation `714ece6a`, PR #493 stacked on PR #492 | Stable `turn/start`, `turn/steer`, `turn/interrupt`; assistant/reasoning/native-item/tool/usage/compaction/warning/completion/interruption/failure normalization; durable turn reconciliation; focused 38/38; full 1,698/1,698; exact packaged Pibo2 `0.147.0` streamed turn/native command/steer/interrupt/failure/child-process restart-resume pass | Approvals and structured user input in task 9.6 |
| 2026-08-15 | Codex approvals and structured input 9.6 validated | `feature/agent-runtime-codex-requests` implementation `b2f90d14`, PR #494 stacked on PR #493 | Stable command/file approval requests; explicit experimental structured-input opt-in; opaque scoped ids, bounded redaction, generic status/events/actions/SSE/UI, interruption/crash cleanup; focused 36/36; full 1,710/1,710; exact packaged Pibo2 `0.147.0` command/file/input/interrupt/restart/isolation/cleanup pass; authenticated candidate browser shell loaded without console errors | Native model/reasoning/options/context usage in task 9.7; public live-request UI flow after profile integration |
| 2026-08-15 | Codex model, reasoning, options, and context usage 9.7 validated | `feature/agent-runtime-codex-options` implementation `2d8417c3`, PR #495 stacked on PR #494 | Bounded stable `model/list`; runtime-aware `/model` and Designer reasoning intersections; idle model/reasoning/Fast controls through stable turn fields; safe binding metadata continuity; cumulative context usage and resume replay; full 1,717/1,717; exact packaged Pibo2 `0.147.0` five-model/priority/normal/switch/restart/isolation/cleanup pass; authenticated headful model card rendered without console warnings/errors | Pibo MCP tools, external MCP, skills, and context delivery in task 9.8 |
| 2026-08-16 | Codex portable resources 9.8 validated | `feature/agent-runtime-codex-resources` implementation `7b2aba90`, PR #497 stacked on PR #495 | Pibo MCP bridge, selected external HTTP/stdio MCP, selected skills, explicit developer context, native `AGENTS.md`, connected inventory, active lease renewal, idle App Server credential handoff, fork/restart continuity, secret-safe stdio launcher; focused 65/65; full 1,722/1,722; exact packaged Pibo2 `0.147.0` three-server/four-call/three-turn/isolation/cleanup pass | Native Codex standard-tool inventory and regression proof in task 9.9 |
| 2026-08-16 | Codex native-tool preservation and inspection 9.9 validated | `feature/agent-runtime-codex-native-tools` implementation `4a53c6b0`, PR #498 stacked on PR #497 | Separate native inspection/yielding capabilities; immediate selected-MCP plus bounded observed-native status inventory; explicit stable-protocol limitation in Designer/Context Build; focused 133/133; full 1,723/1,723; exact packaged Pibo2 `0.147.0` baseline/resource provider comparison, native command observation, additive MCP model inventory, browser, isolation, and cleanup pass | Pibo-managed subagents and cross-runtime child sessions in task 9.10 |
| 2026-08-16 | Codex Pibo-managed and cross-runtime subagents 9.10 validated | `feature/agent-runtime-codex-subagents` implementation `54d01928`, PR #499 stacked on PR #498 | Selected Pibo subagents through native Codex MCP/code mode, scoped Pibo-server approval, yielded subagent runs, independent target-profile bindings, Pi-to-Codex children, restart/reuse, bounded thread keys, parent-abort propagation, Designer/Context Build evidence; focused 73/73; full 1,731/1,731; exact packaged Pibo2 `0.147.0` pass | Distinct `codex-native` profile and compatibility-alias assertions in task 9.11 |
| 2026-08-16 | Native Codex profile and compatibility boundary 9.11 validated | `feature/agent-runtime-codex-profile` profile implementation `6c969f68`, final isolation fix `3a52d1ac`, stacked on PR #499 | Dedicated native plugin, configured `codex-native` instance/read-only profile, absent implicit `codex`, explicit/persisted Pi compatibility, private diagnostic version probe, CLI/API/session/Context Build/debug/Designer visibility; focused 51/51; full 1,733/1,733; exact packaged Pibo2 `0.147.0` pass with unchanged global Codex state | Consolidated deterministic fixtures/contracts in task 9.12 |

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
