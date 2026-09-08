import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createOmpPrefixBootstrapSource } from "../dist/agent-runtimes/omp/prefix-bootstrap.js";
import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";

const bun = process.env.PIBO_OMP_PREFIX_BUN;
test("Bun native ownership survives parent SIGKILL and excludes Node and native competitors", { skip: !bun, timeout: 30000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "omp-native-owner-"));
	const ready = join(root, "native-ready");
	const entry = join(root, "native-entry.mjs");
	const bootstrap = join(root, "bootstrap.mjs");
	const launcher = join(root, "parent.mjs");
	const identities = [JSON.stringify(["pibo", "ps_fixture"]), JSON.stringify(["native", "orp", "native-fixture"])];
	let parent, childPid, competitor;
	t.after(async () => {
		parent?.kill("SIGKILL"); competitor?.kill("SIGKILL");
		if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch {} }
		await rm(root, { recursive: true, force: true });
	});
	await writeFile(entry, `import { writeFile } from "node:fs/promises";
export async function runCli() {
  await writeFile(${JSON.stringify(ready)}, String(process.pid), { flag: "wx" });
  setInterval(() => {}, 1000);
}
`);
	await writeFile(bootstrap, createOmpPrefixBootstrapSource({ entryModuleUrl: pathToFileURL(entry).href, prefixRoot: root, identities }));
	await writeFile(launcher, `import { spawn } from "node:child_process";
const child = spawn(${JSON.stringify(bun)}, [${JSON.stringify(bootstrap)}], { stdio: "ignore" });
process.stdout.write(String(child.pid) + "\\n");
setInterval(() => {}, 1000);
`);
	parent = spawn(process.execPath, [launcher], { stdio: ["ignore", "pipe", "pipe"] });
	childPid = Number(String((await once(parent.stdout, "data"))[0]).trim());
	assert.ok(Number.isInteger(childPid) && childPid > 0);
	const deadline = Date.now() + 10000;
	while (true) {
		try { assert.equal(Number(await readFile(ready, "utf8")), childPid); break; }
		catch (error) { if (Date.now() >= deadline) throw error; await delay(20); }
	}
	const parentExited = once(parent, "exit");
	parent.kill("SIGKILL");
	assert.equal((await parentExited)[1], "SIGKILL");
	assert.doesNotThrow(() => process.kill(childPid, 0));
	await assert.rejects(PrefixSessionOwnership.acquire(root, identities), /already held/);
	competitor = spawn(bun, [bootstrap], { stdio: ["ignore", "ignore", "pipe"] });
	let diagnostic = "";
	competitor.stderr.on("data", chunk => { diagnostic += chunk; });
	assert.equal((await once(competitor, "exit"))[0], 78);
	assert.equal(diagnostic.trim(), "Pibo native prefix recovery required: ownership");
	assert.equal(Number(await readFile(ready, "utf8")), childPid, "competing native entry must not load history");
	process.kill(childPid, "SIGKILL");
	let ownership;
	const releaseDeadline = Date.now() + 5000;
	while (!ownership) {
		try { ownership = await PrefixSessionOwnership.acquire(root, identities); }
		catch (error) { if (Date.now() >= releaseDeadline) throw error; await delay(20); }
	}
	ownership.release();
	childPid = undefined;
});
