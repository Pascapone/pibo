---
type: "Task Ledger"
title: "Unified plugin system implementation and acceptance"
description: "Tracks the preserved implementation checkpoint, remaining integration and acceptance for the complete plugin-system rebuild."
tags: ["plugins", "implementation", "migration", "acceptance"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-13T18:42:36Z"
sources:
  - id: "rebuild-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
    title: "Owner-approved implementation scope and A01–A42 acceptance matrix"
  - id: "continuation-authorization"
    resource: "scope:owner continuation instruction 2026-09-12 to implement the full plan with subagents; restrictions from the old session explicitly do not apply"
    title: "Full implementation and delegated work authorized for this continuation"
---

# Active direction: Pibo 4.0 clean migration (2026-09-13)

Parent review after the first local cutover phase was **not accepted as complete and was not deployed**. The authorized follow-up is now implemented locally: independent User Skills, Context Files and Custom-Agent profiles are owned by the ordinary `pibo.user-resources` host package and its scoped service; read-only Debug resolves immutable built-in adapter definitions directly; executable legacy plugin constructors and default Web/Core/Loop registries are removed from production source; and the default `pibo-sessions.sqlite` factory is no longer shipped. A source-audit regression rejects these entrypoints and any executable `definePiboPlugin` registration outside the retained compatibility registry implementation.

[PLG-V4-001](/plans/unified-plugin-system-rebuild.md#plg-v4-001-pibo-40-mit-automatischer-datenmigration) supersedes manual per-agent migration and dual legacy execution. Startup migration now retries prior conflict reports from their immutable backup, reconciles older successful reports when ownership changes, preserves explicit partial selections while absorbing compatible legacy MCP filters, and never clears legacy execution fields on a blocked migration. Core skills that were previously retained as independent resources move to `pibo.core` ownership without losing the original backup snapshot. A real child-process `SIGKILL` immediately after the AgentStore owner write proves journal resumption without a second revision.

A stored unavailable runtime is isolated per profile. The affected active or archived Agent receives a persisted `stored-runtime-unavailable` diagnostic and retains its old fields; healthy profiles continue through migration and Gateway startup. Archived profiles remain absent from the runnable profile catalog. Gateway startup also persists the versioned runtime-binding marker before router creation without changing Session IDs, native history IDs or binding history. Missing bindings do not enter a normal legacy Pi fallback.

Core, User Resources, both transcription providers, Web Product, Goal/Loop, runtime adapters, built-in profiles and product UI are ordinary immutable host packages in normal composition. Goal/Loop state and dynamic User-Resource updates are host-scope owned rather than process-global or legacy-registry owned. Normal source contains no executable legacy plugin registration outside `src/plugins/registry.ts`; that registry remains only as the compatibility projection over the single Host and as a low-level test fixture API. Narrow `createLegacyPiRuntimeSessionBinding()` calls remain inside persistence row readers/writers as versioned data-upgrade compatibility and are no longer exported from the package root.

Historical plugin configurations and per-Session tabsets remain in additive PluginStore tables, use fixed target identity and CAS, survive uninstall/tombstoning, and are journal-migrated without overwriting independent current records. Gateway startup now detects a sibling `pibo-sessions.sqlite`, reads it only as an upgrade source, writes a private logical backup and per-Session migration journal, imports non-conflicting Sessions and Runtime Session Bindings before opening the current store, and leaves the source file unchanged. Divergent target records remain unchanged and receive a Session-specific reconciliation instruction. The explicit `pibo data migrate sessions-to-v2` command remains an operator repair/import tool, not the required upgrade path.

At first Chat UI load, the browser snapshots `pibo.chat.desktopTabs.v1` before current UI effects can rewrite it and posts the retained source through an authenticated same-origin migration route. The server backs up the exact source and uses `migratePluginProductState()` plus tabset CAS to import only tabs carrying their own Pibo Session identity. It never infers ownership from `lastSelection`. Unbound, unavailable-view and conflicting entries remain in the backup and appear in Plugin Recovery for explicit mapping; the old browser bytes are never executed or removed. Existing feature settings that remain supported continue in their established owner stores; no pre-4.0 generic `plugin_configurations` source exists to infer or duplicate. The previously referenced read-only remote home `/root/.pibo-performance/20260906/home` was not mounted in this continuation, so no new remote-data claim is made.

The Agent Designer clipping report remains resolved by the single-scroll-owner fix. Desktop evidence at 1021×858 is `/tmp/plugin-v4-designer-root-clip-fixed-1021x858.png`. A new headful mobile-width pass at 500×557 toggled Pibo Web Annotations from unselected to selected and observed the exact autosave transitions `Saved → Unsaved → Saving… → Saved`; root `overflow=clip`, root `scrollTop=0`, root/main `y=56`, and main `scrollTop=2416` remained stable. Screenshot: `/tmp/plugin-v4-mobile-checkbox-autosave-500x557.png`.

Current local verification in Docker `pibo-dev-plugin-system-rebuild`: Workflow, root, Chat UI and Context Files UI typechecks pass; a clean stepwise build completed Workflow, root TypeScript emit, Plugin SDK/declarations, Chat UI and Context Files UI. The monolithic `npm run build` attempt was terminated by host memory pressure (exit 137), so it is not claimed as a passing command. The targeted final acceptance set passes **113/113**, including migration/retry/SIGKILL, product-runtime, Gateway, Store/configuration/tabset, uninstall, CLI, User Resources, Context Files Web and package-content coverage. AP19 remains blocked by real-provider Pibo2 Pi/Codex/OMP evidence and commit-backed specifications. This is a reviewable local plugin-only cutover candidate, not release acceptance.

# Owner feedback: optional modules and activation ownership (2026-09-13)

The active implementation task is [PLG-UX-001 and PLG-MIG-002](/plans/unified-plugin-system-rebuild.md#plg-ux-001-plugin-philosophie-optionale-module-und-getrennte-zuständigkeiten): generic optional workspace-module exposure, Settings → Plugins ownership, system versus agent selection, collapsed categorized Agent Designer, and actionable legacy migration. This supersedes earlier requirements that assigned every plugin its own settings tab. This section records intended work, not completed evidence.

Use existing worker thread `plugin-rebuild-implementation`, isolated Docker/worktree, and quick headful feedback iterations. Preserve existing tests; no fullsuite or heavy gates in this round. Verify existing installed state and existing legacy agents, not only fresh fixtures. Monitor every ten minutes and steer when needed. Current deployed feedback baseline is `71b90d02429cd80bab8a10c66018221b3c572e8e`; prior parent-owned corrections cover cache refresh, managed-default upgrades and current session-plan reads. The broader Goal-service ownership finding remains open and is not resolved by UI filtering.

Parent review deployed `030ed92e` to Pibo2 and found a real-state gap that the single-tool fixture missed: legacy host-provided skills were incorrectly required to have an installed plugin owner, and unavailable saved skill references blocked all migration. The correction preserves host/harness skill delivery and unavailable references without claiming replacement ownership or enabling defaults. Genuine installed-owner ambiguity and name collisions remain blocking. The focused migration test now includes both a host skill and an unavailable saved reference; 24 tests pass in Docker. Remote confirmation at 2026-09-13T14:00Z: corrected candidate `112ca5446f052d0d89d1468fcfe59a24d63aaf2e`, package SHA-256 `d3407c2e0557c7ddf71d87345d52e0a149c396a06ded085d8d839711fd8da631`, is active on Pibo2. All three real profile previews are ready (14/14/17 tools preserved). `pibo-agent` migrated through the headful Designer UI to revision 2 with all 14 saved skill references retained; mobile plugin toggles are enabled, runtime sections and plugin cards start closed, expanded cards show categories. Desktop Plus catalog contains no tool-family settings modules. Mobile Settings → Plugins → Pibo File Editing configuration loads with an enabled editor and no alert. Other profiles retain an explicit review/apply path. The unavailable `maintain-okf-docs` reference remains visible as a warning. Screenshots: `/tmp/plugin-scopes-pibo2-desktop-modules.png`, `/tmp/plugin-scopes-pibo2-mobile-migrated-plugins.png`, `/tmp/plugin-scopes-pibo2-mobile-settings.png`. No fullsuite or new model runs were performed in this UI feedback round.

# Goal and completion

Implement the [complete rebuild plan](/plans/unified-plugin-system-rebuild.md). All AP00–AP19 packages and A01–A42 scenarios remain subject to explicit evidence. Neither an implementation report nor passing unit tests alone closes the product-level acceptance gate.

The orchestrator owns integration, package order and final acceptance. The source baseline is `cac4dcd03945b9754db7be9ab2ab4324f10c335c`, equal to freshly fetched `upstream/dev` on 2026-09-12. The controller checkout has unrelated work and is not the implementation source.

# Execution boundary

The integrated topic branch is `plugin-system-rebuild`, worktree `/root/code/pibo/.worktrees/plugin-system-rebuild`, mounted as `/workspace` in Docker `pibo-dev-plugin-system-rebuild`. Only the orchestrator committed the combined worker changes. Builds and suites use `/tmp/plugin-system-validation.lock` in that worker. The [checkpoint](/reports/plugin-system-rebuild-checkpoint-2026-09-12.md#übergabe-und-gesicherter-arbeitsstand) records the exact source, environment, recovery bundle and validation commands.

**Current owner instruction: implement the complete plan and use subagents.** The owner explicitly removed the old session’s closure restrictions for this continuation. The orchestrator coordinates implementation, research, integration and acceptance; historical worker reports remain evidence of the earlier checkpoint.

The old implementation window ended with a tested checkpoint. The current continuation resumes implementation under the normal Docker, Pibo2 and GitHub project rules. The controller-host boundary remains in force; final acceptance follows the relevant environment skills.

# Activation-scope clarification, 2026-09-12

The owner requested this planning continuation to distinguish system-only, agent-only and mixed plugins. [PLG-ACT-001](/plans/unified-plugin-system-rebuild.md#plg-act-001-systemweite-aktivierung-und-agent-auswahl) now owns this target contract. System activation is separate from agent tooling selection; Goal is the required mixed example with its system side active by default even when no agent selects Goal tools.

Audit the existing AP01–AP04 contracts against this distinction before further integration. Carry it through AP05 management, AP06 runtime, AP08 view availability and AP10 Designer. AP11 must demonstrate all three forms with installed fixtures; AP13 proves real Goal parity; AP15/AP16 preserve dependencies, running work and both activation states. A38–A42 are new, open acceptance scenarios. Earlier unit tests do not establish compliance with this clarification.

The initial activation-scope clarification changed plans only. The current local candidate now implements and tests system-only, agent-only, mixed, missing-service and unsupported-runtime forms through ordinary installed fixtures. Formal matrix closure is still withheld because AP19 retains explicit external and documentation gates; this ledger distinguishes completed local evidence from final acceptance.

# Historical ownership and current responsibility

The table identifies where the preserved reports came from. The workers listed here belong to the earlier checkpoint. Current delegation uses a new implementation worker for the connected source changes and a researcher for the remaining inventory; the orchestrator owns integration and acceptance.

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

Status values are `open`, `in progress`, `blocked` with a concrete cause, and `accepted` with evidence. AP00–AP18 have a complete local implementation candidate and focused/aggregate evidence, but inherit the unclosed AP19 release gate. They therefore remain `in progress` rather than being recorded as accepted prematurely.

| Package | Status | Local candidate evidence and remaining gate |
|---|---|---|
| AP00 | in progress | Baseline `cac4dcd…`, ownership/legacy inventories, 83-file baseline test audit, runner/discovery audit and migration fixtures complete; final evidence publication waits for a commit. |
| AP01 | in progress | Manifest/schema/SDK, import-free validation and ordinary independent fixtures are green. |
| AP02 | in progress | Deterministic host, ownership scopes, explicit replacement, rollback and cleanup contracts are green. |
| AP03 | in progress | Additive stores, CAS, immutable snapshots, tabsets, activation state and interrupted migration recovery are green. |
| AP04 | in progress | One resolver drives preview/generation; required/optional/runtime/resource conflicts and retained independent resources are green. |
| AP05 | in progress | Local/package install, hashing, SDK/integrity rejection, progressive CLI and operation recovery are green; installed-package test passed. |
| AP06 | in progress | Pi/Codex/OMP adapter projections, portable delivery contracts, immutable generations and context evidence are green with fake/controlled providers; real-provider A06 remains AP19.3. |
| AP07 | in progress | Authenticated revisioned browser catalog, same-origin immutable assets, ordinary module loader and rollback are green. |
| AP08 | in progress | Session-owned tabset CAS, A→B→A/reload/restart, deep links, late-save isolation and recoverable before-leave guards are green; standard-flow headful evidence exists. |
| AP09 | in progress | Tool/input hooks, terminal envelope/fallback/replay and renderer-neutral parity are green; headful top/bottom scrolling and historical replay after reload are recorded. |
| AP10 | in progress | Plugin Designer/API roundtrip, missing references, autosave, runtime switch, replacements and independent resources are green; headful failed-save/close preservation was exercised. |
| AP11 | in progress | Ordinary installed Web Annotations tools/API/view/settings/context/terminal, activation failure, missing renderer, reinstall/data retention and two-session headful walkthrough are green; Pibo2 half of AP11.4 remains external. |
| AP12 | in progress | All named tool families and Codex Compat are ordinary packages; family regressions and exact migration are green. |
| AP13 | in progress | Run, Goal and delegation packages preserve existing lifecycle, queue, cancellation, child-plan and persistence contracts; A38–A42 fixtures are green. |
| AP14 | in progress | MCP CLI adapter and a second ordinary adapter use one contract; secret/delivery/OMP limitation tests are green. |
| AP15 | in progress | Impact, stale confirmation, admission, drain, tombstone, recovery and exact reinstall cases are green with no implicit abort/data deletion; headful plan/typed-confirmation/placeholder/reinstall retained tab state. |
| AP16 | in progress | Executable Pi-package/discovery/API/UI paths are removed; legacy names remain inactive migration evidence. Gateway startup automatically imports a detected old Session database through retained-source per-Session journals, and first Chat UI load automatically imports only explicitly Session-bound browser-v1 tabs through server backup and CAS. Conflicts and unbound tabs remain preserved with precise repair instructions. |
| AP17 | in progress | Standard product views/shell and runtime/profile contributions are ordinary packages; VS Code/code-server/VSIX and standalone TUI are retired. An ordinary local replacement-shell package ran headfully, then the standard shell was restored through plugin operations without a core/source change. |
| AP18 | in progress | Automated source audit rejects executable legacy registrars/default registries, process globals, the old session-store factory and public legacy binding export. Deliberate row-level upgrade readers, migration columns, explicit importers and the Host-backed registry projection remain. |
| AP19 | blocked | Typechecks, the earlier clean stepwise build, package-content tests and desktop/mobile headful evidence are complete. After the automatic-upgrade correction, 35 migration/session/Gateway/UI/source-audit regressions pass; the earlier 113-test aggregate predates this correction and is not relabeled as current-candidate evidence. Final closure still needs the current full suite, Pibo2 real-provider Pi/Codex/OMP evidence and commit-backed current specifications; commits and deployment are forbidden in this task. |

# Integration order

1. Reconcile AP00 against the implementation baseline and freeze the AP01 public contracts.
2. Integrate host, store, resolver, browser and designer along their declared dependencies. Run focused tests as each default path becomes available.
3. Complete AP11 with ordinary installed Web Annotations, its settings/context views and two independent session tabsets. Record this acceptance before broad extraction.
4. Implement AP12–AP14 after AP11 acceptance. Finish lifecycle impacts and migration before deleting legacy paths; the orchestrator coordinates delegated implementation and review.
5. Close the complete UI/service inventory and obsolete product surfaces. Review the integrated changes, fix findings and run the final local suite.
6. Install the same committed, content-addressed package outside the repository and on an isolated Pibo2 target. Complete A01–A42, including real provider execution under each supported adapter.
7. Reconcile current specifications and operator/plugin authoring guides to tested behavior. Archive this execution record and the owning plan only after every required item is accepted.

# Existing-test preservation

The owner explicitly requires existing tests to remain unchanged wherever possible and to be the primary behavioral-parity proof. Follow [PLG-TEST-001](/plans/unified-plugin-system-rebuild.md#plg-test-001-bestehende-tests-als-paritätsnachweis-erhalten). New plugin tests supplement the existing suite. Classify the twelve checkpoint regression failures individually and repair product regressions in product code. Document every unavoidable existing-test or runner change against the original baseline with its reason, approved behavior change or setup adaptation, and preserved/replacement behavioral evidence. AP19.7 audits this before final acceptance.

# Acceptance register

The [owning matrix](/plans/unified-plugin-system-rebuild.md#abnahmematrix) defines the exact scenarios. Local automated/headful evidence covers A01–A05, A07–A27 and A29–A42; controlled adapter fixtures are not mislabeled as real-provider evidence. A06 and the all-runtime real-model portion of A28 remain blocked on Pibo2; A28 also inherits that external same-candidate requirement. Evidence records name the uncommitted candidate, command, fixture/session identity and artifact path where available.

Headful local evidence covers ordinary installed views, Web Annotations, plugin settings, Build Context, two differing session plans, A→B→A, reload/gateway restart, Agent Designer autosave through tab close, narrow-screen modal/focus behavior, Terminal scroll/replay, typed uninstall/placeholder/reinstall, an ordinary replacement shell and restoration of the standard shell.

# Risks and rollback

No installation foreign key may delete sessions, history, runs, bindings, plugin business data, user files, tabsets or context evidence. Runtime generations retain their original plugin/configuration plan. New optional contributions cannot expand existing selections silently. Unknown legacy dependencies remain diagnosed and preserved.

Before any migration of non-fixture persistent data, create consistent backups of both stores and associated files. A rollback must either prove old-code readability of the new additive schemas or use a controlled restore that accounts for sessions created after backup. Candidate installation and all remote commands must name their Docker/Pibo2 target explicitly.

# Consolidated current evidence

The [checkpoint report](/reports/plugin-system-rebuild-checkpoint-2026-09-12.md) remains the historical continuation entrypoint. The current uncommitted candidate is newer and is summarized here without rewriting that historical report.

- Baseline for this continuation: `c3a8f906178f9da9e3a74c6d7ee3559ec1bacf1a`. Candidate: uncommitted worktree `/root/code/pibo/.worktrees/plugin-system-rebuild`, validated only in Docker `pibo-dev-plugin-system-rebuild` under `/workspace` and `/tmp/plugin-system-validation.lock`.
- Workflow, root, Chat UI and Context Files UI typechecks pass. A clean stepwise build completed Workflow build, root TypeScript emit, Plugin SDK/declarations, Chat UI and Context Files UI. One monolithic `npm run build` attempt ended with exit 137 under host memory pressure and is retained as infrastructure evidence, not reported as green.
- The earlier targeted acceptance set passed **113/113** with no skips before the final automatic-upgrade correction. The correction itself now passes **35/35** focused migration, Session-store, Gateway, browser-bootstrap, CLI and source-audit tests, including interrupted owner-write recovery, divergent-target preservation, automatic Gateway detection and first-UI-load source capture. The 113-test result is retained as predecessor evidence, not relabeled as a complete check of the changed candidate.
- The previous checkpoint's bounded complete-suite result remains historical evidence for its earlier candidate: **2,963 tests; 2,954 passed; 0 failed; 9 skipped**. The owner prohibited a new Fullsuite in this follow-up, so that count is not relabeled as current-candidate evidence.
- Tests that imported removed production constructors now use explicit test-only legacy-registry fixtures or the ordinary Host package startup. Their behavioral assertions remain; the migration conflict assertions were strengthened to require source fields to remain intact, and the removed default session-store test now proves the API is absent while explicit legacy-store reading still works.
- Ordinary packages now own Core, independent User Resources, transcription, Web Product, Web Annotations, tool families, Run/Goal/delegation, MCP CLI, Pi/Codex Native/OMP adapters, built-in profiles, product views and the standard shell. Production source has no executable legacy plugin constructor outside the retained registry implementation; Debug and Gateway do not create a second runtime/default registry.
- Historical PluginStore configurations and per-Session tabsets retain CAS identity, survive uninstall and reject overwrite during journal migration. The default `pibo-sessions.sqlite` runtime factory and root-exported legacy binding constructor are removed. Gateway startup nevertheless detects the old file as a preserved, read-only upgrade source and imports safe rows through per-Session journals before using `pibo.sqlite`. Chat UI snapshots browser v1 tabs before load, and the authenticated migration route imports only explicitly Session-bound mappings through `migratePluginProductState()` and CAS.
- Existing desktop Designer evidence remains valid. The current mobile-width 500×557 Browser Use pass observed `Saved → Unsaved → Saving… → Saved` while selecting Pibo Web Annotations, with the clipped root fixed at `scrollTop=0`; screenshot `/tmp/plugin-v4-mobile-checkbox-autosave-500x557.png`.
- Documentation governance checks are rerun after this ledger update. Current specification promotion remains intentionally blocked because traceability requires a commit and this task forbids commits.

**Release decision:** the local implementation candidate is reviewable, and the corrected upgrade paths have focused green evidence, but no current aggregate suite covers the post-correction tree. The plan is not globally accepted. AP19 remains blocked by the current Fullsuite, real-provider Pibo2 execution and commit-backed specification publication. No commit, push, PR, deployment or controller-gateway change was performed.

## Orchestrator integration review, 2026-09-13

The integration review added two narrowly scoped upgrade corrections: historical `agent-plugins-v1` journals are accepted only with verified source and backup hashes; browser-v1 import starts with the authenticated workspace and releases a failed promise for retry while retaining the original captured source bytes. All 33 targeted Agent migration and browser import tests pass, including historical v1/v2 reconciliation and a transient failed import. A complete clean staged Docker build passed after the automatic upgrade correction and browser retry fix; the subsequent journal-reader change passed root TypeScript emit and the targeted tests again.

The worker-only no-commit instruction does not restrict authorized orchestrator integration or the owner's Pibo2 test deployment. No new fullsuite is required for this feedback deployment; full release acceptance remains separate. The candidate is being prepared for canonical Pibo2 upgrade validation against preserved existing profiles. Remote migration and model acceptance are not yet claimed.

# Orchestrator handover audit, 2026-09-12

The implementation worker reported its local candidate complete at 19:49 UTC. Its subsequent loop continuation was rejected with `budget_limited` at 19:50 UTC; the orchestrator has not restarted or increased that loop budget. This does not invalidate the completed local checks, and it does not establish final acceptance.

The AP00–AP18 completeness statements above are the implementing worker's assessment. Independent source review, verification of the test-preservation audit, a committed content-addressed candidate, Pibo2 acceptance, and current specification reconciliation remain outstanding. The no-commit instruction applied to the implementation worker; it is not a new restriction on the orchestrator's authorized integration work.

Preserved evidence snapshots:

- [Implementation and local validation report](/reports/artifacts/plugin-system-local-candidate-2026-09-12/implementation.txt).
- [Individual baseline test-diff audit](/reports/artifacts/plugin-system-local-candidate-2026-09-12/test-diff-audit.txt).
- [Read-only original test inventory](/reports/artifacts/plugin-system-local-candidate-2026-09-12/baseline-test-inventory.txt).
- [Orchestration and intervention notes](/reports/artifacts/plugin-system-local-candidate-2026-09-12/orchestrator-notes.txt).

These are snapshots of an uncommitted working tree. Their references to temporary raw logs and screenshots describe where those artifacts were created; they are not a claim that every raw artifact has been published in this bundle. The exact tested runtime package must be rebuilt and identified after the integration commit before Pibo2 acceptance.

## Resolved independent review finding: Goal system ownership

The orchestrator's first source review does **not** confirm AP13/AP18 completion. `src/plugins/default-packages.ts` builds `pibo.goal-control` as agent tools plus an app-scoped settings view. `src/plugins/packaged-control-tools.ts` registers only those generated-tool declarations and settings. The actual Goal/Loop channel and slash action still enter the product through a separate `createPiboLoopPlugin()` call in `src/gateway/web.ts`; `src/loops/channel.ts` retains a process-global `currentLoopService`, and `src/apps/chat/loop-api.ts` consumes that global getter.

Consequently the ordinary installed Goal package does not yet own the real system service lifecycle required by PLG-ACT-001, AP13 and A42. Generic mixed-plugin fixtures and preserved Goal tool tests do not prove that disabling/updating/uninstalling the installed Goal package safely accounts for and controls its running system work. This is an implementation/review blocker, not only missing remote evidence. The worker's earlier local-completeness assessment must be read subject to this finding.

Required resolution: establish explicit ordinary-plugin ownership of the real Goal system service and its API/action integration, retain independent per-agent tool selection, and prove startup/restart at zero selected agent tools plus dependency/impact/drain behavior with running Goals. Preserve existing behavioral tests and add the missing real-product integration case. Review the related Run service boundary at the same time. Do not treat an app-scoped settings view as evidence of system-service migration.

Resolved locally on 2026-09-13: `pibo.goal-control` now publishes the Goal/Loop service, channel, gateway action and stop conditions from its ordinary package setup. `PiboLoopServiceController` owns the active instance; process-global `currentLoopService` and `getPiboLoopService()` are removed. Chat reads the service through the host, Web composition no longer installs `createPiboLoopPlugin()` as a second production path, and per-agent Goal tool selection remains independent. Focused product-runtime and Goal lifecycle tests are green. Full AP13/AP18 acceptance still inherits the broader remaining plugin-only and AP19 gates.

# Owner-requested Pibo2 test deployment, 2026-09-13

The owner explicitly requested deployment for manual testing. The orchestrator committed the candidate as `42f117bf2727f5957cd6b585b14e3b4e7e2ca990`, rebuilt/packed it in the isolated Docker worker through `npm pack` (including prepack build), and installed the same archive on canonical Pibo2 through the documented checksum-verified candidate workflow. Canonical Pibo2 was selected to preserve the existing human Google OAuth entrypoint. This is a test deployment, not final AP19 acceptance or release readiness.

- Candidate: `plugin-system-rebuild-20260913`, package version `1.7.2`.
- Archive SHA-256: `bc78979697fd49fcaf5faffc7e53258ca21bd7e62e26a89ed24351c3ad2b142a`.
- Remote runtime: `/opt/pibo-candidates/plugin-system-rebuild-20260913/42f117bf2727f5957cd6b585b14e3b4e7e2ca990/runtime`.
- Prior canonical start override preserved on Pibo2 under `/root/.pibo-candidate-backups/plugin-system-rebuild-20260913/`.
- Activation reports the exact candidate and commit; canonical process PID `3076117`, no restart loop observed.
- Public Chat response and authenticated bootstrap returned HTTP 200. Bootstrap reported Machine Auth, a usable session, 13 agents and 61 rooms; the plugin management API returned 17 active enabled ordinary installations.
- Authenticated headful browser/CDP snapshot at `2026-09-13T06:38:35Z` found the Chat shell in `ready` state and an enabled composer on the canonical public Chat path.

No real model turn, full remote lifecycle matrix, or independent full source review is claimed by this smoke check. The Goal system-ownership review finding above remains open. The controller gateway was not changed, restarted or deployed. No push, PR, merge, release or publication was performed.
