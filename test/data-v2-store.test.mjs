import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { applyPiboDataSchema, PIBO_DATA_SCHEMA_VERSION } from "../dist/data/schema.js";

function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("v2 schema migration is idempotent", () => {
	const dir = tempDir("pibo-data-v2-schema-");
	const dbPath = join(dir, "pibo.sqlite");
	const db = new DatabaseSync(dbPath);
	applyPiboDataSchema(db);
	applyPiboDataSchema(db);

	const tables = new Set(
		(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map((row) => row.name),
	);
	for (const table of [
		"sessions",
		"rooms",
		"room_members",
		"payloads",
		"event_log",
		"chat_messages",
		"observations",
		"session_stats",
		"principal_session_stats",
		"principal_room_stats",
		"session_navigation",
		"indexer_offsets",
		"migration_import_map",
	]) {
		assert.equal(tables.has(table), true, `missing table ${table}`);
	}
	assert.equal(
		(db.prepare("PRAGMA user_version").get()).user_version,
		PIBO_DATA_SCHEMA_VERSION,
	);
	assert.equal(
		(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_event_log_idempotency'").get()).count,
		1,
	);
	db.close();
});

test("payload store writes, reads, and dedupes payloads", () => {
	const dir = tempDir("pibo-data-v2-payload-");
	const store = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });

	const first = store.payloads.writePayload({
		value: { type: "assistant_message", text: "hello" },
		retentionClass: "trace_event",
	});
	const second = store.payloads.writePayload({
		value: { type: "assistant_message", text: "hello" },
		retentionClass: "trace_event",
	});

	assert.equal(first.id, second.id);
	assert.equal(first.sha256, second.sha256);
	assert.equal(store.payloads.getPayload(first.id).refCount, 2);
	assert.deepEqual(store.payloads.readPayloadJson(first.id), { type: "assistant_message", text: "hello" });
	assert.equal(existsSync(join(dir, "payloads", first.storagePath)), true);
	assert.equal(
		store.db.prepare("SELECT COUNT(*) AS count FROM payloads").get().count,
		1,
	);

	store.close();
});

test("event log append is idempotent by idempotency key", () => {
	const dir = tempDir("pibo-data-v2-events-");
	const store = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });

	const first = store.eventLog.appendEvent({
		sessionId: "ps_1",
		roomId: "room_1",
		topic: "chat",
		type: "assistant_message",
		source: "router",
		idempotencyKey: "append-1",
		retentionClass: "trace_event",
		previewText: "hello",
		attributes: { foo: "bar" },
	});
	const second = store.eventLog.appendEvent({
		sessionId: "ps_1",
		roomId: "room_1",
		topic: "chat",
		type: "assistant_message",
		source: "router",
		idempotencyKey: "append-1",
		retentionClass: "trace_event",
		previewText: "ignored",
	});

	assert.equal(first.streamId, second.streamId);
	assert.equal(store.eventLog.listEvents({ sessionId: "ps_1" }).length, 1);
	assert.deepEqual(store.eventLog.listEvents({ sessionId: "ps_1" })[0].attributes, { foo: "bar" });

	store.close();
});

test("message and observation stores support simple insert and list", () => {
	const dir = tempDir("pibo-data-v2-message-");
	const store = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });

	store.messages.insertMessage({
		id: "msg_1",
		sessionId: "ps_1",
		roomId: "room_1",
		sequence: 1,
		role: "user",
		status: "accepted",
		createdAt: "2026-05-08T00:00:00.000Z",
		contentPreview: "hello",
	});
	store.messages.insertMessage({
		id: "msg_2",
		sessionId: "ps_1",
		roomId: "room_1",
		sequence: 2,
		role: "assistant",
		status: "complete",
		createdAt: "2026-05-08T00:00:01.000Z",
		contentPreview: "world",
	});
	store.observations.appendObservation({
		id: "obs_1",
		sessionId: "ps_1",
		sequence: 1,
		kind: "user_message",
		status: "ok",
		startedAt: "2026-05-08T00:00:00.000Z",
		previewText: "hello",
	});
	store.observations.appendObservation({
		id: "obs_2",
		sessionId: "ps_1",
		sequence: 2,
		kind: "assistant_message",
		status: "ok",
		startedAt: "2026-05-08T00:00:01.000Z",
		previewText: "world",
	});

	assert.deepEqual(store.messages.listMessages("ps_1").map((row) => row.id), ["msg_1", "msg_2"]);
	assert.deepEqual(store.observations.listSession("ps_1").map((row) => row.id), ["obs_1", "obs_2"]);

	store.close();
});
