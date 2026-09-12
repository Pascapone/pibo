---
type: "Task Ledger"
title: "Unified plugin system implementation and acceptance"
description: "Tracks the preserved implementation checkpoint, remaining integration and acceptance for the complete plugin-system rebuild."
tags: ["plugins", "implementation", "migration", "acceptance"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-12T08:33:48Z"
sources:
  - id: "rebuild-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
    title: "Owner-approved implementation scope and A01–A37 acceptance matrix"
  - id: "current-owner-boundary"
    resource: "scope:owner instruction 2026-09-12 to preserve and audit the checkpoint; no new or resumed subagents, gateway restarts, deployments, PRs or releases"
    title: "Latest owner boundary supersedes earlier parallel-dispatch instructions"
---

# Goal and completion

Implement the [complete rebuild plan](/plans/unified-plugin-system-rebuild.md). All AP00–AP19 packages and A01–A37 scenarios remain subject to explicit evidence. Neither an implementation report nor passing unit tests alone closes the product-level acceptance gate.

The orchestrator owns integration, package order and final acceptance. The source baseline is `cac4dcd03945b9754db7be9ab2ab4324f10c335c`, equal to freshly fetched `upstream/dev` on 2026-09-12. The controller checkout has unrelated work and is not the implementation source.

# Execution boundary

The integrated topic branch is `plugin-system-rebuild`, worktree `/root/code/pibo/.worktrees/plugin-system-rebuild`, mounted as `/workspace` in Docker `pibo-dev-plugin-system-rebuild`. Only the orchestrator committed the combined worker changes. Builds and suites use `/tmp/plugin-system-validation.lock` in that worker. The [checkpoint](/reports/plugin-system-rebuild-checkpoint-2026-09-12.md#übergabe-und-gesicherter-arbeitsstand) records the exact source, environment, recovery bundle and validation commands.

**Current owner instruction: do not create or resume subagents.** All former child sessions are idle and their available results are preserved. Earlier parallel-dispatch limits and follow-up suggestions are historical, not standing authorization. A subsequent implementing agent owns the remaining integration itself unless the owner explicitly changes this restriction.

The limited implementation window ended with a tested checkpoint. The later handoff audit changes documentation and preservation only. No gateway restart, deployment, Pibo2 installation, PR or release is authorized by this checkpoint. Future acceptance steps below describe remaining requirements; they do not override that boundary.

# Historical ownership and current responsibility

The table identifies where the preserved reports came from. These workers are no longer active; there are no outstanding ownership locks or expected uncommitted deliveries. The continuing implementer owns every open package.

| Stream | Owner | Deliverable and boundary |
|---|---|---|
| Core | SDK/host worker | Manifest, contributions, ownership, deterministic lifecycle, services and shared selection resolver. |
| Management | Persistence/installation worker | Additive stores, revision checks, migration journal, installation, impact plans, retirement, recovery and operator CLI. |
| Runtime | Runtime/Build Context worker | Real profile/session integration, generation snapshots, portable delivery, controlled hooks and observed context provenance. |
| Browser | Desktop/browser worker | Browser host, session-owned tabsets, plugin settings, generic Build Context, terminal envelopes and composer hooks. |
| Designer | Designer/migration worker | Agent selection UI, autosave and API/store contract, independent resources and exact legacy selection migration. |
| Integration | Orchestrator | Bootstrap, dispatch, package contents, first feature walkthrough, later extraction, reviews, documentation and final evidence. |

Shared contracts have one writer. Dependent streams import those contracts rather than maintaining local equivalents. Browser types remain free of Node and harness dependencies. Features cannot introduce new fixed settings or context unions as an alternative registry.

# Work packages

Status values are `open`, `in progress`, `blocked` with a concrete cause, and `accepted` with evidence. Here `in progress` means preserved partial implementation, not an active agent. No package is accepted. Partial implementation does not relax the prerequisites in the owning plan.

| Package | Status | Owner | Acceptance evidence required |
|---|---|---|---|
| AP00 | in progress | Existing research; orchestrator | Complete ownership inventory, baseline fixtures, Context/Settings mapping and regression entrypoints. |
| AP01 | in progress | Core | Manifest validation without imports, versioned SDK and independent provider fixtures. |
| AP02 | in progress | Core | Dependency failures before effects, deterministic replacement and rollback/cleanup failure tests. |
| AP03 | in progress | Management | Store CAS, session-preserving persistence, immutable snapshots and interrupted multi-store migration. |
| AP04 | in progress | Core, runtime, designer | Same effective plan for preview/start, required/optional enforcement, no update expansion and resource conflicts. |
| AP05 | in progress | Management | Local/package install, digest/SDK rejection and progressive CLI. |
| AP06 | in progress | Runtime | Actual adapter delivery and observed context provenance; generation and credential isolation. |
| AP07 | in progress | Browser | Authenticated revisioned catalog and external prebuilt module through the ordinary loader. |
| AP08 | in progress | Browser, management | Session tabset CAS, scope-bound late saves, deep links, migration and headful evidence. |
| AP09 | in progress | Runtime, browser | Portable tool/input hooks, terminal replay/fallback, composer phases and headful regressions. |
| AP10 | in progress | Designer | Designer/API roundtrip, autosave, runtime switch and retained independent resources. |
| AP11 | open | Integration, runtime, browser | Installed Annotations feature including tools, API, tab, settings and Build Context; two-session walkthrough. |
| AP12 | open | Continuing implementer after AP11 | Every native tool family registered and delivered through its owner plugin. |
| AP13 | open | Continuing implementer after AP11 | Run/Goal/Subagent contributions preserve execution, persistence and independent child plans. |
| AP14 | open | Continuing implementer after AP11 | MCP CLI and second adapter use the same contract with explicit runtime limitations. |
| AP15 | in progress | Management, runtime, browser | A17–A21, immutable history, no implicit abort and retained tab/config/build data. |
| AP16 | in progress | Designer, management, integration | Exact selection migration and recovery; executable Pi-package/discovery paths removed after replacement. |
| AP17 | open | Browser, integration | Declarative standard and alternative shell/services; remove standalone TUI/VS Code product surfaces. |
| AP18 | open | Integration and independent review | No productive legacy activation/selection path or duplicate feature editor remains. |
| AP19 | open | Orchestrator and reviewers | Integrated build/suite/package, headful flows, exact Pibo2 artifact and real Pi/Codex/OMP execution. |

# Integration order

1. Reconcile AP00 against the implementation baseline and freeze the AP01 public contracts.
2. Integrate host, store, resolver, browser and designer along their declared dependencies. Run focused tests as each default path becomes available.
3. Complete AP11 with ordinary installed Web Annotations, its settings/context views and two independent session tabsets. Record this acceptance before broad extraction.
4. Implement AP12–AP14 after AP11 acceptance. Finish lifecycle impacts and migration before deleting legacy paths; the current no-subagent instruction remains in force.
5. Close the complete UI/service inventory and obsolete product surfaces. Review the integrated changes, fix findings and run the final local suite.
6. Install the same committed, content-addressed package outside the repository and on an isolated Pibo2 target. Complete A01–A37, including real provider execution under each supported adapter.
7. Reconcile current specifications and operator/plugin authoring guides to tested behavior. Archive this execution record and the owning plan only after every required item is accepted.

# Acceptance register

The [owning matrix](/plans/unified-plugin-system-rebuild.md#abnahmematrix) defines the exact scenarios. All A01–A37 are currently open. Evidence records must name the tested commit, commands, result, fixture/session identity where applicable and artifact path. Partial or simulated adapter checks must not be recorded as real model execution.

The required user flows include standard and replacement shell; two sessions of one agent and another agent with different plugin selection; A→B→A, reload and gateway restart; missing plugin placeholders; plugin settings and stored-versus-preview context; terminal streaming, cancel and historical replay; uninstall preview/revalidation/retirement/reinstall; and legacy migration interrupted between stores.

# Risks and rollback

No installation foreign key may delete sessions, history, runs, bindings, plugin business data, user files, tabsets or context evidence. Runtime generations retain their original plugin/configuration plan. New optional contributions cannot expand existing selections silently. Unknown legacy dependencies remain diagnosed and preserved.

Before any migration of non-fixture persistent data, create consistent backups of both stores and associated files. A rollback must either prove old-code readability of the new additive schemas or use a controlled restore that accounts for sessions created after backup. Candidate installation and all remote commands must name their Docker/Pibo2 target explicitly.

# Consolidated current evidence

The [checkpoint report](/reports/plugin-system-rebuild-checkpoint-2026-09-12.md) is the authoritative continuation entrypoint for preserved work and limitations. It links every saved artifact, the complete worker reports/contracts, historical research, code entrypoints, exact commands and failed-test details. Its artifact inventory explains the disposition of temporary material; no private agent context or `/tmp` file is needed to understand the implementation.

- Baseline `cac4dcd03945b9754db7be9ab2ab4324f10c335c`: build and 58 selected regression tests passed before implementation.
- Source commit `fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd`: full build and Chat UI typecheck passed; all **170 new plugin tests passed**; the combined 19-file legacy suite has **111 passes and 12 failures**. These overlapping stream results must not be added together.
- The audited source inventory covers all 97 changed product/test/config files without a hash mismatch or missing entry. Later checkpoint/handoff commits change documentation only.
- `test/fixtures/plugin-system/legacy-builtin-catalog.json` preserves the actual baseline catalog. `legacy-agent-selections.json` now preserves synthetic custom-agent cases derived from the baseline; it is not a production-data export. Complete global tab/settings migration fixtures and the remaining ownership inventory are still required by AP00.
- Authenticated read dispatch, verification before all backend imports, isolated browser assets, explicit actual-versus-preview routing and service-provider revision pinning were corrected and tested. Service-provider pinning is no longer an open finding.
- Standard Manager/CLI publication, complete consumer collectors, safe targeted lifecycle changes, Runtime Coordinator injection, pure legacy inspector replacement and Designer v2 dispatcher integration remain open. The new routes return a deliberate unavailable response when required product services are absent.
- Browser/Designer modules are integrated in source, but ordinary default manifests, shared browser build delivery, navigation and headful behavior are not complete. Fixed UI surfaces were removed before every installed replacement was available; the default product is not deployment-ready.
- Core ended before its final report; preserved changes and progress notes were reviewed by the orchestrator. Management, Runtime, Browser and Designer completed after closure steering. All ten earlier child sessions were rechecked as idle during the handoff audit; no new child was started or resumed.

The rough implementation-effort estimate is **30%, with a 25–35% uncertainty range**; this is not a measured percentage or acceptance score. **All AP00–AP19 remain unaccepted and all A01–A37 remain open.** AP11 ordinary installed Annotations is the next complete product milestone after the foundation is connected. Full extraction, migration, obsolete-surface removal and final multi-runtime/headful/Pibo2 acceptance remain required.
