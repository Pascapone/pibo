import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { inspectSharedAppMigration } from "../dist/data/shared-app-migration.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

async function makePiboHome() {
	const root = await mkdtemp(join(tmpdir(), "pibo-shared-app-migration-"));
	const pibo = new DatabaseSync(join(root, "pibo.sqlite"));
	try {
		pibo.exec(`
			CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_scope TEXT, room_id TEXT);
			CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_scope TEXT, name TEXT, metadata_json TEXT, updated_at TEXT);
			CREATE TABLE session_navigation (owner_scope TEXT, room_id TEXT, session_id TEXT PRIMARY KEY, updated_at TEXT);
			CREATE TABLE room_members (room_id TEXT, principal_id TEXT, role TEXT, joined_at TEXT, PRIMARY KEY(room_id, principal_id));
			CREATE TABLE principal_session_stats (session_id TEXT, principal_id TEXT, unread_count INTEGER, last_read_stream_id INTEGER, last_read_message_sequence INTEGER, last_read_at TEXT, updated_at TEXT, PRIMARY KEY(session_id, principal_id));
			CREATE TABLE principal_room_stats (room_id TEXT, principal_id TEXT, unread_count INTEGER, last_read_stream_id INTEGER, last_read_at TEXT, updated_at TEXT, PRIMARY KEY(room_id, principal_id));
			CREATE TABLE workflow_lifecycle_events (id TEXT PRIMARY KEY, owner_scope TEXT, created_at TEXT);
			CREATE TABLE workflow_prompt_assets (asset_id TEXT PRIMARY KEY, owner_scope TEXT, display_name TEXT, created_at TEXT, updated_at TEXT);
			CREATE TABLE workflow_prompt_asset_revisions (revision_id TEXT PRIMARY KEY, asset_id TEXT, owner_scope TEXT, markdown TEXT, created_at TEXT);
			CREATE TABLE workflow_ui_drafts (draft_id TEXT PRIMARY KEY, workflow_id TEXT, owner_scope TEXT, status TEXT, updated_at TEXT);
		`);
		pibo.prepare("INSERT INTO rooms (id, owner_scope, name, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?)").run("room_shared_default", "shared:app", "Shared Chat", JSON.stringify({ default: true }), "2026-05-30T00:00:00.000Z");
		pibo.prepare("INSERT INTO rooms (id, owner_scope, name, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?)").run("room_user_default", "user:legacy", "Personal Chat", JSON.stringify({ default: true }), "2026-05-30T00:01:00.000Z");
		pibo.prepare("INSERT INTO sessions (id, owner_scope, room_id) VALUES (?, ?, ?)").run("ps_shared", "shared:app", "room_shared_default");
		pibo.prepare("INSERT INTO sessions (id, owner_scope, room_id) VALUES (?, ?, ?)").run("ps_user", "user:legacy", "room_user_default");
		pibo.prepare("INSERT INTO session_navigation (owner_scope, room_id, session_id, updated_at) VALUES (?, ?, ?, ?)").run("shared:app", "room_shared_default", "ps_shared", "2026-05-30T00:00:00.000Z");
		pibo.prepare("INSERT INTO session_navigation (owner_scope, room_id, session_id, updated_at) VALUES (?, ?, ?, ?)").run("user:legacy", "room_user_default", "ps_user", "2026-05-30T00:01:00.000Z");
		pibo.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)").run("room_one", "shared:app", "viewer", "2026-05-30T00:00:00.000Z");
		pibo.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)").run("room_one", "user:legacy", "owner", "2026-05-30T00:01:00.000Z");
		pibo.prepare("INSERT INTO principal_session_stats (session_id, principal_id, unread_count, last_read_stream_id, last_read_message_sequence, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ps_user", "user:legacy", 4, 2, 1, "2026-05-30T00:02:00.000Z", "2026-05-30T00:02:00.000Z");
		pibo.prepare("INSERT INTO principal_session_stats (session_id, principal_id, unread_count, last_read_stream_id, last_read_message_sequence, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ps_user", "shared:app", 1, 3, 2, "2026-05-30T00:03:00.000Z", "2026-05-30T00:03:00.000Z");
		pibo.prepare("INSERT INTO principal_room_stats (room_id, principal_id, unread_count, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("room_one", "user:legacy", 5, 6, "2026-05-30T00:04:00.000Z", "2026-05-30T00:04:00.000Z");
		pibo.prepare("INSERT INTO workflow_lifecycle_events (id, owner_scope, created_at) VALUES (?, ?, ?)").run("wfle_1", "user:legacy", "2026-05-30T00:05:00.000Z");
		pibo.prepare("INSERT INTO workflow_prompt_assets (asset_id, owner_scope, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("asset_1", "user:legacy", "Legacy Prompt", "2026-05-30T00:05:00.000Z", "2026-05-30T00:05:00.000Z");
		pibo.prepare("INSERT INTO workflow_prompt_asset_revisions (revision_id, asset_id, owner_scope, markdown, created_at) VALUES (?, ?, ?, ?, ?)").run("rev_1", "asset_1", "user:legacy", "hello", "2026-05-30T00:05:00.000Z");
		pibo.prepare("INSERT INTO workflow_ui_drafts (draft_id, workflow_id, owner_scope, status, updated_at) VALUES (?, ?, ?, ?, ?)").run("draft_1", "workflow_1", "user:legacy", "draft", "2026-05-30T00:05:00.000Z");
	} finally {
		pibo.close();
	}
	const agents = new DatabaseSync(join(root, "chat-agents.sqlite"));
	try {
		agents.exec("CREATE TABLE chat_agents (id TEXT PRIMARY KEY, profile_name TEXT, display_name TEXT, owner_scope TEXT, created_at TEXT, updated_at TEXT)");
		agents.prepare("INSERT INTO chat_agents (id, profile_name, display_name, owner_scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("agent_1", "helper", "Helper", "user:legacy", "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
		agents.prepare("INSERT INTO chat_agents (id, profile_name, display_name, owner_scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("agent_2", "helper", "Helper", "shared:app", "2026-05-30T00:01:00.000Z", "2026-05-30T00:01:00.000Z");
	} finally {
		agents.close();
	}
	const ralph = new DatabaseSync(join(root, "pibo-ralph.sqlite"));
	try {
		ralph.exec("CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT, target_json TEXT, state_json TEXT); CREATE TABLE pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT, owner_scope TEXT, status TEXT); CREATE TABLE pibo_ralph_run_facts (id TEXT PRIMARY KEY, job_id TEXT, owner_scope TEXT)");
		ralph.prepare("INSERT INTO pibo_ralph_jobs (id, owner_scope, target_json, state_json) VALUES (?, ?, ?, ?)").run("ralph_job_1", "user:legacy", JSON.stringify({ kind: "personal", principalId: "user:legacy" }), JSON.stringify({ runningAt: "2026-05-30T00:06:00.000Z" }));
		ralph.prepare("INSERT INTO pibo_ralph_runs (id, job_id, owner_scope, status) VALUES (?, ?, ?, ?)").run("ralph_run_1", "ralph_job_1", "user:legacy", "running");
		ralph.prepare("INSERT INTO pibo_ralph_run_facts (id, job_id, owner_scope) VALUES (?, ?, ?)").run("ralph_fact_1", "ralph_job_1", "user:legacy");
	} finally {
		ralph.close();
	}
	const cron = new DatabaseSync(join(root, "pibo-cron.sqlite"));
	try {
		cron.exec("CREATE TABLE pibo_cron_jobs (id TEXT PRIMARY KEY, owner_scope TEXT, target_json TEXT, state_json TEXT); CREATE TABLE pibo_cron_runs (id TEXT PRIMARY KEY, job_id TEXT, owner_scope TEXT, status TEXT)");
		cron.prepare("INSERT INTO pibo_cron_jobs (id, owner_scope, target_json, state_json) VALUES (?, ?, ?, ?)").run("cron_job_1", "user:legacy", JSON.stringify({ kind: "personal", principalId: "user:legacy" }), JSON.stringify({ runningAt: "2026-05-30T00:06:00.000Z" }));
		cron.prepare("INSERT INTO pibo_cron_runs (id, job_id, owner_scope, status) VALUES (?, ?, ?, ?)").run("cron_run_1", "cron_job_1", "user:legacy", "running");
	} finally {
		cron.close();
	}
	const annotations = new DatabaseSync(join(root, "web-annotations.sqlite"));
	try {
		annotations.exec("CREATE TABLE web_annotation_bindings (id TEXT PRIMARY KEY, owner_scope TEXT); CREATE TABLE web_annotations (id TEXT PRIMARY KEY, owner_scope TEXT)");
		annotations.prepare("INSERT INTO web_annotation_bindings (id, owner_scope) VALUES (?, ?)").run("binding_1", "user:legacy");
		annotations.prepare("INSERT INTO web_annotations (id, owner_scope) VALUES (?, ?)").run("annotation_1", "user:legacy");
	} finally {
		annotations.close();
	}
	const projects = new DatabaseSync(join(root, "web-projects.sqlite"));
	try {
		projects.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, owner_scope TEXT, name TEXT)");
		projects.prepare("INSERT INTO projects (id, owner_scope, name) VALUES (?, ?, ?)").run("project_1", "user:legacy", "Legacy Project");
	} finally {
		projects.close();
	}
	const reliability = new DatabaseSync(join(root, "pibo-events.sqlite"));
	try {
		reliability.exec("CREATE TABLE pibo_runs (id TEXT PRIMARY KEY, owner_pibo_session_id TEXT)");
		reliability.prepare("INSERT INTO pibo_runs (id, owner_pibo_session_id) VALUES (?, ?)").run("run_1", "ps_user");
	} finally {
		reliability.close();
	}
	return root;
}

function readPibo(root) {
	return new DatabaseSync(join(root, "pibo.sqlite"));
}

async function createSqliteBackup(root) {
	const backup = join(root, "backup");
	await mkdir(backup);
	for (const file of ["pibo.sqlite", "chat-agents.sqlite", "pibo-ralph.sqlite", "pibo-cron.sqlite", "web-annotations.sqlite", "web-projects.sqlite", "pibo-events.sqlite"]) {
		try {
			await copyFile(join(root, file), join(backup, file));
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return backup;
}

async function makeFullPiboHome() {
	const root = await mkdtemp(join(tmpdir(), "pibo-shared-app-full-migration-"));
	const store = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	store.db.exec(`
		ALTER TABLE rooms ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app';
		ALTER TABLE sessions ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app';
		ALTER TABLE session_navigation ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app';
		CREATE TABLE principal_session_stats (session_id TEXT NOT NULL, principal_id TEXT NOT NULL, unread_count INTEGER NOT NULL DEFAULT 0, last_read_stream_id INTEGER NOT NULL DEFAULT 0, last_read_message_sequence INTEGER NOT NULL DEFAULT 0, last_read_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, principal_id));
	`);
	const now = "2026-05-30T00:00:00.000Z";
	try {
		store.db.prepare("INSERT INTO rooms (id, owner_scope, name, type, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("room_shared", "shared:app", "Shared Chat", "chat", JSON.stringify({ default: true }), now, now);
		store.db.prepare("INSERT INTO rooms (id, owner_scope, name, type, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("room_user", "user:legacy", "Personal Chat", "chat", JSON.stringify({ default: true }), now, "2026-05-30T00:01:00.000Z");
		for (const [id, ownerScope, roomId, title] of [
			["ps_historical_shared", "shared:app", "room_shared", "Historical Shared"],
			["ps_historical_user", "user:legacy", "room_user", "Historical User"],
			["ps_new_shared", "shared:app", "room_shared", "New Shared"],
		]) {
			store.sessions.upsertSession({
				session: { id, piSessionId: `pi_${id}`, ownerScope, channel: "web", kind: "chat", profile: "default", title, createdAt: now, updatedAt: now, metadata: { chatRoomId: roomId } },
				roomId,
				status: "idle",
				lastActivityAt: now,
			});
			store.navigation.upsertSession({ ownerScope, roomId, sessionId: id, rootSessionId: id, title, profile: "default", status: "idle", lastActivityAt: now, sortKey: now, updatedAt: now });
		}
		store.db.prepare("INSERT INTO principal_session_stats (session_id, principal_id, unread_count, last_read_stream_id, last_read_message_sequence, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("ps_historical_user", "user:legacy", 2, 7, 3, now);
	} finally {
		store.close();
	}
	return root;
}

test("shared-app migration inspect reports owner/principal counts and dry-run conflicts", async () => {
	const root = await makePiboHome();
	try {
		const report = inspectSharedAppMigration({ root, mode: "dry-run" });
		assert.equal(report.kind, "shared-app-migration");
		assert.equal(report.dryRun, true);
		assert.equal(report.willWrite, false);
		assert.equal(report.summary.existingStores, 7);
		assert.ok(report.summary.plannedUpdates >= 15);
		assert.equal(report.summary.appliedUpdates, 0);
		const defaultRoomAction = report.actions.find((action) => action.table === "rooms" && action.action === "retire-duplicate-default-rooms");
		assert.equal(defaultRoomAction?.planned, 1);
		assert.equal(defaultRoomAction?.details?.canonicalRoomId, "room_shared_default");
		const pibo = report.stores.find((store) => store.store === "pibo");
		assert.ok(pibo);
		const sessions = pibo.tables.find((table) => table.table === "sessions");
		assert.deepEqual(sessions?.columns[0].counts, [
			{ value: "shared:app", count: 1 },
			{ value: "user:legacy", count: 1 },
		]);
		assert.equal(sessions?.columns[0].plannedUpdates, 1);
		const roomMembers = pibo.tables.find((table) => table.table === "room_members");
		assert.equal(roomMembers?.columns[0].plannedUpdates, 1);
		assert.deepEqual(roomMembers?.conflicts.map((conflict) => ({ columns: conflict.columns, groups: conflict.groups, rows: conflict.rows })), [
			{ columns: ["room_id", "principal_id"], groups: 1, rows: 2 },
		]);
		const agentRename = report.actions.find((action) => action.store === "chat-agents" && action.action === "rename-duplicate-profile-names");
		assert.equal(agentRename?.planned, 1);
		const ralphTarget = report.actions.find((action) => action.store === "ralph" && action.action === "normalize-personal-target");
		assert.equal(ralphTarget?.planned, 1);
		assert.equal(ralphTarget?.details?.activeJobs, 1);
		const cronTarget = report.actions.find((action) => action.store === "cron" && action.action === "normalize-personal-target");
		assert.equal(cronTarget?.planned, 1);
		const reliability = report.stores.find((store) => store.store === "reliability");
		const runs = reliability?.tables.find((table) => table.table === "pibo_runs");
		assert.equal(runs?.columns[0].kind, "technical_session_owner");
		assert.equal(runs?.columns[0].plannedUpdates, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data shared-app dry-run CLI emits JSON and does not mutate data", async () => {
	const root = await makePiboHome();
	try {
		const { stdout } = await execFileAsync("node", [cliPath, "data", "shared-app", "dry-run", "--root", root, "--json"], { env: { ...process.env, PIBO_HOME: root } });
		const report = JSON.parse(stdout);
		assert.equal(report.mode, "dry-run");
		assert.equal(report.willWrite, false);
		assert.ok(report.summary.plannedUpdates >= 15);
		const db = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
		try {
			const row = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE owner_scope = ?").get("user:legacy");
			assert.equal(row.count, 1);
			const defaultRooms = db.prepare("SELECT COUNT(*) AS count FROM rooms WHERE json_extract(metadata_json, '$.default') IS 1").get();
			assert.equal(defaultRooms.count, 2);
		} finally {
			db.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data shared-app apply refuses to run without an explicit backup path", async () => {
	const root = await makePiboHome();
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "data", "shared-app", "apply", "--root", root], { env: { ...process.env, PIBO_HOME: root } }),
			(error) => {
				assert.match(error.stderr, /requires --backup <backup-path>/);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data shared-app apply verifies backup SQLite files before mutating", async () => {
	const root = await makePiboHome();
	try {
		const backup = await createSqliteBackup(root);
		await rm(join(backup, "pibo.sqlite"));
		await assert.rejects(
			execFileAsync("node", [cliPath, "data", "shared-app", "apply", "--root", root, "--backup", backup, "--json"], { env: { ...process.env, PIBO_HOME: root } }),
			(error) => {
				assert.match(error.stderr, /backup is missing required SQLite copy/);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data shared-app apply refuses unresolved unique-index conflicts", async () => {
	const root = await makePiboHome();
	try {
		const db = readPibo(root);
		try {
			db.prepare("UPDATE sessions SET room_id = ? WHERE id = ?").run("room_shared_default", "ps_user");
			db.exec("CREATE UNIQUE INDEX sessions_owner_room_unique ON sessions(owner_scope, room_id)");
		} finally {
			db.close();
		}
		const backup = await createSqliteBackup(root);
		await assert.rejects(
			execFileAsync("node", [cliPath, "data", "shared-app", "apply", "--root", root, "--backup", backup, "--json"], { env: { ...process.env, PIBO_HOME: root } }),
			(error) => {
				assert.match(error.stderr, /unresolved unique-index conflicts/);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo.sqlite apply post-check keeps historical and new shared sessions open through store paths", async () => {
	const root = await makeFullPiboHome();
	try {
		const backup = await createSqliteBackup(root);
		const report = inspectSharedAppMigration({ root, mode: "apply", backupPath: backup });
		const piboCheck = report.postChecks.find((check) => check.store === "pibo")?.checks;
		assert.equal(piboCheck?.["sessions.nonSharedOwnerRows"], 0);
		assert.equal(piboCheck?.["session_navigation.nonSharedOwnerRows"], 0);
		assert.equal(piboCheck?.["principal_session_stats.nonSharedPrincipalRows"], 0);
		assert.equal(piboCheck?.["rooms.defaultRoomRows"], 1);
		const store = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
		try {
			for (const sessionId of ["ps_historical_shared", "ps_historical_user", "ps_new_shared"]) {
				assert.ok(store.navigation.getSession(sessionId), `${sessionId} navigation remains openable`);
			}
			const listed = store.navigation.listSessions({ ownerScope: "shared:app", includeArchived: true, limit: 10 }).map((session) => session.sessionId).sort();
			assert.deepEqual(listed, ["ps_historical_shared", "ps_historical_user", "ps_new_shared"]);
		} finally {
			store.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data shared-app apply mutates pibo.sqlite transactionally and is idempotent", async () => {
	const root = await makePiboHome();
	try {
		const backup = await createSqliteBackup(root);
		const { stdout } = await execFileAsync("node", [cliPath, "data", "shared-app", "apply", "--root", root, "--backup", backup, "--json"], { env: { ...process.env, PIBO_HOME: root } });
		const report = JSON.parse(stdout);
		assert.equal(report.mode, "apply");
		assert.equal(report.backup.providedPathExists, true);
		assert.equal(report.willWrite, true);
		assert.ok(report.summary.appliedUpdates >= 20);
		assert.match(report.warnings.join("\n"), /ralph migration is metadata-only/);
		const db = readPibo(root);
		try {
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE owner_scope != 'shared:app'").get().count, 0);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rooms WHERE owner_scope != 'shared:app'").get().count, 0);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM session_navigation WHERE owner_scope != 'shared:app'").get().count, 0);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM room_members WHERE principal_id != 'shared:app'").get().count, 0);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM principal_session_stats WHERE principal_id != 'shared:app'").get().count, 0);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM principal_room_stats WHERE principal_id != 'shared:app'").get().count, 0);
			for (const table of ["workflow_lifecycle_events", "workflow_prompt_assets", "workflow_prompt_asset_revisions", "workflow_ui_drafts"]) {
				assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_scope != 'shared:app'`).get().count, 0);
			}
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rooms WHERE json_extract(metadata_json, '$.default') IS 1").get().count, 1);
			assert.equal(db.prepare("SELECT role, joined_at FROM room_members WHERE room_id = 'room_one' AND principal_id = 'shared:app'").get().role, "owner");
			const sessionStats = db.prepare("SELECT unread_count, last_read_stream_id, last_read_message_sequence FROM principal_session_stats WHERE session_id = 'ps_user' AND principal_id = 'shared:app'").get();
			assert.equal(sessionStats.unread_count, 1);
			assert.equal(sessionStats.last_read_stream_id, 3);
			assert.equal(sessionStats.last_read_message_sequence, 2);
		} finally {
			db.close();
		}
		const agents = new DatabaseSync(join(root, "chat-agents.sqlite"));
		try {
			assert.equal(agents.prepare("SELECT COUNT(*) AS count FROM chat_agents WHERE owner_scope != 'shared:app'").get().count, 0);
			assert.equal(agents.prepare("SELECT COUNT(*) AS count FROM (SELECT profile_name FROM chat_agents GROUP BY profile_name HAVING COUNT(*) > 1)").get().count, 0);
			assert.ok(agents.prepare("SELECT profile_name FROM chat_agents WHERE id = 'agent_1'").get().profile_name.startsWith("helper legacy "));
		} finally {
			agents.close();
		}
		for (const [file, jobTable, runTable] of [["pibo-ralph.sqlite", "pibo_ralph_jobs", "pibo_ralph_runs"], ["pibo-cron.sqlite", "pibo_cron_jobs", "pibo_cron_runs"]]) {
			const aux = new DatabaseSync(join(root, file));
			try {
				assert.equal(aux.prepare(`SELECT COUNT(*) AS count FROM ${jobTable} WHERE owner_scope != 'shared:app'`).get().count, 0);
				assert.equal(aux.prepare(`SELECT COUNT(*) AS count FROM ${runTable} WHERE owner_scope != 'shared:app'`).get().count, 0);
				assert.equal(JSON.parse(aux.prepare(`SELECT target_json FROM ${jobTable}`).get().target_json).principalId, "shared:app");
			} finally {
				aux.close();
			}
		}
		const annotations = new DatabaseSync(join(root, "web-annotations.sqlite"));
		try {
			assert.equal(annotations.prepare("SELECT COUNT(*) AS count FROM web_annotation_bindings WHERE owner_scope != 'shared:app'").get().count, 0);
			assert.equal(annotations.prepare("SELECT COUNT(*) AS count FROM web_annotations WHERE owner_scope != 'shared:app'").get().count, 0);
		} finally {
			annotations.close();
		}
		const projects = new DatabaseSync(join(root, "web-projects.sqlite"));
		try {
			assert.equal(projects.prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_scope != 'shared:app'").get().count, 0);
		} finally {
			projects.close();
		}
		const second = JSON.parse((await execFileAsync("node", [cliPath, "data", "shared-app", "apply", "--root", root, "--backup", backup, "--json"], { env: { ...process.env, PIBO_HOME: root } })).stdout);
		assert.equal(second.summary.appliedUpdates, 0);
		assert.equal(second.willWrite, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
