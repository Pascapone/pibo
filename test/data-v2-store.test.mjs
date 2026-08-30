import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { applyPiboDataSchema, PIBO_DATA_SCHEMA_VERSION } from "../dist/data/schema.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredStorageColumn = `${retiredWord}_scope`;
const retiredPrincipalColumn = ["principal", "id"].join("_");
const retiredRoomTables = [["room", "members"].join("_"), ["principal", "session", "stats"].join("_"), ["principal", "room", "stats"].join("_")];
const retiredIndexPattern = new RegExp(`${retiredWord}|principal`, "i");

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
		"session_runtime_bindings",
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
	assert.equal(
		(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_runtime_bindings_native'").get()).count,
		1,
	);
	db.close();
});

test("pibo data store rejects future schemas without mutating them", (t) => {
	const dir = tempDir("pibo-data-future-schema-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const dbPath = join(dir, "pibo.sqlite");
	const futureVersion = PIBO_DATA_SCHEMA_VERSION + 1;
	const future = new DatabaseSync(dbPath);
	future.exec(`
		CREATE TABLE future_only_state (
			id TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			future_metadata TEXT NOT NULL
		);
		INSERT INTO future_only_state VALUES ('synthetic', 'preserve me', '{"future":true}');
		PRAGMA user_version = ${futureVersion};
	`);
	future.close();
	const originalBytes = readFileSync(dbPath);

	const open = () => new PiboDataStore(dbPath, { payloadRootDir: join(dir, "payloads") });
	assert.throws(open, new RegExp(`Pibo database schema version ${futureVersion} is newer than supported version ${PIBO_DATA_SCHEMA_VERSION}`));
	assert.deepEqual(readFileSync(dbPath), originalBytes);
	assert.equal(existsSync(`${dbPath}-wal`), false);
	assert.equal(existsSync(`${dbPath}-shm`), false);

	const inspect = () => {
		const database = new DatabaseSync(dbPath, { readOnly: true });
		try {
			return {
				userVersion: database.prepare("PRAGMA user_version").get().user_version,
				tables: database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all().map((row) => row.name),
				row: { ...database.prepare("SELECT * FROM future_only_state WHERE id = 'synthetic'").get() },
			};
		} finally {
			database.close();
		}
	};
	assert.deepEqual(inspect(), {
		userVersion: futureVersion,
		tables: ["future_only_state"],
		row: { id: "synthetic", value: "preserve me", future_metadata: '{"future":true}' },
	});

	assert.throws(open, /newer than supported/);
	assert.deepEqual(readFileSync(dbPath), originalBytes);
	assert.deepEqual(inspect(), {
		userVersion: futureVersion,
		tables: ["future_only_state"],
		row: { id: "synthetic", value: "preserve me", future_metadata: '{"future":true}' },
	});

	const direct = new DatabaseSync(dbPath);
	assert.throws(() => applyPiboDataSchema(direct), /newer than supported/);
	direct.close();
	assert.deepEqual(readFileSync(dbPath), originalBytes);
});

test("schema migration from v5 installs the exact tool lifecycle index", () => {
	const dir = tempDir("pibo-data-tool-lifecycle-index-");
	const db = new DatabaseSync(join(dir, "pibo.sqlite"));
	applyPiboDataSchema(db);
	db.exec("DROP INDEX idx_event_log_session_tool_event_sequence_stream; PRAGMA user_version = 5");
	applyPiboDataSchema(db);
	const index = db.prepare(`
		SELECT name, sql FROM sqlite_master
		WHERE type = 'index' AND name = 'idx_event_log_session_tool_event_sequence_stream'
	`).get();
	assert.equal(index.name, "idx_event_log_session_tool_event_sequence_stream");
	assert.match(index.sql, /session_id, tool_call_id, event_id, session_sequence ASC, stream_id ASC/);
	assert.equal((db.prepare("PRAGMA user_version").get()).user_version, PIBO_DATA_SCHEMA_VERSION);
	db.close();
});

test("fresh pibo chat schema omits retired room partition structures", () => {
	const dir = tempDir("pibo-chat-app-context-schema-");
	const db = new DatabaseSync(join(dir, "pibo.sqlite"));
	applyPiboDataSchema(db);

	const tables = tableNames(db);
	for (const table of retiredRoomTables) {
		assert.equal(tables.has(table), false, `${table} should not exist in a fresh pibo.sqlite schema`);
	}
	for (const table of ["rooms", "session_navigation", "app_session_read_state", "app_room_read_state"]) {
		const columns = tableColumns(db, table);
		assert.equal(columns.has(retiredStorageColumn), false, `${table}.${retiredStorageColumn} should not exist`);
		assert.equal(columns.has(retiredPrincipalColumn), false, `${table}.${retiredPrincipalColumn} should not exist`);
		assert.equal(indexNames(db, table).some((name) => retiredIndexPattern.test(name)), false, `${table} should not have retired partition indexes`);
	}
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
		turnId: "turn_1",
		role: "assistant",
		status: "streaming",
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

	assert.equal(store.messages.completeAssistantMessagesForTurn({ sessionId: "ps_1", turnId: "turn_1", completedAt: "2026-05-08T00:00:07.000Z" }), 1);
	assert.deepEqual(store.messages.listMessages("ps_1").map((row) => row.id), ["msg_1", "msg_2"]);
	const completedMessage = store.messages.getMessage("msg_2");
	assert.equal(completedMessage?.status, "complete");
	assert.equal(completedMessage?.completedAt, "2026-05-08T00:00:07.000Z");
	assert.deepEqual(store.observations.listSession("ps_1").map((row) => row.id), ["obs_1", "obs_2"]);

	store.close();
});


test("v2 schema backfills legacy Pi bindings and keeps old-writer Pi updates synchronized", () => {
	const dir = tempDir("pibo-data-v2-binding-migration-");
	const dbPath = join(dir, "pibo.sqlite");
	const db = new DatabaseSync(dbPath);
	db.exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			pi_session_id TEXT UNIQUE,
			room_id TEXT,
			root_session_id TEXT,
			parent_id TEXT,
			origin_id TEXT,
			channel TEXT NOT NULL,
			kind TEXT NOT NULL,
			profile TEXT NOT NULL,
			active_model_json TEXT,
			workspace TEXT,
			title TEXT NOT NULL DEFAULT 'Untitled Session',
			first_message_preview TEXT,
			status TEXT NOT NULL DEFAULT 'idle',
			archived_at TEXT,
			deleted_at TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_activity_at TEXT NOT NULL
		);
	`);
	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, channel, kind, profile, title, status,
			metadata_json, created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"ps_legacy", "pi-legacy", "test", "chat", "base", "Legacy", "idle", "{}",
		"2026-08-14T00:00:00.000Z", "2026-08-14T00:01:00.000Z", "2026-08-14T00:01:00.000Z",
	);

	applyPiboDataSchema(db);
	const backfilled = db.prepare("SELECT * FROM session_runtime_bindings WHERE pibo_session_id = ?").get("ps_legacy");
	assert.equal(backfilled.runtime_instance_id, "pi");
	assert.equal(backfilled.runtime_adapter_id, "pi");
	assert.equal(backfilled.native_session_id, "pi-legacy");
	assert.equal(backfilled.binding_state, "bound");
	assert.deepEqual(JSON.parse(backfilled.metadata_json), {
		migrationSource: "schema-v4",
		nativePresenceExpected: false,
		nativeHistoryFallback: true,
		historyMigrationSource: "schema-v5",
	});
	assert.equal(db.prepare("SELECT pi_session_id FROM sessions WHERE id = ?").get("ps_legacy").pi_session_id, "pi-legacy");

	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, channel, kind, profile, title, status,
			metadata_json, created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"ps_old_writer", "pi-old-writer", "test", "chat", "base", "Old writer", "idle", "{}",
		"2026-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z",
	);
	assert.equal(
		db.prepare("SELECT binding_state FROM session_runtime_bindings WHERE pibo_session_id = ?").get("ps_old_writer").binding_state,
		"unbound",
	);
	db.prepare("UPDATE sessions SET pi_session_id = ?, updated_at = ? WHERE id = ?")
		.run("pi-old-writer-moved", "2026-08-15T00:01:00.000Z", "ps_old_writer");
	const synchronized = db.prepare("SELECT native_session_id, binding_state, metadata_json FROM session_runtime_bindings WHERE pibo_session_id = ?").get("ps_old_writer");
	assert.equal(synchronized.native_session_id, "pi-old-writer-moved");
	assert.equal(synchronized.binding_state, "bound");
	assert.equal(JSON.parse(synchronized.metadata_json).nativeHistoryFallback, undefined);

	// A rolled-back writer can ignore the additive table and continue using the Pi column.
	db.exec("PRAGMA user_version = 3");
	assert.deepEqual(
		db.prepare("SELECT id, pi_session_id FROM sessions ORDER BY id").all().map((row) => ({ ...row })),
		[
			{ id: "ps_legacy", pi_session_id: "pi-legacy" },
			{ id: "ps_old_writer", pi_session_id: "pi-old-writer-moved" },
		],
	);
	applyPiboDataSchema(db);
	assert.equal(db.prepare("PRAGMA user_version").get().user_version, PIBO_DATA_SCHEMA_VERSION);
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM session_runtime_bindings").get().count, 2);
	db.close();
});
