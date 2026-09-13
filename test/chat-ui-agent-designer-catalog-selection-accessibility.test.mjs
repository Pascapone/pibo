import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runCatalogSelectionScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React, { useState } from "react";
		import TestRenderer from "react-test-renderer";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const { act, create } = TestRenderer;
		const { CatalogToggle } = await import("./src/apps/chat-ui/src/agents/designer-ui.tsx");

		function CatalogHarness() {
			const [checked, setChecked] = useState(false);
			return React.createElement(CatalogToggle, {
				checked,
				title: "Pibo Web Search",
				description: "pibo.web-search · installed plugin contribution",
				meta: checked ? "Pinned revision r1" : "Not selected",
				onToggle: () => setChecked((current) => !current),
			});
		}

		let catalog;
		await act(async () => { catalog = create(React.createElement(CatalogHarness)); });
		const catalogButton = () => catalog.root.findByType("button");
		assert.equal(catalogButton().props["aria-pressed"], false);
		assert.match(JSON.stringify(catalog.toJSON()), /Not selected/);
		await act(async () => catalogButton().props.onClick());
		assert.equal(catalogButton().props["aria-pressed"], true);
		assert.match(JSON.stringify(catalog.toJSON()), /Pinned revision r1/);
		await act(async () => catalogButton().props.onClick());
		assert.equal(catalogButton().props["aria-pressed"], false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: { ...process.env, NODE_ENV: "development" },
	});
}

test("Agent Designer plugin catalog controls expose selected and unselected states", async () => {
	await assert.doesNotReject(runCatalogSelectionScenario());
});
