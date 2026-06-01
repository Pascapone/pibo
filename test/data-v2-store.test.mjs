import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { migrateLegacyChatDataSchemaToOwnerless } from "../dist/data/final-app-space-cutover-migration.js";
import { applyPiboDataSchema, PIBO_DATA_SCHEMA_VERSION } from "../dist/data/schema.js";

function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

function tableNames(db) {
	return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map((row) => row.name));
}

function tableColumns(db, table) {
	return new Set((db.prepare(`PRAGMA table_info(${table})`).all()).map((row) => row.name));
}

function indexNames(db, table) {
	return (db.prepare(`PRAGMA index_list(${table})`).all()).map((row) => row.name);
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
		"payloads",
		"event_log",
		"chat_messages",
		"observations",
		"session_stats",
		"app_session_read_state",
		"app_room_read_state",
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

test("fresh pibo chat schema omits owner/principal room structures", () => {
	const dir = tempDir("pibo-chat-ownerless-schema-");
	const db = new DatabaseSync(join(dir, "pibo.sqlite"));
	applyPiboDataSchema(db);

	const tables = tableNames(db);
	for (const table of ["room_members", "principal_session_stats", "principal_room_stats"]) {
		assert.equal(tables.has(table), false, `${table} should not exist in a fresh pibo.sqlite schema`);
	}
	for (const table of ["rooms", "session_navigation", "app_session_read_state", "app_room_read_state"]) {
		const columns = tableColumns(db, table);
		assert.equal(columns.has("owner_scope"), false, `${table}.owner_scope should not exist`);
		assert.equal(columns.has("principal_id"), false, `${table}.principal_id should not exist`);
		assert.equal(indexNames(db, table).some((name) => /owner|principal/i.test(name)), false, `${table} should not have owner/principal indexes`);
	}
	db.close();
});

test("legacy pibo chat schema migration drops owner columns and merges principal read state", () => {
	const dir = tempDir("pibo-chat-ownerless-migration-");
	const db = new DatabaseSync(join(dir, "pibo.sqlite"));
	try {
		db.exec(`
			CREATE TABLE rooms (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				topic TEXT,
				type TEXT NOT NULL,
				parent_room_id TEXT,
				workspace TEXT,
				archived_at TEXT,
				retention_policy_id TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX idx_rooms_owner_updated ON rooms(owner_scope, updated_at);
			CREATE TABLE session_navigation (
				owner_scope TEXT NOT NULL,
				room_id TEXT,
				session_id TEXT NOT NULL,
				root_session_id TEXT,
				parent_id TEXT,
				origin_id TEXT,
				title TEXT NOT NULL,
				profile TEXT NOT NULL,
				status TEXT NOT NULL,
				archived_at TEXT,
				last_activity_at TEXT NOT NULL,
				last_message_preview TEXT,
				child_count INTEGER NOT NULL DEFAULT 0,
				sort_key TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX idx_session_navigation_owner_sort ON session_navigation(owner_scope, sort_key);
			CREATE TABLE room_members (room_id TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(room_id, principal_id));
			CREATE TABLE principal_session_stats (session_id TEXT NOT NULL, principal_id TEXT NOT NULL, unread_count INTEGER NOT NULL DEFAULT 0, last_read_stream_id INTEGER NOT NULL DEFAULT 0, last_read_message_sequence INTEGER NOT NULL DEFAULT 0, last_read_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, principal_id));
			CREATE TABLE principal_room_stats (room_id TEXT NOT NULL, principal_id TEXT NOT NULL, unread_count INTEGER NOT NULL DEFAULT 0, last_read_stream_id INTEGER NOT NULL DEFAULT 0, last_read_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(room_id, principal_id));
		`);
		db.prepare("INSERT INTO rooms (id, owner_scope, name, type, archived_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("room_old_default", "shared:app", "Shared Chat", "chat", null, JSON.stringify({ default: true }), "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
		db.prepare("INSERT INTO rooms (id, owner_scope, name, type, archived_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("room_new_default", "user:legacy", "Personal Chat", "chat", null, JSON.stringify({ default: true }), "2026-05-30T00:00:00.000Z", "2026-05-30T00:02:00.000Z");
		db.prepare("INSERT INTO rooms (id, owner_scope, name, type, archived_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("room_archived_default", "user:other", "Archived Chat", "chat", "2026-05-30T00:03:00.000Z", JSON.stringify({ default: true }), "2026-05-30T00:00:00.000Z", "2026-05-30T00:03:00.000Z");
		for (const row of [
			["shared:app", "room_old_default", "ps_dup", "Old title", "2026-05-30T00:00:00.000Z"],
			["user:legacy", "room_new_default", "ps_dup", "New title", "2026-05-30T00:02:00.000Z"],
			["user:other", "room_archived_default", "ps_other", "Other title", "2026-05-30T00:01:00.000Z"],
		]) {
			db.prepare("INSERT INTO session_navigation (owner_scope, room_id, session_id, root_session_id, title, profile, status, last_activity_at, sort_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row[0], row[1], row[2], row[2], row[3], "default", "idle", row[4], row[4], row[4]);
		}
		db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)").run("room_new_default", "user:legacy", "owner", "2026-05-30T00:00:00.000Z");
		db.prepare("INSERT INTO principal_session_stats (session_id, principal_id, unread_count, last_read_stream_id, last_read_message_sequence, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ps_dup", "shared:app", 1, 5, 4, "2026-05-30T00:01:00.000Z", "2026-05-30T00:01:00.000Z");
		db.prepare("INSERT INTO principal_session_stats (session_id, principal_id, unread_count, last_read_stream_id, last_read_message_sequence, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ps_dup", "user:legacy", 3, 7, 2, "2026-05-30T00:03:00.000Z", "2026-05-30T00:03:00.000Z");
		db.prepare("INSERT INTO principal_room_stats (room_id, principal_id, unread_count, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("room_new_default", "shared:app", 2, 4, "2026-05-30T00:01:00.000Z", "2026-05-30T00:01:00.000Z");
		db.prepare("INSERT INTO principal_room_stats (room_id, principal_id, unread_count, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("room_new_default", "user:legacy", 5, 8, "2026-05-30T00:04:00.000Z", "2026-05-30T00:04:00.000Z");

		applyPiboDataSchema(db);
		migrateLegacyChatDataSchemaToOwnerless(db);

		for (const table of ["room_members", "principal_session_stats", "principal_room_stats"]) assert.equal(tableNames(db).has(table), false, `${table} should be dropped`);
		for (const table of ["rooms", "session_navigation", "app_session_read_state", "app_room_read_state"]) {
			assert.equal(tableColumns(db, table).has("owner_scope"), false, `${table}.owner_scope should be dropped`);
			assert.equal(tableColumns(db, table).has("principal_id"), false, `${table}.principal_id should be dropped`);
			assert.equal(indexNames(db, table).some((name) => /owner|principal/i.test(name)), false, `${table} owner/principal index should be dropped`);
		}
		const defaults = db.prepare("SELECT id, metadata_json FROM rooms ORDER BY id ASC").all().filter((row) => JSON.parse(row.metadata_json).default === true).map((row) => row.id);
		assert.deepEqual(defaults, ["room_new_default"]);
		assert.deepEqual({ ...db.prepare("SELECT room_id, title FROM session_navigation WHERE session_id = ?").get("ps_dup") }, { room_id: "room_new_default", title: "New title" });
		const sessionReadState = db.prepare("SELECT unread_count, last_read_stream_id, last_read_message_sequence, last_read_at FROM app_session_read_state WHERE session_id = ?").get("ps_dup");
		assert.deepEqual({ ...sessionReadState }, { unread_count: 3, last_read_stream_id: 7, last_read_message_sequence: 4, last_read_at: "2026-05-30T00:03:00.000Z" });
		const roomReadState = db.prepare("SELECT unread_count, last_read_stream_id, last_read_at FROM app_room_read_state WHERE room_id = ?").get("room_new_default");
		assert.deepEqual({ ...roomReadState }, { unread_count: 5, last_read_stream_id: 8, last_read_at: "2026-05-30T00:04:00.000Z" });
	} finally {
		db.close();
	}
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
