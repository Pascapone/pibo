import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop workspace tabs expose New Tab catalog, ARIA tabs, keyboard and pointer reorder, resize, and collapse", async () => {
	const [source, styles] = await Promise.all([
		readFile("src/apps/chat-ui/src/desktop-tabs.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/styles.css", "utf8"),
	]);
	for (const contract of [
		'role="tablist"',
		'role="tab"',
		'role="tabpanel"',
		'aria-selected={selected}',
		'aria-controls={`desktop-tabpanel-${tab.id}`}',
		'role="separator"',
		'aria-valuenow={state.width}',
		'event.altKey && event.shiftKey',
		'event.key === "Delete"',
		'onDragStart=',
		'onDragLeave=',
		'onDrop=',
		'aria-label="New Tab"',
		'aria-label={`Refresh ${tab.title}`}',
		'aria-label="New Tab module catalog"',
		'data-pibo-debug="desktop-tab-drop-gap"',
		'aria-label="Collapse workspace tabs"',
		'aria-label="Reopen workspace tabs"',
	]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	for (const label of ["Workflows", "Cron", "Loops"]) {
		assert.match(source, new RegExp(`label: "${label}"`));
	}
	assert.match(source, /CORE_WORKSPACE_CATALOG\.map/);
	assert.match(source, /coreSessionToolCatalogEntry\("raw-events"/);
	assert.match(source, /coreSessionToolCatalogEntry\("session-inspector"/);
	assert.match(source, /pluginViews\.filter\(\(view\) => view\.chatRoutes\.length === 0\)/);
	assert.doesNotMatch(source, /label: "Preview"|label: "Web Annotations"|label: "Runtime Requests"/);
	assert.doesNotMatch(source, /label: "VS Code"|area: "vscode"/);
	assert.doesNotMatch(source, /aria-haspopup="menu"|role="menu"|pointerdown.*closeFromOutside/);
	assert.doesNotMatch(source, /event\.key === "Escape"/);
	const resizeHandler = source.slice(source.indexOf("const startResize"), source.indexOf("const shellStyle"));
	assert.match(resizeHandler, /resizeHandle\.setPointerCapture\(pointerId\)/, "resize keeps receiving pointer events over embedded iframes");
	assert.match(resizeHandler, /window\.addEventListener\("pointercancel", stop\)/, "cancelled pointer drags clean up resize state");
	assert.match(resizeHandler, /resizeHandle\.releasePointerCapture\(pointerId\)/, "resize releases pointer capture when dragging ends");
	assert.match(styles, /@keyframes desktop-tab-drop-gap-enter/);
	assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*desktop-tab-drop-gap/);
});

test("plugin controller save errors keep the mounted desktop panel available", async () => {
	const source = await readFile("src/apps/chat-ui/src/plugins/plugin-workspace.tsx", "utf8");
	const view = source.slice(source.indexOf("export function PluginWorkspaceView"), source.indexOf("export function PluginWorkspaceTabs"));
	assert.doesNotMatch(view, /workspace\.error \|\| workspace\.controller\.error/);
	assert.match(view, /workspace\.controller\.error \? <div role="alert"/);
	assert.match(view, /<PluginTabPanel workspace=\{workspace\} tab=\{current\}/);
});

test("App keeps the three-region desktop workspace and exposes narrow-screen header navigation", async () => {
	const [app, chrome, pane, desktopSidebar] = await Promise.all([
		readFile("src/apps/chat-ui/src/App.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/app-chrome.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/desktop-session-sidebar.tsx", "utf8"),
	]);
	assert.match(app, /const desktopTabsEnabled = !isMobileSidebarViewport/);
	assert.match(app, /<PluginWorkspaceProvider piboSessionId=\{selectedBackendPiboSessionId \?\? null\} controller=\{pluginSessionController\}/);
	assert.match(app, /<DesktopSessionSidebar/);
	assert.match(desktopSidebar, /data-pibo-debug="desktop-session-sidebar"/);
	assert.match(desktopSidebar, /aria-label="Resize Sessions sidebar"/);
	assert.match(desktopSidebar, /aria-label="Collapse Sessions sidebar"/);
	assert.match(desktopSidebar, /aria-label="Reopen Sessions sidebar"/);
	assert.match(app, /data-pibo-debug="desktop-session-center"/);
	assert.match(app, /className="min-h-0 min-w-\[250px\] flex-1 overflow-hidden"/);
	assert.match(app, /sessionViewId=\{sessionViewId\}[\s\S]*currentSessionView=\{currentSessionView\}[\s\S]*containerResponsive/);
	assert.match(app, /data-pibo-debug="desktop-route-shell"/);
	assert.match(app, /<DesktopTabSidebar/);
	assert.match(app, /renderPanel=\{\(tab, active\) => renderDesktopPanel\(tab, active\)\}/);
	assert.match(app, /<PluginWorkspaceView viewId=\{view\.viewId\}/);
	assert.match(app, /hidden=\{isAppFullscreen \|\| \(isMobileSidebarViewport && !mobileSidebarOpen\)\}/);
	assert.doesNotMatch(app, /aria-label="Workspace navigation"/);
	assert.doesNotMatch(app, /<PluginWorkspaceTabs/);
	assert.doesNotMatch(app, /Open plugin|Manage plugins|pluginPanelOpen/);
	assert.match(app, /<DesktopSessionSidebar[\s\S]*identity=\{identity\}/);
	assert.match(desktopSidebar, /data-pibo-debug="desktop-sidebar-app-header"/);
	assert.match(desktopSidebar, />Pibo Chat</);
	assert.match(desktopSidebar, /<AccountMenu identity=\{identity\}/);
	assert.match(chrome, /export function AccountMenu/);
	assert.match(chrome, /data-pibo-debug="account-avatar"/);
	assert.match(chrome, /title=\{identityLabel\}/);
	assert.match(chrome, /rounded-full/);
	assert.match(chrome, /aria-haspopup="menu"/);
	assert.match(chrome, /role="menu"/);
	assert.match(chrome, /role="menuitem"/);
	assert.match(chrome, /aria-label="Sign out"/);
	assert.match(chrome, /createPortal/);
	assert.match(chrome, /document\.addEventListener\("pointerdown", closeFromOutside\)/);
	assert.match(chrome, /event\.key !== "Escape"/);
	assert.doesNotMatch(app, /desktopTabMode=/);
	assert.doesNotMatch(chrome, /desktopTabMode/);
	assert.match(pane, /createPortal\(desktopToolPanels\[tool\]/);
	assert.doesNotMatch(pane, /desktopToolHosts\?\.\["web-annotations"\]|desktopRuntimeRequestsPanel/);
	assert.doesNotMatch(app, /sessionViewId="terminal"[\s\S]*desktopTerminalOnly/);
});
