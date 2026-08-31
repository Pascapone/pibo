import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { repairOutputTurn } from "../dist/debug/output-repair.js";
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

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-output-repair-"));
	const home = join(root, ".pibo");
	mkdirSync(home, { recursive: true });
	const dataPath = join(home, "pibo.sqlite");
	const reliabilityPath = join(home, "pibo-events.sqlite");
	const data = new PiboDataStore(dataPath);
	try {
		const sessions = new PiboDataSessionStore(data);
		for (const id of ["ps_success", "ps_error", "ps_complete", "ps_duplicate"]) {
			sessions.create({ id, channel: "test", kind: "chat", profile: "base" });
		}
		append(data, { sessionId: "ps_success", sequence: 1, type: "message_started", eventId: "turn-success", attributes: { source: "user", inlineText: "repair" } });
		append(data, { sessionId: "ps_success", sequence: 2, type: "thinking_started", eventId: "turn-success", attributes: { thinkingIndex: 0 } });
		append(data, { sessionId: "ps_success", sequence: 3, type: "tool_call", eventId: "turn-success", toolCallId: "tool-success", attributes: { toolInvocationOrdinal: 0 } });
		append(data, { sessionId: "ps_success", sequence: 4, type: "tool_execution_started", eventId: "turn-success", toolCallId: "tool-success", attributes: { toolInvocationOrdinal: 0 } });
		append(data, { sessionId: "ps_success", sequence: 5, type: "assistant_message", eventId: "turn-success", attributes: { inlinePayload: { inlineText: "persisted answer" } } });

		append(data, { sessionId: "ps_error", sequence: 1, type: "message_started", eventId: "turn-error", attributes: { source: "actor", inlineText: "repair" } });

		append(data, { sessionId: "ps_complete", sequence: 1, type: "message_started", eventId: "turn-complete" });
		append(data, { sessionId: "ps_complete", sequence: 2, type: "assistant_message", eventId: "turn-complete" });
		append(data, { sessionId: "ps_complete", sequence: 3, type: "message_finished", eventId: "turn-complete" });

		append(data, { sessionId: "ps_duplicate", sequence: 1, type: "message_started", eventId: "turn-duplicate" });
		append(data, { sessionId: "ps_duplicate", sequence: 2, type: "message_started", eventId: "turn-duplicate" });
	} finally {
		data.close();
	}
	const reliability = new PiboReliabilityStore(reliabilityPath);
	try {
		const dead = reliability.enqueue({
			jobId: "job_repair_dead",
			queue: "output-persistence",
			payload: { version: 1, piboSessionId: "ps_success", eventId: "turn-success", state: { version: 1, piboSessionId: "ps_success", deliveries: [] } },
			maxAttempts: 1,
		});
		const claimed = reliability.claimJob(dead.jobId, "worker");
		assert.ok(claimed);
		reliability.fail(dead.jobId, "worker", "fixture dead output", claimed.claimToken);
	} finally {
		reliability.close();
	}
	return {
		root,
		home,
		dataPath,
		reliabilityPath,
		store: { name: "pibo-data", description: "test", defaultPath: "pibo.sqlite", path: dataPath, exists: true },
	};
}

function terminalRows(dataPath, sessionId, eventId) {
	const data = new PiboDataStore(dataPath);
	try {
		return data.db.prepare(`
			SELECT type, actor_id AS actorId, attributes_json AS attributesJson, created_at AS createdAt
			FROM event_log
			WHERE session_id = ? AND event_id = ? AND type IN ('message_finished', 'session_error')
			ORDER BY stream_id
		`).all(sessionId, eventId);
	} finally {
		data.close();
	}
}

test("output repair dry-runs and idempotently closes a turn with persisted assistant output", () => {
	const fixture = createFixture();
	try {
		const dryRun = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_success", eventId: "turn-success" });
		assert.equal(dryRun.mode, "dry-run");
		assert.equal(dryRun.applied, false);
		assert.equal(dryRun.inspection.repairable, true);
		assert.deepEqual(dryRun.inspection.plannedEvent, { type: "message_finished", source: "user" });
		assert.equal(dryRun.inspection.observed.openThinkingParts, 1);
		assert.equal(dryRun.inspection.observed.openToolInvocations, 1);
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_success", "turn-success"), []);

		const applied = repairOutputTurn({
			store: fixture.store,
			piboSessionId: "ps_success",
			eventId: "turn-success",
			apply: true,
			now: () => "2026-08-31T20:00:00.000Z",
		});
		assert.equal(applied.applied, true);
		assert.deepEqual(applied.persisted, { type: "message_finished", streamId: applied.persisted.streamId, duplicate: false });
		const terminals = terminalRows(fixture.dataPath, "ps_success", "turn-success");
		assert.equal(terminals.length, 1);
		assert.equal(terminals[0].type, "message_finished");
		assert.equal(terminals[0].actorId, "pibo-debug-repair");
		assert.equal(terminals[0].createdAt, "2026-08-31T20:00:00.000Z");
		assert.equal(JSON.parse(terminals[0].attributesJson).source, "user");

		const repeated = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_success", eventId: "turn-success", apply: true });
		assert.equal(repeated.applied, false);
		assert.equal(repeated.inspection.reason, "already_terminal");
		assert.equal(terminalRows(fixture.dataPath, "ps_success", "turn-success").length, 1);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output repair closes a turn without assistant output as a session error", () => {
	const fixture = createFixture();
	try {
		const dryRun = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_error", eventId: "turn-error" });
		assert.deepEqual(dryRun.inspection.plannedEvent, {
			type: "session_error",
			error: "Output persistence repair closed an incomplete persisted turn.",
		});
		const applied = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_error", eventId: "turn-error", apply: true });
		assert.equal(applied.applied, true);
		assert.equal(applied.persisted.type, "session_error");
		const terminals = terminalRows(fixture.dataPath, "ps_error", "turn-error");
		assert.equal(terminals.length, 1);
		const attributes = JSON.parse(terminals[0].attributesJson);
		assert.equal(attributes.error, "Output persistence repair closed an incomplete persisted turn.");
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("output repair refuses complete, duplicated-start, and missing targets", () => {
	const fixture = createFixture();
	try {
		const complete = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_complete", eventId: "turn-complete", apply: true });
		assert.equal(complete.applied, false);
		assert.equal(complete.inspection.reason, "already_terminal");
		const duplicated = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_duplicate", eventId: "turn-duplicate", apply: true });
		assert.equal(duplicated.applied, false);
		assert.equal(duplicated.inspection.reason, "message_start_duplicated");
		const missingStart = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_success", eventId: "turn-missing", apply: true });
		assert.equal(missingStart.applied, false);
		assert.equal(missingStart.inspection.reason, "message_start_missing");
		const missingSession = repairOutputTurn({ store: fixture.store, piboSessionId: "ps_missing", eventId: "turn-missing", apply: true });
		assert.equal(missingSession.applied, false);
		assert.equal(missingSession.inspection.reason, "session_not_found");
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("pibo debug repair stays progressive, defaults to dry-run, and leaves dead jobs intact", async () => {
	const fixture = createFixture();
	const env = { ...process.env, PIBO_HOME: fixture.home };
	try {
		const rootHelp = await execFileAsync("node", [cliPath, "debug", "--help"], { env });
		assert.match(rootHelp.stdout, /repair\s+Dry-run or apply explicit persisted-output repairs/);
		assert.doesNotMatch(rootHelp.stdout, /Output persistence repair closed/);
		const repairHelp = await execFileAsync("node", [cliPath, "debug", "repair", "output", "--help"], { env });
		assert.match(repairHelp.stdout, /Dry-run is the default/);
		assert.match(repairHelp.stdout, /does not delete or replay/);

		const dryRun = await execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_success", "turn-success", "--json"], { env });
		const dryRunResult = JSON.parse(dryRun.stdout);
		assert.equal(dryRunResult.mode, "dry-run");
		assert.equal(dryRunResult.applied, false);
		assert.deepEqual(terminalRows(fixture.dataPath, "ps_success", "turn-success"), []);

		const applied = await execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_success", "turn-success", "--apply", "--json"], { env });
		const appliedResult = JSON.parse(applied.stdout);
		assert.equal(appliedResult.mode, "apply");
		assert.equal(appliedResult.applied, true);
		assert.equal(appliedResult.persisted.type, "message_finished");
		const reliability = new PiboReliabilityStore(fixture.reliabilityPath);
		try {
			assert.equal(reliability.listDead({ queue: "output-persistence" }).length, 1);
		} finally {
			reliability.close();
		}

		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "repair", "output", "ps_error", "turn-error", "--dry-run", "--apply"], { env }),
			/Choose either --dry-run or --apply/,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
