import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAgentPluginCatalog } from "../dist/apps/chat/chat-capability-routes.js";
import { pluginSettingsScopes, pluginViewPresentation } from "../dist/plugins/manifest.js";
import { resolvePluginContributions } from "../dist/plugins/resolution.js";
import { validatePluginManifest } from "../dist/plugins/schema.js";
import { createAgentPluginSelection } from "../dist/plugins/selection.js";
const { availablePluginViews } = await tsImport("../src/apps/chat-ui/src/plugins/session-tab-controller.ts", import.meta.url);

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plugin-system/scope-presentation-forms.json", import.meta.url)));
const installations = fixture.manifests.map((manifest, index) => ({
	pluginId: manifest.id,
	revision: `fixture:${manifest.id}`,
	version: manifest.version,
	contentHash: `sha256:${manifest.id}`,
	source: { kind: "builtin", name: manifest.id },
	manifest,
	state: "active",
	enabled: true,
	stateRevision: index + 1,
	createdAt: "2026-09-13T00:00:00.000Z",
}));
const catalog = { schemaVersion: 1, revision: 15, installations };
const legacyManifest = (view, config) => ({ schemaVersion: 1, id: "fixture.legacy-settings", name: "Legacy settings", version: "1.0.0", sdk: "^1.0.0", entrypoints: { browser: "browser.mjs" }, ...(config ? { config } : {}), contributions: [{ id: "settings", kind: "view", title: "Settings", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "legacy" }, view }] });

test("generic tabless, settings-only, domain-module, system-only and mixed manifests separate product dimensions", () => {
	for (const manifest of fixture.manifests) assert.deepEqual(validatePluginManifest(manifest), [], manifest.id);
	const agentCatalog = buildAgentPluginCatalog(catalog);
	assert.deepEqual(agentCatalog.plugins.map((plugin) => plugin.pluginId), ["fixture.tabless", "fixture.mixed"]);
	assert.ok(agentCatalog.plugins.every((plugin) => plugin.contributions.every((contribution) => contribution.scope === "agent")));
	assert.deepEqual(fixture.manifests.find((manifest) => manifest.id === "fixture.settings-only").config.scopes, ["app", "agent", "session"]);
	assert.equal(agentCatalog.plugins.some((plugin) => plugin.pluginId === "fixture.system-only"), false);
});

test("workspace catalog includes only explicit domain modules while system and agent resolution remain independent", () => {
	const selection = createAgentPluginSelection(installations);
	const plan = resolvePluginContributions({ catalog, selection, selectionRevision: 1, runtime: { adapterId: "pi", instanceId: "pi", capabilities: {} }, services: { "fixture.system": "1.0.0", "fixture.mixed.service": "1.0.0" }, serviceProviders: { "fixture.system": "fixture.system-only", "fixture.mixed.service": "fixture.mixed" }, piboSessionId: "ps_fixture" });
	assert.equal(plan.valid, true);
	const browserCatalog = { schemaVersion: 1, revision: 15, diagnostics: [], plugins: installations.map((installation) => ({ pluginId: installation.pluginId, revision: installation.revision, version: installation.version, contentHash: installation.contentHash, browserEntry: installation.manifest.entrypoints?.browser ? `/assets/${installation.pluginId}.js` : undefined, contributions: installation.manifest.contributions })) };
	assert.deepEqual(availablePluginViews(plan, browserCatalog).map((entry) => entry.id), ["fixture.domain-module/dashboard", "fixture.mixed/workspace"]);
	assert.equal(plan.contributions.some((entry) => entry.id === "fixture.system-only/service"), true);
	assert.equal(plan.contributions.some((entry) => entry.id === "fixture.mixed/control"), false);
});

test("normal manifest validation rejects legacy view hints while current presentation and settings scopes remain explicit", () => {
	const currentSettings = { title: "Preferences", exportName: "Preferences", presentation: "internal", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, subviews: [{ id: "settings", title: "Settings", purpose: "settings", settingsScopes: ["app"] }] };
	const currentProduct = { title: "Workflows", exportName: "Workflows", presentation: "workspace", instance: "singleton", mount: "unmount", stateSchemaVersion: 1 };
	assert.equal(pluginViewPresentation(currentSettings), "internal");
	assert.equal(pluginViewPresentation(currentProduct), "workspace");
	assert.deepEqual(pluginSettingsScopes(legacyManifest(currentSettings)), ["app"]);
	assert.deepEqual(pluginSettingsScopes(legacyManifest({ ...currentSettings, subviews: [{ id: "settings", title: "Settings", purpose: "settings", settingsScopes: ["session", "agent"] }] }, { schemaVersion: 1, schema: { type: "object" } })), ["agent", "session"]);
	const { presentation: _presentation, ...legacySettings } = currentSettings;
	assert.ok(validatePluginManifest(legacyManifest({ ...legacySettings, visibility: "infrastructure" })).some((error) => error.code === "legacy-manifest-field" || error.code === "invalid-view"));
});
