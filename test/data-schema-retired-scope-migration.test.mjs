import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { applyPiboDataSchema, PIBO_DATA_SCHEMA_VERSION } from "../dist/data/schema.js";

const retiredStorageColumn = ["owner", "scope"].join("_");
const retiredSessionIndex = ["idx", "sessions", "owner", "activity"].join("_");
const retiredNavigationIndex = ["idx", "session", "navigation", "owner", "room", "sort"].join("_");
const legacyScopeValue = ["shared", "app"].join(":");
const fixtureTime = "2026-08-30T00:00:00.000Z";

function tempDatabase(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return { dir, path: join(dir, "pibo.sqlite") };
}

function columns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function seedRetiredScopeSchema(path, version, { includeRuntimeBindings = false, invalidForeignKey = false } = {}) {
	const db = new DatabaseSync(path);
	db.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			pi_session_id TEXT UNIQUE,
			${retiredStorageColumn} TEXT NOT NULL,
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
		CREATE TABLE rooms (
			id TEXT PRIMARY KEY,
			${retiredStorageColumn} TEXT NOT NULL,
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
		CREATE TABLE session_navigation (
			${retiredStorageColumn} TEXT NOT NULL,
			room_id TEXT,
			session_id TEXT PRIMARY KEY,
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
		CREATE TABLE legacy_session_links (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
		);
		CREATE TABLE legacy_room_links (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
		);
		CREATE INDEX ${retiredSessionIndex}
			ON sessions(${retiredStorageColumn}, archived_at, last_activity_at DESC);
		CREATE INDEX ${retiredNavigationIndex}
			ON session_navigation(${retiredStorageColumn}, room_id, archived_at, sort_key DESC);
		PRAGMA user_version = ${version};
	`);
	db.prepare(`
		INSERT INTO rooms (
			id, ${retiredStorageColumn}, name, topic, type, parent_room_id, workspace,
			archived_at, retention_policy_id, metadata_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run("room_legacy", legacyScopeValue, "Legacy room", "migration fixture", "project", null, "/tmp/pibo-717", null, "retain", '{"fixture":"room"}', fixtureTime, fixtureTime);
	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, ${retiredStorageColumn}, room_id, root_session_id, parent_id,
			origin_id, channel, kind, profile, active_model_json, workspace, title,
			first_message_preview, status, archived_at, deleted_at, metadata_json,
			created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run("ps_legacy", "native_legacy", legacyScopeValue, "room_legacy", "ps_legacy", null, "origin_legacy", "pibo.chat-web", "chat", "base", '{"provider":"fixture","id":"model"}', "/tmp/pibo-717", "Legacy session", "first message", "idle", null, null, '{"fixture":"session"}', fixtureTime, fixtureTime, fixtureTime);
	db.prepare(`
		INSERT INTO session_navigation (
			${retiredStorageColumn}, room_id, session_id, root_session_id, parent_id,
			origin_id, title, profile, status, archived_at, last_activity_at,
			last_message_preview, child_count, sort_key, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(legacyScopeValue, "room_legacy", "ps_legacy", "ps_legacy", null, "origin_legacy", "Legacy session", "base", "idle", null, fixtureTime, "last message", 2, fixtureTime, fixtureTime);
	db.prepare("INSERT INTO legacy_session_links (id, session_id) VALUES (?, ?)").run("session_link", "ps_legacy");
	db.prepare("INSERT INTO legacy_room_links (id, room_id) VALUES (?, ?)").run("room_link", "room_legacy");
	if (includeRuntimeBindings) {
		db.exec(`
			CREATE TABLE session_runtime_bindings (
				pibo_session_id TEXT PRIMARY KEY,
				runtime_instance_id TEXT NOT NULL,
				runtime_adapter_id TEXT NOT NULL,
				native_session_id TEXT,
				binding_state TEXT NOT NULL,
				protocol TEXT,
				protocol_version TEXT,
				adapter_version TEXT,
				locator_json TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				revision INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
			);
		`);
		db.prepare(`
			INSERT INTO session_runtime_bindings (
				pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
				binding_state, protocol, metadata_json, revision, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run("ps_legacy", "fixture", "pi", "native_legacy", "bound", "pi-sdk", '{"fixture":"binding","nativeHistoryFallback":true,"historyMigrationSource":"schema-v5"}', 3, fixtureTime, fixtureTime);
	}
	if (invalidForeignKey) {
		db.exec("PRAGMA foreign_keys = OFF");
		db.prepare("INSERT INTO legacy_session_links (id, session_id) VALUES (?, ?)").run("broken_link", "ps_missing");
	}
	db.close();
}

function writeCurrentRows(store, suffix) {
	new ChatRoomService(store).createRoom({ id: `room_${suffix}`, name: `Room ${suffix}`, type: "chat" });
	store.sessions.upsertSession({
		roomId: `room_${suffix}`,
		session: {
			id: `ps_${suffix}`,
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			title: `Session ${suffix}`,
			metadata: { fixture: suffix },
			createdAt: fixtureTime,
			updatedAt: fixtureTime,
		},
	});
	store.navigation.upsertSession({
		roomId: `room_${suffix}`,
		sessionId: `ps_${suffix}`,
		rootSessionId: `ps_${suffix}`,
		title: `Session ${suffix}`,
		profile: "base",
		status: "idle",
		lastActivityAt: fixtureTime,
		sortKey: fixtureTime,
		updatedAt: fixtureTime,
	});
}

for (const version of [1, 2]) {
	test(`schema v${version} upgrade removes retired required scope while preserving data and foreign keys`, () => {
		const { dir, path } = tempDatabase(`pibo-data-retired-scope-v${version}-`);
		seedRetiredScopeSchema(path, version);

		let store = new PiboDataStore(path, { payloadRootDir: join(dir, "payloads") });
		for (const table of ["sessions", "rooms", "session_navigation"]) {
			assert.equal(columns(store.db, table).has(retiredStorageColumn), false, `${table} retained ${retiredStorageColumn}`);
		}
		assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, PIBO_DATA_SCHEMA_VERSION);
		assert.equal(store.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
		assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name IN (?, ?)").get(retiredSessionIndex, retiredNavigationIndex).count, 0);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_sessions_room_activity', 'idx_session_navigation_room_sort')").get().count, 2);
		assert.deepEqual({ ...store.db.prepare("SELECT name, topic, type, workspace, retention_policy_id, metadata_json FROM rooms WHERE id = 'room_legacy'").get() }, {
			name: "Legacy room",
			topic: "migration fixture",
			type: "project",
			workspace: "/tmp/pibo-717",
			retention_policy_id: "retain",
			metadata_json: '{"fixture":"room"}',
		});
		assert.deepEqual({ ...store.db.prepare("SELECT pi_session_id, room_id, origin_id, active_model_json, workspace, first_message_preview, metadata_json FROM sessions WHERE id = 'ps_legacy'").get() }, {
			pi_session_id: "native_legacy",
			room_id: "room_legacy",
			origin_id: "origin_legacy",
			active_model_json: '{"provider":"fixture","id":"model"}',
			workspace: "/tmp/pibo-717",
			first_message_preview: "first message",
			metadata_json: '{"fixture":"session"}',
		});
		assert.deepEqual(store.navigation.getSession("ps_legacy"), {
			roomId: "room_legacy",
			sessionId: "ps_legacy",
			rootSessionId: "ps_legacy",
			parentId: undefined,
			originId: "origin_legacy",
			title: "Legacy session",
			profile: "base",
			status: "idle",
			archivedAt: undefined,
			lastActivityAt: fixtureTime,
			lastMessagePreview: "last message",
			childCount: 2,
			sortKey: fixtureTime,
			updatedAt: fixtureTime,
		});
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM legacy_session_links WHERE session_id = 'ps_legacy'").get().count, 1);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM legacy_room_links WHERE room_id = 'room_legacy'").get().count, 1);
		writeCurrentRows(store, `new_v${version}`);
		store.close();

		store = new PiboDataStore(path, { payloadRootDir: join(dir, "payloads") });
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count, 2);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 2);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM session_navigation").get().count, 2);
		assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
		store.close();
	});
}

test("an already-stamped schema v6 is repaired idempotently and preserves runtime bindings", () => {
	const { dir, path } = tempDatabase("pibo-data-retired-scope-current-version-");
	seedRetiredScopeSchema(path, 6, { includeRuntimeBindings: true });

	for (const suffix of ["first", "restart"]) {
		const store = new PiboDataStore(path, { payloadRootDir: join(dir, "payloads") });
		for (const table of ["sessions", "rooms", "session_navigation"]) {
			assert.equal(columns(store.db, table).has(retiredStorageColumn), false);
		}
		assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
		writeCurrentRows(store, suffix);
		store.close();
	}

	const db = new DatabaseSync(path);
	assert.deepEqual({ ...db.prepare("SELECT runtime_instance_id, native_session_id, metadata_json, revision FROM session_runtime_bindings WHERE pibo_session_id = 'ps_legacy'").get() }, {
		runtime_instance_id: "fixture",
		native_session_id: "native_legacy",
		metadata_json: '{"fixture":"binding","nativeHistoryFallback":true,"historyMigrationSource":"schema-v5"}',
		revision: 3,
	});
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 3);
	db.close();
});

test("current physical schemas from intermediate versions and a fresh schema remain writable", () => {
	for (const version of [3, 4, 5, 6, PIBO_DATA_SCHEMA_VERSION]) {
		const db = new DatabaseSync(":memory:");
		applyPiboDataSchema(db);
		db.exec(`PRAGMA user_version = ${version}`);
		applyPiboDataSchema(db);
		for (const table of ["sessions", "rooms", "session_navigation"]) {
			assert.equal(columns(db, table).has(retiredStorageColumn), false);
		}
		assert.equal(db.prepare("PRAGMA user_version").get().user_version, PIBO_DATA_SCHEMA_VERSION);
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
		db.close();
	}

	const { dir, path } = tempDatabase("pibo-data-retired-scope-fresh-");
	let store = new PiboDataStore(path, { payloadRootDir: join(dir, "payloads") });
	writeCurrentRows(store, "fresh");
	store.close();
	store = new PiboDataStore(path, { payloadRootDir: join(dir, "payloads") });
	assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id = 'ps_fresh'").get().count, 1);
	assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
	store.close();
});

test("retired-scope rebuild rolls back without stamping a database with broken foreign keys", () => {
	const { path } = tempDatabase("pibo-data-retired-scope-rollback-");
	seedRetiredScopeSchema(path, 1, { invalidForeignKey: true });
	const db = new DatabaseSync(path);
	db.exec("PRAGMA foreign_keys = ON");

	assert.throws(() => applyPiboDataSchema(db), /foreign-key/i);
	assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
	for (const table of ["sessions", "rooms", "session_navigation"]) {
		assert.equal(columns(db, table).has(retiredStorageColumn), true);
	}
	assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
	db.close();
});
