---
type: "Historical Record"
title: "Sidebar browser tabs implementation tasks"
description: "Historical task ledger from the completed sidebar browser-tabs change packet."
tags: ["sidebar-browser-tabs", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "openai/codex"
  at: "2026-09-02T05:59:53Z"
---

# Implementation tasks

- [x] Start `sidebar-browser-tabs` from current `upstream/dev` and spawn the isolated compute worker.
- [x] Read `AGENTS.md`, `GLOSSARY.md`, `DESIGN.md`, and applicable skills.
- [x] Inventory routes, topbar destinations, and session-related panels.
- [x] Specify Desktop/Mobile split, tab identity, routing, persistence, accessibility, and acceptance.
- [x] Implement and test the pure tab model and versioned persistence.
- [x] Implement route reconciliation and Desktop/Mobile gating.
- [x] Implement fixed Desktop Sessions sidebar and terminal center.
- [x] Implement right tab strip, catalog, overflow, close, pointer/keyboard reorder, collapse, and resize.
- [x] Keep route-tab contents mounted; preserve Preview and VS Code frames.
- [x] Host Preview, Raw Events, Web Annotations, Runtime Requests, and Session Inspector in session tool tabs.
- [x] Remove Desktop area navigation from the topbar while retaining Mobile menus.
- [x] Run focused and existing tests, Chat UI typecheck, and Chat UI build.
- [x] Validate headfully at 1440×900, 1920×1080, and 390×844; capture CDP console/network evidence.
- [x] Save screenshots and validation report under `docs/reports/`.
- [x] Commit the focused local branch after all gates pass.

## Independent review corrections

- [x] Preserve the actual Preview iframe and VS Code content while inactive.
- [x] Unmount inactive Project/Area/session-tool resources and stabilize Project trace refresh callbacks.
- [x] Synchronize session-tool activation and route-close fallback to the current Sessions URL.
- [x] Wire Web Annotations panel close to the owning desktop tab.
- [x] Guard Agent Designer leave/close with awaited autosave and failure cancellation.
- [x] Restore Terminal fullscreen side-pane hiding without destroying keep-alive content.
- [x] Deduplicate persisted IDs and logical targets during recovery.
- [x] Fix catalog trigger child containment and deterministic post-close DOM focus.
- [x] Add behavioral model/controller/React regression tests for the review findings.
- [x] Run final typecheck, build, focused and existing tests.
- [x] Repeat ready-gated headful Browser Use and stable-idle CDP validation.
- [x] Update the validation report.
- [x] Commit the focused review corrections and fast-forward the target worktree.

## Final independent review hardening

- [x] Make the desktop React behavior test portable across controller and worker React Test Renderer exports without weakening assertions.
- [x] Give Desktop Preview its own fullscreen shell mode while preserving the hosted iframe instance and leaving Terminal fullscreen false.
- [x] Preserve and render workflow-version route parameters through navigation, tab activation, history, persistence, and reload.
- [x] Add route, model, render, and Preview fullscreen lifecycle regressions.
- [x] Re-run full typecheck/build, the relevant 37-test suite, controller-focused behavior test, and `git diff --check`.
- [x] Repeat headful 1440×900 Preview, 1920×1080 workflow-version, and 390×844 Mobile validation plus stable CDP monitoring.
- [x] Update final validation artifacts and report, then prepare the focused commit for fast-forward into the target worktree.

## Release-gate corrections

- [x] Replace both incompatible React Test Renderer `act` lookups with the verified controller-compatible `react-dom/test-utils.act` implementation.
- [x] Add deterministic Preview-loss behavior coverage and automatically restore the Desktop shell from Preview fullscreen.
- [x] Render workflow-version deep links through the existing viewer on Mobile while retaining the ordinary workflow/draft fallback.
- [x] Add focused Desktop/Mobile workflow route-render coverage.
- [x] Run typecheck, build, Chat UI build, the complete relevant suite, and both exact tests sequentially with direct exit statuses.
- [x] Validate Desktop Preview loss/exit and the Mobile workflow-version deep link in a headful browser.
- [x] Update the validation evidence and prepare the release-gate batch for commit and fast-forward into `sidebar-browser-tabs`.

## Upstream integration — 2026-08-31

- [x] Preserve the old exact feature head under a local backup ref.
- [x] Rebase all six feature commits onto release-bound `upstream/dev` and verify patch equivalence with `git range-diff`.
- [x] Inspect the three overlapping paths and retain current terminal-scroll, signal/session lifecycle, route, auth, and Mobile behavior.
- [x] Update two upstream source-contract tests for the combined Desktop/Mobile Agent Designer and Sessions-sidebar structure without weakening their semantic assertions.
- [x] Run the 28-file focused/current suite, all 121 current Chat UI/Terminal test files, full typecheck, full build, and `git diff --check`.
- [x] Validate Desktop at 1440×900 and 1920×1080, Mobile at exactly 390×844, and detached terminal scrolling with deterministic worker fixtures.
- [x] Capture current screenshots, geometry, storage, history, and idle CDP evidence in a new 2026-08-31 artifact directory.
- [ ] Re-run exact Pibo2 acceptance on the rebased candidate before opening a PR; this local integration package does not claim that external gate.

## Maintainer screenshot follow-up — 2026-08-31

- [x] Diagnose and restore the existing Desktop SessionSidebar height/data contract without changing Mobile.
- [x] Replace the `+` popover with persisted, multiple-instance New Tabs and in-panel catalog replacement.
- [x] Add pointer before/after insertion state, animated gap, cancellation cleanup, and reduced-motion behavior.
- [x] Make the fixed Desktop center Terminal-only and hide only its obsolete Workflow/Raw/Annotations controls.
- [x] Add model, React, render, style, sidebar-wiring, and Desktop/Mobile toolbar regressions.
- [x] Run full Chat UI/Terminal, typecheck, build, and diff gates in the isolated worker.
- [x] Validate headed Desktop 1440×900/1920×1080 and Mobile 390×844 with ready-state/CDP evidence.
- [x] Record current follow-up evidence and safely advance the authoritative local branch.
