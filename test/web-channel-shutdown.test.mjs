import assert from "node:assert/strict";
import test from "node:test";
import { createWebHostChannel } from "../dist/web/channel.js";

function createChannelContext(handleRequest) {
	return {
		emit: async () => { throw new Error("unused"); },
		subscribe: () => () => {},
		getSession: () => undefined,
		createSession: () => { throw new Error("unused"); },
		findSessions: () => [],
		getGatewayActions: () => [],
		getWebApps: () => [{
			name: "shutdown-test",
			mountPath: "/apps/shutdown-test",
			apiPrefix: "/api/shutdown-test",
			handleRequest,
		}],
	};
}

async function startChannel(handleRequest, options = {}) {
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false, ...options });
	await channel.start(createChannelContext(handleRequest));
	const address = channel.getAddress();
	assert.ok(address);
	return { channel, baseURL: `http://${address.host}:${address.port}` };
}

test("web host stop closes an active SSE connection without waiting for the client", async () => {
	let streamCancelled = 0;
	const encoder = new TextEncoder();
	const { channel, baseURL } = await startChannel((request) => {
		if (new URL(request.url).pathname !== "/api/shutdown-test/events") return undefined;
		return new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(": ready\n\n"));
			},
			cancel() {
				streamCancelled += 1;
			},
		}), {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	});
	const controller = new AbortController();
	const response = await fetch(`${baseURL}/api/shutdown-test/events`, { signal: controller.signal });
	assert.equal(response.status, 200);
	const reader = response.body.getReader();
	assert.equal((await reader.read()).done, false);
	const messages = [];
	const originalError = console.error;
	console.error = (...args) => messages.push(args.map(String).join(" "));
	try {
		const stopPromise = channel.stop();
		const outcome = await Promise.race([
			stopPromise.then(() => "stopped"),
			new Promise((resolve) => setTimeout(() => resolve("timed-out"), 500)),
		]);
		if (outcome === "timed-out") {
			controller.abort();
			await stopPromise;
		}

		assert.equal(outcome, "stopped");
		assert.equal((await reader.read()).done, true);
		assert.equal(streamCancelled, 1);
		assert.equal(messages.some((message) => message.includes("graceful shutdown closed 1 active event stream")), true);
	} finally {
		console.error = originalError;
	}
});

test("web host stop lets an ordinary in-flight response drain", async () => {
	let markStarted;
	const started = new Promise((resolve) => { markStarted = resolve; });
	let releaseResponse;
	const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
	const { channel, baseURL } = await startChannel(async (request) => {
		if (new URL(request.url).pathname !== "/api/shutdown-test/slow") return undefined;
		markStarted();
		await responseReady;
		return new Response("drained");
	}, { shutdownDrainTimeoutMs: 500 });

	const responsePromise = fetch(`${baseURL}/api/shutdown-test/slow`);
	await started;
	let stopSettled = false;
	const stopPromise = channel.stop().then(() => { stopSettled = true; });
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(stopSettled, false);

	releaseResponse();
	const response = await responsePromise;
	assert.equal(await response.text(), "drained");
	await stopPromise;
	assert.equal(stopSettled, true);
});

test("web host stop force-closes an ordinary response after the drain timeout", async () => {
	let markStarted;
	const started = new Promise((resolve) => { markStarted = resolve; });
	const { channel, baseURL } = await startChannel(async (request) => {
		if (new URL(request.url).pathname !== "/api/shutdown-test/hung") return undefined;
		markStarted();
		return await new Promise(() => {});
	}, { shutdownDrainTimeoutMs: 30 });
	const responsePromise = fetch(`${baseURL}/api/shutdown-test/hung`).catch((error) => error);
	await started;
	const messages = [];
	const originalWarn = console.warn;
	console.warn = (...args) => messages.push(args.map(String).join(" "));
	try {
		const startedAt = performance.now();
		await channel.stop();
		assert.ok(performance.now() - startedAt < 500);
		assert.ok((await responsePromise) instanceof Error);
		assert.equal(messages.some((message) => message.includes("graceful shutdown timed out after 30 ms; force-closing 1 active connection")), true);
	} finally {
		console.warn = originalWarn;
	}
});
