import assert from "node:assert/strict";
import test from "node:test";
import { MUSE_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/muse-native/adapter.js";
import {
	mapThinkingLevelToReasoning,
	MuseSessionSettingsController,
	parseMuseProfileOptions,
	readMuseModelCatalog,
	readMusePersistedSettings,
	selectDefaultCatalogModel,
	toAgentRuntimeModelCatalog,
} from "../dist/agent-runtimes/muse-native/models.js";

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

test("Muse native models capability exposes the sandbox schema", () => {
	const schema = MUSE_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities.models.optionsSchema;
	assert.deepEqual(schema.properties.sandbox.enum, ["auto", "enabled", "disabled"]);
	assert.equal(schema.properties.sandbox.default, "auto");
});

test("Muse native profile options accept and reject sandbox modes", () => {
	assert.deepEqual(parseMuseProfileOptions({ sandbox: "disabled" }), { sandbox: "disabled" });
	assert.deepEqual(parseMuseProfileOptions({ approvalMode: "allowAll", sandbox: "enabled" }), {
		approvalMode: "allowAll",
		sandbox: "enabled",
	});
	assert.throws(() => parseMuseProfileOptions({ sandbox: "sometimes" }), /sandbox must be one of/);
});

test("Muse native persisted settings carry the sandbox toggle override", () => {
	assert.deepEqual(readMusePersistedSettings({ museNativeSandboxMode: "disabled" }).sandboxOverride, "disabled");
	assert.equal(readMusePersistedSettings({ museNativeSandboxMode: "sometimes" }).sandboxOverride, undefined);
	assert.equal(readMusePersistedSettings({}).sandboxOverride, undefined);
	assert.equal(readMusePersistedSettings(undefined).sandboxOverride, undefined);
});

test("Muse native reasoning accepts off as an alias for none", () => {
	const settings = new MuseSessionSettingsController({ profileOptions: {}, catalog: { models: [] } });
	assert.equal(settings.setReasoning("off").value, "none");
	assert.equal(settings.setReasoning("xhigh").value, "xhigh");
	assert.deepEqual(settings.turnOptions, { reasoningEffort: "xhigh" });
	assert.throws(() => settings.setReasoning("turbo"), /Muse reasoning effort must be one of/);
});

test("Muse native model warnings clear on model changes, not reasoning changes", async () => {
	const catalog = { models: [{ id: "catalog-model" }] };
	const settings = new MuseSessionSettingsController({ profileOptions: {}, catalog });
	settings.adoptNativeModel({ modelId: "foreign-model" });
	assert.deepEqual(settings.pendingSyncWarnings, [
		'Muse session runs model "foreign-model", which is not in the current model catalog.',
	]);
	settings.setReasoning("low");
	assert.equal(settings.pendingSyncWarnings.length, 1);
	settings.adoptNativeModel({ modelId: "catalog-model" });
	assert.deepEqual(settings.pendingSyncWarnings, []);
	settings.adoptNativeModel({ modelId: "foreign-model" });
	await settings.setModel({ id: "catalog-model", provider: "meta-muse" });
	assert.deepEqual(settings.pendingSyncWarnings, []);
});

test("Muse native model catalog skips invalid entries with a warning", async () => {
	const connection = {
		request: async () => ({
			models: [
				{ modelId: "good-model" },
				null,
				{ modelId: "" },
				{ modelId: "another-good-model", displayLabel: "Another" },
			],
		}),
	};
	const catalog = await readMuseModelCatalog(connection, "session-1");
	assert.deepEqual(catalog.models.map((model) => model.id), ["good-model", "another-good-model"]);
	assert.equal(catalog.skippedInvalidEntries, 2);
	const exposed = toAgentRuntimeModelCatalog("instance-1", catalog);
	assert.equal(exposed.diagnostics.length, 1);
	assert.equal(exposed.diagnostics[0].code, "muse_native_model_catalog_skipped_entries");
	assert.equal(exposed.diagnostics[0].severity, "warning");
});
