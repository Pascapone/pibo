import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo debug help stays progressive", async () => {
	const root = await execFileAsync("node", [cliPath, "debug", "--help"]);
	assert.match(root.stdout, /pibo debug - inspect local Pibo data/);
	assert.match(root.stdout, /pibo debug db/);
	assert.match(root.stdout, /pibo debug trace/);
	assert.doesNotMatch(root.stdout, /pibo_sessions/);

	const db = await execFileAsync("node", [cliPath, "debug", "db", "--help"]);
	assert.match(db.stdout, /pibo debug db - inspect local SQLite stores/);
	assert.match(db.stdout, /query <store> <sql>/);
	assert.doesNotMatch(db.stdout, /CREATE TABLE/);
});

test("pibo debug db discovers schema and runs limited read-only SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		const schema = await execFileAsync("node", [cliPath, "debug", "db", "schema", "sessions", "--json"], { cwd });
		const parsed = JSON.parse(schema.stdout);
		assert.equal(parsed.store, "sessions");
		assert.equal(parsed.tables[0].name, "pibo_sessions");
		assert.equal(parsed.tables[0].columns[0].name, "id");

		const query = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "select id, profile from pibo_sessions order by id", "--limit", "2"],
			{ cwd },
		);
		assert.match(query.stdout, /id\tprofile/);
		assert.match(query.stdout, /ps_child\tresearcher/);
		assert.match(query.stdout, /rows: 2 \(limited\)/);

		const cte = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "with rows as (select id from pibo_sessions) select id from rows limit 1"],
			{ cwd },
		);
		assert.match(cte.stdout, /ps_/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug db rejects mutating and multi-statement SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "insert into pibo_sessions(id) values ('x')"], {
				cwd,
			}),
			(error) => {
				assert.match(error.stderr, /Mutating SQL is not allowed: insert/);
				return true;
			},
		);
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "select 1; select 2"], { cwd }),
			(error) => {
				assert.match(error.stderr, /Only one SQL statement is allowed/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session inspects a Chat URL without event payload dumps", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"session",
				"/apps/chat/rooms/room_one/sessions/ps_parent",
				"--events",
				"--json",
			],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.input.roomId, "room_one");
		assert.equal(parsed.input.piboSessionId, "ps_parent");
		assert.equal(parsed.session.profile, "pibo-minimal");
		assert.equal(parsed.room.matches, true);
		assert.equal(parsed.children[0].id, "ps_child");
		assert.equal(parsed.children[0].subagentName, "researcher");
		assert.equal(parsed.chat.status, "idle");
		assert.deepEqual(Object.keys(parsed.events[0]).sort(), ["created_at", "event_id", "type"]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session warns when a Chat URL room does not match session metadata", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[cliPath, "debug", "session", "/apps/chat/rooms/room_wrong/sessions/ps_parent", "--json"],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.room.matches, false);
		assert.match(parsed.warnings[0], /does not match session metadata chatRoomId/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug trace prints rebuilt Chat Web trace nodes", async () => {
	const cwd = await makeDebugFixture();
	try {
		const trace = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--running-only"], { cwd });
		assert.match(trace.stdout, /status\ttype\ttitle\tid\trunId\tlinkedPiboSessionId/);
		assert.match(trace.stdout, /running\ttool.call\t\s+pibo_exec\ttool:tool_1/);
		assert.match(trace.stdout, /nodes: 2/);

		const json = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--json"], { cwd });
		const parsed = JSON.parse(json.stdout);
		assert.equal(parsed.status, "running");
		assert.equal(parsed.nodes.some((node) => node.status === "running" && node.title === "pibo_exec"), true);

		const checked = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--check", "--json"], { cwd });
		const checkedParsed = JSON.parse(checked.stdout);
		assert.equal(typeof checkedParsed.checks.status, "string");
		assert.ok(Array.isArray(checkedParsed.checks.issues));
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events extracts selected payload fields", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"events",
				"ps_parent",
				"--type",
				"tool_execution_finished",
				"--fields",
				"toolName,toolCallId,result.details.status",
			],
			{ cwd },
		);
		assert.match(result.stdout, /toolName\ttoolCallId\tresult.details.status/);
		assert.match(result.stdout, /pibo_run_wait\ttool_wait\tcompleted/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug reports missing stores with the expected path", async () => {
	const cwd = await makeEmptyCwd();
	try {
		await assert.rejects(execFileAsync("node", [cliPath, "debug", "db", "tables", "sessions"], { cwd }), (error) => {
			assert.match(error.stderr, /Debug store "sessions" not found at \.pibo\/pibo-sessions\.sqlite/);
			return true;
		});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

async function makeEmptyCwd() {
	const cwd = join(tmpdir(), `pibo-debug-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(cwd, { recursive: true });
	return cwd;
}

async function makeDebugFixture() {
	const cwd = await makeEmptyCwd();
	const piboDir = join(cwd, ".pibo");
	await mkdir(piboDir, { recursive: true });
	const sessions = new DatabaseSync(join(piboDir, "pibo-sessions.sqlite"));
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
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
	sessions
		.prepare(
			`INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, owner_scope, parent_id, origin_id,
				workspace, title, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_parent",
			"11111111-1111-4111-8111-111111111111",
			"pibo.chat-web",
			"chat",
			"pibo-minimal",
			"user:one",
			null,
			null,
			"/workspace",
			"Parent",
			JSON.stringify({ chatRoomId: "room_one" }),
			"2026-05-01T10:00:00.000Z",
			"2026-05-01T10:00:00.000Z",
		);
	sessions
		.prepare(
			`INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, owner_scope, parent_id, origin_id,
				workspace, title, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_child",
			"22222222-2222-4222-8222-222222222222",
			"pibo.subagents",
			"subagent",
			"researcher",
			"user:one",
			"ps_parent",
			null,
			"/workspace",
			"Child",
			JSON.stringify({
				chatRoomId: "room_one",
				subagentName: "researcher",
				subagentToolName: "pibo_subagent_researcher",
				threadKey: "qa",
			}),
			"2026-05-01T10:01:00.000Z",
			"2026-05-01T10:01:00.000Z",
		);
	sessions
		.prepare(
			`INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, owner_scope, parent_id, origin_id,
				workspace, title, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_other",
			"33333333-3333-4333-8333-333333333333",
			"pibo.chat-web",
			"chat",
			"pibo-minimal",
			"user:one",
			null,
			null,
			"/workspace",
			"Other",
			"{}",
			"2026-05-01T10:02:00.000Z",
			"2026-05-01T10:02:00.000Z",
		);
	sessions
		.prepare(
			`INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, owner_scope, parent_id, origin_id,
				workspace, title, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_running",
			"44444444-4444-4444-8444-444444444444",
			"pibo.chat-web",
			"chat",
			"pibo-minimal",
			"user:one",
			null,
			null,
			"/workspace",
			"Running",
			"{}",
			"2026-05-01T10:04:00.000Z",
			"2026-05-01T10:04:00.000Z",
		);
	sessions.close();

	const chat = new DatabaseSync(join(piboDir, "web-chat.sqlite"));
	chat.exec(`
		CREATE TABLE web_chat_sessions (
			pibo_session_id TEXT PRIMARY KEY,
			pi_session_id TEXT NOT NULL,
			parent_id TEXT,
			profile TEXT NOT NULL,
			channel TEXT NOT NULL,
			kind TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_activity_at TEXT,
			status TEXT NOT NULL DEFAULT 'idle'
		);
		CREATE TABLE web_chat_events (
			id TEXT PRIMARY KEY,
			pibo_session_id TEXT NOT NULL,
			event_id TEXT,
			type TEXT NOT NULL,
			created_at TEXT NOT NULL,
			payload_json TEXT NOT NULL
		);
	`);
	chat
		.prepare(
			`INSERT INTO web_chat_sessions (
				pibo_session_id, pi_session_id, parent_id, profile, channel, kind,
				created_at, updated_at, last_activity_at, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_parent",
			"11111111-1111-4111-8111-111111111111",
			null,
			"pibo-minimal",
			"pibo.chat-web",
			"chat",
			"2026-05-01T10:00:00.000Z",
			"2026-05-01T10:03:00.000Z",
			"2026-05-01T10:03:00.000Z",
			"idle",
		);
	chat
		.prepare(
			`INSERT INTO web_chat_sessions (
				pibo_session_id, pi_session_id, parent_id, profile, channel, kind,
				created_at, updated_at, last_activity_at, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"ps_running",
			"44444444-4444-4444-8444-444444444444",
			null,
			"pibo-minimal",
			"pibo.chat-web",
			"chat",
			"2026-05-01T10:04:00.000Z",
			"2026-05-01T10:04:03.000Z",
			"2026-05-01T10:04:03.000Z",
			"running",
		);
	chat
		.prepare("INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
		.run(
			"evt_row_1",
			"ps_parent",
			"evt_1",
			"message_finished",
			"2026-05-01T10:03:00.000Z",
			JSON.stringify({ large: "payload should not be shown" }),
		);
	chat
		.prepare("INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
		.run(
			"evt_tool_wait",
			"ps_parent",
			"evt_2",
			"tool_execution_finished",
			"2026-05-01T10:03:01.000Z",
			JSON.stringify({
				type: "tool_execution_finished",
				piboSessionId: "ps_parent",
				eventId: "evt_2",
				toolCallId: "tool_wait",
				toolName: "pibo_run_wait",
				result: { details: { status: "completed" } },
				isError: false,
			}),
		);
	chat
		.prepare("INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
		.run(
			"evt_running_start",
			"ps_running",
			"evt_running",
			"message_started",
			"2026-05-01T10:04:01.000Z",
			JSON.stringify({
				type: "message_started",
				piboSessionId: "ps_running",
				eventId: "evt_running",
				source: "user",
				text: "run command",
			}),
		);
	chat
		.prepare("INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
		.run(
			"evt_running_tool",
			"ps_running",
			"evt_running",
			"tool_execution_started",
			"2026-05-01T10:04:02.000Z",
			JSON.stringify({
				type: "tool_execution_started",
				piboSessionId: "ps_running",
				eventId: "evt_running",
				toolCallId: "tool_1",
				toolName: "pibo_exec",
				args: { cmd: "sleep 10" },
			}),
		);
	chat.close();
	return cwd;
}
