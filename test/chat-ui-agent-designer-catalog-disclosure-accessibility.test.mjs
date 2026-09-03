import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runCatalogDisclosureScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React from "react";
		import TestRenderer from "react-test-renderer";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const { act, create } = TestRenderer;
		const { CatalogGroupGrid } = await import("./src/apps/chat-ui/src/agents/designer-ui.tsx");

		const groups = [{
			key: "builtin",
			title: "Built-in Tools",
			description: "Core runtime tools",
			kind: "builtin",
			items: [{ name: "read" }],
			selectedCount: 0,
			totalCount: 1,
			defaultOpen: false,
		}];
		let renderer;
		await act(async () => {
			renderer = create(React.createElement(CatalogGroupGrid, {
				groups,
				empty: React.createElement("span", null, "empty"),
				renderItem: (item) => React.createElement("span", { key: item.name, "data-tool": item.name }, item.name),
			}));
		});

		const disclosure = () => renderer.root.findByType("button");
		const controlledRegion = () => renderer.root.findByProps({ id: disclosure().props["aria-controls"] });
		assert.equal(disclosure().props["aria-expanded"], false);
		assert.ok(disclosure().props["aria-controls"]);
		assert.equal(controlledRegion().props.hidden, true);
		assert.equal(renderer.root.findAllByProps({ "data-tool": "read" }).length, 0);

		await act(async () => disclosure().props.onClick());
		assert.equal(disclosure().props["aria-expanded"], true);
		assert.equal(controlledRegion().props.hidden, false);
		assert.equal(renderer.root.findAllByProps({ "data-tool": "read" }).length, 1);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: { ...process.env, NODE_ENV: "development" },
	});
}

test("Agent Designer catalog groups expose their disclosure state and controlled region", async () => {
	await assert.doesNotReject(runCatalogDisclosureScenario());
});
