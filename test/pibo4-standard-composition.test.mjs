import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { standardPluginCoordinates } from "../dist/plugins/default-packages.js";
import { assertStandardPluginComposition } from "../scripts/pibo4-composition-check.mjs";

// Canonical Pibo Standard composition: every default package as one packed
// plugin coordinate, in default-packages.ts descriptor order. This literal
// roster is the single pinned expectation; the build gates compare the built
// artifacts against the same authority, so a dropped row fails instead of
// silently shrinking the product.
const EXPECTED_STANDARD_PLUGINS = [
	{ package: "@pasko70/pibo-plugin-preview", pluginId: "pibo.preview", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-vscode-web", pluginId: "pibo.vscode-web", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-cron", pluginId: "pibo.cron", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-remote-agent", pluginId: "pibo.remote-agent", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-workflows", pluginId: "pibo.workflows", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-transcription-openai-chatgpt", pluginId: "pibo.transcription.openai-chatgpt", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-transcription-openai", pluginId: "pibo.transcription.openai", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-web-annotations", pluginId: "pibo.web-annotations", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-code-runtime", pluginId: "pibo.code-runtime", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-file-editing", pluginId: "pibo.file-editing", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-web-search", pluginId: "pibo.web-search", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-browser-tools", pluginId: "pibo.browser-tools", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-gateway-tools", pluginId: "pibo.gateway-tools", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-codex-compat", pluginId: "pibo.codex-compat", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-run-control", pluginId: "pibo.run-control", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-goal-loops", pluginId: "pibo.goal-control", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-standard-profiles", pluginId: "pibo.builtin-profiles", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-runtime-pi", pluginId: "pibo.runtime-pi", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-runtime-codex-native", pluginId: "pibo.runtime-codex-native", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-runtime-muse-native", pluginId: "pibo.runtime-muse-native", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-runtime-omp", pluginId: "pibo.runtime-omp", version: "1.0.0" },
	{ package: "@pasko70/pibo-plugin-mcp-cli", pluginId: "pibo.mcp-cli", version: "1.0.0" },
];

test("canonical Standard composition pins all 22 default plugin packages including Remote Agent", () => {
	assert.equal(EXPECTED_STANDARD_PLUGINS.length, 22);
	assert.deepEqual(standardPluginCoordinates(), EXPECTED_STANDARD_PLUGINS);
});

test("built Standard package set matches the canonical composition exactly", async () => {
	const set = JSON.parse(await readFile("dist/pibo4-artifacts/standard-package-set.json", "utf8"));
	assert.equal(set.schemaVersion, 1);
	assert.equal(set.core, "@pasko70/pibo");
	assert.equal(set.standard, "@pasko70/pibo-standard");
	assert.equal(assertStandardPluginComposition(set.plugins, EXPECTED_STANDARD_PLUGINS), 22);
});

test("built Candidate assembly carries one artifact per canonical plugin package", async () => {
	const manifest = JSON.parse(await readFile("dist/pibo4-candidate-assembly/assembly-manifest.json", "utf8"));
	const pluginPackages = manifest.artifacts.filter((entry) => entry.role === "plugin").map((entry) => entry.package).sort();
	assert.deepEqual(pluginPackages, EXPECTED_STANDARD_PLUGINS.map((entry) => entry.package).sort());
	assert.equal(manifest.artifacts.length, EXPECTED_STANDARD_PLUGINS.length + 5);
});

test("composition check rejects missing, unexpected, duplicated, and version-mismatched entries", () => {
	assert.throws(
		() => assertStandardPluginComposition(EXPECTED_STANDARD_PLUGINS.filter((entry) => entry.pluginId !== "pibo.remote-agent"), EXPECTED_STANDARD_PLUGINS),
		/missing @pasko70\/pibo-plugin-remote-agent \(pibo\.remote-agent\)/,
	);
	assert.throws(
		() => assertStandardPluginComposition([...EXPECTED_STANDARD_PLUGINS, { package: "@pasko70/pibo-plugin-extra", pluginId: "pibo.extra", version: "1.0.0" }], EXPECTED_STANDARD_PLUGINS),
		/unexpected @pasko70\/pibo-plugin-extra \(pibo\.extra\)/,
	);
	assert.throws(
		() => assertStandardPluginComposition([...EXPECTED_STANDARD_PLUGINS, EXPECTED_STANDARD_PLUGINS[0]], EXPECTED_STANDARD_PLUGINS),
		/duplicate package @pasko70\/pibo-plugin-preview/,
	);
	assert.throws(
		() => assertStandardPluginComposition(
			[...EXPECTED_STANDARD_PLUGINS, { package: "@pasko70/pibo-plugin-extra", pluginId: "pibo.preview", version: "1.0.0" }],
			EXPECTED_STANDARD_PLUGINS,
		),
		/duplicate plugin id pibo\.preview/,
	);
	assert.throws(
		() => assertStandardPluginComposition(
			EXPECTED_STANDARD_PLUGINS.map((entry) => entry.pluginId === "pibo.cron" ? { ...entry, version: "1.0.1" } : entry),
			EXPECTED_STANDARD_PLUGINS,
		),
		/@pasko70\/pibo-plugin-cron: expected pibo\.cron@1\.0\.0, found pibo\.cron@1\.0\.1/,
	);
	assert.throws(
		() => assertStandardPluginComposition([{ package: "@pasko70/pibo-plugin-preview", pluginId: "pibo.preview" }], EXPECTED_STANDARD_PLUGINS),
		/malformed plugin entries/,
	);
	assert.equal(assertStandardPluginComposition([...EXPECTED_STANDARD_PLUGINS].reverse(), EXPECTED_STANDARD_PLUGINS), 22);
});
