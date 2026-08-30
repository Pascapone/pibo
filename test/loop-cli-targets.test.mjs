import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");
const conflictingTargetError = /Choose either --room <room-id> or --default-chat, not both/;

function runCli(args) {
	return execFileAsync("node", [cliPath, ...args], { cwd: process.cwd() });
}

async function expectCliFailure(args, pattern) {
	await assert.rejects(runCli(args), (error) => {
		assert.match(String(error.stderr ?? error.message), pattern);
		return true;
	});
}

async function listJobs(storePath) {
	const result = await runCli(["loop", "--store", storePath, "list", "--all", "--json"]);
	return JSON.parse(result.stdout);
}

async function fileDoesNotExist(path) {
	await assert.rejects(access(path), (error) => error?.code === "ENOENT");
}

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

test("loop add requires exactly one target without unintended persistence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-cli-targets-"));
	try {
		for (const [name, targetArgs] of [
			["room-first", ["--room", "room_conflict", "--default-chat"]],
			["default-first", ["--default-chat", "--room", "room_conflict"]],
		]) {
			const storePath = join(dir, `${name}.sqlite`);
			await expectCliFailure([
				"loop", "--store", storePath, "add", "--prompt", "conflict", ...targetArgs, "--json",
			], conflictingTargetError);
			await fileDoesNotExist(storePath);
		}

		const roomStorePath = join(dir, "room.sqlite");
		const roomResult = await runCli([
			"loop", "--store", roomStorePath, "add", "--prompt", "room", "--room", "room_only", "--json",
		]);
		assert.deepEqual(JSON.parse(roomResult.stdout).target, { kind: "room", roomId: "room_only" });
		assert.deepEqual((await listJobs(roomStorePath)).map((job) => job.target), [{ kind: "room", roomId: "room_only" }]);

		const defaultStorePath = join(dir, "default.sqlite");
		const defaultResult = await runCli([
			"loop", "--store", defaultStorePath, "add", "--prompt", "default", "--default-chat", "--json",
		]);
		assert.deepEqual(JSON.parse(defaultResult.stdout).target, { kind: "default-chat" });
		assert.deepEqual((await listJobs(defaultStorePath)).map((job) => job.target), [{ kind: "default-chat" }]);

		const missingStorePath = join(dir, "missing.sqlite");
		await expectCliFailure([
			"loop", "--store", missingStorePath, "add", "--prompt", "missing", "--json",
		], /Choose a target: --room <room-id> or --default-chat/);
		await fileDoesNotExist(missingStorePath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("loop edit rejects conflicting targets without mutating the stored job", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-cli-edit-targets-"));
	try {
		for (const [name, targetArgs] of [
			["room-first", ["--room", "room_conflict", "--default-chat"]],
			["default-first", ["--default-chat", "--room", "room_conflict"]],
		]) {
			const storePath = join(dir, `${name}.sqlite`);
			const addResult = await runCli([
				"loop", "--store", storePath, "add", "--prompt", "seed", "--default-chat", "--json",
			]);
			const added = JSON.parse(addResult.stdout);
			await expectCliFailure([
				"loop", "--store", storePath, "edit", added.id, ...targetArgs, "--json",
			], conflictingTargetError);
			const jobs = await listJobs(storePath);
			assert.equal(jobs.length, 1);
			assert.deepEqual(jobs[0].target, { kind: "default-chat" });
			assert.equal(jobs[0].updatedAt, added.updatedAt);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("loop conflicting targets fail through a real PTY without creating a store", { skip: !(await hasPythonPtyDriver()) }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-cli-pty-targets-"));
	try {
		const storePath = join(dir, "pty.sqlite");
		const artifactDir = join(dir, "artifacts");
		await assert.rejects(
			runCli([
				"debug", "pty", "run", "--artifact", "--artifact-dir", artifactDir, "--",
				"node", cliPath, "loop", "--store", storePath, "add", "--prompt", "pty conflict",
				"--room", "room_pty", "--default-chat", "--json",
			]),
			(error) => {
				assert.match(String(error.stderr ?? ""), /PTY command exited with status 1/);
				return true;
			},
		);
		assert.match(await readFile(join(artifactDir, "clean.txt"), "utf8"), conflictingTargetError);
		const metadata = JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8"));
		assert.equal(metadata.ok, false);
		assert.equal(metadata.stopReason, "exit_code:1");
		await fileDoesNotExist(storePath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
