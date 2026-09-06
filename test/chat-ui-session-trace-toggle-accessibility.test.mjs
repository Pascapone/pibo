import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderSessionTraceHeader({
	showRawEvents,
	showThinking,
	expandThinking,
	contextKind = "room",
	contextLabel = "Test room",
	title = "Test session",
}) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { SessionTraceHeader } = await import("./src/apps/chat-ui/src/session-trace-header.tsx");
		const noop = () => {};
		const markup = renderToStaticMarkup(React.createElement(SessionTraceHeader, {
			title: ${JSON.stringify(title)},
			contextKind: ${JSON.stringify(contextKind)},
			contextLabel: ${JSON.stringify(contextLabel)},
			headerPiboSessionId: "ps-test",
			piboSessionId: "ps-test",
			webAnnotationsDisabled: true,
			webAnnotationsPanelRendered: false,
			workflowHeader: null,
			sessionViewId: "trace",
			sessionViews: [],
			currentSessionView: { label: "Trace" },
			debugMode: ${JSON.stringify(showRawEvents)},
			showThinking: ${JSON.stringify(showThinking)},
			expandThinking: ${JSON.stringify(expandThinking)},
			toolDisplayMode: "default",
			toolIntentSupported: false,
			onShowWebAnnotationsPanel: noop,
			onHideWebAnnotationsPanel: noop,
			onSelectSessionView: noop,
			onToggleDebugMode: noop,
			onToggleThinking: noop,
			onToggleExpandThinking: noop,
			onToolDisplayModeChange: noop,
			onError: noop,
		}));
		console.log(markup);
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout.trim();
}

function buttonWithName(markup, name) {
	return markup.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`))?.[0];
}

function assertToggle(markup, { name, pressed, title }) {
	const button = buttonWithName(markup, name);
	assert.ok(button, `expected ${name} toggle`);
	assert.match(button, new RegExp(`aria-pressed="${pressed}"`));
	assert.match(button, new RegExp(`title="${title}"`));
}

test("trace header toggle names stay stable across false and true states", async () => {
	const collapsed = await renderSessionTraceHeader({
		showRawEvents: false,
		showThinking: true,
		expandThinking: false,
	});
	assert.match(collapsed, /max-\[980px\]:flex-wrap/);
	assert.match(collapsed, /data-pibo-debug="session-context"/);
	assert.match(collapsed, /data-pibo-context-kind="room"/);
	assert.match(collapsed, />Room</);
	assert.match(collapsed, />Test room</);
	assertToggle(collapsed, { name: "Debug", pressed: false, title: "Enable Debug" });
	assert.doesNotMatch(collapsed, /aria-label="Raw Events"/);
	assertToggle(collapsed, { name: "Thinking", pressed: true, title: "Hide Thinking" });
	assertToggle(collapsed, { name: "Thinking expansion", pressed: false, title: "Expand Thinking" });

	const expanded = await renderSessionTraceHeader({
		showRawEvents: true,
		showThinking: true,
		expandThinking: true,
	});
	assertToggle(expanded, { name: "Debug", pressed: true, title: "Disable Debug" });
	assert.doesNotMatch(expanded, /aria-label="Raw Events"/);
	assertToggle(expanded, { name: "Thinking", pressed: true, title: "Hide Thinking" });
	assertToggle(expanded, { name: "Thinking expansion", pressed: true, title: "Collapse Thinking" });
});

test("long context names keep their full accessible name and wrap controls on narrow viewports", async () => {
	const longRoomName = "Room with a deliberately long workspace name that must not widen the viewport";
	const markup = await renderSessionTraceHeader({
		showRawEvents: false,
		showThinking: true,
		expandThinking: false,
		contextKind: "room",
		contextLabel: longRoomName,
		title: "Long-running implementation session",
	});
	assert.match(markup, new RegExp(`aria-label="Room: ${longRoomName}"`));
	assert.match(markup, /inline-flex min-w-0 max-w-full/);
	assert.match(markup, /max-\[980px\]:w-full max-\[980px\]:flex-wrap/);
	assert.match(markup, /class="truncate text-slate-400"/);
});

test("thinking expansion visibility preserves the supplied expansion state", async () => {
	const visibleExpanded = await renderSessionTraceHeader({
		showRawEvents: false,
		showThinking: true,
		expandThinking: true,
	});
	assertToggle(visibleExpanded, { name: "Thinking expansion", pressed: true, title: "Collapse Thinking" });

	const hidden = await renderSessionTraceHeader({
		showRawEvents: false,
		showThinking: false,
		expandThinking: true,
	});
	assertToggle(hidden, { name: "Thinking", pressed: false, title: "Show Thinking" });
	assert.equal(buttonWithName(hidden, "Thinking expansion"), undefined);

	const restored = await renderSessionTraceHeader({
		showRawEvents: false,
		showThinking: true,
		expandThinking: true,
	});
	assertToggle(restored, { name: "Thinking expansion", pressed: true, title: "Collapse Thinking" });
});
