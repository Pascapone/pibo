import assert from "node:assert/strict";
import test from "node:test";
import {
	createDevAuthService,
	getSocketPeerForDevAuth,
	isLoopbackDevAuthRequest,
	isLoopbackSocketPeerForDevAuth,
	isTrustedLocalSocketPeerForDevAuthHeaders,
} from "../dist/plugins/dev-auth.js";

test("dev auth accepts loopback requests", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: { host: "127.0.0.1:4788" },
	});

	assert.equal(isLoopbackDevAuthRequest(request), true);
});

test("dev auth rejects requests forwarded from public hosts", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "pibo.neuralnexus.me",
			"x-forwarded-host": "pibo.neuralnexus.me",
		},
	});

	assert.equal(isLoopbackDevAuthRequest(request), false);
});

test("dev auth reads the socket peer header from the channel", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "127.0.0.1",
		},
	});

	assert.equal(getSocketPeerForDevAuth(request), "127.0.0.1");
	assert.equal(isLoopbackSocketPeerForDevAuth(request), true);
});

test("dev auth rejects non-loopback socket peer even when host headers are loopback", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "203.0.113.7",
		},
	});

	assert.equal(isLoopbackDevAuthRequest(request), true);
	assert.equal(isLoopbackSocketPeerForDevAuth(request), false);
});

test("dev auth rejects IPv6 mapped public peer addresses", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "::ffff:203.0.113.7",
		},
	});

	assert.equal(isLoopbackSocketPeerForDevAuth(request), false);
});

test("dev auth accepts IPv6 loopback peer", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "::1",
		},
	});

	assert.equal(isLoopbackSocketPeerForDevAuth(request), true);
});

test("dev auth rejects requests without socket peer header (fail-closed)", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: { host: "127.0.0.1:4788" },
	});

	assert.equal(getSocketPeerForDevAuth(request), undefined);
	assert.equal(isLoopbackSocketPeerForDevAuth(request), false);
});

test("dev auth 0.0.0.0 peer is treated as not loopback", () => {
	const request = new Request("http://127.0.0.1:4788/api/auth/session", {
		headers: {
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "0.0.0.0",
		},
	});

	assert.equal(isLoopbackSocketPeerForDevAuth(request), false);
});

test("getSession returns the dev session for loopback callers without a cookie", async () => {
	const service = createDevAuthService();
	const headers = new Headers({
		host: "127.0.0.1:4788",
		"x-pibo-socket-peer": "127.0.0.1",
	});

	const session = await service.getSession(headers);

	assert.ok(session, "loopback caller must receive a dev session");
	assert.equal(session?.identity.userId, "dev-user-001");
	assert.equal(session?.identity.email, "dev@pibo.local");
});

test("getSession accepts IPv6 loopback callers without a cookie", async () => {
	const service = createDevAuthService();
	const headers = new Headers({
		host: "[::1]:4788",
		"x-pibo-socket-peer": "::1",
	});

	const session = await service.getSession(headers);

	assert.ok(session);
	assert.equal(session?.identity.userId, "dev-user-001");
});

test("getSession rejects callers with a public Host header even when peer is loopback", async () => {
	const service = createDevAuthService();
	const headers = new Headers({
		host: "pibo.neuralnexus.me",
		"x-pibo-socket-peer": "127.0.0.1",
	});

	const session = await service.getSession(headers);

	assert.equal(session, undefined);
});

test("getSession rejects callers with a public socket peer", async () => {
	const service = createDevAuthService();
	const headers = new Headers({
		host: "127.0.0.1:4788",
		"x-pibo-socket-peer": "203.0.113.42",
	});

	const session = await service.getSession(headers);

	assert.equal(session, undefined);
});

test("getSession accepts Docker bridge callers only inside compute workers", async () => {
	const previous = process.env.PIBO_COMPUTE_WORKER;
	try {
		const headers = new Headers({
			host: "127.0.0.1:4788",
			"x-pibo-socket-peer": "172.17.0.1",
		});

		process.env.PIBO_COMPUTE_WORKER = "1";
		assert.equal(isTrustedLocalSocketPeerForDevAuthHeaders(headers), true);
		const service = createDevAuthService();
		const session = await service.getSession(headers);
		assert.ok(session);
		assert.equal(session?.identity.email, "dev@pibo.local");

		process.env.PIBO_COMPUTE_WORKER = "0";
		assert.equal(isTrustedLocalSocketPeerForDevAuthHeaders(headers), false);
	} finally {
		if (previous === undefined) {
			delete process.env.PIBO_COMPUTE_WORKER;
		} else {
			process.env.PIBO_COMPUTE_WORKER = previous;
		}
	}
});

test("getSession rejects callers when the socket peer header is missing", async () => {
	const service = createDevAuthService();
	const headers = new Headers({ host: "127.0.0.1:4788" });

	const session = await service.getSession(headers);

	assert.equal(session, undefined);
});

test("getSession accepts a forwarded loopback host with a loopback socket peer", async () => {
	const service = createDevAuthService();
	const headers = new Headers({
		host: "localhost:4788",
		"x-forwarded-host": "localhost",
		"x-pibo-socket-peer": "127.0.0.1",
	});

	const session = await service.getSession(headers);

	assert.ok(session);
});
