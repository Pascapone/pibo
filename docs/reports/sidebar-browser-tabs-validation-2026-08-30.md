# Sidebar browser tabs validation

## Scope

- Target branch/worktree: `sidebar-browser-tabs` at `/root/code/pibo/.worktrees/sidebar-browser-tabs`
- Reviewed base commit: `e8fbb185`
- Final-hardening base commit: `e95529b144f3ec3442635784714f58444b294455`
- Isolated correction worker: `pibo-dev-sidebar-browser-tabs-review-worker`
- Worker worktree: `/root/code/pibo/.worktrees/sidebar-browser-tabs-review-worker`
- Final-hardening worker: `pibo-dev-sidebar-browser-tabs-final-hardening-worker`
- Final-hardening worker worktree: `/root/code/pibo/.worktrees/sidebar-browser-tabs-final-hardening-worker`
- Release-gate base commit: `c0fb8567c232c5549b2ee94762310f40ab206632`
- Release-gate worker: `pibo-dev-sidebar-browser-tabs-release-gate-worker`
- Release-gate worker worktree: `/root/code/pibo/.worktrees/sidebar-browser-tabs-release-gate-worker`
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

## Final independent review hardening

1. Both React behavior files keep `create` from the callable default React Test Renderer export. Their spawned React child processes explicitly preserve the parent environment while overriding `NODE_ENV=development`, then use React's recommended `act` export from that development entry. Assertions were retained and expanded.
2. Desktop Preview fullscreen is a dedicated shell state. It expands the active Preview tab to the viewport, renders Preview controls, keeps Terminal fullscreen false, and retains the exact hosted iframe across enter and exit. The normal toolbar still omits or disables fullscreen according to the existing selected/online Preview semantics.
3. Workflow-version navigation now serializes `/workflows/view/$workflowId/$workflowVersion`, stores both fields in the route tab, and renders `WorkflowVersionViewer` through the Desktop host. Route, model, persistence, history, reload, and render tests cover the full parameter round-trip.

## Release-gate corrections

1. `test/chat-ui-desktop-tabs-behavior.test.mjs` and `test/chat-ui-session-live-preview.test.mjs` explicitly run every spawned child with `{ ...process.env, NODE_ENV: "development" }` and import `act` from React in the child behavior scripts. This avoids the controller's ambient production React entry, where `React.act` is absent, without changing assertions. Each exact file passes independently with a production parent environment on the controller and in Docker.
2. Preview-fullscreen recovery runs at both the Preview panel and the `SessionTracePane` host boundary. If remove, query refresh, or authority loss replaces the panel with an empty state, the host exits Preview fullscreen and restores Desktop chrome and tabs. A selected Preview still retains the same iframe through ordinary updates and fullscreen transitions.
3. Desktop and Mobile share the workflow route-selection renderer. Mobile version routes render `WorkflowVersionViewer`; ordinary workflow and draft routes still receive the unchanged `MinimalWorkflowsArea` fallback.

## Automated gates in the worker

`npm run typecheck` passed with the repository-standard `--max-old-space-size=1200` TypeScript heap; no `NODE_OPTIONS` override was required.

`npm run build` passed with the repository-standard `--max-old-space-size=1200` TypeScript heap. The explicit final `npm run chat-ui:build` rerun transformed 2,946 modules and emitted only Vite's existing large-chunk advisory.

The focused and relevant existing suite ran as one worker command:

```text
node --test \
  test/chat-ui-desktop-tabs-model.test.mjs \
  test/chat-ui-desktop-tabs-behavior.test.mjs \
  test/chat-ui-desktop-tabs-accessibility.test.mjs \
  test/chat-ui-desktop-workflow-viewer.test.mjs \
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

Result: 38 tests passed, 0 failed, process exit 0 in Docker. The same 22-file command also passed on the controller with a production parent environment: 38 passed, 0 failed, exit 0. The React behavior suite verifies Preview iframe identity, inactive resource unmount, post-Delete DOM focus, fullscreen keep-alive hiding and loss recovery, catalog containment, and hosted Annotations close. Controller/model tests verify URL/reload policy, autosave success/failure ordering, close-neighbor selection, reorder, persistence, route reconciliation, duplicate recovery, and Desktop/Mobile workflow-version rendering.

The expanded relevant suite covers 22 files. The prior release-gate review correctly found 35 passes and 2 harness failures at `c0fb8567`; the result above is a fresh direct worker invocation on this correction batch, not redirected shell output.

The exact focused files also ran independently:

- Controller `NODE_ENV=production node --test test/chat-ui-desktop-tabs-behavior.test.mjs`: 1 passed, 0 failed, exit 0.
- Controller `NODE_ENV=production node --test test/chat-ui-session-live-preview.test.mjs`: 5 passed, 0 failed, exit 0.
- Docker versions of the same separate production-parent commands: 1/1 and 5/5 passed, each exit 0.

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

The final 12-second monitor on the headful exact candidate recorded 10 requests, 0 Project/bootstrap requests, 0 EventSource requests, 0 aborted requests, 0 HTTP/console/runtime errors, and 0 failures completed from before the monitor. The requests were bounded selected-session goal, Preview-authority, and gateway-health polls. CDP replayed one pre-monitor Chromium sandbox warning produced by the earlier local HTTP Preview authentication attempt; the artifact separates it as `preexistingLogEventCount: 1`, and no new warning occurred during the measured window.

## Final headful regression evidence

- **1440×900 Desktop Preview:** a real worker Preview registration made the Preview control available. Because Chromium's local HTTP subdomain exchange does not retain the production Preview cookie inside this test iframe, the document response was deterministically replaced in-browser after registration with the visible `PREVIEW FULLSCREEN READY` fixture. Browser Use then asserted the ready text before capture. Fullscreen measured `sameFrame=true`, `previewFullscreen=true`, `terminalFullscreen=false`, right width 1,440 px, and iframe height 868 px beneath the 32 px Preview bar. Exit restored the normal shell with the same iframe and visible Enter control.
- **1920×1080 workflow deep link:** `/apps/chat/workflows/view/simple-chat/1.0.0` rendered the real built-in Simple Chat version viewer beside the fixed Sessions/Terminal workspace. Opening Settings then Browser Back restored the exact URL, active `Workflow · simple-chat` tab, and viewer. Reload preserved all three again.
- **390×844 Mobile:** the selected Session reached `No visible trace rows yet.` before capture. The route shell and mobile menu/composer were present; Desktop shell and workspace tablist were absent.

## Release-gate headful evidence

- **1440×900 Desktop Preview loss:** a real worker Preview registration was selected before entering Preview fullscreen. Removing that registration through the worker CLI let the live five-second query refresh produce the real empty authority state. The app then reported `previewFullscreen=false` and `terminalFullscreen=false`; left Sessions, center terminal, and right tabs returned at 300/620/520 px. The active Preview tab showed the normal empty state and no exit control remained.
- **390×844 Mobile workflow version:** `/apps/chat/workflows/view/simple-chat/1.0.0` reached the visible `Selected workflow` ready state. The page contained `data-pibo-debug="mobile-workflow-version-viewer"`, the Mobile route shell, `simple-chat`, and `1.0.0`; no Desktop shell or ARIA workspace tablist existed.
- A five-second CDP monitor on the final Mobile candidate recorded 1 request, 0 Project requests, 0 EventSource requests, 0 aborts, 0 pre-existing failures or warnings, and 0 console/HTTP/runtime errors.

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
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-preview-ready-final.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-preview-fullscreen-final.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-workflow-version-final.png`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-session-final.png`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1920-workflow-version-final.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-session-final.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-console-network-final.json`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-preview-before-loss-release-gate.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-preview-loss-exit-release-gate.png`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1440-preview-loss-exit-release-gate.json`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-workflow-version-release-gate.png`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-workflow-version-release-gate.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-console-network-release-gate.json`

## Remaining integration risk

The isolated worker still has no VS Code Web service. A real HTTPS/wildcard-host Preview authentication exchange was not available. The release-gate loss scenario used a real worker registration and authority refresh, but production iframe cookie/proxy authentication remains an integration risk. Fullscreen shell ownership, loss recovery, and iframe lifecycle are covered behaviorally and headfully. No implementation blocker remains.
