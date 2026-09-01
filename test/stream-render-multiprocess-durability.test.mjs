import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { OutputPersistenceRetryQueue } from "../dist/core/output-persistence-retry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

function temporaryDatabase(prefix) {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	return { directory, databasePath: join(directory, "pibo-events.sqlite") };
}

function envelope(key, state = { phase: "v2" }) {
	return { version: 1, key, piboSessionId: `ps_${key}`, eventId: `event_${key}`, state };
}

function runWorker(databasePath, workerId, mode, delayMs, leaseMs = 60) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [
			new URL("./fixtures/output-retry-multiprocess-worker.mjs", import.meta.url).pathname,
			databasePath,
			workerId,
			mode,
			String(delayMs),
			String(leaseMs),
		], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code !== 0) reject(new Error(`worker ${workerId} exited ${code}: ${stderr}`));
			else resolve(stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
		});
	});
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("condition was not met before timeout");
}

test("two processes renew slow claims and stale claim generations cannot destructively ack", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-multiprocess-");
	try {
		let store = new PiboReliabilityStore(databasePath);
		store.enqueue({
			jobId: "job_multiprocess",
			queue: "output-persistence-test",
			payload: envelope("multiprocess"),
			maxAttempts: 5,
		});
		store.close();

		const winnerPromise = runWorker(databasePath, "worker-a", "heartbeat", 220, 60);
		await new Promise((resolve) => setTimeout(resolve, 90));
		const contender = await runWorker(databasePath, "worker-b", "heartbeat", 0, 60);
		const winner = await winnerPromise;
		assert.equal(winner[0].claimed, true);
		assert.equal(winner[1].acked, true);
		assert.equal(contender[0].claimed, false, "heartbeat must keep the slow winner's lease live");

		store = new PiboReliabilityStore(databasePath);
		store.enqueue({
			jobId: "job_multiprocess",
			queue: "output-persistence-test",
			payload: envelope("multiprocess-stale"),
			maxAttempts: 5,
		});
		store.close();
		const stalePromise = runWorker(databasePath, "worker-stale", "stale", 3_000, 100);
		await waitFor(() => {
			const database = new DatabaseSync(databasePath, { readOnly: true });
			try {
				const row = database.prepare("SELECT worker_id, claim_expires_at FROM pibo_jobs WHERE job_id = ?").get("job_multiprocess");
				return row?.worker_id === "worker-stale" && Date.parse(row.claim_expires_at) <= Date.now();
			} finally {
				database.close();
			}
		}, 2_000);
		const takeover = await runWorker(databasePath, "worker-takeover", "heartbeat", 0, 50);
		const stale = await stalePromise;
		assert.equal(takeover[0].claimed, true);
		assert.equal(takeover[1].acked, true);
		assert.equal(stale[1].acked, false, "expired claim generation must be fenced from ACK");
		assert.ok(takeover[0].claimToken > stale[0].claimToken);

		const database = new DatabaseSync(databasePath, { readOnly: true });
		try {
			assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM observable_output_effects WHERE delivery_id = ?").get("delivery:multiprocess").count), 1);
		} finally {
			database.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("stale claim generations and expired leases cannot mutate durable jobs", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-fenced-mutators-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		store.enqueue({
			jobId: "job_fenced_mutators",
			queue: "output-persistence-test",
			payload: envelope("fenced-mutators"),
			maxAttempts: 5,
		});
		const stale = store.claimRecoverableJob("job_fenced_mutators", "worker-stale", 20);
		assert.ok(stale);
		await new Promise((resolve) => setTimeout(resolve, 30));
		const current = store.claimRecoverableJob("job_fenced_mutators", "worker-current", 1_000);
		assert.ok(current);
		assert.ok(current.claimToken > stale.claimToken);

		assert.equal(store.updateJobPayload(current.jobId, stale.workerId, envelope("stale-update"), stale.claimToken), false);
		assert.equal(store.heartbeat(current.jobId, stale.workerId, 1_000, stale.claimToken), false);
		assert.equal(store.retry(current.jobId, stale.workerId, { delayMs: 0, claimToken: stale.claimToken }), false);
		assert.equal(store.fail(current.jobId, stale.workerId, "stale fail", stale.claimToken), false);
		assert.equal(store.ack(current.jobId, stale.workerId, stale.claimToken), false);
		assert.equal(store.releaseJob(current.jobId, stale.workerId, 0, stale.claimToken), false);

		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run(new Date(Date.now() - 1_000).toISOString(), current.jobId);
		assert.equal(store.updateJobPayload(current.jobId, current.workerId, envelope("expired-update"), current.claimToken), false);
		assert.equal(store.heartbeat(current.jobId, current.workerId, 1_000, current.claimToken), false);
		assert.equal(store.retry(current.jobId, current.workerId, { delayMs: 0, claimToken: current.claimToken }), false);
		assert.equal(store.fail(current.jobId, current.workerId, "expired fail", current.claimToken), false);
		assert.equal(store.ack(current.jobId, current.workerId, current.claimToken), false);
		assert.equal(store.releaseJob(current.jobId, current.workerId, 0, current.claimToken), false);
		assert.equal(store.listJobs({ queue: "output-persistence-test" })[0].state, "running");
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("loser reconciles a winner-deleted durable job and drain terminates", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-loser-");
	try {
		const firstStore = new PiboReliabilityStore(databasePath);
		firstStore.enqueue({ queue: "output-persistence-test", payload: envelope("winner"), idempotencyKey: "winner", maxAttempts: 3 });
		const secondStore = new PiboReliabilityStore(databasePath);
		let winnerRuns = 0;
		let loserRuns = 0;
		const winner = new OutputPersistenceRetryQueue({ durableStore: firstStore, queueName: "output-persistence-test", workerId: "winner", visibilityTimeoutMs: 100, baseDelayMs: 5, maxDelayMs: 5 });
		const loser = new OutputPersistenceRetryQueue({ durableStore: secondStore, queueName: "output-persistence-test", workerId: "loser", visibilityTimeoutMs: 100, baseDelayMs: 5, maxDelayMs: 5 });
		winner.recover((job) => ({ ...job, async run() { winnerRuns += 1; await new Promise((resolve) => setTimeout(resolve, 40)); } }));
		loser.recover((job) => ({ ...job, run() { loserRuns += 1; } }));
		await winner.drain();
		await Promise.race([
			loser.drain(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("loser drain timed out")), 500)),
		]);
		assert.equal(winnerRuns, 1);
		assert.equal(loserRuns, 0);
		assert.equal(loser.debugState().pending, 0);
		winner.dispose();
		loser.dispose();
		firstStore.close();
		secondStore.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("recovery pumps every job beyond local capacity without starving the tail", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-backlog-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		for (let index = 0; index < 37; index += 1) {
			store.enqueue({ queue: "output-persistence-test", payload: envelope(`backlog-${index}`), idempotencyKey: `backlog-${index}`, maxAttempts: 3 });
		}
		const seen = [];
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", maxPending: 5, recoveryBatchSize: 3, baseDelayMs: 1, maxDelayMs: 1 });
		queue.recover((job) => ({ ...job, run() { seen.push(job.key); } }));
		await queue.drain();
		assert.equal(seen.length, 37);
		assert.equal(new Set(seen).size, 37);
		assert.equal(store.listJobs({ queue: "output-persistence-test", limit: 100 }).length, 0);
		queue.dispose();
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("capacity overflow survives reopen as a durable dead letter", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-capacity-");
	let release;
	try {
		let store = new PiboReliabilityStore(databasePath);
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", maxPending: 1, maxAttempts: 3 });
		queue.enqueue({ key: "held", payload: { phase: "v2" }, async run({ signal }) { await new Promise((resolve) => { release = resolve; signal.addEventListener("abort", resolve, { once: true }); }); } });
		queue.enqueue({ key: "overflow", piboSessionId: "ps_overflow", eventId: "event_overflow", payload: { phase: "v2", secret: "must-not-appear-in-debug" }, run() {} });
		queue.dispose();
		release?.();
		store.close();

		store = new PiboReliabilityStore(databasePath);
		const dead = store.listDead({ queue: "output-persistence-test" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].deadReason, "capacity_exceeded");
		assert.equal(dead[0].jobId.startsWith("job_"), true);
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("permanent durable failures dead-letter after one attempt", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-permanent-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 });
		let attempts = 0;
		queue.enqueue({
			key: "permanent",
			payload: { phase: "v2" },
			isRetryable: () => false,
			run() {
				attempts += 1;
				throw new Error("permanent collision");
			},
		});
		await queue.drain();
		const dead = store.listDead({ queue: "output-persistence-test" });
		assert.equal(attempts, 1);
		assert.equal(dead.length, 1);
		assert.equal(dead[0].attempts, 1);
		assert.equal(dead[0].deadReason, "permanent");
		assert.equal(dead[0].lastError, "permanent collision");
		assert.deepEqual(queue.debugState().counters, { retriable: 0, permanent: 1, quarantined: 0 });
		queue.dispose();
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("unknown, versionless, and malformed durable payloads quarantine while later jobs continue", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-quarantine-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		const timestamp = new Date().toISOString();
		const insert = store.db.prepare(`
			INSERT INTO pibo_jobs (job_id, queue, state, payload_json, run_at, priority, worker_id, claim_expires_at, attempts, max_attempts, idempotency_key, created_at, updated_at, expires_at, last_error)
			VALUES (?, 'output-persistence-test', 'pending', ?, ?, 0, NULL, NULL, 0, 3, ?, ?, ?, NULL, NULL)
		`);
		insert.run("job_unknown", JSON.stringify({ version: 999, key: "unknown", state: { secret: "unknown-secret" } }), timestamp, "unknown-secret-idempotency", timestamp, timestamp);
		insert.run("job_versionless", JSON.stringify({ key: "versionless", state: { secret: "versionless-secret" } }), timestamp, "versionless-secret-idempotency", timestamp, timestamp);
		insert.run("job_malformed", "{\"secret\":\"malformed-secret\"", timestamp, "malformed-secret-idempotency", timestamp, timestamp);
		store.enqueue({ queue: "output-persistence-test", payload: envelope("good"), idempotencyKey: "good", maxAttempts: 3 });
		let goodRuns = 0;
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", baseDelayMs: 1, maxDelayMs: 1 });
		queue.recover((job) => ({ ...job, run() { goodRuns += 1; } }));
		await queue.drain();
		assert.equal(goodRuns, 1);
		const dead = store.listDead({ queue: "output-persistence-test", limit: 10 });
		assert.equal(dead.length, 3);
		assert.deepEqual(new Set(dead.map((job) => job.deadReason)), new Set(["payload_malformed", "payload_version_unsupported"]));
		assert.equal(JSON.stringify(dead).includes("malformed-secret"), false);
		assert.equal(JSON.stringify(dead).includes("unknown-secret"), false);
		assert.equal(JSON.stringify(dead).includes("versionless-secret"), false);
		assert.equal(store.listJobs({ queue: "output-persistence-test", limit: 10 }).length, 0);
		assert.deepEqual(queue.debugState().counters, { retriable: 0, permanent: 0, quarantined: 2 });
		queue.dispose();
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("drain ignores a foreign heartbeat-renewed claim and leaves it owned by the foreign worker", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-foreign-drain-");
	let heartbeat;
	let queue;
	let store;
	try {
		store = new PiboReliabilityStore(databasePath);
		store.enqueue({ jobId: "job_foreign_drain", queue: "output-persistence-test", payload: envelope("foreign-drain"), maxAttempts: 3 });
		const claimed = store.claimRecoverableJob("job_foreign_drain", "foreign-worker", 80);
		assert.ok(claimed);
		heartbeat = setInterval(() => {
			store.heartbeat(claimed.jobId, claimed.workerId, 80, claimed.claimToken);
		}, 20);
		queue = new OutputPersistenceRetryQueue({
			durableStore: store,
			queueName: "output-persistence-test",
			workerId: "draining-worker",
			visibilityTimeoutMs: 80,
			baseDelayMs: 5,
			maxDelayMs: 5,
		});
		let runs = 0;
		queue.recover((job) => ({ ...job, run() { runs += 1; } }));
		await Promise.race([
			queue.drain(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("drain waited for foreign live claim")), 250)),
		]);
		assert.equal(runs, 0);
		assert.equal(queue.debugState().pending, 0);
		const live = store.listJobs({ queue: "output-persistence-test" });
		assert.equal(live.length, 1);
		assert.equal(live[0].state, "running");
		assert.equal(live[0].workerId, "foreign-worker");
		assert.equal(live[0].claimToken, claimed.claimToken);
	} finally {
		if (heartbeat) clearInterval(heartbeat);
		queue?.dispose();
		store?.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("clean shutdown aborts work, cancels heartbeat, and releases the fenced claim", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-shutdown-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		let aborted = false;
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", visibilityTimeoutMs: 50, heartbeatIntervalMs: 10 });
		queue.enqueue({ key: "shutdown", payload: { phase: "v2" }, async run({ signal }) { await new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true })); } });
		await new Promise((resolve) => setTimeout(resolve, 25));
		queue.dispose();
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal(aborted, true);
		assert.deepEqual(queue.debugState(), {
			pending: 0,
			activeHeartbeats: 0,
			deadLetters: [],
			counters: { retriable: 0, permanent: 0, quarantined: 0 },
		});
		const live = store.listJobs({ queue: "output-persistence-test" });
		assert.equal(live.length, 1);
		assert.equal(live[0].state, "pending");
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

for (const crashAt of ["after-outbox-append", "after-outbox-checkpoint", "after-send", "after-receipt"]) {
	test(`outbox delivery reopens idempotently after crash injection ${crashAt}`, async () => {
		const { directory, databasePath } = temporaryDatabase(`pibo-output-crash-${crashAt}-`);
		const sinkPath = join(directory, "observable.sqlite");
		const deliveryId = `delivery:${crashAt}`;
		let store;
		let queue;
		let crashed = false;
		const project = async (context, injectCrash) => {
			const state = context.payload;
			if (state.phase === "pending") {
				store.appendOnce({
					topic: "output-projection-outbox",
					eventId: deliveryId,
					idempotencyKey: deliveryId,
					payload: { deliveryId },
				});
				if (injectCrash && crashAt === "after-outbox-append" && !crashed) {
					crashed = true;
					throw new Error(`crash:${crashAt}`);
				}
				context.updatePayload({ ...state, phase: "outbox" });
				if (injectCrash && crashAt === "after-outbox-checkpoint" && !crashed) {
					crashed = true;
					throw new Error(`crash:${crashAt}`);
				}
			}
			if (!store.hasDeliveryReceipt(deliveryId, "observable-test-v1")) {
				const sink = new DatabaseSync(sinkPath);
				try {
					sink.exec("CREATE TABLE IF NOT EXISTS effects (delivery_id TEXT PRIMARY KEY, sends INTEGER NOT NULL)");
					sink.prepare("INSERT INTO effects (delivery_id, sends) VALUES (?, 1) ON CONFLICT(delivery_id) DO UPDATE SET sends = effects.sends").run(deliveryId);
				} finally {
					sink.close();
				}
				if (injectCrash && crashAt === "after-send" && !crashed) {
					crashed = true;
					throw new Error(`crash:${crashAt}`);
				}
				store.recordDeliveryReceipt(deliveryId, "observable-test-v1");
				if (injectCrash && crashAt === "after-receipt" && !crashed) {
					crashed = true;
					throw new Error(`crash:${crashAt}`);
				}
			}
			context.updatePayload({ deliveryId, phase: "delivered" });
		};
		try {
			store = new PiboReliabilityStore(databasePath);
			queue = new OutputPersistenceRetryQueue({
				durableStore: store,
				queueName: "output-projection-crash-test",
				baseDelayMs: 60_000,
				maxDelayMs: 60_000,
				maxAttempts: 5,
			});
			queue.enqueue({
				key: deliveryId,
				payload: { deliveryId, phase: "pending" },
				run: (context) => project(context, true),
			});
			await waitFor(() => store.listJobs({ queue: "output-projection-crash-test" })[0]?.lastError === `crash:${crashAt}`);
			queue.dispose();
			store.close();

			store = new PiboReliabilityStore(databasePath);
			queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-projection-crash-test", baseDelayMs: 1, maxDelayMs: 1 });
			queue.recover((job) => ({ ...job, run: (context) => project(context, false) }));
			await queue.drain();
			assert.equal(store.listJobs({ queue: "output-projection-crash-test" }).length, 0);
			assert.equal(store.list({ topic: "output-projection-outbox" }).length, 1);
			assert.equal(store.hasDeliveryReceipt(deliveryId, "observable-test-v1"), true);
			const sink = new DatabaseSync(sinkPath, { readOnly: true });
			try {
				const effect = sink.prepare("SELECT delivery_id, sends FROM effects").get();
				assert.equal(effect.delivery_id, deliveryId);
				assert.equal(effect.sends, 1);
			} finally {
				sink.close();
			}
		} finally {
			queue?.dispose();
			try { store?.close(); } catch {}
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
