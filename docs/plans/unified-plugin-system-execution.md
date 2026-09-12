---
type: "Task Ledger"
title: "Unified plugin system implementation and acceptance"
description: "Tracks delegated implementation, integration ownership and evidence for the complete plugin-system rebuild."
tags: ["plugins", "implementation", "migration", "acceptance"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-12T06:42:00Z"
sources:
  - id: "rebuild-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
    title: "Owner-approved implementation scope and A01–A37 acceptance matrix"
  - id: "parallel-execution"
    resource: "scope:owner instruction 2026-09-12 to complete the full rebuild, corrected to at most five delegated agents total and targeted follow-up work"
    title: "Parallel execution instruction and revised capacity limit"
---

# Goal and completion

Implement the [complete rebuild plan](/plans/unified-plugin-system-rebuild.md). All AP00–AP19 packages and A01–A37 scenarios remain subject to explicit evidence. Neither an implementation report nor passing unit tests alone closes the product-level acceptance gate.

The orchestrator owns integration, package order and final acceptance. The source baseline is `cac4dcd03945b9754db7be9ab2ab4324f10c335c`, equal to freshly fetched `upstream/dev` on 2026-09-12. The controller checkout has unrelated work and is not the implementation source.

# Execution boundary

One focused topic branch, `plugin-system-rebuild`, is mounted in the isolated Docker dev worker. Five workers edit disjoint files of the same integrated topic. Only the orchestrator commits the combined result. Builds and suites share a container-local validation lock; code edits and research remain parallel.

The owner's revised limit is five delegated agents in total. Existing research is reused; additional research waits for a concrete information gap and a free slot. Completed implementation workers receive targeted integration or review follow-ups.

The later quota-window instruction stops new agent dispatch. The existing streams finish their current blocks after direct steering; the orchestrator collects and validates a coherent checkpoint. The complete rebuild and acceptance scope remains recorded; unfinished packages are handed off without product acceptance. No new or resumed agent sessions are dispatched in this window.

Controller gateways are outside the development target. Pibo2 receives the exact committed package only after local validation. Merge, release and production installation are separate operations from this implementation.

# Ownership

| Stream | Owner | Deliverable and boundary |
|---|---|---|
| Core | SDK/host worker | Manifest, contributions, ownership, deterministic lifecycle, services and shared selection resolver. |
| Management | Persistence/installation worker | Additive stores, revision checks, migration journal, installation, impact plans, retirement, recovery and operator CLI. |
| Runtime | Runtime/Build Context worker | Real profile/session integration, generation snapshots, portable delivery, controlled hooks and observed context provenance. |
| Browser | Desktop/browser worker | Browser host, session-owned tabsets, plugin settings, generic Build Context, terminal envelopes and composer hooks. |
| Designer | Designer/migration worker | Agent selection UI, autosave and API/store contract, independent resources and exact legacy selection migration. |
| Integration | Orchestrator | Bootstrap, dispatch, package contents, first feature walkthrough, later extraction assignments, reviews, documentation and final evidence. |

Shared contracts have one writer. Dependent streams import those contracts rather than maintaining local equivalents. Browser types remain free of Node and harness dependencies. Features cannot introduce new fixed settings or context unions as an alternative registry.

# Work packages

Status values are `open`, `in progress`, `blocked` with a concrete cause, and `accepted` with evidence. Implementation in progress does not relax the prerequisites in the owning plan.

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
| AP12 | open | Assigned after AP11 | Every native tool family registered and delivered through its owner plugin. |
| AP13 | open | Assigned after AP11 | Run/Goal/Subagent contributions preserve execution, persistence and independent child plans. |
| AP14 | open | Assigned after AP11 | MCP CLI and second adapter use the same contract with explicit runtime limitations. |
| AP15 | in progress | Management, runtime, browser | A17–A21, immutable history, no implicit abort and retained tab/config/build data. |
| AP16 | in progress | Designer, management, integration | Exact selection migration and recovery; executable Pi-package/discovery paths removed after replacement. |
| AP17 | open | Browser, integration | Declarative standard and alternative shell/services; remove standalone TUI/VS Code product surfaces. |
| AP18 | open | Integration and independent review | No productive legacy activation/selection path or duplicate feature editor remains. |
| AP19 | open | Orchestrator and reviewers | Integrated build/suite/package, headful flows, exact Pibo2 artifact and real Pi/Codex/OMP execution. |

# Integration order

1. Reconcile AP00 against the implementation baseline and freeze the AP01 public contracts.
2. Integrate host, store, resolver, browser and designer along their declared dependencies. Run focused tests as each default path becomes available.
3. Complete AP11 with ordinary installed Web Annotations, its settings/context views and two independent session tabsets. Record this acceptance before broad extraction.
4. Assign AP12–AP14 in parallel where files are independent. Finish lifecycle impacts and migration before deleting legacy paths.
5. Close the complete UI/service inventory and obsolete product surfaces. Review the integrated changes independently, fix findings and run the final local suite.
6. Install the same committed, content-addressed package outside the repository and on an isolated Pibo2 target. Complete A01–A37, including real provider execution under each supported adapter.
7. Reconcile current specifications and operator/plugin authoring guides to tested behavior. Archive this execution record and the owning plan only after every required item is accepted.

# Acceptance register

The [owning matrix](/plans/unified-plugin-system-rebuild.md#abnahmematrix) defines the exact scenarios. All A01–A37 are currently open. Evidence records must name the tested commit, commands, result, fixture/session identity where applicable and artifact path. Partial or simulated adapter checks must not be recorded as real model execution.

The required user flows include standard and replacement shell; two sessions of one agent and another agent with different plugin selection; A→B→A, reload and gateway restart; missing plugin placeholders; plugin settings and stored-versus-preview context; terminal streaming, cancel and historical replay; uninstall preview/revalidation/retirement/reinstall; and legacy migration interrupted between stores.

# Risks and rollback

No installation foreign key may delete sessions, history, runs, bindings, plugin business data, user files, tabsets or context evidence. Runtime generations retain their original plugin/configuration plan. New optional contributions cannot expand existing selections silently. Unknown legacy dependencies remain diagnosed and preserved.

Before any migration of non-fixture persistent data, create consistent backups of both stores and associated files. A rollback must either prove old-code readability of the new additive schemas or use a controlled restore that accounts for sessions created after backup. Candidate installation and all remote commands must name their Docker/Pibo2 target explicitly.

# Current evidence

- Baseline fetched and topic worker created on 2026-09-12; no implementation package accepted yet.
- Five research and five implementation streams dispatched with explicit ownership.
- Baseline `npm run build` passed in the isolated worker before implementation edits. The existing Vite large-chunk advisory remains; it is not a compilation failure.
- The focused baseline suite passed 58 tests across plugin registry, agent storage/profiles, runtime portability, Build Context, desktop tab model and routes.
- `test/fixtures/plugin-system/legacy-builtin-catalog.json` records the actual built-in catalog at the baseline. Custom-agent and global-tab migration fixtures remain required.
- `npm run docs:validate` passed with zero errors or warnings after supplying an isolated Git-history mirror to the Docker worker. This validates documentation conformance, not implementation acceptance.
- Initial simultaneous dispatch hit the live gateway's 60-second capacity wait. Implementation requests were retried on their original child threads; current live policy allows five provider requests per room. This operational limit does not alter package scope or acceptance requirements.
- The five implementation streams resumed on their original threads after regular session-tool credential renewal. No controller gateway restart or credential change was required.
- The public SDK declaration target and eight focused loader/real Chat Web dispatch tests passed in Docker. They cover import-free graph rejection, verification of every artifact before the first backend import, SDK resolution from a staged package, activation rollback, login/origin enforcement, session-bound tab persistence and stale CAS rejection. These checks do not constitute installed-product or browser acceptance.
- Browser catalog/assets and stored-versus-preview plan routes are connected to the existing authentication boundary. Root service publication, the pure runtime preview provider, actual generation delivery and complete product composition are still in progress.
- Integration review identified required follow-up for service-provider revision pinning and controlled host changes. Deactivation of one plugin must not stop unrelated live services; required service owners must appear in the generation plan and admission reservation.


# Consolidated development checkpoint

The [checkpoint report](/reports/plugin-system-rebuild-checkpoint-2026-09-12.md) records code, commands and remaining product gaps. Core and Management provide successful module-level evidence; Browser and Designer source is integrated but default manifests, build delivery and web v2 normalization remain incomplete. The default UI is therefore not ready for deployment.

The orchestrator corrected authenticated read dispatch, artifact isolation, explicit actual-versus-preview routing, and service-provider revision pinning. The first broader regression pass also exposed legacy Pi-package/Build-Context expectation changes and test-loader integration issues; these must not be hidden behind successful narrow suites. Final results belong to the checkpoint report, not a claim that all acceptance scenarios passed.


Final checkpoint source: `fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd`. Full build and UI typecheck passed; all 170 new plugin tests passed. The combined existing regression suite remains at 111/123 with twelve documented open cases. All previously active workers completed their current turns; no further agents were dispatched. The checkpoint report and preserved contracts are the continuation entrypoint. The service-provider pinning finding is fixed in the shared resolver and forwarded from actual host ownership into Runtime/Designer resolution; safe default lifecycle composition remains open.
