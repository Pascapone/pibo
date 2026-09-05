---
type: "Validation Report"
title: "Session-native Workflow transition validation — 2026-09-05"
description: "Records isolated migration, runtime, browser, packaging, and regression evidence for the completed Room and Session ownership transition."
tags: ["workflows", "sessions", "rooms", "migration", "validation"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T10:32:00Z"
sources:
  - resource: "scope:Integrated code commit 7ec71c2cca2108423002be0e7330d2a20c4c5b67 and earlier explicitly identified validation checkpoints"
    title: "Checked implementation and reproducible commands"
  - resource: "/reports/artifacts/session-native-workflows-2026-09-05/manual-run-evidence.json"
    title: "Canonical facts from the real provider-backed manual run"
links:
  - "/specs/web/rooms-and-session-trees.md"
  - "/specs/orchestration/workflow-catalog-and-session-execution.md"
  - "/specs/data/product-store-history-and-read-models.md"
  - "/legacy/plans/remove-projects-and-make-workflows-session-native.md"
---

# Scope and ownership

The integrated topic removes the retired container feature rather than hiding it. Rooms group ordinary Pibo Sessions and can supply workspace defaults. Workflow facts use the canonical Workflow store; Sessions keep their original conversation identity, runtime binding, hierarchy, and history.

Checked final code: `7ec71c2cca2108423002be0e7330d2a20c4c5b67`. The branch includes upstream development commits through `366bdd58`, including the model-switch reasoning correction and shared-observation documentation. Later commits contain evidence and documentation only.

All execution occurred in an isolated Docker worker. The browser used a headed Browser Use session with CDP inspection against a managed, loopback-only Preview and a fresh temporary data home. Production was not changed, restarted, deployed, or used for migration. The original untracked directive and unrelated main-worktree changes were left untouched. Its body is preserved in the linked historical record; SHA-256: `747508fd324e56145a0b36406c11fdb952b021e8496bdab84e8b4796ac50766f`.

# Verification matrix

| Surface | Executed evidence | Result |
| --- | --- | --- |
| Clean compilation | `npm run clean && npm run build && npm run typecheck` at `14cbaf0f`; full build after upstream integration; all typechecks after the final Room-picker correction; final UI build/typecheck after the copy-only correction | Passed |
| Complete root regression suite | Final code `7ec71c2c`: 2,747 tests, 2,742 passed, zero failed, five skipped, exit 0 | Passed |
| Workflow package | `npm run workflows:test`; 144 tests, including actual agent routing, waits/actions, checkpoints, retries, nested graphs, snapshots, and runtime storage | Passed; package implementation unchanged after this run |
| Migration/storage/router/header matrix | 56 focused tests covering preservation, replay, archive recovery, canonical inspection, and Session metadata | Passed |
| UI source matrix | 62 focused retained-capability tests | Passed |
| Final Room-targeted manual API regression | `node --test --test-name-pattern="manual editor runs target" test/web-channel.test.mjs` | One passed |
| Final routed-runtime/manual/UI/header matrix | `node --test test/runtime-routed-session.test.mjs test/chat-ui-workflow-manual-trigger-dialog-accessibility.test.mjs test/workflow-manual-trigger-recovery.test.mjs test/workflow-session-header.test.mjs` | 20 passed |
| Standalone packaged installation | `npm pack --ignore-scripts`, then `npm install --omit=dev` into an empty directory, installed CLI version/help, Workflow store write/read/reopen | Passed |
| Headed desktop/mobile acceptance | Room workspace, ordinary conversation, Workflow creation/configuration, editor modification, real manual execution, canonical inspection, and responsive navigation | Passed within the detailed scope below |
| Final documentation/inventory gates | Strict/core/migration validation, generated indexes and log, 84 validator tests, five focused inventory/traceability tests | Passed |

The final complete-root command was `NODE_OPTIONS=--max-old-space-size=1024 node scripts/run-test-suite.mjs --test-concurrency=1 test/*.test.mjs test/chat-vscode/*.test.mjs`, with a 1,800-second internal timeout. It finished in approximately 1,066 seconds. Builds and heavy checks were serialized; the two-gigabyte worker limit was preserved.

The earlier concurrent final-code attempt recorded 2,741 passes, five skips, and one killed compatibility-compiler process. That compiler test passed when retried alone without new worker OOM events, then passed in the complete serial rerun. During the serial run, host I/O pressure terminated the lightweight yielded Docker-exec wrapper; the independently bounded worker process finished and wrote exit 0. The accepted totals come from its complete log and exit marker, not the failed wrapper status. No resource threshold was raised and no test was removed or skipped to obtain the result. The earlier `14cbaf0f` full-suite result remains separate historical evidence: 2,744 total, 2,739 passed, zero failed, five skipped.

Existing Vite large-chunk notices remain; this transition did not undertake unrelated bundle optimization.

# Acceptance against the directive

| Required outcome | Evidence and boundary |
| --- | --- |
| No retired navigation, routes, or dormant modules | Headed desktop/mobile inspection; `session-native-product-boundary.test.mjs`; negative API/route assertions in `web-channel.test.mjs` and `chat-ui-app-routes.test.mjs`. Legacy readers remain isolated to migration. |
| Fresh installation without retired persistence | Fresh isolated Chat data home; `app-context-fresh-schema.test.mjs`, `app-context-fresh-runtime-regression.test.mjs`; standalone installed Workflow store has no retired tables or database. |
| Existing work survives upgrade | `legacy-project-migration.test.mjs` uses canonical Session records and runtime bindings plus archived containers, hierarchy, snapshots, Runs, waits, actions, and catalog state. IDs, metadata, workspace, timestamps, and history remain available through ordinary navigation. |
| Recovery is visible and repeatable | Missing references, malformed JSON, conflicting targets, missing Workflow target, Pibo-only replay, catalog-only upgrades, interrupted base/WAL/SHM archival, and sidecar conflicts are tested. Both targets use FULL synchronization during migration; matching receipts and replay address partial outcomes. No cross-database power-loss atomicity is claimed. |
| Room workspace and ordinary execution | Edited the Room workspace through the UI, observed inheritance during Workflow Session creation, and executed real `pwd` in that workspace from both an ordinary conversation and an editor-created agent Session. |
| Editor and lifecycle capabilities remain | Existing catalog, draft, validation, immutable publishing, versioning, duplication, archive/tombstones, picker, asset, security, and inspection regression tests remain Session-native. Headed acceptance additionally created and edited a real draft with two connected nodes. |
| Workflows create normal Sessions | Session-native creation/start API tests and real manual editor execution. The runtime routes `kind: "chat"` Sessions with Workflow/run/node linkage. |
| Normal Session Workflow view | Opened the new agent Session from the normal sidebar, switched between Terminal and Workflow, and inspected completed canonical facts and output. Configured pending starts retain an explicit execution-limit explanation after reload. |
| One owner for Workflow facts | Canonical `SqliteWorkflowRunStore` inspection exposes executable snapshots, Runs, attempts, transfers, outputs, waits/actions, and lifecycle. Per-Session configuration snapshots remain separate from deduplicated executable snapshots. |
| Session operations need no retired service | Complete root coverage includes creation, messaging, event streaming, runtime actions, traces, previews, subagents, archive, deletion, and cleanup. The integration case named “session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete” retains these API capabilities. |
| Current terminology and historical isolation | Active-source/current-doc inventory gate; renamed authoritative specifications and glossary; the completed directive is historical, not an active feature plan. Generated upstream protocol vocabulary and narrow migration/negative tests are the only intentional code exceptions. |

# Headed browser and real execution

## Room and ordinary Session

The Room “Session-native QA” used `/tmp/pibo-session-native-workspace`. The New Workflow Session dialog inherited that workspace. A published `standard-workflow@1.0.0` Session was created and explicitly started; inspection showed a pending Run, not fabricated execution.

A real normal conversation in that Workflow-linked Session used the authenticated `openai-codex/gpt-5.6-sol` model to run `pwd`, returning `WORKFLOW_NATIVE_OK /tmp/pibo-session-native-workspace`. An earlier attempt selected placeholder OpenAI credentials and failed visibly; only isolated QA model settings were changed before the successful retry. No production credentials or configuration were modified.

## Editor and manual execution

The UI created a draft, added a manual trigger and an agent node, connected them, and saved Workflow text input/output settings. Validation rejected the incomplete graph before those settings were supplied. The Run Room picker displayed the ordinary Room and its workspace.

The real successful run returned:

```text
MANUAL_NATIVE_ROOM_OK /tmp/pibo-session-native-workspace
```

- Workflow: `ui-native-manual-qa-7664d056@0.1.0-draft`.
- Run: `wfr_ac3db39f-229f-4082-9485-4f6e6663a8b5`.
- Ordinary agent Session: `ps_04559a0b-fac4-4636-979a-addb1ff91fb0`.
- Canonical state: completed; two node attempts and one edge transfer.
- Executable snapshot: present and deduplicated independently of the Run ID.
- Actual output and lifecycle facts: available through Session Workflow inspection.

This acceptance found and corrected an editor path that had defaulted to the shared Room instead of carrying the intended Room workspace. A new API regression verifies Room targeting, missing-Room and relative-workspace rejection, ordinary Session routing, and canonical inspection. The final headed rerun verified the corrected workspace through actual execution.

## Layout and technical evidence

Desktop acceptance used 1,440 × 1,000; mobile used 390 × 844. Document width matched viewport width. The mobile manual dialog measured x=38, y≈208, width=299, height≈317 and fit within the viewport. The captured manual-run resource timing contained no failed HTTP responses. Browser Use performed the interaction; CDP supplied DOM, dimensions, API inspection, and network timing evidence. This is not a claim of a complete console/performance audit.

Published artifacts:

- [Desktop canonical inspection](/reports/artifacts/session-native-workflows-2026-09-05/desktop-inspection.png).
- [Desktop manual result](/reports/artifacts/session-native-workflows-2026-09-05/desktop-manual-result.png).
- [Mobile Room-targeted manual dialog](/reports/artifacts/session-native-workflows-2026-09-05/mobile-manual-dialog.png).
- [Bounded canonical and viewport facts](/reports/artifacts/session-native-workflows-2026-09-05/manual-run-evidence.json).
- [Validation results and log digests](/reports/artifacts/session-native-workflows-2026-09-05/validation-results.json).

Headed acceptance does not claim a raw-IR editing, publishing, human-action submission, job-control, or exhaustive graph-keyboard pass. Preserved lifecycle and human-action behavior is covered by automated API, source, and Workflow package tests.

The actual manual run executed at `dd795097`; the completed inspector was reopened at `7ec71c2c` after a copy-only UI correction. Runtime code was unchanged between these checkpoints.

# Standalone packaging

The package was installed with production dependencies into an empty directory outside the source workspace. It reported CLI version `1.7.2` and exposed installed debug help. The packaged `ChatWorkflowSessionService` opened the canonical SQLite store, wrote and read a Session link, closed, and reopened it successfully.

Assertions verified that the shipped Workflow runtime exists, testing-only package files and retired modules do not ship, no development `@pasko70/pibo-workflows` symlink is needed, and no retired database or tables are created. The tested artifact SHA-1 was `d432b5eaea9432a737ec886a031c0f300c33dc34`; integrity was `sha512-+4rVTlAN/P5t4WKmoCksd7Yx+FPnF/tFtdFPJzknGrI82Dm+qxi2fTGyIDFgP5BhW8JtGfMjbmiA27zohasSzg==`. This is package validation, not publication or deployment.

# Explicit execution limit

Creating/configuring a Workflow Session does not execute a graph. Its configured-start endpoint records an idempotent pending Run and says that general graph execution is not connected to this surface. Supported bounded manual triggers execute through the editor and write the same canonical facts. General executor integration remains a pre-existing roadmap gap; unsupported graph shapes continue to fail explicitly rather than manufacture execution state.
