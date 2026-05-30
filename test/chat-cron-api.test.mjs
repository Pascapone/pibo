import assert from "node:assert/strict";
import test from "node:test";
import { handleChatCronApiRequest } from "../dist/apps/chat/cron-api.js";
import { PiboCronStore } from "../dist/cron/store.js";
import { PiboWebHttpError } from "../dist/web/http.js";
import { LEGACY_SHARED_APP_OWNER_SCOPE } from "../dist/shared-app.js";

function makeOptions(request) {
	return {
		request,
		context: {
			channelContext: {
				getProfiles: () => [{ name: "test-profile", aliases: [] }],
			},
		},
		webSession: { ownerScope: "user:current" },
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoomAccess: () => ({ id: "room-1", name: "Room", ownerScope: "user:current", createdAt: Date.now(), updatedAt: Date.now() }),
			ensureDefaultRoom: () => ({ id: "default-room", name: "Default", ownerScope: "user:current", createdAt: Date.now(), updatedAt: Date.now() }),
			ensureMember: () => ({ roomId: "room-1", principalId: "user:current", role: "owner", createdAt: Date.now(), updatedAt: Date.now() }),
		},
		cronStore: new PiboCronStore({ path: ":memory:" }),
		defaultProfile: "test-profile",
	};
}

function postCronJob({ headers = {}, body = {} } = {}) {
	return new Request("http://chat.local/api/chat/cron/jobs", {
		method: "POST",
		headers,
		body: JSON.stringify({
			target: { kind: "personal" },
			profile: "test-profile",
			prompt: "run this later",
			schedule: { kind: "every", everyMs: 60_000 },
			...body,
		}),
	});
}

async function assertHttpError(promise, statusCode, messagePattern) {
	await assert.rejects(
		promise,
		(error) => error instanceof PiboWebHttpError
			&& error.statusCode === statusCode
			&& messagePattern.test(error.message),
	);
}

test("chat cron API rejects mutating requests without Origin", async () => {
	await assertHttpError(
		handleChatCronApiRequest(makeOptions(postCronJob({ headers: { "content-type": "application/json" } }))),
		403,
		/Origin header is required/,
	);
});

test("chat cron API rejects mutating requests with non-JSON content type", async () => {
	await assertHttpError(
		handleChatCronApiRequest(makeOptions(postCronJob({ headers: { origin: "http://chat.local", "content-type": "text/plain" } }))),
		415,
		/Content-Type must be application\/json/,
	);
});

test("chat cron API rejects mutating requests from a different Origin", async () => {
	await assertHttpError(
		handleChatCronApiRequest(makeOptions(postCronJob({ headers: { origin: "http://evil.local", "content-type": "application/json" } }))),
		403,
		/Origin is not allowed/,
	);
});

test("chat cron API normalizes personal cron targets to the shared default target", async () => {
	const options = makeOptions(postCronJob({
		headers: { origin: "http://chat.local", "content-type": "application/json" },
		body: { target: { kind: "personal", principalId: "user:other" } },
	}));
	const defaultCalls = [];
	options.roomService.ensureDefaultRoom = (input) => {
		defaultCalls.push(input);
		return { id: "default-room", name: "Shared Chat", ownerScope: input.ownerScope, createdAt: Date.now(), updatedAt: Date.now() };
	};
	try {
		const response = await handleChatCronApiRequest(options);
		const body = await response.json();

		assert.equal(response.status, 201);
		assert.equal("ownerScope" in body.job, false);
		assert.deepEqual(body.job.target, { kind: "personal" });
		assert.deepEqual(defaultCalls, [{ ownerScope: LEGACY_SHARED_APP_OWNER_SCOPE, principalId: LEGACY_SHARED_APP_OWNER_SCOPE, name: "Shared Chat" }]);
	} finally {
		options.cronStore.close();
	}
});

test("chat cron API exposes created Cron jobs across authenticated accounts", async () => {
	const store = new PiboCronStore({ path: ":memory:" });
	const createOptions = makeOptions(postCronJob({ headers: { origin: "http://chat.local", "content-type": "application/json" } }));
	createOptions.cronStore = store;
	createOptions.webSession = { ownerScope: "user:a" };
	try {
		const createResponse = await handleChatCronApiRequest(createOptions);
		const created = (await createResponse.json()).job;
		assert.equal("ownerScope" in created, false);

		const listResponse = await handleChatCronApiRequest({ ...makeOptions(new Request("http://chat.local/api/chat/cron/jobs?includeDisabled=true")), cronStore: store, webSession: { ownerScope: "user:b" } });
		assert.deepEqual((await listResponse.json()).jobs.map((job) => job.id), [created.id]);

		const getResponse = await handleChatCronApiRequest({ ...makeOptions(new Request(`http://chat.local/api/chat/cron/jobs/${created.id}`)), cronStore: store, webSession: { ownerScope: "user:b" } });
		assert.equal((await getResponse.json()).job.id, created.id);

		const patchResponse = await handleChatCronApiRequest({
			...makeOptions(new Request(`http://chat.local/api/chat/cron/jobs/${created.id}`, { method: "PATCH", headers: { origin: "http://chat.local", "content-type": "application/json" }, body: JSON.stringify({ name: "patched by B" }) })),
			cronStore: store,
			webSession: { ownerScope: "user:b" },
		});
		assert.equal((await patchResponse.json()).job.name, "patched by B");

		const deleteResponse = await handleChatCronApiRequest({
			...makeOptions(new Request(`http://chat.local/api/chat/cron/jobs/${created.id}`, { method: "DELETE", headers: { origin: "http://chat.local", "content-type": "application/json" } })),
			cronStore: store,
			webSession: { ownerScope: "user:b" },
		});
		assert.deepEqual(await deleteResponse.json(), { removed: true });
	} finally {
		store.close();
	}
});

test("chat cron API requires write access before creating room cron targets", async () => {
	const options = makeOptions(postCronJob({
		headers: { origin: "http://chat.local", "content-type": "application/json" },
		body: { target: { kind: "room", roomId: "room-42" } },
	}));
	const accessCalls = [];
	options.roomService.requireRoomAccess = (roomId, principalId, action) => {
		accessCalls.push([roomId, principalId, action]);
		return {
			id: roomId,
			name: "Room 42",
			ownerScope: "user:current",
			type: "chat",
			createdAt: "2026-05-11T00:00:00.000Z",
			updatedAt: "2026-05-11T00:00:00.000Z",
			metadata: {},
		};
	};

	try {
		const response = await handleChatCronApiRequest(options);
		const body = await response.json();

		assert.equal(response.status, 201);
		assert.deepEqual(accessCalls, [["room-42", LEGACY_SHARED_APP_OWNER_SCOPE, "write"]]);
		assert.equal("ownerScope" in body.job, false);
		assert.deepEqual(body.job.target, { kind: "room", roomId: "room-42" });
	} finally {
		options.cronStore.close();
	}
});
