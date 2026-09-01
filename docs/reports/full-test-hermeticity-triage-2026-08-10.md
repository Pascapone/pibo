---
type: "Research"
title: "Full Test Suite Hermeticity Triage — 2026-08-10"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/full-test-hermeticity-triage-2026-08-10.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "c622b87367d5cbf35da7f53235c3bf12b6aa060f"
  source_bytes: 23983
  source_sha256: "08f4327b53200a1ec6b5013c6bcdb291d9d0a8634dccbc0531bb0c2506390a1f"
  source_body_sha256: "08f4327b53200a1ec6b5013c6bcdb291d9d0a8634dccbc0531bb0c2506390a1f"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Full Test Suite Hermeticity Triage — 2026-08-10

**Status:** Complete; published in upstream pull request #445

**Branch:** `fix/hermetic-full-test-suite`

**Baseline:** `upstream/dev` at `3d0be07337d5992fc92c0f830f1a2b2c8b741702`
**Goal:** Classify and resolve the 29 failures observed in the canonical full test suite without weakening current contracts.

## Result

All 29 observed failures have an evidence-backed disposition:

| Classification | Count | Failure IDs |
|---|---:|---|
| Obsolete test | 8 | 3, 5, 23–28 |
| Harness/environment defect | 20 | 1–2, 4, 6–21, 29 |
| Requirement/implementation gap | 1 | 22 |
| **Total** | **29** | |

The exact canonical command is green both with isolated host state and with the operator's real `HOME`, Pibo configuration, MCP configuration, and gateway ownership state:

```text
node --test test/*.test.mjs test/chat-vscode/*.test.mjs
1560 passed, 0 failed
```

It passed twice directly and once through `npm test`. No test was deleted. Superseded assertions were rewritten only where the current capability contract or the Projects clean-start design proved the older behavior obsolete.

## Method and environment

The authoritative work was performed in the dedicated worktree `/root/code/pibo-hermetic-full-test-suite`, created from fetched `upstream/dev`. PR #441 and its branch were not modified.

- Node: `v24.15.0` (repository requires Node `>=24`).
- npm: `11.12.1`.
- The historical originating result was 1,532 passed / 29 failed. `/tmp/pibo-manual-revisions-full-test.log` remains historical evidence only.
- The authoritative isolated baseline used temporary `HOME` and `PIBO_HOME`, no inherited `MCP_CONFIG_PATH`, a clean root install, and required generated artifacts. It produced 1,560 tests: 1,533 passed / 27 failed (`/tmp/pibo-hermetic-baseline-full-test.log`).
- Five historical failures disappeared under clean isolation (#4, #20–22, #29), while three tests newly exposed an implicit dependency on the operator's Better Auth configuration. Those three additional harness defects are documented below the 29-row matrix.
- Root installation is now the single dependency boundary. `packages/workflows` and the VS Code test shim are npm workspaces, the workflow dependency is locked at its previously installed `xstate@5.31.1`, and the obsolete nested workflow lockfile is removed.
- Because the validation host intentionally exports `NODE_ENV=production`, clean development installation uses `npm ci --include=dev`. This is an environment prerequisite, not a repository behavior change.
- Root build and typecheck invoke the memory-intensive root TypeScript pass with a 1,200 MiB V8 heap. The previous unbounded script inherited the runner's approximately 640 MiB heap and reproducibly OOMed; 1,200 MiB completed within the runner's resource boundary.

Classification vocabulary:

- **Obsolete test:** a superseding current contract proves the asserted behavior was retired or changed.
- **Harness/environment defect:** valid coverage is unstable or fails because prerequisites, isolation, process environment, artifacts, or fixtures are implicit or contaminated.
- **Requirement/implementation gap:** current behavior violates a still-governing product or system contract.

## Triage matrix

| ID | Failure / source | Clean reproduction | Classification | Governing requirement / spec | Decision | Code or test change | Validation evidence |
|---:|---|---|---|---|---|---|---|
| 1 | `app-context-fresh-runtime-regression`; missing `packages/workflows/dist/index.js` | Clean root build succeeded but did not build the separately locked workflow package; the test then failed at module load. | Harness/environment defect | `docs/specs/capabilities/pibo-workflow-framework-package.md` requires a buildable/exported framework package used by the app-context contract. | Make the root dependency/build boundary own the required package artifact. | Added `packages/workflows` as a root workspace; root build/typecheck now run its build/typecheck; consolidated dependency locking at the root. | Focused app-context tests pass; `packages/workflows/dist/index.js` exists after plain `npm run build`; all three full runs pass. |
| 2 | `app-context-fresh-schema`; same missing workflow artifact | Same clean module-load failure as #1. | Harness/environment defect | Same workflow framework package contract as #1. | Same disposition as #1. | Same package/build topology change as #1. | Focused schema test passes; all three full runs pass. |
| 3 | User-settings API exact telemetry-retention object omitted `lastPrunedAt` | Clean run failed because startup maintenance legitimately added the optional timestamp before the response was asserted. | Obsolete test | `src/core/telemetry-retention-settings.ts` and `src/apps/chat/telemetry-retention-service.ts` define and preserve optional `lastPrunedAt`. | Preserve coverage but assert the current persisted contract deterministically. | Seeded a recent `lastPrunedAt` and asserted it survives read, mutation, reload, and disk persistence. | Focused test passes; all full runs pass. |
| 4 | Mobile navigation child could not resolve `react-test-renderer` | Passed immediately after a clean root development install; no product or assertion failure remained. | Harness/environment defect | The test imports a declared root development dependency and must run from the canonical install boundary. | Retain the test unchanged; remove dependence on stale/shared dependency state. | No test weakening. Root workspace/lock consolidation and documented `npm ci --include=dev` provide the prerequisite. | Focused test and isolated/host full runs pass. |
| 5 | Older trace-page merge test initially lacked renderer; clean run then exposed stale order/winner expectations | After dependencies were clean, the fixture omitted canonical order keys and expected the older duplicate to override the current tail. | Obsolete test | `docs/specs/capabilities/chat-web-trace-and-terminal-view.md` and the shared `src/shared/trace-page-merge.ts` contract make current-tail identity authoritative and sort by canonical order metadata. | Keep pagination/dedup coverage, but model canonical order and current-tail precedence. | Added explicit `orderKey` values and changed the shared-node expectation to the current page's value. | Focused trace merge test passes; all full runs pass. |
| 6 | Workflow edge-adapter child: `spawn npx ENOENT` | Reproduced with `/workspace` absent. The invalid child `cwd` causes the spawn error before executable lookup. | Harness/environment defect | Portable repository tests must run from any checkout on supported Node; no workflow behavior requires `/workspace` or an `npx` subprocess. | Launch the installed TS loader through the current Node executable from the actual checkout. | Replaced `npx tsx` plus `/workspace` with `process.execPath --import tsx` and `process.cwd()`. | Focused test passes; all full runs pass. |
| 7 | Workflow graph-model child: `spawn npx ENOENT` | Same invalid `/workspace` assumption, including module URL construction. | Harness/environment defect | Same portable-test requirement as #6. | Same disposition as #6. | Uses actual/optional `PIBO_TEST_WORKSPACE`, `process.execPath`, and the installed `tsx` loader. | Focused test passes; all full runs pass. |
| 8 | Workflow inspector-form child: `spawn npx ENOENT` | Same invalid child `cwd`. | Harness/environment defect | Same portable-test requirement as #6. | Same disposition as #6. | Same direct-Node TS-loader launch. | Focused test passes; all full runs pass. |
| 9 | Workflow node-default child: `spawn npx ENOENT` | Same invalid child `cwd`. | Harness/environment defect | Same portable-test requirement as #6. | Same disposition as #6. | Same direct-Node TS-loader launch. | Focused test passes; all full runs pass. |
| 10 | Workflow settings-model child: `spawn npx ENOENT` | Same invalid child `cwd`. | Harness/environment defect | Same portable-test requirement as #6. | Same disposition as #6. | Same direct-Node TS-loader launch. | Focused test passes; all full runs pass. |
| 11 | Workflow version-history child: `spawn npx ENOENT` | Same invalid child `cwd`. | Harness/environment defect | Same portable-test requirement as #6. | Same disposition as #6. | Same direct-Node TS-loader launch. | Focused test passes; all full runs pass. |
| 12 | VS Code inliner expected `src/apps/chat-vscode/dist/chat-vscode-web/index.html` | Clean standard root build produced the canonical bundle at `dist/apps/chat-vscode-web`, while the test hard-coded a package-staging path produced only by a different packaging command. | Harness/environment defect | `scripts/vscode-build.mjs`, `scripts/vscode-package.mjs`, and the inliner API permit an explicit extension root and bundle-relative directory. | Exercise the real artifact produced by the canonical root build. | Integration fixture now points at the repository root with `bundleRelativeDir: "dist/apps/chat-vscode-web"`. | Inliner focused test passes after plain root build; all full runs pass. |
| 13 | Healthy VS Code sidecar test could not resolve bare `vscode` | Clean Node process ignored the root `imports.vscode` mapping because package import maps only resolve `#` specifiers. | Harness/environment defect | The extension host tests need a resolvable test-only `vscode` package; production VS Code still supplies the real host module. | Provide a standards-compliant private workspace shim instead of an invalid import map. | Moved the existing shim into a private workspace package named `vscode`, linked as a root dev dependency. | All seven webview-host tests pass in focused and full runs. |
| 14 | Unhealthy sidecar shell; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 15 | Sidecar startup diagnostic shell; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 16 | `swapToInlinedView` healthy transition; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 17 | `swapToInlinedView` unhealthy result; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 18 | Better Auth sidecar hint; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host/auth test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 19 | Cookie bridge reuse; `vscode` unresolved | Same module-resolution root cause as #13. | Harness/environment defect | Same VS Code host/auth test contract as #13. | Same disposition as #13. | Same workspace shim. | Focused and full runs pass. |
| 20 | Dev gateway start conflicted with `/root/.pibo-dev` ownership | Passed with isolated host state and failed only when inheriting the operator's active dev-gateway home. | Harness/environment defect | `docs/specs/capabilities/local-gateway-protocol-and-lifecycle.md` requires ownership safety; tests must not reuse a live operator ownership directory. | Give the spawned fixture its own dev home. | Set `PIBO_GATEWAY_DEV_HOME` to the test temp directory and clean it in `finally`. | Focused isolated run and complete operator-host-state full run pass. |
| 21 | MCP catalog unexpectedly included installed `chrome-devtools` | Passed under isolated `HOME`; failed only because merged MCP discovery intentionally reads user-level config. | Harness/environment defect | `docs/specs/capabilities/mcp-server-integration.md` preserves merged discovery, so the fixture—not product merging—must isolate user config. | Keep merged discovery behavior and isolate the exact catalog fixture. | Temporarily sets `HOME` to the fixture directory while listing server metadata. | Focused and operator-host-state full runs pass. |
| 22 | `pibo mcp config init` reported an unrelated existing config as ready | Passed under isolated state, but clean code review proved `init` used `findConfigPath` across search paths to decide whether the preferred target already existed. | Requirement/implementation gap | `docs/specs/capabilities/mcp-server-integration.md`; `config init` must create/report the preferred target (explicit/env/cwd), not substitute a different merged search-path file. | Fix command semantics without changing normal merged server discovery. | Resolve the preferred target first, check that exact path with `existsSync`, and pass it to `ensureConfigExists`. | MCP CLI focused test and all local full runs pass. On exact Pibo2 candidate `a8a1f24d`, a contaminated home produced `Created` for the absent cwd target, then `ready` on the second call while preserving the home config. |
| 23 | Shared Terminal fixture expected legacy delegation node ID | Clean deterministic output used the conceptual stable ID introduced by the shared terminal model. | Obsolete test | `docs/specs/capabilities/shared-terminal-view-model.md`; commit history around `65e00dea` establishes conceptual terminal IDs. | Update fixture identity only; retain row-order, tone, card, and redaction assertions. | Expected `terminal:delegation:ps_linked_explorer`. | Focused fixture and all full runs pass. |
| 24 | Long-output fixture expected legacy yielded-run ID | Same stable-ID drift as #23. | Obsolete test | Same shared terminal identity contract as #23. | Update fixture identity only. | Expected `terminal:run:run_web_derived_long_output` (and the shared yielded-run fixture's current ID). | Focused fixture and all full runs pass. |
| 25 | Workflow delete test expected a workflow-backed Project row in default bootstrap | Clean start returned no workflow-backed Project session, while the dedicated historical-start API still returned the immutable saved snapshot and existing run. | Obsolete test | `docs/specs/changes/projects-room-parity-modular-clean-start/design.md` (implemented by `24a14eb0`) explicitly quarantines workflow-backed Project sessions from default bootstrap while preserving storage/services for later reintroduction. | Assert quarantine in bootstrap and retain direct historical snapshot/API coverage. | Replaced stale bootstrap link assertions with empty bootstrap assertions; retained all immutable snapshot and deleted-definition fallback checks through the preserved API. | Focused web/checklist tests and all full runs pass. |
| 26 | Project bootstrap row lacked `pendingHumanActions` | Clean-start bootstrap intentionally excludes the workflow session; direct human-action APIs still enforce all token/action contracts. | Obsolete test | Same Projects clean-start design as #25, plus the preserved workflow human-action service contract. | Stop asserting retired bootstrap projection; retain API acceptance and rejection coverage. | Test now proves the sessions are absent from default bootstrap, then covers unknown, mismatched, unavailable, invalid, missing-ref, approve, reject, resume, cancel, expired, and replay cases via the preserved route. | Focused web/checklist tests and all full runs pass. |
| 27 | Blocked lifecycle event absent from Project bootstrap | The lifecycle endpoint and database both contained the event; only the quarantined default bootstrap projection omitted it. | Obsolete test | Same Projects clean-start design as #25; lifecycle storage/API remains a dedicated preserved service. | Assert empty bootstrap projection while retaining endpoint and persistence assertions. | Updated the bootstrap assertion only; event endpoint and database evidence remain intact. | Focused web test and all full runs pass. |
| 28 | Project bootstrap omitted workflow parent/descendant tree | Clean-start bootstrap intentionally excludes main workflow, nested workflow, agent-node, and subagent sessions. | Obsolete test | Same Projects clean-start design as #25 supersedes the earlier sidebar/bootstrap contract. | Convert the stale inclusion test into a quarantine regression test. | Renamed the test and asserted every workflow-tree kind plus unrelated workflow nodes remain absent from default bootstrap; reconciled source-checking checklist tests. | Focused web/checklist tests and all full runs pass. Exact Pibo2 candidate returned 201/201/200 for project/session/bootstrap and excluded the workflow session from both Project rows and the session tree. |
| 29 | Chat Web MCP description fixture included installed `chrome-devtools` | Passed under isolated `HOME`; host run inherited the operator's MCP catalog despite an explicit fixture path because merged discovery is intentional. | Harness/environment defect | `docs/specs/capabilities/mcp-server-integration.md` requires merged config discovery. | Isolate the fixture home rather than disabling product merging. | Sets/restores `HOME` alongside the explicit `MCP_CONFIG_PATH`. | Focused and complete operator-host-state full runs pass. |

## Additional defects exposed by clean isolation

These were not part of the historical 29 because the operator's Better Auth configuration accidentally satisfied them. The authoritative isolated baseline exposed them, so they were fixed as part of making the suite truly hermetic.

| Test | Classification | Root cause and change | Evidence |
|---|---|---|---|
| `web gateway registry loads custom agent profiles before channels start` | Harness/environment defect | Registry-only test inherited default Better Auth and required host `auth.baseURL`; it now explicitly uses loopback-safe `authMode: "local"`. | Focused and all full runs pass. |
| `web gateway registers user skills before custom agent profiles are used` | Harness/environment defect | Same implicit Better Auth dependency; now explicitly local auth. | Focused and all full runs pass. |
| `web gateway startup survives a malformed user skill store` | Harness/environment defect | Same implicit Better Auth dependency; now explicitly local auth. | Focused and all full runs pass. |

## Root-cause clusters

1. **Build/package topology (#1–2, #4, #12–19):** generated artifacts and test shims were outside the canonical root dependency/build boundary.
2. **Non-portable child launch (#6–11):** `/workspace` was treated as universal and the resulting invalid `cwd` was misreported as `spawn npx ENOENT`.
3. **Host state leakage (#20–21, #29, plus three newly exposed auth tests):** live gateway ownership, MCP config, and Better Auth config contaminated fixtures.
4. **Superseded contracts (#3, #5, #23–28):** telemetry metadata, trace ordering/current-tail precedence, terminal identity, and Projects clean-start behavior had moved while assertions remained exact to earlier shapes.
5. **Real command bug (#22):** MCP `config init` confused merged discovery with existence of the preferred creation target.

## Validation ledger

| UTC date | Environment | Command | Result | Evidence |
|---|---|---|---|---|
| 2026-08-10 | Dedicated worktree at baseline | `npm ci` plus separate workflow install/build investigation | Confirmed root was not an npm workspace and root build omitted workflow artifact. | Initial goal-session logs; `/tmp/pibo-hermetic-baseline-build*.log`. |
| 2026-08-10 | Isolated `HOME` / `PIBO_HOME`, no inherited MCP path | `node --test test/*.test.mjs test/chat-vscode/*.test.mjs` | 1,560 tests; 1,533 passed; 27 failed. | `/tmp/pibo-hermetic-baseline-full-test.log`. |
| 2026-08-10 | Clean post-fix install; host exports `NODE_ENV=production` | `npm ci --include=dev` | 1,081 packages installed; workflow and VS Code workspaces linked. | `/tmp/pibo-hermetic-postfix-npm-ci-dev.log`. |
| 2026-08-10 | Post-fix | `npm run build` | Pass in 23.59 s; peak RSS 1,088,896 KiB. Produced workflow dist and canonical VS Code webview bundle. | `/tmp/pibo-hermetic-postfix-build.log`. |
| 2026-08-10 | Isolated host state; all affected files | Focused `node --test ...` cluster command | 169/169 passed in 31.74 s. | `/tmp/pibo-hermetic-postfix-focused.log`. |
| 2026-08-10 | Post-fix | `npm run typecheck` | Pass in 39.22 s; includes workflow, root, Chat UI, context-files UI, VS Code extension, and webview typechecks. | `/tmp/pibo-hermetic-postfix-typecheck.log`. |
| 2026-08-10 | Isolated `HOME` / `PIBO_HOME`, no inherited MCP path | Canonical full command, run 1 | 1,560/1,560 passed in 88.04 s; peak RSS 432,572 KiB. | `/tmp/pibo-hermetic-postfix-full-run1.log`. |
| 2026-08-10 | Real operator host state | Canonical full command, run 2 | 1,560/1,560 passed in 91.18 s; peak RSS 549,804 KiB. Proves gateway/MCP/auth isolation fixes survive contaminated host state. | `/tmp/pibo-hermetic-postfix-full-run2-host.log`. |
| 2026-08-10 | Clean isolated package-script path | `npm test` | Build plus 1,560/1,560 tests passed in 111.53 s; peak RSS 1,089,840 KiB. | `/tmp/pibo-hermetic-postfix-npm-test.log`. |
| 2026-08-10 | Packed exact commit `a8a1f24d3c26066b091d6a5d60b6714fa1b4e6c0` | `npm pack --ignore-scripts` | Candidate tarball SHA-256 `e833b79a30b944ba69713efc477e84a80ae567195849996fb43384470066b1c4`; packed MCP implementation contains the preferred-target fix. | `/tmp/pibo-hermetic-candidate-a8a1f24d3c26/`. |
| 2026-08-10 | Pibo2 exact candidate | Candidate install/activate scripts | `hermetic-full-suite` active at commit `a8a1f24d...`; `pibo-web.service` restarted cleanly on PID 151095; gateway reachable in prod mode. | `/tmp/pibo-hermetic-pibo2-install.log`, `/tmp/pibo-hermetic-pibo2-activate.log`, `/tmp/pibo-hermetic-pibo2-status-after.log`. |
| 2026-08-10 | Pibo2 CLI with contaminated temporary home | Active candidate `pibo mcp config init` twice from an empty cwd | First call created cwd `mcp_servers.json`; second reported it ready; pre-existing home config remained untouched. | `/tmp/pibo-hermetic-pibo2-mcp-cli.log`. |
| 2026-08-10 | Pibo2 public and authenticated Chat paths | Health/public request, authenticated debug snapshot, authenticated bootstrap fetch, console inspection | Health 200; Chat 200 (38.9 ms total); authenticated machine-key browser rendered `Pibo Web Chat` with debug root found and 35 nodes; bootstrap 200; no console errors. | `/tmp/pibo-hermetic-pibo2-health.json`, `/tmp/pibo-hermetic-pibo2-public-timing.log`, `/tmp/pibo-hermetic-pibo2-chat-snapshot.json`, `/tmp/pibo-hermetic-pibo2-auth-bootstrap.log`, `/tmp/pibo-hermetic-pibo2-console-errors.log`. |
| 2026-08-10 | Pibo2 authenticated Project API | Create Project, create workflow session, request default Project bootstrap | 201/201/200; workflow session absent from both `projectSessions` and session tree; selected workflow session suppressed. | `/tmp/pibo-hermetic-pibo2-project-quarantine.log`. |
| 2026-08-10 | GitHub publication | Push topic branch and open one upstream PR | Branch `fix/hermetic-full-test-suite` pushed to `origin`; PR #445 opened against `Pascapone/pibo:dev`. | `pibo-create-upstream-pr` output in `/tmp/pibo-hermetic-pr-create.log`. |

## Completion checklist

- [x] Every observed row has an evidence-backed classification and disposition.
- [x] No test was deleted or weakened; superseded assertions have explicit contract evidence and retained replacement coverage.
- [x] Clean `npm run typecheck` passes.
- [x] Clean `npm run build` passes and produces declared prerequisites.
- [x] Canonical full test command passes repeatedly in isolated and contaminated host environments.
- [x] Relevant real Pibo2 paths are validated for the exact candidate.
- [x] Focused changes are committed and pushed to `origin/fix/hermetic-full-test-suite`.
- [x] One PR exists from the fork branch to `Pascapone/pibo:dev` (#445).
