import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrefixCapsuleStore, readSessionPrefixBinding } from "../dist/sessions/prefix-capsule.js";
import { createInitialRuntimeSessionBinding, nextRuntimeSessionBinding } from "../dist/sessions/runtime-binding.js";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return { root, store: new PrefixCapsuleStore(root) };
}

test("opaque capsule preserves exact bytes, ordering and large payload across store restart", async t => {
	const { root, store } = await fixture(t);
	const payload = '{"z":"' + "漢字\r\n".repeat(50_000).replaceAll("\r", "\\r").replaceAll("\n", "\\n") + '","a": 1}';
	const ref = await store.put("pi", "pi-v1", payload);
	assert.equal(await new PrefixCapsuleStore(root).read(ref, { adapterId: "pi", codec: "pi-v1" }), payload);
	assert.deepEqual(await readdir(root), [`${ref.digest}.capsule`]);
});

test("concurrent publication never overwrites an artifact and cleans preparing files", async t => {
	const { root, store } = await fixture(t);
	const refs = await Promise.all(Array.from({ length: 16 }, () => store.put("pi", "v1", "immutable")));
	assert.equal(new Set(refs.map(ref => ref.digest)).size, 1);
	assert.equal((await readdir(root)).length, 1);
});

test("missing, corrupt, incompatible, and symlinked capsules fail closed", async t => {
	const { root, store } = await fixture(t);
	const ref = await store.put("pi", "v1", "original");
	const path = join(root, `${ref.digest}.capsule`);
	await assert.rejects(store.read(ref, { adapterId: "omp", codec: "v1" }), /incompatible/);
	await assert.rejects(store.read({ ...ref, bytes: ref.bytes + 1 }, { adapterId: "pi", codec: "v1" }), /recovery required/);
	await writeFile(path, "tampered");
	await assert.rejects(store.read(ref, { adapterId: "pi", codec: "v1" }), /recovery required/);
	await assert.rejects(store.put("pi", "v1", "original"), /recovery required/);
	assert.equal(await readFile(path, "utf8"), "tampered");
	await rm(path);
	await assert.rejects(store.read(ref, { adapterId: "pi", codec: "v1" }), /recovery required/);
	await writeFile(join(root, "target"), "original");
	await symlink(join(root, "target"), path);
	await assert.rejects(store.read(ref, { adapterId: "pi", codec: "v1" }), /recovery required/);
});

test("invalid protected metadata never becomes legacy absence", () => {
	assert.equal(readSessionPrefixBinding({}), undefined);
	for (const value of [null, {}, { format: 2 }, "", false]) {
		assert.throws(() => readSessionPrefixBinding({ piboSessionPrefix: value }), /recovery required/);
	}
});

test("runtime CAS rejects silent removal, same-epoch mutation and skipped epoch", async t => {
	const { store } = await fixture(t);
	const capsule = await store.put("pi", "v1", "prefix");
	const prefix = { format: 1, epoch: 1, status: "sealed", capsule, reason: "initial", nativeSessionId: "native", evidence: "adapter-inputs" };
	const current = { piboSessionId: "ps_test", runtimeInstanceId: "pi", adapterId: "pi", nativeSessionId: "native", state: "bound", revision: 1, metadata: { piboSessionPrefix: prefix } };
	assert.throws(() => nextRuntimeSessionBinding(current, { ...current, metadata: {} }), /cannot be silently discarded/);
	for (const changed of [{ ...prefix, evidence: "provider-request" }, { ...prefix, epoch: 3, reason: "compaction" }]) {
		assert.throws(() => nextRuntimeSessionBinding(current, { ...current, metadata: { piboSessionPrefix: changed } }));
	}
	const next = nextRuntimeSessionBinding(current, { ...current, metadata: { piboSessionPrefix: { ...prefix, epoch: 2, reason: "compaction" } } }, { expectedRevision: 1 });
	assert.equal(next.revision, 2);
	assert.equal(next.metadata.piboSessionPrefix.capsule.digest, capsule.digest);
	assert.throws(() => nextRuntimeSessionBinding(next, next, { expectedRevision: 1 }), /changed concurrently/);
	const reordered = Object.fromEntries(Object.entries(prefix).reverse());
	reordered.capsule = Object.fromEntries(Object.entries(capsule).reverse());
	assert.doesNotThrow(() => nextRuntimeSessionBinding(current, { ...current, metadata: { piboSessionPrefix: reordered } }));
	assert.throws(() => createInitialRuntimeSessionBinding("ps_import", { ...current, nativeSessionId: "other" }), /disagree/);
	assert.throws(() => createInitialRuntimeSessionBinding("ps_import", { ...current, metadata: { piboSessionPrefix: {} } }), /recovery required/);
});

test("publication supports newly created nested directories and bounds metadata", async t => {
	const { root } = await fixture(t);
	const store = new PrefixCapsuleStore(join(root, "new", "nested", "artifacts"));
	const refs = await Promise.all(Array.from({ length: 8 }, () => store.put("pi", "v1", "nested")));
	assert.equal(await store.read(refs[0], { adapterId: "pi", codec: "v1" }), "nested");
	await assert.rejects(store.put("pi", "x".repeat(257), "prefix"), /recovery required/);
});


test("all production adapter open paths reject sealed state until complete restore is available", async () => {
	const { PI_AGENT_RUNTIME_DRIVER } = await import("../dist/agent-runtimes/pi/adapter.js");
	const { OMP_AGENT_RUNTIME_DRIVER } = await import("../dist/agent-runtimes/omp/adapter.js");
	const { CODEX_NATIVE_AGENT_RUNTIME_DRIVER } = await import("../dist/agent-runtimes/codex-native/adapter.js");
	for (const driver of [PI_AGENT_RUNTIME_DRIVER, OMP_AGENT_RUNTIME_DRIVER, CODEX_NATIVE_AGENT_RUNTIME_DRIVER]) {
		const adapter = driver.create({ instanceId: driver.descriptor.id, displayName: "Prefix recovery fixture", enabled: true, config: driver.defaultConfig() });
		const prefix = { format: 1, epoch: 1, status: "sealed", reason: "initial", nativeSessionId: "native", evidence: "adapter-inputs", capsule: { format: 1, digest: "a".repeat(64), bytes: 1, adapterId: driver.descriptor.id, codec: "v1" } };
		// Deliberately omit sources and process configuration: rejection must happen
		// before loading current files, spawning a harness or attempting dispatch.
		await assert.rejects(adapter.openSession({ binding: { metadata: { piboSessionPrefix: prefix } } }), /compatible reader/);
		await assert.rejects(adapter.openSession({ binding: { metadata: { piboSessionPrefix: {} } } }), /recovery required/);
	}
});
