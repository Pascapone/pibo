import assert from "node:assert/strict";
import test from "node:test";
import { handleChatCronApiRequest } from "../dist/apps/chat/cron-api.js";
import { PiboCronStore } from "../dist/cron/store.js";
import { PiboWebHttpError } from "../dist/web/http.js";

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

test("chat cron API rejects personal cron targets for another principal", async () => {
	await assertHttpError(
		handleChatCronApiRequest(makeOptions(postCronJob({
			headers: { origin: "http://chat.local", "content-type": "application/json" },
			body: { target: { kind: "personal", principalId: "user:other" } },
		}))),
		403,
		/Personal cron target must belong to the current user/,
	);
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
		assert.deepEqual(accessCalls, [["room-42", "user:current", "write"]]);
		assert.deepEqual(body.job.target, { kind: "room", roomId: "room-42" });
	} finally {
		options.cronStore.close();
	}
});
