import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSidecarAuthBridge, buildProxiedHeaders } from "../../src/apps/chat-vscode/extension/src/sidecar-auth.ts";

function makeHeaders(headers) {
	const h = new Headers();
	for (const [k, v] of Object.entries(headers)) h.set(k, v);
	return h;
}

describe("chat-vscode/sidecar-auth", () => {
	test("handshake runs the simulated OAuth flow and captures the session cookie", async () => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			if (url.endsWith("/api/auth/sign-in/social")) {
				return new Response(null, {
					status: 302,
					headers: { location: "/api/auth/callback/google?code=dev" },
				});
			}
			if (url.endsWith("/api/auth/callback/google?code=dev")) {
				return new Response(null, {
					status: 302,
					headers: { "set-cookie": "pibo_dev_session=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800" },
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		};
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788",
			fetchImpl,
		});
		const token = await bridge.handshake();
		assert.equal(token, "abc123");
		assert.equal(bridge.getCachedToken(), "abc123");
		assert.equal(calls.length, 2);
		assert.equal(calls[0].url, "http://127.0.0.1:4788/api/auth/sign-in/social");
		assert.equal(calls[1].url, "http://127.0.0.1:4788/api/auth/callback/google?code=dev");
	});

	test("handshake resolves a relative location against the gateway base", async () => {
		const fetchImpl = async (url) => {
			if (url.endsWith("/api/auth/sign-in/social")) {
				return new Response(null, {
					status: 303,
					headers: { location: "api/auth/callback/google?code=dev" },
				});
			}
			return new Response(null, {
				status: 307,
				headers: { "set-cookie": "pibo_dev_session=relcookie; Path=/" },
			});
		};
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788/",
			fetchImpl,
		});
		const token = await bridge.handshake();
		assert.equal(token, "relcookie");
	});

	test("handshake throws when sign-in does not return a 30x", async () => {
		const fetchImpl = async () => new Response("nope", { status: 500 });
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788",
			fetchImpl,
		});
		await assert.rejects(() => bridge.handshake(), /expected 30x, got 500/);
	});

	test("handshake throws when the callback does not set the session cookie", async () => {
		const fetchImpl = async (url) => {
			if (url.endsWith("/api/auth/sign-in/social")) {
				return new Response(null, {
					status: 302,
					headers: { location: "/api/auth/callback/google?code=dev" },
				});
			}
			return new Response(null, { status: 302, headers: { location: "/" } });
		};
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788",
			fetchImpl,
		});
		await assert.rejects(() => bridge.handshake(), /did not set pibo_dev_session/);
	});

	test("getCookieHeader runs the handshake lazily on the first call", async () => {
		let calls = 0;
		const fetchImpl = async (url) => {
			calls += 1;
			if (url.endsWith("/api/auth/sign-in/social")) {
				return new Response(null, {
					status: 302,
					headers: { location: "/api/auth/callback/google?code=dev" },
				});
			}
			return new Response(null, {
				status: 302,
				headers: { "set-cookie": "pibo_dev_session=once" },
			});
		};
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788",
			fetchImpl,
		});
		const c1 = await bridge.getCookieHeader();
		const c2 = await bridge.getCookieHeader();
		assert.equal(c1, "pibo_dev_session=once");
		assert.equal(c2, "pibo_dev_session=once");
		assert.equal(calls, 2); // sign-in + callback, performed once
	});

	test("reset clears the cached token so the next call re-handshakes", async () => {
		let calls = 0;
		const fetchImpl = async (url) => {
			calls += 1;
			if (url.endsWith("/api/auth/sign-in/social")) {
				return new Response(null, {
					status: 302,
					headers: { location: "/api/auth/callback/google?code=dev" },
				});
			}
			return new Response(null, {
				status: 302,
				headers: { "set-cookie": `pibo_dev_session=call${calls}` },
			});
		};
		const bridge = createSidecarAuthBridge({
			gatewayBaseUrl: "http://127.0.0.1:4788",
			fetchImpl,
		});
		await bridge.handshake();
		assert.equal(bridge.getCachedToken(), "call2");
		bridge.reset();
		assert.equal(bridge.getCachedToken(), undefined);
		const c = await bridge.getCookieHeader();
		assert.equal(c, "pibo_dev_session=call4");
	});

	test("buildProxiedHeaders strips hop-by-hop and internal headers and injects the cookie", () => {
		const inbound = makeHeaders({
			host: "127.0.0.1:4789",
			connection: "keep-alive",
			"content-length": "42",
			"transfer-encoding": "chunked",
			"x-pibo-socket-peer": "127.0.0.1",
			"user-agent": "VSCode-WebView",
			accept: "application/json",
			cookie: "pibo_dev_session=garbage",
		});
		const outbound = buildProxiedHeaders(inbound, "pibo_dev_session=good");
		assert.equal(outbound.get("host"), null);
		assert.equal(outbound.get("connection"), null);
		assert.equal(outbound.get("content-length"), null);
		assert.equal(outbound.get("transfer-encoding"), null);
		assert.equal(outbound.get("x-pibo-socket-peer"), null);
		assert.equal(outbound.get("user-agent"), "VSCode-WebView");
		assert.equal(outbound.get("accept"), "application/json");
		assert.equal(outbound.get("cookie"), "pibo_dev_session=good");
	});

	test("buildProxiedHeaders leaves the inbound cookie alone when no replacement is supplied", () => {
		const inbound = makeHeaders({ "user-agent": "test" });
		const outbound = buildProxiedHeaders(inbound, "pibo_dev_session=good");
		assert.equal(outbound.get("user-agent"), "test");
		assert.equal(outbound.get("cookie"), "pibo_dev_session=good");
	});
});
