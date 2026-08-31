import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { inspectOutputIntegrity } from "../dist/debug/output-integrity.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function appendOutput(data, input) {
	data.eventLog.appendEvent({
		sessionId: input.sessionId,
		sessionSequence: input.sequence,
		topic: input.type === "pibo.output.identity_collision" ? "pibo.diagnostic" : "pibo.output",
		type: input.type,
		source: "test",
		eventId: input.eventId,
		toolCallId: input.toolCallId,
		idempotencyKey: input.idempotencyKey,
		retentionClass: input.type === "pibo.output.identity_collision" ? "audit_event" : "trace_event",
		attributes: input.attributes ?? {},
		createdAt: input.createdAt,
		indexedAt: input.createdAt,
	});
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-output-integrity-"));
	const home = join(root, ".pibo");
	mkdirSync(home, { recursive: true });
	const dataPath = join(home, "pibo.sqlite");
	const reliabilityPath = join(home, "pibo-events.sqlite");
	const data = new PiboDataStore(dataPath);
	try {
		appendOutput(data, { sessionId: "ps_healthy", sequence: 1, type: "message_started", eventId: "turn-healthy", createdAt: "2026-08-29T10:00:00.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 2, type: "thinking_started", eventId: "turn-healthy", attributes: { thinkingIndex: 0 }, createdAt: "2026-08-29T10:00:01.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 3, type: "thinking_finished", eventId: "turn-healthy", attributes: { thinkingIndex: 0 }, createdAt: "2026-08-29T10:00:02.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 4, type: "tool_call", eventId: "turn-healthy", toolCallId: "tool-healthy", attributes: { toolInvocationOrdinal: 0 }, createdAt: "2026-08-29T10:00:03.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 5, type: "tool_execution_started", eventId: "turn-healthy", toolCallId: "tool-healthy", attributes: { toolInvocationOrdinal: 0 }, createdAt: "2026-08-29T10:00:04.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 6, type: "tool_execution_finished", eventId: "turn-healthy", toolCallId: "tool-healthy", attributes: { toolInvocationOrdinal: 0 }, createdAt: "2026-08-29T10:00:05.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 7, type: "assistant_message", eventId: "turn-healthy", createdAt: "2026-08-29T10:00:06.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 8, type: "message_finished", eventId: "turn-healthy", createdAt: "2026-08-29T10:00:07.000Z" });

		appendOutput(data, { sessionId: "ps_incomplete", sequence: 1, type: "message_started", eventId: "turn-incomplete", createdAt: "2026-08-30T10:00:00.000Z" });
		appendOutput(data, { sessionId: "ps_incomplete", sequence: 2, type: "thinking_started", eventId: "turn-incomplete", attributes: { thinkingIndex: 0 }, createdAt: "2026-08-30T10:00:01.000Z" });
		appendOutput(data, { sessionId: "ps_incomplete", sequence: 3, type: "tool_call", eventId: "turn-incomplete", toolCallId: "tool-incomplete", attributes: { toolInvocationOrdinal: 0 }, createdAt: "2026-08-30T10:00:02.000Z" });
		appendOutput(data, { sessionId: "ps_incomplete", sequence: 4, type: "tool_execution_started", eventId: "turn-incomplete", toolCallId: "tool-incomplete", attributes: { toolInvocationOrdinal: 0 }, createdAt: "2026-08-30T10:00:03.000Z" });
		appendOutput(data, {
			sessionId: "ps_incomplete",
			sequence: 5,
			type: "pibo.output.identity_collision",
			eventId: "turn-incomplete",
			idempotencyKey: "collision-diagnostic",
			attributes: { outputIdempotencyKey: "pibo.output:ps_incomplete:assistant_message:turn-incomplete:0" },
			createdAt: "2026-08-30T10:00:04.000Z",
		});
	} finally {
		data.close();
	}

	const reliability = new PiboReliabilityStore(reliabilityPath);
	try {
		reliability.enqueue({
			jobId: "job_pending_output",
			queue: "output-persistence",
			payload: { version: 1, piboSessionId: "ps_incomplete", eventId: "turn-incomplete", state: { version: 1, piboSessionId: "ps_incomplete", deliveries: [] } },
			maxAttempts: 5,
		});
		const dead = reliability.enqueue({
			jobId: "job_dead_output",
			queue: "output-persistence-cli",
			payload: { version: 1, piboSessionId: "ps_incomplete", eventId: "turn-incomplete", state: { version: 1, piboSessionId: "ps_incomplete", deliveries: [] } },
			maxAttempts: 5,
		});
		const claimed = reliability.claimJob(dead.jobId, "worker");
		assert.ok(claimed);
		reliability.fail(dead.jobId, "worker", 'Pibo output identity collision for "fixture"', claimed.claimToken);
		reliability.db.prepare(`
			INSERT INTO pibo_dead_jobs (
				job_id, queue, payload_json, attempts, max_attempts, idempotency_key,
				created_at, updated_at, expires_at, last_error, dead_at, dead_reason
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
		`).run(
			"job_malformed_output",
			"output-persistence",
			'{"secret":"malformed-output-secret"',
			1,
			5,
			"malformed-output",
			"2026-08-30T11:00:00.000Z",
			"2026-08-30T11:00:00.000Z",
			"malformed-output-secret",
			"2026-08-30T11:00:00.000Z",
			"payload_malformed",
		);
	} finally {
		reliability.close();
	}
	return { root, home, dataPath, reliabilityPath };
}

function inspect(fixture, input = {}) {
	return inspectOutputIntegrity({
		dataStore: { name: "pibo-data", description: "test", defaultPath: "pibo.sqlite", path: fixture.dataPath, exists: true },
		reliabilityStore: { name: "reliability", description: "test", defaultPath: "pibo-events.sqlite", path: fixture.reliabilityPath, exists: true },
		...input,
	});
}

test("output integrity audit reports lifecycle, collision, and queue findings without writes", () => {
	const fixture = createFixture();
	try {
		const beforeData = new PiboDataStore(fixture.dataPath);
		const beforeEventCount = beforeData.eventLog.listEvents({}).length;
		beforeData.close();
		const beforeReliability = new PiboReliabilityStore(fixture.reliabilityPath);
		const beforeLiveJobs = beforeReliability.listJobs({}).length;
		const beforeDeadJobs = beforeReliability.listDead({}).length;
		beforeReliability.close();

		const audit = inspect(fixture, { limit: 20 });
		assert.equal(audit.readOnly, true);
		assert.deepEqual(audit.summary, {
			findingCount: 7,
			returnedFindings: 7,
			turnLifecycleIssues: 1,
			thinkingLifecycleIssues: 1,
			toolLifecycleIssues: 1,
			identityCollisions: 1,
			pendingOutputJobs: 1,
			deadOutputJobs: 2,
			deadIdentityCollisions: 1,
		});
		assert.deepEqual(new Set(audit.findings.map((finding) => finding.kind)), new Set([
			"turn_lifecycle",
			"thinking_lifecycle",
			"tool_lifecycle",
			"identity_collision",
			"pending_output_job",
			"dead_output_job",
		]));
		assert.equal(audit.findings.filter((finding) => finding.piboSessionId).every((finding) => finding.piboSessionId === "ps_incomplete"), true);
		assert.equal(audit.findings.some((finding) => finding.kind === "dead_output_job" && finding.identityCollision === true), true);
		assert.equal(audit.findings.some((finding) => finding.jobId === "job_malformed_output" && finding.payloadValid === false), true);
		assert.equal(JSON.stringify(audit).includes('Pibo output identity collision for "fixture"'), false);
		assert.equal(JSON.stringify(audit).includes("malformed-output-secret"), false);

		const afterData = new PiboDataStore(fixture.dataPath);
		assert.equal(afterData.eventLog.listEvents({}).length, beforeEventCount);
		afterData.close();
		const afterReliability = new PiboReliabilityStore(fixture.reliabilityPath);
		assert.equal(afterReliability.listJobs({}).length, beforeLiveJobs);
		assert.equal(afterReliability.listDead({}).length, beforeDeadJobs);
		afterReliability.close();
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output integrity audit supports session, cutoff, and bounded detail scopes", () => {
	const fixture = createFixture();
	try {
		const healthy = inspect(fixture, { piboSessionId: "ps_healthy", limit: 20 });
		assert.equal(healthy.summary.findingCount, 0);
		assert.deepEqual(healthy.findings, []);

		const bounded = inspect(fixture, { piboSessionId: "ps_incomplete", limit: 2 });
		assert.equal(bounded.summary.findingCount, 6);
		assert.equal(bounded.summary.returnedFindings, 2);
		assert.equal(bounded.findings.length, 2);

		const beforeIncomplete = inspect(fixture, { before: "2026-08-30T00:00:00.000Z", limit: 20 });
		assert.equal(beforeIncomplete.summary.findingCount, 0);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("pibo debug integrity stays progressive and returns the read-only JSON audit", async () => {
	const fixture = createFixture();
	try {
		const rootHelp = await execFileAsync("node", [cliPath, "debug", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(rootHelp.stdout, /integrity Audit output persistence across local stores/);
		assert.doesNotMatch(rootHelp.stdout, /pibo_dead_jobs/);

		const integrityHelp = await execFileAsync("node", [cliPath, "debug", "integrity", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(integrityHelp.stdout, /audit persisted output without changing it/);
		assert.match(integrityHelp.stdout, /pibo debug integrity output/);
		assert.doesNotMatch(integrityHelp.stdout, /SELECT COUNT/);
		const outputHelp = await execFileAsync("node", [cliPath, "debug", "integrity", "output", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.equal(outputHelp.stdout, integrityHelp.stdout);

		const result = await execFileAsync("node", [cliPath, "debug", "integrity", "output", "ps_incomplete", "--limit", "20", "--json"], {
			env: { ...process.env, PIBO_HOME: fixture.home },
		});
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.resultType, "debug.integrity.output");
		assert.equal(parsed.readOnly, true);
		assert.equal(parsed.scope.piboSessionId, "ps_incomplete");
		assert.equal(parsed.summary.findingCount, 6);
		assert.equal(parsed.summary.deadIdentityCollisions, 1);
		assert.equal(JSON.stringify(parsed).includes("deliveries"), false);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
