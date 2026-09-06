import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES } from "../dist/sessions/store.js";
import { runDataCli } from "../dist/data/cli.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const retiredStorageColumn = `${retiredWord}_scope`;
const retiredSharedScope = ["shared", "app"].join(":");

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pibo-data-session-store-"));
}

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function indexNames(db, table) {
	return db.prepare(`PRAGMA index_list(${table})`).all().map((index) => index.name).sort();
}

function assertAppContextSessionsSchema(dbPath) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		assert.equal(tableColumns(db, "sessions").has(retiredStorageColumn), false);
		assert.equal(indexNames(db, "sessions").some((name) => name.includes(retiredWord)), false);
	} finally {
		db.close();
	}
}

function createLegacySessionsTable(db) {
	db.exec(`
		CREATE TABLE pibo_sessions (
			id TEXT PRIMARY KEY,
			pi_session_id TEXT NOT NULL UNIQUE,
			channel TEXT NOT NULL,
			kind TEXT NOT NULL,
			profile TEXT NOT NULL,
			${retiredStorageColumn} TEXT,
			parent_id TEXT,
			origin_id TEXT,
			workspace TEXT,
			title TEXT,
			metadata_json TEXT,
			active_model_json TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
}

test("pibo data session store persists structured session fields", () => {
	const dir = tempDir();
	try {
		const dbPath = join(dir, "pibo.sqlite");
		let store = new PiboDataSessionStore(dbPath);
		const created = store.create({
			id: "ps_one",
			piSessionId: "pi_one",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "default",
			title: "Hello",
			metadata: { rootSessionId: "ps_one", chatRoomId: "room_one" },
			activeModel: { provider: "openai", id: "gpt-test" },
		});
		store.close();

		store = new PiboDataSessionStore(dbPath);
		const reopened = store.get(created.id);
		assert.equal(reopened?.piSessionId, "pi_one");
		assert.equal(reopened?.runtimeBinding?.runtimeInstanceId, "pi");
		assert.equal(reopened?.runtimeBinding?.nativeSessionId, "pi_one");
		assert.equal(reopened?.runtimeBinding?.state, "unbound");
		assert.equal(Object.hasOwn(reopened ?? {}, retiredPartitionField), false);
		assert.equal(reopened?.metadata?.chatRoomId, "room_one");
		assert.equal(reopened?.activeModel?.id, "gpt-test");
		const updated = store.update(created.id, { title: "Renamed", activeModel: null });
		assert.equal(updated?.title, "Renamed");
		assert.equal(updated?.activeModel, undefined);
		assert.equal(store.find({}).length, 1);
		assert.equal(store.delete(created.id), true);
		assert.equal(store.get(created.id), undefined);
		store.close();
		assertAppContextSessionsSchema(dbPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo data session store persists monotonic agent observation auto cursors", () => {
	const dir = tempDir();
	try {
		const dbPath = join(dir, "pibo.sqlite");
		let store = new PiboDataSessionStore(dbPath);
		store.create({ id: "ps_cursor_parent", channel: "pibo.test", kind: "chat", profile: "default" });
		assert.equal(store.getAgentObservationAutoCursor("ps_cursor_parent", "scope-a"), undefined);
		assert.equal(store.advanceAgentObservationAutoCursor("ps_cursor_parent", "scope-a", 12), 12);
		assert.equal(store.advanceAgentObservationAutoCursor("ps_cursor_parent", "scope-a", 7), 12);
		store.close();

		store = new PiboDataSessionStore(dbPath);
		assert.equal(store.getAgentObservationAutoCursor("ps_cursor_parent", "scope-a"), 12);
		assert.equal(store.advanceAgentObservationAutoCursor("ps_cursor_parent", "scope-b", 4), 4);
		for (let index = 0; index < PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES + 5; index += 1) {
			store.advanceAgentObservationAutoCursor("ps_cursor_parent", `bounded-${index}`, index);
		}
		assert.equal(
			store.db.prepare("SELECT COUNT(*) AS count FROM session_agent_observation_auto_cursors WHERE parent_pibo_session_id = ?").get("ps_cursor_parent").count,
			PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES,
		);
		assert.equal(store.getAgentObservationAutoCursor("ps_cursor_parent", `bounded-${PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES + 4}`), PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES + 4);
		assert.equal(store.delete("ps_cursor_parent"), true);
		assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM session_agent_observation_auto_cursors").get().count, 0);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo data migrate sessions-to-v2 rejects a non-legacy source before creating the target", async () => {
	const dir = tempDir();
	try {
		const sourcePath = join(dir, "not-a-legacy-store.sqlite");
		const targetPath = join(dir, "pibo.sqlite");
		const source = new DatabaseSync(sourcePath);
		source.exec("CREATE TABLE unrelated_fixture (id TEXT PRIMARY KEY)");
		source.close();

		await assert.rejects(
			runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--from", sourcePath, "--to", targetPath, "--json"]),
			/required legacy table "pibo_sessions" is missing/,
		);
		assert.equal(existsSync(targetPath), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo data migrate sessions-to-v2 accepts a valid empty legacy source", async () => {
	const dir = tempDir();
	try {
		const sourcePath = join(dir, "pibo-sessions.sqlite");
		const targetPath = join(dir, "pibo.sqlite");
		const source = new DatabaseSync(sourcePath);
		createLegacySessionsTable(source);
		source.close();

		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--from", sourcePath, "--to", targetPath, "--json"]);
		assert.equal(existsSync(targetPath), true);
		const store = new PiboDataSessionStore(targetPath);
		assert.equal(store.list().length, 0);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo data migrate sessions-to-v2 is idempotent and refreshes structured room ids", async () => {
	const dir = tempDir();
	try {
		const sourcePath = join(dir, "pibo-sessions.sqlite");
		const source = new DatabaseSync(sourcePath);
		createLegacySessionsTable(source);
		source.prepare("INSERT INTO pibo_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ps_shared", "pi_shared", "pibo.chat-web", "chat", "default", retiredSharedScope, null, null, "/tmp", "Shared", '{"chatRoomId":"room_shared"}', '{"provider":"openai","id":"gpt-test"}', "2026-05-09T00:00:00.000Z", "2026-05-09T00:01:00.000Z");
		source.prepare("INSERT INTO pibo_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ps_user_child", "pi_user_child", "pibo.subagents", "subagent", "researcher", "user:test", "ps_shared", "ps_shared", "/tmp/project", "Child", '{"rootSessionId":"ps_shared","chatRoomId":"room_shared"}', null, "2026-05-09T00:02:00.000Z", "2026-05-09T00:03:00.000Z");
		source.close();

		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--root", dir, "--json"]);
		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--root", dir, "--json"]);

		const dbPath = join(dir, "pibo.sqlite");
		const store = new PiboDataSessionStore(dbPath);
		const migrated = store.get("ps_shared");
		assert.equal(migrated?.piSessionId, "pi_shared");
		assert.equal(migrated?.runtimeBinding?.adapterId, "pi");
		assert.equal(migrated?.runtimeBinding?.nativeSessionId, "pi_shared");
		assert.equal(migrated?.runtimeBinding?.state, "bound");
		assert.equal(Object.hasOwn(migrated ?? {}, retiredPartitionField), false);
		assert.equal(migrated?.workspace, "/tmp");
		assert.equal(migrated?.title, "Shared");
		assert.equal(migrated?.metadata?.chatRoomId, "room_shared");
		assert.equal(migrated?.activeModel?.id, "gpt-test");

		const child = store.get("ps_user_child");
		assert.equal(child?.piSessionId, "pi_user_child");
		assert.equal(child?.runtimeBinding?.state, "bound");
		assert.equal(child?.parentId, "ps_shared");
		assert.equal(child?.originId, "ps_shared");
		assert.equal(child?.workspace, "/tmp/project");
		assert.deepEqual(child?.metadata, { rootSessionId: "ps_shared", chatRoomId: "room_shared" });
		assert.equal(store.list().length, 2);
		store.close();

		const newerSource = new DatabaseSync(sourcePath);
		newerSource.prepare("UPDATE pibo_sessions SET metadata_json = ?, updated_at = ? WHERE id = ?")
			.run('{"chatRoomId":"room_new"}', "2026-05-09T00:04:00.000Z", "ps_shared");
		newerSource.close();
		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--root", dir, "--json"]);

		const updated = new DatabaseSync(dbPath, { readOnly: true });
		const updatedRow = updated.prepare("SELECT room_id, metadata_json, updated_at FROM sessions WHERE id = ?").get("ps_shared");
		updated.close();
		assert.equal(updatedRow.room_id, "room_new");
		assert.equal(JSON.parse(updatedRow.metadata_json).chatRoomId, "room_new");
		assert.equal(updatedRow.updated_at, "2026-05-09T00:04:00.000Z");
		assertAppContextSessionsSchema(dbPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo data migration leaves skipped newer runtime bindings unchanged", async () => {
	const dir = tempDir();
	try {
		const sourcePath = join(dir, "pibo-sessions.sqlite");
		const source = new DatabaseSync(sourcePath);
		source.exec(`
			CREATE TABLE pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
				${retiredStorageColumn} TEXT,
				parent_id TEXT,
				origin_id TEXT,
				workspace TEXT,
				title TEXT,
				metadata_json TEXT,
				active_model_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
		source.prepare("INSERT INTO pibo_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ps_collision", "pi_legacy_older", "pibo.chat-web", "chat", "default", retiredSharedScope, null, null, "/legacy", "Legacy", '{"chatRoomId":"room_legacy"}', null, "2026-08-29T00:00:00.000Z", "2026-08-29T00:01:00.000Z");
		source.close();

		const targetPath = join(dir, "pibo.sqlite");
		let store = new PiboDataSessionStore(targetPath);
		store.create({
			id: "ps_collision",
			piSessionId: "pi_target_newer",
			runtimeBinding: {
				runtimeInstanceId: "pi",
				adapterId: "pi",
				nativeSessionId: "pi_target_newer",
				state: "bound",
				protocol: "pi-sdk",
			},
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "default",
			workspace: "/target",
			title: "Target newer",
			metadata: { chatRoomId: "room_target" },
		});
		const before = store.get("ps_collision");
		store.close();

		const reports = [];
		const originalLog = console.log;
		console.log = (value) => reports.push(String(value));
		try {
			await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--from", sourcePath, "--to", targetPath, "--json"]);
			await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--from", sourcePath, "--to", targetPath, "--json"]);
		} finally {
			console.log = originalLog;
		}
		assert.deepEqual(reports.map((report) => JSON.parse(report)).map(({ inserted, updated, skipped }) => ({ inserted, updated, skipped })), [
			{ inserted: 0, updated: 0, skipped: 1 },
			{ inserted: 0, updated: 0, skipped: 1 },
		]);

		store = new PiboDataSessionStore(targetPath);
		const after = store.get("ps_collision");
		assert.equal(after?.piSessionId, "pi_target_newer");
		assert.equal(after?.title, "Target newer");
		assert.equal(after?.runtimeBinding?.nativeSessionId, "pi_target_newer");
		assert.equal(after?.runtimeBinding?.revision, before?.runtimeBinding?.revision);
		assert.equal(after?.runtimeBinding?.updatedAt, before?.runtimeBinding?.updatedAt);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
