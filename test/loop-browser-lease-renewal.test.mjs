import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createBuiltInLoopStopConditions } from "../dist/loops/stopping.js";
import { createPiboSession } from "../dist/sessions/store.js";

function createContext(delayMs = 40) {
	const listeners = new Set();
	const sessions = new Map();
	return {
		async emit(event) {
			if (event.type === "message") setTimeout(() => {
				for (const listener of listeners) {
					listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, totalTokens: 1 });
					listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "progress" });
					listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
				}
			}, delayMs);
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { const session = createPiboSession({ ...input, id: "ps_browser_goal" }); sessions.set(session.id, session); return session; },
		getSession(id) { return sessions.get(id); },
		updateSession(id, patch) { const current = sessions.get(id); if (!current) return undefined; const next = { ...current, ...patch }; sessions.set(id, next); return next; },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
}

function acquireResult(leaseId, retainedUntil, replaced = false) {
	return {
		acquired: true,
		leaseId,
		cdpUrl: "http://127.0.0.1:9222",
		pid: 123,
		reused: !replaced,
		replaced,
		state: { workerId: "worker-goal", poolId: "default", maxBrowserProcesses: 1, activeLeaseId: leaseId, activeLeaseCount: 1, holder: "loop", idleExpiresAt: retainedUntil, state: "leased" },
	};
}

async function waitFor(predicate, timeoutMs = 3000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Goal loop state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("Goal browser lease renews during turns, survives service restart, and releases only at terminal stop", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-browser-renew-"));
	const loopPath = join(dir, "loops.sqlite");
	const context = createContext();
	const acquisitions = [];
	const releases = [];
	const retainedUntil = "2026-08-05T00:00:00.000Z";
	const resourceCleanup = {
		browserPoolRootDir: join(dir, "pool"),
		browserLeaseRenewIntervalMs: 10,
		async acquireBrowserPoolLease(_paths, _identity, options) {
			acquisitions.push({ leaseId: options.leaseId, holder: options.holder });
			return acquireResult(options.leaseId, retainedUntil, acquisitions.length > 2);
		},
		async releaseBrowserPoolLease(_paths, _identity, options) {
			releases.push(options.leaseId);
			return { released: true, cleanupStatus: "success", closedTargets: 0, state: { workerId: "worker-goal", poolId: "default", maxBrowserProcesses: 1, activeLeaseCount: 0, state: "ready" } };
		},
	};
	let jobId;
	try {
		const store1 = new PiboLoopStore({ path: loopPath });
		const service1 = new PiboLoopService({ store: store1, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60000, resourceCleanup });
		service1.start();
		const job = store1.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Use browser", maxIterations: 2, resources: { workerId: "worker-goal", browserLeaseIds: ["lease-goal"], cleanupState: "active" } });
		jobId = job.id;
		assert.ok(await service1.startJob(job.id));
		await waitFor(() => store1.getJob(job.id)?.state.completedIterations === 1);
		assert.equal(store1.getJob(job.id).resources.cleanupState, "retained");
		assert.equal(store1.getJob(job.id).resources.retainedUntil, retainedUntil);
		assert.equal(releases.length, 0);
		assert.ok(acquisitions.length >= 2, "pre-turn renewal plus active heartbeat expected");
		service1.stop();

		const store2 = new PiboLoopStore({ path: loopPath });
		const service2 = new PiboLoopService({ store: store2, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60000, resourceCleanup });
		service2.start();
		assert.ok(await service2.startJob(job.id));
		await waitFor(() => store2.getJob(job.id)?.state.completedIterations === 2);
		assert.equal(store2.getJob(job.id).enabled, false);
		assert.deepEqual(releases, ["lease-goal"]);
		assert.ok(acquisitions.some((item) => item.holder === `loop:${job.id}`));
		assert.ok(store2.listRuns({ jobId: job.id }).every((run) => run.resources.browserLeaseIds.includes("lease-goal")));
		service2.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("unrecoverable Goal browser lease becomes a blocked Goal with operator-facing reason", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-browser-blocked-"));
	const store = new PiboLoopStore({ path: ":memory:" });
	const service = new PiboLoopService({
		store,
		context: createContext(0),
		dataStorePath: join(dir, "data.sqlite"),
		dataPayloadRootDir: join(dir, "payloads"),
		resourceCleanup: {
			browserPoolRootDir: join(dir, "pool"),
			async acquireBrowserPoolLease() { return { acquired: false, staleReason: "authenticated profile is unavailable", state: { workerId: "worker-blocked", poolId: "default", maxBrowserProcesses: 1, state: "stale" } }; },
		},
	});
	try {
		service.start();
		const job = store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Need browser", resources: { workerId: "worker-blocked", browserLeaseIds: ["lease-missing"], cleanupState: "active" } });
		assert.equal(await service.startJob(job.id), undefined);
		const blocked = store.getJob(job.id);
		assert.equal(blocked.state.goalStatus, "blocked");
		assert.equal(blocked.enabled, false);
		assert.equal(blocked.resources.cleanupState, "dirty");
		assert.match(blocked.resources.dirtyReason, /operator attention/);
		assert.equal(store.listRuns({ jobId: job.id }).length, 0);
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});
