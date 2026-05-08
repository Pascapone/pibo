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
