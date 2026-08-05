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
			tokenBudget: 1234,
			tokenReserve: 200,
			target: { kind: "default-chat" },
		})));
		assert.equal(goalResponse?.status, 201);
		const goal = (await goalResponse.json()).job;
		assert.equal(goal.mode, "goal");
		assert.equal(goal.tokenBudget, 1234);
		assert.equal(goal.tokenReserve, 200);
		assert.equal(goal.state.goalStatus, "paused");

		const ralphResponse = await handleChatLoopApiRequest(options(store, jsonRequest("http://localhost/api/chat/ralph/jobs", {
			profile: "base",
			prompt: "repeat with fresh context",
			target: { kind: "default-chat" },
		})));
		assert.equal(ralphResponse?.status, 201);
		const ralph = (await ralphResponse.json()).job;
		assert.equal(ralph.mode, "ralph");

		await assert.rejects(() => handleChatLoopApiRequest(options(store, jsonRequest("http://localhost/api/chat/ralph/jobs", {
			profile: "base",
			prompt: "invalid legacy budget",
			tokenBudget: 100,
			target: { kind: "default-chat" },
		}))), /tokenBudget and tokenReserve are only available for goal mode/);

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
