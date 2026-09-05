import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function run(home, args, extraEnv = {}) {
	return execFileAsync(process.execPath, [cli, ...args], {
		env: { ...process.env, PIBO_HOME: home, NODE_ENV: "test", ...extraEnv },
	});
}

test("preview setup prints exact DNS, Caddy, config, restart, and verification instructions", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-setup-cli-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const result = JSON.parse((await run(home, [
		"preview",
		"setup",
		"--base-url",
		"https://pool.pibo.example",
		"--public-ip",
		"192.0.2.10",
		"--json",
	])).stdout);
	assert.equal(result.baseURL, "https://pool.pibo.example/");
	assert.deepEqual(result.dnsRecord, {
		type: "A",
		name: "*.pool.pibo.example",
		value: "192.0.2.10",
	});
	assert.match(result.caddy.globalOptions, /ask http:\/\/127\.0\.0\.1:4788\/api\/previews\/tls-authorize/);
	assert.match(result.caddy.siteBlock, /\*\.pool\.pibo\.example \{/);
	assert.match(result.caddy.siteBlock, /on_demand/);
	assert.match(result.caddy.siteBlock, /reverse_proxy 127\.0\.0\.1:4788/);
	assert.match(result.commands.configure, /preview\.baseURL/);
	assert.equal(result.commands.restartGateway, "pibo gateway web restart");
	assert.match(result.commands.verify, /doctor <preview-id> --public/);

	await assert.rejects(
		run(home, ["preview", "setup", "--base-url", "https://pool.pibo.example", "--public-ip", "not-an-ip", "--json"]),
		/Public IP must be a valid IPv4 or IPv6 address/,
	);
});

test("preview base URL config rejects values that Preview commands cannot consume", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-config-cli-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const validBaseURL = "https://preview.example.test:8443";
	await run(home, ["config", "set", "preview.baseURL", validBaseURL]);

	for (const invalidBaseURL of [
		"https://preview.example.test/path",
		"https://preview.example.test?mode=test",
		"https://preview.example.test#fragment",
		"https://user@preview.example.test",
	]) {
		await assert.rejects(
			run(home, ["config", "set", "preview.baseURL", invalidBaseURL]),
			/preview\.baseURL must contain only scheme, hostname, and optional port/,
		);
		assert.equal((await run(home, ["config", "get", "preview.baseURL"])).stdout.trim(), validBaseURL);
	}

	assert.equal(JSON.parse((await run(home, ["config", "show"])).stdout).preview.baseURL, validBaseURL);
	assert.match((await run(home, ["preview", "list"])).stdout, /No previews\./);
	assert.deepEqual(JSON.parse((await run(home, ["preview", "list", "--json"])).stdout), []);
	assert.equal(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).preview.baseURL, validBaseURL);

	writeFileSync(join(home, "config.json"), `${JSON.stringify({ preview: { baseURL: "https://preview.example.test/path" } }, null, 2)}\n`);
	await assert.rejects(run(home, ["preview", "list"]), /preview\.baseURL must contain only scheme, hostname, and optional port/);

	await run(home, ["config", "del", "preview.baseURL"]);
	await assert.rejects(run(home, ["config", "get", "preview.baseURL"]));
	await assert.rejects(run(home, ["preview", "list", "--json"]), /preview\.baseURL is required/);
});

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
	const initialDoctor = JSON.parse((await run(home, ["preview", "doctor", "--json"])).stdout);
	assert.equal(initialDoctor.diagnostics.schemaVersion > 0, true);
	assert.equal(initialDoctor.diagnostics.activeExposures, 0);

	const exposed = await run(home, ["preview", "expose", String(port), "--session", "ps_cli_preview", "--name", "CLI fixture", "--json"]);
	const preview = JSON.parse(exposed.stdout);
	assert.equal(preview.health, "online");
	assert.equal(preview.piboSessionId, "ps_cli_preview");
	assert.match(preview.publicUrl, /^https:\/\/pv-[a-z0-9-]+\.preview\.example\.test\/$/);

	const listed = JSON.parse((await run(home, ["preview", "list", "--session", "ps_cli_preview", "--json"])).stdout);
	assert.equal(listed.length, 1);
	assert.equal(listed[0].id, preview.id);
	assert.equal(JSON.parse((await run(home, ["preview", "doctor", preview.id, "--json"])).stdout).health, "online");
	assert.equal(JSON.parse((await run(home, ["preview", "close", preview.id, "--json"])).stdout).removed, true);
	assert.deepEqual(JSON.parse((await run(home, ["preview", "list", "--session", "ps_cli_preview", "--json"])).stdout), []);
});

test("preview CLI exposes only a running labeled Pibo compute worker in dev-auth mode", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-worker-cli-"));
	const fakeBin = join(home, "bin");
	const workerWorkspace = join(home, "worker-worktree");
	const inspectPath = join(home, "docker-inspect.json");
	mkdirSync(fakeBin);
	mkdirSync(workerWorkspace);
	const upstream = createServer((_req, res) => res.end("worker"));
	const port = await listen(upstream);
	t.after(async () => {
		await close(upstream);
		rmSync(home, { recursive: true, force: true });
	});
	const sessionStore = new PiboDataSessionStore(join(home, "pibo.sqlite"));
	sessionStore.create({ id: "ps_cli_worker", channel: "web", kind: "chat", profile: "base", workspace: home });
	sessionStore.close();
	await run(home, ["config", "set", "preview.baseURL", "https://preview.example.test"]);

	writeFileSync(inspectPath, JSON.stringify([{
		Id: "worker-id",
		Name: "/pibo-dev-cli-worker",
		Config: { Labels: {
			"pibo.compute.role": "dev",
			"pibo.compute.port.web": String(port),
			"pibo.compute.worktreePath": workerWorkspace,
		} },
		State: { Status: "running", Running: true },
		NetworkSettings: { Ports: { "4788/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }] } },
	}]));
	const dockerPath = join(fakeBin, "docker");
	writeFileSync(dockerPath, `#!/bin/sh
case "$1" in
  ps)
    case "$*" in
      *pibo.compute.role=dev*) printf 'worker-id\\tpibo-dev-cli-worker\\trunning\\tUp\\t127.0.0.1:${port}->4788/tcp\\tpibo.compute.role=dev,pibo.compute.port.web=${port},pibo.compute.worktreePath=${workerWorkspace}\\n' ;;
    esac
    ;;
  inspect) cat "$PIBO_FAKE_DOCKER_INSPECT" ;;
  *) exit 1 ;;
esac
`);
	chmodSync(dockerPath, 0o755);
	const dockerEnv = {
		PATH: `${fakeBin}:${process.env.PATH}`,
		PIBO_FAKE_DOCKER_INSPECT: inspectPath,
	};

	const discovery = await run(home, ["preview"], dockerEnv);
	assert.match(discovery.stdout, /expose-worker <id>/);
	const exposed = JSON.parse((await run(home, [
		"preview", "expose-worker", "pibo-dev-cli-worker",
		"--session", "ps_cli_worker",
		"--name", "Worker fixture",
		"--json",
	], dockerEnv)).stdout);
	assert.equal(exposed.proxyMode, "pibo-compute-dev-auth");
	assert.equal(exposed.targetPort, port);
	assert.equal(exposed.workspace, workerWorkspace);
	assert.equal(exposed.health, "online");
	assert.equal(JSON.parse((await run(home, ["preview", "show", exposed.id, "--json"], dockerEnv)).stdout).proxyMode, "pibo-compute-dev-auth");
	await assert.rejects(
		run(home, ["preview", "expose-worker", "missing-worker", "--session", "ps_cli_worker"], dockerEnv),
		/was not found/,
	);
	assert.equal(JSON.parse((await run(home, ["preview", "remove", exposed.id, "--json"], dockerEnv)).stdout).removed, true);
});

test("preview CLI starts, stops, restarts, and removes a detached managed server", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-managed-cli-"));
	const probe = createServer((_req, res) => res.end("probe"));
	const port = await listen(probe);
	await close(probe);
	let managedPreviewId;
	t.after(async () => {
		if (managedPreviewId) await run(home, ["preview", "remove", managedPreviewId, "--json"]).catch(() => undefined);
		rmSync(home, { recursive: true, force: true });
	});
	const sessionStore = new PiboDataSessionStore(join(home, "pibo.sqlite"));
	sessionStore.create({ id: "ps_cli_managed", channel: "web", kind: "chat", profile: "base", workspace: home });
	sessionStore.close();
	await run(home, ["config", "set", "preview.baseURL", "https://preview.example.test"]);

	const childScript = "require('node:http').createServer((_q,r)=>r.end('managed')).listen(Number(process.env.PIBO_PREVIEW_PORT),'127.0.0.1')";
	const parentScript = `const { spawn } = require('node:child_process'); spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
	const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(parentScript)}`;
	const created = JSON.parse((await run(home, ["preview", "expose", String(port), "--session", "ps_cli_managed", "--command", command, "--json"])).stdout);
	managedPreviewId = created.id;
	assert.equal(created.managed, true);
	assert.equal(created.serverState, "running");
	assert.equal(created.health, "online");
	assert.ok(created.serverStopAt);

	const stopped = JSON.parse((await run(home, ["preview", "stop", created.id, "--json"])).stdout);
	assert.equal(stopped.serverState, "stopped");
	assert.equal(stopped.health, "stopped");
	const restarted = JSON.parse((await run(home, ["preview", "start", created.id, "--json"])).stdout);
	assert.equal(restarted.serverState, "running");
	assert.equal(restarted.health, "online");
	const removed = JSON.parse((await run(home, ["preview", "remove", created.id, "--json"])).stdout);
	assert.equal(removed.removed, true);
});

test("preview CLI can remove an ownerless error after managed launch failure", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pibo-preview-failed-cli-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const sessionStore = new PiboDataSessionStore(join(home, "pibo.sqlite"));
	sessionStore.create({ id: "ps_cli_failed", channel: "web", kind: "chat", profile: "base", workspace: home });
	sessionStore.close();
	await run(home, ["config", "set", "preview.baseURL", "https://preview.example.test"]);
	const probe = createServer();
	const port = await listen(probe);
	await close(probe);

	await assert.rejects(
		run(home, ["preview", "expose", String(port), "--session", "ps_cli_failed", "--command", `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.exit(1)")}`, "--json"]),
		/Managed Preview command exited before opening its port/,
	);
	const [failed] = JSON.parse((await run(home, ["preview", "list", "--session", "ps_cli_failed", "--json"])).stdout);
	assert.equal(failed.serverState, "error");
	assert.equal(JSON.parse((await run(home, ["preview", "remove", failed.id, "--json"])).stdout).removed, true);
});
