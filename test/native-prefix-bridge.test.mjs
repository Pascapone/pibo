import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NativePrefixBridge } from "../dist/sessions/native-prefix-bridge.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { NativePrefixStartupGate } from "../dist/sessions/native-prefix-startup.js";
import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";
import { createOmpPrefixBootstrapSource } from "../dist/agent-runtimes/omp/prefix-bootstrap.js";

async function fixture(t, brokenStore = false, startup) {
	const root = await mkdtemp(join(tmpdir(), "native-prefix-bridge-"));
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	let binding = sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
	const path = join(root, "prefixes");
	if (brokenStore) await writeFile(path, "unavailable directory");
	const controller = new SessionPrefixController({ store: new PrefixCapsuleStore(path), getBinding: () => binding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	const bridge = new NativePrefixBridge(controller, "native-fixture/v1", startup);
	const connection = await bridge.start();
	t.after(async () => { await bridge.dispose(); sessions.close(); await rm(root, { recursive: true, force: true }); });
	const headers = { authorization: `Bearer ${connection.token}`, "x-native-session-id": session.piSessionId, "x-native-has-history": "false" };
	return { root, sessions, session, connection, headers, controller, bridge };
}

test("native startup gate authenticates, bounds activation and releases a cancelled preparation", { timeout: 10000 }, async t => {
	const gate = new NativePrefixStartupGate(5000);
	const f = await fixture(t, false, gate);
	assert.throws(() => gate.activate([]), /not awaiting/);
	assert.equal((await fetch(f.connection.endpoint + "/activate")).status, 403);
	const pending = fetch(f.connection.endpoint + "/activate", { headers: f.headers });
	await gate.waitForOwnership();
	assert.equal((await fetch(f.connection.endpoint + "/activate", { headers: f.headers })).status, 409);
	assert.throws(() => gate.activate(["x".repeat(65536)]), /Invalid/);
	assert.throws(() => gate.activate(["bad\0argument"]), /Invalid/);
	gate.dispose();
	assert.equal((await pending).status, 409);
	assert.throws(() => gate.activate([]), /not awaiting/);
	await assert.rejects(gate.waitForOwnership(), /failed/);
});

test("native startup preparation has a bounded deadline even without a child", async () => {
	const gate = new NativePrefixStartupGate(10);
	await assert.rejects(gate.waitForOwnership(), /failed/);
	gate.dispose();
});

const bun = process.env.PIBO_OMP_PREFIX_BUN;
for (const activate of [true, false]) test(`native child holds ownership before parent resource preparation; activation=${activate}`, { skip: !bun, timeout: 15000 }, async t => {
	const gate = new NativePrefixStartupGate(10000);
	const f = await fixture(t, false, gate);
	const marker = join(f.root, "native-imported");
	const prepared = join(f.root, "resources-prepared");
	const entry = join(f.root, "entry.mjs");
	const bootstrap = join(f.root, "bootstrap.mjs");
	await writeFile(entry, `import { readFile, writeFile } from "node:fs/promises";
await readFile(${JSON.stringify(prepared)});
await writeFile(${JSON.stringify(marker)}, "imported");
export async function runCli(args) { process.stdout.write(JSON.stringify(args)); }
`);
	const identities = [JSON.stringify(["pibo", f.session.id])];
	await writeFile(bootstrap, createOmpPrefixBootstrapSource({ entryModuleUrl: pathToFileURL(entry).href,
		prefixRoot: f.root, identities, waitForActivation: true }));
	const child = spawn(bun, [bootstrap, "must-not-be-used"], { env: { ...process.env,
		PIBO_PREFIX_ENDPOINT: f.connection.endpoint, PIBO_PREFIX_TOKEN: f.connection.token }, stdio: ["ignore", "pipe", "pipe"] });
	t.after(() => child.kill("SIGKILL"));
	let stdout = "", stderr = "";
	child.stdout.on("data", data => { stdout += data; });
	child.stderr.on("data", data => { stderr += data; });
	const exited = once(child, "exit");
	await gate.waitForOwnership();
	await assert.rejects(readFile(marker), { code: "ENOENT" });
	await assert.rejects(PrefixSessionOwnership.acquire(f.root, identities), /already held/);
	if (activate) {
		await writeFile(prepared, "ready");
		gate.activate(["--mode", "rpc", "literal $() `text`"]);
		assert.throws(() => gate.activate([]), /not awaiting/);
		assert.equal((await exited)[0], 0);
		assert.deepEqual(JSON.parse(stdout), ["--mode", "rpc", "literal $() `text`"]);
		assert.equal(await readFile(marker, "utf8"), "imported");
	} else {
		await f.bridge.dispose();
		assert.equal((await exited)[0], 78);
		await assert.rejects(readFile(marker), { code: "ENOENT" });
		assert.equal(stderr.trim(), "Pibo native prefix recovery required: native-entry");
	}
	const owner = await PrefixSessionOwnership.acquire(f.root, identities);
	owner.release();
	assert.equal(stdout.includes(f.connection.token), false);
	assert.equal(stderr.includes(f.connection.token), false);
});

test("native capture IPC acknowledges only a durably bound original snapshot", async t => {
	const f = await fixture(t);
	const url = f.connection.endpoint;
	assert.equal((await fetch(`${url}/snapshot`)).status, 403);
	assert.equal((await fetch(`${url}/snapshot`, { headers: f.headers })).status, 404);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: { ...f.headers, "x-native-has-history": "true" }, body: "legacy" })).status, 409);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: { ...f.headers, "x-native-session-id": "wrong" }, body: "wrong identity" })).status, 409);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: Buffer.from([0xff]) })).status, 409);
	assert.equal(f.controller.binding, undefined);
	const payload = JSON.stringify({ format: 1, instructions: "private native prefix", tools: [] });
	const response = await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: payload });
	assert.equal(response.status, 200);
	const ack = await response.json();
	assert.equal(ack.digest, f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix.capsule.digest);
	assert.equal(await (await fetch(`${url}/snapshot`, { headers: f.headers })).text(), payload);
	const rejected = await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: "replacement secret" });
	assert.equal(rejected.status, 409);
	assert.equal(await rejected.text(), "prefix-recovery-required");
	assert.equal(await f.controller.restore("native-fixture/v1"), payload);
});

test("native capture IPC never acknowledges failed snapshot persistence", async t => {
	const f = await fixture(t, true);
	const response = await fetch(`${f.connection.endpoint}/seal`, { method: "POST", headers: f.headers, body: "must not dispatch" });
	assert.equal(response.status, 409);
	assert.equal(f.controller.binding, undefined);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});

test("native transition IPC commits bounded receipts before acknowledging compaction", async t => {
	const f = await fixture(t);
	const send = (path, body) => fetch(f.connection.endpoint + path, { method: "POST", headers: f.headers, body: JSON.stringify(body) });
	assert.equal((await send("/compaction/begin", { sourceHead: "head" })).status, 409);
	assert.equal((await fetch(f.connection.endpoint + "/seal", { method: "POST", headers: f.headers, body: "original" })).status, 200);
	assert.equal((await send("/compaction/begin", { sourceHead: "head", unexpected: true })).status, 409);
	assert.equal((await send("/compaction/begin", { sourceHead: "x".repeat(5000) })).status, 413);
	const pending = await (await send("/compaction/begin", { sourceHead: "head" })).json();
	assert.equal(pending.state, "pending");
	assert.deepEqual(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefixTransition, pending);
	assert.equal((await send("/compaction/finish", { id: "wrong", changed: true })).status, 409);
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: "true" })).status, 409);
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: true })).status, 200);
	assert.equal(f.controller.binding.epoch, 2);
	assert.equal(await f.controller.restore("native-fixture/v1"), "original");
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: true })).status, 409);
	const receipt = await (await fetch(f.connection.endpoint + "/transition", { headers: f.headers })).json();
	assert.equal(receipt.state, "completed");
});

test("native capture IPC refuses dispatch when publication succeeds but the binding CAS loses", async t => {
	const f = await fixture(t);
	const current = f.sessions.get(f.session.id).runtimeBinding;
	f.sessions.updateRuntimeBinding(f.session.id, { ...current, metadata: { externalChange: true } }, { expectedRevision: current.revision });
	const response = await fetch(`${f.connection.endpoint}/seal`, { method: "POST", headers: f.headers, body: "published but unbound" });
	assert.equal(response.status, 409);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});
