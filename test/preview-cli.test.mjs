import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

const execFileAsync = promisify(execFile);
const cli = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
}

function close(server) {
	return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function run(home, args) {
	return execFileAsync(process.execPath, [cli, ...args], {
		env: { ...process.env, PIBO_HOME: home, NODE_ENV: "test" },
	});
}

test("preview CLI discovers and manages a session-linked exposure", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-cli-"));
	const upstream = createServer((_req, res) => res.end("ok"));
	const port = await listen(upstream);
	t.after(async () => {
		await close(upstream);
		rmSync(home, { recursive: true, force: true });
	});
	const sessionStore = new PiboDataSessionStore(join(home, "pibo.sqlite"));
	sessionStore.create({ id: "ps_cli_preview", channel: "web", kind: "chat", profile: "base", workspace: join(home, "workspace") });
	sessionStore.close();
	await run(home, ["config", "set", "preview.baseURL", "https://preview.example.test"]);

	const discovery = await run(home, ["preview"]);
	assert.match(discovery.stdout, /expose <port>/);
	assert.match(discovery.stdout, /pibo preview expose --help/);

	const exposed = await run(home, ["preview", "expose", String(port), "--session", "ps_cli_preview", "--name", "CLI fixture", "--json"]);
	const preview = JSON.parse(exposed.stdout);
	assert.equal(preview.health, "online");
	assert.equal(preview.piboSessionId, "ps_cli_preview");
	assert.match(preview.publicUrl, /^https:\/\/pv-[a-z0-9-]+\.preview\.example\.test\/$/);

	const listed = JSON.parse((await run(home, ["preview", "list", "--session", "ps_cli_preview", "--json"])).stdout);
	assert.equal(listed.length, 1);
	assert.equal(listed[0].id, preview.id);
	assert.equal(JSON.parse((await run(home, ["preview", "doctor", preview.id, "--json"])).stdout).health, "online");
	assert.equal(JSON.parse((await run(home, ["preview", "close", preview.id, "--json"])).stdout).closed, true);
	assert.deepEqual(JSON.parse((await run(home, ["preview", "list", "--session", "ps_cli_preview", "--json"])).stdout), []);
});
