# Sidebar browser tabs validation

## Scope

- Target branch/worktree: `sidebar-browser-tabs` at `/root/code/pibo/.worktrees/sidebar-browser-tabs`
- Reviewed base commit: `e8fbb185`
- Isolated correction worker: `pibo-dev-sidebar-browser-tabs-review-worker`
- Worker worktree: `/root/code/pibo/.worktrees/sidebar-browser-tabs-review-worker`
- Worker gateway: local auth on container ports `4788`/`4789`, exposed only through the worker
- The correction commit is fast-forwarded into the target worktree after all gates pass. No host gateway, deployment, push, or pull request is involved.

## Independent review corrections

1. Preview hosting now keeps the actual `SessionLivePreviewPanel` and iframe mounted in its hidden tab panel. VS Code is the only route surface with the same keep-alive policy.
2. Other inactive route and session-tool panels unmount. Inactive Projects therefore stops bootstrap queries and trace EventSource work; Project trace refresh callbacks are stable.
3. Session tools use the current selected Sessions URL. Closing an active route tab onto a session-tool neighbor also switches to that URL, so reload does not recreate the closed route tab.
4. The Web Annotations panel close button closes its owning desktop tab; the route/mobile panel still hides normally.
5. Leaving or closing Agent Designer awaits its registered autosave before state or URL changes. Save failure keeps the tab and route intact and exposes the error.
6. Terminal fullscreen hides both desktop side panes and lets the terminal center occupy the full viewport without destroying Preview/VS Code keep-alive content.
7. Storage parsing removes duplicate IDs and duplicate logical targets and remaps a duplicated active ID to the retained tab.
8. Catalog outside-click handling uses `contains` for both the catalog and the complete plus-button subtree.
9. Successful Delete/close focuses the deterministic right neighbor, then left neighbor, or catalog trigger when empty.

## Automated gates in the worker

`npm run chat-ui:typecheck` passed with the normal Node heap; no `NODE_OPTIONS` override was required.

`npm run chat-ui:build` passed with 2,945 modules transformed. Vite emitted only its existing large-chunk advisory.

The focused and relevant existing suite ran as one worker command:

```text
node --test \
  test/chat-ui-desktop-tabs-model.test.mjs \
  test/chat-ui-desktop-tabs-behavior.test.mjs \
  test/chat-ui-desktop-tabs-accessibility.test.mjs \
  test/chat-ui-app-routes.test.mjs \
  test/chat-ui-app-storage.test.mjs \
  test/chat-ui-main-navigation-current.test.mjs \
  test/chat-ui-mobile-main-navigation.test.mjs \
  test/chat-ui-mobile-sidebar-accessibility.test.mjs \
  test/chat-ui-sidebar-current-navigation.test.mjs \
  test/chat-ui-session-live-preview.test.mjs \
  test/chat-ui-raw-events.test.mjs \
  test/chat-ui-terminal-fullscreen.test.mjs \
  test/chat-ui-compact-sidebar-items.test.mjs \
  test/chat-ui-session-view-toggle-accessibility.test.mjs \
  test/chat-ui-session-overlay-cache.test.mjs \
  test/chat-ui-session-trace-toggle-accessibility.test.mjs \
  test/chat-ui-web-annotations-panel.test.mjs \
  test/chat-ui-project-bootstrap-request-gate.test.mjs \
  test/chat-ui-project-sidebar-navigation-pending.test.mjs \
  test/chat-ui-project-trace-selection.test.mjs \
  test/chat-ui-projects-bootstrap.test.mjs
```

Result: 36 tests passed, 0 failed. The new React behavior suite verifies Preview iframe identity, inactive resource unmount, post-Delete DOM focus, fullscreen keep-alive hiding, catalog containment, and hosted Annotations close. Controller/model tests verify URL/reload policy, autosave success/failure ordering, close-neighbor selection, reorder, persistence, route reconciliation, and duplicate recovery.

`git diff --check` also passed.

## Headful Browser Use

Chromium ran with `browser-use --headed` inside the worker. Every screenshot followed a Browser Use state/readiness check; the two content screenshots called out by the review show actual ready content rather than loading placeholders.

### Desktop 1440 × 900

- Projects was active and visibly ready with Project Manager, Projects, Project Sessions, and the project session terminal. `loadingProjects` was false.
- Fixed geometry: 300 px left Sessions navigation, 596 px central terminal, and persisted 544 px right tabs.
- Catalog inventory, multi-tab opening, horizontal overflow controls, Preview, Project, and VS Code tabs were exercised.
- Pointer DnD changed `[Project, Preview, Agent]` to `[Preview, Agent, Project]`.
- `Alt+Shift+ArrowLeft` changed `[Project, Agent, Preview]` to `[Project, Preview, Agent]` while retaining focus.
- Divider keyboard resize changed width from 520 to 544 px and persisted 544. Collapse and reopen restored the open state.

### Desktop 1920 × 1080

- Agent Designer was the active tab and visibly rendered its Identity and Runtime forms beside the unchanged terminal and fixed Sessions navigation.
- Delete on Preview selected and focused Agent Designer. A second scenario closed Agent Designer onto Preview: URL changed from `/apps/chat/agents` to the current Room/Session URL, focus moved to Preview, and reload preserved Preview without recreating Agent Designer.
- The visible Web Annotations close control removed the Annotations tab and activated its neighbor.
- Terminal fullscreen produced geometry `left=0 px`, `center=1920 px`, `right=0 px`; its screenshot contains only the terminal surface.
- VS Code deep linking opened the VS Code tab and its ready, actionable unconfigured state because this worker has no `PIBO_VSCODE_WEB_URL` service.
- Browser history Back focused the prior VS Code route tab; Forward restored `/apps/chat/agents` with Agent Designer active. The Sessions-URL fallback is covered separately by the close/reload flow above.

### Mobile 390 × 844

- Agent Designer rendered through the existing route shell with Identity and Runtime content; no desktop pane or ARIA tablist existed.
- The selected Session route rendered the existing mobile terminal/composer after `No visible trace rows yet.` became visible.
- Geometry audits show a 390 × 788 route shell below the 56 px mobile topbar and no desktop left/center/right shell nodes.

## Stable CDP idle monitor

With Project still open but inactive and Preview active, a fresh 12-second CDP monitor recorded:

- total requests: 6 (three health checks and three selected-session goal polls)
- Project/bootstrap requests: 0
- EventSource requests: 0
- aborted requests: 0
- pre-monitor request failures completed during the window: 0
- console/runtime/HTTP errors: 0

This replaces the reviewed run that showed repeated EventSource and Project-bootstrap cancellation churn.

## Artifacts

- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-projects.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-agent-designer.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-catalog.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-terminal-fullscreen.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-vscode.png`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-agent-designer.png`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-session.png`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1440-projects-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1920-agent-designer-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1920-terminal-fullscreen-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-agent-designer-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-session-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-console-network-stable.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-evidence.mjs`

## Remaining integration risk

The isolated worker has neither a configured live Preview target nor a VS Code Web service. A real remote Preview document and Monaco workbench could not be exercised end to end. Their hosting and lifecycle policies are covered by React iframe/component identity tests and their worker-side configured/unconfigured UI states. No implementation blocker remains.
