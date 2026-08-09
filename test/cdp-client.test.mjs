import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
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

function storageKeyFromSetup(expression) {
	const match = /Object\.defineProperty\(globalThis,\s*("(?:\\.|[^"\\])*")/.exec(expression);
	assert.ok(match, `storage key missing from setup expression: ${expression}`);
	return JSON.parse(match[1]);
}

function storageKeyFromAccess(expression) {
	const match = /globalThis\[("(?:\\.|[^"\\])*")\]/.exec(expression);
	assert.ok(match, `storage key missing from access expression: ${expression}`);
	return JSON.parse(match[1]);
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

test("evaluateJson cancels browser storage when initial evaluation times out", async (t) => {
	const storage = new Map();
	let cleanupRequests = 0;
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		if (expression.includes("Object.defineProperty(globalThis")) {
			const key = storageKeyFromSetup(expression);
			const state = { cancelled: false, json: undefined };
			storage.set(key, state);
			const timer = setTimeout(() => {
				if (!state.cancelled) state.json = JSON.stringify({ tooLate: true });
				socket.respond({ id: request.id, result: { result: { type: "object", value: { length: state.json?.length ?? 0 } } } });
			}, 30);
			timer.unref?.();
			return;
		}
		cleanupRequests += 1;
		const key = storageKeyFromAccess(expression);
		const state = storage.get(key);
		if (state) state.cancelled = true;
		storage.delete(key);
		socket.respond({ id: request.id, result: { result: { type: "boolean", value: true } } });
	});
	t.after(restore);

	const client = new CdpClient("ws://mock");
	await client.connect();
	try {
		await assert.rejects(() => client.evaluateJson("new Promise((resolve) => setTimeout(() => resolve({ tooLate: true }), 30))", 10), /Timed out/);
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(cleanupRequests, 1);
		assert.equal(storage.size, 0, "late completion must not publish stale browser storage");
	} finally {
		client.close();
	}
});

test("evaluateJson does not publish when browser setup starts after the caller deadline", async (t) => {
	const context = createContext({ setTimeout, clearTimeout });
	let cleanupRequest;
	let latePublished = false;
	let finishSetup;
	const setupFinished = new Promise((resolve) => {
		finishSetup = resolve;
	});
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		if (!expression.includes("Object.defineProperty(globalThis")) {
			cleanupRequest = { socket, request };
			return;
		}
		setTimeout(async () => {
			try {
				const value = await runInContext(expression, context);
				socket.respond({ id: request.id, result: { result: { type: "object", value } } });
			} catch (error) {
				socket.respond({
					id: request.id,
					result: { result: { type: "object" }, exceptionDetails: { text: error instanceof Error ? error.message : String(error) } },
				});
			}
			latePublished = runInContext('Object.getOwnPropertyNames(globalThis).some((key) => key.startsWith("__piboCdpJsonResult_"))', context);
			if (cleanupRequest) {
				const value = await runInContext(cleanupRequest.request.params.expression, context);
				cleanupRequest.socket.respond({ id: cleanupRequest.request.id, result: { result: { type: "boolean", value } } });
			}
			finishSetup();
		}, 30);
	});
	t.after(restore);

	const client = new CdpClient("ws://mock");
	await client.connect();
	try {
		await assert.rejects(() => client.evaluateJson("({ queued: true })", 10), /Timed out/);
		await setupFinished;
		assert.equal(latePublished, false, "setup queued past the deadline must not publish JSON before cleanup");
	} finally {
		client.close();
	}
});

test("evaluateJson uses collision-resistant storage keys across clients", async (t) => {
	const originalNow = Date.now;
	Date.now = () => 1_234_567_890;
	const serializedByKey = new Map();
	const observedKeys = [];
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		if (expression.includes("Object.defineProperty(globalThis")) {
			const key = storageKeyFromSetup(expression);
			const serialized = JSON.stringify({ owner: expression.includes('owner: "a"') ? "a" : "b" });
			observedKeys.push(key);
			serializedByKey.set(key, serialized);
			socket.respond({ id: request.id, result: { result: { type: "object", value: { length: serialized.length } } } });
			return;
		}
		const key = storageKeyFromAccess(expression);
		const slice = /\.slice\((\d+), (\d+)\)/.exec(expression);
		if (slice) {
			const serialized = serializedByKey.get(key);
			socket.respond({ id: request.id, result: { result: { type: "string", value: serialized.slice(Number(slice[1]), Number(slice[2])) } } });
			return;
		}
		serializedByKey.delete(key);
		socket.respond({ id: request.id, result: { result: { type: "boolean", value: true } } });
	});
	t.after(() => {
		Date.now = originalNow;
		restore();
	});

	const clientA = new CdpClient("ws://mock-a");
	const clientB = new CdpClient("ws://mock-b");
	await Promise.all([clientA.connect(), clientB.connect()]);
	try {
		const [resultA, resultB] = await Promise.all([
			clientA.evaluateJson('({ owner: "a" })', 1_000),
			clientB.evaluateJson('({ owner: "b" })', 1_000),
		]);
		assert.deepEqual(resultA, { owner: "a" });
		assert.deepEqual(resultB, { owner: "b" });
		assert.equal(new Set(observedKeys).size, 2);
	} finally {
		clientA.close();
		clientB.close();
	}
});

test("evaluateJson applies one deadline to setup, chunks, and cleanup", async (t) => {
	const serialized = JSON.stringify({ payload: "x".repeat(300_000) });
	let chunkRequests = 0;
	let cleanupRequests = 0;
	const restore = installMockWebSocket((socket, request) => {
		const expression = request.params?.expression ?? "";
		if (expression.includes("Object.defineProperty(globalThis")) {
			socket.respond({ id: request.id, result: { result: { type: "object", value: { length: serialized.length } } } });
			return;
		}
		const slice = /\.slice\((\d+), (\d+)\)/.exec(expression);
		if (slice) {
			chunkRequests += 1;
			const delayMs = chunkRequests === 1 ? 5 : 120;
			const timer = setTimeout(() => {
				socket.respond({
					id: request.id,
					result: { result: { type: "string", value: serialized.slice(Number(slice[1]), Number(slice[2])) } },
				});
			}, delayMs);
			timer.unref?.();
			return;
		}
		cleanupRequests += 1;
		socket.respond({ id: request.id, result: { result: { type: "boolean", value: true } } });
	});
	t.after(restore);

	const client = new CdpClient("ws://mock");
	await client.connect();
	const startedAt = Date.now();
	try {
		await assert.rejects(() => client.evaluateJson("({ ignored: true })", 40), /Timed out/);
		assert.ok(Date.now() - startedAt < 100, `deadline took ${Date.now() - startedAt} ms`);
		assert.equal(chunkRequests, 2);
		assert.equal(cleanupRequests, 1);
	} finally {
		client.close();
	}
});
