import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

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
