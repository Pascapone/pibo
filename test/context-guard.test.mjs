import assert from "node:assert/strict";
import test from "node:test";
import {
	PIBO_CONTEXT_GUARD_NOTICE,
	createPiboAssistantContextGuardExtension,
	projectAssistantContextGuard,
} from "../dist/core/context-guard.js";

function userMessage(text) {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMessage(text) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function sessionEntry(id, parentId, message) {
	return { type: "message", id, parentId, timestamp: new Date().toISOString(), message };
}

function createExtensionHarness({ contextWindow = 200, contextTokens = 20, branchEntries = [] } = {}) {
	const handlers = new Map();
	const aborts = [];
	const compactCalls = [];
	const ctx = {
		model: { contextWindow },
		sessionManager: {
			getLeafId() { return branchEntries.at(-1)?.id ?? null; },
			getBranch() { return branchEntries; },
		},
		getContextUsage() {
			return contextTokens === null ? { tokens: null, contextWindow, percent: null } : { tokens: contextTokens, contextWindow, percent: contextTokens / contextWindow };
		},
		abort() { aborts.push(true); },
		compact(options) { compactCalls.push(options); },
	};
	const api = {
		on(name, handler) { handlers.set(name, handler); },
	};
	return { handlers, ctx, aborts, compactCalls, install: (options) => createPiboAssistantContextGuardExtension(options)(api) };
}

test("context guard lets assistant messages below the projected budget persist", async () => {
	const harness = createExtensionHarness({ contextWindow: 120, contextTokens: 30 });
	await harness.install({ reserveTokens: 20 });

	const result = await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("small response") }, harness.ctx);

	assert.equal(result, undefined);
	assert.equal(harness.aborts.length, 0);
	assert.equal(harness.compactCalls.length, 0);
});

test("context guard replaces oversized assistant message and queues compaction", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	await harness.install({ reserveTokens: 20 });

	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_update")({
		type: "message_update",
		message: assistantMessage("x".repeat(120)),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(120) },
	}, harness.ctx);
	const result = await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("x".repeat(120)) }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);

	assert.equal(harness.aborts.length, 1);
	assert.equal(result.message.role, "assistant");
	assert.equal(result.message.content[0].text, PIBO_CONTEXT_GUARD_NOTICE);
	assert.equal(result.message.stopReason, "aborted");
	assert.equal(harness.compactCalls.length, 1);
	assert.match(harness.compactCalls[0].customInstructions, /interrupted the previous assistant response/);
});

test("context guard falls back to session branch token estimates when usage is unknown", () => {
	const branchEntries = [sessionEntry("u1", null, userMessage("u".repeat(240)))];
	const harness = createExtensionHarness({ contextWindow: 120, contextTokens: null, branchEntries });

	const projection = projectAssistantContextGuard(harness.ctx, 50, { reserveTokens: 20 });

	assert.equal(projection.contextTokens, 60);
	assert.equal(projection.assistantTokens, 50);
	assert.equal(projection.projectedTokens, 130);
	assert.equal(projection.exceedsLimit, true);
});

test("context guard reserve is configurable", () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 50 });

	assert.equal(projectAssistantContextGuard(harness.ctx, 10, { reserveTokens: 30 }).exceedsLimit, false);
	assert.equal(projectAssistantContextGuard(harness.ctx, 10, { reserveTokens: 50 }).exceedsLimit, true);
});
