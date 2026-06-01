import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { inspectFinalAppSpaceCutoverMigration } from "../dist/data/final-app-space-cutover-migration.js";

const execFileAsync = promisify(execFile);

async function createFixtureHome() {
	const root = await mkdtemp(join(tmpdir(), "pibo-final-cutover-"));
	await mkdir(root, { recursive: true });
	const pibo = new DatabaseSync(join(root, "pibo.sqlite"));
	try {
		pibo.exec(`
			CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_scope TEXT, name TEXT, metadata_json TEXT, archived_at TEXT, updated_at TEXT);
			CREATE INDEX idx_rooms_owner ON rooms(owner_scope);
			INSERT INTO rooms VALUES ('room-old', 'user:secret-alpha', 'Old Default', '{"default":true}', NULL, '2026-01-01T00:00:00.000Z');
			INSERT INTO rooms VALUES ('room-new', 'shared:app', 'New Default', '{"default":true}', NULL, '2026-01-02T00:00:00.000Z');
			CREATE TABLE session_navigation (room_id TEXT, session_id TEXT, owner_scope TEXT, title TEXT, updated_at TEXT);
			CREATE INDEX idx_session_navigation_owner ON session_navigation(owner_scope);
			INSERT INTO session_navigation VALUES ('room-old', 'ps_1', 'user:secret-alpha', 'Older', '2026-01-01T00:00:00.000Z');
			INSERT INTO session_navigation VALUES ('room-new', 'ps_1', 'shared:app', 'Newer', '2026-01-02T00:00:00.000Z');
			CREATE TABLE room_members (room_id TEXT, principal_id TEXT);
			INSERT INTO room_members VALUES ('room-old', 'user:secret-alpha');
			CREATE TABLE principal_session_stats (session_id TEXT, principal_id TEXT, last_read_stream_id INTEGER);
			INSERT INTO principal_session_stats VALUES ('ps_1', 'user:secret-alpha', 7);
		`);
	} finally {
		pibo.close();
	}
	const agents = new DatabaseSync(join(root, "chat-agents.sqlite"));
	try {
		agents.exec(`
			CREATE TABLE chat_agents (id TEXT PRIMARY KEY, profile_name TEXT, owner_scope TEXT, updated_at TEXT);
			CREATE INDEX idx_chat_agents_owner ON chat_agents(owner_scope);
			INSERT INTO chat_agents VALUES ('agent_a', 'helper', 'user:secret-alpha', '2026-01-01T00:00:00.000Z');
			INSERT INTO chat_agents VALUES ('agent_b', 'helper', 'shared:app', '2026-01-02T00:00:00.000Z');
		`);
	} finally {
		agents.close();
	}
	const ralph = new DatabaseSync(join(root, "pibo-ralph.sqlite"));
	try {
		ralph.exec(`
			CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT, target_json TEXT);
			CREATE INDEX idx_pibo_ralph_jobs_owner ON pibo_ralph_jobs(owner_scope);
			INSERT INTO pibo_ralph_jobs VALUES ('job_1', 'user:secret-alpha', '{"kind":"personal","principalId":"user:secret-alpha"}');
		`);
	} finally {
		ralph.close();
	}
	return root;
}

async function withFixtureHome(fn) {
	const root = await createFixtureHome();
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function findDatabase(report, name) {
	const database = report.databases.find((entry) => entry.name === name);
	assert.ok(database, `expected ${name}`);
	return database;
}

test("final cutover inspect reports affected schema, redacted legacy values, and conflicts without writes", async () => {
	await withFixtureHome(async (root) => {
		const before = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
		const beforeRows = Number(before.prepare("SELECT COUNT(*) AS count FROM rooms").get().count);
		before.close();

		const report = inspectFinalAppSpaceCutoverMigration({ mode: "inspect", root });
		assert.equal(report.kind, "final-app-space-cutover");
		assert.equal(report.mode, "inspect");
		assert.equal(report.root, root);
		assert.ok(report.totals.affectedDatabases >= 3);
		assert.ok(report.totals.legacyColumns >= 5);
		assert.equal(report.totals.plannedActions, 0);

		const pibo = findDatabase(report, "pibo.sqlite");
		assert.equal(pibo.quickCheck, "not-run-read-only-inspect");
		assert.ok(pibo.tables.some((table) => table.name === "rooms" && table.legacyColumns.includes("owner_scope") && table.legacyIndexes.includes("idx_rooms_owner")));
		assert.ok(pibo.tables.some((table) => table.name === "room_members" && table.rowCount === 1));
		assert.ok(pibo.legacyValues.some((value) => value.table === "rooms" && value.value === "shared:app" && value.count === 1));
		assert.ok(pibo.legacyValues.some((value) => value.table === "rooms" && /^user:<redacted:[a-f0-9]{12}>$/.test(value.value)));
		assert.ok(pibo.conflictGroups.some((group) => group.kind === "duplicate-default-room" && group.rowCount === 2));
		assert.ok(pibo.conflictGroups.some((group) => group.kind === "duplicate-navigation" && group.key === "ps_1"));

		const agents = findDatabase(report, "chat-agents.sqlite");
		assert.ok(agents.conflictGroups.some((group) => group.kind === "duplicate-custom-agent-profile" && group.key.startsWith("<redacted:")));

		const after = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
		assert.equal(Number(after.prepare("SELECT COUNT(*) AS count FROM rooms").get().count), beforeRows);
		after.close();
	});
});

test("final cutover dry-run reports planned rebuild, merge, rename, and target normalization actions", async () => {
	await withFixtureHome(async (root) => {
		const report = inspectFinalAppSpaceCutoverMigration({ mode: "dry-run", root });
		assert.equal(report.mode, "dry-run");
		assert.ok(report.totals.plannedActions >= 6);
		const actionNames = report.databases.flatMap((database) => database.plannedActions.map((action) => action.action));
		assert.ok(actionNames.includes("rebuild-table"));
		assert.ok(actionNames.includes("drop-table"));
		assert.ok(actionNames.includes("merge-then-drop-table"));
		assert.ok(actionNames.includes("resolve-duplicate-custom-agent-profile"));
		assert.ok(actionNames.includes("resolve-legacy-automation-target"));
		assert.equal(report.totals.unresolvedBlockers, 0);
	});
});

test("final cutover refuses the host production home and requires an explicit isolated root or sandbox env", () => {
	assert.throws(() => inspectFinalAppSpaceCutoverMigration({ root: "/root/.pibo" }), /refuses to target \/root\/\.pibo/);
	assert.throws(() => inspectFinalAppSpaceCutoverMigration({ env: {} }), /requires --root/);
});

test("pibo data final-cutover CLI supports inspect and dry-run JSON against fixture roots", async () => {
	await withFixtureHome(async (root) => {
		const inspect = await execFileAsync(process.execPath, ["dist/bin/pibo.js", "data", "final-cutover", "inspect", "--root", root, "--json"], { cwd: process.cwd(), env: { ...process.env, PIBO_HOME: join(root, "fresh-home") } });
		const inspectReport = JSON.parse(inspect.stdout);
		assert.equal(inspectReport.kind, "final-app-space-cutover");
		assert.equal(inspectReport.mode, "inspect");
		assert.equal(inspectReport.root, root);

		const dryRun = await execFileAsync(process.execPath, ["dist/bin/pibo.js", "data", "final-cutover", "dry-run", "--root", root, "--json"], { cwd: process.cwd(), env: { ...process.env, PIBO_HOME: join(root, "fresh-home") } });
		const dryRunReport = JSON.parse(dryRun.stdout);
		assert.equal(dryRunReport.mode, "dry-run");
		assert.ok(dryRunReport.totals.plannedActions > 0);
	});
});
