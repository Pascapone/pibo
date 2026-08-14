import assert from "node:assert/strict";
import test from "node:test";
import { withOpenAiResponseEventObserver } from "../dist/core/openai-response-observer.js";

class FakeWebSocket extends EventTarget {
	constructor(url) {
		super();
		this.url = String(url);
		this.sent = [];
	}

	send(data) {
		this.sent.push(data);
	}

	close() {}

	emitMessage(payload) {
		const event = new Event("message");
		Object.defineProperty(event, "data", { value: JSON.stringify(payload) });
		this.dispatchEvent(event);
	}
}

test("OpenAI response observers inspect SSE and WebSocket events without consuming provider data", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const encoder = new TextEncoder();
	const event = {
		type: "response.output_item.done",
		item: {
			id: "ws_transport",
			type: "web_search_call",
			status: "completed",
			action: { type: "search", query: "Pibo", sources: [{ url: "https://example.test" }] },
		},
	};
	const sse = `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`;
	globalThis.fetch = async () => new Response(new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(sse.slice(0, 37)));
			controller.enqueue(encoder.encode(sse.slice(37)));
			controller.close();
		},
	}), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
	globalThis.WebSocket = FakeWebSocket;

	try {
		const observed = [];
		await withOpenAiResponseEventObserver((candidate) => observed.push(candidate), async () => {
			const response = await globalThis.fetch("https://example.test/responses");
			assert.equal(await response.text(), sse);

			const socket = new globalThis.WebSocket("wss://example.test/responses");
			socket.send(JSON.stringify({ model: "test" }));
			socket.emitMessage(event);
		});

		assert.deepEqual(observed, [event, event]);
	} finally {
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
	}
});
