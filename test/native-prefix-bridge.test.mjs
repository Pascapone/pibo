import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NativePrefixBridge } from "../dist/sessions/native-prefix-bridge.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";

async function fixture(t, brokenStore = false) {
	const root = await mkdtemp(join(tmpdir(), "native-prefix-bridge-"));
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	let binding = sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
	const path = join(root, "prefixes");
	if (brokenStore) await writeFile(path, "unavailable directory");
	const controller = new SessionPrefixController({ store: new PrefixCapsuleStore(path), getBinding: () => binding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	const bridge = new NativePrefixBridge(controller, "native-fixture/v1");
	const connection = await bridge.start();
	t.after(async () => { await bridge.dispose(); sessions.close(); await rm(root, { recursive: true, force: true }); });
	const headers = { authorization: `Bearer ${connection.token}`, "x-native-session-id": session.piSessionId, "x-native-has-history": "false" };
	return { sessions, session, connection, headers, controller, bridge };
}

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

test("native capture IPC refuses dispatch when publication succeeds but the binding CAS loses", async t => {
	const f = await fixture(t);
	const current = f.sessions.get(f.session.id).runtimeBinding;
	f.sessions.updateRuntimeBinding(f.session.id, { ...current, metadata: { externalChange: true } }, { expectedRevision: current.revision });
	const response = await fetch(`${f.connection.endpoint}/seal`, { method: "POST", headers: f.headers, body: "published but unbound" });
	assert.equal(response.status, 409);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});
