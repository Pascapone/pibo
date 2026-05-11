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

test("recoverInterruptedRuns fails non-retryable expired runs and moves their jobs to DLQ", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const run = store.createRun({
			ownerPiboSessionId: "ps_parent",
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
			ownerPiboSessionId: "ps_parent",
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

test("expired claim cannot ack and DLQ replay creates a new live job", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const job = store.enqueue({ queue: "runs", payload: { runId: "run_1" } });
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
