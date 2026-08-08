import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderPanelStates() {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		globalThis.React = React;
		const { WebAnnotationsSessionPanel } = await import("./src/apps/chat-ui/src/web-annotations.tsx");

		const annotations = [
			{
				id: "ann_39bc2730-872b-4708-9bb7-675ec0be46b3",
				status: "open",
				targetKind: "element",
				piboSessionId: "ps_source",
				url: "https://example.test/settings",
				primaryTarget: "chat-shell",
				note: "Make this clearer",
				createdAt: "2026-08-08T00:00:00.000Z",
			},
			{
				id: "ann_71846a12-f77c-43ef-bf7f-1791f145b399",
				status: "open",
				targetKind: "element",
				piboSessionId: "ps_source",
				url: "https://example.test/settings",
				label: "chat-shell",
				note: "Move this action",
				createdAt: "2026-08-08T00:01:00.000Z",
			},
			{
				id: "ann_aaef1237-1855-4aa8-bdb5-fca1ae321c69",
				status: "open",
				targetKind: "element",
				piboSessionId: "ps_source",
				url: "https://example.test/settings",
				primaryTarget: "x".repeat(100),
				note: "Bound the announced target",
				createdAt: "2026-08-08T00:02:00.000Z",
			},
		];
		const props = {
			piboSessionId: "ps_current",
			annotations,
			loading: false,
			error: null,
			collapsed: false,
			onRefresh() {},
			onToggle() {},
			onClear() {},
			onCollapse() {},
			onClose() {},
		};
		const render = (selectedIds, overrides = {}) => renderToStaticMarkup(
			React.createElement(WebAnnotationsSessionPanel, { ...props, selectedIds, ...overrides }),
		);
		console.log(JSON.stringify({
			unselected: render([]),
			selected: render(["ann_39bc2730-872b-4708-9bb7-675ec0be46b3"]),
			multiple: render(["ann_71846a12-f77c-43ef-bf7f-1791f145b399"]),
			collapsed: render([], { collapsed: true }),
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return JSON.parse(stdout.trim());
}

function toggleButtons(markup) {
	return [...markup.matchAll(/<button\b[^>]*aria-pressed="(?:true|false)"[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

const panelStatesPromise = renderPanelStates();

test("web annotation attachment selectors expose stable names and pressed states", async () => {
	const { unselected, selected } = await panelStatesPromise;
	const [unselectedFirst] = toggleButtons(unselected);
	const [selectedFirst] = toggleButtons(selected);

	assert.match(unselectedFirst, /aria-pressed="false"/);
	assert.match(selectedFirst, /aria-pressed="true"/);
	assert.match(unselectedFirst, /aria-label="Include web annotation 1: chat-shell"/);
	assert.match(selectedFirst, /aria-label="Include web annotation 1: chat-shell"/);
	assert.match(unselectedFirst, /title="Attach web annotation 1: chat-shell"/);
	assert.match(selectedFirst, /title="Detach web annotation 1: chat-shell"/);
	assert.doesNotMatch(unselectedFirst, /ann_[a-z0-9-]+/);
	assert.doesNotMatch(selectedFirst, /ann_[a-z0-9-]+/);
	assert.match(unselectedFirst, /> Attach<\/button>$/);
	assert.match(selectedFirst, /> Detach<\/button>$/);
	assert.match(unselected, /data-web-annotation-selected="false"/);
	assert.match(selected, /data-web-annotation-selected="true"/);
	assert.match(selected, />1 attached</);
});

test("web annotation attachment selector ordinals distinguish duplicate targets without exposing ids", async () => {
	const { multiple } = await panelStatesPromise;
	const buttons = toggleButtons(multiple);

	assert.equal(buttons.length, 3);
	assert.match(buttons[0], /aria-label="Include web annotation 1: chat-shell"/);
	assert.match(buttons[0], /title="Attach web annotation 1: chat-shell"/);
	assert.match(buttons[0], /aria-pressed="false"/);
	assert.match(buttons[1], /aria-label="Include web annotation 2: chat-shell"/);
	assert.match(buttons[1], /title="Detach web annotation 2: chat-shell"/);
	assert.match(buttons[1], /aria-pressed="true"/);
	assert.ok(buttons[2].includes(`aria-label="Include web annotation 3: ${"x".repeat(63)}…"`));
	assert.doesNotMatch(buttons[2], /x{64}/);
	for (const button of buttons) assert.doesNotMatch(button, /ann_[a-z0-9-]+/);
});

test("web annotation attachment selectors preserve responsive classes and collapsed behavior", async () => {
	const { unselected, collapsed } = await panelStatesPromise;
	const [button] = toggleButtons(unselected);

	assert.match(button, /class="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-2 text-\[11px\] sm:h-6 sm:px-1\.5 /);
	assert.match(unselected, /grid-cols-1[^\"]*sm:max-h-56 sm:grid-cols-\[repeat\(auto-fill,minmax\(16rem,1fr\)\)\]/);
	assert.equal(toggleButtons(collapsed).length, 0);
	assert.doesNotMatch(collapsed, /data-pibo-debug="web-annotations-list"/);
});
