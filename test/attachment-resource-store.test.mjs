import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, statSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AttachmentResourceStore } from "../dist/attachments/resource-store.js";
import { ATTACHMENT_MEDIA_MAX_BYTES, ATTACHMENT_MEDIA_RETENTION_CLASS } from "../dist/attachments/resources.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-media-authority-")); const payloadRootDir = join(root, "payloads");
	const path = join(root, "data.sqlite"); let store = new PiboDataStore(path, { payloadRootDir });
	const room = new ChatRoomService(store).ensureDefaultRoom();
	const session = new InMemoryPiboSessionStore().create({ channel: "test", kind: "chat", profile: "base", metadata: { chatRoomId: room.id } });
	new ChatSessionQueryService(store).upsertSession(session);
	const scope = { sessionId: session.id, clientTxnId: "txn", draftResourceId: "blob" };
	let media = new AttachmentResourceStore(store);
	return { root, path, payloadRootDir, scope, session, get store() { return store; }, get media() { return media; },
		prepare(scopeOverride = {}, bytes = Buffer.from("data"), name = "example.txt", mimeType = "text/plain") { return media.prepare({ ...scope, ...scopeOverride }, bytes, mimeType, name); },
		message(id = "message", sessionId = session.id) { return store.messages.insertMessage({ id, sessionId, sequence: store.messages.listMessages(sessionId).length + 1, role: "user", status: "accepted", createdAt: new Date().toISOString() }); },
		restart() { store.close(); store = new PiboDataStore(path, { payloadRootDir }); media = new AttachmentResourceStore(store); },
		close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const binding = (descriptor) => ({ draftResourceId: descriptor.draftResourceId, preparedUploadId: descriptor.preparedUploadId });
const metadata = (descriptor) => ({ draftResourceId: descriptor.draftResourceId, mimeType: descriptor.mimeType, bytes: descriptor.bytes });

test("Core media handles bind verified private bytes to Session/transaction/resource and survive restart", () => {
	const f = fixture();
	try {
		const source = Buffer.from("data"); const prepared = f.prepare({}, source); source.fill(0);
		assert.equal(prepared.payload.encoding, "identity"); assert.equal(prepared.payload.retentionClass, ATTACHMENT_MEDIA_RETENTION_CLASS);
		const descriptor = f.media.commitPrepared(prepared);
		assert.equal(descriptor.sha256, createHash("sha256").update("data").digest("hex"));
		assert.equal(descriptor.state, "prepared"); assert.equal("path" in descriptor, false); assert.equal("payloadRef" in descriptor, false);
		const resolved = f.media.resolve(f.scope, binding(descriptor), metadata(descriptor));
		assert.equal(readFileSync(resolved.path).toString(), "data");
		if (process.platform !== "win32") assert.equal(statSync(resolved.path).mode & 0o777, 0o600);
		f.restart(); assert.deepEqual(f.media.get(f.scope, descriptor.preparedUploadId), descriptor);
		assert.equal(Buffer.from(f.media.read(f.scope, descriptor.preparedUploadId).bytes).toString(), "data");
		assert.deepEqual(f.media.commitPrepared(f.prepare()), descriptor);
		assert.equal(f.store.db.prepare("SELECT ref_count FROM payloads WHERE retention_class=?").get(ATTACHMENT_MEDIA_RETENTION_CLASS).ref_count, 1);
	} finally { f.close(); }
});

test("changed bytes, MIME or name cannot replace an already prepared identity", () => {
	const f = fixture();
	try {
		const original = f.media.commitPrepared(f.prepare());
		for (const changed of [f.prepare({}, Buffer.from("DATA")), f.prepare({}, Buffer.from("data"), "renamed.txt"), f.prepare({}, Buffer.from("data"), "example.txt", "application/octet-stream")]) {
			assert.throws(() => f.media.commitPrepared(changed), { code: "ATT_STALE_REVISION" });
		}
		assert.equal(Buffer.from(f.media.read(f.scope, original.preparedUploadId).bytes).toString(), "data");
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM attachment_resource_grants").get().n, 1);
		assert.equal(f.store.db.prepare("SELECT sum(ref_count) n FROM payloads").get().n, 1);
	} finally { f.close(); }
});

test("foreign Session, transaction, draft id, raw path and mismatched media cannot authorize resources", () => {
	const f = fixture();
	try {
		const descriptor = f.media.commitPrepared(f.prepare());
		const other = new InMemoryPiboSessionStore().create({ channel: "test", kind: "chat", profile: "base" }); new ChatSessionQueryService(f.store).upsertSession(other);
		for (const changed of [{ sessionId: "absent" }, { sessionId: other.id }, { clientTxnId: "another-txn" }, { draftResourceId: "other-blob" }]) assert.throws(() => f.media.read({ ...f.scope, ...changed }, descriptor.preparedUploadId), { code: "ATT_ACCESS_DENIED" });
		assert.throws(() => f.media.resolve(f.scope, { draftResourceId: "blob", preparedUploadId: "/etc/passwd" }, metadata(descriptor)), { code: "ATT_BYTES_MISSING" });
		for (const changed of [{ bytes: 5 }, { mimeType: "image/png" }]) assert.throws(() => f.media.resolve(f.scope, binding(descriptor), { ...metadata(descriptor), ...changed }), { code: "ATT_ACCESS_DENIED" });
		assert.throws(() => f.media.discard({ ...f.scope, clientTxnId: "other" }, [binding(descriptor)]), { code: "ATT_ACCESS_DENIED" });
		assert.equal(f.media.get(f.scope, descriptor.preparedUploadId).state, "prepared");
	} finally { f.close(); }
});

test("prepared-file corruption, fake paths and symlinks fail before publishing ownership", () => {
	const f = fixture();
	try {
		const prepared = f.prepare(); const path = join(f.payloadRootDir, prepared.payload.storagePath);
		assert.throws(() => f.media.commitPrepared({ ...prepared, payload: { ...prepared.payload, storagePath: "../../arbitrary" } }), { code: "ATT_BYTES_MISSING" });
		writeFileSync(path, "DATA"); assert.throws(() => f.media.commitPrepared(prepared), { code: "ATT_BYTES_MISSING" });
		rmSync(path); assert.throws(() => f.media.commitPrepared(prepared), { code: "ATT_BYTES_MISSING" });
		const outside = join(f.root, "outside.txt"); writeFileSync(outside, "data"); symlinkSync(outside, path);
		assert.throws(() => f.media.commitPrepared(prepared), { code: "ATT_BYTES_MISSING" });
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads").get().n, 0);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM attachment_resource_grants").get().n, 0);
	} finally { f.close(); }
});

test("full bounded reads detect changed bytes even when immutable metadata and file length match", () => {
	const f = fixture();
	try {
		const descriptor = f.media.commitPrepared(f.prepare()); const resolved = f.media.resolve(f.scope, binding(descriptor), metadata(descriptor));
		writeFileSync(resolved.path, "DATA");
		assert.throws(() => f.media.read(f.scope, descriptor.preparedUploadId), { code: "ATT_BYTES_MISSING" });
		assert.equal(f.media.get(f.scope, descriptor.preparedUploadId).sha256, descriptor.sha256, "metadata must not silently adopt changed bytes");
	} finally { f.close(); }
});

test("promotion and message insertion roll back together without acquiring another payload reference", () => {
	const f = fixture();
	try {
		const descriptor = f.media.commitPrepared(f.prepare()); const refs = [binding(descriptor)];
		assert.throws(() => f.media.promote(f.scope, refs, "message"), /requires the admission transaction/);
		assert.throws(() => f.store.transaction(() => { f.message(); f.media.promote(f.scope, refs, "message"); throw new Error("rollback"); }), /rollback/);
		assert.equal(f.store.messages.listMessages(f.session.id).length, 0);
		assert.equal(f.media.get(f.scope, descriptor.preparedUploadId).state, "prepared");
		f.store.transaction(() => { f.message(); f.media.promote(f.scope, refs, "message"); });
		f.store.transaction(() => f.media.promote(f.scope, refs, "message"));
		assert.equal(f.media.get(f.scope, descriptor.preparedUploadId).state, "accepted");
		assert.throws(() => f.media.discard(f.scope, refs), { code: "ATT_ACCESS_DENIED" });
		assert.throws(() => f.store.transaction(() => { f.message("other-message"); f.media.promote(f.scope, refs, "other-message"); }), { code: "ATT_STALE_REVISION" });
		assert.equal(f.store.messages.listMessages(f.session.id).length, 1);
		assert.equal(f.store.db.prepare("SELECT ref_count FROM payloads").get().ref_count, 1);
	} finally { f.close(); }
});

test("shared bytes retain one reference per grant; duplicate discard is harmless and last discard deletes bytes", () => {
	const f = fixture();
	try {
		const first = f.media.commitPrepared(f.prepare()); const secondScope = { ...f.scope, clientTxnId: "second" }; const second = f.media.commitPrepared(f.prepare(secondScope));
		const path = f.media.resolve(f.scope, binding(first), metadata(first)).path;
		assert.notEqual(first.preparedUploadId, second.preparedUploadId); assert.equal(f.store.db.prepare("SELECT ref_count FROM payloads").get().ref_count, 2);
		assert.equal(f.media.discard(f.scope, [binding(first), binding(first)]), 1);
		assert.equal(f.media.discard(f.scope, [binding(first)]), 0); assert.equal(existsSync(path), true);
		assert.equal(f.media.read(secondScope, second.preparedUploadId).bytes.byteLength, 4);
		assert.equal(f.media.discard(secondScope, [binding(second)]), 1); assert.equal(existsSync(path), false);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads").get().n, 0);
	} finally { f.close(); }
});

test("history release is transactional, affects only requested Sessions and keeps other grants readable", () => {
	const f = fixture();
	try {
		const first = f.media.commitPrepared(f.prepare());
		const other = new InMemoryPiboSessionStore().create({ channel: "test", kind: "chat", profile: "base" }); new ChatSessionQueryService(f.store).upsertSession(other);
		const otherScope = { ...f.scope, sessionId: other.id }; const second = f.media.commitPrepared(f.prepare(otherScope));
		f.store.transaction(() => { f.message(); f.media.promote(f.scope, [binding(first)], "message"); });
		assert.throws(() => f.store.transaction(() => { f.media.releaseSessions([f.session.id]); throw new Error("rollback"); }), /rollback/);
		assert.equal(f.media.get(f.scope, first.preparedUploadId).state, "accepted");
		const released = f.store.transaction(() => f.media.releaseSessions([f.session.id, f.session.id])); assert.deepEqual(released, []);
		assert.throws(() => f.media.get(f.scope, first.preparedUploadId), { code: "ATT_BYTES_MISSING" });
		assert.equal(f.media.read(otherScope, second.preparedUploadId).bytes.byteLength, 4);
		assert.equal(f.store.db.prepare("SELECT ref_count FROM payloads").get().ref_count, 1);
	} finally { f.close(); }
});

test("resource preparation enforces identity and existing blob byte bounds without a total attachment-count rule", () => {
	const f = fixture();
	try {
		for (const scope of [{ clientTxnId: " txn " }, { clientTxnId: "x".repeat(161) }, { draftResourceId: undefined }]) assert.throws(() => f.prepare(scope), { code: "ATT_INVALID_JSON" });
		assert.throws(() => f.prepare({}, Buffer.alloc(ATTACHMENT_MEDIA_MAX_BYTES + 1)), { code: "ATT_LIMIT_EXCEEDED" });
		const empty = f.media.commitPrepared(f.prepare({}, Buffer.alloc(0))); assert.equal(f.media.read(f.scope, empty.preparedUploadId).bytes.byteLength, 0);
		for (let i = 0; i < 12; i++) f.media.commitPrepared(f.prepare({ draftResourceId: `blob-${i}` }));
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM attachment_resource_grants").get().n, 13);
	} finally { f.close(); }
});

test("payload cleanup cannot unlink a freshly committed owner reusing the same content file", () => {
	const f = fixture(); const other = new PiboDataStore(f.path, { payloadRootDir: f.payloadRootDir });
	try {
		const initial = f.store.payloads.writePayload({ value: "same", retentionClass: "race-test" });
		const released = f.store.transaction(() => f.store.payloads.releaseReferences(initial.id));
		const replacement = other.payloads.writePayload({ value: "same", retentionClass: "race-test" }); assert.notEqual(replacement.id, initial.id);
		f.store.payloads.removeReleasedFile(released);
		assert.equal(other.payloads.readPayloadText(replacement.id), "same");
	} finally { other.close(); f.close(); }
});

test("prepared ownership cannot be published after last-reference cleanup removed its file", () => {
	const f = fixture(); const other = new PiboDataStore(f.path, { payloadRootDir: f.payloadRootDir });
	try {
		const initial = f.store.payloads.writePayload({ value: "same", retentionClass: "race-test" });
		const pending = other.payloads.preparePayload({ value: "same", retentionClass: "race-test" });
		const released = f.store.transaction(() => f.store.payloads.releaseReferences(initial.id)); f.store.payloads.removeReleasedFile(released);
		assert.throws(() => other.payloads.commitPreparedPayload(pending), { code: "storage_payload_unavailable" });
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads").get().n, 0);
	} finally { other.close(); f.close(); }
});

test("standalone payload release locks the count decision and reuses an outer rollback", () => {
	const f = fixture(); const original = f.store.db.prepare.bind(f.store.db);
	try {
		const first = f.store.payloads.writePayload({ value: "same", retentionClass: "locked-release" });
		f.store.payloads.writePayload({ value: "same", retentionClass: "locked-release" });
		let lockedReads = 0;
		f.store.db.prepare = sql => {
			if (sql === "SELECT * FROM payloads WHERE id = ?") { assert.equal(f.store.db.isTransaction, true); lockedReads++; }
			return original(sql);
		};
		assert.equal(f.store.payloads.releaseReferences(first.id), undefined);
		assert.throws(() => f.store.transaction(() => { f.store.payloads.releaseReferences(first.id); throw new Error("rollback"); }), /rollback/);
		const last = f.store.payloads.releaseReferences(first.id); assert.equal(last.id, first.id);
		assert.equal(lockedReads, 3); assert.equal(f.store.db.isTransaction, false);
		f.store.db.prepare = original;
		assert.equal(f.store.payloads.getPayload(first.id), undefined); f.store.payloads.removeReleasedFile(last);
	} finally { f.store.db.prepare = original; f.close(); }
});

for (const kind of ["discard", "history deletion"]) test(`${kind} reports post-commit cleanup errors only after attempting every released file`, () => {
	const f = fixture(); const remove = f.store.payloads.removeReleasedFile.bind(f.store.payloads);
	try {
		const descriptors = ["one", "two"].map(name => f.media.commitPrepared(f.prepare({ draftResourceId: name }, Buffer.from(name))));
		const refs = descriptors.map(binding); const paths = descriptors.map(item => f.media.resolve(f.scope, binding(item), metadata(item)).path);
		if (kind === "history deletion") f.store.transaction(() => { f.message(); f.media.promote(f.scope, refs, "message"); });
		const attempted = [];
		f.store.payloads.removeReleasedFile = payload => {
			assert.equal(f.store.db.isTransaction, false, "history/ownership transaction already committed"); attempted.push(payload.storagePath);
			if (attempted.length === 1) throw new Error("fixture unlink failure");
			remove(payload);
		};
		assert.throws(() => kind === "discard" ? f.media.discard(f.scope, refs) : new ChatSessionQueryService(f.store).deleteSessions([f.session.id]), error => error instanceof AggregateError && error.errors.length === 1 && /ownership was released/.test(error.message));
		assert.equal(attempted.length, 2);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM attachment_resource_grants").get().n, 0);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads").get().n, 0);
		assert.equal(paths.filter(existsSync).length, 1, "failed unlink remains an orphan; other cleanup still ran");
	} finally { f.store.payloads.removeReleasedFile = remove; f.close(); }
});

test("native MIME suffixes use own entries and existing payload paths remain unchanged", () => {
	const f = fixture();
	try {
		for (const contentType of ["constructor", "__proto__", "toString"]) {
			const value = f.store.payloads.writePayload({ value: Buffer.from("bytes"), contentType, retentionClass: "suffix-test", compress: false });
			assert.match(value.storagePath, /\.bin$/);
		}
		const input = { value: Buffer.from("image bytes"), contentType: "image/png", retentionClass: "legacy-image", compress: false };
		const first = f.store.payloads.writePayload(input); assert.match(first.storagePath, /\.png$/);
		const legacyPath = "fixture-legacy-image.bin"; renameSync(join(f.payloadRootDir, first.storagePath), join(f.payloadRootDir, legacyPath));
		f.store.db.prepare("UPDATE payloads SET storage_path=? WHERE id=?").run(legacyPath, first.id);
		const duplicate = f.store.payloads.writePayload(input);
		assert.equal(duplicate.id, first.id); assert.equal(duplicate.storagePath, legacyPath);
		assert.equal(Buffer.from(f.store.payloads.readPayloadBytesBounded(first.id, 100)).toString(), "image bytes");
	} finally { f.close(); }
});

test("schema 16 adds grants without modifying schema-15 Session, history or payload content", () => {
	const f = fixture();
	try {
		const payload = f.store.payloads.writePayload({ value: "legacy body", retentionClass: "chat_message" }); f.message();
		f.store.db.exec("DROP TABLE attachment_resource_grants; PRAGMA user_version=15"); // disposable fixture only
		f.restart(); assert.equal(f.store.db.prepare("PRAGMA user_version").get().user_version, 16);
		assert.equal(f.store.payloads.readPayloadText(payload.id), "legacy body"); assert.equal(f.store.payloads.getPayload(payload.id).refCount, 1);
		assert.equal(f.store.messages.listMessages(f.session.id).length, 1);
		assert.equal(f.media.commitPrepared(f.prepare()).state, "prepared");
	} finally { f.close(); }
});
