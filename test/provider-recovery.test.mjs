import assert from "node:assert/strict";
import test from "node:test";
import { completePiboCompactionSummary } from "../dist/core/compaction-prompt.js";
import {
	PIBO_PROVIDER_RECOVERY_MESSAGE_TYPE,
	PiboProviderRecoveryCancelledError,
	piboProviderRecoveryDelayMs,
} from "../dist/core/provider-recovery.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { classifySessionErrorMessage } from "../dist/core/session-errors.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

function retrySettings({ enabled = true, baseDelayMs = 0, maxRetryDelayMs = 60_000 } = {}) {
	return {
		getRetrySettings() {
			return { enabled, maxRetries: 3, baseDelayMs };
		},
		getProviderRetrySettings() {
			return { maxRetryDelayMs };
		},
	};
}

function assistantError(errorMessage) {
	return {
		role: "assistant",
		content: [],
		stopReason: "error",
		errorMessage,
	};
}

function assistantSuccess(text) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
	};
}

async function waitUntil(predicate, message) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail(message);
}

function createRoutedRecoveryHarness({
	enabled = true,
	baseDelayMs = 0,
	recoveriesBeforeSuccess = 1,
	initialError = "websocket_error: connection lost",
} = {}) {
	let listener;
	let recoveryCalls = 0;
	let abortCalls = 0;
	const order = [];
	const events = [];
	const session = {
		settingsManager: retrySettings({ enabled, baseDelayMs }),
		subscribe(callback) {
			listener = callback;
			return () => {};
		},
		async prompt(text) {
			order.push(`prompt:${text}`);
			if (text === "B") {
				listener({ type: "message_end", message: assistantSuccess("B done") });
			} else {
				listener({ type: "message_end", message: assistantError(initialError) });
			}
			listener({ type: "agent_settled" });
		},
		async sendCustomMessage(message) {
			assert.equal(message.customType, PIBO_PROVIDER_RECOVERY_MESSAGE_TYPE);
			recoveryCalls += 1;
			order.push(`recovery:${recoveryCalls}`);
			if (recoveryCalls <= recoveriesBeforeSuccess) {
				listener({ type: "message_end", message: assistantError("temporary 503") });
			} else {
				listener({ type: "message_end", message: assistantSuccess("A recovered") });
			}
			listener({ type: "agent_settled" });
		},
		async abort() {
			abortCalls += 1;
		},
		isStreaming: false,
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		getAllTools() { return []; },
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getPiSessionId() { return "session-id"; },
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
	const routed = new RoutedSession("route:test", runtime, (event) => events.push(event), registry, false);
	return { routed, events, order, get recoveryCalls() { return recoveryCalls; }, get abortCalls() { return abortCalls; } };
}

test("provider recovery backoff is exponential and capped", () => {
	const settings = { baseDelayMs: 2_000, maxDelayMs: 60_000 };
	assert.equal(piboProviderRecoveryDelayMs(1, settings), 2_000);
	assert.equal(piboProviderRecoveryDelayMs(5, settings), 32_000);
	assert.equal(piboProviderRecoveryDelayMs(20, settings), 60_000);
});

test("quota and explicit abort errors are terminal", () => {
	assert.equal(classifySessionErrorMessage("429 insufficient_quota: billing limit").retryable, false);
	assert.equal(classifySessionErrorMessage("request was aborted").retryable, false);
	assert.equal(classifySessionErrorMessage("temporary rate limit 429").retryable, true);
});

test("routed session keeps one turn open across repeated provider recovery and preserves queue order", async () => {
	const harness = createRoutedRecoveryHarness({ recoveriesBeforeSuccess: 1 });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "A", text: "A", source: "user" });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "B", text: "B", source: "user" });

	await waitUntil(() => harness.events.some((event) => event.type === "message_finished" && event.eventId === "B"), "queued message did not finish");

	assert.deepEqual(harness.order, ["prompt:A", "recovery:1", "recovery:2", "prompt:B"]);
	assert.equal(harness.events.some((event) => event.type === "session_error" && event.eventId === "A"), false);
	assert.equal(harness.events.filter((event) => event.type === "message_finished" && event.eventId === "A").length, 1);
	assert.equal(harness.recoveryCalls, 2);
});

test("durable recovery continues beyond Pi's short retry budget", async () => {
	const harness = createRoutedRecoveryHarness({ recoveriesBeforeSuccess: 8 });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "A", text: "A", source: "user" });
	await waitUntil(() => harness.events.some((event) => event.type === "message_finished" && event.eventId === "A"), "durable recovery did not finish");
	assert.equal(harness.recoveryCalls, 9);
	assert.equal(harness.events.some((event) => event.type === "session_error"), false);
});

test("disabling retry leaves transient provider errors terminal", async () => {
	const harness = createRoutedRecoveryHarness({ enabled: false });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "A", text: "A", source: "user" });
	await waitUntil(() => harness.events.some((event) => event.type === "session_error"), "terminal error was not emitted");
	assert.equal(harness.recoveryCalls, 0);
	assert.equal(harness.events.some((event) => event.type === "message_finished"), false);
});

test("quota failures remain terminal instead of entering durable recovery", async () => {
	const harness = createRoutedRecoveryHarness({ initialError: "429 insufficient_quota: billing limit reached" });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "A", text: "A", source: "user" });
	await waitUntil(() => harness.events.some((event) => event.type === "session_error"), "quota error was not emitted");
	assert.equal(harness.recoveryCalls, 0);
	assert.equal(harness.events.find((event) => event.type === "session_error").errorDetails.retryable, false);
});

test("cancelling an active message aborts provider recovery backoff", async () => {
	const harness = createRoutedRecoveryHarness({ baseDelayMs: 10_000 });
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:test", id: "A", text: "A", source: "user" });
	await waitUntil(() => harness.order.includes("prompt:A") && harness.routed.getStatus().processing, "provider recovery did not start");

	assert.equal(await harness.routed.cancelMessage("A"), true);
	await waitUntil(() => !harness.routed.getStatus().processing, "provider recovery did not cancel");

	assert.equal(harness.recoveryCalls, 0);
	assert.equal(harness.abortCalls, 1);
	assert.equal(harness.events.some((event) => event.type === "session_error"), false);
	assert.equal(harness.events.some((event) => event.type === "message_finished"), false);
});

test("compaction summary retries transient provider failures with stable transport context", async () => {
	const calls = [];
	const responses = [assistantError("websocket_error: connection lost"), assistantSuccess("durable summary")];
	const summary = await completePiboCompactionSummary({
		model: { provider: "openai-codex", id: "gpt-test", api: "openai-codex-responses" },
		systemPrompt: "summarize",
		promptText: "conversation",
		maxTokens: 1_000,
		apiKey: "test",
		transport: "auto",
		sessionId: "pi-session",
		recovery: { enabled: true, baseDelayMs: 0, maxDelayMs: 60_000 },
		async complete(_model, _context, options) {
			calls.push(options);
			return responses.shift();
		},
	});

	assert.equal(summary, "durable summary");
	assert.equal(calls.length, 2);
	assert.equal(calls[0].transport, "auto");
	assert.match(calls[0].sessionId, /^compaction-/);
	assert.equal(calls[1].sessionId, calls[0].sessionId);
});

test("parallel compaction summaries use distinct stable transport sessions", async () => {
	const sessionIds = [];
	const complete = async (_model, _context, options) => {
		sessionIds.push(options.sessionId);
		return assistantSuccess("summary");
	};
	const input = {
		model: { provider: "openai-codex", id: "gpt-test", api: "openai-codex-responses" },
		systemPrompt: "summarize",
		promptText: "conversation",
		maxTokens: 1_000,
		apiKey: "test",
		sessionId: "pi-session",
		recovery: { enabled: true, baseDelayMs: 0, maxDelayMs: 60_000 },
		complete,
	};
	await Promise.all([completePiboCompactionSummary(input), completePiboCompactionSummary(input)]);
	assert.notEqual(sessionIds[0], sessionIds[1]);
});

test("compaction summary backoff is abortable", async () => {
	const controller = new AbortController();
	const promise = completePiboCompactionSummary({
		model: { provider: "openai-codex", id: "gpt-test", api: "openai-codex-responses" },
		systemPrompt: "summarize",
		promptText: "conversation",
		maxTokens: 1_000,
		apiKey: "test",
		signal: controller.signal,
		recovery: { enabled: true, baseDelayMs: 10_000, maxDelayMs: 60_000 },
		async complete() {
			return assistantError("temporary 503");
		},
	});
	await new Promise((resolve) => setImmediate(resolve));
	controller.abort();
	await assert.rejects(promise, PiboProviderRecoveryCancelledError);
});
