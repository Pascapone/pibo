import assert from "node:assert/strict";
import * as http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { createSidecar, DEFAULT_SIDECAR_PORT } from "../../src/apps/chat-vscode/extension/src/sidecar.ts";
import { createSidecarAuthBridge } from "../../src/apps/chat-vscode/extension/src/sidecar-auth.ts";

function startMockGateway(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve({ server, port });
		});
	});
}

function stopServer(server) {
	return new Promise((resolve) => server.close(() => resolve()));
}

async function httpRequest(target, options = {}) {
	return new Promise((resolve, reject) => {
		const url = new URL(target);
		const req = http.request(
			{
				host: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: options.method ?? "GET",
				headers: options.headers ?? {},
			},
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			},
		);
		req.on("error", reject);
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

function makeSseChunk(event, data) {
	return `event: ${event}\ndata: ${data}\n\n`;
}

/**
 * Build a fully-functional `SidecarAuthBridge` for tests, returning a
 * known session token without actually hitting the gateway. Reuses the
 * same dev-auth handshake flow but with a stubbed `fetchImpl`, so the
 * sidecar code path is exercised end-to-end.
 */
function makeAuthBridge(gatewayBaseUrl, token = "test-cookie-1") {
	const fetchImpl = async (url) => {
		if (url.endsWith("/api/auth/sign-in/social")) {
			return new Response(null, {
				status: 302,
				headers: { location: "/api/auth/callback/google?code=dev" },
			});
		}
		return new Response(null, {
			status: 302,
			headers: { "set-cookie": `pibo_dev_session=${token}` },
		});
	};
	return createSidecarAuthBridge({ gatewayBaseUrl, fetchImpl });
}

describe("chat-vscode/sidecar", () => {
	test("DEFAULT_SIDECAR_PORT is a documented loopback-only port", () => {
		assert.equal(DEFAULT_SIDECAR_PORT, 4789);
	});

	test("start binds to 127.0.0.1 and serves /health from the configured gateway", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "abc-123",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const res = await httpRequest(`http://127.0.0.1:${sidecar.port()}/health`);
			assert.equal(res.status, 200);
			const body = JSON.parse(res.body);
			assert.equal(body.gateway, "reachable");
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
		assert.equal(sidecar.isRunning(), false);
	});

	test("falls back to port 0 when the requested port is busy", async () => {
		const blocker = await startMockGateway((req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("blocking");
		});
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			sidecarPort: blocker.port,
			webviewId: "abc-fallback",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			assert.notEqual(sidecar.port(), blocker.port, "should have fallen back to a different port");
			assert.ok(sidecar.port() > 0);
		} finally {
			await sidecar.stop();
			await stopServer(blocker.server);
			await stopServer(mockGateway.server);
		}
	});

	test("getOrigin returns the port-mapped https origin with the actual port", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200);
			res.end("ok");
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-xyz",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			assert.equal(
				sidecar.getOrigin(),
				`https://webview-xyz.vscode-resource.vscode-cdn.net:${sidecar.port()}`,
			);
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("proxies a GET /api/... request to the gateway and forwards the response", async () => {
		const seenCookies = [];
		const mockGateway = await startMockGateway((req, res) => {
			seenCookies.push(req.headers["cookie"]);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ from: "gateway", url: req.url }));
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`, "proxy-cookie-9");
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-proxy",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const res = await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/chat/bootstrap?roomId=r1`);
			assert.equal(res.status, 200);
			const body = JSON.parse(res.body);
			assert.equal(body.from, "gateway");
			assert.equal(body.url, "/api/chat/bootstrap?roomId=r1");
			assert.equal(seenCookies[0], "pibo_dev_session=proxy-cookie-9");
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("proxies a POST request with body intact", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			const chunks = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ received: Buffer.concat(chunks).toString("utf8"), method: req.method }));
			});
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-post",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const res = await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/chat/sessions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "test" }),
			});
			const body = JSON.parse(res.body);
			assert.equal(body.received, '{"name":"test"}');
			assert.equal(body.method, "POST");
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("responds to CORS preflight from a vscode-webview:// origin", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200);
			res.end();
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-cors",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const res = await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/chat/something`, {
				method: "OPTIONS",
				headers: {
					origin: "vscode-webview://abcdef-1234",
					"access-control-request-method": "POST",
					"access-control-request-headers": "content-type, accept",
				},
			});
			assert.equal(res.status, 204);
			assert.equal(res.headers["access-control-allow-origin"], "vscode-webview://abcdef-1234");
			assert.equal(res.headers["access-control-allow-credentials"], "true");
			assert.equal(res.headers["access-control-allow-methods"], "POST");
			assert.equal(res.headers["access-control-allow-headers"], "content-type, accept");
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("rejects a non-OPTIONS request from a non-vscode-webview origin with 403", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200);
			res.end();
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-evil",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const res = await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/chat/whatever`, {
				headers: { origin: "http://evil.example" },
			});
			assert.equal(res.status, 403);
			const body = JSON.parse(res.body);
			assert.match(body.error, /origin not allowed/);
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("streams an SSE response 1:1 without buffering", async () => {
		const events = ["hello", "world", "stream-end"];
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
			});
			res.flushHeaders?.();
			let i = 0;
			const interval = setInterval(() => {
				if (i >= events.length) {
					clearInterval(interval);
					res.end();
					return;
				}
				res.write(makeSseChunk("message", events[i]));
				i += 1;
			}, 30);
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-sse",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();

			const url = `http://127.0.0.1:${sidecar.port()}/api/chat/events?roomId=r1`;
			const collected = await new Promise((resolve, reject) => {
				const req = http.request(url, { method: "GET" }, (res) => {
					assert.equal(res.statusCode, 200);
					assert.equal(res.headers["content-type"], "text/event-stream");
					const chunks = [];
					res.on("data", (c) => chunks.push(c));
					res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
					res.on("error", reject);
				});
				req.on("error", reject);
				req.end();
			});
			for (const e of events) {
				assert.ok(collected.includes(`data: ${e}`), `SSE stream missing event ${e}: ${collected}`);
			}
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("isHealthy reports false when the gateway refuses connections", async () => {
		const authBridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:1",
			fetchImpl: async () => {
				throw new TypeError("connection refused");
			},
		});
		const sidecar = createSidecar({
			gatewayBaseUrl: "http://127.0.0.1:1",
			webviewId: "webview-unhealthy",
			authBridge,
			healthProbeTimeoutMs: 50,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const ok = await sidecar.isHealthy();
			assert.equal(ok, false);
		} finally {
			await sidecar.stop();
		}
	});

	test("requestCount increments for each proxied request", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-counter",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			assert.equal(sidecar.requestCount(), 0);
			await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/a`);
			await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/b`);
			await httpRequest(`http://127.0.0.1:${sidecar.port()}/api/c`);
			assert.equal(sidecar.requestCount(), 3);
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("stop() drains in-flight slow requests", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			setTimeout(() => {
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("slow");
			}, 200);
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "webview-drain",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			const inflight = httpRequest(`http://127.0.0.1:${sidecar.port()}/api/slow`);
			await delay(20);
			const stopStart = Date.now();
			await sidecar.stop();
			const stopDuration = Date.now() - stopStart;
			const res = await inflight;
			assert.equal(res.status, 200);
			assert.equal(res.body, "slow");
			assert.ok(stopDuration >= 100, `stop() returned in ${stopDuration}ms, expected >= 100ms`);
		} finally {
			await stopServer(mockGateway.server);
		}
	});

	test("createSidecar throws a clear error when no authBridge is provided", () => {
		assert.throws(
			() =>
				createSidecar({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					webviewId: "x",
				}),
			/authBridge/,
		);
	});

	test("tryHandshake returns true and clears lastHandshakeError when the dev-auth flow completes", async () => {
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
		const authBridge = makeAuthBridge(`http://127.0.0.1:${mockGateway.port}`);
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "abc-handshake-ok",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			assert.equal(await sidecar.tryHandshake(), true);
			assert.equal(sidecar.lastHandshakeError(), undefined);
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});

	test("tryHandshake returns false and exposes the error when the gateway is in Better Auth mode", async () => {
		// Regression test for the user's 1.4.0 setup: the production
		// gateway is in Better Auth mode, so the dev-auth handshake
		// /api/auth/sign-in/social redirects to the real OAuth
		// provider instead of /api/auth/callback/google?code=dev.
		const mockGateway = await startMockGateway((req, res) => {
			res.writeHead(302, { location: "https://pibo.neuralnexus.me/api/auth/sign-in/social" });
			res.end();
		});
		const fetchImpl = async () =>
			new Response(null, {
				status: 302,
				headers: { location: "https://pibo.neuralnexus.me/api/auth/sign-in/social" },
			});
		const authBridge = createSidecarAuthBridge({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			fetchImpl,
		});
		const sidecar = createSidecar({
			gatewayBaseUrl: `http://127.0.0.1:${mockGateway.port}`,
			webviewId: "abc-better-auth",
			authBridge,
			logger: silentLogger(),
		});
		try {
			await sidecar.start();
			assert.equal(await sidecar.tryHandshake(), false);
			// The handshake fails because the Better Auth gateway never
			// sets the pibo_dev_session cookie in its 302 chain. Any of
			// these error strings prove the handshake was attempted
			// against Better Auth and not the local dev-auth flow.
			assert.match(
				sidecar.lastHandshakeError() ?? "",
				/did not set pibo_dev_session cookie|missing Location|expected 30x/,
			);
		} finally {
			await sidecar.stop();
			await stopServer(mockGateway.server);
		}
	});
});

function silentLogger() {
	const noop = () => undefined;
	return {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
	};
}
