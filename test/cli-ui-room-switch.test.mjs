import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve(process.env.PIBO_TEST_CLI_PATH ?? "dist/bin/pibo.js");
const ptyAvailable = await hasPythonPtyDriver();

async function hasPythonPtyDriver() {
	if (process.platform === "win32") return false;
	for (const command of ["python3", "python"]) {
		try {
			await execFileAsync(command, ["--version"]);
			return true;
		} catch {}
	}
	return false;
}

async function runRoomScenario(name, steps, expect) {
	const dir = await mkdtemp(join(tmpdir(), `pibo-cli-room-${name}-`));
	const home = join(dir, "home");
	const artifactDir = join(dir, "artifacts");
	const scenarioPath = join(dir, "scenario.json");
	const reply = `Mocked ${name} reply`;
	try {
		await writeFile(scenarioPath, JSON.stringify({
			name: `room-${name}`,
			command: [
				"env",
				`PIBO_HOME=${home}`,
				"PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1",
				`PIBO_DEBUG_PTY_ASSISTANT_REPLY=${reply}`,
				"PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS=room_shared|Shared Chat;room_project|Project Room",
				"node",
				cliPath,
				"tui:sessions",
			],
			providerMode: "deterministic",
			rows: 32,
			cols: 120,
			timeoutMs: 45_000,
			idleTimeoutMs: 15_000,
			inputDelayMs: 20,
			artifact: true,
			artifactDir,
			steps,
			expect,
		}, null, 2));

		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", scenarioPath]);
		assert.match(result.stdout, new RegExp(`PTY passed: room-${name}`));
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.ok, true);
		assert.equal(metadata.exitCode, 0);
		assert.equal(metadata.stopReason, "completed");

		const database = new DatabaseSync(join(home, "pibo.sqlite"), { readOnly: true });
		return {
			clean,
			reply,
			sessions: database.prepare("SELECT id, room_id FROM sessions ORDER BY created_at").all(),
			messages: database.prepare("SELECT session_id, room_id, role, content_preview FROM chat_messages ORDER BY sequence").all(),
			close() {
				database.close();
				return rm(dir, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

const createSharedSession = [
	{ waitFor: "select room", timeoutMs: 10_000 },
	{ press: "Enter" },
	{ waitFor: "select session", timeoutMs: 5_000 },
	{ press: "Enter" },
	{ waitFor: "Created session", timeoutMs: 5_000 },
	{ sleepMs: 300 },
];

test("cross-room selection clears the stale session before Project Room can receive input", { skip: !ptyAvailable }, async () => {
	const run = await runRoomScenario("cross-room", [
		...createSharedSession,
		{ typeText: "/room" },
		{ press: "Enter" },
		{ waitFor: "Select the active room with arrow keys.", timeoutMs: 5_000 },
		{ press: "Down" },
		{ press: "Enter" },
		{ waitFor: "room Project Room · session no session", timeoutMs: 5_000 },
		{ waitFor: "Selected room Project Room.", timeoutMs: 5_000 },
		{ sleepMs: 300 },
		{ typeText: "blocked-stale-session-message" },
		{ press: "Enter" },
		{ waitFor: "No session is open.", timeoutMs: 5_000 },
		{ typeText: "/new" },
		{ press: "Enter" },
		{ sleepMs: 500 },
		{ typeText: "project-room-message" },
		{ press: "Enter" },
		{ waitFor: "Mocked cross-room reply", timeoutMs: 5_000 },
		{ typeText: "/exit" },
		{ press: "Enter" },
	], ["room Project Room · session no session", "No session is open.", "project-room-message"]);
	try {
		assert.match(run.clean, /room Project Room · session no session/);
		assert.match(run.clean, /Error: No session is open/);
		assert.deepEqual(run.sessions.map((session) => session.room_id), ["room_shared", "room_project"]);
		assert.deepEqual(run.messages.map((message) => [message.content_preview, message.room_id]), [
			["project-room-message", "room_project"],
			[run.reply, "room_project"],
		]);
		assert.equal(run.messages.some((message) => message.content_preview === "blocked-stale-session-message"), false);
	} finally {
		await run.close();
	}
});

test("same-room selection preserves the open session and message ownership", { skip: !ptyAvailable }, async () => {
	const run = await runRoomScenario("same-room", [
		...createSharedSession,
		{ typeText: "/room" },
		{ press: "Enter" },
		{ waitFor: "Select the active room with arrow keys.", timeoutMs: 5_000 },
		{ press: "Enter" },
		{ waitFor: "Selected room Shared Chat.", timeoutMs: 5_000 },
		{ sleepMs: 300 },
		{ typeText: "same-room-message" },
		{ press: "Enter" },
		{ waitFor: "Mocked same-room reply", timeoutMs: 5_000 },
		{ typeText: "/exit" },
		{ press: "Enter" },
	], ["room Shared Chat · session New CLI session", "same-room-message"]);
	try {
		assert.deepEqual(run.sessions.map((session) => session.room_id), ["room_shared"]);
		assert.deepEqual(run.messages.map((message) => message.room_id), ["room_shared", "room_shared"]);
	} finally {
		await run.close();
	}
});

test("fresh Project Room selection creates and owns its new session", { skip: !ptyAvailable }, async () => {
	const run = await runRoomScenario("fresh-room", [
		{ waitFor: "select room", timeoutMs: 10_000 },
		{ press: "Down" },
		{ press: "Enter" },
		{ waitFor: "select session", timeoutMs: 5_000 },
		{ press: "Enter" },
		{ waitFor: "Created session", timeoutMs: 5_000 },
		{ sleepMs: 300 },
		{ typeText: "fresh-room-message" },
		{ press: "Enter" },
		{ waitFor: "Mocked fresh-room reply", timeoutMs: 5_000 },
		{ typeText: "/exit" },
		{ press: "Enter" },
	], ["room Project Room · session New CLI session", "fresh-room-message"]);
	try {
		assert.deepEqual(run.sessions.map((session) => session.room_id), ["room_project"]);
		assert.deepEqual(run.messages.map((message) => message.room_id), ["room_project", "room_project"]);
	} finally {
		await run.close();
	}
});

test("canceling the room picker preserves the Shared Chat session", { skip: !ptyAvailable }, async () => {
	const run = await runRoomScenario("cancel-room", [
		...createSharedSession,
		{ typeText: "/room" },
		{ press: "Enter" },
		{ waitFor: "Select the active room with arrow keys.", timeoutMs: 5_000 },
		{ press: "Down" },
		{ press: "Escape" },
		{ sleepMs: 300 },
		{ typeText: "cancel-room-message" },
		{ press: "Enter" },
		{ waitFor: "Mocked cancel-room reply", timeoutMs: 5_000 },
		{ typeText: "/exit" },
		{ press: "Enter" },
	], ["room Shared Chat · session New CLI session", "cancel-room-message"]);
	try {
		assert.deepEqual(run.sessions.map((session) => session.room_id), ["room_shared"]);
		assert.deepEqual(run.messages.map((message) => message.room_id), ["room_shared", "room_shared"]);
	} finally {
		await run.close();
	}
});
