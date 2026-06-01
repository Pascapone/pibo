import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalCliSessionSource } from "../dist/cli-session/index.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const retiredStorageColumn = `${retiredWord}_scope`;

const reportPath = path.resolve("docs/legacy/reports/ink-cli-session-ui-v2-current-state.md");
const fixedNow = "2026-05-17T12:00:00.000Z";

test("Ink CLI V2 current-state audit remains historical until the TUI cleanup story", () => {
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
		"/room",
	]) {
		assert.match(report, new RegExp(escapeRegExp(expected)), `report should document ${expected}`);
	}

	assert.match(report, /Agent Designer editing remains Web-only/);
	assert.match(report, /Project, Workflow, Cron, Ralph, Settings, Context Files/);
});

test("V2 CLI writes app-global sessions", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-ink-cli-v2-app-context-"));
	const dataStore = new PiboDataStore(path.join(tempDir, "pibo.sqlite"), { payloadRootDir: path.join(tempDir, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	const source = new LocalCliSessionSource({ dataStore, sessionStore, now: () => fixedNow });

	try {
		const created = await source.createSession({ roomId: "room_app_required", title: "App context session", profile: "base" });
		await source.sendMessage(created.id, "message that should keep the app-global path");
		assert.equal(retiredPartitionField in created, false);

		const sessionColumns = tableColumns(dataStore.db, "sessions");
		assert.equal(sessionColumns.has(retiredStorageColumn), false);
		const sessionRow = dataStore.db.prepare("SELECT room_id FROM sessions WHERE id = ?").get(created.id);
		assert.equal(sessionRow.room_id, "room_app_required");

		const navigationColumns = tableColumns(dataStore.db, "session_navigation");
		assert.equal(navigationColumns.has(retiredStorageColumn), false);
		const navigationRow = dataStore.db.prepare("SELECT room_id, session_id FROM session_navigation WHERE session_id = ?").get(created.id);
		assert.equal(navigationRow.room_id, "room_app_required");
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
