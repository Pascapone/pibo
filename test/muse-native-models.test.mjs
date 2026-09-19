import assert from "node:assert/strict";
import test from "node:test";
import { MUSE_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/muse-native/adapter.js";
import { mapThinkingLevelToReasoning, MuseSessionSettingsController, selectDefaultCatalogModel } from "../dist/agent-runtimes/muse-native/models.js";

test("Muse native default model prefers the catalog default", () => {
	assert.deepEqual(
		selectDefaultCatalogModel({ models: [{ id: "b" }, { id: "a", isDefault: true }] }),
		{ id: "a", provider: "meta-muse" },
	);
});

test("Muse native default model falls back to the first entry", () => {
	assert.deepEqual(
		selectDefaultCatalogModel({ models: [{ id: "b" }, { id: "a" }] }),
		{ id: "b", provider: "meta-muse" },
	);
	assert.equal(selectDefaultCatalogModel({ models: [] }), undefined);
});

test("Muse native thinking levels map to reasoning efforts", () => {
	assert.equal(mapThinkingLevelToReasoning("off"), "none");
	assert.equal(mapThinkingLevelToReasoning("none"), "none");
	assert.equal(mapThinkingLevelToReasoning("ultra"), "ultra");
	assert.equal(mapThinkingLevelToReasoning("high"), "high");
	assert.equal(mapThinkingLevelToReasoning(undefined), undefined);
	assert.equal(mapThinkingLevelToReasoning("turbo"), undefined);
});

test("Muse native models capability exposes the approval mode schema", () => {
	const schema = MUSE_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities.models.optionsSchema;
	assert.equal(schema.type, "object");
	assert.deepEqual(schema.properties.approvalMode.enum, ["allowAll", "promptUnmatched", "onRequest", "denyUnmatched"]);
	assert.equal(schema.properties.approvalMode.default, "onRequest");
});

test("Muse native reasoning accepts off as an alias for none", () => {
	const settings = new MuseSessionSettingsController({ profileOptions: {}, catalog: { models: [] } });
	assert.equal(settings.setReasoning("off").value, "none");
	assert.equal(settings.setReasoning("xhigh").value, "xhigh");
	assert.deepEqual(settings.turnOptions, { reasoningEffort: "xhigh" });
	assert.throws(() => settings.setReasoning("turbo"), /Muse reasoning effort must be one of/);
});
