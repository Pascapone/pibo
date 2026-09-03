import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

async function runCursorScenario(name, editSteps, expected, rejected = []) {
	const dir = await mkdtemp(join(tmpdir(), `pibo-cli-cursor-${name}-`));
	const artifactDir = join(dir, "artifacts");
	const scenarioPath = join(dir, "scenario.json");
	try {
		await writeFile(scenarioPath, JSON.stringify({
			name: `cursor-${name}`,
			command: [process.execPath, cliPath, "tui:sessions", "--demo"],
			providerMode: "mocked",
			rows: 28,
			cols: 100,
			timeoutMs: 30_000,
			idleTimeoutMs: 10_000,
			inputDelayMs: 20,
			artifact: true,
			artifactDir,
			env: { PIBO_HOME: join(dir, "home") },
			steps: [
				{ waitFor: "select room", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "select session", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "Opened session", timeoutMs: 10_000 },
				...editSteps,
				{ sleepMs: 200 },
				{ press: "Enter" },
				{ waitFor: expected === "Status — status" ? expected : "Message sent", timeoutMs: 10_000 },
				{ sleepMs: 200 },
				{ press: "CtrlC" },
			],
			expect: [expected],
			reject: [...rejected, "UnhandledPromiseRejection", "source_closed"],
		}, null, 2));

		const result = await execFileAsync(process.execPath, [cliPath, "debug", "pty", "scenario", scenarioPath]);
		assert.match(result.stdout, new RegExp(`PTY passed: cursor-${name}`));
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.ptyMethod, "host-python-pty");
		assert.equal(metadata.ok, true);
		assert.equal(metadata.exitCode, 0);
		assert.equal(metadata.stopReason, "completed");
		assert.match(clean, new RegExp(escapeRegExp(expected)));
		for (const value of rejected) assert.doesNotMatch(clean, new RegExp(escapeRegExp(value)));
		return metadata.durationMs;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("Left Arrow inserts a typo correction at the cursor", { skip: !ptyAvailable }, async () => {
	await runCursorScenario("left", [
		{ typeText: "helo" },
		{ writeBytes: "\u001b[D" },
		{ typeText: "l" },
	], "› hello", ["› helol"]);
});

test("Home, Right Arrow, and End place subsequent text correctly", { skip: !ptyAvailable }, async () => {
	await runCursorScenario("home-right-end", [
		{ typeText: "ac" },
		{ writeBytes: "\u001b[H" },
		{ writeBytes: "\u001b[C" },
		{ typeText: "b" },
		{ writeBytes: "\u001b[F" },
		{ typeText: "d" },
	], "› abcd", ["› acbd"]);
});

test("cursor movement treats a joined emoji as one grapheme", { skip: !ptyAvailable }, async () => {
	await runCursorScenario("emoji", [
		{ typeText: "A👩‍💻C" },
		{ writeBytes: "\u001b[H" },
		{ writeBytes: "\u001b[C" },
		{ writeBytes: "\u001b[C" },
		{ typeText: "B" },
	], "› A👩‍💻BC", ["› A👩‍💻CB", "�"]);
});

test("a leading d is preserved when an expandable transcript row exists", { skip: !ptyAvailable }, async () => {
	await runCursorScenario("leading-d", [
		{ typeText: "details probe" },
	], "› details probe", ["› etails probe"]);
});

test("command correction and ordinary typing retain their modes", { skip: !ptyAvailable }, async () => {
	await runCursorScenario("command", [
		{ typeText: "/sttus" },
		{ writeBytes: "\u001b[H" },
		{ writeBytes: "\u001b[C" },
		{ writeBytes: "\u001b[C" },
		{ writeBytes: "\u001b[C" },
		{ typeText: "a" },
		{ writeBytes: "\u001b[F" },
	], "Status — status", ["Unknown command"]);

	await runCursorScenario("ordinary", [
		{ typeText: "ordinary typing control" },
	], "› ordinary typing control");
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
