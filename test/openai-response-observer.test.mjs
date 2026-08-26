import assert from "node:assert/strict";
import test from "node:test";
import {
	observeOpenAiSseResponse,
	withOpenAiResponseEventObserver,
} from "../dist/agent-runtimes/pi/openai-response-observer.js";

function sseResponse(event, options = {}) {
	const encoder = new TextEncoder();
	const body = `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`;
	const splitAt = options.splitAt ?? body.length;
	return {
		body,
		response: new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(body.slice(0, splitAt)));
				controller.enqueue(encoder.encode(body.slice(splitAt)));
				controller.close();
			},
		}), { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
	};
}

test("OpenAI response observation is request-scoped and preserves SSE bytes", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const firstEvent = { type: "response.web_search_call.searching", item_id: "ws_first" };
	const secondEvent = { type: "response.web_search_call.searching", item_id: "ws_second" };
	const first = sseResponse(firstEvent, { splitAt: 17 });
	const second = sseResponse(secondEvent, { splitAt: 31 });
	const firstObserved = [];
	const secondObserved = [];

	const firstOptions = withOpenAiResponseEventObserver(
		{ transport: "websocket-cached", fetch: async () => first.response },
		(event) => firstObserved.push(event),
	);
	const secondOptions = withOpenAiResponseEventObserver(
		{ transport: "auto", fetch: async () => second.response },
		(event) => secondObserved.push(event),
	);

	const [firstText, secondText] = await Promise.all([
		firstOptions.fetch("https://first.invalid").then((response) => response.text()),
		secondOptions.fetch("https://second.invalid").then((response) => response.text()),
	]);

	assert.equal(firstOptions.transport, "sse");
	assert.equal(secondOptions.transport, "sse");
	assert.equal(firstText, first.body);
	assert.equal(secondText, second.body);
	assert.deepEqual(firstObserved, [firstEvent]);
	assert.deepEqual(secondObserved, [secondEvent]);
	assert.equal(globalThis.fetch, originalFetch);
	assert.equal(globalThis.WebSocket, originalWebSocket);
});

test("cancelling an observed SSE body cancels the provider body without draining it", async () => {
	const encoder = new TextEncoder();
	const event = { type: "response.web_search_call.searching", item_id: "ws_cancel" };
	const partialFrame = `data: ${JSON.stringify(event)}\n\n`;
	let cancelReason;
	let pullCount = 0;
	const providerBody = new ReadableStream({
		pull(controller) {
			pullCount += 1;
			if (pullCount === 1) controller.enqueue(encoder.encode(partialFrame.slice(0, Math.floor(partialFrame.length / 2))));
		},
		cancel(reason) {
			cancelReason = reason;
		},
	}, { highWaterMark: 0 });
	const observedEvents = [];
	const response = observeOpenAiSseResponse(
		new Response(providerBody, { headers: { "content-type": "text/event-stream" } }),
		(candidate) => observedEvents.push(candidate),
	);
	const reader = response.body.getReader();
	const first = await reader.read();
	assert.equal(first.done, false);
	assert.deepEqual(observedEvents, [], "cancellation must not flush a split partial frame");
	assert.equal(pullCount, 1);

	const reason = new Error("consumer stopped");
	await reader.cancel(reason);
	assert.equal(cancelReason, reason);
	assert.equal(providerBody.locked, false, "cancellation must release the provider reader lock");
});

test("split UTF-8 SSE frames preserve exact bytes and isolate parser and observer failures", async () => {
	const encoder = new TextEncoder();
	const event = { type: "response.web_search_call.searching", item_id: "ws_split", query: "café 🔎" };
	const body = [
		`data: ${JSON.stringify(event)}\r\n\r\n`,
		"data: {malformed json}\r\n\r\n",
		"data: [DONE]\r\n\r\n",
	].join("");
	const bytes = encoder.encode(body);
	const observed = [];
	const response = observeOpenAiSseResponse(new Response(new ReadableStream({
		start(controller) {
			for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
			controller.close();
		},
	}), { headers: { "content-type": "text/event-stream" } }), (candidate) => {
		observed.push(candidate);
		throw new Error("observer failure must be isolated");
	});

	assert.equal(await response.text(), body);
	assert.deepEqual(observed, [event]);
});

test("request-local fetch failures propagate unchanged", async () => {
	const failure = new Error("provider fetch failed");
	const options = withOpenAiResponseEventObserver({ fetch: async () => { throw failure; } }, () => {});
	await assert.rejects(options.fetch("https://provider.invalid"), (error) => error === failure);
});

test("non-SSE responses pass through unchanged", () => {
	const response = new Response("ok", { headers: { "content-type": "application/json" } });
	assert.equal(observeOpenAiSseResponse(response, () => assert.fail("unexpected event")), response);
});
