# Agent Runtime Adapter Authoring Skill Validation — 2026-08-15

**Status:** Pass

**Branch:** `feature/agent-runtime-authoring-skill`

**Stacked on:** runtime-neutral history/debug PR #487

**Pull request:** Pending

**Implementation commit validated on Pibo2:** `c76d92bd1077d2defd0fa586bd907594d37c050e`

## Outcome

Pibo now ships a built-in `pibo-agent-runtime-adapter` authoring skill for designing, implementing, reviewing, and debugging runtime adapters without inventing unsupported capabilities or leaking harness-specific behavior into generic orchestration. The skill uses a compact entry point and six progressive references covering registration, capabilities and Agent Designer, lifecycle and frozen bindings, portable delivery and native behavior, history/debug/security, and testing/migration/Pibo2 evidence.

The exact packaged candidate passed local structural validation, deterministic anti-invention tests, full and explicitly partial harness model evals, package-content checks, authenticated Pibo2 catalog and Agent Designer checks, Context Build delivery, gateway restart persistence, browser rendering, and validation-fixture cleanup.

## Candidate

| Item | Value |
|---|---|
| Package | `@pasko70/pibo@1.7.2` |
| Commit | `c76d92bd1077d2defd0fa586bd907594d37c050e` |
| Artifact | `/tmp/pibo-authoring-skill-pack-c76d92bd/pasko70-pibo-1.7.2.tgz` |
| Artifact SHA-256 | `96fa503c1e62ab7900744b01e3d0719075f233e08c31ba4ccac45abd0f9cc948` |
| Installed path | `/opt/pibo-candidates/agent-runtime-authoring-skill/c76d92bd1077d2defd0fa586bd907594d37c050e` |
| Initial active PID | `404910` |
| Final active PID after explicit restart | `405358` |

The active process environment was checked around authenticated catalog, Context Build, browser, restart, and cleanup requests. It continued to report candidate `agent-runtime-authoring-skill` and the exact commit above.

## Skill structure and package contents

The built-in registration resolves from the installed package rather than from repository-only files. `pibo skills catalog --json` reported exactly one built-in entry named `pibo-agent-runtime-adapter` owned by `pibo.core`.

The packed skill contains 11 files:

- `SKILL.md`;
- six progressive reference documents;
- `evals/evals.json` and `evals/README.md`;
- full Orion and partial Relay harness fixtures.

`npm pack --dry-run --json` confirmed that all 11 files are included in the npm package. The Skill Creator `quick_validate.py` structural validator passed.

## Local verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused skill, plugin registry, and skills CLI suite through the isolated test runner: **25/25 passed**.
- Final full suite: **1,660/1,660 passed across 12 suites**.
- `git diff --check`: passed before both implementation and validation commits.

Deterministic tests verify that the skill:

- is registered exactly once as a built-in `pibo.core` contribution;
- is discoverable through the packaged skills catalog;
- points progressively to all six references;
- distinguishes adapter descriptors, configured runtime instances, and live sessions;
- requires frozen binding and CAS handling rather than mutable profile lookup;
- requires capability evidence and explicit unsupported behavior;
- preserves Pibo-owned product history and portable tool/resource services;
- forbids global harness configuration mutation and secret persistence;
- reserves `codex-native` for the official native Codex adapter while preserving Pi-backed `codex` compatibility;
- gives the partial Relay fixture an explicit capability matrix and degradation behavior rather than claiming full support.

## Real-model anti-invention eval

The eval used `openai-codex/gpt-5.6-sol` at low reasoning with one run per eval/configuration. Token counts were unavailable from the direct runtime evaluator, so the committed benchmark records them as unavailable rather than treating zero as measured usage.

| Harness task | With skill | Without skill | Delta |
|---|---:|---:|---:|
| Orion full adapter | 10/10 | 3/10 | +7 |
| Relay partial adapter | 10/10 | 6/10 | +4 |
| Aggregate | **20/20 (100%)** | **9/20 (45%)** | **+55 points** |

With the skill, both outputs used the current Pibo interfaces and named the exact evidence needed before claiming support. They covered configured-instance registration, Designer capability gating, binding CAS and `missing` state, semantic events, shared tool/resource services, Pibo-owned product history, adapter-owned compatibility history, Pibo2 exact-candidate validation, and explicit partial-adapter limitations.

The baselines generally rejected the most obvious unsafe product pressure, but omitted or misstated multiple Pibo-specific seams. This makes the capability, lifecycle, service-reuse, history-ownership, and exact-evidence assertions more discriminating than generic safety language alone.

Progressive reference reads added about 12.4 seconds on average and materially improved correctness. The fixture instructions therefore explicitly require using the read tool for the relevant references. The benchmark is committed at `docs/reports/runtime-adapter-authoring-skill-eval-2026-08-15.json`; it is coverage evidence from one run per configuration, not a variance estimate.

## Exact-candidate Pibo2 validation

The installed package exposed 25 skills through the authenticated Agent Designer catalog, with exactly one `pibo-agent-runtime-adapter` entry. The entry resolved to the exact candidate package and retained `kind: builtin`, `pluginId: pibo.core`, and `pluginName: Pibo Core`.

A temporary custom agent selected only the new skill and used runtime instance `pi`. Creating a session froze a `pi`/`pi` runtime binding at revision 1. Authenticated Context Build returned HTTP 200 with:

- 17 total nodes and approximately 1,838 estimated tokens;
- zero warnings and zero errors;
- runtime instance `pi`, adapter `pi`, and runtime available;
- skill contribution id `skills/pibo-agent-runtime-adapter`;
- `deliveryStatus: delivered`;
- `deliveryMode: native`;
- `fidelity: exact`;
- 10,253 full-file bytes loadable through the read tool or normal skill invocation.

Context Build exposed skill metadata and delivery evidence without eagerly injecting the full skill body. The anti-invention sentence used as a body marker was absent from the snapshot, confirming progressive loading rather than hidden prompt inflation.

An explicit production-gateway restart completed while the gateway reported zero active runtime sessions and zero active yielded runs. PID `404910` changed to `405358`; the deployed candidate and commit did not change. After restart, the custom agent retained its selected skill, Context Build retained exact native delivery and the same byte count, and the catalog still contained exactly one built-in skill entry.

## Browser evidence

The authenticated Agent Designer rendered the packaged built-in skill in its `Built-in Skills` group, reported `1/11` selected, and visibly selected `pibo-agent-runtime-adapter` for the temporary custom agent.

Evidence: `docs/reports/screenshots/runtime-adapter-authoring-skill-pibo2-2026-08-15.png`

Screenshot SHA-256: `26c963c6197e5b73e80b77a9a78bb348cf265f26bd8ff235ac8cdf4a7e9e10c5`.

The screenshot is cropped below the account header and contains no authentication material.

## Cleanup

The temporary custom agent was archived and permanently deleted through the authenticated API. The delete response named both the agent and its temporary session. Afterwards:

- the agent was absent even when archived entries were requested;
- Context Build for the deleted session returned HTTP 404 `Session not found`;
- no session-specific filesystem path remained under `PIBO_HOME`;
- the exact candidate remained active at PID `405358`.

## Remaining scope

- The authoring skill describes and evaluates adapter work; it does not itself add a second production adapter.
- Real-model Pi parity remains separately blocked on Pibo2 by the pre-existing `No API key for provider: openai-codex` failure reproduced on the pre-adapter baseline.
- Native Codex remains gated on that parity proof and must use the official Codex App Server under runtime id `codex-native` without changing the existing Pi-backed `codex` compatibility profile.
