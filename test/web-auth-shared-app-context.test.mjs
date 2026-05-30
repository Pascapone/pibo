import assert from "node:assert/strict";
import test from "node:test";
import { PiboAuthError } from "../dist/auth/types.js";
import { requireWebSession } from "../dist/web/auth.js";
import { LEGACY_SHARED_APP_OWNER_SCOPE } from "../dist/shared-app.js";

function createRequest() {
	return new Request("http://localhost/api/test");
}

function createContextForUser(userId) {
	return {
		auth: {
			name: "test-auth",
			async getSession() {
				return userId ? { identity: { userId, email: `${userId}@example.test`, provider: "test" } } : undefined;
			},
			async requireSession(headers) {
				const session = await this.getSession(headers);
				if (!session) throw new PiboAuthError("Unauthenticated", 401);
				return session;
			},
		},
	};
}

test("web auth still gates unauthenticated app requests", async () => {
	await assert.rejects(
		() => requireWebSession(createContextForUser(undefined), createRequest()),
		(error) => error instanceof PiboAuthError && error.statusCode === 401,
	);
});

test("web auth maps different identities to the same shared app context", async () => {
	const first = await requireWebSession(createContextForUser("account-a"), createRequest());
	const second = await requireWebSession(createContextForUser("account-b"), createRequest());

	assert.equal(first.authSession.identity.userId, "account-a");
	assert.equal(second.authSession.identity.userId, "account-b");
	assert.deepEqual(first.appContext, second.appContext);
	assert.equal(first.appContext.kind, "shared-app");
	assert.equal(first.ownerScope, LEGACY_SHARED_APP_OWNER_SCOPE);
	assert.equal(second.ownerScope, LEGACY_SHARED_APP_OWNER_SCOPE);
	assert.notEqual(first.ownerScope, `user:${first.authSession.identity.userId}`);
	assert.notEqual(second.ownerScope, `user:${second.authSession.identity.userId}`);
});
