import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createBuiltInLoopStopConditions } from "../dist/loops/stopping.js";
import { classifySessionErrorMessage } from "../dist/core/session-errors.js";
import { createPiboSession } from "../dist/sessions/store.js";

const QUOTA_FAILURE = {
	category: "quota_exhausted",
	code: "quota_exhausted",
	retryable: false,
	errorClass: "provider_rate_limit",
	origin: "provider",
	provider: "test-provider",
};

const RETRYABLE_FAILURE = {
	category: "rate_limit",
	code: "rate_limited",
	retryable: true,
	errorClass: "provider_rate_limit",
	origin: "provider",
	provider: "test-provider",
};

test("provider error classification distinguishes terminal failures from retryable failures", () => {
	for (const [message, category] of [
		["The usage limit has been reached", "quota_exhausted"],
		["401 unauthorized API key", "auth"],
		["context_length_exceeded", "context_overflow"],
	]) {
		const details = classifySessionErrorMessage(message, { hasProviderContext: true });
		assert.equal(details.category, category);
		assert.equal(details.retryable, false);
	}
	for (const message of ["fetch failed", "429 rate limit", "provider returned 503"]) {
		assert.equal(classifySessionErrorMessage(message, { hasProviderContext: true }).retryable, true);
	}
});

test("non-retryable provider failures block a Goal and preserve structured recovery guidance", async () => {
	const harness = await createHarness(({ event, listeners }) => {
		queueMicrotask(() => {
			for (const listener of listeners) listener({ type: "session_error", piboSessionId: event.piboSessionId, eventId: event.id, error: "Provider quota exhausted", errorDetails: QUOTA_FAILURE });
		});
	});
	try {
		harness.service.start();
		const job = harness.store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Complete the objective." });
		assert.ok(await harness.service.startJob(job.id));
		await waitFor(() => harness.store.getJob(job.id)?.state.completedIterations === 1);
		await new Promise((resolve) => setTimeout(resolve, 350));

		const saved = harness.store.getJob(job.id);
		const run = harness.store.listRuns({ jobId: job.id })[0];
		assert.equal(harness.messageCount(), 1);
		assert.equal(saved.enabled, false);
		assert.equal(saved.state.goalStatus, "blocked");
		assert.equal(saved.state.nextAttemptAt, undefined);
		assert.equal(saved.state.lastFailure.details.code, "quota_exhausted");
		assert.match(saved.state.lastFailure.recovery, /quota|billing/i);
		assert.equal(run.status, "error");
		assert.equal(run.reason, "non-retryable-quota_exhausted");
		assert.deepEqual(run.errorDetails, QUOTA_FAILURE);
	} finally {
		await harness.close();
	}
});

test("retryable provider failures use bounded backoff and do not hot-loop", async () => {
	let now = new Date("2026-08-08T12:00:00.000Z");
	const harness = await createHarness(({ event, listeners, messageCount }) => {
		queueMicrotask(() => {
			for (const listener of listeners) {
				if (messageCount === 1) listener({ type: "session_error", piboSessionId: event.piboSessionId, eventId: event.id, error: "Provider rate limited", errorDetails: RETRYABLE_FAILURE });
				else {
					listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "Recovered" });
					listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
				}
			}
		});
	}, {
		now: () => new Date(now),
		retryBackoffBaseMs: 1_000,
		retryBackoffMaxMs: 8_000,
		retryBackoffJitterRatio: 0,
		random: () => 0.5,
		intervalMs: 10,
	});
	try {
		harness.service.start();
		const job = harness.store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Complete the objective.", maxIterations: 2 });
		assert.ok(await harness.service.startJob(job.id));
		await waitFor(() => harness.store.getJob(job.id)?.state.completedIterations === 1);

		let saved = harness.store.getJob(job.id);
		assert.equal(saved.enabled, true);
		assert.equal(saved.state.goalStatus, "active");
		assert.equal(saved.state.retryBackoffMs, 1_000);
		assert.equal(saved.state.nextAttemptAt, "2026-08-08T12:00:01.000Z");
		assert.equal(saved.state.lastFailure.details.retryable, true);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(harness.messageCount(), 1);

		now = new Date("2026-08-08T12:00:01.000Z");
		await waitFor(() => harness.store.getJob(job.id)?.state.completedIterations === 2, 1_000);
		saved = harness.store.getJob(job.id);
		const runs = harness.store.listRuns({ jobId: job.id });
		assert.equal(harness.messageCount(), 2);
		assert.equal(saved.enabled, false);
		assert.equal(saved.state.lastStatus, "ok");
		assert.equal(saved.state.lastFailure, undefined);
		assert.equal(saved.state.nextAttemptAt, undefined);
		assert.equal(runs[0].status, "ok");
		assert.equal(runs[1].reason, "retry-backoff-rate_limited");
		assert.deepEqual(runs[1].errorDetails, RETRYABLE_FAILURE);
	} finally {
		await harness.close();
	}
});

async function createHarness(onMessage, options = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-provider-failure-"));
	const store = new PiboLoopStore({ path: ":memory:" });
	const listeners = new Set();
	const sessions = new Map();
	let messages = 0;
	const context = {
		async emit(event) {
			if (event.type === "message") {
				messages += 1;
				onMessage({ event, listeners, messageCount: messages });
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { const session = createPiboSession({ ...input, id: `ps_provider_failure_${sessions.size + 1}` }); sessions.set(session.id, session); return session; },
		getSession(id) { return sessions.get(id); },
		updateSession(id, patch) { const current = sessions.get(id); if (!current) return undefined; const next = { ...current, ...patch, metadata: patch.metadata ?? current.metadata }; sessions.set(id, next); return next; },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), runTimeoutMs: 5_000, ...options });
	return {
		store,
		service,
		messageCount: () => messages,
		async close() { service.stop(); await rm(dir, { recursive: true, force: true }); },
	};
}

async function waitFor(predicate, timeoutMs = 2_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for loop failure policy");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
