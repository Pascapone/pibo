import assert from "node:assert/strict";
import test from "node:test";
import { RoutedSession } from "../dist/core/routed-session.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

function deferred() {
	let resolve;
	const promise = new Promise((next) => { resolve = next; });
	return { promise, resolve };
}

function assistantSuccess(text = "done") {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			stopReason: "stop",
		},
	};
}

function assistantError(message = "temporary 503") {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: message,
		},
	};
}

function webStart(id, query = "docs") {
	return {
		type: "response.output_item.added",
		item: {
			type: "web_search_call",
			id,
			status: "in_progress",
			action: { type: "search", query },
		},
	};
}

function webProvisionalFinish(id) {
	return { type: "response.web_search_call.completed", item_id: id };
}

function webFinish(id, query = "docs") {
	return {
		type: "response.output_item.done",
		item: {
			type: "web_search_call",
			id,
			status: "completed",
			action: {
				type: "search",
				query,
				sources: [{ title: `${query} source`, url: `https://example.com/${encodeURIComponent(query)}` }],
			},
		},
	};
}

function nativeStart(id, query = "docs") {
	return {
		type: "tool_execution_start",
		toolCallId: id,
		toolName: "web_search",
		args: { query },
	};
}

function nativeFinish(id, query = "docs") {
	return {
		type: "tool_execution_end",
		toolCallId: id,
		toolName: "web_search",
		result: { query },
		isError: false,
	};
}

async function waitForEvent(events, predicate, message = "event did not arrive") {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const found = events.find(predicate);
		if (found) return found;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail(`${message}: ${JSON.stringify(events)}`);
}

function createHarness({ onPrompt, onRecovery, onAbort } = {}) {
	let listener;
	let routed;
	const events = [];
	const session = {
		agent: {
			streamFunction() {},
			async continue() {},
		},
		messages: [],
		settingsManager: {
			getCompactionSettings() { return { enabled: false }; },
			getRetrySettings() { return { enabled: true, maxRetries: 3, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 60_000 }; },
		},
		subscribe(callback) {
			listener = callback;
			return () => {};
		},
		async prompt(text) {
			await onPrompt?.(api(), text);
		},
		async sendCustomMessage(message) {
			await onRecovery?.(api(), message);
		},
		async waitForIdle() {},
		async abort() {
			await onAbort?.(api());
		},
		async compact() {},
		isStreaming: false,
		thinkingLevel: "off",
		supportsThinking() { return false; },
		getContextUsage() { return null; },
		getActiveToolNames() { return []; },
		getAllTools() { return []; },
		setActiveToolsByName() {},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getPiSessionId() { return "pi-web-search-adversarial"; },
			getSessionFile() { return undefined; },
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	routed = new RoutedSession("route:web-search-adversarial", runtime, (event) => events.push(event), registry, false);
	routed.enableProviderWebSearchObservation();

	function api() {
		return {
			raw(event) { routed.observeProviderResponseEvent(event); },
			pi(event) { listener(event); },
		};
	}

	return {
		routed,
		events,
		enqueue(id = "turn-web-search") {
			routed.enqueueMessage({
				type: "message",
				piboSessionId: "route:web-search-adversarial",
				id,
				text: id,
				source: "user",
			});
		},
		async finished(id = "turn-web-search") {
			return await waitForEvent(events, (event) => event.type === "message_finished" && event.eventId === id);
		},
		async dispose() {
			await routed.dispose();
		},
	};
}

function webLifecycle(events) {
	return events.filter((event) =>
		(event.type === "tool_execution_started" || event.type === "tool_execution_finished") &&
		event.toolName === "web_search");
}

test("raw provider and Pi-native duplicates with one stable id emit one provider-rich lifecycle", async () => {
	const harness = createHarness({
		onPrompt({ raw, pi }) {
			pi(nativeStart("ws_same", "native query"));
			raw(webStart("ws_same", "provider query"));
			pi(nativeFinish("ws_same", "native query"));
			raw(webProvisionalFinish("ws_same"));
			raw(webFinish("ws_same", "provider query"));
			pi(assistantSuccess());
		},
	});
	try {
		harness.enqueue();
		await harness.finished();
		const lifecycle = webLifecycle(harness.events);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_started").length, 1);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_finished").length, 1);
		assert.equal(lifecycle[0].toolCallId, "provider:web_search:ws_same");
		assert.deepEqual(lifecycle.at(-1).result, {
			actionType: "search",
			query: "provider query",
			sources: [{ title: "provider query source", url: "https://example.com/provider%20query" }],
			sourceCount: 1,
		});
		const types = harness.events.map((event) => event.type);
		assert.ok(types.indexOf("tool_execution_finished") < types.indexOf("assistant_message"));
		assert.ok(types.indexOf("assistant_message") < types.indexOf("message_finished"));
	} finally {
		await harness.dispose();
	}
});

test("Pi-native completion remains a fallback when raw observation supplies no terminal item", async () => {
	const harness = createHarness({
		onPrompt({ raw, pi }) {
			raw(webStart("ws_native_fallback", "fallback query"));
			pi(nativeFinish("ws_native_fallback", "fallback query"));
			pi(assistantSuccess());
		},
	});
	try {
		harness.enqueue();
		await harness.finished();
		const lifecycle = webLifecycle(harness.events);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_started").length, 1);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_finished").length, 1);
		assert.deepEqual(lifecycle.at(-1).result, { query: "fallback query" });
		assert.ok(harness.events.indexOf(lifecycle.at(-1)) < harness.events.findIndex((event) => event.type === "message_finished"));
	} finally {
		await harness.dispose();
	}
});

test("completion-only and provisional-only provider streams close before message completion", async (t) => {
	for (const scenario of ["completion-only", "provisional-only"]) {
		await t.test(scenario, async () => {
			let finishCountAtProvisional = -1;
			const harness = createHarness({
				onPrompt({ raw, pi }) {
					if (scenario === "completion-only") {
						raw(webFinish("ws_terminal", "terminal query"));
					} else {
						raw(webStart("ws_terminal", "terminal query"));
						raw(webProvisionalFinish("ws_terminal"));
						finishCountAtProvisional = webLifecycle(harness.events).filter((event) => event.type === "tool_execution_finished").length;
						raw({ type: "response.completed", response: { id: "response_terminal", status: "completed" } });
					}
					pi(assistantSuccess());
				},
			});
			try {
				harness.enqueue();
				await harness.finished();
				if (scenario === "provisional-only") assert.equal(finishCountAtProvisional, 0);
				const lifecycle = webLifecycle(harness.events);
				assert.equal(lifecycle.filter((event) => event.type === "tool_execution_started").length, 1);
				assert.equal(lifecycle.filter((event) => event.type === "tool_execution_finished").length, 1);
				const types = harness.events.map((event) => event.type);
				assert.ok(types.indexOf("tool_execution_finished") < types.indexOf("assistant_message"));
				assert.ok(types.indexOf("assistant_message") < types.indexOf("message_finished"));
			} finally {
				await harness.dispose();
			}
		});
	}
});

test("stable ids deduplicate while different provider ids remain separate lifecycles", async () => {
	const harness = createHarness({
		onPrompt({ raw, pi }) {
			for (const id of ["ws_one", "ws_one", "ws_two"]) raw(webStart(id, id));
			raw(webFinish("ws_one", "ws_one"));
			raw(webFinish("ws_one", "ws_one"));
			raw(webFinish("ws_two", "ws_two"));
			pi(assistantSuccess());
		},
	});
	try {
		harness.enqueue();
		await harness.finished();
		assert.deepEqual(
			webLifecycle(harness.events).map((event) => `${event.type}:${event.toolCallId}`),
			[
				"tool_execution_started:provider:web_search:ws_one",
				"tool_execution_started:provider:web_search:ws_two",
				"tool_execution_finished:provider:web_search:ws_one",
				"tool_execution_finished:provider:web_search:ws_two",
			],
		);
	} finally {
		await harness.dispose();
	}
});

test("two concurrent routed sessions isolate the same provider id across the first await", async () => {
	const release = deferred();
	let arrived = 0;
	function concurrentHarness(query) {
		return createHarness({
			async onPrompt({ raw, pi }) {
				raw(webStart("ws_shared", query));
				arrived += 1;
				if (arrived === 2) release.resolve();
				await release.promise;
				raw(webFinish("ws_shared", query));
				pi(assistantSuccess(query));
			},
		});
	}
	const first = concurrentHarness("first query");
	const second = concurrentHarness("second query");
	try {
		first.enqueue("turn-first");
		second.enqueue("turn-second");
		await Promise.all([first.finished("turn-first"), second.finished("turn-second")]);
		assert.equal(webLifecycle(first.events).at(-1).result.query, "first query");
		assert.equal(webLifecycle(second.events).at(-1).result.query, "second query");
		assert.equal(webLifecycle(first.events).length, 2);
		assert.equal(webLifecycle(second.events).length, 2);
	} finally {
		release.resolve();
		await Promise.all([first.dispose(), second.dispose()]);
	}
});

test("provider retry preserves one turn and lets the richer same-id finish supersede provisional completion", async () => {
	const harness = createHarness({
		onPrompt({ raw, pi }) {
			raw(webStart("ws_retry", "retry query"));
			raw(webProvisionalFinish("ws_retry"));
			pi(assistantError());
		},
		onRecovery({ raw, pi }) {
			raw(webStart("ws_retry", "retry query"));
			raw(webFinish("ws_retry", "retry query"));
			pi(assistantSuccess("recovered"));
		},
	});
	try {
		harness.enqueue("turn-retry");
		await harness.finished("turn-retry");
		const lifecycle = webLifecycle(harness.events);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_started").length, 1);
		assert.equal(lifecycle.filter((event) => event.type === "tool_execution_finished").length, 1);
		assert.equal(lifecycle.at(-1).result.query, "retry query");
		assert.equal(harness.events.some((event) => event.type === "session_error"), false);
		assert.equal(harness.events.filter((event) => event.type === "message_finished").length, 1);
	} finally {
		await harness.dispose();
	}
});

test("cancelling a provisional lifecycle emits no synthetic finish or message terminal", async () => {
	const releasePrompt = deferred();
	const harness = createHarness({
		async onPrompt({ raw }) {
			raw(webStart("ws_cancel", "cancel query"));
			raw(webProvisionalFinish("ws_cancel"));
			await releasePrompt.promise;
		},
		onAbort() {
			releasePrompt.resolve();
		},
	});
	try {
		harness.enqueue("turn-cancel");
		await waitForEvent(harness.events, (event) => event.type === "tool_execution_started", "web search did not start");
		assert.equal(await harness.routed.cancelMessage("turn-cancel"), true);
		assert.equal(webLifecycle(harness.events).filter((event) => event.type === "tool_execution_finished").length, 0);
		assert.equal(harness.events.some((event) => event.type === "message_finished"), false);
		assert.equal(harness.events.some((event) => event.type === "session_error"), false);
	} finally {
		releasePrompt.resolve();
		await harness.dispose();
	}
});
