import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ensurePrivatePiboHome } from "../dist/core/pibo-home.js";
import { assertPrivateWindowsAcl, grantBuiltinUsersModify, readWindowsAcl } from "./fixtures/windows-acl.mjs";

const isWindows = process.platform === "win32";

function mode(path) {
	return statSync(path).mode & 0o777;
}

function assertPrivateDirectory(path) {
	if (isWindows) assertPrivateWindowsAcl(path, "directory");
	else assert.equal(mode(path), 0o700);
}

test("ensurePrivatePiboHome creates a private directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-private-home-create-"));
	const home = join(root, "state");
	try {
		assert.equal(ensurePrivatePiboHome(home), home);
		assertPrivateDirectory(home);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensurePrivatePiboHome tightens an existing directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-private-home-tighten-"));
	const home = join(root, "state");
	try {
		mkdirSync(home, { mode: 0o755 });
		writeFileSync(join(home, "preserved.txt"), "preserved");
		if (isWindows) {
			grantBuiltinUsersModify(home);
			assert.ok(readWindowsAcl(home).rules.some((rule) => rule.sid === "S-1-5-32-545"));
		} else {
			chmodSync(home, 0o755);
			assert.equal(mode(home), 0o755);
		}
		ensurePrivatePiboHome(home);
		assertPrivateDirectory(home);
		assert.equal(readFileSync(join(home, "preserved.txt"), "utf8"), "preserved");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensurePrivatePiboHome rejects a file path", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-private-home-file-"));
	const home = join(root, "state");
	try {
		writeFileSync(home, "not a directory");
		assert.throws(() => ensurePrivatePiboHome(home), /Pibo Home must be a directory/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("default data stores protect Pibo Home outside the CLI", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-private-home-store-"));
	const home = join(root, "state");
	try {
		mkdirSync(home, { mode: 0o755 });
		chmodSync(home, 0o755);
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				'import { PiboDataStore } from "./dist/data/pibo-store.js"; const store = new PiboDataStore(); store.close();',
			],
			{ cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PIBO_HOME: home } },
		);
		assert.equal(result.status, 0, result.stderr);
		assertPrivateDirectory(home);
		if (isWindows) assertPrivateWindowsAcl(join(home, "pibo.sqlite"), "file");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the CLI protects Pibo Home before stateful commands without changing discovery commands", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-private-home-cli-"));
	const home = join(root, "state");
	const cli = join(process.cwd(), "dist", "bin", "pibo.js");
	const env = { ...process.env, PIBO_HOME: home };
	try {
		const version = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8", env });
		assert.equal(version.status, 0, version.stderr);
		assert.equal(existsSync(home), false);

		const show = spawnSync(process.execPath, [cli, "config", "show"], { encoding: "utf8", env });
		assert.equal(show.status, 0, show.stderr);
		assertPrivateDirectory(home);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
