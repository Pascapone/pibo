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

test("debug adapter lookup uses packaged runtime definitions rather than a default registry", () => {
	for (const path of ["src/debug/trace.ts", "src/debug/output-repair.ts"]) {
		const text = readFileSync(path, "utf8");
		assert.match(text, /createBuiltinRuntimeAdapter/);
		assert.doesNotMatch(text, /PiboPluginRegistry|createDefaultPiboPluginRegistry/);
	}
});
