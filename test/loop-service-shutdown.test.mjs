import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createPiboSession } from "../dist/sessions/store.js";

function waitForTurn() {
	let resolve;
	const ready = new Promise((done) => { resolve = done; });
	return { ready, resolve };
}

test("Loop service shutdown drains an active run before closing its stores", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-service-shutdown-"));
	const loopStorePath = join(dir, "loops.sqlite");
	const dataStorePath = join(dir, "pibo.sqlite");
	const dataPayloadRootDir = join(dir, "payloads");
	const listeners = new Set();
	const sessions = new Map();
	const turn = waitForTurn();
	let message;
	const context = {
		async emit(event) {
			if (event.type === "message") {
				message = event;
				turn.resolve();
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "event", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) {
			const session = createPiboSession({ ...input, id: "ps_loop_shutdown" });
			sessions.set(session.id, session);
			return session;
		},
		getSession(id) { return sessions.get(id); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const store = new PiboLoopStore({ path: loopStorePath });
	const service = new PiboLoopService({ store, context, dataStorePath, dataPayloadRootDir, intervalMs: 60_000 });
	const unhandled = [];
	const recordUnhandled = (reason) => { unhandled.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)); };
	process.on("unhandledRejection", recordUnhandled);

	try {
		service.start();
		const job = store.createJob({
			mode: "goal",
			target: { kind: "default-chat" },
			profile: "base",
			prompt: "Finish after shutdown begins.",
			maxIterations: 1,
		});
		const run = await service.startJob(job.id);
		assert.ok(run);
		await turn.ready;
		assert.ok(message);

		const stopping = Promise.resolve(service.stop());
		for (const listener of listeners) {
			listener({ type: "assistant_message", piboSessionId: message.piboSessionId, eventId: message.id, text: "completed during shutdown" });
			listener({ type: "message_finished", piboSessionId: message.piboSessionId, eventId: message.id });
		}
		await stopping;
		await new Promise((resolve) => setImmediate(resolve));

		const reopened = new PiboLoopStore({ path: loopStorePath });
		try {
			const beforeRestartJob = reopened.getJob(job.id);
			const beforeRestartRun = reopened.getRun(run.id);
			assert.deepEqual({
				unhandled,
				runStatus: beforeRestartRun?.status,
				jobRunningAt: beforeRestartJob?.state.runningAt,
				completedIterations: beforeRestartJob?.state.completedIterations,
			}, {
				unhandled: [],
				runStatus: "ok",
				jobRunningAt: undefined,
				completedIterations: 1,
			});

			const restarted = new PiboLoopService({ store: reopened, context, dataStorePath, dataPayloadRootDir, intervalMs: 60_000 });
			restarted.start();
			const afterRestartJob = reopened.getJob(job.id);
			const afterRestartRun = reopened.getRun(run.id);
			assert.deepEqual({
				runStatus: afterRestartRun?.status,
				jobRunningAt: afterRestartJob?.state.runningAt,
				completedIterations: afterRestartJob?.state.completedIterations,
			}, {
				runStatus: "ok",
				jobRunningAt: undefined,
				completedIterations: 1,
			});
			await restarted.stop();
		} catch (error) {
			try { reopened.close(); } catch { /* already closed */ }
			throw error;
		}
	} finally {
		process.off("unhandledRejection", recordUnhandled);
		try { await service.stop(); } catch { /* preserve the primary assertion */ }
		await rm(dir, { recursive: true, force: true });
	}
});
