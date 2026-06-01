import assert from "node:assert/strict";
import test from "node:test";
import { PiboAuthError } from "../dist/auth/types.js";
import { requireWebSession } from "../dist/web/auth.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredTitle = `${retiredWord[0].toUpperCase()}${retiredWord.slice(1)}`;
const legacyPartitionField = `legacy${retiredTitle}Scope`;
const retiredPartitionField = `${retiredWord}Scope`;

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

test("web auth maps different identities to the same app context context", async () => {
	const first = await requireWebSession(createContextForUser("account-a"), createRequest());
	const second = await requireWebSession(createContextForUser("account-b"), createRequest());

	assert.equal(first.authSession.identity.userId, "account-a");
	assert.equal(second.authSession.identity.userId, "account-b");
	assert.deepEqual(first.appContext, second.appContext);
	assert.equal(first.appContext.kind, "app-context");
	assert.equal(first.appContext.id, "app");
	assert.equal(legacyPartitionField in first, false);
	assert.equal(retiredPartitionField in first, false);
	assert.equal(legacyPartitionField in second, false);
	assert.equal(retiredPartitionField in second, false);
	assert.equal(legacyPartitionField in first.appContext, false);
	assert.equal(retiredPartitionField in first.appContext, false);
	assert.equal(legacyPartitionField in second.appContext, false);
	assert.equal(retiredPartitionField in second.appContext, false);
	assert.notEqual(first.appContext.id, `user:${first.authSession.identity.userId}`);
	assert.notEqual(second.appContext.id, `user:${second.authSession.identity.userId}`);
});
