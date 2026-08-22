import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const piboBin = fileURLToPath(new URL("../dist/bin/pibo.js", import.meta.url));

test("tui:routed --help exits successfully and lists local routed options", async () => {
	const { stdout, stderr } = await execFileAsync(process.execPath, [piboBin, "tui:routed", "--help"]);
	const output = `${stdout}\n${stderr}`;

	assert.match(output, /Usage: pibo tui:routed \[options\] \[profile\]/);
	assert.match(output, /Start the local routed Pibo TUI/);
	assert.match(output, /--show-thinking/);
	assert.match(output, /--thinking <level>/);
	assert.doesNotMatch(output, /unknown option/);
});
