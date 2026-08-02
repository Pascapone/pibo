import assert from "node:assert/strict";
import test from "node:test";
import { handleChatLoopApiRequest } from "../dist/apps/chat/loop-api.js";
import { PiboLoopStore } from "../dist/loops/store.js";

test("Loop API defaults to goal and the Ralph alias defaults to legacy mode", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const goalResponse = await handleChatLoopApiRequest(options(store, jsonRequest("http://localhost/api/chat/loops/jobs", {
			profile: "base",
			prompt: "complete the objective",
			target: { kind: "default-chat" },
		})));
		assert.equal(goalResponse?.status, 201);
		const goal = (await goalResponse.json()).job;
		assert.equal(goal.mode, "goal");

		const ralphResponse = await handleChatLoopApiRequest(options(store, jsonRequest("http://localhost/api/chat/ralph/jobs", {
			profile: "base",
			prompt: "repeat with fresh context",
			target: { kind: "default-chat" },
		})));
		assert.equal(ralphResponse?.status, 201);
		const ralph = (await ralphResponse.json()).job;
		assert.equal(ralph.mode, "ralph");

		const listResponse = await handleChatLoopApiRequest(options(store, new Request("http://localhost/api/chat/loops/jobs?includeDisabled=true")));
		const jobs = (await listResponse.json()).jobs;
		assert.deepEqual(new Set(jobs.map((job) => job.mode)), new Set(["goal", "ralph"]));
	} finally {
		store.close();
	}
});

function jsonRequest(url, body) {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json", origin: "http://localhost" },
		body: JSON.stringify(body),
	});
}

function options(loopStore, request) {
	return {
		request,
		loopStore,
		defaultProfile: "base",
		webSession: { user: { id: "test" } },
		context: {
			channelContext: {
				getProfiles: () => [{ name: "base", aliases: [] }],
				getLoopStopConditionInfos: () => [],
			},
		},
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoom: () => { throw new Error("not used"); },
			ensureDefaultRoom: () => ({ id: "room_default", name: "Shared Chat", type: "chat", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {} }),
		},
	};
}
