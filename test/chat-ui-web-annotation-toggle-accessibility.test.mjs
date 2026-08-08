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
				id: "ann_save",
				status: "open",
				targetKind: "element",
				piboSessionId: "ps_source",
				url: "https://example.test/settings",
				primaryTarget: "Save changes button",
				note: "Make this clearer",
				createdAt: "2026-08-08T00:00:00.000Z",
			},
			{
				id: "ann_cancel",
				status: "open",
				targetKind: "element",
				piboSessionId: "ps_source",
				url: "https://example.test/settings",
				label: "Cancel button",
				note: "Move this action",
				createdAt: "2026-08-08T00:01:00.000Z",
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
			selected: render(["ann_save"]),
			multiple: render(["ann_cancel"]),
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
	const [unselectedSave] = toggleButtons(unselected);
	const [selectedSave] = toggleButtons(selected);

	assert.match(unselectedSave, /aria-pressed="false"/);
	assert.match(selectedSave, /aria-pressed="true"/);
	assert.match(unselectedSave, /aria-label="Include web annotation Save changes button \(ann_save\)"/);
	assert.match(selectedSave, /aria-label="Include web annotation Save changes button \(ann_save\)"/);
	assert.match(unselectedSave, /title="Attach web annotation Save changes button \(ann_save\)"/);
	assert.match(selectedSave, /title="Detach web annotation Save changes button \(ann_save\)"/);
	assert.match(unselectedSave, /> Attach<\/button>$/);
	assert.match(selectedSave, /> Detach<\/button>$/);
	assert.match(unselected, /data-web-annotation-selected="false"/);
	assert.match(selected, /data-web-annotation-selected="true"/);
	assert.match(selected, />1 attached</);
});

test("web annotation attachment selector names distinguish multiple annotations", async () => {
	const { multiple } = await panelStatesPromise;
	const buttons = toggleButtons(multiple);

	assert.equal(buttons.length, 2);
	assert.match(buttons[0], /aria-label="Include web annotation Save changes button \(ann_save\)"/);
	assert.match(buttons[0], /aria-pressed="false"/);
	assert.match(buttons[1], /aria-label="Include web annotation Cancel button \(ann_cancel\)"/);
	assert.match(buttons[1], /aria-pressed="true"/);
});

test("web annotation attachment selectors preserve responsive classes and collapsed behavior", async () => {
	const { unselected, collapsed } = await panelStatesPromise;
	const [button] = toggleButtons(unselected);

	assert.match(button, /class="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-2 text-\[11px\] sm:h-6 sm:px-1\.5 /);
	assert.match(unselected, /grid-cols-1[^\"]*sm:max-h-56 sm:grid-cols-\[repeat\(auto-fill,minmax\(16rem,1fr\)\)\]/);
	assert.equal(toggleButtons(collapsed).length, 0);
	assert.doesNotMatch(collapsed, /data-pibo-debug="web-annotations-list"/);
});
