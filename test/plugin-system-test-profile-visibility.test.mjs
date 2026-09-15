import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { webAnnotationsPackageManifest } = await tsImport("../src/plugins/default-packages.ts", import.meta.url);
const { createAgentPluginSelectionForProfile } = await tsImport("../src/plugins/selection.ts", import.meta.url);
const { resolvePluginContributions } = await tsImport("../src/plugins/resolution.ts", import.meta.url);

function installation() {
	const manifest = webAnnotationsPackageManifest();
	return {
		pluginId: manifest.id,
		revision: "sha256:web-annotations-test",
		version: manifest.version,
		contentHash: "sha256:web-annotations-test",
		source: { kind: "builtin", name: manifest.id },
		state: "active",
		enabled: true,
		stateRevision: 1,
		createdAt: "2026-09-15T00:00:00.000Z",
		manifest,
	};
}

function profile(tools = []) {
	return {
		name: "pibo2-ui-test",
		tools: tools.map((name) => ({ name })),
		skills: [], contextFiles: [], mcpServers: [], subagents: [],
		toolPackages: { goalControl: false },
	};
}

test("an annotation-capable test profile exposes the complete Web Annotations UI family", () => {
	const selected = createAgentPluginSelectionForProfile([installation()], profile(["web_annotations_list"]));
	const annotations = selected.plugins.find((entry) => entry.pluginId === "pibo.web-annotations");
	for (const id of ["web_annotations_list", "skill", "annotations", "build-context", "terminal"]) {
		assert.equal(annotations.contributions[id], true, id);
		assert.equal(annotations.explicitContributions[id], true, `${id} records profile-derived intent`);
	}
	assert.equal(annotations.contributions.web_annotations_resolve, false, "unrequested tools do not broaden the profile");
});

test("profiles without annotation intent and stored explicit disables remain disabled", () => {
	const item = installation();
	const base = createAgentPluginSelectionForProfile([item], profile());
	const baseAnnotations = base.plugins.find((entry) => entry.pluginId === "pibo.web-annotations");
	assert.equal(baseAnnotations.enabled, false);
	assert.equal(baseAnnotations.contributions.annotations, false);

	const stored = structuredClone(createAgentPluginSelectionForProfile([item], profile(["web_annotations_list"])));
	const entry = stored.plugins[0];
	entry.contributions.annotations = false;
	entry.explicitContributions.annotations = false;
	const plan = resolvePluginContributions({
		catalog: { schemaVersion: 1, revision: 1, installations: [item] },
		selection: stored,
		selectionRevision: 7,
		runtime: { adapterId: "pi", instanceId: "pi", capabilities: {} },
		services: { "pibo.chat.extensions": "1.0.0" },
		serviceProviders: { "pibo.chat.extensions": "core" },
	});
	assert.equal(plan.contributions.some((candidate) => candidate.id === "pibo.web-annotations/annotations"), false);
	assert.equal(entry.explicitContributions.annotations, false, "resolution never reactivates an explicit stored disable");
});
