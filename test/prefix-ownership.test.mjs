import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";

test("ownership excludes concurrent generations and releases all partial claims", async t => {
	const root = await mkdtemp(join(tmpdir(), "prefix-ownership-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const first = await PrefixSessionOwnership.acquire(root, ["same-native"]);
	t.after(() => first.release());
	await assert.rejects(PrefixSessionOwnership.acquire(root, ["other-pibo", "same-native"]), /already held/);
	const moduleUrl = new URL("../dist/sessions/prefix-ownership.js", import.meta.url).href;
	await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
		import assert from "node:assert/strict";
		import { PrefixSessionOwnership } from ${JSON.stringify(moduleUrl)};
		await assert.rejects(PrefixSessionOwnership.acquire(process.env.PREFIX_TEST_ROOT, ["same-native"]), /already held/);
	`], { env: { ...process.env, PREFIX_TEST_ROOT: root } });
	const unrelated = await PrefixSessionOwnership.acquire(root, ["other-pibo"]);
	unrelated.release();
	first.release();
	const resumed = await PrefixSessionOwnership.acquire(root, ["same-native"]);
	resumed.release();
	resumed.release();
});

test("kernel releases native ownership after SIGKILL without timeout or stale-lock repair", { timeout: 10000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "prefix-owner-crash-"));
	const moduleUrl = new URL("../dist/sessions/prefix-ownership.js", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `
		import { PrefixSessionOwnership } from ${JSON.stringify(moduleUrl)};
		globalThis.ownership = await PrefixSessionOwnership.acquire(process.env.PREFIX_TEST_ROOT, ["same-native"]);
		process.send("locked");
		setInterval(() => {}, 60000);
	`], { env: { ...process.env, PREFIX_TEST_ROOT: root }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
	let diagnostic = "";
	child.stderr.on("data", chunk => { diagnostic += chunk; });
	t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await once(child, "exit"); } await rm(root, { recursive: true, force: true }); });
	await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error(`owner failed: ${diagnostic}`); })]);
	await assert.rejects(PrefixSessionOwnership.acquire(root, ["same-native"]), /already held/);
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
	const recovered = await PrefixSessionOwnership.acquire(root, ["same-native"]);
	recovered.release();
});
