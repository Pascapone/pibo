import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PRELUDE = `
	import assert from "node:assert/strict";
	const { CoreAttachmentDraftStore, normalizeDraftClientTxnId } = await import("./src/apps/chat-ui/src/attachments/core-attachment-draft.ts");
	function createMemoryStorage() {
		const entries = new Map();
		const storage = {
			entries,
			writes: 0,
			readText: (key) => (entries.has(key) ? entries.get(key) : null),
			writeText: (key, value) => { storage.writes += 1; entries.set(key, value); },
			removeText: (key) => { entries.delete(key); },
		};
		return storage;
	}
	function createIdSequence(prefix) {
		let next = 0;
		return () => prefix + "_" + (++next);
	}
	function readRecords(storage, sessionId) {
		const raw = storage.entries.get("pibo.chat.coreAttachments.draft." + sessionId);
		assert.ok(raw !== undefined, "expected a stored draft entry");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : parsed.records;
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
	const uiReloaded = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => fixedNow });
	assert.deepEqual(uiReloaded.get(noteId).uiState, { previewOpen: false });
	assert.equal(uiReloaded.get(noteId).envelope.revision, 1);

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
	await rejectsWithCode(reloadedAgain.add({ sessionId: "ps_d1", type: "pibo.core/image", schemaVersion: 1, payload: {}, media: { draftResourceId: "", mimeType: "image/png", bytes: 3 } }), "ATT_BYTES_MISSING");
	assert.equal(reloadedAgain.list().length, before);
	assert.deepEqual(reloadedAgain.list().map((record) => record.envelope.id), ["att_d1_1", "att_d1_2"]);

	const updatedAtBefore = reloadedAgain.get(noteId).envelope.updatedAt;
	const writesBefore = storage.writes;
	await reloadedAgain.update(noteId, 2, {});
	assert.equal(reloadedAgain.get(noteId).envelope.updatedAt, updatedAtBefore);
	assert.equal(reloadedAgain.get(noteId).envelope.revision, 2);
	assert.equal(storage.writes, writesBefore);
	await rejectsWithCode(reloadedAgain.update(noteId, 999, {}), "ATT_STALE_REVISION");
	await rejectsWithCode(reloadedAgain.update("att_unknown", 1, {}), "ATT_STALE_REVISION");
`;

const TXN_BINDING_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_d1", { now: () => "2026-09-21T11:11:00.000Z", createId: createIdSequence("att_tx") });
	const idA = await store.add({ sessionId: "ps_d1", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const idB = await store.add({ sessionId: "ps_d1", type: "pibo.core/image", schemaVersion: 1, payload: { title: "shot" }, media: { draftResourceId: "upl_d1_9", mimeType: "image/png", bytes: 7 } });

	const first = store.freezeForSend("txn_open_1", "hello");
	assert.equal(first.clientTxnId, "txn_open_1");
	assert.deepEqual(first.attachments.map((entry) => [entry.id, entry.revision]), [[idA, 1], [idB, 1]]);
	const writesAfterFreeze = storage.writes;

	const identical = store.freezeForSend("txn_open_1", "hello");
	assert.deepEqual(identical, first);
	assert.equal(identical.frozenAt, first.frozenAt);
	assert.equal(storage.writes, writesAfterFreeze);

	await store.update(idA, 1, { payload: { v: 2 } });
	throwsWithCode(() => store.freezeForSend("txn_open_1", "hello"), "ATT_ACCEPTANCE_UNKNOWN");
	throwsWithCode(() => store.freezeForSend("txn_open_1", "changed text"), "ATT_ACCEPTANCE_UNKNOWN");

	const applied = store.applyAcceptance(first, { clientTxnId: "txn_open_1", accepted: true });
	assert.deepEqual(applied, { consumed: [idB], duplicate: false });
	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 2]]);

	const retry = store.applyAcceptance(first, { clientTxnId: "txn_open_1", accepted: true });
	assert.deepEqual(retry, { consumed: [], duplicate: true });
	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 2]]);

	throwsWithCode(() => store.freezeForSend("txn_open_1", "hello again"), "ATT_ACCEPTANCE_UNKNOWN");

	const second = store.freezeForSend("txn_open_2", "again");
	throwsWithCode(() => store.applyAcceptance(second, { clientTxnId: "txn_other", accepted: true }), "ATT_ACCEPTANCE_UNKNOWN");
	throwsWithCode(() => store.applyAcceptance(second, { clientTxnId: "txn_open_2", accepted: false }), "ATT_ACCEPTANCE_UNKNOWN");
	assert.equal(store.list().length, 1);
	const appliedSecond = store.applyAcceptance(second, { clientTxnId: "txn_open_2", accepted: true });
	assert.deepEqual(appliedSecond, { consumed: [idA], duplicate: false });
	assert.deepEqual(store.list(), []);

	throwsWithCode(() => store.freezeForSend("", "empty"), "ATT_INVALID_JSON");
	throwsWithCode(() => store.freezeForSend("x".repeat(161), "too long"), "ATT_INVALID_JSON");
	const emptyFreeze = store.freezeForSend("y".repeat(160), "max length ok");
	assert.deepEqual(emptyFreeze.attachments, []);
	const emptyText = store.freezeForSend("txn_empty_text", "");
	assert.equal(emptyText.text, "");
`;

const ATOMICITY_RELOAD_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_atom", { now: () => "2026-09-21T11:12:00.000Z", createId: createIdSequence("att_atom") });
	const idA = await store.add({ sessionId: "ps_atom", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const snapshot = store.freezeForSend("txn_atom_1", "send me");
	const storedBeforeThrow = storage.entries.get("pibo.chat.coreAttachments.draft.ps_atom");

	const realWrite = storage.writeText;
	storage.writeText = () => { throw new Error("disk full"); };
	const failure = await rejectsWithCode(Promise.resolve().then(() => store.applyAcceptance(snapshot, { clientTxnId: "txn_atom_1", accepted: true })), "ATT_STORAGE_FAILED");
	assert.equal(failure.retryable, true);
	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 1]]);
	assert.equal(store.storageError.code, "ATT_STORAGE_FAILED");
	storage.writeText = realWrite;

	const healed = store.applyAcceptance(snapshot, { clientTxnId: "txn_atom_1", accepted: true });
	assert.deepEqual(healed, { consumed: [idA], duplicate: false });
	assert.deepEqual(store.list(), []);
	assert.equal(store.storageError, undefined);
	const reloaded = new CoreAttachmentDraftStore(storage, "ps_atom");
	assert.deepEqual(reloaded.list(), []);
	const dupAfterReload = reloaded.applyAcceptance(snapshot, { clientTxnId: "txn_atom_1", accepted: true });
	assert.deepEqual(dupAfterReload, { consumed: [], duplicate: true });
	throwsWithCode(() => reloaded.freezeForSend("txn_atom_1", "new content"), "ATT_ACCEPTANCE_UNKNOWN");
	assert.notEqual(storage.entries.get("pibo.chat.coreAttachments.draft.ps_atom"), storedBeforeThrow);

	const store2 = new CoreAttachmentDraftStore(storage, "ps_atom2", { now: () => "2026-09-21T11:12:01.000Z", createId: createIdSequence("att_a2") });
	const idB = await store2.add({ sessionId: "ps_atom2", type: "pibo.core/note", schemaVersion: 1, payload: { w: 1 } });
	const open = store2.freezeForSend("txn_open_reload", "open send");
	const reloadedOpen = new CoreAttachmentDraftStore(storage, "ps_atom2");
	throwsWithCode(() => reloadedOpen.freezeForSend("txn_open_reload", "different content"), "ATT_ACCEPTANCE_UNKNOWN");
	const identicalAfterReload = reloadedOpen.freezeForSend("txn_open_reload", "open send");
	assert.equal(identicalAfterReload.frozenAt, open.frozenAt);
	const appliedOpen = reloadedOpen.applyAcceptance(open, { clientTxnId: "txn_open_reload", accepted: true });
	assert.deepEqual(appliedOpen, { consumed: [idB], duplicate: false });
`;

const CALLER_SNAPSHOT_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_snap", { now: () => "2026-09-21T11:13:00.000Z", createId: createIdSequence("att_snap") });
	const idA = await store.add({ sessionId: "ps_snap", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const genuine = store.freezeForSend("txn_snap_1", "send");

	const bumped = JSON.parse(JSON.stringify(genuine));
	bumped.attachments[0].revision = 999;
	throwsWithCode(() => store.applyAcceptance(bumped, { clientTxnId: "txn_snap_1", accepted: true }), "ATT_ACCEPTANCE_UNKNOWN");

	const forged = JSON.parse(JSON.stringify(genuine));
	forged.attachments.push({ id: "att_forged", revision: 1, type: "pibo.core/note", schemaVersion: 1, payload: {} });
	throwsWithCode(() => store.applyAcceptance(forged, { clientTxnId: "txn_snap_1", accepted: true }), "ATT_ACCEPTANCE_UNKNOWN");

	const stringRev = JSON.parse(JSON.stringify(genuine));
	stringRev.attachments[0].revision = "1";
	throwsWithCode(() => store.applyAcceptance(stringRev, { clientTxnId: "txn_snap_1", accepted: true }), "ATT_INVALID_JSON");

	const foreign = JSON.parse(JSON.stringify(genuine));
	foreign.sessionId = "ps_other";
	throwsWithCode(() => store.applyAcceptance(foreign, { clientTxnId: "txn_snap_1", accepted: true }), "ATT_ACCESS_DENIED");

	throwsWithCode(() => store.applyAcceptance(genuine, { clientTxnId: "txn_never_frozen", accepted: true }), "ATT_ACCEPTANCE_UNKNOWN");
	throwsWithCode(() => store.applyAcceptance("not-an-object", { clientTxnId: "txn_snap_1", accepted: true }), "ATT_INVALID_JSON");
	throwsWithCode(() => store.applyAcceptance(genuine, { clientTxnId: "   ", accepted: true }), "ATT_INVALID_JSON");

	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 1]]);
	const genuineApply = store.applyAcceptance(genuine, { clientTxnId: "txn_snap_1", accepted: true });
	assert.deepEqual(genuineApply, { consumed: [idA], duplicate: false });
`;

const TXN_TRIM_SCENARIO = `
	import assert from "node:assert/strict";
	const { CoreAttachmentDraftStore, normalizeDraftClientTxnId } = await import("./src/apps/chat-ui/src/attachments/core-attachment-draft.ts");
	const { normalizeClientTxnId } = await import("./src/apps/chat/chat-request-normalizers.ts");
	assert.equal(typeof normalizeDraftClientTxnId, "function");
	function oracleOutcome(value) {
		try {
			return { ok: true, value: normalizeClientTxnId(value) };
		} catch {
			return { ok: false };
		}
	}
	function pilotOutcome(value) {
		try {
			return { ok: true, value: normalizeDraftClientTxnId(value) };
		} catch (error) {
			assert.equal(error.name, "AttachmentDraftError");
			assert.equal(error.code, "ATT_INVALID_JSON");
			return { ok: false };
		}
	}
	const sharedCases = ["   ", "  abc  ", "abc", "\\t padded \\n", "x".repeat(160), "x".repeat(161), "  " + "y".repeat(160) + "  ", 123, null, {}, ["abc"]];
	for (const input of sharedCases) {
		const oracle = oracleOutcome(input);
		const pilot = pilotOutcome(input);
		assert.equal(pilot.ok, oracle.ok, "accept/reject must match the server oracle for " + JSON.stringify(input));
		if (oracle.ok) assert.equal(pilot.value, oracle.value, "normalized value must match the server oracle");
	}
	assert.equal(oracleOutcome(undefined).ok, true);
	assert.equal(pilotOutcome(undefined).ok, false);

	const entries = new Map();
	const storage = {
		entries,
		readText: (key) => (entries.has(key) ? entries.get(key) : null),
		writeText: (key, value) => { entries.set(key, value); },
		removeText: (key) => { entries.delete(key); },
	};
	const store = new CoreAttachmentDraftStore(storage, "ps_trim");
	const padded = store.freezeForSend("  abc  ", "trim me");
	assert.equal(padded.clientTxnId, "abc");
	const same = store.freezeForSend("abc", "trim me");
	assert.equal(same.frozenAt, padded.frozenAt);
	let spacesFailed = false;
	try {
		store.freezeForSend("   ", "spaces");
	} catch (error) {
		spacesFailed = error.code === "ATT_INVALID_JSON";
	}
	assert.equal(spacesFailed, true);
`;

const ENVELOPE_STORAGE_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_env", { now: () => "2026-09-21T11:14:00.000Z", createId: createIdSequence("att_env") });
	const validId = await store.add({ sessionId: "ps_env", type: "pibo.core/note", schemaVersion: 1, payload: { ok: true } });

	await rejectsWithCode(store.add({ sessionId: "ps_env", type: 123, schemaVersion: 1, payload: {} }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.add({ sessionId: "ps_env", type: "", schemaVersion: 1, payload: {} }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.add({ sessionId: "ps_env", type: "pibo.core/note", schemaVersion: Number.NaN, payload: {} }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.add({ sessionId: "ps_env", type: "pibo.core/note", schemaVersion: 1.5, payload: {} }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.add({ sessionId: "ps_env", type: "pibo.core/note", schemaVersion: -1, payload: {} }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.add({ sessionId: "ps_env", type: "pibo.core/note", payload: {} }), "ATT_INVALID_JSON");
	assert.deepEqual(store.list().map((record) => record.envelope.id), [validId]);
	const kept = new CoreAttachmentDraftStore(storage, "ps_env");
	assert.deepEqual(kept.list().map((record) => record.envelope.id), [validId]);

	const storedRecords = readRecords(storage, "ps_env");
	assert.deepEqual(storedRecords.map((record) => record.status), ["ready"]);
	await store.update(validId, 1, { payload: { ok: 2 } });
	assert.deepEqual(readRecords(storage, "ps_env").map((record) => record.status), ["ready"]);

	const realWrite = storage.writeText;
	const storedBeforeThrow = storage.entries.get("pibo.chat.coreAttachments.draft.ps_env");
	storage.writeText = () => { throw new Error("disk full"); };
	await rejectsWithCode(store.update(validId, 2, { payload: { ok: 3 } }), "ATT_STORAGE_FAILED");
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_env"), storedBeforeThrow);
	storage.writeText = realWrite;

	function loadErrorFor(key, raw) {
		const entries = new Map([[key, raw]]);
		const failing = {
			entries,
			readText: (name) => (entries.has(name) ? entries.get(name) : null),
			writeText: (name, value) => { entries.set(name, value); },
			removeText: (name) => { entries.delete(name); },
		};
		const loaded = new CoreAttachmentDraftStore(failing, "ps_broken");
		assert.deepEqual(loaded.list(), []);
		assert.ok(loaded.storageError);
		return loaded.storageError;
	}
	const nanCause = loadErrorFor("pibo.chat.coreAttachments.draft.ps_broken", JSON.stringify([{ envelope: { formatVersion: 1, id: "att_x", sessionId: "ps_broken", type: "t", schemaVersion: null, revision: 1, createdAt: "a", updatedAt: "a" }, payload: {}, status: "ready" }]));
	assert.equal(nanCause.code, "ATT_STORAGE_FAILED");
	assert.match(nanCause.message, /schemaVersion/);
	const revCause = loadErrorFor("pibo.chat.coreAttachments.draft.ps_broken", JSON.stringify([{ envelope: { formatVersion: 1, id: "att_x", sessionId: "ps_broken", type: "t", schemaVersion: 1, revision: 1.5, createdAt: "a", updatedAt: "a" }, payload: {}, status: "ready" }]));
	assert.match(revCause.message, /revision/);
	const versionCause = loadErrorFor("pibo.chat.coreAttachments.draft.ps_broken", JSON.stringify({ formatVersion: 99, sessionId: "ps_broken", records: [] }));
	assert.match(versionCause.message, /format/i);

	const legacyEntries = new Map([["pibo.chat.coreAttachments.draft.ps_legacy", JSON.stringify([{ envelope: { formatVersion: 1, id: "att_old", sessionId: "ps_legacy", type: "pibo.core/note", schemaVersion: 1, revision: 2, createdAt: "a", updatedAt: "b" }, payload: { kept: true }, status: "saving" }])]]);
	const legacyStorage = {
		entries: legacyEntries,
		writes: 0,
		readText: (key) => (legacyEntries.has(key) ? legacyEntries.get(key) : null),
		writeText: (key, value) => { legacyEntries.set(key, value); },
		removeText: (key) => { legacyEntries.delete(key); },
	};
	const legacy = new CoreAttachmentDraftStore(legacyStorage, "ps_legacy");
	assert.equal(legacy.storageError, undefined);
	assert.deepEqual(legacy.list().map((record) => [record.envelope.id, record.envelope.revision]), [["att_old", 2]]);
	assert.deepEqual(legacy.get("att_old").payload, { kept: true });
`;

const ID_UNIQUENESS_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_ids", { createId: () => "att_dup" });
	const firstId = await store.add({ sessionId: "ps_ids", type: "pibo.core/note", schemaVersion: 1, payload: { n: 1 } });
	assert.equal(firstId, "att_dup");
	await rejectsWithCode(store.add({ sessionId: "ps_ids", type: "pibo.core/note", schemaVersion: 1, payload: { n: 2 } }), "ATT_STORAGE_FAILED");
	assert.deepEqual(store.list().map((record) => record.envelope.id), ["att_dup"]);
	const kept = new CoreAttachmentDraftStore(storage, "ps_ids");
	assert.deepEqual(kept.list().map((record) => record.envelope.id), ["att_dup"]);

	function duplicateRecord(id) {
		return { envelope: { formatVersion: 1, id, sessionId: "ps_dup", type: "t", schemaVersion: 1, revision: 1, createdAt: "a", updatedAt: "a" }, payload: {}, status: "ready" };
	}
	const dupEntries = new Map([["pibo.chat.coreAttachments.draft.ps_dup", JSON.stringify([duplicateRecord("att_same"), duplicateRecord("att_same")])]]);
	const dupStorage = {
		entries: dupEntries,
		readText: (key) => (dupEntries.has(key) ? dupEntries.get(key) : null),
		writeText: (key, value) => { dupEntries.set(key, value); },
		removeText: (key) => { dupEntries.delete(key); },
	};
	const dupLoaded = new CoreAttachmentDraftStore(dupStorage, "ps_dup");
	assert.deepEqual(dupLoaded.list(), []);
	assert.equal(dupLoaded.storageError.code, "ATT_STORAGE_FAILED");
	assert.match(dupLoaded.storageError.message, /duplicate/i);

	const reserved = createMemoryStorage();
	let nextReserved = "att_keep";
	const reservedStore = new CoreAttachmentDraftStore(reserved, "ps_res", { createId: () => nextReserved });
	const keptId = await reservedStore.add({ sessionId: "ps_res", type: "pibo.core/note", schemaVersion: 1, payload: { n: 1 } });
	assert.equal(keptId, "att_keep");
	const open = reservedStore.freezeForSend("txn_res_1", "send");
	await reservedStore.remove(keptId);
	await rejectsWithCode(reservedStore.add({ sessionId: "ps_res", type: "pibo.core/note", schemaVersion: 1, payload: { n: 2 } }), "ATT_STORAGE_FAILED");
	const applied = reservedStore.applyAcceptance(open, { clientTxnId: "txn_res_1", accepted: true });
	assert.deepEqual(applied, { consumed: [], duplicate: false });
	nextReserved = "att_fresh";
	const freshId = await reservedStore.add({ sessionId: "ps_res", type: "pibo.core/note", schemaVersion: 1, payload: { n: 3 } });
	assert.equal(freshId, "att_fresh");
`;

const UPDATE_REMOVE_RECOVERY_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_rec", { now: () => "2026-09-21T11:15:00.000Z", createId: createIdSequence("att_rec") });
	const idA = await store.add({ sessionId: "ps_rec", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const storedBeforeThrow = storage.entries.get("pibo.chat.coreAttachments.draft.ps_rec");

	const realWrite = storage.writeText;
	storage.writeText = () => { throw new Error("disk full"); };
	await rejectsWithCode(store.update(idA, 1, { payload: { v: 2 } }), "ATT_STORAGE_FAILED");
	assert.equal(store.get(idA).envelope.revision, 1);
	assert.deepEqual(store.get(idA).payload, { v: 1 });
	assert.equal(store.get(idA).status, "ready");
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_rec"), storedBeforeThrow);
	await rejectsWithCode(store.remove(idA), "ATT_STORAGE_FAILED");
	assert.deepEqual(store.list().map((record) => record.envelope.id), [idA]);
	storage.writeText = realWrite;

	await store.update(idA, 1, { payload: { v: 2 } });
	assert.equal(store.get(idA).envelope.revision, 2);
	assert.deepEqual(store.get(idA).payload, { v: 2 });
	const recovered = store.freezeForSend("txn_rec_1", "recovered");
	assert.equal(recovered.attachments.length, 1);
	const idB = await store.add({ sessionId: "ps_rec", type: "pibo.core/note", schemaVersion: 1, payload: { w: 1 } });
	storage.writeText = () => { throw new Error("disk full again"); };
	await rejectsWithCode(store.remove(idB), "ATT_STORAGE_FAILED");
	assert.deepEqual(store.list().map((record) => record.envelope.id).sort(), [idA, idB].sort());
	storage.writeText = realWrite;
	await store.remove(idB);
	assert.deepEqual(store.list().map((record) => record.envelope.id), [idA]);

	const before = store.list().length;
	storage.writeText = () => { throw new Error("still full"); };
	await rejectsWithCode(store.add({ sessionId: "ps_rec", type: "pibo.core/note", schemaVersion: 1, payload: { lost: false } }), "ATT_STORAGE_FAILED");
	storage.writeText = realWrite;
	assert.equal(store.list().length, before);
	const healedId = await store.add({ sessionId: "ps_rec", type: "pibo.core/note", schemaVersion: 1, payload: { healed: true } });
	assert.ok(store.get(healedId));
`;

const SESSION_MEDIA_METADATA_SCENARIO = PRELUDE + `
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
	assert.deepEqual(Object.keys(reloadedA.get(secondA).media).sort(), ["bytes", "draftResourceId", "mimeType"]);

	const corruptEntries = new Map([["pibo.chat.coreAttachments.draft.ps_corrupt", "{not json"]]);
	const corruptStorage = {
		entries: corruptEntries,
		readText: (key) => (corruptEntries.has(key) ? corruptEntries.get(key) : null),
		writeText: (key, value) => { corruptEntries.set(key, value); },
		removeText: (key) => { corruptEntries.delete(key); },
	};
	const corrupt = new CoreAttachmentDraftStore(corruptStorage, "ps_corrupt");
	assert.deepEqual(corrupt.list(), []);
	assert.equal(corrupt.storageError.code, "ATT_STORAGE_FAILED");
	await corrupt.add({ sessionId: "ps_corrupt", type: "pibo.core/note", schemaVersion: 1, payload: { healed: true } });
	assert.equal(corrupt.storageError, undefined);
	assert.equal(corrupt.list().length, 1);

	const foreignEntries = new Map([["pibo.chat.coreAttachments.draft.ps_foreign", JSON.stringify([{ envelope: { formatVersion: 1, id: "att_f", sessionId: "ps_other", type: "t", schemaVersion: 1, revision: 1, createdAt: "x", updatedAt: "x" }, payload: {}, status: "ready" }])]]);
	const foreignStorage = {
		entries: foreignEntries,
		readText: (key) => (foreignEntries.has(key) ? foreignEntries.get(key) : null),
		writeText: (key, value) => { foreignEntries.set(key, value); },
		removeText: (key) => { foreignEntries.delete(key); },
	};
	const foreign = new CoreAttachmentDraftStore(foreignStorage, "ps_foreign");
	assert.deepEqual(foreign.list(), []);
	assert.equal(foreign.storageError.code, "ATT_STORAGE_FAILED");

	const failingStorage = createMemoryStorage();
	failingStorage.writeText = () => { throw new Error("read-only"); };
	const failingStore = new CoreAttachmentDraftStore(failingStorage, "ps_nopersist");
	await rejectsWithCode(failingStore.add({ sessionId: "ps_nopersist", type: "pibo.core/note", schemaVersion: 1, payload: { gone: true } }), "ATT_STORAGE_FAILED");
	assert.equal(failingStore.get("att_nopersist_should_not_exist"), undefined);
	const reloadedFailing = new CoreAttachmentDraftStore(failingStorage, "ps_nopersist");
	assert.deepEqual(reloadedFailing.list(), []);
	assert.equal(reloadedFailing.storageError, undefined);
`;

const WRITER_CONSISTENCY_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	let tick = 0;
	const goodNow = () => "2026-09-21T20:00:0" + (tick++) + ".000Z";
	const store = new CoreAttachmentDraftStore(storage, "ps_w", { now: goodNow, createId: createIdSequence("att_w") });
	const idA = await store.add({ sessionId: "ps_w", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const open = store.freezeForSend("txn_w_1", "hello");
	const bytesBefore = storage.entries.get("pibo.chat.coreAttachments.draft.ps_w");
	const writesBefore = storage.writes;

	for (const badText of [123, null, undefined, { text: "x" }]) {
		const err = throwsWithCode(() => store.freezeForSend("txn_w_bad", badText), "ATT_INVALID_JSON");
		assert.equal(err.retryable, false);
	}
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_w"), bytesBefore);
	assert.equal(storage.writes, writesBefore);
	assert.deepEqual(store.list().map((record) => record.envelope.id), [idA]);
	const same = store.freezeForSend("txn_w_1", "hello");
	assert.equal(same.frozenAt, open.frozenAt);
	assert.equal(storage.writes, writesBefore);

	for (const badNow of [() => 123, () => "", () => null, () => undefined]) {
		const lying = new CoreAttachmentDraftStore(storage, "ps_w", { now: badNow, createId: createIdSequence("att_lying") });
		const clockAdd = await rejectsWithCode(lying.add({ sessionId: "ps_w", type: "pibo.core/note", schemaVersion: 1, payload: {} }), "ATT_INVALID_JSON");
		assert.equal(clockAdd.retryable, false);
		const clockUpdate = await rejectsWithCode(lying.update(idA, 1, { payload: { v: 2 } }), "ATT_INVALID_JSON");
		assert.equal(clockUpdate.retryable, false);
		const clockFreeze = throwsWithCode(() => lying.freezeForSend("txn_w_clock", "hi"), "ATT_INVALID_JSON");
		assert.equal(clockFreeze.retryable, false);
		assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_w"), bytesBefore);
		assert.equal(storage.writes, writesBefore);
		assert.deepEqual(lying.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 1]]);
	}

	const healed = new CoreAttachmentDraftStore(storage, "ps_w", { now: goodNow, createId: createIdSequence("att_healed") });
	const healedId = await healed.add({ sessionId: "ps_w", type: "pibo.core/note", schemaVersion: 1, payload: { healed: true } });
	assert.equal(healedId, "att_healed_1");
	await healed.update(idA, 1, { payload: { v: 2 } });
	assert.equal(healed.get(idA).envelope.revision, 2);
	const healedFreeze = healed.freezeForSend("txn_w_clock", "hi");
	assert.equal(healedFreeze.attachments.length, 2);
	const healedApply = healed.applyAcceptance(healedFreeze, { clientTxnId: "txn_w_clock", accepted: true });
	assert.deepEqual(healedApply.consumed.sort(), [healedId, idA].sort());
	const reloaded = new CoreAttachmentDraftStore(storage, "ps_w", { now: goodNow });
	assert.deepEqual(reloaded.list(), []);
	assert.equal(reloaded.storageError, undefined);

	const badIds = createMemoryStorage();
	const badIdStore = new CoreAttachmentDraftStore(badIds, "ps_g", { createId: createIdSequence("att_g") });
	const keptId = await badIdStore.add({ sessionId: "ps_g", type: "pibo.core/note", schemaVersion: 1, payload: { n: 0 } });
	const genBytes = badIds.entries.get("pibo.chat.coreAttachments.draft.ps_g");
	const genWrites = badIds.writes;
	const badIdStore2 = new CoreAttachmentDraftStore(badIds, "ps_g", { createId: (() => { const values = ["", 123, null]; return () => values.shift(); })() });
	for (let i = 0; i < 3; i++) {
		const err = await rejectsWithCode(badIdStore2.add({ sessionId: "ps_g", type: "pibo.core/note", schemaVersion: 1, payload: { n: i + 1 } }), "ATT_INVALID_JSON");
		assert.equal(err.retryable, false);
	}
	assert.equal(badIds.entries.get("pibo.chat.coreAttachments.draft.ps_g"), genBytes);
	assert.equal(badIds.writes, genWrites);
	assert.deepEqual(badIdStore2.list().map((record) => record.envelope.id), [keptId]);
	const genReloaded = new CoreAttachmentDraftStore(badIds, "ps_g");
	assert.deepEqual(genReloaded.list().map((record) => record.envelope.id), [keptId]);
`;

const CONTROLLED_ERRORS_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_c", { now: () => "2026-09-21T20:02:00.000Z", createId: createIdSequence("att_c") });
	const idA = await store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const open = store.freezeForSend("txn_c_1", "hi");
	const bytesBefore = storage.entries.get("pibo.chat.coreAttachments.draft.ps_c");
	const writesBefore = storage.writes;

	for (const bad of [null, undefined, [], "x", 42]) {
		const err = await rejectsWithCode(store.add(bad), "ATT_INVALID_JSON");
		assert.equal(err.retryable, false);
	}
	for (const bad of [null, undefined, [], "x"]) {
		const err = await rejectsWithCode(store.update(idA, 1, bad), "ATT_INVALID_JSON");
		assert.equal(err.retryable, false);
	}
	await rejectsWithCode(store.update("att_unknown", 1, null), "ATT_STALE_REVISION");
	await rejectsWithCode(store.update(idA, 999, null), "ATT_STALE_REVISION");
	await store.update(idA, 1, {});
	assert.equal(storage.writes, writesBefore);

	const direct = { a: 1 };
	direct.self = direct;
	await rejectsWithCode(store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: direct }), "ATT_INVALID_JSON");
	const indirectA = {};
	const indirectB = { back: indirectA };
	indirectA.forward = indirectB;
	await rejectsWithCode(store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: indirectA }), "ATT_INVALID_JSON");
	const arrayCycle = [];
	arrayCycle.push(arrayCycle);
	await rejectsWithCode(store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: arrayCycle }), "ATT_INVALID_JSON");
	const uiCycle = {};
	uiCycle.me = uiCycle;
	await rejectsWithCode(store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: { ok: 1 }, uiState: uiCycle }), "ATT_INVALID_JSON");
	await rejectsWithCode(store.update(idA, 1, { payload: direct }), "ATT_INVALID_JSON");

	assert.deepEqual(store.list().map((record) => [record.envelope.id, record.envelope.revision]), [[idA, 1]]);
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_c"), bytesBefore);
	assert.equal(storage.writes, writesBefore);
	const same = store.freezeForSend("txn_c_1", "hi");
	assert.equal(same.frozenAt, open.frozenAt);

	const shared = { n: 1, deep: { x: [1, 2] } };
	const idS = await store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: { left: shared, right: shared } });
	shared.n = 999;
	shared.deep.x.push(3);
	assert.deepEqual(store.get(idS).payload, { left: { n: 1, deep: { x: [1, 2] } }, right: { n: 1, deep: { x: [1, 2] } } });
	const sharedReloaded = new CoreAttachmentDraftStore(storage, "ps_c");
	assert.deepEqual(sharedReloaded.get(idS).payload, { left: { n: 1, deep: { x: [1, 2] } }, right: { n: 1, deep: { x: [1, 2] } } });

	let deep = { leaf: true };
	for (let i = 0; i < 500; i++) deep = { nest: deep };
	const idD = await store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: deep });
	let probe = store.get(idD).payload;
	for (let i = 0; i < 500; i++) probe = probe.nest;
	assert.deepEqual(probe, { leaf: true });

	let cursor = [];
	const extreme = cursor;
	for (let i = 0; i < 100000; i++) {
		const next = [];
		cursor.push(next);
		cursor = next;
	}
	const bytesBeforeExtreme = storage.entries.get("pibo.chat.coreAttachments.draft.ps_c");
	const writesBeforeExtreme = storage.writes;
	const extremeErr = await rejectsWithCode(store.add({ sessionId: "ps_c", type: "pibo.core/note", schemaVersion: 1, payload: extreme }), "ATT_INVALID_JSON");
	assert.equal(extremeErr.retryable, false);
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_c"), bytesBeforeExtreme);
	assert.equal(storage.writes, writesBeforeExtreme);
	assert.equal(store.list().length, 3);
`;

const FREEZE_THROW_RECOVERY_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_f", { now: () => "2026-09-21T20:03:00.000Z", createId: createIdSequence("att_f") });
	const idA = await store.add({ sessionId: "ps_f", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 } });
	const control = store.freezeForSend("txn_ctrl", "control");
	const bytesBefore = storage.entries.get("pibo.chat.coreAttachments.draft.ps_f");
	const writesBefore = storage.writes;

	const realWrite = storage.writeText;
	let attempts = 0;
	storage.writeText = () => { attempts += 1; throw new Error("disk full"); };
	const thrown = throwsWithCode(() => store.freezeForSend("txn_new_1", "send"), "ATT_STORAGE_FAILED");
	assert.equal(thrown.retryable, true);
	assert.equal(attempts, 1);
	assert.equal(storage.entries.get("pibo.chat.coreAttachments.draft.ps_f"), bytesBefore);
	assert.equal(storage.writes, writesBefore);
	assert.deepEqual(store.list().map((record) => record.envelope.id), [idA]);
	const controlSame = store.freezeForSend("txn_ctrl", "control");
	assert.equal(controlSame.frozenAt, control.frozenAt);
	storage.writeText = realWrite;

	const healed = store.freezeForSend("txn_new_1", "send");
	assert.equal(healed.attachments.length, 1);
	const writesAfterHeal = storage.writes;
	const identical = store.freezeForSend("txn_new_1", "send");
	assert.equal(identical.frozenAt, healed.frozenAt);
	assert.equal(storage.writes, writesAfterHeal);
	const applied = store.applyAcceptance(healed, { clientTxnId: "txn_new_1", accepted: true });
	assert.deepEqual(applied, { consumed: [idA], duplicate: false });
	const reloaded = new CoreAttachmentDraftStore(storage, "ps_f");
	assert.deepEqual(reloaded.list(), []);
	const dup = reloaded.applyAcceptance(healed, { clientTxnId: "txn_new_1", accepted: true });
	assert.deepEqual(dup, { consumed: [], duplicate: true });
`;

const UISTATE_REFREEZE_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	let tick = 0;
	const store = new CoreAttachmentDraftStore(storage, "ps_u", { now: () => "2026-09-21T20:04:0" + (tick++) + ".000Z", createId: createIdSequence("att_u") });
	const idA = await store.add({ sessionId: "ps_u", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 }, uiState: { tab: "a" } });
	const first = store.freezeForSend("txn_ui_1", "hello");
	const writesAfterFreeze = storage.writes;
	await store.update(idA, 1, { uiState: { tab: "b" } });
	const refrozen = store.freezeForSend("txn_ui_1", "hello");
	assert.deepEqual(refrozen, first);
	assert.equal(refrozen.frozenAt, first.frozenAt);
	assert.equal(storage.writes, writesAfterFreeze + 1);
	const applied = store.applyAcceptance(refrozen, { clientTxnId: "txn_ui_1", accepted: true });
	assert.deepEqual(applied, { consumed: [idA], duplicate: false });
`;

const REISSUE_DUP_RECEIPT_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const scripted = ["att_re", "att_re", "att_next"];
	const store = new CoreAttachmentDraftStore(storage, "ps_r", { now: () => "2026-09-21T20:05:00.000Z", createId: () => scripted.shift() });
	const firstId = await store.add({ sessionId: "ps_r", type: "pibo.core/note", schemaVersion: 1, payload: { gen: 1 } });
	assert.equal(firstId, "att_re");
	const snapshot = store.freezeForSend("txn_re_1", "send");
	const applied = store.applyAcceptance(snapshot, { clientTxnId: "txn_re_1", accepted: true });
	assert.deepEqual(applied, { consumed: ["att_re"], duplicate: false });
	const secondId = await store.add({ sessionId: "ps_r", type: "pibo.core/note", schemaVersion: 1, payload: { gen: 2 } });
	assert.equal(secondId, "att_re");
	const stale = store.applyAcceptance(snapshot, { clientTxnId: "txn_re_1", accepted: true });
	assert.deepEqual(stale, { consumed: [], duplicate: true });
	assert.deepEqual(store.get("att_re").payload, { gen: 2 });
	assert.equal(store.get("att_re").envelope.revision, 1);
	const fresh = store.freezeForSend("txn_re_2", "again");
	const appliedFresh = store.applyAcceptance(fresh, { clientTxnId: "txn_re_2", accepted: true });
	assert.deepEqual(appliedFresh, { consumed: ["att_re"], duplicate: false });
	assert.deepEqual(store.list(), []);
`;

const UISTATE_KEEP_SCENARIO = PRELUDE + `
	const storage = createMemoryStorage();
	const store = new CoreAttachmentDraftStore(storage, "ps_k", { now: () => "2026-09-21T20:06:00.000Z", createId: createIdSequence("att_k") });
	const idA = await store.add({ sessionId: "ps_k", type: "pibo.core/note", schemaVersion: 1, payload: { v: 1 }, uiState: { tab: "details", scroll: 42 } });
	await store.update(idA, 1, { payload: { v: 2 } });
	assert.equal(store.get(idA).envelope.revision, 2);
	assert.deepEqual(store.get(idA).payload, { v: 2 });
	assert.deepEqual(store.get(idA).uiState, { tab: "details", scroll: 42 });
	const reloaded = new CoreAttachmentDraftStore(storage, "ps_k");
	assert.equal(reloaded.get(idA).envelope.revision, 2);
	assert.deepEqual(reloaded.get(idA).payload, { v: 2 });
	assert.deepEqual(reloaded.get(idA).uiState, { tab: "details", scroll: 42 });
`;

async function runScenario(script) {
	try {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
			cwd: process.cwd(),
			timeout: 120000,
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch (error) {
		const detail = [error.stdout, error.stderr].filter(Boolean).join("\n").slice(-4000);
		throw new Error("scenario failed: " + (detail || error.message));
	}
}

test("core draft add persists reload-proof snapshots with exact revisions", async () => {
	await assert.doesNotReject(runScenario(ADD_RELOAD_SNAPSHOT_SCENARIO));
});

test("open transactions bind exactly one original snapshot per id", async () => {
	await assert.doesNotReject(runScenario(TXN_BINDING_SCENARIO));
});

test("acceptance persists atomically and survives reload", async () => {
	await assert.doesNotReject(runScenario(ATOMICITY_RELOAD_SCENARIO));
});

test("caller snapshots are validated against the bound original", async () => {
	await assert.doesNotReject(runScenario(CALLER_SNAPSHOT_SCENARIO));
});

test("transaction ids match the server normalizer", async () => {
	await assert.doesNotReject(runScenario(TXN_TRIM_SCENARIO));
});

test("envelopes are validated and storage keeps the last good state", async () => {
	await assert.doesNotReject(runScenario(ENVELOPE_STORAGE_SCENARIO));
});

test("attachment ids stay unique across generation and load", async () => {
	await assert.doesNotReject(runScenario(ID_UNIQUENESS_SCENARIO));
});

test("failed mutations keep state and recover through retry", async () => {
	await assert.doesNotReject(runScenario(UPDATE_REMOVE_RECOVERY_SCENARIO));
});

test("draft sessions stay isolated and media metadata survives reload; byte resolvability deferred to RV-02/05/07", async () => {
	await assert.doesNotReject(runScenario(SESSION_MEDIA_METADATA_SCENARIO));
});

test("writers reject values the loader would refuse", async () => {
	await assert.doesNotReject(runScenario(WRITER_CONSISTENCY_SCENARIO));
});

test("null, malformed and cyclic inputs fail controlled without state damage", async () => {
	await assert.doesNotReject(runScenario(CONTROLLED_ERRORS_SCENARIO));
});

test("failed freeze stores nothing and heals into a normal transaction", async () => {
	await assert.doesNotReject(runScenario(FREEZE_THROW_RECOVERY_SCENARIO));
});

test("uiState-only edits keep the frozen transaction idempotent", async () => {
	await assert.doesNotReject(runScenario(UISTATE_REFREEZE_SCENARIO));
});

test("reissued ids survive stale duplicate receipts", async () => {
	await assert.doesNotReject(runScenario(REISSUE_DUP_RECEIPT_SCENARIO));
});

test("payload updates keep stored uiState across reload", async () => {
	await assert.doesNotReject(runScenario(UISTATE_KEEP_SCENARIO));
});

test("revision exhaustion preserves persisted drafts, open transactions and UI-only edits", async () => {
	await assert.doesNotReject(runScenario(PRELUDE + `
		const storage = createMemoryStorage();
		const sessionId = "ps_revision_boundary";
		const options = { now: () => "2026-09-21T20:00:00Z", createId: () => "att_boundary" };
		const initial = new CoreAttachmentDraftStore(storage, sessionId, options);
		const id = await initial.add({ sessionId, type: "pibo.core/note", schemaVersion: 1, payload: { value: 1 }, uiState: { expanded: false } });
		const key = "pibo.chat.coreAttachments.draft." + sessionId;
		const seeded = JSON.parse(storage.readText(key));
		seeded.records[0].envelope.revision = Number.MAX_SAFE_INTEGER - 1;
		storage.writeText(key, JSON.stringify(seeded));
		const store = new CoreAttachmentDraftStore(storage, sessionId, options);
		assert.equal(store.storageError, undefined);
		await store.update(id, Number.MAX_SAFE_INTEGER - 1, { payload: { value: 2 } });
		assert.equal(store.get(id).envelope.revision, Number.MAX_SAFE_INTEGER);
		const frozen = store.freezeForSend("txn_boundary", "send current revision");
		const before = storage.readText(key);
		const beforeRecords = store.list();
		const beforeWrites = storage.writes;
		const error = await rejectsWithCode(store.update(id, Number.MAX_SAFE_INTEGER, { payload: { value: 3 } }), "ATT_LIMIT_EXCEEDED");
		assert.equal(error.retryable, false);
		assert.equal(storage.readText(key), before);
		assert.equal(storage.writes, beforeWrites);
		assert.deepEqual(store.list(), beforeRecords);
		assert.deepEqual(store.freezeForSend("txn_boundary", "send current revision"), frozen);
		await store.update(id, Number.MAX_SAFE_INTEGER, {});
		assert.equal(storage.writes, beforeWrites);
		await store.update(id, Number.MAX_SAFE_INTEGER, { uiState: { expanded: true } });
		assert.equal(store.get(id).envelope.revision, Number.MAX_SAFE_INTEGER);
		assert.deepEqual(store.freezeForSend("txn_boundary", "send current revision"), frozen);
		const reloaded = new CoreAttachmentDraftStore(storage, sessionId, options);
		assert.equal(reloaded.storageError, undefined);
		assert.deepEqual(reloaded.list(), store.list());
		assert.deepEqual(reloaded.applyAcceptance(frozen, { clientTxnId: "txn_boundary", accepted: true }), { consumed: [id], duplicate: false });
		assert.deepEqual(new CoreAttachmentDraftStore(storage, sessionId, options).list(), []);
	`));
});
