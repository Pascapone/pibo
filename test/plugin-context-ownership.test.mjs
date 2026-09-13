import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { InitialSessionContextBuilder } = await tsImport("../src/core/profiles.ts", import.meta.url);
const { independentProfileResources } = await tsImport("../src/agent-runtime/plugin-plan.ts", import.meta.url);
const { definePiboPlugin, PiboPluginRegistry } = await tsImport("../src/plugins/registry.ts", import.meta.url);

test("plugin-registered context defaults to plugin ownership and is not planned again as an independent resource", () => {
	const registry = PiboPluginRegistry.create({
		plugins: [definePiboPlugin({
			id: "fixture.context-owner",
			register(api) {
				api.registerContextFile({
					key: "Pibo Native Tooling",
					label: "Pibo Native Tooling",
					path: "/fixture/native-tooling.md",
				});
			},
		})],
	});
	const contextFile = registry.getCapabilityCatalog().contextFiles.find((entry) => entry.key === "Pibo Native Tooling");
	assert.ok(contextFile);
	assert.equal(contextFile.source, "plugin");
	assert.equal(contextFile.pluginId, "fixture.context-owner");

	const profile = new InitialSessionContextBuilder("fixture")
		.addContextFile(contextFile)
		.createSession();
	assert.deepEqual(independentProfileResources(profile), []);
});
