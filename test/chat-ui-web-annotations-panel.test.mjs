import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderWebAnnotationsPanel() {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { WebAnnotationsSessionPanel } = await import("./src/apps/chat-ui/src/web-annotations.tsx");
		const annotation = { id: "annotation-1", status: "open", targetKind: "element", piboSessionId: "ps_test", url: "https://example.com/page", primaryTarget: "Save button", note: "Clarify this action", createdAt: "2026-08-08T00:00:00.000Z" };
		const noop = () => {};
		console.log(renderToStaticMarkup(React.createElement(WebAnnotationsSessionPanel, {
			piboSessionId: "ps_test", annotations: [annotation], selectedIds: [], loading: false, error: null,
			onRefresh: noop, onToggle: noop, onClear: noop,
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout.trim();
}

test("Web Annotations list uses the tab scrollbar and keeps attachment controls accessible", async () => {
	const markup = await renderWebAnnotationsPanel();
	assert.match(markup, /data-pibo-debug="web-annotations-session-panel"/);
	assert.match(markup, /aria-label="Refresh annotations"/);
	assert.match(markup, /aria-label="Clear visible annotations"/);
	assert.match(markup, /aria-pressed="false"/);
	assert.match(markup, /grid-cols-1[^\"]*@min-\[560px\]:grid-cols-\[repeat\(auto-fill,minmax\(16rem,1fr\)\)\]/);
	assert.doesNotMatch(markup, /aria-label="Web annotations details"|aria-label="Hide annotations panel"|max-h-|overflow-y-auto/);
});
