import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { runDataCli } from "../dist/data/cli.js";

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pibo-data-session-store-"));
}

test("pibo data session store persists structured session fields", () => {
	const dir = tempDir();
	try {
		let store = new PiboDataSessionStore(join(dir, "pibo.sqlite"));
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

		store = new PiboDataSessionStore(join(dir, "pibo.sqlite"));
		const reopened = store.get(created.id);
		assert.equal(reopened?.piSessionId, "pi_one");
		assert.equal(Object.hasOwn(reopened ?? {}, "ownerScope"), false);
		assert.equal(reopened?.metadata?.chatRoomId, "room_one");
		assert.equal(reopened?.activeModel?.id, "gpt-test");
		const updated = store.update(created.id, { title: "Renamed", activeModel: null });
		assert.equal(updated?.title, "Renamed");
		assert.equal(updated?.activeModel, undefined);
		assert.equal(store.find({}).length, 1);
		assert.equal(store.delete(created.id), true);
		assert.equal(store.get(created.id), undefined);
		store.close();
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
				owner_scope TEXT,
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
			.run("ps_legacy", "pi_legacy", "pibo.chat-web", "chat", "default", "user:test", null, null, "/tmp", "Legacy", '{"chatRoomId":"room_legacy"}', '{"provider":"openai","id":"gpt-test"}', "2026-05-09T00:00:00.000Z", "2026-05-09T00:01:00.000Z");
		source.close();

		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--root", dir, "--json"]);
		await runDataCli(["node", "pibo", "migrate", "sessions-to-v2", "--root", dir, "--json"]);

		const store = new PiboDataSessionStore(join(dir, "pibo.sqlite"));
		const migrated = store.get("ps_legacy");
		assert.equal(migrated?.piSessionId, "pi_legacy");
		assert.equal(migrated?.metadata?.chatRoomId, "room_legacy");
		assert.equal(store.list().length, 1);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
