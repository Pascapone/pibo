import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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

test("pibo debug pty scenario rejects unknown top-level fields before launch", async () => {
	const dir = await makeTempDir();
	try {
		const scenarioPath = join(dir, "unknown-field.json");
		const markerPath = join(dir, "launched.txt");
		await writeFile(scenarioPath, JSON.stringify({
			name: "unknown-field",
			command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'launched')`],
			expects: ["never accepted"],
		}));
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "pty", "scenario", scenarioPath]),
			(error) => {
				assert.match(error.stderr, /unknown field "expects"/);
				assert.match(error.stderr, /unknown-field\.json/);
				return true;
			},
		);
		await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
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
		assert.equal(metadata.signal, null);
		assert.equal(metadata.stopReason, "completed");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty failed run preserves the nonzero child exit code in artifacts", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const artifactDir = join(dir, "artifacts");
		await assert.rejects(
			execFileAsync("node", [
				cliPath,
				"debug",
				"pty",
				"run",
				"--artifact",
				"--artifact-dir",
				artifactDir,
				"--expect",
				"exit-seven-marker",
				"--",
				"node",
				"-e",
				"console.log('exit-seven-marker'); process.exit(7)",
			]),
			(error) => {
				assert.match(error.stderr, /PTY command exited with status 7/);
				assert.match(error.stderr, /PTY artifacts:/);
				return true;
			},
		);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /exit-seven-marker/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.backend, "host");
		assert.equal(metadata.ok, false);
		assert.equal(metadata.exitCode, 7);
		assert.equal(metadata.signal, null);
		assert.equal(metadata.stopReason, "exit_code:7");
		assert.equal(metadata.error, "PTY command exited with status 7");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty reports invalid preview base URL config without replacing the prior value", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const home = join(dir, "home");
		const artifactDir = join(dir, "artifacts");
		const validBaseURL = "https://preview.example.test:8443";
		await execFileAsync("node", [cliPath, "config", "set", "preview.baseURL", validBaseURL], {
			env: { PIBO_HOME: home },
		});

		await assert.rejects(
			execFileAsync("node", [
				cliPath,
				"debug",
				"pty",
				"run",
				"--artifact",
				"--artifact-dir",
				artifactDir,
				"--expect",
				"must contain only scheme",
				"--",
				"env",
				`PIBO_HOME=${home}`,
				"node",
				cliPath,
				"config",
				"set",
				"preview.baseURL",
				"https://preview.example.test/path",
			]),
			/PTY command exited with status 1/,
		);

		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.stopReason, "exit_code:1");
		assert.match(await readFile(join(artifactDir, "clean.txt"), "utf8"), /preview\.baseURL must contain only scheme/);
		assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).preview.baseURL, validBaseURL);
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

test("pibo debug pty repeated waits require a newer prompt occurrence", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const scenarioPath = join(dir, "repeated-wait.json");
		const artifactDir = join(dir, "artifacts");
		await writeFile(scenarioPath, JSON.stringify({
			name: "repeated-wait",
			command: [
				"bash",
				"-lc",
				"printf 'PROMPT>\\n'; IFS= read -r first; if IFS= read -r -t 0.2 early; then printf 'EARLY:%s\\n' \"$early\"; exit 0; fi; printf 'PROMPT>\\n'; IFS= read -r second; printf 'RESULT:%s|%s\\n' \"$first\" \"$second\"",
			],
			timeoutMs: 5000,
			idleTimeoutMs: 2000,
			inputDelayMs: 1,
			artifact: true,
			artifactDir,
			steps: [
				{ waitFor: "PROMPT>" },
				{ typeText: "first" },
				{ press: "Enter" },
				{ waitFor: "PROMPT>" },
				{ typeText: "second" },
				{ press: "Enter" },
			],
			expect: ["RESULT:first|second"],
			reject: ["EARLY:second"],
		}, null, 2));
		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", scenarioPath]);
		assert.match(result.stdout, /PTY passed: repeated-wait/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /PROMPT>[\s\S]*PROMPT>[\s\S]*RESULT:first\|second/);
		assert.doesNotMatch(clean, /EARLY:second/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty preserves missing event diagnostics with non-zero inner exits", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const piboHome = join(dir, ".pibo");
		const artifactDir = join(dir, "artifacts");
		await mkdir(piboHome, { recursive: true });
		const data = new PiboDataStore(join(piboHome, "pibo.sqlite"), { payloadRootDir: join(piboHome, "payloads") });
		data.close();

		const command = [
			`node "$1" debug events ps_missing show evt_missing`,
			"text_exit=$?",
			`node "$1" debug events ps_missing show evt_missing --json`,
			"json_exit=$?",
			`printf 'TEXT_EXIT=%s JSON_EXIT=%s\\n' "$text_exit" "$json_exit"`,
		].join("; ");
		const result = await execFileAsync("node", [
			cliPath,
			"debug",
			"pty",
			"run",
			"--artifact",
			"--artifact-dir",
			artifactDir,
			"--expect",
			"event: not found",
			"--expect",
			`"resultType": "debug.events.show"`,
			"--expect",
			"TEXT_EXIT=1 JSON_EXIT=1",
			"--",
			"bash",
			"-lc",
			command,
			"issue-743",
			cliPath,
		], { env: { PIBO_HOME: piboHome } });
		assert.match(result.stdout, /PTY passed: adhoc-run/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		assert.match(clean, /TEXT_EXIT=1 JSON_EXIT=1/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.ok, true);
		assert.equal(metadata.exitCode, 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty enforces one wall-clock deadline across wait, text, and delay steps", { skip: !(await hasPythonPtyDriver()) }, async (t) => {
	const cases = [
		{
			name: "wait",
			steps: [{ waitFor: "READY" }, { waitFor: "NEVER", timeoutMs: 1200 }],
		},
		{
			name: "text",
			inputDelayMs: 80,
			steps: [{ waitFor: "READY" }, { typeText: "abcdefghijklmnopqrst" }],
		},
		{
			name: "delay",
			steps: [{ waitFor: "READY" }, { sleepMs: 1600 }],
		},
	];

	for (const fixture of cases) {
		await t.test(fixture.name, async () => {
			const dir = await makeTempDir();
			try {
				const scenarioPath = join(dir, "scenario.json");
				const artifactDir = join(dir, "artifacts");
				await writeFile(scenarioPath, JSON.stringify({
					name: `global-deadline-${fixture.name}`,
					command: ["node", "-e", "console.log('READY PID='+process.pid);setInterval(()=>{},1000)"],
					timeoutMs: 350,
					idleTimeoutMs: 5000,
					inputDelayMs: fixture.inputDelayMs ?? 0,
					steps: fixture.steps,
				}, null, 2));
				const started = performance.now();
				await assert.rejects(
					execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact-dir", artifactDir, scenarioPath]),
					(error) => {
						assert.match(error.stderr, /PTY command timed out after 350ms/);
						return true;
					},
				);
				const elapsedMs = performance.now() - started;
				assert.ok(elapsedMs >= 250, `expected the short deadline to run for at least 250ms, got ${elapsedMs}ms`);
				assert.ok(elapsedMs < 1600, `expected deadline cleanup before 1600ms, got ${elapsedMs}ms`);

				const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
				assert.equal(metadata.timeoutMs, 350);
				assert.equal(metadata.ok, false);
				assert.equal(metadata.stopReason, "wall_clock_timeout");
				assert.equal(metadata.exitCode, null);
				assert.equal(metadata.signal, null);
				assert.ok(metadata.durationMs < 1500, `expected bounded metadata duration, got ${metadata.durationMs}ms`);

				const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
				const pid = Number(/READY PID=(\d+)/.exec(clean)?.[1]);
				assert.ok(Number.isInteger(pid), `expected fixture PID in PTY output, got ${JSON.stringify(clean)}`);
				assert.equal(isProcessRunning(pid), false, `PTY fixture process ${pid} leaked after timeout`);
				const events = (await readFile(join(artifactDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
				assert.ok(events.some((event) => event.kind === "terminate" && event.detail === "wall_clock_timeout"));
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
});

test("pibo debug pty preserves zero-timeout validation and the default timeout", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const zeroPath = join(dir, "zero.json");
		await writeFile(zeroPath, JSON.stringify({
			name: "zero-timeout",
			command: ["node", "-e", "console.log('must not run')"],
			timeoutMs: 0,
		}, null, 2));
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "pty", "scenario", zeroPath]),
			(error) => {
				assert.match(error.stderr, /timeoutMs must be a positive integer/);
				return true;
			},
		);

		const defaultPath = join(dir, "default.json");
		const artifactDir = join(dir, "default-artifacts");
		await writeFile(defaultPath, JSON.stringify({
			name: "default-timeout-success",
			command: ["node", "-e", "console.log('DEFAULT_OK')"],
			expect: ["DEFAULT_OK"],
		}, null, 2));
		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, defaultPath]);
		assert.match(result.stdout, /PTY passed: default-timeout-success/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.timeoutMs, 60_000);
		assert.equal(metadata.ok, true);
		assert.equal(metadata.stopReason, "completed");
		assert.equal(metadata.exitCode, 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("pibo debug pty stop patterns terminate a running process group", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	const pidPath = join(dir, "pids.json");
	let pids = [];
	try {
		const scenarioPath = join(dir, "scenario.json");
		const artifactDir = join(dir, "artifacts");
		const fixture = [
			"const { spawn } = require('node:child_process');",
			"const { writeFileSync } = require('node:fs');",
			"const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
			"writeFileSync(process.argv[1], JSON.stringify([process.pid, descendant.pid]));",
			"console.log('STOP_REACHED_PROCESS_GROUP');",
			"setInterval(() => {}, 1000);",
		].join(" ");
		await writeFile(scenarioPath, JSON.stringify({
			name: "stop-pattern-process-group",
			command: ["node", "-e", fixture, pidPath],
			timeoutMs: 5000,
			idleTimeoutMs: 700,
			steps: [{ waitFor: "STOP_REACHED_PROCESS_GROUP", timeoutMs: 1000 }],
			stopPatterns: ["STOP_REACHED_PROCESS_GROUP"],
			expect: ["STOP_REACHED_PROCESS_GROUP"],
		}, null, 2));

		const started = Date.now();
		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, scenarioPath]);
		const durationMs = Date.now() - started;
		pids = JSON.parse(await readFile(pidPath, "utf8"));

		assert.match(result.stdout, /PTY passed: stop-pattern-process-group/);
		assert.match(result.stdout, /stopReason\tstop_pattern:STOP_REACHED_PROCESS_GROUP/);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.ok(durationMs < 1000, `stop-pattern termination took ${durationMs}ms (scenario ${metadata.durationMs}ms)`);
		assert.equal(metadata.ok, true);
		assert.equal(metadata.stopReason, "stop_pattern:STOP_REACHED_PROCESS_GROUP");
		await waitForProcessesToExit(pids, 1000);
		assert.deepEqual(pids.filter(isProcessRunning), []);
	} finally {
		for (const pid of pids.filter(isProcessRunning)) process.kill(pid, "SIGKILL");
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
				{ waitFor: "session New CLI session", timeoutMs: 10_000 },
				{ sleepMs: 100 },
				{ typeText: "/model" },
				{ waitFor: "› /model", timeoutMs: 10_000 },
				{ press: "Enter" },
				{ waitFor: "select model provider", timeoutMs: 10_000 },
				{ press: "CtrlC" },
			],
			expect: ["Beta Room", "session New CLI session", "select model provider"],
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
				{ waitFor: "session New CLI session", timeoutMs: 10_000 },
				{ sleepMs: 100 },
				{ typeText: "/session" },
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
			expect: ["session New CLI session", "Select a session with arrow keys, or create a new one."],
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

test("picker text is cleared before room and session navigation reaches the transcript", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await makeTempDir();
	try {
		const binDir = join(dir, "bin");
		const artifactDir = join(dir, "artifacts");
		const scenarioPath = join(dir, "scenario.json");
		await mkdir(binDir, { recursive: true });
		const piboWrapper = join(binDir, "pibo");
		await writeFile(piboWrapper, `#!/bin/sh\nexec "${process.execPath}" "${cliPath}" "$@"\n`);
		await chmod(piboWrapper, 0o755);
		await writeFile(scenarioPath, JSON.stringify({
			name: "picker-input-navigation-safety",
			command: ["pibo", "tui:sessions", "--demo"],
			timeoutMs: 20_000,
			idleTimeoutMs: 5_000,
			steps: [
				{ waitFor: "select room" },
				{ typeText: "PICKER_DRAFT_SHOULD_CLEAR" },
				{ press: "Enter" },
				{ waitFor: "select session" },
				{ press: "Enter" },
				{ waitFor: "Opened session" },
				{ press: "Enter" },
				{ sleepMs: 500 },
				{ press: "CtrlC" },
			],
			expect: ["select room", "select session", "Opened session"],
			reject: ["Message sent"],
		}, null, 2));
		const result = await execFileAsync("node", [cliPath, "debug", "pty", "scenario", "--artifact", "--artifact-dir", artifactDir, scenarioPath], {
			env: { PATH: `${binDir}:${process.env.PATH ?? ""}` },
		});
		assert.match(result.stdout, /PTY passed: picker-input-navigation-safety/);
		const clean = await readFile(join(artifactDir, "clean.txt"), "utf8");
		const transcript = clean.slice(clean.indexOf("Opened session"));
		assert.doesNotMatch(transcript, /PICKER_DRAFT_SHOULD_CLEAR/);
		assert.doesNotMatch(transcript, /Message sent/);
		assert.match(transcript, /Details/);
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

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === "ESRCH") return false;
		throw error;
	}
}

async function waitForProcessesToExit(pids, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (pids.some(isProcessRunning) && Date.now() < deadline) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
}
