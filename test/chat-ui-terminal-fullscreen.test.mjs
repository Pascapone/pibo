import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderTerminalFullscreenScenario() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { TerminalFullscreenTopBar } from "./src/apps/chat-ui/src/terminal-fullscreen-top-bar.tsx";

		globalThis.React = React;
		const noop = () => {};

		const topBar = renderToStaticMarkup(React.createElement(TerminalFullscreenTopBar, {
			title: "Readable session name",
			contextKind: "project",
			contextLabel: "Pibo Core",
			onOpenSessionWindow: noop,
			onExit: noop,
		}));
		assert.match(topBar, /data-pibo-debug="terminal-fullscreen-top-bar"/);
		assert.match(topBar, /data-pibo-debug="session-context"/);
		assert.match(topBar, /data-pibo-context-kind="project"/);
		assert.match(topBar, />Project</);
		assert.match(topBar, />Pibo Core</);
		assert.match(topBar, />Readable session name</);
		assert.match(topBar, /h-7 min-h-7/);
		assert.match(topBar, /border-b border-slate-600/);
		assert.match(topBar, /text-base font-semibold/);
		assert.match(topBar, /aria-label="Open selected session in new window"/);
		assert.match(topBar, /data-pibo-debug="open-session-window"/);
		assert.match(topBar, /aria-label="Exit Terminal fullscreen"/);
		assert.match(topBar, /title="Show normal top bar"/);
		assert.ok(topBar.indexOf('aria-label="Open selected session in new window"') < topBar.indexOf('aria-label="Exit Terminal fullscreen"'));
		assert.equal(topBar.includes("border-l"), false);
		const topBarOpeningTag = topBar.slice(0, topBar.indexOf(">") + 1);
		assert.equal(/(?:class="[^"]*\s|class=")(?:p|m)[trblxy]?-/.test(topBarOpeningTag), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Terminal fullscreen keeps the project or room context beside the session name", async () => {
	await assert.doesNotReject(renderTerminalFullscreenScenario());
});

test("app chrome, sidebars, raw events, and terminal metadata are gated by Terminal fullscreen", () => {
	const appSource = fs.readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	const layoutSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
	const paneSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	const projectsSource = fs.readFileSync("src/apps/chat-ui/src/projects/ProjectsArea.tsx", "utf8");
	const terminalSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");

	assert.match(appSource, /data-pibo-terminal-fullscreen=\{isTerminalFullscreen \? "true" : "false"\}/);
	assert.match(appSource, /\{isTerminalFullscreen \? null : \(\s*<AppHeader/);
	assert.match(appSource, /isTerminalFullscreen \? "hidden" : mobileSidebarOpen/);
	assert.match(layoutSource, /visible=\{showRawEvents && !terminalFullscreen\}/);
	assert.match(layoutSource, /!terminalFullscreen && webAnnotationsPanelRendered/);
	assert.match(layoutSource, /contextKind=\{headerProps\.contextKind\}/);
	assert.match(layoutSource, /contextLabel=\{headerProps\.contextLabel\}/);
	assert.match(paneSource, /contextKind = "room"/);
	assert.match(paneSource, /fallback: "No session selected"/);
	assert.match(paneSource, /bootstrap\.room\?\.id === selectedRoomId/);
	assert.match(projectsSource, /\{terminalFullscreen \? null : \(\s*<>\s*<div\s*data-pibo-mobile-sidebar-backdrop/);
	assert.match(projectsSource, /contextKind="project"/);
	assert.match(projectsSource, /contextLabel=\{selectedProjectDisplayName\}/);
	assert.match(projectsSource, /sessionNavigationPending=\{traceSelection\.navigationPending\}/);
	assert.match(terminalSource, /\{terminalFullscreen \? null : \(\s*<TerminalHeader/);
	assert.match(terminalSource, /data-pibo-terminal-fullscreen=\{terminalFullscreen \? "true" : "false"\}/);
});
