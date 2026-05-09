import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

function userMessage(text) {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function assistantMessage(text) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "responses",
		provider: "openai",
		model: "test-model",
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function seedConversation(runtime) {
	const manager = runtime.session.sessionManager;
	const firstUserId = manager.appendMessage(userMessage("first user turn"));
	manager.appendMessage(assistantMessage("first assistant turn"));
	const secondUserId = manager.appendMessage(userMessage("second user turn"));
	manager.appendMessage(assistantMessage("second assistant turn"));
	return { firstUserId, secondUserId };
}

function enableThinkingSupport(runtime) {
	runtime.session.state.model = { provider: "test", id: "reasoning-test-model", reasoning: true };
}

async function createSessionHarness() {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-session-actions-"));
	const profile = new InitialSessionContextBuilder("session-actions-test").createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: true, profile });
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const events = [];
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	return {
		cwd,
		routed,
		events,
		async dispose() {
			const current = routed.getCurrentSession();
			await routed.dispose();
			await rm(cwd, { recursive: true, force: true });
			if (current.sessionFile) {
				await rm(dirname(current.sessionFile), { recursive: true, force: true });
			}
		},
	};
}

test("thinking action without level reports current level without cycling", async () => {
	const harness = await createSessionHarness();
	try {
		enableThinkingSupport(harness.routed.runtime);
		harness.routed.runtime.session.setThinkingLevel("medium");

		const result = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "thinking",
		});

		assert.equal(result.type, "execution_result");
		assert.equal(result.result.level, "medium");
		assert.equal(harness.routed.runtime.session.thinkingLevel, "medium");
	} finally {
		await harness.dispose();
	}
});

test("fast action toggles independently of thinking level", async () => {
	const harness = await createSessionHarness();
	try {
		enableThinkingSupport(harness.routed.runtime);
		harness.routed.runtime.session.setThinkingLevel("medium");

		const fast = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "fast_mode",
		});
		assert.equal(fast.type, "execution_result");
		assert.equal(fast.result.mode, "fast");
		assert.equal(harness.routed.runtime.session.thinkingLevel, "medium");
		assert.equal(harness.routed.getStatus().fastMode, true);

		const thinking = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "thinking",
			params: { level: "high" },
		});
		assert.equal(thinking.type, "execution_result");
		assert.equal(thinking.result.level, "high");
		assert.equal(harness.routed.getStatus().fastMode, true);

		const normal = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "fast_mode",
		});
		assert.equal(normal.type, "execution_result");
		assert.equal(normal.result.mode, "normal");
		assert.equal(harness.routed.runtime.session.thinkingLevel, "high");
		assert.equal(harness.routed.getStatus().fastMode, false);
	} finally {
		await harness.dispose();
	}
});

test("session fork replaces the active Pi session and can switch back", async () => {
	const harness = await createSessionHarness();
	try {
		const ids = seedConversation(harness.routed.runtime);
		const before = harness.routed.getCurrentSession();

		const candidates = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.fork_candidates",
		});
		assert.equal(candidates.type, "execution_result");
		assert.equal(candidates.result.messages.length, 2);

		const forked = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.fork",
			params: { entryId: ids.secondUserId },
		});
		assert.equal(forked.type, "execution_result");
		assert.equal(forked.result.previous.sessionFile, before.sessionFile);
		assert.notEqual(forked.result.current.sessionFile, before.sessionFile);
		assert.equal(forked.result.selectedText, "second user turn");
		assert.equal(harness.routed.getCurrentSession().sessionFile, forked.result.current.sessionFile);

		const switched = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.switch",
			params: { sessionFile: before.sessionFile },
		});
		assert.equal(switched.type, "execution_result");
		assert.equal(switched.result.current.sessionFile, before.sessionFile);
	} finally {
		await harness.dispose();
	}
});

test("session clone replaces the active Pi session at the current leaf", async () => {
	const harness = await createSessionHarness();
	try {
		seedConversation(harness.routed.runtime);
		const before = harness.routed.getCurrentSession();

		const cloned = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.clone",
		});
		assert.equal(cloned.type, "execution_result");
		assert.equal(cloned.result.previous.sessionFile, before.sessionFile);
		assert.notEqual(cloned.result.current.sessionFile, before.sessionFile);
		assert.equal(cloned.result.current.leafId, before.leafId);
	} finally {
		await harness.dispose();
	}
});

test("routed session surfaces assistant provider errors with the active event id", async () => {
	let listener;
	const events = [];
	const runtime = {
		cwd: process.cwd(),
		session: {
			subscribe(callback) {
				listener = callback;
				return () => {};
			},
			async prompt() {
				listener({
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						stopReason: "error",
						errorMessage: "Invalid prompt_cache_key",
					},
				});
			},
			isStreaming: false,
			getActiveToolNames() {
				return [];
			},
			getAllTools() {
				return [];
			},
			resourceLoader: {
				getSkills() {
					return { skills: [] };
				},
			},
			sessionManager: {
				getPiSessionId() {
					return "session-id";
				},
				getSessionFile() {
					return undefined;
				},
				getLeafId() {
					return null;
				},
				getHeader() {
					return undefined;
				},
			},
		},
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	});
	await new Promise((resolve) => setImmediate(resolve));

	const error = events.find((event) => event.type === "session_error");
	assert.equal(error.eventId, "event-1");
	assert.equal(error.error, "Invalid prompt_cache_key");
});

test("routed session normalizes assistant thinking events", async () => {
	let listener;
	const events = [];
	const runtime = {
		cwd: process.cwd(),
		session: {
			subscribe(callback) {
				listener = callback;
				return () => {};
			},
			isStreaming: false,
			getActiveToolNames() {
				return [];
			},
			getAllTools() {
				return [];
			},
			sessionManager: {
				getPiSessionId() {
					return "session-id";
				},
				getSessionFile() {
					return undefined;
				},
				getLeafId() {
					return null;
				},
				getHeader() {
					return undefined;
				},
			},
		},
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.activeMessage = {
		type: "message",
		piboSessionId: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	};
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 2 } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 2, delta: "plan" } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 2, content: "plan done" } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 2 } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 2, delta: "next" } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 2, content: "next done" } });

	assert.deepEqual(
		events.map((event) => event.type),
		["thinking_started", "thinking_delta", "thinking_finished", "thinking_started", "thinking_delta", "thinking_finished"],
	);
	assert.equal(events[1].text, "plan");
	assert.equal(events[1].eventId, "event-1");
	assert.equal(events[1].contentIndex, 2);
	assert.equal(events[1].thinkingIndex, 0);
	assert.equal(events[2].text, "plan done");
	assert.equal(events[2].eventId, "event-1");
	assert.equal(events[2].contentIndex, 2);
	assert.equal(events[2].thinkingIndex, 0);
	assert.equal(events[4].text, "next");
	assert.equal(events[4].eventId, "event-1");
	assert.equal(events[4].contentIndex, 2);
	assert.equal(events[4].thinkingIndex, 1);
	assert.equal(events[5].text, "next done");
	assert.equal(events[5].eventId, "event-1");
	assert.equal(events[5].contentIndex, 2);
	assert.equal(events[5].thinkingIndex, 1);

	await routed.dispose();
});

test("routed session assigns distinct assistant indexes when provider reuses content index", async () => {
	let listener;
	const events = [];
	const runtime = {
		cwd: process.cwd(),
		session: {
			subscribe(callback) {
				listener = callback;
				return () => {};
			},
			isStreaming: false,
			getActiveToolNames() {
				return [];
			},
			async prompt() {},
			async abort() {},
			getSessionTree() {
				return [];
			},
			getAvailableThinkingLevels() {
				return [];
			},
			supportsThinking() {
				return false;
			},
			thinkingLevel: "none",
			sessionManager: {
				getLeafId() {
					return "leaf";
				},
				getHeader() {
					return undefined;
				},
			},
			sessionId: "pi:test",
			sessionFile: undefined,
			sessionName: undefined,
		},
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.activeMessage = {
		type: "message",
		piboSessionId: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	};
	listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "plan" } });
	listener({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "plan" }] },
	});
	listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "final" } });
	listener({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "final" }] },
	});

	assert.deepEqual(
		events.map((event) => event.type),
		["assistant_delta", "assistant_message", "assistant_delta", "assistant_message"],
	);
	assert.equal(events[0].eventId, "event-1");
	assert.equal(events[0].contentIndex, 1);
	assert.equal(events[0].assistantIndex, 0);
	assert.equal(events[1].text, "plan");
	assert.equal(events[1].contentIndex, 1);
	assert.equal(events[1].assistantIndex, 0);
	assert.equal(events[2].text, "final");
	assert.equal(events[2].contentIndex, 1);
	assert.equal(events[2].assistantIndex, 1);
	assert.equal(events[3].text, "final");
	assert.equal(events[3].contentIndex, 1);
	assert.equal(events[3].assistantIndex, 1);

	await routed.dispose();
});

test("routed session normalizes tool call events", async () => {
	let listener;
	const events = [];
	const runtime = {
		cwd: process.cwd(),
		session: {
			subscribe(callback) {
				listener = callback;
				return () => {};
			},
			isStreaming: false,
			getActiveToolNames() {
				return [];
			},
			getAllTools() {
				return [];
			},
			sessionManager: {
				getPiSessionId() {
					return "session-id";
				},
				getSessionFile() {
					return undefined;
				},
				getLeafId() {
					return null;
				},
				getHeader() {
					return undefined;
				},
			},
		},
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.activeMessage = {
		type: "message",
		piboSessionId: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	};
	listener({
		type: "message_update",
		message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: {} }] },
		assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
	});
	listener({
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "echo hi" } }],
		},
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0 },
	});
	listener({
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "echo hi" } }],
		},
		assistantMessageEvent: { type: "toolcall_end", contentIndex: 0 },
	});
	listener({
		type: "tool_execution_start",
		toolCallId: "tool-1",
		toolName: "bash",
		args: { command: "echo hi" },
	});
	listener({
		type: "tool_execution_end",
		toolCallId: "tool-1",
		toolName: "bash",
		result: { content: [{ type: "text", text: "ok" }] },
		isError: false,
	});

	assert.deepEqual(
		events.map((event) => event.type),
		["tool_call", "tool_call", "tool_execution_started", "tool_execution_finished"],
	);
	assert.equal(events[1].toolCallId, "tool-1");
	assert.deepEqual(events[1].args, { command: "echo hi" });
	assert.equal(events[1].eventId, "event-1");
	assert.equal(events[3].eventId, "event-1");

	await routed.dispose();
});

test("session tree navigation moves the active leaf inside the current Pi session", async () => {
	const harness = await createSessionHarness();
	try {
		const ids = seedConversation(harness.routed.runtime);

		const tree = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.tree",
		});
		assert.equal(tree.type, "execution_result");
		assert.equal(tree.result.tree.length, 1);

		const navigated = await harness.routed.executeAction({
			type: "execution",
			piboSessionId: "route:test",
			action: "session.tree_navigate",
			params: { entryId: ids.firstUserId },
		});
		assert.equal(navigated.type, "execution_result");
		const firstUserParentId = harness.routed.runtime.session.sessionManager.getEntry(ids.firstUserId).parentId;
		assert.equal(navigated.result.current.leafId, firstUserParentId);
		assert.equal(navigated.result.editorText, "first user turn");
		assert.equal(harness.routed.getCurrentSession().sessionFile, navigated.result.previous.sessionFile);
	} finally {
		await harness.dispose();
	}
});


function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createQueuedCompactRuntime(order, promptBlocks, compactBlock) {
	return {
		cwd: process.cwd(),
		session: {
			async prompt(text) {
				order.push(`prompt:${text}`);
				const block = promptBlocks.shift();
				if (block) await block.promise;
			},
			async compact() {
				order.push("compact");
				await compactBlock.promise;
				return { summary: "summary", firstKeptEntryId: "kept", tokensBefore: 123 };
			},
			subscribe() { return () => {}; },
			isStreaming: false,
			getActiveToolNames() { return []; },
			getContextUsage() { return undefined; },
			getAllTools() { return []; },
			getAvailableThinkingLevels() { return []; },
			supportsThinking() { return false; },
			thinkingLevel: "off",
			resourceLoader: {
				getSkills() { return { skills: [] }; },
			},
			sessionManager: {
				getPiSessionId() { return "session-id"; },
				getSessionFile() { return undefined; },
				getLeafId() { return null; },
				getHeader() { return undefined; },
			},
			sessionId: "pi:test",
			sessionFile: undefined,
			sessionName: undefined,
		},
		setRebindSession() {},
		async dispose() {},
	};
}

test("compact action is serialized between queued messages", async () => {
	const events = [];
	const order = [];
	const firstPrompt = deferred();
	const secondPrompt = deferred();
	const compactBlock = deferred();
	const runtime = createQueuedCompactRuntime(order, [firstPrompt, secondPrompt], compactBlock);
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "route:test",
		id: "message-a",
		text: "A",
		source: "user",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A"]);

	const queuedCompact = await routed.executeAction({
		type: "execution",
		piboSessionId: "route:test",
		id: "compact-1",
		action: "compact",
	});
	assert.deepEqual(queuedCompact.result, { queued: true, queuedMessages: 1 });

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "route:test",
		id: "message-b",
		text: "B",
		source: "user",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A"], "compact and B must wait for A");

	firstPrompt.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A", "compact"], "compact starts after A finishes");

	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A", "compact"], "B must wait for compact");

	compactBlock.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A", "compact", "prompt:B"]);

	secondPrompt.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	const compactResults = events.filter((event) => event.type === "execution_result" && event.action === "compact");
	assert.equal(compactResults.length, 2);
	assert.deepEqual(compactResults[1].result, { summary: "summary", firstKeptEntryId: "kept", tokensBefore: 123 });

	await routed.dispose();
});

test("non-compact actions still execute immediately while a message is active", async () => {
	const events = [];
	const order = [];
	const firstPrompt = deferred();
	const compactBlock = deferred();
	const runtime = createQueuedCompactRuntime(order, [firstPrompt], compactBlock);
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "route:test",
		id: "message-a",
		text: "A",
		source: "user",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["prompt:A"]);

	const status = await routed.executeAction({
		type: "execution",
		piboSessionId: "route:test",
		id: "status-1",
		action: "status",
	});
	assert.equal(status.type, "execution_result");
	assert.equal(status.result.processing, true);
	assert.deepEqual(order, ["prompt:A"]);

	firstPrompt.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	await routed.dispose();
});

test("routed session patches agent.continue to trigger preemptive compaction", async () => {
	const events = [];
	let compactCalled = false;
	let continueCalled = false;
	const originalContinue = () => { continueCalled = true; return Promise.resolve(); };
	const agent = { continue: originalContinue };
	const session = {
		agent,
		model: { contextWindow: 100000 },
		messages: [{ role: "user", content: "x".repeat(400000) }],
		settingsManager: {
			getCompactionSettings: () => ({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }),
		},
		getContextUsage: () => ({ tokens: 90000, maxTokens: 100000 }),
		async compact() {
			compactCalled = true;
			this.messages = [{ role: "user", content: "compacted" }];
			this.getContextUsage = () => ({ tokens: 1000, maxTokens: 100000 });
		},
		subscribe() { return () => {}; },
		isStreaming: false,
		getActiveToolNames() { return []; },
		getAllTools() { return []; },
		getAvailableThinkingLevels() { return []; },
		supportsThinking() { return false; },
		thinkingLevel: "off",
		sessionManager: {
			getPiSessionId() { return "session-id"; },
			getSessionFile() { return undefined; },
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		sessionId: "pi:test",
		sessionFile: undefined,
		sessionName: undefined,
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	// Verify agent.continue was patched
	assert.notEqual(agent.continue, originalContinue, "agent.continue should be patched");

	// Call patched continue — it should trigger compact because 90000 > 100000 - 16384
	await agent.continue();
	assert.equal(compactCalled, true, "compact() should be called when tokens exceed threshold");
	assert.equal(continueCalled, true, "original continue should still be called after compact");

	// Second call should not compact again because context is now small
	compactCalled = false;
	continueCalled = false;
	await agent.continue();
	assert.equal(compactCalled, false, "compact() should not be called when tokens are below threshold");
	assert.equal(continueCalled, true, "original continue should still be called");

	await routed.dispose();
});

test("routed session emits compaction events and resets indices", async () => {
	const events = [];
	let listener;
	const agent = { continue: () => Promise.resolve() };
	const session = {
		agent,
		model: { contextWindow: 100000 },
		messages: [{ role: "user", content: "x".repeat(400000) }],
		settingsManager: {
			getCompactionSettings: () => ({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }),
		},
		getContextUsage: () => ({ tokens: 90000, maxTokens: 100000 }),
		async compact() {
			this.messages = [{ role: "user", content: "compacted" }];
			this.getContextUsage = () => ({ tokens: 1000, maxTokens: 100000 });
		},
		subscribe(callback) { listener = callback; return () => {}; },
		isStreaming: false,
		getActiveToolNames() { return []; },
		getAllTools() { return []; },
		getAvailableThinkingLevels() { return []; },
		supportsThinking() { return false; },
		thinkingLevel: "off",
		sessionManager: {
			getPiSessionId() { return "session-id"; },
			getSessionFile() { return undefined; },
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		sessionId: "pi:test",
		sessionFile: undefined,
		sessionName: undefined,
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);

	// Simulate indices being incremented
	routed.activeAssistantIndex = 2;
	routed.nextAssistantIndex = 3;
	routed.activeThinkingIndex = 1;
	routed.nextThinkingIndex = 2;

	// Emit compaction_end with successful result
	listener({
		type: "compaction_end",
		reason: "threshold",
		result: { summary: "test", firstKeptEntryId: "abc", tokensBefore: 90000 },
		aborted: false,
	});

	const compactionEnd = events.find((e) => e.type === "compaction_end");
	assert.ok(compactionEnd, "compaction_end event should be emitted");
	assert.equal(compactionEnd.aborted, false);
	assert.equal(compactionEnd.reason, "threshold");

	// Indices should be reset
	assert.equal(routed.activeAssistantIndex, undefined, "activeAssistantIndex should be reset");
	assert.equal(routed.nextAssistantIndex, 0, "nextAssistantIndex should be reset to 0");
	assert.equal(routed.activeThinkingIndex, undefined, "activeThinkingIndex should be reset");
	assert.equal(routed.nextThinkingIndex, 0, "nextThinkingIndex should be reset to 0");

	// Aborted compaction should NOT reset indices
	routed.activeAssistantIndex = 5;
	listener({
		type: "compaction_end",
		reason: "manual",
		aborted: true,
	});
	assert.equal(routed.activeAssistantIndex, 5, "indices should NOT be reset on aborted compaction");

	await routed.dispose();
});
