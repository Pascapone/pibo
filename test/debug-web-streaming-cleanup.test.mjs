import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildStreamingBenchmarkExpression } from "../dist/debug/web-streaming-browser-scripts.js";

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

function createHarness({ delayedSseRead, delayedSseCancel } = {}) {
	let nextId = 1;
	let sessionId = "ps-a";
	const activeTimeouts = new Map();
	const activeIntervals = new Map();
	const activeRafs = new Set();
	const observers = [];
	const performanceObservers = [];
	const clearedSnapshots = [];
	const snapshotBuffers = new Map([
		["ps-a", [{ sequence: 1, piboSessionId: "ps-a", layers: [] }]],
	]);
	const storage = new Map([["pibo.chat.debugStreaming", "before"]]);

	const body = { parentElement: null, querySelectorAll: () => [], getAttribute: () => null };
	const shell = {
		parentElement: body,
		querySelectorAll: () => [],
		getAttribute(name) {
			if (name === "data-pibo-session-id") return sessionId;
			if (name === "data-pibo-view-id") return "terminal";
			if (name === "data-pibo-state") return "idle";
			return null;
		},
	};
	const document = {
		body,
		title: "Test",
		hidden: false,
		visibilityState: "visible",
		querySelector(selector) {
			if (selector === '[data-pibo-debug="chat-shell"]') return shell;
			if (selector === "[data-pibo-selected-session-id]") return null;
			return null;
		},
		querySelectorAll: () => [],
	};

	const setTimeoutTracked = (callback, ms = 0) => {
		const id = nextId++;
		const native = setTimeout(() => {
			activeTimeouts.delete(id);
			callback();
		}, ms);
		activeTimeouts.set(id, native);
		return id;
	};
	const clearTimeoutTracked = (id) => {
		const native = activeTimeouts.get(id);
		if (native !== undefined) clearTimeout(native);
		activeTimeouts.delete(id);
	};
	const setIntervalTracked = (callback, ms = 0) => {
		const id = nextId++;
		const native = setInterval(callback, ms);
		activeIntervals.set(id, native);
		return id;
	};
	const clearIntervalTracked = (id) => {
		const native = activeIntervals.get(id);
		if (native !== undefined) clearInterval(native);
		activeIntervals.delete(id);
	};

	class MutationObserver {
		constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
		observe() { this.connected = true; }
		disconnect() { this.connected = false; }
	}
	class PerformanceObserver {
		constructor(callback) { this.callback = callback; this.connected = false; performanceObservers.push(this); }
		observe() { this.connected = true; }
		disconnect() { this.connected = false; }
	}

	let sseReadCount = 0;
	const sseReader = {
		read() {
			sseReadCount += 1;
			if (sseReadCount === 1 && delayedSseRead) return delayedSseRead.promise;
			return Promise.resolve({ done: true });
		},
		cancel: () => delayedSseCancel?.promise ?? Promise.resolve(),
	};
	const window = {
		__piboStreamingDebug: {},
		__piboTraceSnapshots: {
			clearSnapshots(id) {
				clearedSnapshots.push(id ?? "<all>");
				if (id) snapshotBuffers.delete(id);
				else snapshotBuffers.clear();
			},
			getSnapshots(id) { return snapshotBuffers.get(id) ?? []; },
			getLatestSequence(id) { return id === "ps-b" ? 2 : 1; },
		},
	};
	const context = {
		window,
		document,
		localStorage: {
			getItem(key) { return storage.has(key) ? storage.get(key) : null; },
			setItem(key, value) { storage.set(key, String(value)); },
			removeItem(key) { storage.delete(key); },
		},
		location: { href: "https://example.test/apps/chat" },
		performance: { now: () => Date.now() },
		MutationObserver,
		PerformanceObserver,
		requestAnimationFrame() { const id = nextId++; activeRafs.add(id); return id; },
		cancelAnimationFrame(id) { activeRafs.delete(id); },
		setTimeout: setTimeoutTracked,
		clearTimeout: clearTimeoutTracked,
		setInterval: setIntervalTracked,
		clearInterval: clearIntervalTracked,
		fetch: async (url) => {
			if (String(url).includes("/api/chat/events")) {
				return {
					status: 200,
					headers: { forEach() {} },
					body: { getReader: () => sseReader },
				};
			}
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({ fixture: { deltaCount: 0, reasoningDeltaCount: 0, textBytes: 0, piboSessionId: sessionId } }),
			};
		},
		console,
		URL,
		Date,
		JSON,
		Math,
		Number,
		String,
		Array,
		Object,
		Set,
		Map,
		WeakSet,
		Promise,
		RegExp,
		Error,
		Uint8Array,
		TextDecoder,
		TextEncoder,
		AbortController,
		encodeURIComponent,
	};
	context.globalThis = context;

	return {
		context,
		state: { activeTimeouts, activeIntervals, activeRafs, observers, performanceObservers, clearedSnapshots, snapshotBuffers, storage, window },
		switchSession(nextSessionId) { sessionId = nextSessionId; },
		seedSnapshots(id, snapshots) { snapshotBuffers.set(id, snapshots); },
		async cleanupNative() {
			for (const native of activeTimeouts.values()) clearTimeout(native);
			for (const native of activeIntervals.values()) clearInterval(native);
			activeTimeouts.clear();
			activeIntervals.clear();
			activeRafs.clear();
		},
	};
}

async function runBenchmark(options, harness) {
	const expression = buildStreamingBenchmarkExpression(options.durationMs ?? 0, options);
	return vm.runInNewContext(expression, harness.context, { timeout: 10_000 });
}

function assertInstrumentationClean(state) {
	assert.equal(state.observers.some((observer) => observer.connected), false);
	assert.equal(state.performanceObservers.some((observer) => observer.connected), false);
	assert.equal(state.activeTimeouts.size, 0);
	assert.equal(state.activeIntervals.size, 0);
	assert.equal(state.activeRafs.size, 0);
	assert.equal(state.window.__piboTraceSnapshotCollectionEnabled, undefined);
	assert.equal(state.storage.get("pibo.chat.debugStreaming"), "before");
}

test("SSE stop returns a detached result when read and cancel ignore abort", async () => {
	const delayedRead = deferred();
	const delayedCancel = deferred();
	const harness = createHarness({ delayedSseRead: delayedRead, delayedSseCancel: delayedCancel });
	let deadline;
	try {
		const benchmark = await Promise.race([
			runBenchmark({ durationMs: 0, startBackendFixture: true }, harness),
			new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("benchmark stop did not reach its fallback")), 3500); }),
		]);
		const returned = JSON.stringify(benchmark.sse);
		delayedRead.resolve({
			done: false,
			value: new TextEncoder().encode('id: live:1\nevent: pibo\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"late"}\n\n'),
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal(JSON.stringify(benchmark.sse), returned);
		assertInstrumentationClean(harness.state);
	} finally {
		if (deadline !== undefined) clearTimeout(deadline);
		await harness.cleanupNative();
	}
});

test("render-order capture clears every session buffer observed during navigation", async () => {
	const harness = createHarness();
	try {
		harness.context.setTimeout(() => {
			harness.switchSession("ps-b");
			harness.seedSnapshots("ps-b", [{ sequence: 2, piboSessionId: "ps-b", layers: [] }]);
		}, 20);
		harness.context.setTimeout(() => harness.switchSession("ps-a"), 90);
		const benchmark = await runBenchmark({ durationMs: 140 }, harness);
		assert.ok(benchmark.renderOrder.traceSnapshots.some((snapshot) => snapshot.piboSessionId === "ps-b"));
		assert.equal(harness.state.snapshotBuffers.has("ps-b"), false);
		assert.ok(harness.state.clearedSnapshots.includes("ps-b"));
		assertInstrumentationClean(harness.state);
	} finally {
		await harness.cleanupNative();
	}
});
