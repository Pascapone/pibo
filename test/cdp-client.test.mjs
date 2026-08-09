import assert from "node:assert/strict";
import test from "node:test";
import { CdpClient } from "../dist/tools/cdp-client.js";

function installMockWebSocket(onRequest) {
	const original = globalThis.WebSocket;
	class MockWebSocket extends EventTarget {
		static OPEN = 1;
		readyState = 0;

		constructor() {
			super();
			queueMicrotask(() => {
				this.readyState = MockWebSocket.OPEN;
				this.dispatchEvent(new Event("open"));
			});
		}

		send(raw) {
			onRequest(this, JSON.parse(String(raw)));
		}

		respond(payload) {
			const event = new Event("message");
			Object.defineProperty(event, "data", { value: JSON.stringify(payload) });
			this.dispatchEvent(event);
		}

		close() {
			this.readyState = 3;
			const event = new Event("close");
			Object.defineProperties(event, {
				code: { value: 1000 },
				reason: { value: "" },
			});
			this.dispatchEvent(event);
		}
	}
	globalThis.WebSocket = MockWebSocket;
	return () => {
		globalThis.WebSocket = original;
	};
}

test("evaluateJson transfers large browser results in bounded chunks", async (t) => {
	const expected = {
		kind: "large-result",
		payload: "x".repeat(4 * 1024 * 1024),
		rows: Array.from({ length: 32 }, (_, index) => ({ id: `row-${index}`, status: "done" })),
	};
	const serialized = JSON.stringify(expected);
	let chunkRequests = 0;
	let cleanupRequests = 0;
	let largestResponseBytes = 0;
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		let value;
		if (expression.includes("Object.defineProperty(globalThis")) {
			value = { length: serialized.length };
		} else {
			const slice = /\.slice\((\d+), (\d+)\)/.exec(expression);
			if (slice) {
				chunkRequests += 1;
				value = serialized.slice(Number(slice[1]), Number(slice[2]));
			} else {
				cleanupRequests += 1;
				value = true;
			}
		}
		const response = { id: request.id, result: { result: { type: typeof value, value } } };
		largestResponseBytes = Math.max(largestResponseBytes, Buffer.byteLength(JSON.stringify(response)));
		socket.respond(response);
	});
	t.after(restore);

	const client = new CdpClient("ws://mock");
	await client.connect();
	try {
		assert.deepEqual(await client.evaluateJson("({ ignored: true })"), expected);
		assert.ok(chunkRequests > 1);
		assert.equal(cleanupRequests, 1);
		assert.ok(largestResponseBytes < 512 * 1024, `largest response was ${largestResponseBytes} bytes`);
	} finally {
		client.close();
	}
});

test("evaluateJson removes temporary browser storage when chunk retrieval fails", async (t) => {
	let cleanupRequests = 0;
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		if (expression.includes("Object.defineProperty(globalThis")) {
			socket.respond({ id: request.id, result: { result: { type: "object", value: { length: 300_000 } } } });
			return;
		}
		if (expression.includes(".slice(")) {
			socket.respond({ id: request.id, error: { message: "chunk failed" } });
			return;
		}
		cleanupRequests += 1;
		socket.respond({ id: request.id, result: { result: { type: "boolean", value: true } } });
	});
	t.after(restore);

	const client = new CdpClient("ws://mock");
	await client.connect();
	try {
		await assert.rejects(() => client.evaluateJson("({ ignored: true })"), /chunk failed/);
		assert.equal(cleanupRequests, 1);
	} finally {
		client.close();
	}
});
