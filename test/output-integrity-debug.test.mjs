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

function insertSession(data, id, status, createdAt) {
	data.db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, channel, kind, profile, title, status,
			created_at, updated_at, last_activity_at
		) VALUES (?, ?, 'web', 'conversation', 'default', ?, ?, ?, ?, ?)
	`).run(id, `pi_${id}`, id, status, createdAt, createdAt, createdAt);
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-output-integrity-"));
	const home = join(root, ".pibo");
	mkdirSync(home, { recursive: true });
	const dataPath = join(home, "pibo.sqlite");
	const reliabilityPath = join(home, "pibo-events.sqlite");
	const data = new PiboDataStore(dataPath);
	try {
		insertSession(data, "ps_healthy", "idle", "2026-08-29T10:00:00.000Z");
		insertSession(data, "ps_incomplete", "idle", "2026-08-30T10:00:00.000Z");
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
			type: "assistant_message",
			eventId: "turn-incomplete",
			idempotencyKey: "pibo.output:ps_incomplete:assistant_message:turn-incomplete:0",
			createdAt: "2026-08-30T10:00:03.500Z",
		});
		appendOutput(data, {
			sessionId: "ps_incomplete",
			sequence: 6,
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
		reliability.db.prepare(`
			UPDATE pibo_jobs
			SET run_at = '2026-08-30T10:00:05.000Z',
				created_at = '2026-08-30T10:00:05.000Z',
				updated_at = '2026-08-30T10:00:05.000Z'
		`).run();
		reliability.db.prepare(`
			UPDATE pibo_dead_jobs
			SET created_at = CASE job_id WHEN 'job_dead_output' THEN '2026-08-30T10:00:06.000Z' ELSE created_at END,
				updated_at = CASE job_id WHEN 'job_dead_output' THEN '2026-08-30T10:00:06.000Z' ELSE updated_at END,
				dead_at = CASE job_id WHEN 'job_dead_output' THEN '2026-08-30T10:00:06.000Z' ELSE dead_at END
		`).run();
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
			findingCount: 9,
			returnedFindings: 9,
			turnLifecycleIssues: 1,
			thinkingLifecycleIssues: 1,
			toolLifecycleIssues: 1,
			identityCollisions: 1,
			outputKeyReuses: 1,
			sessionTraceStatusMismatches: 1,
			pendingOutputJobs: 1,
			deadOutputJobs: 2,
			deadIdentityCollisions: 1,
		});
		assert.deepEqual(new Set(audit.findings.map((finding) => finding.kind)), new Set([
			"turn_lifecycle",
			"thinking_lifecycle",
			"tool_lifecycle",
			"identity_collision",
			"output_key_reuse",
			"session_trace_status",
			"pending_output_job",
			"dead_output_job",
		]));
		assert.equal(audit.findings.filter((finding) => finding.piboSessionId).every((finding) => finding.piboSessionId === "ps_incomplete"), true);
		assert.equal(audit.findings.some((finding) => finding.kind === "dead_output_job" && finding.identityCollision === true), true);
		assert.equal(audit.findings.some((finding) => finding.kind === "dead_output_job" && finding.relatedIdentityCollision === true), true);
		assert.equal(audit.findings.some((finding) => finding.kind === "output_key_reuse" && finding.uses === 2), true);
		assert.equal(audit.findings.some((finding) => finding.kind === "session_trace_status" && finding.sessionStatus === "idle" && finding.projectedStatus === "running"), true);
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
		assert.equal(bounded.summary.findingCount, 8);
		assert.equal(bounded.summary.returnedFindings, 2);
		assert.equal(bounded.findings.length, 2);

		const beforeIncomplete = inspect(fixture, { before: "2026-08-30T00:00:00.000Z", limit: 20 });
		assert.equal(beforeIncomplete.summary.findingCount, 0, JSON.stringify(beforeIncomplete.summary));
		const afterIncomplete = inspect(fixture, { since: "2026-09-01T00:00:00.000Z", limit: 20 });
		assert.equal(afterIncomplete.summary.findingCount, 0);

		const healthyAcrossSinceBoundary = inspect(fixture, {
			piboSessionId: "ps_healthy",
			since: "2026-08-29T10:00:04.000Z",
			limit: 20,
		});
		assert.equal(healthyAcrossSinceBoundary.summary.findingCount, 0);
		const healthyAcrossBeforeBoundary = inspect(fixture, {
			piboSessionId: "ps_healthy",
			before: "2026-08-29T10:00:04.000Z",
			limit: 20,
		});
		assert.equal(healthyAcrossBeforeBoundary.summary.findingCount, 0);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output integrity audit matches terminal reconstruction and rejects duplicate thinking lifecycles", () => {
	const fixture = createFixture();
	const data = new PiboDataStore(fixture.dataPath);
	try {
		insertSession(data, "ps_historical_incomplete", "idle", "2026-08-28T10:00:00.000Z");
		appendOutput(data, { sessionId: "ps_historical_incomplete", sequence: 1, type: "message_started", eventId: "turn-old", createdAt: "2026-08-28T10:00:00.000Z" });
		appendOutput(data, { sessionId: "ps_historical_incomplete", sequence: 2, type: "message_started", eventId: "turn-new", createdAt: "2026-08-28T11:00:00.000Z" });
		appendOutput(data, { sessionId: "ps_historical_incomplete", sequence: 3, type: "assistant_message", eventId: "turn-new", createdAt: "2026-08-28T11:00:01.000Z" });
		appendOutput(data, { sessionId: "ps_historical_incomplete", sequence: 4, type: "message_finished", eventId: "turn-new", createdAt: "2026-08-28T11:00:02.000Z" });

		appendOutput(data, { sessionId: "ps_healthy", sequence: 9, type: "thinking_started", eventId: "turn-healthy", attributes: { thinkingIndex: 0 }, createdAt: "2026-08-29T10:00:08.000Z" });
		appendOutput(data, { sessionId: "ps_healthy", sequence: 10, type: "thinking_finished", eventId: "turn-healthy", attributes: { thinkingIndex: 0 }, createdAt: "2026-08-29T10:00:09.000Z" });
	} finally {
		data.close();
	}
	try {
		const historical = inspect(fixture, { piboSessionId: "ps_historical_incomplete", limit: 20 });
		assert.equal(historical.summary.turnLifecycleIssues, 1);
		assert.equal(historical.summary.sessionTraceStatusMismatches, 0);

		const duplicateThinking = inspect(fixture, { piboSessionId: "ps_healthy", limit: 20 });
		assert.equal(duplicateThinking.summary.thinkingLifecycleIssues, 1);
		assert.equal(duplicateThinking.findings.some((finding) => finding.kind === "thinking_lifecycle" && finding.started === 2 && finding.finished === 2), true);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("pibo debug persistence stays progressive and returns read-only audit and dead-letter views", async () => {
	const fixture = createFixture();
	try {
		const rootHelp = await execFileAsync("node", [cliPath, "debug", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(rootHelp.stdout, /persistence Audit output persistence and related dead letters/);
		assert.doesNotMatch(rootHelp.stdout, /pibo_dead_jobs/);

		const persistenceHelp = await execFileAsync("node", [cliPath, "debug", "persistence", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(persistenceHelp.stdout, /audit.*dead-letters/s);
		assert.doesNotMatch(persistenceHelp.stdout, /SELECT COUNT/);
		const auditHelp = await execFileAsync("node", [cliPath, "debug", "persistence", "audit", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(auditHelp.stdout, /--session/);
		assert.match(auditHelp.stdout, /--since/);
		assert.match(auditHelp.stdout, /reused output keys/);
		const deadHelp = await execFileAsync("node", [cliPath, "debug", "persistence", "dead-letters", "--help"], { env: { ...process.env, PIBO_HOME: fixture.home } });
		assert.match(deadHelp.stdout, /related to persisted collision diagnostics/);

		const result = await execFileAsync("node", [cliPath, "debug", "persistence", "audit", "--session", "ps_incomplete", "--since", "2026-08-30T00:00:00.000Z", "--limit", "20", "--json"], {
			env: { ...process.env, PIBO_HOME: fixture.home },
		});
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.resultType, "debug.integrity.output");
		assert.equal(parsed.readOnly, true);
		assert.equal(parsed.scope.piboSessionId, "ps_incomplete");
		assert.equal(parsed.scope.since, "2026-08-30T00:00:00.000Z");
		assert.equal(parsed.summary.findingCount, 8);
		assert.equal(parsed.summary.outputKeyReuses, 1);
		assert.equal(parsed.summary.sessionTraceStatusMismatches, 1);
		assert.equal(parsed.summary.deadIdentityCollisions, 1);
		assert.equal(JSON.stringify(parsed).includes("deliveries"), false);

		const deadResult = await execFileAsync("node", [cliPath, "debug", "persistence", "dead-letters", "--session", "ps_incomplete", "--limit", "20", "--json"], {
			env: { ...process.env, PIBO_HOME: fixture.home },
		});
		const dead = JSON.parse(deadResult.stdout);
		assert.equal(dead.resultType, "debug.persistence.dead-letters");
		assert.equal(dead.readOnly, true);
		assert.equal(dead.summary.deadOutputJobs, 1);
		assert.equal(dead.summary.relatedIdentityCollisions, 1);
		assert.equal(dead.deadLetters.length, 1);

		const compatibility = await execFileAsync("node", [cliPath, "debug", "integrity", "output", "ps_incomplete", "--limit", "20", "--json"], {
			env: { ...process.env, PIBO_HOME: fixture.home },
		});
		assert.equal(JSON.parse(compatibility.stdout).summary.findingCount, 8);

		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "persistence", "audit", "--apply"], { env: { ...process.env, PIBO_HOME: fixture.home } }),
			(error) => /read-only; --apply is not supported/.test(error.stderr),
		);
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "integrity", "output", "ps_incomplete", "ps_healthy"], { env: { ...process.env, PIBO_HOME: fixture.home } }),
			(error) => /at most one positional/.test(error.stderr),
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
