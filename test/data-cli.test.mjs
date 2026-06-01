import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

test("pibo data inventory is read-only and reports missing stores", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-inventory-"));
	try {
		const result = await execFileAsync("node", [cliPath, "data", "inventory", "--root", root, "--json"]);
		const parsed = JSON.parse(result.stdout);
		assert.ok(Array.isArray(parsed.stores));
		assert.ok(parsed.stores.some((store) => store.name === "v2" && store.exists === false));
		assert.ok(parsed.stores.some((store) => store.name === "legacy-chat" && store.exists === false));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

