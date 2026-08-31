import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { repairOutputTurn, repairOutputTurns } from "../dist/debug/output-repair.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function append(data, input) {
	data.eventLog.appendEvent({
		sessionId: input.sessionId,
		sessionSequence: input.sequence,
		topic: "pibo.output",
		type: input.type,
		source: "test",
		eventId: input.eventId,
		toolCallId: input.toolCallId,
		retentionClass: "trace_event",
		attributes: input.attributes ?? {},
		createdAt: input.createdAt ?? "2026-08-30T10:00:00.000Z",
		indexedAt: input.createdAt ?? "2026-08-30T10:00:00.000Z",
	});
}

function enqueueDead(reliability, input) {
	const job = reliability.enqueue({
		jobId: input.jobId,
		queue: input.queue ?? "output-persistence",
		payload: input.payload,
		maxAttempts: 1,
	});
	const claimed = reliability.claimJob(job.jobId, "worker");
	assert.ok(claimed);
	reliability.fail(job.jobId, "worker", input.error ?? "fixture dead output", claimed.claimToken);
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-output-repair-"));
	const home = join(root, ".pibo");
	mkdirSync(home, { recursive: true });
	const dataPath = join(home, "pibo.sqlite");
	const reliabilityPath = join(home, "pibo-events.sqlite");
	const data = new PiboDataStore(dataPath);
	try {
		const sessions = new PiboDataSessionStore(data);
		for (const id of [
			"ps_success",
			"ps_missing_evidence",
			"ps_complete",
			"ps_duplicate",
			"ps_open",
			"ps_active",
			"ps_reliability",
			"ps_conflict",
			"ps_adapter",
			"ps_adapter_running",
			"ps_scope",
		]) sessions.create({ id, channel: "test", kind: "chat", profile: "base" });

		append(data, { sessionId: "ps_success", sequence: 1, type: "message_started", eventId: "turn-success", attributes: { source: "user", inlineText: "repair" } });
		append(data, { sessionId: "ps_success", sequence: 2, type: "thinking_started", eventId: "turn-success", attributes: { thinkingIndex: 0 } });
		append(data, { sessionId: "ps_success", sequence: 3, type: "thinking_finished", eventId: "turn-success", attributes: { thinkingIndex: 0 } });
		append(data, { sessionId: "ps_success", sequence: 4, type: "tool_call", eventId: "turn-success", toolCallId: "tool-success", attributes: { toolInvocationOrdinal: 0 } });
		append(data, { sessionId: "ps_success", sequence: 5, type: "tool_execution_started", eventId: "turn-success", toolCallId: "tool-success", attributes: { toolInvocationOrdinal: 0 } });
		append(data, { sessionId: "ps_success", sequence: 6, type: "tool_execution_finished", eventId: "turn-success", toolCallId: "tool-success", attributes: { toolInvocationOrdinal: 0 } });
		append(data, { sessionId: "ps_success", sequence: 7, type: "assistant_message", eventId: "turn-success", attributes: { inlinePayload: { inlineText: "persisted answer" } } });

		append(data, { sessionId: "ps_missing_evidence", sequence: 1, type: "message_started", eventId: "turn-missing-evidence", attributes: { source: "actor" } });
		append(data, { sessionId: "ps_complete", sequence: 1, type: "message_started", eventId: "turn-complete" });
		append(data, { sessionId: "ps_complete", sequence: 2, type: "assistant_message", eventId: "turn-complete" });
		append(data, { sessionId: "ps_complete", sequence: 3, type: "message_finished", eventId: "turn-complete" });
		append(data, { sessionId: "ps_duplicate", sequence: 1, type: "message_started", eventId: "turn-duplicate" });
		append(data, { sessionId: "ps_duplicate", sequence: 2, type: "message_started", eventId: "turn-duplicate" });

		append(data, { sessionId: "ps_open", sequence: 1, type: "message_started", eventId: "turn-open" });
		append(data, { sessionId: "ps_open", sequence: 2, type: "thinking_started", eventId: "turn-open", attributes: { thinkingIndex: 0 } });
		append(data, { sessionId: "ps_open", sequence: 3, type: "assistant_message", eventId: "turn-open", attributes: { inlinePayload: { inlineText: "ambiguous" } } });

		append(data, { sessionId: "ps_active", sequence: 1, type: "message_started", eventId: "turn-active" });
		append(data, { sessionId: "ps_active", sequence: 2, type: "assistant_message", eventId: "turn-active" });
		data.db.prepare("UPDATE sessions SET status = 'running' WHERE id = 'ps_active'").run();

		append(data, { sessionId: "ps_reliability", sequence: 1, type: "message_started", eventId: "turn-reliability" });
		append(data, { sessionId: "ps_conflict", sequence: 1, type: "message_started", eventId: "turn-conflict" });
		append(data, { sessionId: "ps_adapter", sequence: 1, type: "message_started", eventId: "turn-adapter" });
		append(data, { sessionId: "ps_adapter_running", sequence: 1, type: "message_started", eventId: "turn-adapter-running" });

		append(data, { sessionId: "ps_scope", sequence: 1, type: "message_started", eventId: "turn-old", createdAt: "2026-08-29T10:00:00.000Z" });
		append(data, { sessionId: "ps_scope", sequence: 2, type: "assistant_message", eventId: "turn-old", createdAt: "2026-08-29T10:01:00.000Z" });
		append(data, { sessionId: "ps_scope", sequence: 3, type: "message_started", eventId: "turn-new", createdAt: "2026-08-31T10:00:00.000Z" });
		append(data, { sessionId: "ps_scope", sequence: 4, type: "assistant_message", eventId: "turn-new", createdAt: "2026-08-31T10:01:00.000Z" });
	} finally {
		data.close();
	}

	const reliability = new PiboReliabilityStore(reliabilityPath);
	try {
		enqueueDead(reliability, {
			jobId: "job_repair_unrelated",
			payload: { version: 1, piboSessionId: "ps_success", deliveries: [] },
		});
		enqueueDead(reliability, {
			jobId: "job_repair_terminal",
			payload: {
				version: 1,
				piboSessionId: "ps_reliability",
				deliveries: [{ event: { type: "session_error", piboSessionId: "ps_reliability", eventId: "turn-reliability", error: "persisted provider failure" } }],
			},
		});
		enqueueDead(reliability, {
			jobId: "job_repair_conflict",
			payload: {
				version: 1,
				piboSessionId: "ps_conflict",
				deliveries: [
					{ event: { type: "message_finished", piboSessionId: "ps_conflict", eventId: "turn-conflict" } },
					{ event: { type: "session_error", piboSessionId: "ps_conflict", eventId: "turn-conflict", error: "conflicting evidence" } },
				],
			},
		});
	} finally {
		reliability.close();
	}
	return {
		root,
		home,
		dataPath,
		reliabilityPath,
		store: { name: "pibo-data", description: "test", defaultPath: "pibo.sqlite", path: dataPath, exists: true },
		reliabilityStore: { name: "reliability", description: "test", defaultPath: "pibo-events.sqlite", path: reliabilityPath, exists: true },
	};
}

function eventRows(dataPath, sessionId, eventId, types) {
	const data = new PiboDataStore(dataPath);
	try {
		return data.db.prepare(`
			SELECT stream_id AS streamId, type, actor_id AS actorId, attributes_json AS attributesJson, created_at AS createdAt
			FROM event_log
			WHERE session_id = ? AND event_id = ? AND type IN (${types.map(() => "?").join(",")})
			ORDER BY stream_id
		`).all(sessionId, eventId, ...types);
	} finally {
		data.close();
	}
}

function terminalRows(dataPath, sessionId, eventId) {
	return eventRows(dataPath, sessionId, eventId, ["message_finished", "session_error"]);
}

function auditRows(dataPath, sessionId, eventId) {
	return eventRows(dataPath, sessionId, eventId, ["pibo.output.repair_applied"]);
}

test("output repair uses completed Product History, writes an audit event, and is idempotent", () => {
	const fixture = createFixture();
	try {
		const dryRun = repairOutputTurn({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_success", eventId: "turn-success" });
		assert.equal(dryRun.mode, "dry-run");
		assert.equal(dryRun.applied, false);
		assert.equal(dryRun.inspection.repairable, true);
		assert.deepEqual(dryRun.inspection.plannedEvent, { type: "message_finished", source: "user", evidenceSources: ["pibo_product_history"] });
		assert.equal(dryRun.inspection.observed.openThinkingParts, 0);
		assert.equal(dryRun.inspection.observed.openToolInvocations, 0);
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_success", "turn-success"), []);
		assert.deepEqual(auditRows(fixture.dataPath, "ps_success", "turn-success"), []);

		const applied = repairOutputTurn({
			store: fixture.store,
			reliabilityStore: fixture.reliabilityStore,
			piboSessionId: "ps_success",
			eventId: "turn-success",
			apply: true,
			now: () => "2026-08-31T20:00:00.000Z",
		});
		assert.equal(applied.applied, true);
		assert.equal(applied.persisted.type, "message_finished");
		assert.equal(typeof applied.persisted.auditStreamId, "number");
		const terminals = terminalRows(fixture.dataPath, "ps_success", "turn-success");
		assert.equal(terminals.length, 1);
		assert.equal(terminals[0].actorId, "pibo-debug-repair");
		assert.equal(terminals[0].createdAt, "2026-08-31T20:00:00.000Z");
		assert.equal(JSON.parse(terminals[0].attributesJson).source, "user");
		const audits = auditRows(fixture.dataPath, "ps_success", "turn-success");
		assert.equal(audits.length, 1);
		const audit = JSON.parse(audits[0].attributesJson);
		assert.equal(audit.terminalType, "message_finished");
		assert.deepEqual(audit.evidenceSources, ["pibo_product_history"]);
		assert.equal(audit.terminalStreamId, terminals[0].streamId);

		const repeated = repairOutputTurn({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_success", eventId: "turn-success", apply: true });
		assert.equal(repeated.applied, false);
		assert.equal(repeated.inspection.reason, "already_terminal");
		assert.equal(terminalRows(fixture.dataPath, "ps_success", "turn-success").length, 1);
		assert.equal(auditRows(fixture.dataPath, "ps_success", "turn-success").length, 1);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output repair refuses missing, active, ambiguous, duplicate, complete, and conflicting targets", () => {
	const fixture = createFixture();
	try {
		const inspect = (session, event) => repairOutputTurn({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: session, eventId: event, apply: true });
		assert.equal(inspect("ps_missing_evidence", "turn-missing-evidence").inspection.reason, "evidence_missing");
		assert.equal(inspect("ps_open", "turn-open").inspection.reason, "lifecycle_open");
		assert.equal(inspect("ps_active", "turn-active").inspection.reason, "session_active");
		assert.equal(inspect("ps_complete", "turn-complete").inspection.reason, "already_terminal");
		assert.equal(inspect("ps_duplicate", "turn-duplicate").inspection.reason, "message_start_duplicated");
		assert.equal(inspect("ps_success", "turn-missing").inspection.reason, "message_start_missing");
		assert.equal(inspect("ps_missing", "turn-missing").inspection.reason, "session_not_found");
		assert.equal(inspect("ps_conflict", "turn-conflict").inspection.reason, "evidence_conflict");
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_missing_evidence", "turn-missing-evidence"), []);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output repair replays an exact Reliability terminal without inventing content", () => {
	const fixture = createFixture();
	try {
		const dryRun = repairOutputTurn({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_reliability", eventId: "turn-reliability" });
		assert.equal(dryRun.inspection.repairable, true);
		assert.deepEqual(dryRun.inspection.plannedEvent, { type: "session_error", evidenceSources: ["reliability_payload"] });
		assert.doesNotMatch(JSON.stringify(dryRun), /persisted provider failure/);
		const applied = repairOutputTurn({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_reliability", eventId: "turn-reliability", apply: true });
		assert.equal(applied.applied, true);
		const terminals = terminalRows(fixture.dataPath, "ps_reliability", "turn-reliability");
		assert.equal(terminals.length, 1);
		assert.equal(terminals[0].type, "session_error");
		assert.equal(JSON.parse(terminals[0].attributesJson).error, "persisted provider failure");
		assert.equal(auditRows(fixture.dataPath, "ps_reliability", "turn-reliability").length, 1);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output repair accepts only exact completed adapter-history turn evidence", () => {
	const fixture = createFixture();
	try {
		const completedEvidence = {
			available: true,
			entries: [{ id: "native-complete", type: "message", source: "native", createdAt: "2026-08-30T12:00:00.000Z", turnId: "turn-adapter", role: "assistant", content: "adapter secret answer", status: "complete" }],
		};
		const dryRun = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_adapter", eventId: "turn-adapter", adapterEvidence: completedEvidence });
		assert.equal(dryRun.inspection.repairable, true);
		assert.deepEqual(dryRun.inspection.plannedEvent, { type: "message_finished", evidenceSources: ["adapter_history"] });
		assert.doesNotMatch(JSON.stringify(dryRun), /adapter secret answer/);
		const wrongTurn = repairOutputTurn({
			store: fixture.store,
			piboSessionId: "ps_adapter",
			eventId: "turn-adapter",
			adapterEvidence: { ...completedEvidence, entries: [{ ...completedEvidence.entries[0], turnId: "other-turn" }] },
		});
		assert.equal(wrongTurn.inspection.reason, "evidence_missing");
		const running = repairOutputTurn({
			store: fixture.store,
			piboSessionId: "ps_adapter_running",
			eventId: "turn-adapter-running",
			adapterEvidence: { available: true, entries: [{ id: "native-running", type: "message", source: "native", createdAt: "2026-08-30T12:00:00.000Z", turnId: "turn-adapter-running", role: "assistant", content: "partial", status: "running" }] },
		});
		assert.equal(running.inspection.reason, "session_active");
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("scoped output repair is bounded by session and time and remains dry-run by default", () => {
	const fixture = createFixture();
	try {
		const dryRun = repairOutputTurns({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_scope", before: "2026-08-30T00:00:00.000Z", limit: 1 });
		assert.equal(dryRun.mode, "dry-run");
		assert.equal(dryRun.candidateCount, 1);
		assert.equal(dryRun.repairableCount, 1);
		assert.equal(dryRun.appliedCount, 0);
		assert.equal(dryRun.results[0].inspection.eventId, "turn-old");
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_scope", "turn-old"), []);
		const applied = repairOutputTurns({ store: fixture.store, reliabilityStore: fixture.reliabilityStore, piboSessionId: "ps_scope", before: "2026-08-30T00:00:00.000Z", limit: 1, apply: true });
		assert.equal(applied.appliedCount, 1);
		assert.equal(terminalRows(fixture.dataPath, "ps_scope", "turn-old").length, 1);
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_scope", "turn-new"), []);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("pibo debug repair stays progressive, defaults to dry-run, scopes by time, and leaves dead jobs intact", async () => {
	const fixture = createFixture();
	const env = { ...process.env, PIBO_HOME: fixture.home };
	try {
		const rootHelp = await execFileAsync("node", [cliPath, "debug", "--help"], { env });
		assert.match(rootHelp.stdout, /repair\s+Dry-run or apply explicit persisted-output repairs/);
		assert.doesNotMatch(rootHelp.stdout, /persisted provider failure/);
		const repairHelp = await execFileAsync("node", [cliPath, "debug", "repair", "output", "--help"], { env });
		assert.match(repairHelp.stdout, /Dry-run is the default/);
		assert.match(repairHelp.stdout, /Reliability payloads, Pibo Product History, and exact adapter-history/);
		assert.match(repairHelp.stdout, /pibo\.output\.repair_applied audit event/);
		assert.match(repairHelp.stdout, /--since/);
		assert.match(repairHelp.stdout, /does not delete or replay/);

		const dryRun = await execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_success", "turn-success", "--json"], { env });
		const dryRunResult = JSON.parse(dryRun.stdout);
		assert.equal(dryRunResult.mode, "dry-run");
		assert.equal(dryRunResult.applied, false);
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_success", "turn-success"), []);

		const scoped = await execFileAsync("node", [cliPath, "debug", "repair", "output", "--session", "ps_scope", "--before", "2026-08-30T00:00:00.000Z", "--limit", "1", "--json"], { env });
		const scopedResult = JSON.parse(scoped.stdout);
		assert.equal(scopedResult.resultType, "debug.repair.output.scope");
		assert.equal(scopedResult.candidateCount, 1);
		assert.equal(scopedResult.appliedCount, 0);

		const applied = await execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_success", "turn-success", "--apply", "--json"], { env });
		const appliedResult = JSON.parse(applied.stdout);
		assert.equal(appliedResult.mode, "apply");
		assert.equal(appliedResult.applied, true);
		assert.equal(appliedResult.persisted.type, "message_finished");
		assert.equal(typeof appliedResult.persisted.auditStreamId, "number");
		const reliability = new PiboReliabilityStore(fixture.reliabilityPath);
		try {
			assert.equal(reliability.listDead({ queue: "output-persistence" }).length, 3);
		} finally {
			reliability.close();
		}

		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_missing_evidence", "turn-missing-evidence", "--dry-run", "--apply"], { env }),
			/Choose either --dry-run or --apply/,
		);
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "repair", "output", "--session", "ps_scope", "--since", "2026-09-01T00:00:00Z", "--before", "2026-08-31T00:00:00Z"], { env }),
			/--since must be earlier than --before/,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
