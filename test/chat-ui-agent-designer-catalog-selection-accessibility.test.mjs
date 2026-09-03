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
		const { CatalogToggle, PiPackageCard } = await import("./src/apps/chat-ui/src/agents/designer-ui.tsx");

		function CatalogHarness() {
			const [checked, setChecked] = useState(false);
			return React.createElement(CatalogToggle, {
				checked,
				title: "web_search",
				description: "Searches the web",
				onToggle: () => setChecked((current) => !current),
			});
		}

		let catalog;
		await act(async () => { catalog = create(React.createElement(CatalogHarness)); });
		const catalogButton = () => catalog.root.findByType("button");
		assert.equal(catalogButton().props["aria-pressed"], false);
		await act(async () => catalogButton().props.onClick());
		assert.equal(catalogButton().props["aria-pressed"], true);
		await act(async () => catalogButton().props.onClick());
		assert.equal(catalogButton().props["aria-pressed"], false);

		const pkg = {
			name: "example-package",
			description: "Example package",
			source: "/tmp/example-package",
			installSpec: "/tmp/example-package",
			installStatus: "installed",
			enabled: true,
			resourceTypes: [],
			diagnostics: [],
		};
		function PackageHarness() {
			const [selected, setSelected] = useState(false);
			return React.createElement(PiPackageCard, {
				pkg,
				selected,
				readOnly: false,
				expanded: false,
				busy: false,
				onToggleSelected: () => setSelected((current) => !current),
				onToggleExpanded: () => {},
			});
		}

		let packageCard;
		await act(async () => { packageCard = create(React.createElement(PackageHarness)); });
		const packageSelection = () => packageCard.root.findAllByType("button").find((button) => Object.hasOwn(button.props, "aria-pressed"));
		assert.equal(packageSelection().props["aria-pressed"], false);
		await act(async () => packageSelection().props.onClick());
		assert.equal(packageSelection().props["aria-pressed"], true);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: { ...process.env, NODE_ENV: "development" },
	});
}

test("Agent Designer catalog cards expose selected and unselected states", async () => {
	await assert.doesNotReject(runCatalogSelectionScenario());
});
