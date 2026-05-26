import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("bundled rg wrapper executes ripgrep", () => {
	const output = execFileSync(process.execPath, ["dist/bin/rg.js", "--version"], { encoding: "utf8" });
	assert.match(output, /^ripgrep \d+\.\d+\.\d+/);
});
