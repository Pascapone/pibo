import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

test("pibo data inventory is read-only and reports missing stores", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-inventory-"));
	try {
		const result = await execFileAsync("node", [cliPath, "data", "inventory", "--root", root, "--json"]);
		const parsed = JSON.parse(result.stdout);
		assert.ok(Array.isArray(parsed.stores));
		assert.ok(parsed.stores.some((store) => store.name === "v2" && store.exists === false));
		assert.ok(parsed.stores.some((store) => store.name === "chat" && store.exists === false));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data import legacy-chat is idempotent", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-import-"));
	try {
		const sessions = new DatabaseSync(join(root, "pibo-sessions.sqlite"));
		try {
			sessions.exec(`
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
				)
			`);
			sessions.prepare(`INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, owner_scope, parent_id, origin_id, workspace, title,
				metadata_json, active_model_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
				"ps_import", "pi_import", "pibo.chat-web", "chat", "default", "user:test", null, null, "/tmp", "Imported",
				JSON.stringify({ chatRoomId: "room_import" }), null, "2026-05-09T00:00:00.000Z", "2026-05-09T00:01:00.000Z",
			);
		} finally {
			sessions.close();
		}

		const legacy = new DatabaseSync(join(root, "web-chat.sqlite"));
		try {
			legacy.exec(`
				CREATE TABLE pibo_rooms (
					id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, topic TEXT, type TEXT NOT NULL,
					parent_room_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retention_policy_id TEXT, metadata_json TEXT
				);
				CREATE TABLE pibo_room_members (room_id TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL);
				CREATE TABLE web_chat_sessions (
					pibo_session_id TEXT PRIMARY KEY, pi_session_id TEXT NOT NULL, parent_id TEXT, profile TEXT NOT NULL,
					channel TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
					last_activity_at TEXT, status TEXT NOT NULL
				);
				CREATE TABLE chat_events (
					stream_id INTEGER PRIMARY KEY, room_id TEXT, pibo_session_id TEXT, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
					actor_type TEXT, actor_id TEXT, client_txn_id TEXT, created_at TEXT NOT NULL, retention_class TEXT NOT NULL, payload_json TEXT NOT NULL
				);
				CREATE TABLE web_chat_events (
					id TEXT PRIMARY KEY, pibo_session_id TEXT NOT NULL, event_sequence INTEGER, event_id TEXT, stream_id INTEGER,
					type TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL
				);
			`);
			legacy.prepare("INSERT INTO pibo_rooms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("room_import", "user:test", "Personal", null, "chat", null, "2026-05-09T00:00:00.000Z", "2026-05-09T00:00:00.000Z", null, JSON.stringify({ default: true }));
			legacy.prepare("INSERT INTO pibo_room_members VALUES (?, ?, ?, ?)").run("room_import", "user:test", "owner", "2026-05-09T00:00:00.000Z");
			legacy.prepare("INSERT INTO web_chat_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("ps_import", "pi_import", null, "default", "pibo.chat-web", "chat", "2026-05-09T00:00:00.000Z", "2026-05-09T00:01:00.000Z", "2026-05-09T00:02:00.000Z", "idle");
			legacy.prepare("INSERT INTO chat_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "room_import", "ps_import", "ce_user", "user.message.accepted", "user", "user:test", "txn_1", "2026-05-09T00:02:00.000Z", "chat_message", JSON.stringify({ type: "user.message.accepted", text: "hello" }));
			legacy.prepare("INSERT INTO web_chat_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wce_assistant", "ps_import", 1, "assistant_1", 1, "assistant_message", "2026-05-09T00:03:00.000Z", JSON.stringify({ type: "assistant_message", piboSessionId: "ps_import", eventId: "assistant_1", text: "hi" }));
		} finally {
			legacy.close();
		}

		const first = await execFileAsync("node", [cliPath, "data", "import", "legacy-chat", "--root", root, "--json"]);
		const firstReport = JSON.parse(first.stdout);
		assert.equal(firstReport.imported.sessions, 1);
		assert.equal(firstReport.imported.rooms, 1);
		assert.equal(firstReport.imported.messages, 2);
		assert.equal(firstReport.imported.observations, 1);

		const second = await execFileAsync("node", [cliPath, "data", "import", "legacy-chat", "--root", root, "--json"]);
		const secondReport = JSON.parse(second.stdout);
		assert.equal(secondReport.imported.sessions, 0);
		assert.equal(secondReport.imported.rooms, 0);
		assert.equal(secondReport.imported.messages, 0);
		assert.equal(secondReport.imported.observations, 0);

		const v2 = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
		try {
			assert.equal(v2.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 1);
			assert.equal(v2.prepare("SELECT COUNT(*) AS count FROM rooms").get().count, 1);
			assert.equal(v2.prepare("SELECT COUNT(*) AS count FROM chat_messages").get().count, 2);
			assert.equal(v2.prepare("SELECT COUNT(*) AS count FROM observations").get().count, 1);
			assert.equal(v2.prepare("SELECT COUNT(*) AS count FROM session_navigation").get().count, 1);
		} finally {
			v2.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data compare reports legacy and V2 counts for one session", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-compare-"));
	try {
		const legacy = new DatabaseSync(join(root, "web-chat.sqlite"));
		try {
			legacy.exec("CREATE TABLE chat_events (pibo_session_id TEXT NOT NULL, event_type TEXT NOT NULL)");
			legacy.prepare("INSERT INTO chat_events (pibo_session_id, event_type) VALUES (?, ?)").run("ps_compare", "message_queued");
			legacy.prepare("INSERT INTO chat_events (pibo_session_id, event_type) VALUES (?, ?)").run("ps_compare", "assistant_message");
		} finally {
			legacy.close();
		}

		const v2 = new DatabaseSync(join(root, "pibo.sqlite"));
		try {
			v2.exec(`
				CREATE TABLE event_log (session_id TEXT NOT NULL, type TEXT NOT NULL);
				CREATE TABLE chat_messages (session_id TEXT NOT NULL, role TEXT NOT NULL);
				CREATE TABLE observations (session_id TEXT NOT NULL, kind TEXT NOT NULL);
			`);
			v2.prepare("INSERT INTO event_log (session_id, type) VALUES (?, ?)").run("ps_compare", "user.message.accepted");
			v2.prepare("INSERT INTO event_log (session_id, type) VALUES (?, ?)").run("ps_compare", "assistant_message");
			v2.prepare("INSERT INTO chat_messages (session_id, role) VALUES (?, ?)").run("ps_compare", "user");
			v2.prepare("INSERT INTO chat_messages (session_id, role) VALUES (?, ?)").run("ps_compare", "assistant");
			v2.prepare("INSERT INTO observations (session_id, kind) VALUES (?, ?)").run("ps_compare", "message");
		} finally {
			v2.close();
		}

		const result = await execFileAsync("node", [cliPath, "data", "compare", "--root", root, "--session", "ps_compare", "--json"]);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.sessionId, "ps_compare");
		assert.equal(parsed.stores.legacy.events, 2);
		assert.deepEqual(parsed.stores.legacy.byType, { assistant_message: 1, message_queued: 1 });
		assert.equal(parsed.stores.v2.events, 2);
		assert.equal(parsed.stores.v2.messages, 2);
		assert.deepEqual(parsed.stores.v2.byRole, { assistant: 1, user: 1 });
		assert.equal(parsed.deltas.events, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
