import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Raw Events stays reachable as a labelled inspector at narrow widths", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SessionTraceHeader } from "./src/apps/chat-ui/src/session-trace-header.tsx";
		import { RawEventsSidebar } from "./src/apps/chat-ui/src/tracing/RawEventsSidebar.tsx";

		globalThis.React = React;
		const noop = () => {};
		const header = renderToStaticMarkup(React.createElement(SessionTraceHeader, {
			title: "Session",
			contextKind: "room",
			contextLabel: "Shared Chat",
			headerPiboSessionId: "ps-test",
			piboSessionId: "ps-test",
			webAnnotationsDisabled: true,
			webAnnotationsPanelRendered: false,
			workflowHeader: null,
			sessionViewId: "terminal",
			sessionViews: [],
			currentSessionView: { label: "Terminal" },
			debugMode: true,
			showThinking: true,
			expandThinking: false,
			toolDisplayMode: "default",
			toolIntentSupported: false,
			onToolDisplayModeChange: noop,
			onShowWebAnnotationsPanel: noop,
			onHideWebAnnotationsPanel: noop,
			onSelectSessionView: noop,
			onToggleDebugMode: noop,
			onToggleThinking: noop,
			onToggleExpandThinking: noop,
			onError: noop,
		}));
		const inspector = renderToStaticMarkup(React.createElement(RawEventsSidebar, {
			traceView: null,
			eventLimit: 80,
			isFetching: false,
			visible: true,
			onLoadOlder: noop,
		}));

		assert.doesNotMatch(header, /<button[^>]*aria-label="Raw Events"/);
		assert.match(header, /<button[^>]*aria-label="Debug"[^>]*aria-pressed="true"/);
		assert.match(inspector, /<aside[^>]*id="raw-events-inspector"/);
		assert.match(inspector, /aria-label="Raw Events"/);
		assert.equal(inspector.includes("max-[980px]:fixed"), true);
		assert.equal(inspector.includes("max-[980px]:right-0"), true);
		assert.equal(inspector.includes("max-[980px]:max-w-[80vw]"), true);
		assert.equal(inspector.includes("max-[980px]:hidden"), false);
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
