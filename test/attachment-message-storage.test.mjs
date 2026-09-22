import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AsyncChatStorage } from "../dist/data/async-chat-storage.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { attachmentBody } from "./helpers/attachment-fixture.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-attachment-history-")); const payloadRootDir = join(root, "payloads");
	const store = new PiboDataStore(join(root, "data.sqlite"), { payloadRootDir });
	const room = new ChatRoomService(store).ensureDefaultRoom();
	const session = new InMemoryPiboSessionStore().create({ channel: "test", kind: "chat", profile: "base", metadata: { chatRoomId: room.id } });
	let storage = new AsyncChatStorage(store.path, payloadRootDir);
	const body = (txn = "txn") => attachmentBody({ piboSessionId: session.id, clientTxnId: txn });
	const admit = (requestBody, text = "materialized text") => storage.admit({ roomId: room.id, piboSessionId: session.id, eventType: "user.message.accepted", actorType: "user", actorId: "actor", clientTxnId: requestBody.clientTxnId, retentionClass: "chat_message", payload: { type: "user.message.accepted", text } }, session, text, { eventId: requestBody.clientTxnId, delivery: "queue", requestBody });
	return { store, room, session, body, admit, payloadRootDir, get storage() { return storage; }, async restart() { await storage.close(); storage = new AsyncChatStorage(store.path, payloadRootDir); }, async close() { await storage.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("structured attachment history survives restart and optional event loss without receipt file reads", async () => {
	const f = fixture();
	try {
		const body = f.body(); const first = await f.admit(body); const message = f.store.messages.listMessages(f.session.id)[0]; const ref = message.attributes.attachmentSnapshotRef;
		assert.equal(typeof ref, "string"); const metadata = f.store.payloads.getPayload(ref);
		assert.equal(metadata.retentionClass, "chat_attachment"); assert.equal(metadata.refCount, 1);
		assert.deepEqual(f.store.payloads.readPayloadJsonBounded(ref, 1024 * 1024).attachments, body.attachments);
		assert.ok(JSON.stringify(message.attributes).length < 1024, "message listing metadata stays thin");
		assert.equal(f.store.db.prepare("SELECT payload_bytes FROM message_commands").get().payload_bytes, Buffer.byteLength("materialized text") + metadata.byteSize);
		await f.restart(); assert.equal((await f.admit(body)).created, false); assert.equal(f.store.payloads.getPayload(ref).refCount, 1);
		f.store.db.prepare("DELETE FROM event_log WHERE session_id=?").run(f.session.id); // disposable fixture projection only
		assert.equal((await f.admit(body)).created, false); assert.equal(f.store.db.prepare("SELECT count(*) n FROM event_log").get().n, 0);
		assert.deepEqual(f.store.payloads.readPayloadJsonBounded(ref, 1024 * 1024).attachments, body.attachments);
		assert.deepEqual((await f.storage.commandReceipt(first.receipt.id)).contentBinding, first.receipt.contentBinding);
		assert.equal((await f.storage.claimCommand("owner", 30000)).text, "materialized text", "claims remain plain text");
		rmSync(join(f.payloadRootDir, metadata.storagePath)); // simulate a fixture-only media-storage fault
		assert.deepEqual((await f.storage.commandReceipt(first.receipt.id)).contentBinding, first.receipt.contentBinding, "receipt proof never depends on reading attachment files");
	} finally { await f.close(); }
});

test("attachment snapshot references are acquired once per message and released by product-history deletion", async () => {
	const f = fixture();
	try {
		await f.admit(f.body("first")); await f.admit(f.body("second"));
		const [a, b] = f.store.messages.listMessages(f.session.id); assert.equal(a.attributes.attachmentSnapshotRef, b.attributes.attachmentSnapshotRef);
		const ref = a.attributes.attachmentSnapshotRef; const payload = f.store.payloads.getPayload(ref); assert.equal(payload.refCount, 2);
		assert.equal((await f.admit(f.body("first"))).created, false); assert.equal(f.store.payloads.getPayload(ref).refCount, 2);
		new ChatSessionQueryService(f.store).deleteSessions([f.session.id]);
		assert.equal(f.store.payloads.getPayload(ref), undefined); assert.equal(existsSync(join(f.payloadRootDir, payload.storagePath)), false);
	} finally { await f.close(); }
});

test("structured snapshot bytes participate in existing per-command and session admission budgets", async () => {
	const f = fixture();
	try {
		const tooLarge = f.body("too-large"); tooLarge.attachments[0].payload.large = "x".repeat(1024 * 1024);
		await assert.rejects(f.admit(tooLarge), { code: "command_too_large" });
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads").get().n, 0);
		for (let index = 0; index < 4; index++) { const body = f.body(`large-${index}`); body.attachments[0].payload.large = "x".repeat(850 * 1024); await f.admit(body); }
		const overloaded = f.body("overloaded"); overloaded.attachments[0].payload.large = "x".repeat(850 * 1024);
		await assert.rejects(f.admit(overloaded), { code: "command_overloaded" });
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM chat_messages").get().n, 4);
		assert.equal(f.store.db.prepare("SELECT ref_count FROM payloads WHERE retention_class='chat_attachment'").get().ref_count, 4);
		const page = await f.storage.commandReceiptPage(f.session.id); assert.equal(page.queue.queue.count, 4); assert.ok(page.queue.queue.bytes > 3 * 1024 * 1024);
	} finally { await f.close(); }
});

test("canonical attachment snapshots deduplicate key-order variants and never turn raw paths into resources", async () => {
	const f = fixture();
	try {
		const body = f.body(); body.attachments[0].payload.extra = { a: 1, b: 2 }; await f.admit(body);
		const reordered = structuredClone(body); reordered.attachments[0].payload.extra = { b: 2, a: 1 }; assert.equal((await f.admit(reordered)).created, false);
		const media = f.body("fake-media"); media.attachments[0].media = [{ draftResourceId: "blob", mimeType: "image/png", bytes: 4 }]; media.attachmentResources = [{ draftResourceId: "blob", preparedUploadId: "/arbitrary/path" }];
		await assert.rejects(f.admit(media), { code: "ATT_BYTES_MISSING" }); assert.equal(f.store.db.prepare("SELECT count(*) n FROM message_commands").get().n, 1);
	} finally { await f.close(); }
});
