import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPreviewWebApp } from "../dist/previews/web-app.js";
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

function ticketFromHtml(html) {
	const match = html.match(/name="ticket" value="([^"]+)"/);
	assert.ok(match, "expected one-time preview ticket");
	return match[1];
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

test("authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-web-"));
	const databasePath = join(dir, "previews.sqlite");
	let upstreamCookie;
	const upgradedSockets = new Set();
	const upstream = createServer((req, res) => {
		upstreamCookie = req.headers.cookie;
		if (req.url === "/redirect") {
			res.writeHead(302, { location: `http://127.0.0.1:${upstream.address().port}/next` });
			res.end();
			return;
		}
		if (req.url === "/sse") {
			res.writeHead(200, { "content-type": "text/event-stream", "x-frame-options": "DENY" });
			res.end("data: preview-ready\n\n");
			return;
		}
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"x-frame-options": "DENY",
			"content-security-policy": "default-src 'self'; frame-ancestors 'none'",
			"set-cookie": "app_session=ok; Domain=127.0.0.1; Path=/",
		});
		res.end(`preview:${req.url}`);
	});
	upstream.on("upgrade", (_req, socket) => {
		upgradedSockets.add(socket);
		socket.once("close", () => upgradedSockets.delete(socket));
		socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
		socket.on("data", (chunk) => socket.write(chunk));
	});
	const upstreamPort = await listen(upstream);
	const store = new PreviewStore(databasePath);
	store.createExposure({
		id: "pv-webfixture",
		piboSessionId: "ps_preview_web",
		label: "Fixture",
		targetHost: "127.0.0.1",
		targetPort: upstreamPort,
		workspace: dir,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	store.close();

	const app = createPreviewWebApp({
		baseURL: "http://preview.localhost",
		piboBaseURL: "http://pibo.localhost",
		databasePath,
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

	const page = await request({ port: webPort, host: previewHost, headers: { cookie: `${sessionCookie}; better-auth.session_token=secret; pibo_machine_session=machine-secret; app_cookie=visible` } });
	assert.equal(page.status, 200);
	assert.equal(page.body, "preview:/");
	assert.equal(upstreamCookie, "app_cookie=visible");
	assert.equal(page.headers["x-frame-options"], undefined);
	assert.match(page.headers["content-security-policy"], /frame-ancestors http:\/\/pibo\.localhost/);
	assert.deepEqual(page.headers["set-cookie"], ["app_session=ok; Path=/"]);

	const redirected = await request({ port: webPort, host: previewHost, path: "/redirect", headers: { cookie: sessionCookie } });
	assert.equal(redirected.headers.location, `http://pv-webfixture.preview.localhost:${webPort}/next`);

	const sse = await request({ port: webPort, host: previewHost, path: "/sse", headers: { cookie: sessionCookie } });
	assert.equal(sse.status, 200);
	assert.equal(sse.body, "data: preview-ready\n\n");

	assert.match(await rawUpgrade({ port: webPort, host: previewHost, cookie: sessionCookie }), /preview-probe/);

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
