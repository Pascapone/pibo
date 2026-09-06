import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

async function runSessionViewToggleAccessibilityScenario() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SessionTraceHeader } from "./src/apps/chat-ui/src/session-trace-header.tsx";

		globalThis.React = React;

		const sessionViews = [
			{ id: "terminal", label: "Terminal", description: "Terminal view" },
			{ id: "workflow", label: "Workflow", description: "Workflow view" },
		];

		function render(overrides = {}) {
			return renderToStaticMarkup(React.createElement(SessionTraceHeader, {
				title: "Session",
				contextKind: "room",
				contextLabel: "Pibo Core",
				headerPiboSessionId: "ps-test",
				piboSessionId: null,
				webAnnotationsDisabled: true,
				webAnnotationsPanelRendered: false,
				workflowHeader: null,
				sessionViewId: "terminal",
				sessionViews,
				currentSessionView: sessionViews[0],
				debugMode: false,
				showThinking: false,
				expandThinking: false,
				toolDisplayMode: "default",
				toolIntentSupported: false,
				onShowWebAnnotationsPanel() {},
				onHideWebAnnotationsPanel() {},
				onSelectSessionView() {},
				onToggleDebugMode() {},
				onToggleThinking() {},
				onToggleExpandThinking() {},
				onToolDisplayModeChange() {},
				onError() {},
				...overrides,
			}));
		}

		function buttonOpeningTag(markup, accessibleName) {
			const marker = \`aria-label="\${accessibleName}"\`;
			const markerIndex = markup.indexOf(marker);
			assert.notEqual(markerIndex, -1, \`missing button named \${accessibleName}\`);
			const start = markup.lastIndexOf("<button", markerIndex);
			const end = markup.indexOf(">", markerIndex);
			assert.notEqual(start, -1);
			assert.notEqual(end, -1);
			return markup.slice(start, end + 1);
		}

		const normal = render();
		assert.match(normal, /data-pibo-context-kind="room"/);
		assert.match(normal, />Room</);
		assert.match(normal, />Pibo Core</);
		assert.doesNotMatch(normal, /aria-label="Session views"|Switch to .* view|aria-label="Raw Events"/);
		assert.match(normal, /aria-label="Tool display mode"/);
		assert.match(normal, /<option value="intent" disabled="">Tools: Intent/);
		assert.match(buttonOpeningTag(normal, "Debug"), /aria-pressed="false"/);
		assert.equal(normal.includes('aria-label="Enter Terminal fullscreen"'), false);
		assert.equal(normal.includes('aria-label="Open selected session in new window"'), false);

		const intentAvailable = render({ toolDisplayMode: "intent", toolIntentSupported: true });
		assert.match(intentAvailable, /<option value="intent" selected="">Tools: Intent/);
		assert.doesNotMatch(intentAvailable, /<option value="intent" disabled=""/);

		const pwaWindowAvailable = render({ onOpenSessionWindow() {} });
		assert.match(buttonOpeningTag(pwaWindowAvailable, "Open selected session in new window"), /data-pibo-debug="open-session-window"/);

		const fullscreenAvailable = render({ terminalFullscreenAvailable: true, onEnterTerminalFullscreen() {} });
		assert.match(buttonOpeningTag(fullscreenAvailable, "Enter Terminal fullscreen"), /title="Enter Terminal fullscreen"/);

		const desktopTerminal = render({ desktopTerminalOnly: true, terminalFullscreenAvailable: true, onEnterTerminalFullscreen() {} });
		assert.doesNotMatch(desktopTerminal, /aria-label="Session views"/);
		assert.doesNotMatch(desktopTerminal, /Switch to Terminal view|Switch to Workflow view/);
		assert.doesNotMatch(desktopTerminal, /aria-label="Raw Events"/);
		assert.doesNotMatch(desktopTerminal, /Web annotations/);
		assert.match(desktopTerminal, /aria-label="Tool display mode"/);
		assert.match(desktopTerminal, /aria-label="Thinking"/);
		assert.match(desktopTerminal, /aria-label="Enter Terminal fullscreen"/);
		assert.match(buttonOpeningTag(desktopTerminal, "Debug"), /aria-pressed="false"/);
		assert.match(buttonOpeningTag(render({ debugMode: true }), "Debug"), /aria-pressed="true"/);

		const extra = render({
			activeViewId: "workflow-run",
			extraViewTabs: [
				{ id: "workflow-overview", label: "Overview", active: true, onSelect() {} },
				{ id: "workflow-run", label: "Run", active: false, onSelect() {} },
				{ id: "preview", label: "Preview", onSelect() {} },
			],
		});
		assert.doesNotMatch(extra, /aria-label="Session views"|Switch to .* view/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("topbar exposes Debug without duplicate view navigation or Raw Events", async () => {
	await assert.doesNotReject(runSessionViewToggleAccessibilityScenario());
});

test("normal desktop and mobile Session surfaces retain Terminal and Workflow views", async () => {
	const app = await readFile(new URL("../src/apps/chat-ui/src/App.tsx", import.meta.url), "utf8");
	const pane = await readFile(new URL("../src/apps/chat-ui/src/session-trace-pane.tsx", import.meta.url), "utf8");
	assert.doesNotMatch(app, /desktopTerminalOnly/);
	assert.match(app, /sessionViewId=\{sessionViewId\}[\s\S]*currentSessionView=\{currentSessionView\}/);
	assert.match(pane, /workflowSessionLinked,/);
	assert.doesNotMatch(pane, /combinedExtraViewTabs|onSelectSessionView/);
});
