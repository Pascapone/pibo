import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
	const cron = new DatabaseSync(join(root, "pibo-cron.sqlite"));
	try {
		cron.exec(`
			CREATE TABLE pibo_cron_jobs (id TEXT PRIMARY KEY, owner_scope TEXT, target_json TEXT);
			CREATE INDEX idx_pibo_cron_jobs_owner ON pibo_cron_jobs(owner_scope);
			INSERT INTO pibo_cron_jobs VALUES ('cron_1', 'user:secret-alpha', '{"kind":"personal","principalId":"user:secret-alpha"}');
		`);
	} finally {
		cron.close();
	}
	const sessions = new DatabaseSync(join(root, "pibo-sessions.sqlite"));
	try {
		sessions.exec(`
			CREATE TABLE pibo_sessions (id TEXT PRIMARY KEY, pi_session_id TEXT, owner_scope TEXT, title TEXT);
			CREATE INDEX idx_pibo_sessions_owner ON pibo_sessions(owner_scope);
			INSERT INTO pibo_sessions VALUES ('ps_1', 'pi_1', 'user:secret-alpha', 'Session One');
		`);
	} finally {
		sessions.close();
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

async function createBackupForFixture(root) {
	const backup = await mkdtemp(join(tmpdir(), "pibo-final-cutover-backup-"));
	for (const name of ["pibo.sqlite", "pibo-sessions.sqlite", "chat-agents.sqlite", "pibo-ralph.sqlite", "pibo-cron.sqlite"]) {
		await copyFile(join(root, name), join(backup, name));
	}
	return backup;
}

function tableColumns(db, tableName) {
	return db.prepare(`PRAGMA table_info("${tableName}")`).all().map((column) => column.name);
}

function schemaNames(db, type) {
	return db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type).map((row) => row.name);
}

function assertNoLegacySchema(root, databaseName) {
	const db = new DatabaseSync(join(root, databaseName), { readOnly: true });
	try {
		for (const tableName of schemaNames(db, "table")) {
			assert.ok(!tableColumns(db, tableName).includes("owner_scope"), `${databaseName}.${tableName} has owner_scope`);
			assert.ok(!tableColumns(db, tableName).includes("principal_id"), `${databaseName}.${tableName} has principal_id`);
		}
		for (const tableName of ["room_members", "principal_session_stats", "principal_room_stats"]) {
			assert.equal(schemaNames(db, "table").includes(tableName), false, `${databaseName} still has ${tableName}`);
		}
		assert.equal(schemaNames(db, "index").some((name) => /owner|principal/i.test(name)), false, `${databaseName} still has owner/principal index`);
		assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
	} finally {
		db.close();
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

test("final cutover apply requires a verified external backup and refuses host production home", async () => {
	assert.throws(() => inspectFinalAppSpaceCutoverMigration({ root: "/root/.pibo" }), /refuses to target \/root\/\.pibo/);
	assert.throws(() => inspectFinalAppSpaceCutoverMigration({ env: {} }), /requires --root/);
	await withFixtureHome(async (root) => {
		assert.throws(() => inspectFinalAppSpaceCutoverMigration({ mode: "apply", root }), /requires --backup/);
		const emptyBackup = await mkdtemp(join(tmpdir(), "pibo-final-cutover-empty-backup-"));
		try {
			assert.throws(() => inspectFinalAppSpaceCutoverMigration({ mode: "apply", root, backupPath: emptyBackup }), /backup is missing pibo\.sqlite/);
		} finally {
			await rm(emptyBackup, { recursive: true, force: true });
		}
	});
});

test("final cutover apply rebuilds fixture schemas, normalizes targets, writes report, and is idempotent", async () => {
	await withFixtureHome(async (root) => {
		const backup = await createBackupForFixture(root);
		try {
			const report = inspectFinalAppSpaceCutoverMigration({ mode: "apply", root, backupPath: backup });
			assert.equal(report.mode, "apply");
			assert.equal(report.backupPath, backup);
			assert.ok(report.apply.appliedDatabases >= 4);
			assert.ok(report.apply.appliedActions.some((action) => action.action === "rebuild-table"));
			assert.ok(report.apply.rowCountChecks.some((check) => check.table === "room_members" && check.status === "dropped"));
			assert.ok(report.apply.quickChecks.every((check) => check.result === "ok"));
			assert.equal(report.totals.legacyColumns, 0);
			assert.equal(report.totals.legacyIndexes, 0);
			assert.equal(report.totals.legacyRows, 0);
			assert.equal(report.totals.unresolvedBlockers, 0);
			assert.ok(report.apply.rollbackInstructions.some((line) => line.includes(backup)));
			assert.ok(JSON.parse(await readFile(report.apply.reportPath, "utf8")).apply.rollbackInstructions.length > 0);

			for (const databaseName of ["pibo.sqlite", "pibo-sessions.sqlite", "chat-agents.sqlite", "pibo-ralph.sqlite", "pibo-cron.sqlite"]) assertNoLegacySchema(root, databaseName);

			const pibo = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
			try {
				assert.equal(JSON.parse(pibo.prepare("SELECT metadata_json FROM rooms WHERE id = 'room-new'").get().metadata_json).default, true);
				assert.equal(JSON.parse(pibo.prepare("SELECT metadata_json FROM rooms WHERE id = 'room-old'").get().metadata_json).default, undefined);
				assert.equal(pibo.prepare("SELECT room_id FROM session_navigation WHERE session_id = 'ps_1'").get().room_id, "room-new");
				assert.equal(pibo.prepare("SELECT last_read_stream_id FROM app_session_read_state WHERE session_id = 'ps_1'").get().last_read_stream_id, 7);
			} finally {
				pibo.close();
			}

			const agents = new DatabaseSync(join(root, "chat-agents.sqlite"), { readOnly: true });
			try {
				const names = agents.prepare("SELECT profile_name FROM chat_agents ORDER BY profile_name").all().map((row) => row.profile_name);
				assert.equal(new Set(names).size, 2);
				assert.ok(names.some((name) => /^helper-legacy-[a-f0-9]{8}$/.test(name)));
			} finally {
				agents.close();
			}

			for (const [databaseName, tableName] of [["pibo-ralph.sqlite", "pibo_ralph_jobs"], ["pibo-cron.sqlite", "pibo_cron_jobs"]]) {
				const db = new DatabaseSync(join(root, databaseName), { readOnly: true });
				try {
					assert.deepEqual(JSON.parse(db.prepare(`SELECT target_json FROM ${tableName}`).get().target_json), { kind: "default-chat" });
				} finally {
					db.close();
				}
			}

			const second = inspectFinalAppSpaceCutoverMigration({ mode: "apply", root, backupPath: backup });
			assert.equal(second.totals.legacyColumns, 0);
			assert.equal(second.apply.appliedDatabases, 0);
		} finally {
			await rm(backup, { recursive: true, force: true });
		}
	});
});

test("pibo data final-cutover CLI supports inspect, dry-run, and apply JSON against fixture roots", async () => {
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

		const backup = await createBackupForFixture(root);
		try {
			const apply = await execFileAsync(process.execPath, ["dist/bin/pibo.js", "data", "final-cutover", "apply", "--root", root, "--backup", backup, "--json"], { cwd: process.cwd(), env: { ...process.env, PIBO_HOME: join(root, "fresh-home") } });
			const applyReport = JSON.parse(apply.stdout);
			assert.equal(applyReport.mode, "apply");
			assert.equal(applyReport.backupPath, backup);
			assert.equal(applyReport.totals.legacyColumns, 0);
		} finally {
			await rm(backup, { recursive: true, force: true });
		}
	});
});
