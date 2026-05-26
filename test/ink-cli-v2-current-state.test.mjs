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

test("V2 CLI owner resolution prevents implicit user:unknown writes", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-ink-cli-v2-owner-required-"));
	const dataStore = new PiboDataStore(path.join(tempDir, "pibo.sqlite"), { payloadRootDir: path.join(tempDir, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	const source = new LocalCliSessionSource({ dataStore, sessionStore, now: () => fixedNow });

	try {
		const created = await source.createSession({ roomId: "room_owner_required", title: "Owner must be explicit", profile: "base" });
		await source.sendMessage(created.id, "message that should keep selected owner fallback");
		assert.equal(created.ownerScope, "local:root");

		const sessionRow = dataStore.db.prepare("SELECT owner_scope, room_id FROM sessions WHERE id = ?").get(created.id);
		assert.equal(sessionRow.owner_scope, "local:root");
		assert.equal(sessionRow.room_id, "room_owner_required");

		const navigationRow = dataStore.db.prepare("SELECT owner_scope, room_id, session_id FROM session_navigation WHERE session_id = ?").get(created.id);
		assert.equal(navigationRow.owner_scope, "local:root");
		assert.equal(navigationRow.room_id, "room_owner_required");

		assert.equal(sessionStore.find({ ownerScope: "user:unknown" }).some((session) => session.id === created.id), false);
	} finally {
		await source.close();
		dataStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
