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
		'aria-label="New Tab module catalog"',
		'data-pibo-debug="desktop-tab-drop-gap"',
		'aria-label="Collapse workspace tabs"',
		'aria-label="Reopen workspace tabs"',
	]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	for (const label of ["Sessions", "Projects", "VS Code", "Workflows", "Cron", "Loops", "Agent Designer", "Context", "Settings", "Preview", "Raw Events", "Web Annotations", "Runtime Requests", "Session Inspector"]) {
		assert.match(source, new RegExp(`label: "${label}"`));
	}
	assert.doesNotMatch(source, /aria-haspopup="menu"|role="menu"|pointerdown.*closeFromOutside/);
	assert.doesNotMatch(source, /event\.key === "Escape"/);
	assert.match(styles, /@keyframes desktop-tab-drop-gap-enter/);
	assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*desktop-tab-drop-gap/);
});

test("App gates the new three-region shell to Desktop and keeps the route shell for Mobile", async () => {
	const [app, chrome, pane] = await Promise.all([
		readFile("src/apps/chat-ui/src/App.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/app-chrome.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8"),
	]);
	assert.match(app, /const desktopTabsEnabled = !isMobileSidebarViewport/);
	assert.match(app, /desktopTabsEnabled \? \(/);
	assert.match(app, /data-pibo-debug="desktop-session-sidebar"/);
	assert.match(app, /data-pibo-debug="desktop-session-sidebar"[^>]*className="[^"]*flex flex-col/);
	assert.match(app, /data-pibo-debug="desktop-session-center"/);
	assert.match(app, /data-pibo-debug="route-shell"/);
	assert.match(app, /desktopTabMode=\{desktopTabsEnabled\}/);
	assert.match(chrome, /desktopTabMode \? null : <nav aria-label="Main navigation"/);
	assert.match(pane, /createPortal\(desktopToolPanels\[tool\]/);
	assert.match(pane, /forcePanelVisible: Boolean\(desktopToolHosts\?\.\["web-annotations"\]\)/);
	assert.match(app, /sessionViewId="terminal"[\s\S]*currentSessionView=\{terminalSessionView\}[\s\S]*desktopTerminalOnly/);
});
