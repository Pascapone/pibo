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
