import assert from "node:assert/strict";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import {
	createPiboProfileFromCapabilitiesOrDefault,
	resolvePiboProfileNameFromCapabilitiesOrDefault,
} from "../dist/plugins/builtin.js";
import { createDefaultPiboCapabilityHost } from "./helpers/capability-fixtures.mjs";

test("legacy default profile requests resolve to the current default profile", () => {
	const registry = createDefaultPiboCapabilityHost();

	assert.equal(resolvePiboProfileNameFromCapabilitiesOrDefault(registry, "default"), "base");
	assert.equal(createPiboProfileFromCapabilitiesOrDefault(registry, "default").profileName, "base");
});

test("non-default agent profile requests remain unchanged", () => {
	const registry = createDefaultPiboCapabilityHost();
	registry.upsertProfile({
		name: "unity-agent",
		create() {
			return new InitialSessionContextBuilder("unity-agent").createSession();
		},
	});

	assert.equal(resolvePiboProfileNameFromCapabilitiesOrDefault(registry, "unity-agent"), "unity-agent");
	assert.equal(createPiboProfileFromCapabilitiesOrDefault(registry, "unity-agent").profileName, "unity-agent");
});
