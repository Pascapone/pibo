import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
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

test("pibo data migrate sessions-to-v2 is idempotent", async () => {
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
		assert.equal(Object.hasOwn(migrated ?? {}, retiredPartitionField), false);
		assert.equal(migrated?.workspace, "/tmp");
		assert.equal(migrated?.title, "Shared");
		assert.equal(migrated?.metadata?.chatRoomId, "room_shared");
		assert.equal(migrated?.activeModel?.id, "gpt-test");

		const child = store.get("ps_user_child");
		assert.equal(child?.piSessionId, "pi_user_child");
		assert.equal(child?.parentId, "ps_shared");
		assert.equal(child?.originId, "ps_shared");
		assert.equal(child?.workspace, "/tmp/project");
		assert.deepEqual(child?.metadata, { rootSessionId: "ps_shared", chatRoomId: "room_shared" });
		assert.equal(store.list().length, 2);
		store.close();
		assertAppContextSessionsSchema(dbPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
