import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo tools lists curated CLI tools", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-list-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "list"], { cwd, env });

		assert.match(result.stdout, /browser-use/);
		assert.match(result.stdout, /available/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools exposes browser-use guides outside the profile skill system", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-guide-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };

		const guides = await execFileAsync("node", [cliPath, "tools", "guides", "browser-use"], { cwd, env });
		assert.match(guides.stdout, /browser-use/);
		assert.match(guides.stdout, /remote-browser/);

		const guide = await execFileAsync("node", [cliPath, "tools", "guide", "browser-use", "browser-use"], { cwd, env });
		assert.match(guide.stdout, /# Browser Automation with browser-use CLI/);
		assert.match(guide.stdout, /browser-use state/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools install supports a no-setup dry target", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-install-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "install", "browser-use", "--no-setup"], { cwd, env });

		assert.match(result.stdout, /Install target browser-use/);
		assert.match(result.stdout, /pibo-home\/tools\/browser-use/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
