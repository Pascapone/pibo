import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderWebAnnotationsPanel(collapsed) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { WebAnnotationsSessionPanel } = await import("./src/apps/chat-ui/src/web-annotations.tsx");
		const annotation = {
			id: "annotation-1",
			status: "open",
			targetKind: "element",
			piboSessionId: "ps_test",
			url: "https://example.com/page",
			primaryTarget: "Save button",
			note: "Clarify this action",
			createdAt: "2026-08-08T00:00:00.000Z",
		};
		const noop = () => {};
		console.log(renderToStaticMarkup(React.createElement(WebAnnotationsSessionPanel, {
			piboSessionId: "ps_test",
			annotations: [annotation],
			selectedIds: [],
			loading: false,
			error: null,
			collapsed: ${JSON.stringify(collapsed)},
			onRefresh: noop,
			onToggle: noop,
			onClear: noop,
			onCollapse: noop,
			onClose: noop,
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout.trim();
}

function openingTag(markup, selector) {
	const match = markup.match(new RegExp(`<[^>]+${selector}[^>]*>`));
	assert.ok(match, `expected opening tag matching ${selector}`);
	return match[0];
}

test("Web Annotations disclosure keeps a stable name and synchronized expanded state", async () => {
	const [expanded, collapsed] = await Promise.all([
		renderWebAnnotationsPanel(false),
		renderWebAnnotationsPanel(true),
	]);
	const expandedButton = openingTag(expanded, 'aria-label="Web annotations details"');
	const collapsedButton = openingTag(collapsed, 'aria-label="Web annotations details"');

	assert.match(expandedButton, /aria-expanded="true"/);
	assert.match(collapsedButton, /aria-expanded="false"/);
	assert.match(expandedButton, /aria-controls="web-annotations-session-panel-details"/);
	assert.match(collapsedButton, /aria-controls="web-annotations-session-panel-details"/);
	assert.match(expandedButton, /title="Collapse annotations panel"/);
	assert.match(collapsedButton, /title="Expand annotations panel"/);
});

test("collapsed Web Annotations details remain rendered but hidden", async () => {
	const [expanded, collapsed] = await Promise.all([
		renderWebAnnotationsPanel(false),
		renderWebAnnotationsPanel(true),
	]);
	const expandedDetails = openingTag(expanded, 'id="web-annotations-session-panel-details"');
	const collapsedDetails = openingTag(collapsed, 'id="web-annotations-session-panel-details"');

	assert.doesNotMatch(expandedDetails, /hidden/);
	assert.match(collapsedDetails, /hidden=""/);
	assert.match(expanded, /Global annotation list/);
	assert.match(collapsed, /Global annotation list/);
	assert.match(expanded, / Attach<\/button>/);
	assert.match(collapsed, / Attach<\/button>/);
});

test("Web Annotations panel retains desktop and mobile responsive rendering", async () => {
	const [expanded, collapsed] = await Promise.all([
		renderWebAnnotationsPanel(false),
		renderWebAnnotationsPanel(true),
	]);

	for (const markup of [expanded, collapsed]) {
		assert.match(markup, /px-3 py-2 sm:px-4/);
		assert.match(markup, /h-8 w-8[^\"]*sm:h-7 sm:w-7/);
	}
	assert.match(expanded, /grid-cols-1[^\"]*sm:max-h-56 sm:grid-cols-\[repeat\(auto-fill,minmax\(16rem,1fr\)\)\]/);
	assert.match(collapsed, /grid-cols-1[^\"]*sm:max-h-56 sm:grid-cols-\[repeat\(auto-fill,minmax\(16rem,1fr\)\)\]/);
});
