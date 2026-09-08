import assert from "node:assert/strict";
import test from "node:test";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

test("event stream appendOnce is idempotent by event id and idempotency key", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const first = store.appendOnce({
			topic: "pibo.output",
			eventId: "event-1",
			idempotencyKey: "idem-1",
			retentionClass: "trace_event",
			payload: { type: "assistant_message", text: "one" },
		});
		const duplicateEventId = store.appendOnce({
			topic: "pibo.output",
			eventId: "event-1",
			payload: { text: "ignored" },
		});
		const duplicateIdempotency = store.appendOnce({
			topic: "pibo.output",
			eventId: "event-2",
			idempotencyKey: "idem-1",
			payload: { text: "ignored" },
		});

		assert.equal(duplicateEventId.streamId, first.streamId);
		assert.equal(duplicateIdempotency.streamId, first.streamId);
		assert.deepEqual(store.list({ topic: "pibo.output" }).map((event) => event.streamId), [first.streamId]);
	} finally {
		store.close();
	}
});

test("consumer offsets are monotonic and replay is cursor based", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const first = store.append({ topic: "topic", eventId: "1", payload: { value: 1 } });
		const second = store.append({ topic: "topic", eventId: "2", payload: { value: 2 } });
		store.saveConsumerOffset("topic", "projector", second.streamId);
		store.saveConsumerOffset("topic", "projector", first.streamId);

		assert.deepEqual(store.readFromConsumer("topic", "projector").map((event) => event.eventId), []);
		const third = store.append({ topic: "topic", eventId: "3", payload: { value: 3 } });
		assert.deepEqual(store.readFromConsumer("topic", "projector").map((event) => event.streamId), [third.streamId]);
	} finally {
		store.close();
	}
});

test("retention preserves rows still needed by named consumers", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const first = store.append({
			topic: "topic",
			eventId: "1",
			createdAt: "2026-01-01T00:00:00.000Z",
			retentionClass: "live_delta",
			payload: { value: 1 },
		});
		const second = store.append({
			topic: "topic",
			eventId: "2",
			createdAt: "2026-01-01T00:00:00.000Z",
			retentionClass: "live_delta",
			payload: { value: 2 },
		});
		store.saveConsumerOffset("topic", "projector", first.streamId);

		assert.equal(store.prune({ topic: "topic", retentionClass: "live_delta", before: "2026-01-02T00:00:00.000Z" }), 1);
		assert.deepEqual(store.list({ topic: "topic" }).map((event) => event.streamId), [second.streamId]);
		assert.equal(store.prune({ topic: "topic", retentionClass: "live_delta", before: "2026-01-02T00:00:00.000Z", destructive: true }), 1);
	} finally {
		store.close();
	}
});

test("event stream counts group by topic key and retention class", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		store.append({
			topic: "pibo.output",
			key: "ps_parent",
			eventId: "1",
			retentionClass: "live_delta",
			payload: { value: 1 },
		});
		store.append({
			topic: "pibo.output",
			key: "ps_parent",
			eventId: "2",
			retentionClass: "live_delta",
			payload: { value: 2 },
		});
		store.append({
			topic: "pibo.output",
			key: "ps_parent",
			eventId: "3",
			retentionClass: "chat_message",
			payload: { value: 3 },
		});

		assert.deepEqual(store.countEvents({ topic: "pibo.output", key: "ps_parent", retentionClass: "live_delta" }), [
			{
				topic: "pibo.output",
				key: "ps_parent",
				retentionClass: "live_delta",
				count: 2,
			},
		]);
	} finally {
		store.close();
	}
});

test("job claims are exclusive, retry backs off, and exhausted retry moves to DLQ", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const job = store.enqueue({ queue: "runs", payload: { runId: "run_1" }, maxAttempts: 2 });
		assert.equal(store.claimBatch("worker-a", 1, { queue: "runs" })[0].jobId, job.jobId);
		assert.equal(store.claimBatch("worker-b", 1, { queue: "runs" }).length, 0);
		assert.equal(store.retry(job.jobId, "worker-a", { error: "try again", delayMs: 0 }), true);

		const reclaimed = store.claimBatch("worker-b", 1, { queue: "runs", visibilityTimeoutMs: 1000 })[0];
		assert.equal(reclaimed.jobId, job.jobId);
		assert.equal(store.retry(job.jobId, "worker-b", { error: "done retrying" }), true);
		const dead = store.listDead({ queue: "runs" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].jobId, job.jobId);
	} finally {
		store.close();
	}
});

test("direct, recoverable, and batch claims dead-letter jobs before exceeding maxAttempts", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const recoverable = store.enqueue({ queue: "recoverable", payload: { value: 1 }, maxAttempts: 2 });
		assert.equal(store.claimJob(recoverable.jobId, "worker-1", 1000)?.attempts, 1);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", recoverable.jobId);
		assert.equal(store.claimRecoverableJob(recoverable.jobId, "worker-2", 1000)?.attempts, 2);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", recoverable.jobId);
		assert.equal(store.claimRecoverableJob(recoverable.jobId, "worker-3", 1000), undefined);
		assert.equal(store.hasLiveJob(recoverable.jobId), false);
		assert.deepEqual(store.listDead({ queue: "recoverable" }).map((job) => ({
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			deadReason: job.deadReason,
			lastError: job.lastError,
		})), [{
			attempts: 2,
			maxAttempts: 2,
			deadReason: "max_attempts",
			lastError: "Job exhausted retry attempts.",
		}]);

		const batch = store.enqueue({ queue: "batch", payload: { value: 2 }, maxAttempts: 1 });
		assert.equal(store.claimBatch("batch-worker-1", 1, { queue: "batch", visibilityTimeoutMs: 1000 })[0]?.attempts, 1);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", batch.jobId);
		assert.deepEqual(store.claimBatch("batch-worker-2", 1, { queue: "batch" }), []);
		assert.equal(store.hasRecoverableJobs("batch", true), false);
		assert.equal(store.listDead({ queue: "batch" })[0]?.deadReason, "max_attempts");

		const pending = store.enqueue({ queue: "direct", payload: { value: 3 }, maxAttempts: 1 });
		store.db.prepare("UPDATE pibo_jobs SET attempts = max_attempts WHERE job_id = ?").run(pending.jobId);
		assert.equal(store.claimJob(pending.jobId, "direct-worker"), undefined);
		assert.equal(store.listDead({ queue: "direct" })[0]?.deadReason, "max_attempts");
	} finally {
		store.close();
	}
});

test("releasing the final permitted claim moves the job to the DLQ", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const job = store.enqueue({ queue: "release", payload: { value: 1 }, maxAttempts: 1 });
		const claimed = store.claimJob(job.jobId, "worker", 1000);
		assert.ok(claimed);
		assert.equal(store.releaseJob(job.jobId, "worker", 0, claimed.claimToken), true);
		assert.equal(store.hasLiveJob(job.jobId), false);
		assert.equal(store.listDead({ queue: "release" })[0]?.deadReason, "max_attempts");
	} finally {
		store.close();
	}
});

test("createRun rolls job, claim, and run record back at every crash boundary", () => {
	for (const boundary of ["after_enqueue", "after_claim", "before_run_insert", "after_run_insert"]) {
		const store = new PiboReliabilityStore(":memory:", {
			onRunCreationBoundary(current) {
				if (current === boundary) throw new Error(`crash:${boundary}`);
			},
		});
		try {
			assert.throws(() => store.createRun({
				runId: `run_${boundary}`,
				controllerPiboSessionId: "ps_parent",
				toolName: "bash",
				completionPolicy: "tracked",
			}), new RegExp(`crash:${boundary}`));
			assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM pibo_jobs").get().count, 0, boundary);
			assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM pibo_runs").get().count, 0, boundary);
		} finally {
			store.close();
		}
	}

	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			runId: "run_atomic_success",
			controllerPiboSessionId: "ps_parent",
			toolName: "bash",
			completionPolicy: "tracked",
		});
		const job = store.listJobs({ queue: "runs" });
		assert.equal(job.length, 1);
		assert.equal(job[0].jobId, run.jobId);
		assert.equal(job[0].state, "running");
		assert.equal(job[0].attempts, 1);
	} finally {
		store.close();
	}
});

test("createRun remains claimable when the clock advances during enqueue", (t) => {
	const store = new PiboReliabilityStore(":memory:");
	const timestamp = Date.parse("2026-09-08T00:00:00Z");
	t.mock.timers.enable({ apis: ["Date"], now: timestamp });
	const enqueue = store.enqueue.bind(store);
	t.mock.method(store, "enqueue", (input) => {
		t.mock.timers.tick(10);
		return enqueue(input);
	});
	try {
		const run = store.createRun({ controllerPiboSessionId: "ps_parent", toolName: "bash", completionPolicy: "tracked" });
		const [job] = store.listJobs({ queue: "runs" });
		assert.equal(job.jobId, run.jobId);
		assert.equal(job.state, "running");
		assert.equal(job.runAt, new Date(timestamp).toISOString());
	} finally {
		store.close();
	}
});

test("orphan run reconciliation is lease-safe, matching-run-safe, and idempotent", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const expiredOrphan = store.enqueue({ jobId: "job_expired_orphan", queue: "runs", payload: { runId: "run_missing" } });
		store.claimJob(expiredOrphan.jobId, "old-worker", 1000);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", expiredOrphan.jobId);

		const liveOrphan = store.enqueue({ jobId: "job_live_orphan", queue: "runs", payload: { runId: "run_live_missing" } });
		store.claimJob(liveOrphan.jobId, "live-worker", 60_000);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2099-01-01T00:00:00.000Z", liveOrphan.jobId);

		const valid = store.createRun({
			runId: "run_valid_expired",
			controllerPiboSessionId: "ps_parent",
			toolName: "bash",
			completionPolicy: "tracked",
		});
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", valid.jobId);

		const dryRun = store.reconcileOrphanRunJobs({ apply: false, now: new Date("2026-09-08T00:00:00.000Z") });
		assert.deepEqual(dryRun.candidates.map((job) => job.jobId), [expiredOrphan.jobId]);
		assert.equal(dryRun.candidates[0].claimExpired, true);
		assert.equal(dryRun.candidates[0].missingRunRecord, true);
		assert.equal(dryRun.candidates[0].effectiveLiveness, "expired_orphan");
		assert.equal(dryRun.moved, 0);
		assert.equal(store.hasLiveJob(expiredOrphan.jobId), true);

		const applied = store.reconcileOrphanRunJobs({ apply: true, now: new Date("2026-09-08T00:00:00.000Z") });
		assert.equal(applied.moved, 1);
		assert.equal(store.hasLiveJob(expiredOrphan.jobId), false);
		assert.equal(store.hasLiveJob(liveOrphan.jobId), true);
		assert.equal(store.hasLiveJob(valid.jobId), true);
		const dead = store.listDead({ queue: "runs" }).find((job) => job.jobId === expiredOrphan.jobId);
		assert.equal(dead?.deadReason, "orphan_run_job");
		assert.equal(dead?.lastError, "Expired runs job has no matching pibo_runs record.");

		assert.deepEqual(store.reconcileOrphanRunJobs({ apply: true, now: new Date("2026-09-08T00:00:00.000Z") }), {
			checkedAt: "2026-09-08T00:00:00.000Z",
			apply: true,
			candidates: [],
			moved: 0,
		});
		assert.deepEqual(store.getRunJobReliabilityStatus(), {
			status: "degraded",
			expiredOrphanRunJobs: 0,
			orphanRunDeadLetters: 1,
		});
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns reconciles expired orphan run jobs before run rows", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const orphan = store.enqueue({ queue: "runs", payload: { runId: "run_missing" } });
		store.claimJob(orphan.jobId, "run-registry:gone", 1000);
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", orphan.jobId);

		assert.deepEqual(store.recoverInterruptedRuns("run-registry:new"), []);
		assert.equal(store.hasLiveJob(orphan.jobId), false);
		assert.equal(store.listDead({ queue: "runs" })[0].deadReason, "orphan_run_job");
		assert.deepEqual(store.recoverInterruptedRuns("run-registry:new"), []);
		assert.equal(store.listDead({ queue: "runs" }).length, 1);
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns reconciles an unexpired claim owned by a previous runtime", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "bash",
			completionPolicy: "tracked",
			retryable: false,
			workerId: "run-registry:previous-runtime",
		});

		assert.deepEqual(store.recoverInterruptedRuns("run-registry:previous-runtime"), []);
		const recovered = store.recoverInterruptedRuns("run-registry:new-runtime");

		assert.equal(recovered.length, 1);
		assert.equal(recovered[0].runId, run.runId);
		assert.equal(recovered[0].status, "failed");
		assert.match(recovered[0].error, /interrupted before completion/);
		assert.deepEqual(store.listJobs({ queue: "runs" }), []);
		assert.equal(store.listDead({ queue: "runs" })[0].deadReason, "interrupted");
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns classifies an elapsed run deadline after restart", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "bash",
			completionPolicy: "tracked",
			retryable: false,
			timeoutMs: 30 * 60 * 1000,
			workerId: "run-registry:previous-runtime",
		});
		store.db.prepare("UPDATE pibo_runs SET timeout_at = ? WHERE run_id = ?").run(
			new Date(Date.now() - 1000).toISOString(),
			run.runId,
		);

		const recovered = store.recoverInterruptedRuns("run-registry:new-runtime");

		assert.equal(recovered.length, 1);
		assert.equal(recovered[0].status, "timed_out");
		assert.equal(recovered[0].timeoutPhase, "lifetime");
		assert.match(recovered[0].error, /deadline .* elapsed/);
		assert.equal(store.listDead({ queue: "runs" })[0].deadReason, "timeout");
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns fails non-retryable expired runs and moves their jobs to DLQ", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "slow_tool",
			completionPolicy: "tracked",
			retryable: false,
		});
		const expiredAt = new Date(Date.now() - 1000).toISOString();
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?").run(expiredAt, run.jobId);

		const recovered = store.recoverInterruptedRuns();

		assert.equal(recovered.length, 1);
		assert.equal(recovered[0].runId, run.runId);
		assert.equal(recovered[0].status, "failed");
		assert.equal(recovered[0].error, "Run was interrupted before completion and the tool is not retryable.");
		assert.ok(recovered[0].completedAt);
		assert.deepEqual(store.listJobs({ queue: "runs" }), []);
		const dead = store.listDead({ queue: "runs" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].jobId, run.jobId);
		assert.equal(dead[0].deadReason, "interrupted");
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns queues retryable expired runs and makes their jobs claimable", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "retryable_tool",
			completionPolicy: "tracked",
			retryable: true,
			maxAttempts: 2,
		});
		const expiredAt = new Date(Date.now() - 1000).toISOString();
		store.db.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE job_id = ?").run(expiredAt, run.jobId);

		const recovered = store.recoverInterruptedRuns();

		assert.equal(recovered.length, 1);
		assert.equal(recovered[0].runId, run.runId);
		assert.equal(recovered[0].status, "queued");
		assert.equal(recovered[0].completedAt, undefined);
		assert.equal(recovered[0].summary, "retryable_tool run is queued for retry after interruption.");
		assert.deepEqual(store.listDead({ queue: "runs" }), []);
		const pending = store.listJobs({ queue: "runs", state: "pending" });
		assert.equal(pending.length, 1);
		assert.equal(pending[0].jobId, run.jobId);
		const reclaimed = store.claimBatch("worker-retry", 1, { queue: "runs" });
		assert.equal(reclaimed.length, 1);
		assert.equal(reclaimed[0].jobId, run.jobId);
	} finally {
		store.close();
	}
});

test("recoverInterruptedRuns dead-letters a retryable run whose persisted job exhausted maxAttempts", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "retryable_tool",
			completionPolicy: "tracked",
			retryable: true,
			maxAttempts: 2,
			workerId: "run-registry:previous-runtime",
		});
		store.db.prepare("UPDATE pibo_jobs SET attempts = max_attempts, claim_expires_at = ? WHERE job_id = ?")
			.run("2000-01-01T00:00:00.000Z", run.jobId);

		const recovered = store.recoverInterruptedRuns("run-registry:new-runtime");

		assert.equal(recovered.length, 1);
		assert.equal(recovered[0].status, "failed");
		assert.equal(recovered[0].error, "Job exhausted retry attempts.");
		assert.ok(recovered[0].completedAt);
		assert.deepEqual(store.listJobs({ queue: "runs" }), []);
		const dead = store.listDead({ queue: "runs" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].jobId, run.jobId);
		assert.equal(dead[0].attempts, 2);
		assert.equal(dead[0].maxAttempts, 2);
		assert.equal(dead[0].deadReason, "max_attempts");
	} finally {
		store.close();
	}
});

test("expired claim cannot ack and DLQ replay creates a new live job", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const job = store.enqueue({ queue: "runs", payload: { runId: "run_1" }, maxAttempts: 2 });
		store.claimBatch("worker-a", 1, { visibilityTimeoutMs: 1 });

		return new Promise((resolve) => {
			setTimeout(() => {
				assert.equal(store.ack(job.jobId, "worker-a"), false);
				assert.equal(store.claimBatch("worker-b", 1)[0].jobId, job.jobId);
				assert.equal(store.fail(job.jobId, "worker-b", "failed"), true);
				const replayed = store.requeueDead(job.jobId);
				assert.notEqual(replayed.jobId, job.jobId);
				assert.equal(replayed.queue, "runs");
				store.close();
				resolve();
			}, 5);
		});
	} catch (error) {
		store.close();
		throw error;
	}
});
