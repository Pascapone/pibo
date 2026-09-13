import assert from "node:assert/strict";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import {
	createPiboProfileFromRegistryOrDefault,
	resolvePiboProfileNameFromRegistryOrDefault,
} from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "./helpers/plugin-legacy-fixtures.mjs";

test("legacy default profile requests resolve to the current default profile", () => {
	const registry = createDefaultPiboPluginRegistry();

	assert.equal(resolvePiboProfileNameFromRegistryOrDefault(registry, "default"), "base");
	assert.equal(createPiboProfileFromRegistryOrDefault(registry, "default").profileName, "base");
});

test("non-default agent profile requests remain unchanged", () => {
	const registry = createDefaultPiboPluginRegistry();
	registry.upsertProfile({
		name: "unity-agent",
		create() {
			return new InitialSessionContextBuilder("unity-agent").createSession();
		},
	});

	assert.equal(resolvePiboProfileNameFromRegistryOrDefault(registry, "unity-agent"), "unity-agent");
	assert.equal(createPiboProfileFromRegistryOrDefault(registry, "unity-agent").profileName, "unity-agent");
});
