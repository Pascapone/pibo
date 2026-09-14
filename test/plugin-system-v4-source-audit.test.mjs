import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sourceFiles(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
	});
}

test("Pibo 4 production source has no executable legacy plugin composition entry points", () => {
	const forbidden = [
		"createDefaultPiboPluginRegistry",
		"createGatewayProducerPiboPluginRegistry",
		"createWebPiboPluginRegistry",
		"createPiboLoopPlugin",
		"createPiboUserProfileResourcePlugins",
		"piboCorePlugin",
		"currentLoopService",
		"getPiboLoopService",
		"configurePiboGoalToolStorePath",
		"compatibilityRuntimeRegistry",
		"createDefaultPiboSessionStore",
	];
	const findings = [];
	for (const path of sourceFiles("src")) {
		const text = readFileSync(path, "utf8");
		for (const symbol of forbidden) if (text.includes(symbol)) findings.push(`${path}: ${symbol}`);
		if (path !== "src/plugins/registry.ts" && /definePiboPlugin|\.registerPlugin\(/.test(text)) findings.push(`${path}: executable legacy plugin registration`);
		if (/export (?:const \w*Plugin\s*=|function createPibo\w+Plugin\b)/.test(text)) findings.push(`${path}: exported legacy plugin constructor`);
	}
	assert.deepEqual(findings, []);
	assert.equal(existsSync("src/plugins/user-profile-resources.ts"), false);
	assert.equal(existsSync("src/plugins/openai-chatgpt-transcription.ts"), false);
	assert.equal(existsSync("src/plugins/openai-transcription.ts"), false);
	assert.doesNotMatch(readFileSync("src/index.ts", "utf8"), /createLegacyPiRuntimeSessionBinding/);
});

test("Runtime Request ownership is supplied by Codex Native rather than Core", () => {
	const core = readFileSync("src/plugins/builtin.ts", "utf8");
	const defaults = readFileSync("src/plugins/default-packages.ts", "utf8");
	const codex = readFileSync("src/agent-runtimes/codex-native/gateway-actions.ts", "utf8");
	assert.doesNotMatch(core, /runtime\.approval\.respond|runtime\.user_input\.respond/);
	assert.match(codex, /runtime\.approval\.respond/);
	assert.match(codex, /runtime\.user_input\.respond/);
	assert.match(defaults, /pibo\.runtime-codex-native/);
	assert.match(defaults, /RuntimeRequestsView/);
});

test("debug adapter lookup resolves enabled installed runtime packages without static runtime imports", () => {
	for (const path of ["src/debug/trace.ts", "src/debug/output-repair.ts"]) {
		const text = readFileSync(path, "utf8");
		assert.match(text, /withInstalledRuntimeAdapter/);
		assert.doesNotMatch(text, /packaged-runtime-adapters|agent-runtimes\/(?:pi|codex-native|omp)/);
	}
	const resolver = readFileSync("src/debug/installed-runtime-adapter.ts", "utf8");
	assert.match(resolver, /candidate\.manifest\.contributions\.some/);
	assert.match(resolver, /contribution\.kind === "agent-runtime-instance"/);
	assert.doesNotMatch(resolver, /agent-runtimes\/(?:pi|codex-native|omp)|createBuiltinRuntimeAdapter/);
});
