import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixtureConfigPath = fileURLToPath(new URL("./fixtures/tsconfig.agents-controller-compat.json", import.meta.url));
const compilerPath = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("legacy agents-controller input and result shapes remain TypeScript-compatible", () => {
	const result = spawnSync(process.execPath, [
		"--max-old-space-size=1200",
		compilerPath,
		"--project", fixtureConfigPath,
	], {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
