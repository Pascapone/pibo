import assert from "node:assert/strict";
import { createServer, request as createHttpRequest } from "node:http";
import test from "node:test";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { startOpenAiCodexRealtimeCallProxy } from "../dist/speech/openai-codex-realtime-call-proxy.js";
import { createOpenAiCodexSpeechProvider } from "../dist/speech/openai-codex.js";
import { PiboSpeechError } from "../dist/speech/types.js";

const OFFER_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
const ANSWER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n";

function fakeSpeechProcess({ accountType = "chatgpt", realtimeError, answerSdp = ANSWER_SDP, closeError } = {}) {
	const listeners = new Set();
	const requests = [];
	let closed = 0;
	const notify = (method, params) => {
		for (const listener of listeners) listener({ method, params });
	};
	const client = {
		subscribeNotifications(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async request(method, params) {
			requests.push({ method, params });
			if (method === "account/read") {
				return accountType === "chatgpt"
					? { account: { type: "chatgpt", email: null, planType: "pro" }, requiresOpenaiAuth: true }
					: { account: { type: "apiKey" }, requiresOpenaiAuth: true };
			}
			if (method === "thread/start") return { thread: { id: "thread-speech" } };
			if (method === "thread/realtime/start") {
				queueMicrotask(() => {
					notify("thread/realtime/started", { threadId: "thread-speech", realtimeSessionId: "rt-1", version: "v1" });
					notify("thread/realtime/sdp", { threadId: "thread-speech", sdp: answerSdp });
				});
				return {};
			}
			if (method === "thread/realtime/appendSpeech") {
				queueMicrotask(() => {
					if (realtimeError) {
						notify("thread/realtime/error", { threadId: "thread-speech", message: realtimeError });
						return;
					}
					notify("thread/realtime/transcript/done", {
						threadId: "thread-speech",
						role: "assistant",
						text: params.text,
					});
				});
				return {};
			}
			if (method === "thread/realtime/stop") return {};
			throw new Error(`Unexpected request ${method}`);
		},
	};
	return {
		process: { client, async close() { closed += 1; if (closeError) throw closeError; } },
		requests,
		closed: () => closed,
	};
}

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return address.port;
}

async function closeServer(server) {
	if (!server.listening) return;
	await new Promise((resolve) => server.close(resolve));
}

function deferredValue() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

test("plugins register discoverable speech providers and route sessions", async () => {
	const calls = [];
	const provider = {
		id: "fixture-speech",
		name: "Fixture Speech",
		description: "Fixture provider",
		isConfigured: () => true,
		async startSession(input) {
			calls.push({ type: "start", input });
			return {
				sessionId: "session-fixture",
				answerSdp: ANSWER_SDP,
				async speak(speechInput) { calls.push({ type: "speak", sessionId: "session-fixture", input: speechInput }); },
				async stop() { calls.push({ type: "stop", sessionId: "session-fixture" }); },
			};
		},
	};
	const plugin = definePiboPlugin({
		id: "test.speech",
		name: "Test Speech Plugin",
		register(api) { api.registerSpeechProvider(provider); },
	});
	const registry = PiboPluginRegistry.create({ plugins: [plugin] });

	assert.deepEqual(await registry.getSpeechProviderInfos(), [{
		id: "fixture-speech",
		name: "Fixture Speech",
		description: "Fixture provider",
		configured: true,
		pluginId: "test.speech",
		pluginName: "Test Speech Plugin",
	}]);
	assert.deepEqual(await registry.startSpeechSession("fixture-speech", { offerSdp: OFFER_SDP, text: "hello" }), {
		providerId: "fixture-speech",
		sessionId: "session-fixture",
		answerSdp: ANSWER_SDP,
	});
	await registry.speakSpeechSession("session-fixture", { text: "hello" });
	assert.deepEqual(calls, [
		{ type: "start", input: { offerSdp: OFFER_SDP, text: "hello" } },
		{ type: "speak", sessionId: "session-fixture", input: { text: "hello" } },
		{ type: "stop", sessionId: "session-fixture" },
	]);
	assert.throws(() => PiboPluginRegistry.create({ plugins: [plugin, definePiboPlugin({
		id: "test.speech.duplicate",
		register(api) { api.registerSpeechProvider(provider); },
	})] }), /Duplicate speech provider/);
});

test("speech admission reserves pending capacity and releases rejected, failed, and aborted starts exactly once", async () => {
	const pending = [];
	const stopped = new Map();
	let launchSequence = 0;
	let failNext = false;
	const provider = {
		id: "barrier-speech",
		name: "Barrier Speech",
		async startSession(_input, options = {}) {
			launchSequence += 1;
			if (failNext) {
				failNext = false;
				throw new Error("deterministic provider failure");
			}
			const launch = deferredValue();
			const record = { id: `provider-session-${launchSequence}`, launch, signal: options.signal };
			pending.push(record);
			options.signal?.addEventListener("abort", () => launch.reject(options.signal.reason), { once: true });
			const result = await launch.promise;
			return {
				...result,
				async speak() {},
				async stop() { stopped.set(record.id, (stopped.get(record.id) ?? 0) + 1); },
			};
		},
	};
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({
		id: "test.barrier-speech",
		register(api) { api.registerSpeechProvider(provider); },
	})] });
	const request = { offerSdp: OFFER_SDP, text: "hello" };

	const starts = Array.from({ length: 9 }, () => registry.startSpeechSession("barrier-speech", request));
	try {
		await Promise.resolve();
		assert.equal(pending.length, 8, "the ninth concurrent start must be rejected before provider launch");
		for (const record of pending) record.launch.resolve({ sessionId: record.id, answerSdp: ANSWER_SDP });
		const results = await Promise.allSettled(starts);
		assert.equal(results.filter((result) => result.status === "fulfilled").length, 8);
		assert.equal(results.filter((result) => result.status === "rejected").length, 1);
		for (const result of results) {
			if (result.status === "fulfilled") await registry.stopSpeechSession(result.value.sessionId);
		}

		failNext = true;
		await assert.rejects(registry.startSpeechSession("barrier-speech", request), /deterministic provider failure/);

		const abortController = new AbortController();
		const aborted = registry.startSpeechSession("barrier-speech", request, { signal: abortController.signal });
		await Promise.resolve();
		const abortedRecord = pending.at(-1);
		abortController.abort(new Error("deterministic client abort"));
		await assert.rejects(aborted, /deterministic client abort/);

		const replacement = registry.startSpeechSession("barrier-speech", request);
		await Promise.resolve();
		const replacementRecord = pending.at(-1);
		replacementRecord.launch.resolve({ sessionId: replacementRecord.id, answerSdp: ANSWER_SDP });
		const replacementResult = await replacement;
		await registry.stopSpeechSession(replacementResult.sessionId);
		assert.equal(stopped.get(replacementResult.sessionId), 1);
		assert.equal(stopped.get(abortedRecord.id) ?? 0, 0);
	} finally {
		for (const record of pending) {
			record.launch.resolve({ sessionId: record.id, answerSdp: ANSWER_SDP });
		}
		await Promise.allSettled(starts);
		await registry.disposeSpeechProviders();
	}
});

test("duplicate provider session ids close only the unpublished owner", async () => {
	const stops = [];
	let launch = 0;
	const provider = {
		id: "duplicate-speech",
		name: "Duplicate Speech",
		async startSession() {
			launch += 1;
			const owner = launch;
			return {
				sessionId: "duplicate-provider-id",
				answerSdp: ANSWER_SDP,
				async speak() {},
				async stop() { stops.push(owner); },
			};
		},
	};
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({
		id: "test.duplicate-speech",
		register(api) { api.registerSpeechProvider(provider); },
	})] });
	const first = await registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "first" });
	await assert.rejects(
		registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "second" }),
		/Duplicate session|duplicate session/i,
	);
	assert.deepEqual(stops, [2]);
	await registry.stopSpeechSession(first.sessionId);
	assert.deepEqual(stops, [2, 1]);
});

test("an abort returns promptly while a non-cooperative startup remains capacity-owned until late cleanup", async () => {
	const startup = deferredValue();
	const entered = deferredValue();
	const lateStopped = deferredValue();
	let launches = 0;
	let stops = 0;
	const provider = {
		id: "late-cleanup-speech",
		name: "Late Cleanup Speech",
		async startSession() {
			launches += 1;
			entered.resolve();
			return await startup.promise;
		},
	};
	const registry = PiboPluginRegistry.create({
		maxActiveSpeechSessions: 1,
		plugins: [definePiboPlugin({
			id: "test.late-cleanup-speech",
			register(api) { api.registerSpeechProvider(provider); },
		})],
	});
	const controller = new AbortController();
	const aborted = registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "abort" }, { signal: controller.signal });
	await entered.promise;
	controller.abort(new Error("caller disconnected"));
	await assert.rejects(aborted, /caller disconnected/);
	await assert.rejects(
		registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "still reserved" }),
		(error) => error instanceof PiboSpeechError && error.code === "capacity_exceeded",
	);
	startup.resolve({
		sessionId: "late-session",
		answerSdp: ANSWER_SDP,
		async speak() {},
		async stop() { stops += 1; lateStopped.resolve(); },
	});
	await lateStopped.promise;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(stops, 1);
	const replacement = await registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "replacement" });
	assert.equal(launches, 2);
	await registry.stopSpeechSession(replacement.sessionId);
});

test("abort at provider-result publication closes the unpublished handle exactly once", async () => {
	const controller = new AbortController();
	let stops = 0;
	const provider = {
		id: "publication-abort-speech",
		name: "Publication Abort Speech",
		async startSession() {
			controller.abort(new Error("abort at publication"));
			return {
				sessionId: "unpublished-session",
				answerSdp: ANSWER_SDP,
				async speak() {},
				async stop() { stops += 1; },
			};
		},
	};
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({
		id: "test.publication-abort-speech",
		register(api) { api.registerSpeechProvider(provider); },
	})] });
	await assert.rejects(
		registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "publication" }, { signal: controller.signal }),
		/abort at publication/,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(stops, 1);
});

test("speak and stop share one close attempt even when process close throws", async () => {
	const speaking = deferredValue();
	let stopCalls = 0;
	const closeError = new Error("deterministic process close failure");
	const provider = {
		id: "close-race-speech",
		name: "Close Race Speech",
		async startSession() {
			return {
				sessionId: "close-race-session",
				answerSdp: ANSWER_SDP,
				async speak() { await speaking.promise; },
				async stop() { stopCalls += 1; throw closeError; },
			};
		},
	};
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({
		id: "test.close-race-speech",
		register(api) { api.registerSpeechProvider(provider); },
	})] });
	const session = await registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "race" });
	const speak = registry.speakSpeechSession(session.sessionId, { text: "race" });
	const stop = registry.stopSpeechSession(session.sessionId);
	await assert.rejects(stop, /deterministic process close failure/);
	speaking.resolve();
	await assert.rejects(speak, /deterministic process close failure/);
	assert.equal(stopCalls, 1);
	await registry.stopSpeechSession(session.sessionId);
	assert.equal(stopCalls, 1);
});

test("gateway disposal aborts and drains provider startup before provider disposal", async () => {
	const startupEntered = deferredValue();
	let providerDisposeCalls = 0;
	const provider = {
		id: "gateway-dispose-speech",
		name: "Gateway Dispose Speech",
		async startSession(_input, options = {}) {
			startupEntered.resolve();
			return await new Promise((_resolve, reject) => {
				const rejectAborted = () => reject(options.signal.reason);
				if (options.signal?.aborted) rejectAborted();
				else options.signal?.addEventListener("abort", rejectAborted, { once: true });
			});
		},
		async dispose() { providerDisposeCalls += 1; },
	};
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({
		id: "test.gateway-dispose-speech",
		register(api) { api.registerSpeechProvider(provider); },
	})] });
	const gateway = new PiboGatewayServer({ host: "127.0.0.1", port: 0, startChannels: false, persistSession: false, pluginRegistry: registry });
	await gateway.start();
	const start = registry.startSpeechSession(provider.id, { offerSdp: OFFER_SDP, text: "dispose" });
	await startupEntered.promise;
	await gateway.stop();
	await assert.rejects(start, /shutting down/i);
	assert.equal(providerDisposeCalls, 1);
});

test("idle expiry and restart disposal close every published session exactly once", async () => {
	const idleClosed = deferredValue();
	const stopCounts = new Map();
	const createRegistry = () => {
		const provider = {
			id: "restart-speech",
			name: "Restart Speech",
			async startSession() {
				return {
					sessionId: "ephemeral-session",
					answerSdp: ANSWER_SDP,
					async speak() {},
					async stop() {
						stopCounts.set(this, (stopCounts.get(this) ?? 0) + 1);
						idleClosed.resolve();
					},
				};
			},
		};
		return PiboPluginRegistry.create({
			speechSessionIdleTimeoutMs: 1,
			plugins: [definePiboPlugin({ id: "test.restart-speech", register(api) { api.registerSpeechProvider(provider); } })],
		});
	};
	const first = createRegistry();
	await first.startSpeechSession("restart-speech", { offerSdp: OFFER_SDP, text: "idle" });
	await idleClosed.promise;
	await first.disposeSpeechProviders();
	const second = createRegistry();
	const restarted = await second.startSpeechSession("restart-speech", { offerSdp: OFFER_SDP, text: "restart" });
	await second.stopSpeechSession(restarted.sessionId);
	await second.disposeSpeechProviders();
	assert.deepEqual([...stopCounts.values()], [1, 1]);
});

test("OpenAI Codex realtime call adapter preserves subscription auth and normalizes request metadata", async (t) => {
	let received;
	const target = createServer((request, response) => {
		void (async () => {
			const chunks = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			received = {
				url: request.url,
				authorization: request.headers.authorization,
				accountId: request.headers["chatgpt-account-id"],
				accept: request.headers.accept,
				alpha: request.headers["openai-alpha"],
				originator: request.headers.originator,
				sessionId: request.headers["session-id"],
				threadId: request.headers["thread-id"],
				cookie: request.headers.cookie,
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			};
			response.statusCode = 201;
			response.setHeader("content-type", "application/sdp");
			response.setHeader("location", "/backend-api/codex/realtime/calls/rtc-test");
			response.end(ANSWER_SDP);
		})().catch(() => response.destroy());
	});
	const targetPort = await listen(target);
	t.after(() => closeServer(target));
	const proxy = await startOpenAiCodexRealtimeCallProxy({
		targetBaseUrl: `http://127.0.0.1:${targetPort}/backend-api/codex/`,
	});
	t.after(() => proxy.close());

	const response = await fetch(`${proxy.baseUrl}/realtime/calls?intent=quicksilver&architecture=avas`, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			authorization: "Bearer subscription-token",
			"chatgpt-account-id": "account-1",
			"openai-alpha": "quicksilver=v1",
			originator: "pibo",
			"session-id": "session-1",
			"thread-id": "thread-1",
			cookie: "must-not-forward=secret",
		},
		body: JSON.stringify({
			sdp: OFFER_SDP,
			session: {
				model: "gpt-live-1-boulder-alpha",
				instructions: "Speak this text",
				audio: { output: { voice: "cove" } },
			},
		}),
	});

	assert.equal(response.status, 201);
	assert.equal(await response.text(), ANSWER_SDP);
	assert.equal(response.headers.get("location"), "/backend-api/codex/realtime/calls/rtc-test");
	assert.deepEqual(received, {
		url: "/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
		authorization: "Bearer subscription-token",
		accountId: "account-1",
		accept: "application/sdp",
		alpha: "quicksilver=v2",
		originator: "codex_cli_rs",
		sessionId: "session-1",
		threadId: "thread-1",
		cookie: undefined,
		body: {
			sdp: OFFER_SDP,
			session: {
				model: "gpt-live-1-codex",
				instructions: "Speak this text",
				audio: { output: { voice: "cove" } },
			},
		},
	});
});

test("OpenAI Codex realtime call adapter bounds both request and upstream response bodies", async (t) => {
	let targetCalls = 0;
	const target = createServer((_request, response) => {
		targetCalls += 1;
		response.statusCode = 200;
		response.setHeader("content-type", "application/sdp");
		response.end(Buffer.alloc(512 * 1024 + 1, 120));
	});
	const targetPort = await listen(target);
	t.after(() => closeServer(target));
	const proxy = await startOpenAiCodexRealtimeCallProxy({ targetBaseUrl: `http://127.0.0.1:${targetPort}/backend-api/codex/` });
	t.after(() => proxy.close());

	const oversizedResponse = await fetch(`${proxy.baseUrl}/realtime/calls`, {
		method: "POST",
		headers: { authorization: "Bearer subscription-token", "content-type": "application/json" },
		body: JSON.stringify({ sdp: OFFER_SDP, session: {} }),
	});
	assert.equal(oversizedResponse.status, 502);
	assert.match((await oversizedResponse.json()).error, /response is too large/);

	const oversizedRequest = await fetch(`${proxy.baseUrl}/realtime/calls`, {
		method: "POST",
		headers: { authorization: "Bearer subscription-token", "content-type": "application/json" },
		body: JSON.stringify({ sdp: "x".repeat(512 * 1024), session: {} }),
	});
	assert.equal(oversizedRequest.status, 413);
	assert.equal(targetCalls, 1);
});

test("OpenAI Codex realtime call adapter bounds stalled request bodies and closes active sockets", async (t) => {
	const proxy = await startOpenAiCodexRealtimeCallProxy({ requestBodyTimeoutMs: 40 });
	t.after(() => proxy.close());

	const openStalledRequest = () => {
		const url = new URL(`${proxy.baseUrl}/realtime/calls`);
		const request = createHttpRequest({
			host: url.hostname,
			port: url.port,
			path: url.pathname,
			method: "POST",
			headers: {
				authorization: "Bearer subscription-token",
				"content-type": "application/json",
				"transfer-encoding": "chunked",
			},
		});
		request.on("error", () => {});
		request.write('{"sdp":"partial');
		return request;
	};

	const timedOut = openStalledRequest();
	await Promise.race([
		new Promise((resolve) => timedOut.once("close", resolve)),
		new Promise((_, reject) => setTimeout(() => reject(new Error("stalled request deadline did not close the socket")), 500)),
	]);

	const activeDuringClose = openStalledRequest();
	const activeRequestClosed = new Promise((resolve) => activeDuringClose.once("close", resolve));
	await new Promise((resolve) => setTimeout(resolve, 10));
	const firstClose = proxy.close();
	const secondClose = proxy.close();
	assert.equal(firstClose, secondClose);
	await Promise.race([
		firstClose,
		new Promise((_, reject) => setTimeout(() => reject(new Error("proxy close did not terminate the active request")), 500)),
	]);
	await Promise.race([
		activeRequestClosed,
		new Promise((_, reject) => setTimeout(() => reject(new Error("proxy close did not close the client request")), 500)),
	]);
	assert.equal(activeDuringClose.destroyed, true);
});

test("OpenAI Codex realtime call adapter uses loopback-only unpredictable routes", async (t) => {
	const first = await startOpenAiCodexRealtimeCallProxy();
	const second = await startOpenAiCodexRealtimeCallProxy();
	t.after(() => Promise.allSettled([first.close(), second.close()]));
	assert.equal(new URL(first.baseUrl).hostname, "127.0.0.1");
	assert.equal(new URL(second.baseUrl).hostname, "127.0.0.1");
	assert.notEqual(new URL(first.baseUrl).pathname, new URL(second.baseUrl).pathname);
});

test("OpenAI Codex speech uses subscription auth and WebRTC", async () => {
	const fixture = fakeSpeechProcess();
	const starts = [];
	const provider = createOpenAiCodexSpeechProvider({
		startProcess: async (input) => {
			starts.push(input);
			return fixture.process;
		},
	});

	assert.equal(await provider.isConfigured(), true);
	const session = await provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" });
	assert.equal(session.answerSdp, ANSWER_SDP);
	assert.ok(session.sessionId);
	await session.speak({ text: "Hello from Pibo" });
	assert.deepEqual(starts.map((start) => ({ experimentalApi: start.experimentalApi, realtimeConversation: start.realtimeConversation })), [
		{ experimentalApi: false, realtimeConversation: false },
		{ experimentalApi: true, realtimeConversation: true },
	]);
	assert.ok(fixture.requests.some((request) => (
		request.method === "thread/realtime/start"
		&& request.params.outputModality === "audio"
		&& request.params.version === "v3"
		&& request.params.prompt.includes("literal text-to-speech renderer")
		&& request.params.prompt.includes(JSON.stringify("Hello from Pibo"))
		&& request.params.transport.type === "webrtc"
		&& request.params.transport.sdp === OFFER_SDP
	)));
	assert.ok(fixture.requests.some((request) => request.method === "thread/realtime/appendSpeech" && request.params.text === "Hello from Pibo"));
	assert.equal(fixture.closed(), 2);
});

test("OpenAI Codex speech reports realtime provider errors", async () => {
	const fixture = fakeSpeechProcess({ realtimeError: "realtime speech is unavailable" });
	const provider = createOpenAiCodexSpeechProvider({ startProcess: async () => fixture.process });
	const session = await provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" });
	await assert.rejects(
		session.speak({ text: "Hello from Pibo" }),
		(error) => error instanceof PiboSpeechError
			&& error.message === "OpenAI Codex speech generation failed: realtime speech is unavailable",
	);
	assert.equal(fixture.closed(), 1);
});

test("OpenAI Codex speech refuses API-key accounts", async () => {
	const fixture = fakeSpeechProcess({ accountType: "apiKey" });
	const provider = createOpenAiCodexSpeechProvider({ startProcess: async () => fixture.process });
	assert.equal(await provider.isConfigured(), false);
	await assert.rejects(
		provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" }),
		(error) => error instanceof PiboSpeechError && error.code === "not_configured",
	);
	assert.equal(fixture.requests.some((request) => request.method.startsWith("thread/")), false);
});

test("OpenAI Codex speech rejects malformed SDP and closes failed startup exactly once", async () => {
	let starts = 0;
	const provider = createOpenAiCodexSpeechProvider({
		startProcess: async () => {
			starts += 1;
			return fakeSpeechProcess().process;
		},
	});
	await assert.rejects(
		provider.startSession({ offerSdp: "not-sdp", text: "hello" }),
		(error) => error instanceof PiboSpeechError && error.code === "invalid_offer",
	);
	await assert.rejects(
		provider.startSession({ offerSdp: `v=0${"x".repeat(256_000)}`, text: "hello" }),
		(error) => error instanceof PiboSpeechError && error.code === "invalid_offer",
	);
	assert.equal(starts, 0);

	const malformedAnswer = fakeSpeechProcess({ answerSdp: "not-sdp" });
	const malformedProvider = createOpenAiCodexSpeechProvider({ startProcess: async () => malformedAnswer.process });
	await assert.rejects(
		malformedProvider.startSession({ offerSdp: OFFER_SDP, text: "hello" }),
		(error) => error instanceof PiboSpeechError && error.code === "provider_error",
	);
	assert.equal(malformedAnswer.closed(), 1);

	const oversizedAnswer = fakeSpeechProcess({ answerSdp: `v=0${"x".repeat(256_000)}` });
	const oversizedProvider = createOpenAiCodexSpeechProvider({ startProcess: async () => oversizedAnswer.process });
	await assert.rejects(
		oversizedProvider.startSession({ offerSdp: OFFER_SDP, text: "hello" }),
		(error) => error instanceof PiboSpeechError && error.code === "provider_error",
	);
	assert.equal(oversizedAnswer.closed(), 1);
});

test("OpenAI Codex speech removes ownership even when process close throws", async () => {
	const fixture = fakeSpeechProcess({ closeError: new Error("deterministic process close failure") });
	const provider = createOpenAiCodexSpeechProvider({ startProcess: async () => fixture.process });
	const session = await provider.startSession({ offerSdp: OFFER_SDP, text: "hello" });
	await assert.rejects(session.stop(), /deterministic process close failure/);
	await session.stop();
	assert.equal(fixture.closed(), 1);
	await provider.dispose();
	assert.equal(fixture.closed(), 1);
});
