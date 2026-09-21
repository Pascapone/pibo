import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PRELUDE = `
	import assert from "node:assert/strict";
	const { CoreAttachmentDraftStore } = await import("./src/apps/chat-ui/src/attachments/core-attachment-draft.ts");
	function createMemoryStorage() {
		const entries = new Map();
		return {
			entries,
			readText: (key) => (entries.has(key) ? entries.get(key) : null),
			writeText: (key, value) => { entries.set(key, value); },
			removeText: (key) => { entries.delete(key); },
		};
	}
	function createIdSequence(prefix) {
		let next = 0;
		return () => prefix + "_" + (++next);
	}
	async function rejectsWithCode(promise, code) {
		try {
			await promise;
		} catch (error) {
			assert.equal(error.name, "AttachmentDraftError");
			assert.equal(error.code, code);
			return error;
		}
		assert.fail("expected rejection with " + code);
	}
	function throwsWithCode(fn, code) {
		try {
			fn();
		} catch (error) {
			assert.equal(error.name, "AttachmentDraftError");
			assert.equal(error.code, code);
			return error;
		}
		assert.fail("expected throw with " + code);
	}
`;

const ADD_RELOAD_SNAPSHOT_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const fixedNow = "2026-09-21T11:10:00.000Z";
	const store = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => fixedNow, createId: createIdSequence("att_d1") });
	assert.equal(store.boundSessionId, "ps_d1");
	assert.equal(store.storageError, undefined);

	const source = { title: "Kept", text: "Stand beim Anhaengen.", nested: { count: 1 } };
	const noteId = await store.add({ sessionId: "ps_d1", type: "pibo.core/note", schemaVersion: 1, payload: source, uiState: { previewOpen: true } });
	source.text = "MUTATED";
	source.nested.count = 999;
	const stored = store.get(noteId);
	assert.deepEqual(stored.payload, { title: "Kept", text: "Stand beim Anhaengen.", nested: { count: 1 } });
	assert.deepEqual(stored.envelope, {
		formatVersion: 1,
		id: "att_d1_1",
		sessionId: "ps_d1",
		type: "pibo.core/note",
		schemaVersion: 1,
		revision: 1,
		createdAt: fixedNow,
		updatedAt: fixedNow,
	});
	assert.equal(stored.status, "ready");

	const imageId = await store.add({
		sessionId: "ps_d1",
		type: "pibo.core/image",
		schemaVersion: 1,
		payload: { title: "shot" },
		media: { draftResourceId: "upl_d1_1", mimeType: "image/png", bytes: 12345 },
	});
	assert.equal(imageId, "att_d1_2");

	const reloaded = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => fixedNow, createId: createIdSequence("att_d1_reload") });
	assert.equal(reloaded.storageError, undefined);
	assert.deepEqual(reloaded.list(), store.list());
	assert.deepEqual(reloaded.get(imageId).media, { draftResourceId: "upl_d1_1", mimeType: "image/png", bytes: 12345 });

	const stale = await rejectsWithCode(reloaded.update(noteId, 999, { payload: {} }), "ATT_STALE_REVISION");
	assert.match(stale.message, /revision 1, not 999/);
	await rejectsWithCode(reloaded.update("att_unknown", 1, { payload: {} }), "ATT_STALE_REVISION");

	await reloaded.update(noteId, 1, { uiState: { previewOpen: false } });
	assert.equal(reloaded.get(noteId).envelope.revision, 1);
	assert.deepEqual(reloaded.get(noteId).uiState, { previewOpen: false });

	await reloaded.update(noteId, 1, { payload: { title: "Edited" } });
	assert.equal(reloaded.get(noteId).envelope.revision, 2);
	assert.deepEqual(reloaded.get(noteId).payload, { title: "Edited" });
	const reloadedAgain = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => fixedNow });
	assert.equal(reloadedAgain.get(noteId).envelope.revision, 2);
	assert.deepEqual(reloadedAgain.get(noteId).payload, { title: "Edited" });

	const before = reloadedAgain.list().length;
	await rejectsWithCode(reloadedAgain.add({ sessionId: "ps_d1", type: "pibo.core/note", schemaVersion: 1, payload: { fn: () => 1 } }), "ATT_INVALID_JSON");
	await rejectsWithCode(reloadedAgain.add({ sessionId: "ps_d1", type: "pibo.core/note", schemaVersion: 1, payload: { n: Number.NaN } }), "ATT_INVALID_JSON");
	await rejectsWithCode(reloadedAgain.add({ sessionId: "ps_d1", type: "pibo.core/image", schemaVersion: 1, payload: {}, media: { draftResourceId: "upl_x", mimeType: "image/png", bytes: -1 } }), "ATT_INVALID_JSON");
	assert.equal(reloadedAgain.list().length, before);
	assert.deepEqual(reloadedAgain.list().map((record) => record.envelope.id), ["att_d1_1", "att_d1_2"]);
`;

const FREEZE_ACCEPTANCE_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => "2026-09-21T11:11:00.000Z", createId: createIdSequence("att_tx") });
	const idA = await store.add({ sessionId: "ps_d1", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const idB = await store.add({ sessionId: "ps_d1", type: "pibo.core/image", schemaVersion: 1, payload: { title: "shot" }, media: { draftResourceId: "upl_d1_9", mimeType: "image/png", bytes: 7 } });

	const snapshot = store.freezeForSend("txn_d1_1", "hello");
	assert.equal(snapshot.clientTxnId, "txn_d1_1");
	assert.equal(snapshot.sessionId, "ps_d1");
	assert.equal(snapshot.text, "hello");
	assert.equal(snapshot.frozenAt, "2026-09-21T11:11:00.000Z");
	assert.deepEqual(snapshot.attachments, [
		{ id: idA, revision: 1, type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } },
		{ id: idB, revision: 1, type: "pibo.core/image", schemaVersion: 1, payload: { title: "shot" }, media: { draftResourceId: "upl_d1_9", mimeType: "image/png", bytes: 7 } },
	]);

	await store.update(idA, 1, { payload: { v: 2 } });
	assert.deepEqual(snapshot.attachments[0], { id: idA, revision: 1, type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });

	const first = store.applyAcceptance(snapshot, { clientTxnId: "txn_d1_1", accepted: true });
	assert.deepEqual(first, { consumed: [idB], duplicate: false });
	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 2]]);

	const retry = store.applyAcceptance(snapshot, { clientTxnId: "txn_d1_1", accepted: true });
	assert.deepEqual(retry, { consumed: [], duplicate: true });
	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 2]]);

	throwsWithCode(() => store.freezeForSend("txn_d1_1", "changed"), "ATT_ACCEPTANCE_UNKNOWN");

	const snapshot2 = store.freezeForSend("txn_d1_2", "again");
	throwsWithCode(() => store.applyAcceptance(snapshot2, { clientTxnId: "txn_d1_other", accepted: true }), "ATT_ACCEPTANCE_UNKNOWN");
	throwsWithCode(() => store.applyAcceptance(snapshot2, { clientTxnId: "txn_d1_2", accepted: false }), "ATT_ACCEPTANCE_UNKNOWN");
	assert.equal(store.list().length, 1);
	const second = store.applyAcceptance(snapshot2, { clientTxnId: "txn_d1_2", accepted: true });
	assert.deepEqual(second, { consumed: [idA], duplicate: false });
	assert.deepEqual(store.list(), []);

	throwsWithCode(() => store.freezeForSend("", "empty"), "ATT_INVALID_JSON");
	throwsWithCode(() => store.freezeForSend("x".repeat(161), "too long"), "ATT_INVALID_JSON");
	const emptyFreeze = store.freezeForSend("y".repeat(160), "max length ok");
	assert.deepEqual(emptyFreeze.attachments, []);

	const failingStorage = createMemoryStorage();
	let writes = 0;
	failingStorage.writeText = () => { writes += 1; throw new Error("disk full"); };
	const failingStore = new CoreAttachmentDraftStore(failingStorage, "ps_fail", { createId: createIdSequence("att_fail") });
	const storageError = await rejectsWithCode(failingStore.add({ sessionId: "ps_fail", type: "pibo.core/note", schemaVersion: 1, payload: {} }), "ATT_STORAGE_FAILED");
	assert.equal(storageError.retryable, true);
	assert.equal(failingStore.get("att_fail_1").status, "error");
	throwsWithCode(() => failingStore.freezeForSend("txn_blocked", "blocked"), "ATT_MATERIALIZE_FAILED");
`;

const SESSION_MEDIA_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const storeA = new CoreAttachmentDraftStore(storage, "ps_a", { createId: createIdSequence("att_a") });
	const storeB = new CoreAttachmentDraftStore(storage, "ps_b", { createId: createIdSequence("att_b") });
	const onlyA = await storeA.add({ sessionId: "ps_a", type: "pibo.core/note", schemaVersion: 1, payload: { owner: "a" } });
	assert.deepEqual(storeB.list(), []);
	assert.deepEqual([...storage.entries.keys()], ["pibo.chat.coreAttachments.draft.ps_a"]);
	await rejectsWithCode(storeA.add({ sessionId: "ps_b", type: "pibo.core/note", schemaVersion: 1, payload: {} }), "ATT_ACCESS_DENIED");
	throwsWithCode(() => new CoreAttachmentDraftStore(storage, ""), "ATT_ACCESS_DENIED");

	const secondA = await storeA.add({ sessionId: "ps_a", type: "pibo.core/image", schemaVersion: 1, payload: { title: "media" }, media: { draftResourceId: "upl_media_1", mimeType: "image/jpeg", bytes: 4242 } });
	await storeA.remove(onlyA);
	await storeA.remove("att_missing_is_fine");
	assert.deepEqual(storeA.list().map((record) => record.envelope.id), [secondA]);
	const reloadedA = new CoreAttachmentDraftStore(storage, "ps_a");
	assert.deepEqual(reloadedA.get(secondA).media, { draftResourceId: "upl_media_1", mimeType: "image/jpeg", bytes: 4242 });
	assert.deepEqual(reloadedA.get(secondA).payload, { title: "media" });

	storage.writeText("pibo.chat.coreAttachments.draft.ps_corrupt", "{not json");
	const corrupt = new CoreAttachmentDraftStore(storage, "ps_corrupt");
	assert.deepEqual(corrupt.list(), []);
	assert.equal(corrupt.storageError.code, "ATT_STORAGE_FAILED");

	storage.writeText("pibo.chat.coreAttachments.draft.ps_foreign", JSON.stringify([{ envelope: { formatVersion: 1, id: "att_f", sessionId: "ps_other", type: "t", schemaVersion: 1, revision: 1, createdAt: "x", updatedAt: "x" }, payload: {}, status: "ready" }]));
	const foreign = new CoreAttachmentDraftStore(storage, "ps_foreign");
	assert.deepEqual(foreign.list(), []);
	assert.equal(foreign.storageError.code, "ATT_STORAGE_FAILED");

	const failingStorage = createMemoryStorage();
	failingStorage.writeText = () => { throw new Error("read-only"); };
	const failingStore = new CoreAttachmentDraftStore(failingStorage, "ps_nopersist");
	await rejectsWithCode(failingStore.add({ sessionId: "ps_nopersist", type: "pibo.core/note", schemaVersion: 1, payload: { gone: true } }), "ATT_STORAGE_FAILED");
	const reloadedFailing = new CoreAttachmentDraftStore(failingStorage, "ps_nopersist");
	assert.deepEqual(reloadedFailing.list(), []);
	assert.equal(reloadedFailing.storageError, undefined);
`;

async function runScenario(script) {
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		timeout: 120000,
		maxBuffer: 8 * 1024 * 1024,
	});
}

test("core draft add persists reload-proof snapshots with exact revisions", async () => {
	await assert.doesNotReject(runScenario(ADD_RELOAD_SNAPSHOT_SCENARIO));
});

test("send freeze binds revisions to clientTxnId and acceptance consumes exactly once", async () => {
	await assert.doesNotReject(runScenario(FREEZE_ACCEPTANCE_SCENARIO));
});

test("draft sessions stay isolated and media survives reload", async () => {
	await assert.doesNotReject(runScenario(SESSION_MEDIA_SCENARIO));
});
