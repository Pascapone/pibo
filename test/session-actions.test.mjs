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

test("session fork replaces the active Pi session and can switch back", async () => {
	const harness = await createSessionHarness();
	try {
		const ids = seedConversation(harness.routed.runtime);
		const before = harness.routed.getCurrentSession();

		const candidates = await harness.routed.executeAction({
			type: "execution",
			sessionKey: "route:test",
			action: "session.fork_candidates",
		});
		assert.equal(candidates.type, "execution_result");
		assert.equal(candidates.result.messages.length, 2);

		const forked = await harness.routed.executeAction({
			type: "execution",
			sessionKey: "route:test",
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
			sessionKey: "route:test",
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
			sessionKey: "route:test",
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
			sessionManager: {
				getSessionId() {
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
		sessionKey: "route:test",
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
				getSessionId() {
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
		sessionKey: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	};
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "plan" } });
	listener({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "plan done" } });

	assert.deepEqual(
		events.map((event) => event.type),
		["thinking_started", "thinking_delta", "thinking_finished"],
	);
	assert.equal(events[1].text, "plan");
	assert.equal(events[1].eventId, "event-1");
	assert.equal(events[2].text, "plan done");
	assert.equal(events[2].eventId, "event-1");

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
				getSessionId() {
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
		sessionKey: "route:test",
		id: "event-1",
		text: "hello",
		source: "actor",
	};
	listener({
		type: "message_update",
		message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "pibo_echo", arguments: {} }] },
		assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
	});
	listener({
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-1", name: "pibo_echo", arguments: { text: "hi" } }],
		},
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0 },
	});
	listener({
		type: "tool_execution_start",
		toolCallId: "tool-1",
		toolName: "pibo_echo",
		args: { text: "hi" },
	});
	listener({
		type: "tool_execution_end",
		toolCallId: "tool-1",
		toolName: "pibo_echo",
		result: { content: [{ type: "text", text: "ok" }] },
		isError: false,
	});

	assert.deepEqual(
		events.map((event) => event.type),
		["tool_call", "tool_call", "tool_execution_started", "tool_execution_finished"],
	);
	assert.equal(events[1].toolCallId, "tool-1");
	assert.deepEqual(events[1].args, { text: "hi" });
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
			sessionKey: "route:test",
			action: "session.tree",
		});
		assert.equal(tree.type, "execution_result");
		assert.equal(tree.result.tree.length, 1);

		const navigated = await harness.routed.executeAction({
			type: "execution",
			sessionKey: "route:test",
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
