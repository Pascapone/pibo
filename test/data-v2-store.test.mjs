import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { applyPiboDataSchema, PIBO_DATA_SCHEMA_VERSION } from "../dist/data/schema.js";
import { hydrateDebugEventRow } from "../dist/debug/persisted-payloads.js";

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
		"session_agent_observation_auto_cursors",
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
	assert.deepEqual(
		db.prepare("SELECT name FROM pragma_index_info('idx_payloads_identity') ORDER BY seqno").all().map((row) => row.name),
		["sha256", "content_type", "retention_class"],
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

test("schema v8 migrates payload identity without rewriting existing payload files", (t) => {
	const dir = tempDir("pibo-data-v8-payload-identity-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const dbPath = join(dir, "pibo.sqlite");
	const payloadRootDir = join(dir, "payloads");
	const text = '{"kind":"legacy","value":42}';
	let store = new PiboDataStore(dbPath, { payloadRootDir });
	const legacy = store.payloads.writePayload({
		value: text,
		contentType: "text/plain; charset=utf-8",
		retentionClass: "trace_event",
	});
	const legacyPath = legacy.storagePath;
	store.db.exec(`
		DROP INDEX idx_payloads_identity;
		CREATE UNIQUE INDEX idx_payloads_sha256_v7 ON payloads(sha256);
		PRAGMA user_version = 7;
	`);
	store.close();

	store = new PiboDataStore(dbPath, { payloadRootDir });
	assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, PIBO_DATA_SCHEMA_VERSION);
	assert.equal(store.payloads.getPayload(legacy.id).storagePath, legacyPath);
	assert.equal(store.payloads.readPayloadText(legacy.id), text);
	assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name = 'idx_payloads_sha256_v7'").get().count, 0);
	assert.deepEqual(
		store.db.prepare("SELECT name FROM pragma_index_info('idx_payloads_identity') ORDER BY seqno").all().map((row) => row.name),
		["sha256", "content_type", "retention_class"],
	);
	const structured = store.payloads.writePayload({
		value: { kind: "legacy", value: 42 },
		contentType: "application/json",
		retentionClass: "trace_event",
	});
	assert.equal(structured.sha256, legacy.sha256);
	assert.notEqual(structured.id, legacy.id);
	assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM payloads WHERE sha256 = ?").get(legacy.sha256).count, 2);
	const queryPlan = store.db.prepare(`
		EXPLAIN QUERY PLAN
		SELECT * FROM payloads WHERE sha256 = ? AND content_type = ? AND retention_class = ?
	`).all(legacy.sha256, legacy.contentType, legacy.retentionClass);
	assert.ok(queryPlan.some((row) => String(row.detail).includes("idx_payloads_identity")));
	store.close();

	store = new PiboDataStore(dbPath, { payloadRootDir });
	assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM payloads WHERE sha256 = ?").get(legacy.sha256).count, 2);
	assert.equal(store.payloads.readPayloadText(legacy.id), text);
	assert.deepEqual(store.payloads.readPayloadJson(structured.id), { kind: "legacy", value: 42 });
	store.close();
});

test("schema upgrades preserve post-v5 session history metadata", (t) => {
	const dir = tempDir("pibo-data-v5-history-metadata-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const dbPath = join(dir, "pibo.sqlite");
	const db = new DatabaseSync(dbPath);
	applyPiboDataSchema(db);
	const timestamp = "2026-09-03T00:00:00.000Z";
	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, channel, kind, profile, title, status,
			metadata_json, created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run("ps_created_on_v5", "pi-created-on-v5", "test", "chat", "base", "Created on v5", "idle", "{}", timestamp, timestamp, timestamp);
	db.prepare("UPDATE session_runtime_bindings SET metadata_json = ? WHERE pibo_session_id = ?")
		.run('{"createdOn":"v5"}', "ps_created_on_v5");
	db.exec("PRAGMA user_version = 5");
	db.close();

	const store = new PiboDataStore(dbPath, { payloadRootDir: join(dir, "payloads") });
	assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, PIBO_DATA_SCHEMA_VERSION);
	assert.deepEqual(
		JSON.parse(store.db.prepare("SELECT metadata_json FROM session_runtime_bindings WHERE pibo_session_id = ?").get("ps_created_on_v5").metadata_json),
		{ createdOn: "v5" },
	);
	store.close();

	const reopened = new PiboDataStore(dbPath, { payloadRootDir: join(dir, "payloads") });
	assert.deepEqual(
		JSON.parse(reopened.db.prepare("SELECT metadata_json FROM session_runtime_bindings WHERE pibo_session_id = ?").get("ps_created_on_v5").metadata_json),
		{ createdOn: "v5" },
	);
	reopened.close();
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

test("payload deduplication keeps incompatible interpretation metadata isolated", () => {
	const dir = tempDir("pibo-data-payload-metadata-");
	const store = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
	const text = '{"kind":"tool_result","value":42}';
	const plain = store.payloads.writePayload({
		value: text,
		contentType: "text/plain; charset=utf-8",
		retentionClass: "chat_message",
	});
	const json = store.payloads.writePayload({
		value: { kind: "tool_result", value: 42 },
		contentType: "application/json",
		retentionClass: "tool_result",
	});
	const audit = store.payloads.writePayload({
		value: text,
		contentType: "text/plain; charset=utf-8",
		retentionClass: "audit_event",
	});
	const duplicatePlain = store.payloads.writePayload({
		value: text,
		contentType: "text/plain; charset=utf-8",
		retentionClass: "chat_message",
	});

	assert.equal(plain.sha256, json.sha256);
	assert.equal(plain.sha256, audit.sha256);
	assert.notEqual(plain.id, json.id);
	assert.notEqual(plain.id, audit.id);
	assert.equal(duplicatePlain.id, plain.id);
	assert.equal(store.payloads.getPayload(plain.id).refCount, 2);
	assert.equal(store.payloads.readPayloadText(plain.id), text);
	assert.deepEqual(store.payloads.readPayloadJson(json.id), { kind: "tool_result", value: 42 });
	assert.equal(store.payloads.readPayloadText(audit.id), text);
	assert.equal(new Set([plain.storagePath, json.storagePath, audit.storagePath]).size, 3);
	assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM payloads WHERE sha256 = ?").get(plain.sha256).count, 3);
	const hydrated = hydrateDebugEventRow({ payload_ref: plain.id, attributes_json: "{}" }, store.payloads);
	assert.equal(JSON.parse(hydrated.attributes_json).inlinePayload, text);

	store.payloads.releaseReferences(plain.id, 2);
	store.payloads.removeReleasedFile(plain);
	assert.equal(existsSync(join(dir, "payloads", plain.storagePath)), false);
	assert.deepEqual(store.payloads.readPayloadJson(json.id), { kind: "tool_result", value: 42 });
	assert.equal(store.payloads.readPayloadText(audit.id), text);

	store.close();
	rmSync(dir, { recursive: true, force: true });
});

test("application/json payloads serialize primitive strings as valid JSON", () => {
	const dir = tempDir("pibo-data-json-string-");
	const store = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
	const payload = store.payloads.writePayload({
		value: "ordinary text",
		contentType: "application/json",
		retentionClass: "trace_event",
	});

	assert.equal(store.payloads.readPayloadText(payload.id), '"ordinary text"');
	assert.equal(store.payloads.readPayloadJson(payload.id), "ordinary text");

	store.close();
	rmSync(dir, { recursive: true, force: true });
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
