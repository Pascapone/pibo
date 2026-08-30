import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { createInstallationPlan } from "../dist/setup/installation-profiles.js";

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
}

function close(server) {
	return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
	const server = createServer();
	const port = await listen(server);
	await close(server);
	return port;
}

function waitForOpen(url, headers) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

function rejectedWebSocketStatus(url) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.once("unexpected-response", (_request, response) => {
			socket.terminate();
			resolve(response.statusCode);
		});
		socket.once("open", () => {
			socket.terminate();
			reject(new Error("unauthenticated WebSocket unexpectedly opened"));
		});
		socket.once("error", (error) => {
			if (!/Unexpected server response/.test(error.message)) reject(error);
		});
	});
}

test("BI proxy plan places the Pibo auth gate before HTTP and WebSocket forwarding", () => {
	const plan = createInstallationPlan({ profile: "batteries-included", domain: "pibo.example.com" });
	const caddy = plan.files.find((file) => file.path === "/etc/caddy/Caddyfile").content;
	const routeStart = caddy.indexOf("handle_path /apps/vscode/*");
	const authGate = caddy.indexOf("forward_auth 127.0.0.1:4788", routeStart);
	const upstream = caddy.indexOf("reverse_proxy 127.0.0.1:4790", routeStart);
	const fallback = caddy.indexOf("handle {", routeStart);
	assert.ok(routeStart >= 0);
	assert.ok(authGate > routeStart);
	assert.ok(upstream > authGate);
	assert.ok(fallback > upstream);
	assert.match(caddy, /forward_auth 127\.0\.0\.1:4788 \{[\s\S]*header_up -Connection[\s\S]*header_up -Upgrade/);
	assert.doesNotMatch(caddy, /header_up (?:Host|Origin)/);
	assert.match(caddy, /header_down \+Content-Security-Policy "frame-ancestors 'self'"/);
	assert.doesNotMatch(caddy, /(?:0\.0\.0\.0|\[::\]):4790/);
});

const caddyAvailable = spawnSync("caddy", ["version"], { stdio: "ignore" }).status === 0;

test("generated BI proxy rejects unauthenticated HTTP and WebSockets and forwards authenticated traffic", { skip: !caddyAvailable, timeout: 20_000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-caddy-proxy-"));
	let authUpgradeRequests = 0;
	const authServer = createServer((request, response) => {
		if (new URL(request.url, "http://setup.test").pathname !== "/api/chat/bootstrap") {
			response.writeHead(404).end();
			return;
		}
		if (request.headers.cookie !== "session=ok") {
			response.writeHead(401).end("authentication required");
			return;
		}
		response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
	});
	authServer.on("upgrade", (_request, socket) => {
		authUpgradeRequests += 1;
		socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
	});
	const upstreamServer = createServer((_request, response) => response.writeHead(200, { "content-type": "text/plain" }).end("workbench-ready"));
	const webSockets = new WebSocketServer({ server: upstreamServer });
	let caddy;
	try {
		const authPort = await listen(authServer);
		const upstreamPort = await listen(upstreamServer);
		const proxyPort = await freePort();
		const plan = createInstallationPlan({ profile: "batteries-included" });
		const generated = plan.files.find((file) => file.path === "/etc/caddy/Caddyfile").content;
		const config = generated
			.replace("http://127.0.0.1:8080 {", `http://127.0.0.1:${proxyPort} {`)
			.replaceAll("127.0.0.1:4788", `127.0.0.1:${authPort}`)
			.replaceAll("127.0.0.1:4790", `127.0.0.1:${upstreamPort}`);
		const configPath = join(dir, "Caddyfile");
		writeFileSync(configPath, config);
		assert.equal(spawnSync("caddy", ["validate", "--config", configPath], { encoding: "utf8" }).status, 0);
		caddy = spawn("caddy", ["run", "--config", configPath], { stdio: ["ignore", "ignore", "pipe"] });
		const log = [];
		caddy.stderr.on("data", (chunk) => log.push(chunk));
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				await fetch(`http://127.0.0.1:${proxyPort}/apps/vscode/`, { redirect: "manual" });
				break;
			} catch {
				await delay(50);
			}
		}

		const rejectedHttp = await fetch(`http://127.0.0.1:${proxyPort}/apps/vscode/?folder=/workspace`, { redirect: "manual" });
		assert.equal(rejectedHttp.status, 401);
		const acceptedHttp = await fetch(`http://127.0.0.1:${proxyPort}/apps/vscode/?folder=/workspace`, { headers: { cookie: "session=ok" } });
		assert.equal(acceptedHttp.status, 200);
		assert.equal(await acceptedHttp.text(), "workbench-ready");

		assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${proxyPort}/apps/vscode/ws?reconnectionToken=test`), 401);
		const socket = await waitForOpen(`ws://127.0.0.1:${proxyPort}/apps/vscode/ws?reconnectionToken=test`, { cookie: "session=ok" });
		assert.equal(socket.readyState, WebSocket.OPEN);
		socket.close();
		assert.equal(authUpgradeRequests, 0, "auth subrequests must strip WebSocket upgrade headers");
		assert.equal(caddy.exitCode, null, Buffer.concat(log).toString("utf8"));
	} finally {
		if (caddy && caddy.exitCode === null) caddy.kill("SIGTERM");
		webSockets.close();
		await Promise.all([close(authServer), close(upstreamServer)]);
		rmSync(dir, { recursive: true, force: true });
	}
});
