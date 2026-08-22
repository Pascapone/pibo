import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

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
				roomLabel: "Room",
				headerPiboSessionId: "ps-test",
				piboSessionId: null,
				webAnnotationsDisabled: true,
				webAnnotationsPanelRendered: false,
				workflowHeader: null,
				sessionViewId: "terminal",
				sessionViews,
				currentSessionView: sessionViews[0],
				showRawEvents: false,
				showThinking: false,
				expandThinking: false,
				toolDisplayMode: "default",
				toolIntentSupported: false,
				onShowWebAnnotationsPanel() {},
				onHideWebAnnotationsPanel() {},
				onSelectSessionView() {},
				onToggleRawEvents() {},
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
		assert.match(normal, /role="group" aria-label="Session views"/);
		assert.match(normal, /aria-label="Tool display mode"/);
		assert.match(normal, /<option value="intent" disabled="">Tools: Intent/);
		assert.match(buttonOpeningTag(normal, "Switch to Terminal view"), /aria-pressed="true"/);
		assert.match(buttonOpeningTag(normal, "Switch to Workflow view"), /aria-pressed="false"/);
		assert.equal(normal.includes('aria-label="Enter Terminal fullscreen"'), false);
		assert.equal(normal.includes('aria-label="Open selected session in new window"'), false);

		const intentAvailable = render({ toolDisplayMode: "intent", toolIntentSupported: true });
		assert.match(intentAvailable, /<option value="intent" selected="">Tools: Intent/);
		assert.doesNotMatch(intentAvailable, /<option value="intent" disabled=""/);

		const pwaWindowAvailable = render({ onOpenSessionWindow() {} });
		assert.match(buttonOpeningTag(pwaWindowAvailable, "Open selected session in new window"), /data-pibo-debug="open-session-window"/);

		const fullscreenAvailable = render({ terminalFullscreenAvailable: true, onEnterTerminalFullscreen() {} });
		assert.match(buttonOpeningTag(fullscreenAvailable, "Enter Terminal fullscreen"), /title="Enter Terminal fullscreen"/);

		const routed = render({ allowedSessionViewIds: ["terminal"] });
		const disabledWorkflow = buttonOpeningTag(routed, "Workflow view unavailable for this Project session kind");
		assert.match(disabledWorkflow, /disabled=""/);
		assert.match(disabledWorkflow, /aria-pressed="false"/);
		assert.match(buttonOpeningTag(routed, "Switch to Terminal view"), /aria-pressed="true"/);

		const extra = render({
			activeViewId: "project-run",
			extraViewTabs: [
				{ id: "project-overview", label: "Overview", active: true, onSelect() {} },
				{ id: "project-run", label: "Run", active: false, onSelect() {} },
				{ id: "project-disabled", label: "Disabled", disabled: true, onSelect() {} },
			],
		});
		assert.match(buttonOpeningTag(extra, "Switch to Terminal view"), /aria-pressed="false"/);
		assert.match(buttonOpeningTag(extra, "Switch to Overview view"), /aria-pressed="true"/);
		assert.match(buttonOpeningTag(extra, "Switch to Run view"), /aria-pressed="false"/);
		const disabledExtra = buttonOpeningTag(extra, "Disabled view unavailable");
		assert.match(disabledExtra, /disabled=""/);
		assert.match(disabledExtra, /aria-pressed="false"/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session view buttons expose active, inactive, disabled, and extra-view toggle state", async () => {
	await assert.doesNotReject(runSessionViewToggleAccessibilityScenario());
});
