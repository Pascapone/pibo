import assert from "node:assert/strict";
import test from "node:test";

import { createPiboGatewaySendTool } from "../dist/gateway/tool.js";

const okResponse = {
	type: "res",
	id: "req-1",
	ok: true,
	payload: { queued: true },
};

const reply = {
	type: "assistant_message",
	piboSessionId: "ps_target",
	eventId: "evt-1",
	text: "target reply",
};

test("pibo gateway send tool returns assistant reply and gateway details", async () => {
	let observedEvent;
	const tool = createPiboGatewaySendTool(async (event) => {
		observedEvent = event;
		return { response: okResponse, reply };
	});

	const result = await tool.execute("tool-call-1", {
		piboSessionId: "ps_target",
		message: "hello target",
	});

	assert.deepEqual(observedEvent, {
		type: "message",
		piboSessionId: "ps_target",
		text: "hello target",
		source: "actor",
	});
	assert.deepEqual(result.content, [{ type: "text", text: "target reply" }]);
	assert.deepEqual(result.details, {
		ok: true,
		piboSessionId: "ps_target",
		gatewayPayload: { queued: true },
		reply: "target reply",
	});
});

test("pibo gateway send tool converts send failures into error details", async () => {
	const tool = createPiboGatewaySendTool(async () => {
		throw new Error("session failed");
	});

	const result = await tool.execute("tool-call-1", {
		piboSessionId: "ps_target",
		message: "hello target",
	});

	assert.deepEqual(result.content, [{ type: "text", text: "Gateway error: session failed" }]);
	assert.deepEqual(result.details, {
		ok: false,
		piboSessionId: "ps_target",
		error: "session failed",
	});
});
