import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPreviewWebApp } from "../dist/previews/web-app.js";
import { findPreviewTargetProcess } from "../dist/previews/network.js";
import { PreviewStore } from "../dist/previews/store.js";
import { createWebHostChannel } from "../dist/web/channel.js";

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve(server.address().port);
		});
	});
}

function close(server) {
	return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request({ port, host, path = "/", method = "GET", headers = {}, body }) {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host, ...headers } }, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => resolve({
				status: response.statusCode,
				headers: response.headers,
				body: Buffer.concat(chunks).toString("utf8"),
			}));
		});
		req.once("error", reject);
		if (body !== undefined) req.end(body);
		else req.end();
	});
}

function openStreamingRequest({ port, host, path, headers = {} }) {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: "127.0.0.1", port, path, headers: { host, ...headers } });
		req.once("error", reject);
		req.once("response", (response) => {
			response.once("error", reject);
			response.once("data", () => resolve({ req, response }));
		});
		req.end();
	});
}

function waitForSseEvent(response, eventName, timeoutMs = 2_000) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for SSE event ${eventName}`));
		}, timeoutMs);
		const onData = (chunk) => {
			buffer += chunk.toString("utf8");
			let boundary;
			while ((boundary = buffer.indexOf("\n\n")) >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = frame.match(/^event: (.+)$/m)?.[1];
				const data = frame.match(/^data: (.+)$/m)?.[1];
				if (event === eventName && data) {
					cleanup();
					resolve(JSON.parse(data));
					return;
				}
			}
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timeout);
			response.off("data", onData);
			response.off("error", onError);
		};
		response.on("data", onData);
		response.on("error", onError);
	});
}

function openUpgradeSocket({ port, host, cookie }) {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: "127.0.0.1", port });
		let received = "";
		socket.once("error", reject);
		socket.on("data", (chunk) => {
			received += chunk.toString("utf8");
			if (!received.includes("\r\n\r\n")) return;
			resolve({ socket, response: received });
		});
		socket.once("connect", () => {
			socket.write([
				"GET /hmr HTTP/1.1",
				`Host: ${host}`,
				"Connection: Upgrade",
				"Upgrade: websocket",
				"Sec-WebSocket-Version: 13",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				`Cookie: ${cookie}`,
				"",
				"",
			].join("\r\n"));
		});
	});
}

function rawHttp({ port, lines }) {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: "127.0.0.1", port });
		let received = "";
		socket.once("error", reject);
		socket.on("data", (chunk) => { received += chunk.toString("utf8"); });
		socket.once("close", () => resolve(received));
		socket.once("connect", () => socket.end(`${lines.join("\r\n")}\r\n\r\n`));
	});
}

async function waitForPreviewAdmission(input) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const response = await request(input);
		if (response.status !== 503) return response;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Preview admission was not released");
}

function ticketFromHtml(html) {
	const match = html.match(/name="ticket" value="([^"]+)"/);
	assert.ok(match, "expected one-time preview ticket");
	return match[1];
}

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function rawUpgrade({ port, host, cookie }) {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: "127.0.0.1", port });
		let received = Buffer.alloc(0);
		let sentProbe = false;
		socket.once("error", reject);
		socket.on("data", (chunk) => {
			received = Buffer.concat([received, chunk]);
			const text = received.toString("utf8");
			if (!sentProbe && text.includes("\r\n\r\n")) {
				assert.match(text, /^HTTP\/1\.1 101 /);
				sentProbe = true;
				socket.write("preview-probe");
				return;
			}
			if (sentProbe && text.includes("preview-probe")) {
				socket.once("close", () => resolve(text));
				socket.destroy();
			}
		});
		socket.once("connect", () => {
			socket.write([
				"GET /hmr HTTP/1.1",
				`Host: ${host}`,
				"Connection: Upgrade",
				"Upgrade: websocket",
				"Sec-WebSocket-Version: 13",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				`Cookie: ${cookie}`,
				"",
				"",
			].join("\r\n"));
		});
	});
}

function fakeAuth() {
	return {
		name: "preview-test-auth",
		async getSession(headers) {
			const userId = headers.get("x-test-user");
			return userId ? { identity: { userId, email: `${userId}@example.test` } } : undefined;
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw new Error("Unauthenticated");
			return session;
		},
	};
}

test("Preview event stream emits only previews created after subscription for its Pibo Session", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-events-"));
	const databasePath = join(dir, "previews.sqlite");
	const upstream = createServer((_req, res) => res.end("preview"));
	const upstreamPort = await listen(upstream);
	const targetProcess = findPreviewTargetProcess("127.0.0.1", upstreamPort);
	assert.ok(targetProcess);
	const createExposure = (id, piboSessionId) => {
		const store = new PreviewStore(databasePath);
		try {
			store.createExposure({
				id,
				piboSessionId,
				label: id,
				targetHost: "127.0.0.1",
				targetPort: upstreamPort,
				targetProcessId: targetProcess.pid,
				targetProcessStartTicks: targetProcess.startTicks,
				workspace: dir,
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
		} finally {
			store.close();
		}
	};
	createExposure("pv-existing", "ps_selected");
	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		piboBaseURL: "http://pibo.localhost",
		databasePath,
		eventPollIntervalMs: 20,
		reaperIntervalMs: false,
	});
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	await channel.start({
		auth: fakeAuth(),
		getWebApps: () => [app],
		emit() { throw new Error("not used"); },
		subscribe() { return () => undefined; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
	});
	const webPort = channel.getAddress().port;
	t.after(async () => {
		await channel.stop();
		await close(upstream);
		rmSync(dir, { recursive: true, force: true });
	});

	const stream = await openStreamingRequest({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/events?piboSessionId=ps_selected",
		headers: { "x-test-user": "account-a" },
	});
	const createdEvent = waitForSseEvent(stream.response, "preview-created");
	createExposure("pv-other-session", "ps_other");
	createExposure("pv-created", "ps_selected");
	const event = await createdEvent;
	assert.equal(event.type, "preview-created");
	assert.equal(event.preview.id, "pv-created");
	assert.equal(event.preview.piboSessionId, "ps_selected");
	assert.equal(event.preview.openUrl, "/api/previews/pv-created/open");
	stream.response.destroy();
	stream.req.destroy();
});

test("authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-web-"));
	const databasePath = join(dir, "previews.sqlite");
	let upstreamCookie;
	let upstreamHeaders;
	let upstreamUpgradeHeaders;
	const upgradedSockets = new Set();
	const upstream = createServer((req, res) => {
		upstreamCookie = req.headers.cookie;
		upstreamHeaders = req.headers;
		if (req.url === "/api/auth/session") {
			if (req.headers["x-forwarded-host"]) {
				res.writeHead(403, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "Dev auth only accepts loopback requests" }));
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ identity: { userId: "dev-user-001", email: "dev@pibo.local", provider: "dev" } }));
			return;
		}
		if (req.url === "/redirect") {
			res.writeHead(302, { location: `http://127.0.0.1:${upstream.address().port}/next` });
			res.end();
			return;
		}
		if (req.url === "/redirect-other-loopback") {
			res.writeHead(302, { location: "http://127.0.0.1:9/private" });
			res.end();
			return;
		}
		if (req.url === "/sse") {
			res.writeHead(200, { "content-type": "text/event-stream", "x-frame-options": "DENY" });
			res.end("data: preview-ready\n\n");
			return;
		}
		if (req.url === "/sse-hold") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write("data: held\n\n");
			return;
		}
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"x-frame-options": "DENY",
			"content-security-policy": "default-src 'self'; frame-ancestors 'none'",
			"set-cookie": [
				"app_session=ok; Domain=127.0.0.1; Path=/",
				"pibo_machine_session=should-not-escape; Path=/",
				"__Host-pibo_preview_session=should-not-escape; Path=/; Secure",
			],
			"x-pibo-secret": "should-not-escape",
		});
		res.end(`preview:${req.url}`);
	});
	upstream.on("upgrade", (request, socket) => {
		upstreamUpgradeHeaders = request.headers;
		upgradedSockets.add(socket);
		socket.once("close", () => upgradedSockets.delete(socket));
		socket.write([
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			"Set-Cookie: ws_app=ok; Domain=127.0.0.1; Path=/",
			"Set-Cookie: pibo_dev_session=should-not-escape; Path=/",
			"X-Pibo-Secret: should-not-escape",
			"",
			"",
		].join("\r\n"));
		socket.on("data", (chunk) => socket.write(chunk));
	});
	const upstreamPort = await listen(upstream);
	const targetProcess = findPreviewTargetProcess("127.0.0.1", upstreamPort);
	assert.ok(targetProcess, "fixture listener must be pinnable");
	const store = new PreviewStore(databasePath);
	store.createExposure({
		id: "pv-webfixture",
		piboSessionId: "ps_preview_web",
		label: "Fixture",
		targetHost: "127.0.0.1",
		targetPort: upstreamPort,
		targetProcessId: targetProcess.pid,
		targetProcessStartTicks: targetProcess.startTicks,
		workspace: dir,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	store.createExposure({
		id: "pv-worker-auth",
		piboSessionId: "ps_preview_worker",
		label: "Worker auth fixture",
		targetHost: "127.0.0.1",
		targetPort: upstreamPort,
		targetProcessId: targetProcess.pid,
		targetProcessStartTicks: targetProcess.startTicks,
		workspace: dir,
		proxyMode: "pibo-compute-dev-auth",
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	const secretPortProbe = createServer();
	const secretTargetPort = await listen(secretPortProbe);
	await close(secretPortProbe);
	store.createExposure({
		id: "pv-managed-secret",
		piboSessionId: "ps_preview_managed_web",
		label: "Managed secret fixture",
		targetHost: "127.0.0.1",
		targetPort: secretTargetPort,
		workspace: "/secret/workspace",
		managementMode: "managed",
		startCommand: "secret-preview-command --serve",
		serverState: "stopped",
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	store.createExposure({
		id: "pv-expired-tls",
		piboSessionId: "ps_preview_web",
		label: "Expired TLS fixture",
		targetHost: "127.0.0.1",
		targetPort: secretTargetPort,
		workspace: dir,
		createdAt: new Date(Date.now() - 120_000).toISOString(),
		expiresAt: new Date(Date.now() - 60_000).toISOString(),
	});
	store.close();

	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		piboBaseURL: "http://pibo.localhost",
		databasePath,
		maxProxyConnections: 1,
		maxProxyConnectionsPerPreview: 1,
	});
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	await channel.start({
		auth: fakeAuth(),
		getWebApps: () => [app],
		emit() { throw new Error("not used"); },
		subscribe() { return () => undefined; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
	});
	const webPort = channel.getAddress().port;
	t.after(async () => {
		for (const socket of upgradedSockets) socket.destroy();
		await channel.stop();
		await close(upstream);
		rmSync(dir, { recursive: true, force: true });
	});

	const unauthenticated = await request({ port: webPort, host: `pibo.localhost:${webPort}`, path: "/api/previews?piboSessionId=ps_preview_web" });
	assert.equal(unauthenticated.status, 401);
	assert.equal((await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/tls-authorize?domain=pv-webfixture.preview.localhost",
	})).status, 200);
	assert.equal((await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/tls-authorize?domain=pv-unknown.preview.localhost",
	})).status, 403);
	assert.equal((await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/tls-authorize?domain=pv-expired-tls.preview.localhost",
	})).status, 403);
	assert.equal((await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/tls-authorize?domain=nested.pv-webfixture.preview.localhost",
	})).status, 403);
	const previewHost = `pv-webfixture.preview.localhost:${webPort}`;
	assert.equal((await request({ port: webPort, host: previewHost })).status, 401);

	for (const user of ["account-a", "account-b"]) {
		const opened = await request({
			port: webPort,
			host: `pibo.localhost:${webPort}`,
			path: "/api/previews/pv-webfixture/open",
			headers: { "x-test-user": user },
		});
		assert.equal(opened.status, 200);
		assert.match(opened.body, /method="post"/);
	}
	const listed = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews?piboSessionId=ps_preview_web",
		headers: { "x-test-user": "account-a" },
	});
	const listedBody = JSON.parse(listed.body);
	assert.equal("workspace" in listedBody.previews[0], false);
	assert.equal("targetProcessId" in listedBody.previews[0], false);
	assert.equal("targetHost" in listedBody.previews[0], false);
	assert.equal("targetPort" in listedBody.previews[0], false);
	assert.equal("proxyMode" in listedBody.previews[0], false);
	const listedWorker = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews?piboSessionId=ps_preview_worker",
		headers: { "x-test-user": "account-a" },
	});
	assert.equal("proxyMode" in JSON.parse(listedWorker.body).previews[0], false);

	const opened = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/pv-webfixture/open",
		headers: { "x-test-user": "account-a" },
	});
	const exchange = await request({
		port: webPort,
		host: previewHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: ticketFromHtml(opened.body) }).toString(),
	});
	assert.equal(exchange.status, 303);
	const sessionCookie = exchange.headers["set-cookie"][0].split(";")[0];
	assert.match(sessionCookie, /^pibo_preview_session=/);

	const page = await request({
		port: webPort,
		host: previewHost,
		headers: {
			cookie: `${sessionCookie}; better-auth.session_token=secret; pibo_machine_session=machine-secret; app_cookie=visible`,
			authorization: "Bearer pibo-secret",
			"x-pibo-machine-key": "pibo-secret",
			"x-auth-request-user": "pibo-identity",
			"cf-access-jwt-assertion": "pibo-identity-token",
			origin: `http://${previewHost}`,
			referer: `http://${previewHost}/from`,
		},
	});
	assert.equal(page.status, 200);
	assert.equal(page.body, "preview:/");
	assert.equal(upstreamCookie, "app_cookie=visible");
	assert.equal(upstreamHeaders.authorization, undefined);
	assert.equal(upstreamHeaders["x-pibo-machine-key"], undefined);
	assert.equal(upstreamHeaders["x-auth-request-user"], undefined);
	assert.equal(upstreamHeaders["cf-access-jwt-assertion"], undefined);
	assert.equal(upstreamHeaders.host, `127.0.0.1:${upstreamPort}`);
	assert.equal(upstreamHeaders["x-forwarded-host"], previewHost);
	assert.equal(upstreamHeaders["x-forwarded-proto"], "http");
	assert.equal(upstreamHeaders.origin, `http://127.0.0.1:${upstreamPort}/`);
	assert.equal(upstreamHeaders.referer, `http://127.0.0.1:${upstreamPort}/from`);
	assert.equal(page.headers["x-frame-options"], undefined);
	assert.equal(page.headers["x-pibo-secret"], undefined);
	assert.match(page.headers["content-security-policy"], /frame-ancestors http:\/\/pibo\.localhost/);
	assert.deepEqual(page.headers["set-cookie"], ["app_session=ok; Path=/"]);

	const workerHost = `pv-worker-auth.preview.localhost:${webPort}`;
	const workerOpened = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/api/previews/pv-worker-auth/open",
		headers: { "x-test-user": "account-a" },
	});
	const workerExchange = await request({
		port: webPort,
		host: workerHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: ticketFromHtml(workerOpened.body) }).toString(),
	});
	assert.equal(workerExchange.status, 303);
	const workerCookie = workerExchange.headers["set-cookie"][0].split(";")[0];
	const workerSession = await request({
		port: webPort,
		host: workerHost,
		path: "/api/auth/session",
		headers: { cookie: workerCookie, origin: `http://${workerHost}` },
	});
	assert.equal(workerSession.status, 200);
	assert.equal(JSON.parse(workerSession.body).identity.email, "dev@pibo.local");
	assert.equal(upstreamHeaders.host, `127.0.0.1:${upstreamPort}`);
	assert.equal(upstreamHeaders["x-forwarded-host"], undefined);
	assert.equal(upstreamHeaders["x-forwarded-proto"], undefined);
	assert.equal(upstreamHeaders.origin, `http://127.0.0.1:${upstreamPort}/`);
	const workerUpgraded = await rawUpgrade({ port: webPort, host: workerHost, cookie: workerCookie });
	assert.match(workerUpgraded, /preview-probe/);
	assert.equal(upstreamUpgradeHeaders.host, `127.0.0.1:${upstreamPort}`);
	assert.equal(upstreamUpgradeHeaders["x-forwarded-host"], undefined);
	assert.equal(upstreamUpgradeHeaders["x-forwarded-proto"], undefined);

	const malformedOrigin = await request({
		port: webPort,
		host: previewHost,
		path: "/malformed-origin",
		headers: { cookie: sessionCookie, origin: "http://[::1", referer: "not a URL" },
	});
	assert.equal(malformedOrigin.status, 200);
	assert.equal(upstreamHeaders.origin, undefined);
	assert.equal(upstreamHeaders.referer, undefined);
	const malformedHost = await rawHttp({
		port: webPort,
		lines: ["GET / HTTP/1.1", `Host: ${previewHost},evil.example`, `Cookie: ${sessionCookie}`, "Connection: close"],
	});
	assert.doesNotMatch(malformedHost, /preview:\//);

	const redirected = await request({ port: webPort, host: previewHost, path: "/redirect", headers: { cookie: sessionCookie } });
	assert.equal(redirected.headers.location, `http://pv-webfixture.preview.localhost:${webPort}/next`);
	const blockedRedirect = await request({ port: webPort, host: previewHost, path: "/redirect-other-loopback", headers: { cookie: sessionCookie } });
	assert.equal(blockedRedirect.headers.location, undefined);

	const sse = await request({ port: webPort, host: previewHost, path: "/sse", headers: { cookie: sessionCookie } });
	assert.equal(sse.status, 200);
	assert.equal(sse.body, "data: preview-ready\n\n");
	const heldSse = await openStreamingRequest({ port: webPort, host: previewHost, path: "/sse-hold", headers: { cookie: sessionCookie } });
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: sessionCookie } })).status, 503);
	const heldSseClosed = once(heldSse.response, "close");
	heldSse.response.destroy();
	heldSse.req.destroy();
	await heldSseClosed;
	assert.equal((await waitForPreviewAdmission({ port: webPort, host: previewHost, headers: { cookie: sessionCookie } })).status, 200);

	const upgraded = await rawUpgrade({ port: webPort, host: previewHost, cookie: sessionCookie });
	assert.match(upgraded, /preview-probe/);
	assert.match(upgraded, /set-cookie: ws_app=ok; Path=\//i);
	assert.doesNotMatch(upgraded, /pibo_dev_session|x-pibo-secret/i);
	assert.equal((await waitForPreviewAdmission({ port: webPort, host: previewHost, headers: { cookie: sessionCookie } })).status, 200);
	const heldUpgrade = await openUpgradeSocket({ port: webPort, host: previewHost, cookie: sessionCookie });
	assert.match(heldUpgrade.response, /^HTTP\/1\.1 101 /);
	const rejectedUpgrade = await openUpgradeSocket({ port: webPort, host: previewHost, cookie: sessionCookie });
	assert.match(rejectedUpgrade.response, /^HTTP\/1\.1 503 /);
	rejectedUpgrade.socket.destroy();
	const heldUpgradeClosed = once(heldUpgrade.socket, "close");
	heldUpgrade.socket.destroy();
	await heldUpgradeClosed;
	assert.equal((await waitForPreviewAdmission({ port: webPort, host: previewHost, headers: { cookie: sessionCookie } })).status, 200);

	const forwardedProxyRequest = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/",
		headers: { "x-forwarded-host": previewHost, "x-forwarded-proto": "http", cookie: sessionCookie },
	});
	assert.equal(forwardedProxyRequest.body, "preview:/");
	const malformedForwardedHost = await request({
		port: webPort,
		host: `pibo.localhost:${webPort}`,
		path: "/",
		headers: { "x-forwarded-host": `${previewHost},evil.example`, "x-forwarded-proto": "http", cookie: sessionCookie },
	});
	assert.notEqual(malformedForwardedHost.body, "preview:/");
	for (const headers of [
		{ "x-forwarded-host": previewHost, "x-forwarded-proto": "javascript", cookie: sessionCookie },
		{ "x-forwarded-proto": "http", cookie: sessionCookie },
	]) {
		const malformedForwardingPair = await request({ port: webPort, host: previewHost, path: "/", headers });
		assert.notEqual(malformedForwardingPair.body, "preview:/");
	}

	const replay = await request({
		port: webPort,
		host: previewHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: ticketFromHtml(opened.body) }).toString(),
	});
	assert.equal(replay.status, 401);
});


test("Preview lifecycle API starts, stops, and removes managed servers without exposing commands", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-managed-web-"));
	const databasePath = join(dir, "previews.sqlite");
	const portProbe = createServer();
	const targetPort = await listen(portProbe);
	await close(portProbe);
	const store = new PreviewStore(databasePath);
	store.createExposure({
		id: "pv-managed-web",
		piboSessionId: "ps_preview_managed_web",
		label: "Managed fixture",
		targetHost: "127.0.0.1",
		targetPort,
		workspace: "/secret/workspace",
		managementMode: "managed",
		startCommand: "secret-preview-command --serve",
		serverState: "stopped",
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	store.createExposure({
		id: "pv-managed-secret",
		piboSessionId: "ps_preview_managed_web",
		label: "Managed failure fixture",
		targetHost: "127.0.0.1",
		targetPort,
		workspace: "/secret/workspace",
		managementMode: "managed",
		startCommand: "secret-preview-command --serve",
		serverState: "stopped",
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	store.close();

	let sequence = 0;
	const servers = new Map();
	const upgradedSockets = new Set();
	const controller = {
		createIdentity() {
			return { kind: "process", id: `managed-web-${++sequence}` };
		},
		async launch(input, identity) {
			if (input.previewId === "pv-managed-secret") {
				throw new Error(`failed command: ${input.command} in ${input.workspace}`);
			}
			const server = createServer((request, response) => {
				if (request.url === "/sse") {
					response.writeHead(200, { "content-type": "text/event-stream" });
					response.end("data: managed-web\n\n");
					return;
				}
				response.end("managed-web");
			});
			server.on("upgrade", (_request, socket) => {
				upgradedSockets.add(socket);
				socket.once("close", () => upgradedSockets.delete(socket));
				socket.write([
					"HTTP/1.1 101 Switching Protocols",
					"Upgrade: websocket",
					"Connection: Upgrade",
					"",
					"",
				].join("\r\n"));
				socket.on("data", (chunk) => socket.write(chunk));
			});
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(input.port, "127.0.0.1", resolve);
			});
			const id = identity.id;
			servers.set(id, server);
			return { kind: "process", id };
		},
		async isRunning(identity) { return servers.has(identity.id); },
		async ownsTarget(identity) { return servers.has(identity.id); },
		async stop(identity) {
			const server = servers.get(identity.id);
			if (!server) return;
			servers.delete(identity.id);
			await close(server);
		},
	};
	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		databasePath,
		reaperIntervalMs: false,
		managerOptions: {
			controller,
			settings: { maxRunningServers: 3, autoStopMinutes: 10 },
			startupTimeoutMs: 2_000,
			pollIntervalMs: 10,
		},
	});
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	await channel.start({
		auth: fakeAuth(),
		getWebApps: () => [app],
		emit() { throw new Error("not used"); },
		subscribe() { return () => undefined; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
	});
	const webPort = channel.getAddress().port;
	const piboHost = `pibo.localhost:${webPort}`;
	const origin = `http://${piboHost}`;
	t.after(async () => {
		for (const socket of upgradedSockets) socket.destroy();
		for (const [id] of [...servers]) await controller.stop({ kind: "process", id });
		await channel.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	const listed = JSON.parse((await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews?piboSessionId=ps_preview_managed_web",
		headers: { "x-test-user": "account-a" },
	})).body).previews[0];
	assert.equal(listed.health, "stopped");
	assert.equal(listed.managed, true);
	for (const sensitive of ["startCommand", "workspace", "serverError", "serverGeneration", "managerId", "managerPid", "targetProcessId"]) {
		assert.equal(sensitive in listed, false, `${sensitive} must not be sent to the browser`);
	}

	const missingOrigin = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/start",
		method: "POST",
		headers: { "x-test-user": "account-a" },
	});
	assert.equal(missingOrigin.status, 403);

	const failedSecretStart = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-secret/start",
		method: "POST",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(failedSecretStart.status, 409);
	assert.equal(JSON.parse(failedSecretStart.body).error, "Preview server operation failed");
	assert.doesNotMatch(failedSecretStart.body, /secret-preview-command|secret\/workspace/);
	const removedFailedStart = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-secret",
		method: "DELETE",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(removedFailedStart.status, 200);
	assert.equal(JSON.parse(removedFailedStart.body).removed, true);

	const startedResponse = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/start",
		method: "POST",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(startedResponse.status, 200);
	const started = JSON.parse(startedResponse.body).preview;
	assert.equal(started.health, "online");
	assert.equal(started.serverState, "running");
	assert.ok(started.serverStopAt);
	assert.equal("startCommand" in started, false);
	let generationStore = new PreviewStore(databasePath);
	const firstGeneration = generationStore.requireExposure("pv-managed-web").serverGeneration;
	generationStore.close();
	assert.ok(firstGeneration);
	const previewHost = `pv-managed-web.preview.localhost:${webPort}`;
	const opened = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/open",
		headers: { "x-test-user": "account-a" },
	});
	const exchange = await request({
		port: webPort,
		host: previewHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: ticketFromHtml(opened.body) }).toString(),
	});
	assert.equal(exchange.status, 303);
	const oldCookie = exchange.headers["set-cookie"][0].split(";")[0];
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: oldCookie } })).status, 200);
	const unexchangedBeforeStop = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/open",
		headers: { "x-test-user": "account-a" },
	});
	const staleTicket = ticketFromHtml(unexchangedBeforeStop.body);

	const stoppedResponse = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/stop",
		method: "POST",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(stoppedResponse.status, 200);
	assert.equal(JSON.parse(stoppedResponse.body).preview.health, "stopped");
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: oldCookie } })).status, 401);

	const restartedResponse = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/start",
		method: "POST",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(restartedResponse.status, 200);
	assert.equal(JSON.parse(restartedResponse.body).preview.health, "online");
	generationStore = new PreviewStore(databasePath);
	const secondGeneration = generationStore.requireExposure("pv-managed-web").serverGeneration;
	generationStore.close();
	assert.ok(secondGeneration);
	assert.notEqual(secondGeneration, firstGeneration);
	for (const path of ["/", "/sse"]) {
		assert.equal((await request({ port: webPort, host: previewHost, path, headers: { cookie: oldCookie } })).status, 401);
	}
	const rejectedOldUpgrade = await openUpgradeSocket({ port: webPort, host: previewHost, cookie: oldCookie });
	assert.match(rejectedOldUpgrade.response, /^HTTP\/1\.1 401 /);
	rejectedOldUpgrade.socket.destroy();
	const staleExchange = await request({
		port: webPort,
		host: previewHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: staleTicket }).toString(),
	});
	assert.equal(staleExchange.status, 401, "a prior-generation ticket must not mint new authority");
	const reopened = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web/open",
		headers: { "x-test-user": "account-a" },
	});
	const freshExchange = await request({
		port: webPort,
		host: previewHost,
		path: "/__pibo/session",
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ticket: ticketFromHtml(reopened.body) }).toString(),
	});
	assert.equal(freshExchange.status, 303);
	const freshCookie = freshExchange.headers["set-cookie"][0].split(";")[0];
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: freshCookie } })).status, 200);
	assert.equal((await request({ port: webPort, host: previewHost, path: "/sse", headers: { cookie: freshCookie } })).body, "data: managed-web\n\n");
	const freshUpgrade = await openUpgradeSocket({ port: webPort, host: previewHost, cookie: freshCookie });
	assert.match(freshUpgrade.response, /^HTTP\/1\.1 101 /);
	freshUpgrade.socket.destroy();
	await Promise.all([...upgradedSockets].map((socket) => new Promise((resolve) => {
		if (socket.destroyed) return resolve();
		socket.once("close", resolve);
		socket.destroy();
	})));

	const removedResponse = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-managed-web",
		method: "DELETE",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(removedResponse.status, 200);
	assert.equal(JSON.parse(removedResponse.body).removed, true);
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: freshCookie } })).status, 401);
	const afterRemoval = JSON.parse((await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews?piboSessionId=ps_preview_managed_web",
		headers: { "x-test-user": "account-a" },
	})).body);
	assert.deepEqual(afterRemoval.previews, []);
});

test("in-flight HTTP, SSE, and WebSocket requests never cross a managed generation rotation", { timeout: 30_000 }, async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-generation-race-"));
	const databasePath = join(dir, "previews.sqlite");
	const firstPortProbe = createServer();
	const firstTargetPort = await listen(firstPortProbe);
	await close(firstPortProbe);
	const createManagedExposure = (targetPort) => {
		const store = new PreviewStore(databasePath);
		store.createExposure({
			id: "pv-generation-race",
			piboSessionId: "ps_preview_generation_race",
			label: "Generation race fixture",
			targetHost: "127.0.0.1",
			targetPort,
			workspace: "/fixture/workspace",
			managementMode: "managed",
			startCommand: "fixture-preview-command --serve",
			serverState: "stopped",
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
		store.close();
	};
	createManagedExposure(firstTargetPort);

	let sequence = 0;
	let barrier;
	const servers = new Map();
	const targetHits = new Map();
	const upgradedSockets = new Set();
	const controller = {
		createIdentity() {
			return { kind: "process", id: `generation-race-${++sequence}` };
		},
		async launch(input, identity) {
			const generationLabel = identity.id;
			const server = createServer((request, response) => {
				targetHits.set(generationLabel, (targetHits.get(generationLabel) ?? 0) + 1);
				if (request.url?.startsWith("/sse")) {
					response.writeHead(200, { "content-type": "text/event-stream" });
					response.end(`data: ${generationLabel}\n\n`);
					return;
				}
				response.end(generationLabel);
			});
			server.on("upgrade", (_request, socket) => {
				targetHits.set(generationLabel, (targetHits.get(generationLabel) ?? 0) + 1);
				upgradedSockets.add(socket);
				socket.once("close", () => upgradedSockets.delete(socket));
				socket.write([
					"HTTP/1.1 101 Switching Protocols",
					"Upgrade: websocket",
					"Connection: Upgrade",
					"",
					"",
				].join("\r\n"));
			});
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(input.port, "127.0.0.1", resolve);
			});
			servers.set(identity.id, server);
			return identity;
		},
		async isRunning(identity) {
			if (barrier?.identity === identity.id && barrier.remaining > 0) {
				barrier.remaining -= 1;
				if (barrier.remaining === 0) barrier.entered.resolve();
				await barrier.release.promise;
			}
			return servers.has(identity.id);
		},
		async isManagerRunning(identity) { return servers.has(identity.id); },
		async ownsTarget(identity) { return servers.has(identity.id); },
		async stop(identity) {
			const server = servers.get(identity.id);
			if (!server) return;
			servers.delete(identity.id);
			await close(server);
		},
	};
	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		databasePath,
		reaperIntervalMs: false,
		managerOptions: {
			controller,
			settings: { maxRunningServers: 3, autoStopMinutes: 10 },
			startupTimeoutMs: 2_000,
			pollIntervalMs: 10,
		},
	});
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	await channel.start({
		auth: fakeAuth(),
		getWebApps: () => [app],
		emit() { throw new Error("not used"); },
		subscribe() { return () => undefined; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
	});
	const webPort = channel.getAddress().port;
	const piboHost = `pibo.localhost:${webPort}`;
	const previewHost = `pv-generation-race.preview.localhost:${webPort}`;
	const origin = `http://${piboHost}`;
	t.after(async () => {
		barrier?.release.resolve();
		for (const socket of upgradedSockets) socket.destroy();
		for (const [id] of [...servers]) await controller.stop({ kind: "process", id });
		await channel.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	const lifecycle = (operation) => request({
		port: webPort,
		host: piboHost,
		path: `/api/previews/pv-generation-race/${operation}`,
		method: "POST",
		headers: { "x-test-user": "account-a", origin },
	});
	const mintCookie = async () => {
		const opened = await request({
			port: webPort,
			host: piboHost,
			path: "/api/previews/pv-generation-race/open",
			headers: { "x-test-user": "account-a" },
		});
		assert.equal(opened.status, 200);
		const exchange = await request({
			port: webPort,
			host: previewHost,
			path: "/__pibo/session",
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ ticket: ticketFromHtml(opened.body) }).toString(),
		});
		assert.equal(exchange.status, 303);
		return exchange.headers["set-cookie"][0].split(";")[0];
	};

	assert.equal((await lifecycle("start")).status, 200);
	const firstIdentity = "generation-race-1";
	const oldCookie = await mintCookie();
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: oldCookie } })).body, firstIdentity);

	const inFlightCount = 6;
	barrier = {
		identity: firstIdentity,
		remaining: inFlightCount,
		entered: deferred(),
		release: deferred(),
	};
	const staleRequests = [
		request({ port: webPort, host: previewHost, path: "/http-a", headers: { cookie: oldCookie } }),
		request({ port: webPort, host: previewHost, path: "/http-b", headers: { cookie: oldCookie } }),
		request({ port: webPort, host: previewHost, path: "/sse", headers: { cookie: oldCookie } }),
		request({ port: webPort, host: previewHost, path: "/sse?retry=2", headers: { cookie: oldCookie } }),
		openUpgradeSocket({ port: webPort, host: previewHost, cookie: oldCookie }),
		openUpgradeSocket({ port: webPort, host: previewHost, cookie: oldCookie }),
	];
	await barrier.entered.promise;
	assert.equal((await lifecycle("stop")).status, 200);
	assert.equal((await lifecycle("start")).status, 200);
	const secondIdentity = "generation-race-2";
	barrier.release.resolve();
	const staleResults = await Promise.all(staleRequests);
	for (const result of staleResults.slice(0, 4)) assert.equal(result.status, 401);
	for (const result of staleResults.slice(4)) {
		assert.match(result.response, /^HTTP\/1\.1 401 /);
		result.socket.destroy();
	}
	assert.equal(targetHits.get(secondIdentity) ?? 0, 0, "generation-A work must never reach generation B");

	const freshCookie = await mintCookie();
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: freshCookie } })).body, secondIdentity);
	assert.match((await request({ port: webPort, host: previewHost, path: "/sse", headers: { cookie: freshCookie } })).body, new RegExp(secondIdentity));
	const freshUpgrade = await openUpgradeSocket({ port: webPort, host: previewHost, cookie: freshCookie });
	assert.match(freshUpgrade.response, /^HTTP\/1\.1 101 /);
	freshUpgrade.socket.destroy();
	await Promise.all([...upgradedSockets].map((socket) => new Promise((resolve) => {
		if (socket.destroyed) return resolve();
		socket.once("close", resolve);
		socket.destroy();
	})));

	const removed = await request({
		port: webPort,
		host: piboHost,
		path: "/api/previews/pv-generation-race",
		method: "DELETE",
		headers: { "x-test-user": "account-a", origin },
	});
	assert.equal(removed.status, 200);
	const secondPortProbe = createServer();
	const secondTargetPort = await listen(secondPortProbe);
	await close(secondPortProbe);
	assert.notEqual(secondTargetPort, firstTargetPort);
	const reopenedStore = new PreviewStore(databasePath);
	reopenedStore.prune(new Date(Date.now() + 31 * 24 * 60 * 60_000));
	assert.equal(reopenedStore.getExposure("pv-generation-race"), undefined);
	reopenedStore.close();
	createManagedExposure(secondTargetPort);
	assert.equal((await lifecycle("start")).status, 200);
	const thirdIdentity = "generation-race-3";
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: freshCookie } })).status, 401);
	const recreatedCookie = await mintCookie();
	assert.equal((await request({ port: webPort, host: previewHost, headers: { cookie: recreatedCookie } })).body, thirdIdentity);
});

test("Preview app disposal waits for an in-flight reaper and preserves exact reconciliation", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-dispose-reaper-"));
	const databasePath = join(dir, "previews.sqlite");
	const store = new PreviewStore(databasePath);
	const now = new Date();
	store.createExposure({
		id: "pv-dispose-reaper",
		piboSessionId: "ps_dispose_reaper",
		label: "Dispose reaper",
		targetHost: "127.0.0.1",
		targetPort: 5173,
		workspace: dir,
		managementMode: "managed",
		startCommand: "node server.js",
		serverState: "stopped",
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60_000).toISOString(),
	});
	const identity = { kind: "process", id: "dispose-reaper-owner" };
	const reserved = store.reserveManagedServerStart(
		"pv-dispose-reaper",
		3,
		now.toISOString(),
		new Date(now.getTime() + 30_000).toISOString(),
		identity,
	).exposure;
	store.markManagedServerRunning(reserved.id, reserved.serverGeneration, {
		targetHost: "127.0.0.1",
		manager: identity,
	});
	store.close();
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const controller = {
		createIdentity() { return identity; },
		async launch() { return identity; },
		async isRunning(candidate) {
			assert.equal(candidate.id, identity.id);
			entered.resolve();
			return release.promise;
		},
		async ownsTarget() { return false; },
		async stop() {},
	};
	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		databasePath,
		reaperIntervalMs: 1_000,
		managerOptions: { controller },
	});
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	await entered.promise;
	let disposed = false;
	const disposing = app.dispose().then(() => { disposed = true; });
	await Promise.resolve();
	assert.equal(disposed, false, "dispose must await the exact in-flight reaper");
	release.resolve(false);
	await disposing;
	const reopened = new PreviewStore(databasePath);
	assert.equal(reopened.requireExposure("pv-dispose-reaper").serverState, "stopped");
	assert.equal(reopened.requireExposure("pv-dispose-reaper").managerId, undefined);
	reopened.close();
});
