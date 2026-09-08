import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { resolvePiPrefixTransition, createPiPrefixLifecycleExtension } from "../dist/agent-runtimes/pi/prefix-lifecycle.js";

for (const Store of [SqlitePiboSessionStore, PiboDataSessionStore]) {
	test(`${Store.name}: durable sealing, restart, epoch reuse and concurrent CAS`, async t => {
		const root = await mkdtemp(join(tmpdir(), "pibo-prefix-binding-"));
		let sessions = new Store(join(root, "sessions.sqlite"));
		t.after(async () => { sessions.close(); await rm(root, { recursive: true, force: true }); });
		const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
		sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
		const store = new PrefixCapsuleStore(join(root, "prefixes"));
		const makeController = (binding = sessions.get(session.id).runtimeBinding) => new SessionPrefixController({
			store, getBinding: () => binding,
			persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }),
		});
		const controller = makeController();
		const competitor = makeController();
		const input = { codec: "pi-v1", payload: "exact prefix\r\n", nativeSessionId: session.piSessionId, evidence: "adapter-inputs", hasHistoricalModelInput: false };
		assert.equal(await controller.restore("pi-v1"), undefined);
		const prefix = await controller.seal(input);
		assert.equal(prefix.epoch, 1);
		assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		await assert.rejects(competitor.seal({ ...input, payload: "racing replacement" }), /changed concurrently/);
		await assert.rejects(controller.seal({ ...input, payload: "changed" }), /already sealed/);
		sessions.close();
		sessions = new Store(join(root, "sessions.sqlite"));
		const resumed = makeController();
		assert.equal(await resumed.restore("pi-v1"), input.payload);
		assert.equal((await resumed.advanceEpoch("compaction")).capsule.digest, prefix.capsule.digest);
		assert.equal(resumed.binding.epoch, 2);
		const nativeFile = join(root, "native.jsonl");
		await writeFile(nativeFile, "durable fixture\n");
		const entries = new Map();
		let head = "before";
		const native = { sessionId: session.piSessionId, sessionManager: {
			getSessionFile: () => nativeFile, getLeafId: () => head, getEntry: id => entries.get(id),
		} };
		await resumed.beginCompaction(head);
		await assert.rejects(resumed.beginCompaction(head), /already pending/);
		const pendingBinding = sessions.get(session.id).runtimeBinding;
		await assert.rejects(Promise.resolve().then(() => sessions.updateRuntimeBinding(session.id, {
			...pendingBinding, metadata: { ...pendingBinding.metadata, piboSessionPrefixTransition: undefined },
		}, { expectedRevision: pendingBinding.revision })), /receipt|transition/);
		// Crash before native mutation: the cold controller aborts without advancing.
		let recovered = makeController();
		await resolvePiPrefixTransition(native, recovered);
		assert.equal(recovered.transition.state, "aborted");
		assert.equal(recovered.binding.epoch, 2);
		await recovered.beginCompaction(head);
		entries.set("compacted", { id: "compacted", parentId: head, type: "compaction" });
		head = "compacted";
		// Crash after native mutation and before the completion CAS.
		recovered = makeController();
		await Promise.all([resolvePiPrefixTransition(native, recovered), resolvePiPrefixTransition(native, recovered)]);
		assert.equal(recovered.transition.state, "completed");
		assert.equal(recovered.binding.epoch, 3);
		assert.equal(recovered.binding.capsule.digest, prefix.capsule.digest);
		await resolvePiPrefixTransition(native, recovered);
		assert.equal(recovered.binding.epoch, 3, "recovery must be idempotent");
		await recovered.beginCompaction(head);
		entries.set("unrelated", { id: "unrelated", parentId: head, type: "message" });
		head = "unrelated";
		await assert.rejects(resolvePiPrefixTransition(native, makeController()), /history changed/);
		assert.equal(makeController().transition.state, "pending");
		await assert.rejects(resumed.restore("pi-v2"), /unsupported runtime or codec/);
	});
}

test("Pi explicitly cancels compaction when the durable transition cannot be recorded", async () => {
	const handlers = new Map();
	createPiPrefixLifecycleExtension({ get transition() { throw new Error("persistence unavailable"); } }, () => ({}))({
		on: (name, callback) => handlers.set(name, callback),
	});
	assert.deepEqual(await handlers.get("session_before_compact")(), { cancel: true });
});

test("structural persistence cannot authorize a protected dispatch", () => {
	assert.throws(() => new SessionPrefixController({ getBinding() { throw new Error("unused"); }, persistence: { async compareAndSet(binding) { return binding; } } }), /audited/);
});

test("old history is never retrospectively sealed as an original prompt", async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-legacy-"));
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	t.after(async () => { sessions.close(); await rm(root, { recursive: true, force: true }); });
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	const controller = new SessionPrefixController({
		store: new PrefixCapsuleStore(join(root, "prefixes")), getBinding: () => session.runtimeBinding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id }),
	});
	await assert.rejects(controller.seal({ codec: "v1", payload: "today's prompt", nativeSessionId: session.piSessionId, evidence: "adapter-inputs", hasHistoricalModelInput: true }), /legacy history/);
	assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});
