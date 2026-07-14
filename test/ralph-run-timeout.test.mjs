import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboRalphService } from "../dist/ralph/service.js";
import { PiboRalphStore } from "../dist/ralph/store.js";

function createContext({ abortError } = {}) {
	const listeners = new Set();
	const emitted = [];
	let sessionNumber = 0;
	return {
		emitted,
		context: {
			async emit(event) {
				emitted.push(event);
				if (event.type === "execution" && event.action === "abort" && abortError) throw abortError;
			},
			subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
			createSession() { sessionNumber += 1; return { id: `ps_timeout_${sessionNumber}` }; },
		},
		finish(text = "done") {
			const message = emitted.find((event) => event.type === "message");
			assert.ok(message);
			for (const listener of listeners) {
				listener({ type: "assistant_message", piboSessionId: message.piboSessionId, eventId: message.id, text });
				listener({ type: "message_finished", piboSessionId: message.piboSessionId, eventId: message.id });
			}
		},
		fail(error = "session failed", errorDetails) {
			const message = emitted.find((event) => event.type === "message");
			assert.ok(message);
			for (const listener of listeners) {
				listener({ type: "session_error", piboSessionId: message.piboSessionId, eventId: message.id, error, errorDetails });
			}
		},
		finishAfterError() {
			const message = emitted.find((event) => event.type === "message");
			assert.ok(message);
			for (const listener of listeners) {
				listener({ type: "message_finished", piboSessionId: message.piboSessionId, eventId: message.id });
			}
		},
	};
}

async function createService(runTimeoutMs, contextOptions) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-run-timeout-"));
	const controlled = createContext(contextOptions);
	const store = new PiboRalphStore({ path: ":memory:" });
	const service = new PiboRalphService({
		store,
		context: controlled.context,
		dataStorePath: join(dir, "data.sqlite"),
		dataPayloadRootDir: join(dir, "payloads"),
		...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
	});
	return {
		service,
		store,
		controlled,
		async cleanup() {
			service.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

test("Ralph runs do not schedule a timeout by default", async () => {
	const fixture = await createService();
	const originalSetTimeout = globalThis.setTimeout;
	let scheduledTimeouts = 0;
	try {
		globalThis.setTimeout = (...args) => {
			scheduledTimeouts += 1;
			return originalSetTimeout(...args);
		};
		const waiting = fixture.service.emitMessageAndWait("ps_unlimited", "work");
		globalThis.setTimeout = originalSetTimeout;

		assert.equal(scheduledTimeouts, 0);
		fixture.controlled.finish("complete");
		assert.equal(await waiting, "complete");
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		await fixture.cleanup();
	}
});

test("Ralph treats a published provider session error as terminal", async () => {
	const fixture = await createService();
	try {
		const waiting = fixture.service.emitMessageAndWait("ps_retry", "work");
		fixture.controlled.fail("provider unavailable", {
			origin: "provider",
			provider: "test-provider",
			model: "test-model",
		});
		await assert.rejects(waiting, /provider unavailable/);
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph fails when provider retries are exhausted", async () => {
	const fixture = await createService();
	try {
		const waiting = fixture.service.emitMessageAndWait("ps_exhausted", "work");
		fixture.controlled.fail("provider unavailable", {
			origin: "provider",
			provider: "test-provider",
			model: "test-model",
		});
		fixture.controlled.finishAfterError();
		await assert.rejects(waiting, /provider unavailable/);
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph terminates immediately on a runtime session error", async () => {
	const fixture = await createService();
	try {
		const waiting = fixture.service.emitMessageAndWait("ps_runtime_error", "work");
		fixture.controlled.fail("No API key configured", {
			origin: "provider",
			errorClass: "provider_auth",
			retryable: false,
		});
		await assert.rejects(waiting, /No API key configured/);
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph aborts the session before completing an explicitly timed-out run", async () => {
	const fixture = await createService(20);
	try {
		await assert.rejects(
			fixture.service.emitMessageAndWait("ps_limited", "work"),
			/Ralph run timed out/,
		);
		const abort = fixture.controlled.emitted.find((event) => event.type === "execution" && event.action === "abort");
		assert.equal(abort?.piboSessionId, "ps_limited");
		assert.match(abort?.id ?? "", /^ralph_timeout_/);
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph disables the job when a timed-out session cannot be aborted", async () => {
	const fixture = await createService(20, { abortError: new Error("abort unavailable") });
	try {
		const job = fixture.store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "work" });
		const run = await fixture.service.startJob(job.id);
		assert.ok(run);
		await waitFor(() => fixture.store.getJob(job.id)?.state.lastStatus === "error");

		const updated = fixture.store.getJob(job.id);
		assert.equal(updated?.enabled, false);
		assert.match(updated?.state.lastError ?? "", /session abort failed: abort unavailable/);
		const completed = fixture.store.listRuns({ jobId: job.id }).find((candidate) => candidate.id === run.id);
		assert.equal(completed?.piboSessionId, "ps_timeout_1");
		assert.equal(completed?.reason, "timeout-abort-failed");
	} finally {
		await fixture.cleanup();
	}
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
