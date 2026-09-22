import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AsyncChatStorage } from "../dist/data/async-chat-storage.js";
import { MessageCommandStore } from "../dist/data/message-command-store.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { createMessageContentBinding } from "../dist/shared/message-content-binding.js";

import { waitForAsyncStorageReady } from "./helpers/storage-ready.mjs";

async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-command-binding-"));
	const store = new PiboDataStore(join(root, "data.sqlite"), { payloadRootDir: join(root, "payloads") });
	const room = new ChatRoomService(store).ensureDefaultRoom();
	const session = new InMemoryPiboSessionStore().create({ channel: "test", kind: "chat", profile: "base", metadata: { chatRoomId: room.id } });
	let storage = new AsyncChatStorage(store.path, join(root, "payloads"));
	try { await waitForAsyncStorageReady(storage); } catch (error) { await storage.close(); store.close(); rmSync(root, { recursive: true, force: true }); throw error; }
	const body = (txn = "txn") => ({ admissionVersion: 2, contentBindingVersion: 1, piboSessionId: session.id, clientTxnId: txn, text: "plain", delivery: "queue", attachments: [{ id: "a", revision: 1, type: "pibo.core/note", schemaVersion: 1, payload: { text: "frozen" } }] });
	const admit = (requestBody, text = "materialized text", legacy = false) => storage.admit({ roomId: room.id, piboSessionId: session.id, eventType: "user.message.accepted", actorType: "user", actorId: "actor", clientTxnId: requestBody.clientTxnId, retentionClass: "chat_message", payload: { type: "user.message.accepted", text } }, session, text, { eventId: requestBody.clientTxnId, delivery: requestBody.delivery, ...(legacy ? {} : { requestBody }) });
	return { store, room, session, body, admit, get storage() { return storage; }, async restart() { await storage.close(); storage = new AsyncChatStorage(store.path, join(root, "payloads")); await waitForAsyncStorageReady(storage); }, async close() { await storage.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("accepted request binding is atomic, server-derived and durable across duplicates and worker restart", async () => {
	const f = await fixture();
	try {
		const body = f.body();
		body.contentBinding = { version: 1, sha256: "f".repeat(64) }; // not authority
		const expected = createMessageContentBinding({ sessionId: f.session.id, delivery: "queue", body });
		const results = await Promise.all(Array.from({ length: 10 }, () => f.admit(body)));
		assert.equal(results.filter(value => value.created).length, 1);
		for (const result of results) assert.deepEqual(result.receipt.contentBinding, expected);
		assert.notDeepEqual(expected, body.contentBinding);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM message_commands").get().n, 1);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM payloads WHERE retention_class LIKE '%digest%' OR retention_class LIKE '%binding%'").get().n, 0, "no sidecar store");
		const id = results[0].receipt.id;
		await f.restart();
		assert.deepEqual((await f.storage.commandReceipt(id)).contentBinding, expected);
		assert.deepEqual((await f.storage.commandReceiptPage(f.session.id)).receipts[0].contentBinding, expected);
		assert.deepEqual((await f.storage.commandReceipts(f.session.id))[0].contentBinding, expected);
		const claim = await f.storage.claimCommand("owner", 30000);
		assert.equal(claim.text, "materialized text", "claim still reads the unchanged plain-text payload");
		assert.deepEqual(claim.contentBinding, expected);
	} finally { await f.close(); }
});

test("same transaction rejects changed raw content, resource refs, delivery, final text and binding downgrade", async () => {
	const f = await fixture();
	try {
		const original = f.body(); const accepted = await f.admit(original);
		const reordered = Object.fromEntries(Object.entries(original).reverse());
		assert.equal((await f.admit(reordered)).created, false);
		for (const change of [
			body => { body.attachments[0].payload.text = "changed"; },
			body => { body.attachments[0].revision = 2; },
			body => { body.resources = [{ id: "other-upload" }]; },
			body => { body.delivery = "steer"; },
		]) {
			const changed = structuredClone(original); change(changed);
			await assert.rejects(f.admit(changed), { code: "command_conflict" });
		}
		await assert.rejects(f.admit(original, "different materialization"), { code: "command_conflict" });
		await assert.rejects(f.admit(original, "materialized text", true), { code: "command_conflict" });
		assert.deepEqual((await f.storage.commandReceipt(accepted.receipt.id)).contentBinding, accepted.receipt.contentBinding);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM message_commands").get().n, 1);
	} finally { await f.close(); }
});

test("unflagged fingerprints and old receipts remain exact legacy values, never silently upgraded", async () => {
	const f = await fixture();
	try {
		const content = { sessionId: f.session.id, roomId: f.room.id, text: "legacy", delivery: "queue" };
		assert.equal(new MessageCommandStore(f.store).fingerprint(content), createHash("sha256").update(JSON.stringify(content)).digest("hex"));
		const body = f.body(); const accepted = await f.admit(body, "legacy", true);
		assert.equal(accepted.receipt.contentBinding, undefined);
		assert.equal((await f.admit(body, "legacy", true)).created, false);
		await assert.rejects(f.admit(body, "legacy"), { code: "command_conflict" });
		await f.restart();
		assert.equal((await f.storage.commandReceipt(accepted.receipt.id)).contentBinding, undefined);
	} finally { await f.close(); }
});

test("receipt binding survives model failure, interrupted execution and loss of the optional event projection", async () => {
	const f = await fixture();
	try {
		const firstBody = f.body("first"); const first = await f.admit(firstBody);
		new MessageCommandStore(f.store).recordOutput(f.session.id, "first", "session_error");
		assert.equal((await f.storage.commandReceipt(first.receipt.id)).state, "failed");
		assert.deepEqual((await f.storage.commandReceipt(first.receipt.id)).contentBinding, first.receipt.contentBinding);
		const secondBody = f.body("second"); const second = await f.admit(secondBody);
		const claim = await f.storage.claimCommand("owner", 30000);
		assert.equal(claim.id, second.receipt.id);
		await f.storage.transitionCommand(claim.id, "owner", claim.token, "initializing");
		f.store.db.prepare("UPDATE message_commands SET lease_until=0 WHERE id=?").run(claim.id);
		assert.equal(await f.storage.claimCommand("next", 30000), undefined);
		assert.equal((await f.storage.commandReceipt(claim.id)).state, "interrupted");
		assert.deepEqual((await f.storage.commandReceipt(claim.id)).contentBinding, second.receipt.contentBinding);
		// Only this test-owned projection is removed; commands/receipts remain.
		assert.ok(f.store.db.prepare("DELETE FROM event_log WHERE topic='chat'").run().changes > 0);
		const before = f.store.db.prepare("SELECT count(*) n FROM event_log").get().n;
		const duplicate = await f.admit(secondBody);
		assert.equal(duplicate.created, false);
		assert.equal(duplicate.event, undefined);
		assert.equal(duplicate.receipt.id, second.receipt.id);
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM event_log").get().n, before, "retry must not recreate accepted history");
	} finally { await f.close(); }
});

test("capacity rejection leaves no accepted binding and unchanged retry can subsequently succeed", async () => {
	const f = await fixture();
	try {
		for (let i = 0; i < 64; i++) await f.admit(f.body(`full-${i}`));
		await assert.rejects(f.admit(f.body("overflow")), { code: "command_overloaded" });
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM message_commands WHERE event_id='overflow'").get().n, 0);
		new MessageCommandStore(f.store).recordOutput(f.session.id, "full-0", "message_finished");
		const retry = await f.admit(f.body("overflow"));
		assert.equal(retry.created, true);
		assert.ok(retry.receipt.contentBinding);
	} finally { await f.close(); }
});

test("malformed or foreign captured request identity never creates a receipt", async () => {
	const f = await fixture();
	try {
		for (const changes of [{ contentBindingVersion: 2 }, { piboSessionId: "foreign" }, { clientTxnId: "" }, { delivery: "other" }]) {
			await assert.rejects(f.admit({ ...f.body(), ...changes }), { code: "command_invalid_content_binding" });
		}
		assert.equal(f.store.db.prepare("SELECT count(*) n FROM message_commands").get().n, 0);
	} finally { await f.close(); }
});
