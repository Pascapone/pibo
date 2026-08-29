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
		const stalePromise = runWorker(databasePath, "worker-stale", "stale", 180, 50);
		await new Promise((resolve) => setTimeout(resolve, 80));
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

test("unknown and malformed durable payloads quarantine while later jobs continue", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-quarantine-");
	try {
		const store = new PiboReliabilityStore(databasePath);
		const timestamp = new Date().toISOString();
		const insert = store.db.prepare(`
			INSERT INTO pibo_jobs (job_id, queue, state, payload_json, run_at, priority, worker_id, claim_expires_at, attempts, max_attempts, idempotency_key, created_at, updated_at, expires_at, last_error)
			VALUES (?, 'output-persistence-test', 'pending', ?, ?, 0, NULL, NULL, 0, 3, ?, ?, ?, NULL, NULL)
		`);
		insert.run("job_unknown", JSON.stringify({ version: 999, key: "unknown", state: { secret: "unknown-secret" } }), timestamp, "unknown", timestamp, timestamp);
		insert.run("job_malformed", "{\"secret\":\"malformed-secret\"", timestamp, "malformed", timestamp, timestamp);
		store.enqueue({ queue: "output-persistence-test", payload: envelope("good"), idempotencyKey: "good", maxAttempts: 3 });
		let goodRuns = 0;
		const queue = new OutputPersistenceRetryQueue({ durableStore: store, queueName: "output-persistence-test", baseDelayMs: 1, maxDelayMs: 1 });
		queue.recover((job) => ({ ...job, run() { goodRuns += 1; } }));
		await queue.drain();
		assert.equal(goodRuns, 1);
		const dead = store.listDead({ queue: "output-persistence-test", limit: 10 });
		assert.deepEqual(new Set(dead.map((job) => job.deadReason)), new Set(["payload_malformed", "payload_version_unsupported"]));
		assert.equal(JSON.stringify(dead).includes("malformed-secret"), false);
		assert.equal(JSON.stringify(dead).includes("unknown-secret"), false);
		assert.equal(store.listJobs({ queue: "output-persistence-test", limit: 10 }).length, 0);
		queue.dispose();
		store.close();
	} finally {
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
		assert.deepEqual(queue.debugState(), { pending: 0, activeHeartbeats: 0, deadLetters: [] });
		const live = store.listJobs({ queue: "output-persistence-test" });
		assert.equal(live.length, 1);
		assert.equal(live[0].state, "pending");
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
