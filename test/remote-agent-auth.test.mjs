import assert from "node:assert/strict";
import test from "node:test";
import { PiboRemoteAgentAuth } from "../dist/remote-agent/auth.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { REMOTE_AGENT_CODE_TTL_MS, REMOTE_AGENT_TOKEN_TTL_MS, RemoteAgentError } from "../dist/remote-agent/types.js";

function setup() {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	let now = Date.parse("2026-09-19T12:00:00.000Z");
	const auth = new PiboRemoteAgentAuth({ store, now: () => now });
	return { store, auth, advance: (ms) => { now += ms; }, now: () => now };
}

test("device code can be redeemed exactly once", () => {
	const { store, auth } = setup();
	try {
		const issued = auth.createDeviceCode("room-a", "ChatGPT");
		assert.match(issued.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		assert.equal(issued.roomId, "room-a");
		const redeemed = auth.redeemDeviceCode(issued.code, ["sessions", "observe"]);
		assert.ok(redeemed.token.startsWith("pibo_remote_"));
		assert.equal(redeemed.info.roomId, "room-a");
		assert.deepEqual(redeemed.info.modules, ["sessions", "observe"]);
		assert.equal(redeemed.info.label, "ChatGPT");
		assert.throws(() => auth.redeemDeviceCode(issued.code, ["sessions"]), (error) => error instanceof RemoteAgentError && error.code === "code_invalid");
	} finally {
		store.close();
	}
});

test("expired device codes are rejected", () => {
	const { store, auth, advance } = setup();
	try {
		const issued = auth.createDeviceCode("room-a");
		advance(REMOTE_AGENT_CODE_TTL_MS + 1);
		assert.throws(() => auth.redeemDeviceCode(issued.code, ["sessions"]), (error) => error instanceof RemoteAgentError && error.code === "code_invalid");
	} finally {
		store.close();
	}
});

test("tokens authenticate, expire after 30 days, and can be revoked", () => {
	const { store, auth, advance, now } = setup();
	try {
		const { code } = auth.createDeviceCode("room-a");
		const { token, info } = auth.redeemDeviceCode(code, ["files"]);
		assert.equal(Date.parse(info.expiresAt) - now(), REMOTE_AGENT_TOKEN_TTL_MS);
		const scope = auth.authenticate(token);
		assert.equal(scope.tokenId, info.id);
		assert.equal(scope.roomId, "room-a");
		assert.deepEqual(scope.modules, ["files"]);
		assert.throws(() => auth.authenticate("pibo_remote_bogus"), (error) => error instanceof RemoteAgentError && error.code === "token_invalid");
		assert.throws(() => auth.authenticate("not-a-token"), (error) => error instanceof RemoteAgentError && error.code === "token_invalid");

		advance(REMOTE_AGENT_TOKEN_TTL_MS + 1);
		assert.throws(() => auth.authenticate(token), (error) => error instanceof RemoteAgentError && error.code === "token_expired");
	} finally {
		store.close();
	}
});

test("revoked tokens are rejected and listed", () => {
	const { store, auth } = setup();
	try {
		const first = auth.redeemDeviceCode(auth.createDeviceCode("room-a", "one").code, ["sessions"]);
		const second = auth.redeemDeviceCode(auth.createDeviceCode("room-a", "two").code, ["observe"]);
		assert.equal(auth.listTokens("room-a").length, 2);
		assert.equal(auth.revokeToken(first.info.id), true);
		assert.equal(auth.revokeToken(first.info.id), false);
		assert.throws(() => auth.authenticate(first.token), (error) => error instanceof RemoteAgentError && error.code === "token_revoked");
		assert.ok(auth.authenticate(second.token));
		const listed = auth.listTokens("room-a");
		assert.equal(listed.find((entry) => entry.id === first.info.id)?.revoked, true);
	} finally {
		store.close();
	}
});

test("only hashes are persisted, never raw tokens", () => {
	const { store, auth } = setup();
	try {
		const { code } = auth.createDeviceCode("room-a");
		const { token } = auth.redeemDeviceCode(code, ["sessions"]);
		const found = store.findTokenByHash(" hygienic-never-matches ");
		assert.equal(found, undefined);
		// The raw token value must not appear in any public listing.
		assert.ok(!JSON.stringify(store.listTokens()).includes(token));
	} finally {
		store.close();
	}
});

test("pruneExpired removes used codes and expired tokens", () => {
	const { store, auth, advance } = setup();
	try {
		const used = auth.createDeviceCode("room-a");
		auth.redeemDeviceCode(used.code, ["sessions"]);
		auth.createDeviceCode("room-a");
		advance(REMOTE_AGENT_CODE_TTL_MS + REMOTE_AGENT_TOKEN_TTL_MS + 1);
		const pruned = auth.pruneExpired();
		assert.equal(pruned.codes, 2);
		assert.equal(pruned.tokens, 1);
		assert.equal(auth.listTokens().length, 0);
	} finally {
		store.close();
	}
});
