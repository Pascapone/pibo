import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";

const execFileAsyncRaw = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function execFileAsync(file, args, options = {}) {
	return execFileAsyncRaw(file, args, {
		...options,
		env: {
			...process.env,
			...options.env,
		},
	});
}

async function hasPythonPtyDriver() {
	if (process.platform === "win32") return false; // The host driver requires Python's POSIX pty/termios modules.
	try {
		await execFileAsync("python3", ["--version"]);
		return true;
	} catch {
		try {
			await execFileAsync("python", ["--version"]);
			return true;
		} catch {
			return false;
		}
	}
}

test("pibo debug pty help is discoverable", async () => {
	const root = await execFileAsync("node", [cliPath, "debug", "--help"]);
	assert.match(root.stdout, /pty\s+Run and inspect interactive CLI\/TUI commands under a PTY/);
	assert.match(root.stdout, /pibo debug pty run -- pibo tui:sessions --demo/);

	const pty = await execFileAsync("node", [cliPath, "debug", "pty", "--help"]);
	assert.match(pty.stdout, /pibo debug pty - run and inspect interactive CLI\/TUI commands under a pseudo-terminal/);
	assert.match(pty.stdout, /run\s+Run one command under PTY/);
	assert.match(pty.stdout, /scenario\s+Run a declarative PTY scenario JSON file/);
	assert.match(pty.stdout, /--real-provider/);
	assert.match(pty.stdout, /--max-iterations <n>/);
});

test("pibo debug pty run captures host PTY output and artifacts", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const artifactDir = join(dir, "artifacts");
		const result = await execFileAsync("node", [
			cliPath,
			"debug",
			"pty",
			"run",
			"--artifact",
			"--artifact-dir",
			artifactDir,
			"--expect",
			"hello from pty",
			"--",
			"node",
			"-e",
			"console.log('hello from pty')",
		]);
		assert.match(result.stdout, /PTY passed: adhoc-run/);
		assert.match(result.stdout, /backend\thost/);
		assert.match(result.stdout, /artifacts\t/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /hello from pty/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.backend, "host");
		assert.equal(metadata.ok, true);
		assert.equal(metadata.exitCode, 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty scenario types input through an interactive PTY", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const scenarioPath = join(dir, "scenario.json");
		const artifactDir = join(dir, "artifacts");
		await writeFile(scenarioPath, JSON.stringify({
			name: "interactive-fixture",
			command: ["bash", "-lc", "echo ready; read x; echo got:$x"],
			timeoutMs: 5000,
			idleTimeoutMs: 1000,
			inputDelayMs: 1,
			steps: [
				{ waitFor: "ready", timeoutMs: 1000 },
				{ typeText: "abc" },
				{ press: "Enter" },
			],
			expect: ["got:abc"],
			reject: ["UnhandledPromiseRejection"],
		}, null, 2));
		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, scenarioPath]);
		assert.match(result.stdout, /PTY passed: interactive-fixture/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /ready/);
		assert.match(clean, /got:abc/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("built-in mocked CLI session scenario follows the room and session picker flow", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const binDir = join(dir, "bin");
		const artifactDir = join(dir, "artifacts");
		await mkdir(binDir, { recursive: true });
		const piboWrapper = join(binDir, "pibo");
		await writeFile(piboWrapper, `#!/bin/sh\nexec "${process.execPath}" "${cliPath}" "$@"\n`);
		await chmod(piboWrapper, 0o755);
		const result = await execFileAsync("node", [
			cliPath,
			"debug",
			"pty",
			"scenario",
			"--builtin",
			"cli-session-ui-mocked-e2e",
			"--artifact",
			"--artifact-dir",
			artifactDir,
		], { env: { PATH: `${binDir}:${process.env.PATH ?? ""}` } });
		assert.match(result.stdout, /PTY passed: cli-session-ui-mocked-e2e/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /select room/);
		assert.match(clean, /Created session/);
		assert.match(clean, /Mocked PTY assistant response/);
		assert.match(clean, /Runtime: local/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.ok, true);
		assert.equal(metadata.exitCode, 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Ink session picker treats keyboard-repeat Enter as one persistent activation", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	const homeDir = join(dir, "home");
	const artifactDir = join(dir, "artifacts");
	const scenarioPath = join(dir, "scenario.json");
	try {
		await writeFile(scenarioPath, JSON.stringify({
			name: "ink-new-session-key-repeat",
			command: [process.execPath, cliPath, "tui:sessions"],
			rows: 36,
			cols: 120,
			timeoutMs: 30_000,
			idleTimeoutMs: 10_000,
			inputDelayMs: 1,
			env: {
				PIBO_HOME: homeDir,
				PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
				PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS: "room_alpha|Alpha Room;room_beta|Beta Room",
			},
			steps: [
				{ waitFor: "select room", timeoutMs: 10_000 },
				{ press: "Down" },
				{ sleepMs: 100 },
				{ press: "Down" },
				{ waitFor: "❯ Beta Room", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "select session — Beta Room", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ sleepMs: 30 },
				{ press: "Enter" },
				{ waitFor: "Created session", timeoutMs: 10_000 },
				{ sleepMs: 300 },
				{ typeText: "/model" },
				{ press: "Enter" },
				{ waitFor: "› /model", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "select model provider", timeoutMs: 10_000 },
				{ press: "CtrlC" },
			],
			expect: ["Beta Room", "Created session", "select model provider"],
			reject: ["UnhandledPromiseRejection", "source_closed"],
		}, null, 2));

		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, scenarioPath]);
		assert.match(result.stdout, /PTY passed: ink-new-session-key-repeat/);
		const store = new PiboDataStore(join(homeDir, "pibo.sqlite"), { payloadRootDir: join(homeDir, "payloads") });
		try {
			const sessions = store.db.prepare("SELECT id, room_id, created_at FROM sessions ORDER BY created_at").all();
			const navigation = store.db.prepare("SELECT room_id, session_id FROM session_navigation ORDER BY updated_at").all();
			assert.equal(sessions.length, 1);
			assert.equal(sessions[0].room_id, "room_beta");
			assert.equal(navigation.length, 1);
			assert.equal(navigation[0].room_id, "room_beta");
			assert.equal(navigation[0].session_id, sessions[0].id);
		} finally {
			store.close();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Ink session picker allows a later intentional session creation", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	const homeDir = join(dir, "home");
	const artifactDir = join(dir, "artifacts");
	const scenarioPath = join(dir, "scenario.json");
	try {
		await writeFile(scenarioPath, JSON.stringify({
			name: "ink-new-session-sequential",
			command: [process.execPath, cliPath, "tui:sessions"],
			rows: 32,
			cols: 110,
			timeoutMs: 30_000,
			idleTimeoutMs: 10_000,
			inputDelayMs: 1,
			env: {
				PIBO_HOME: homeDir,
				PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
			},
			steps: [
				{ waitFor: "select room", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "+ New session", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "Created session", timeoutMs: 10_000 },
				{ typeText: "/session" },
				{ press: "Enter" },
				{ waitFor: "› /session", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "select room — sessions", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "Select a session with arrow keys, or create a new one.", timeoutMs: 10_000 },
				{ press: "Down" },
				{ sleepMs: 150 },
				{ press: "Enter" },
				{ sleepMs: 500 },
				{ press: "CtrlC" },
			],
			expect: ["Created session", "Select a session with arrow keys, or create a new one."],
			reject: ["UnhandledPromiseRejection", "source_closed"],
		}, null, 2));

		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, scenarioPath]);
		assert.match(result.stdout, /PTY passed: ink-new-session-sequential/);
		const store = new PiboDataStore(join(homeDir, "pibo.sqlite"), { payloadRootDir: join(homeDir, "payloads") });
		try {
			const sessions = store.db.prepare("SELECT room_id, created_at FROM sessions ORDER BY created_at").all();
			assert.equal(sessions.length, 2);
			assert.equal(new Set(sessions.map((session) => session.room_id)).size, 1);
			assert.ok(Date.parse(sessions[1].created_at) > Date.parse(sessions[0].created_at));
		} finally {
			store.close();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty real-provider mode requires explicit safety opt-in", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const scenarioPath = join(dir, "real.json");
		const artifactDir = join(dir, "artifacts");
		await writeFile(scenarioPath, JSON.stringify({
			name: "real-safety",
			providerMode: "real",
			command: ["node", "-e", "console.log('should not run')"],
			steps: [{ typeText: "Hi", iteration: true }],
			expect: ["should not run"],
		}, null, 2));
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact-dir", artifactDir, scenarioPath]),
			(error) => {
				assert.match(error.stderr, /Real-provider PTY scenarios require explicit --real-provider/);
				assert.match(error.stderr, /PTY artifacts:/);
				return true;
			},
		);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.providerMode, "real");
		assert.equal(metadata.maxIterations, 10);
		assert.equal(metadata.ok, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

async function makeTempDir() {
	const dir = join(tmpdir(), `pibo-debug-pty-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(dir, { recursive: true });
	return dir;
}
