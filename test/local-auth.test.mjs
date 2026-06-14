import assert from "node:assert/strict";
import test from "node:test";
import { stripSocketPeerHeaderFromResponse } from "../dist/web/channel.js";
import {
	getSocketPeerForDevAuth,
	isLoopbackDevAuthRequest,
	isLoopbackSocketPeerForDevAuth,
} from "../dist/plugins/dev-auth.js";
import { resolveWebGatewayAuthMode } from "../dist/gateway/web.js";

test("three safety layers reject a public reverse proxy that rewrites both headers", () => {
	// A reverse proxy on the same host that rewrites Host: localhost and strips
	// X-Forwarded-Host still cannot trick local auth: the TCP socket peer
	// reveals that the actual connection came from a public IP.
	const request = new Request("http://localhost:4788/api/auth/session", {
		headers: {
			host: "localhost:4788",
			"x-pibo-socket-peer": "203.0.113.42",
		},
	});

	assert.equal(isLoopbackDevAuthRequest(request), true);
	assert.equal(isLoopbackSocketPeerForDevAuth(request), false);
	assert.equal(getSocketPeerForDevAuth(request), "203.0.113.42");
});

test("three safety layers accept a true loopback request", () => {
	const request = new Request("http://localhost:4788/api/auth/session", {
		headers: {
			host: "localhost:4788",
			"x-forwarded-host": "localhost",
			"x-pibo-socket-peer": "127.0.0.1",
		},
	});

	assert.equal(isLoopbackDevAuthRequest(request), true);
	assert.equal(isLoopbackSocketPeerForDevAuth(request), true);
});

test("stripSocketPeerHeaderFromResponse removes the internal header", () => {
	const response = new Response(JSON.stringify({ ok: true }), {
		headers: { "content-type": "application/json", "x-pibo-socket-peer": "127.0.0.1" },
	});

	const stripped = stripSocketPeerHeaderFromResponse(response);

	assert.equal(stripped.headers.get("x-pibo-socket-peer"), null);
	assert.equal(stripped.headers.get("content-type"), "application/json");
	assert.equal(stripped.status, 200);
});

test("stripSocketPeerHeaderFromResponse returns the same response when header is absent", () => {
	const response = new Response("ok", { headers: { "content-type": "text/plain" } });

	const stripped = stripSocketPeerHeaderFromResponse(response);

	assert.equal(stripped.headers.get("x-pibo-socket-peer"), null);
	assert.equal(stripped.headers.get("content-type"), "text/plain");
});

test("authMode=local with --web-host=0.0.0.0 fails closed", () => {
	assert.throws(
		() => resolveWebGatewayAuthMode({ authMode: "local", web: { host: "0.0.0.0" } }),
		/Local auth requires a loopback bind/,
	);
});

test("authMode=local with --web-host=0.0.0.0 and a public IP fails closed", () => {
	assert.throws(
		() => resolveWebGatewayAuthMode({ authMode: "local", web: { host: "192.168.1.10" } }),
		/Local auth requires a loopback bind/,
	);
});
