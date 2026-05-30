import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalCliSessionSource } from "../dist/cli-session/index.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

const reportPath = path.resolve("docs/reports/ink-cli-session-ui-v2-current-state.md");
const fixedNow = "2026-05-17T12:00:00.000Z";

test("Ink CLI V2 current-state audit documents shared surface, scope, commands, and PTY validation", () => {
	const report = fs.readFileSync(reportPath, "utf8");

	for (const expected of [
		"src/session-ui/terminalRows.ts",
		"src/session-ui/terminalValue.ts",
		"src/apps/chat-ui/src/session-views/compact-terminal/",
		"src/apps/cli-ui/",
		"src/cli-session/",
		"pibo debug pty",
		"/status",
		"/compact",
		"/thinking",
		"/model",
		"/login",
		"/download",
		"/upload",
		"/owner",
		"/room",
		"user:unknown",
		"sessions.owner_scope",
		"session_navigation.owner_scope",
	]) {
		assert.match(report, new RegExp(escapeRegExp(expected)), `report should document ${expected}`);
	}

	assert.match(report, /Agent Designer editing remains Web-only/);
	assert.match(report, /Project, Workflow, Cron, Ralph, Settings, Context Files/);
});

test("V2 CLI writes shared-app sessions instead of implicit user:unknown rows", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-ink-cli-v2-owner-required-"));
	const dataStore = new PiboDataStore(path.join(tempDir, "pibo.sqlite"), { payloadRootDir: path.join(tempDir, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	const source = new LocalCliSessionSource({ dataStore, sessionStore, now: () => fixedNow });

	try {
		const created = await source.createSession({ roomId: "room_owner_required", title: "Shared app session", profile: "base" });
		await source.sendMessage(created.id, "message that should keep the shared app fallback");
		assert.equal(created.ownerScope, "shared:app");

		const sessionColumns = tableColumns(dataStore.db, "sessions");
		const sessionRow = dataStore.db.prepare(`${sessionColumns.has("owner_scope") ? "SELECT owner_scope, room_id" : "SELECT room_id"} FROM sessions WHERE id = ?`).get(created.id);
		if (sessionColumns.has("owner_scope")) assert.equal(sessionRow.owner_scope, "shared:app");
		assert.equal(sessionRow.room_id, "room_owner_required");

		const navigationColumns = tableColumns(dataStore.db, "session_navigation");
		const navigationRow = dataStore.db.prepare(`${navigationColumns.has("owner_scope") ? "SELECT owner_scope, room_id, session_id" : "SELECT room_id, session_id"} FROM session_navigation WHERE session_id = ?`).get(created.id);
		if (navigationColumns.has("owner_scope")) assert.equal(navigationRow.owner_scope, "shared:app");
		assert.equal(navigationRow.room_id, "room_owner_required");

		assert.equal(sessionStore.find({ ownerScope: "user:unknown" }).some((session) => session.id === created.id), false);
	} finally {
		await source.close();
		dataStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
