import assert from "node:assert/strict";
import test from "node:test";
import {
	getSocketPeerForDevAuth,
	isLoopbackDevAuthRequest,
	isLoopbackSocketPeerForDevAuth,
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
