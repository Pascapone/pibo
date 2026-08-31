# Sidebar browser tabs: upstream integration validation

Date: 2026-08-31

## Candidate and rewrite

- Old feature head: `3514aa1ac88e1cdf5cbe52964bb64bb9c056bd23`
- Requested release-bound base: `upstream/dev` at `081fb2c22461d66eb9a6b74c1acb9c4b63fdc03d`
- Final current base: `upstream/dev` at `659c8d79918d74bebbb64e9d0abdb542795a90e7`
- Old merge base: `2aef244301f5d181624662fdad53e18e83e80bd9`
- Backup ref: `backup/sidebar-browser-tabs-pre-upstream-rebase-20260831`
- Isolated worker: `pibo-dev-sidebar-browser-tabs-upstream-integration`

The six feature commits rebased without textual conflicts. `git range-diff` marked every rebased feature patch equivalent (`=`):

| Old | Rebased | Subject |
| --- | --- | --- |
| `e8fbb185` | `fc0758b6` | feat(chat-web): add desktop browser tab workspace |
| `e95529b1` | `ee8a07c6` | fix(chat-web): harden desktop tab lifecycle |
| `c0fb8567` | `a15215d8` | fix(chat-ui): harden desktop preview and workflow tabs |
| `bded81e0` | `795ee2b8` | fix(chat-ui): close sidebar tab release gates |
| `6bf93ae6` | `80bb08e8` | test(chat-ui): force development React harness |
| `3514aa1a` | `c85fb7d3` | fix(chat-ui): preserve collapsed tabs on route reconcile |

The shared remote-tracking ref advanced during validation through PR #800 (`8e79e99c`, synchronous runtime child-output ordering). That update touches no Chat UI file. The completed seven-commit candidate was therefore rebased once more without conflicts. Its merge base is exactly `659c8d79`, and `git rev-list --left-right --count upstream/dev...HEAD` returned `0 7`.

## Semantic overlap review

The only feature-touched files also changed upstream were `App.tsx`, `session-trace-pane.tsx`, and `chat-ui-session-live-preview.test.mjs`. The current files retain upstream's selected-session signal/status lifecycle, pagehide/pageshow stream handling, Promise-based older-trace loading, scrollbar-drag deferral, touch ownership, reading-anchor persistence, and current Preview tests. The feature additions remain limited to the Desktop host/tab lifecycle; Mobile retains the route shell.

The broader current suite exposed two stale source-contract assumptions added upstream: one expected only the old route-only Agent Designer blocker, and one assumed a single Sessions sidebar. Their assertions now require both the Desktop active-tab guard and Mobile route guard, and exactly two Sessions-sidebar profile handlers while continuing to reject Agent Designer preference writes. Product code did not change for these findings.

## Automated gates

All final commands ran directly in the isolated worker with process status propagated.

- `npm run typecheck`: exit 0. The repository command used its standard `--max-old-space-size=1200`; no override was added.
- `npm run build`: exit 0. Chat UI transformed 2,948 modules; only the existing large-chunk advisory appeared.
- Focused/current integration command: `node --test --test-concurrency=1` over the prior 22 sidebar files plus `chat-ui-trace-infinite-scroll`, `sticky-virtuoso-state`, `use-sticky-virtuoso`, `session-ui-terminal-rows`, `chat-ui-integration`, and `chat-ui-live-overlay`: 28 files, 101 passed, 0 failed, exit 0.
- Agent integration regressions: `node --test --test-concurrency=1 test/chat-ui-agent-designer-autosave.test.mjs test/chat-ui-agent-designer-new-session-default.test.mjs`: 13 passed, 0 failed, exit 0.
- Broad current command: `node --test --test-concurrency=1` over all sorted `test/chat-ui-*.test.mjs`, `sticky-virtuoso-state.test.mjs`, `use-sticky-virtuoso.test.mjs`, and `session-ui-terminal-rows.test.mjs`: 121 files, 290 passed, 0 failed, exit 0.
- `git diff --check`: exit 0 after documentation and artifacts were staged.

An exploratory pre-build invocation correctly exited 1 because two dist-backed tests had no generated modules. It was not counted as a gate; the same unchanged focused command passed after `npm run build`.

## Headful Browser Use and CDP

Chromium ran headed inside the Docker worker. Screenshots followed ready-state assertions.

### Desktop 1440×900

- Fixed geometry was 300 px Sessions navigation, 620 px terminal center, and 520 px right workspace.
- Projects reached the ready `Project Manager` surface with `loadingProjects: false`; the center terminal and fixed Sessions sidebar stayed mounted.
- Artifact: [desktop-1440-projects.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1440-projects.png) and [desktop-1440-initial.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1440-initial.json).

### Desktop 1920×1080

- Fixed geometry was 300 px Sessions navigation, 1,100 px terminal center, and 520 px right workspace.
- Agent Designer was the active, ready panel rather than a Projects/loading placeholder.
- VS Code opened its configured-state fallback (`VS Code Web unavailable`) without replacing the session workspace.
- Keyboard reorder changed `Projects, Project, Agent Designer, VS Code` to `Projects, Project, VS Code, Agent Designer`. A subsequent HTML5 drag sequence moved VS Code to the first position.
- Keyboard resize changed width from 520 to 568 px. Collapse followed by a browser reload restored a 44 px DOM width and retained serialized `width: 568, collapsed: true`; explicit reopen restored the workspace.
- Closing VS Code removed it and activated a route neighbor. Browser Back moved from the workflow viewer to the Project tab; Forward restored `/apps/chat/workflows/view/wf%2Fdeep/v%207` and active `Workflow · wf/deep`.
- The workflow viewer rendered the decoded `wf/deep@v 7` selection and preserved the encoded URL even though this deterministic ID is absent from the local catalog.
- Terminal fullscreen set both fixed side panes `hidden`, expanded the center to 1,920 px, and restored the three-pane shell on exit.
- Preview was unconfigured in this worker. The Preview tab rendered the existing unconfigured state with zero iframes and no Preview-fullscreen control. Deterministic React tests cover iframe identity and selected-Preview loss recovery.
- Artifacts: [desktop-1920-agent-designer.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1920-agent-designer.png), [desktop-1920-agent-designer.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1920-agent-designer.json), and [desktop-1920-workflow-version.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1920-workflow-version.png).

### Terminal scrolling

The local debug fixture seeded 2,300 terminal events. After three PageUp actions, the view was detached with `bottomGap: 2218` and `Scroll to latest` visible. While 40 new deltas streamed, `scrollHeight` grew from 186,291 to 186,400 px. The same first visible row stayed at `top: -42.59375`, `scrollTop` stayed 183,234, and detached state remained true: measured anchor drift was 0 px.

Artifacts: [terminal-scroll-before.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/terminal-scroll-before.json), [terminal-scroll-after.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/terminal-scroll-after.json), and [desktop-1920-terminal-scroll.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-1920-terminal-scroll.png).

The full `validate-terminal-browser-regressions.mjs` harness was not counted as passing: before deterministic seeding it found no terminal scroller, and the local fixture exposed no `hasOlder` pagination cursor even after a 2,000-message prelude. The current terminal model/component/integration tests and the detached-streaming browser measurement above are the local evidence for this integration.

### Mobile 390×844

- The normal session URL rendered `route-shell`, composer, and the existing navigation menu. No Desktop sidebar or `Workspace tabs` tablist existed.
- The mobile workflow deep link rendered `mobile-workflow-version-viewer` at the exact encoded URL, again without Desktop shell/tablist.
- Artifacts: [mobile-390-session.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/mobile-390-session.png), [mobile-390-state.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/mobile-390-state.json), and [mobile-390-workflow-version.png](artifacts/sidebar-browser-tabs-upstream-2026-08-31/mobile-390-workflow-version.png).

### Idle monitor

The stable 12-second Desktop monitor recorded 4 requests, 0 Project requests, 0 EventSource requests, 0 aborted requests, 0 pre-existing failures, and 0 console/HTTP errors. Artifact: [desktop-idle-cdp.json](artifacts/sidebar-browser-tabs-upstream-2026-08-31/desktop-idle-cdp.json).

## Remaining release risk

Exact Pibo2 acceptance has not been rerun on this rebased candidate. It must be rerun before a PR. The local Preview environment was unconfigured, so real Preview iframe/fullscreen lifecycle evidence remains the deterministic React coverage plus the prior historical acceptance, not a fresh 2026-08-31 live Preview run.
