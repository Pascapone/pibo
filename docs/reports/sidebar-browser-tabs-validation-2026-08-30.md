# Sidebar browser tabs validation

## Scope

- Branch: `sidebar-browser-tabs`
- Baseline: `upstream/dev` at `2aef244301f5d181624662fdad53e18e83e80bd9`
- Worktree: `/root/code/pibo/.worktrees/sidebar-browser-tabs`
- Isolated worker: `pibo-dev-sidebar-browser-tabs`
- Worker Chat Web: port `4882` on the host, local-auth gateway port `4788` inside the worker
- No host gateway, deployment, remote branch, or pull request was changed.

## Automated gates

The final focused test command was:

```text
node --test \
  test/chat-ui-desktop-tabs-model.test.mjs \
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
  test/chat-ui-session-trace-toggle-accessibility.test.mjs
```

Result: 27 tests passed, 0 failed. The model coverage includes singleton/resource deduplication, close-neighbor focus, reorder, width bounds, versioned persistence recovery, and route reconciliation. The source/component coverage includes ARIA tabs, Escape, keyboard reorder, drag affordances, resizing, collapse, and the Desktop/Mobile gate.

Additional gates:

- `npm run chat-ui:typecheck`: passed.
- `npm run chat-ui:build`: passed; 2,945 modules transformed. Vite emitted only the existing large-chunk advisory.
- `git diff --check`: passed.

## Headful Browser Use acceptance

The final visual acceptance used worker Chromium under Xvfb with `browser-use --headed`. Process inspection confirmed that Chromium did not have a `--headless` argument.

### Desktop 1440 × 900

- Fixed 300 px Rooms/Sessions navigation remained at the left.
- The selected session Terminal stayed mounted in the center while Projects, Settings, Agent Designer, Preview, Raw Events, and VS Code tabs were activated at the right.
- The right sidebar restored its persisted 648 px width and tab order after reload.
- The catalog exposed Sessions, Projects, VS Code, Workflows, Cron, Loops, Agent Designer, Context, Settings, Preview, Raw Events, Web Annotations, Runtime Requests, and Session Inspector.
- Sessions focused the fixed navigation and did not create a duplicate tab.
- Projects produced both the singleton destination and a resource-identified project tab.
- Pointer drag reordered tabs. `Alt+Shift+ArrowLeft/Right` provided the keyboard reorder alternative.
- Delete/close selected the right neighbor before the left neighbor; overflow scroll controls, tooltip titles, focus rings, collapse/reopen, keyboard resize, and pointer resize were exercised.
- Direct Settings and Agent Designer links opened/focused right tabs without replacing the session workspace. Reload, Back, and Forward restored/focused the appropriate tabs.
- Preview opened its existing not-configured state in this worker. VS Code remained discoverable and opened its existing actionable `PIBO_VSCODE_WEB_URL` configuration state because the worker has no code-server integration.

### Desktop 1920 × 1080

- Geometry was 300 px left navigation, 972 px terminal center, and 648 px right tabs.
- Agent Designer loaded as a functional right tab while the selected session and terminal remained visible.
- Persisted tab order, active route reconciliation, and sidebar width matched the 1440 px run.

### Mobile 390 × 844

- The Desktop session sidebar, terminal-center shell, and workspace tabs were absent.
- The existing route shell occupied the full 390 × 788 px area below the 56 px topbar.
- Agent Designer rendered through the old route-owned layout.
- The existing topbar navigation menu opened with all prior mobile destinations and navigated back to the selected Session route.

## CDP evidence

CDP geometry audits are stored beside the screenshots. A 12-second console/network monitor recorded no runtime exceptions, console warnings/errors, HTTP errors, or non-cancelled network failures. It recorded 38 requests with `canceled: true`; these were expected React cleanup/navigation cancellations for mounted project bootstrap queries, session EventSource streams, fork candidates, and health probes.

## Artifacts

- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-catalog.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-projects.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1440-vscode-unconfigured.png`
- `docs/reports/artifacts/sidebar-browser-tabs/desktop-1920-agent-designer.png`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-agents.png`
- `docs/reports/artifacts/sidebar-browser-tabs/mobile-390-session.png`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1440-projects-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-1920-agent-designer-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-agent-designer-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/audit-390-session-headed.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-console-network-stable.json`
- `docs/reports/artifacts/sidebar-browser-tabs/cdp-evidence.mjs`

## Remaining integration risk

The isolated worker has neither a configured Preview server nor a VS Code Web service. Their tab hosting, mounted lifecycle, catalog access, routing, and existing unavailable/configuration states were verified, but a live Preview lease and a live Monaco workbench could not be exercised in this environment. No implementation blocker remains.
