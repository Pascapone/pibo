import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboRalphService } from "../dist/ralph/service.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { resolvePiboSessionInitialFastMode, resolvePiboSessionInitialThinkingLevel } from "../dist/core/session-router.js";
import { createPiboSession } from "../dist/sessions/store.js";

test("Ralph store persists and clears runtime overrides", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "Keep checking the inbox.",
			maxIterations: 3,
			modelOverride: { provider: "openai", id: "gpt-5" },
			thinkingLevel: "high",
			fastMode: true,
		});

		const reloaded = store.getJob(job.id);
		assert.deepEqual(reloaded?.modelOverride, { provider: "openai", id: "gpt-5" });
		assert.equal(reloaded?.thinkingLevel, "high");
		assert.equal(reloaded?.fastMode, true);
		assert.equal(reloaded?.maxIterations, 3);

		const cleared = store.updateJob(job.id, {
			modelOverride: null,
			thinkingLevel: null,
			fastMode: null,
			maxIterations: null,
		});
		assert.equal(cleared?.modelOverride, undefined);
		assert.equal(cleared?.thinkingLevel, undefined);
		assert.equal(cleared?.fastMode, undefined);
		assert.equal(cleared?.maxIterations, undefined);
	} finally {
		store.close();
	}
});

test("Ralph service passes runtime overrides to created sessions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-overrides-"));
	const store = new PiboRalphStore({ path: ":memory:" });
	const listeners = new Set();
	const createdSessions = [];
	const context = {
		async emit(event) {
			if (event.type === "message") {
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "done" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		createSession(input) {
			createdSessions.push(input);
			return createPiboSession({ ...input, id: `ps_ralph_override_${createdSessions.length}` });
		},
		getSession() { return undefined; },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const service = new PiboRalphService({
		store,
		context,
		dataStorePath: join(dir, "pibo-data.sqlite"),
		dataPayloadRootDir: join(dir, "payloads"),
		runTimeoutMs: 5_000,
	});

	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "Keep checking the inbox.",
			modelOverride: { provider: "openai", id: "gpt-5" },
			thinkingLevel: "high",
			fastMode: true,
		});

		const run = await service.startJob(job.id);
		assert.ok(run);
		await waitFor(() => store.getJob(job.id)?.state.lastStatus === "ok");

		assert.equal(createdSessions.length, 1);
		const input = createdSessions[0];
		assert.deepEqual(input.activeModel, { provider: "openai", id: "gpt-5" });
		assert.equal(input.metadata.initialThinkingLevel, "high");
		assert.equal(input.metadata.initialFastMode, true);
		assert.equal(resolvePiboSessionInitialThinkingLevel({ metadata: input.metadata }), "high");
		assert.equal(resolvePiboSessionInitialFastMode({ metadata: input.metadata }), true);
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
