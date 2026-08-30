import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { OutputRenderSequencer } from "../dist/core/output-render-sequence.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import {
	applyPiboDataSchema,
	PIBO_DATA_SCHEMA_MIGRATION_STEPS,
} from "../dist/data/schema.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { OutputPersistenceRetryQueue } from "../dist/core/output-persistence-retry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { LocalCliSessionSource } from "../dist/cli-session/localSessionSource.js";

function temporaryDatabase(prefix) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return { directory, databasePath: path.join(directory, "pibo.sqlite") };
}

function databaseSnapshot(db) {
	return {
		version: Number(db.prepare("PRAGMA user_version").get().user_version),
		schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all(),
		temporarySchema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_temp_schema ORDER BY type, name").all(),
		events: db.prepare("SELECT stream_id, session_id, session_sequence FROM event_log ORDER BY stream_id").all(),
	};
}

function prepareLegacyV6Database(databasePath) {
	const store = new PiboDataStore(databasePath);
	const sessions = new PiboDataSessionStore(store);
	sessions.create({ id: "ps-migration-atomic", channel: "test", kind: "chat", profile: "base" });
	for (const [index, sequence] of [null, 8, null, 10].entries()) {
		store.db.prepare(`
			INSERT INTO event_log (
				stream_id, session_id, session_sequence, topic, type, source,
				retention_class, attributes_json, created_at
			) VALUES (?, ?, ?, 'pibo.output', 'assistant_message', 'test', 'chat_message', '{}', ?)
		`).run(index + 1, "ps-migration-atomic", sequence, `2026-08-30T02:00:0${index}.000Z`);
	}
	store.db.exec(`
		DROP TABLE session_tool_invocations;
		DROP TABLE session_tool_invocation_counters;
		DROP TABLE session_output_render_high_water;
		PRAGMA user_version = 6;
	`);
	store.close();
}

test("schema v7 migration rolls every injected phase back and retries completely", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-schema-v7-atomic-");
	try {
		prepareLegacyV6Database(databasePath);
		const db = new DatabaseSync(databasePath);
		try {
			const before = databaseSnapshot(db);
			for (const faultStep of PIBO_DATA_SCHEMA_MIGRATION_STEPS) {
				assert.throws(() => applyPiboDataSchema(db, {
					afterStep(step) {
						if (step === faultStep) throw new Error(`fault:${step}`);
					},
				}), new RegExp(`fault:${faultStep}`));
				assert.deepEqual(databaseSnapshot(db), before, `migration leaked state after ${faultStep}`);
				assert.equal(db.isTransaction, false);
			}
			applyPiboDataSchema(db);
			assert.equal(Number(db.prepare("PRAGMA user_version").get().user_version), 7);
			assert.deepEqual(
				db.prepare("SELECT session_sequence FROM event_log ORDER BY stream_id").all().map((row) => row.session_sequence),
				[1, 2, 3, 4],
			);
			assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM session_tool_invocations").get().count), 0);
		} finally {
			db.close();
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("schema v7 resumes an interrupted legacy negative sequence repair", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-schema-v7-resume-");
	try {
		prepareLegacyV6Database(databasePath);
		const broken = new DatabaseSync(databasePath);
		try {
			broken.exec("UPDATE event_log SET session_sequence = -stream_id; PRAGMA user_version = 7;");
		} finally {
			broken.close();
		}
		const reopened = new PiboDataStore(databasePath);
		try {
			assert.deepEqual(
				reopened.db.prepare("SELECT session_sequence FROM event_log ORDER BY stream_id").all().map((row) => row.session_sequence),
				[1, 2, 3, 4],
			);
		} finally {
			reopened.close();
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("tool lifecycle attaches to the durable open invocation across reopen and routers", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-tool-open-restart-");
	const base = { piboSessionId: "ps-tool-open-restart", eventId: "turn-open", toolCallId: "same-tool", toolName: "read" };
	try {
		let firstData = new PiboDataStore(databasePath);
		let firstSessions = new PiboDataSessionStore(firstData);
		firstSessions.create({ id: base.piboSessionId, channel: "test", kind: "chat", profile: "base" });
		let firstRouter = new PiboSessionRouter({ sessionStore: firstSessions, persistSession: false, routedSessionIdleTimeoutMs: false });
		const firstEvents = [];
		firstRouter.subscribe((event) => firstEvents.push(event));
		firstRouter.emitOutput({ ...base, type: "tool_call", args: { path: "README.md" }, argsComplete: true });
		assert.equal(firstEvents.at(-1).toolInvocationOrdinal, 0);
		new ChatDataIngestService(firstData).ingestOutputEvent({ session: firstSessions.get(base.piboSessionId), event: firstEvents.at(-1) });
		await firstRouter.disposeAll();
		firstData.close();

		const secondData = new PiboDataStore(databasePath);
		const thirdData = new PiboDataStore(databasePath);
		try {
			const secondRouter = new PiboSessionRouter({ sessionStore: new PiboDataSessionStore(secondData), persistSession: false, routedSessionIdleTimeoutMs: false });
			const thirdRouter = new PiboSessionRouter({ sessionStore: new PiboDataSessionStore(thirdData), persistSession: false, routedSessionIdleTimeoutMs: false });
			const resumed = [];
			secondRouter.subscribe((event) => resumed.push(event));
			thirdRouter.subscribe((event) => resumed.push(event));
			secondRouter.emitOutput({ ...base, type: "tool_execution_started", args: { path: "README.md" } });
			thirdRouter.emitOutput({ ...base, type: "tool_execution_updated", args: { path: "README.md" }, partialResult: "chunk" });
			secondRouter.emitOutput({ ...base, type: "tool_execution_finished", result: "done", isError: false });
			assert.deepEqual(resumed.map((event) => event.toolInvocationOrdinal), [0, 0, 0]);
			const row = secondData.db.prepare(`
				SELECT invocation_ordinal, status, seen_call, seen_started, seen_updated, seen_finished
				FROM session_tool_invocations
				WHERE pibo_session_id = ? AND event_id = ? AND tool_call_id = ?
			`).get(base.piboSessionId, base.eventId, base.toolCallId);
			assert.deepEqual({ ...row }, {
				invocation_ordinal: 0,
				status: "closed",
				seen_call: 1,
				seen_started: 1,
				seen_updated: 1,
				seen_finished: 1,
			});
			await secondRouter.disposeAll();
			await thirdRouter.disposeAll();
		} finally {
			secondData.close();
			thirdData.close();
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("unscoped session errors close active turns so completed sessions remain bounded", () => {
	let tick = 1;
	const sequencer = new OutputRenderSequencer(() => tick++);
	const first = sequencer.position({ type: "message_started", piboSessionId: "ps-error-0", eventId: "turn-error-0", source: "user" });
	for (let index = 0; index < 1_100; index += 1) {
		const sessionId = `ps-error-${index}`;
		sequencer.position({ type: "message_started", piboSessionId: sessionId, eventId: `turn-error-${index}`, source: "user" });
		sequencer.position({ type: "session_error", piboSessionId: sessionId, error: "failed" });
	}
	const state = sequencer.debugState();
	assert.ok(state.sessionCount <= 1_024, JSON.stringify(state));
	assert.equal(state.completedSessionCount, state.sessionCount);
	const replay = sequencer.position({ type: "message_started", piboSessionId: "ps-error-0", eventId: "turn-error-0", source: "user", renderSequence: first.renderSequence });
	assert.equal(replay.renderSequence, first.renderSequence);
});

test("durable output retry resumes after restart and exhausted work stays observable", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-retry-durable-");
	const queueName = "output-persistence-test";
	try {
		let store = new PiboReliabilityStore(databasePath);
		let firstAttempt = 0;
		const first = new OutputPersistenceRetryQueue({
			durableStore: store,
			queueName,
			maxAttempts: 3,
			baseDelayMs: 60_000,
			maxDelayMs: 60_000,
		});
		first.enqueue({
			key: "delivery:resume",
			piboSessionId: "ps-retry-resume",
			eventId: "turn-retry-resume",
			payload: { phase: "v2", eventType: "assistant_message" },
			run(context) {
				firstAttempt += 1;
				context.updatePayload({ phase: "reliability", eventType: "assistant_message" });
				throw new Error("process stopped before retry");
			},
		});
		assert.equal(firstAttempt, 1);
		first.dispose();
		assert.equal(store.listJobs({ queue: queueName }).length, 1);
		store.close();

		store = new PiboReliabilityStore(databasePath);
		let resumed = 0;
		const second = new OutputPersistenceRetryQueue({ durableStore: store, queueName, baseDelayMs: 1, maxDelayMs: 1 });
		second.recover((job) => ({
			...job,
			run(context) {
				resumed += 1;
				assert.equal(context.payload.phase, "reliability");
			},
		}));
		await second.drain();
		assert.equal(resumed, 1);
		assert.equal(store.listJobs({ queue: queueName }).length, 0);

		second.enqueue({
			key: "delivery:dead",
			piboSessionId: "ps-retry-dead",
			eventId: "turn-retry-dead",
			payload: { phase: "v2", eventType: "tool_execution_finished" },
			run() { throw new Error("permanent write failure"); },
		});
		await second.drain();
		const dead = store.listDead({ queue: queueName });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].attempts, dead[0].maxAttempts);
		assert.deepEqual(dead[0].payload, {
			version: 1,
			key: "delivery:dead",
			piboSessionId: "ps-retry-dead",
			eventId: "turn-retry-dead",
			state: { phase: "v2", eventType: "tool_execution_finished" },
		});
		second.dispose();
		store.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI resumes a pending durable final after process restart without producer replay", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-retry-restart-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps-cli-retry-restart";
	const event = {
		type: "assistant_message",
		piboSessionId,
		eventId: "turn-cli-retry-restart",
		assistantIndex: 0,
		text: "resumed final",
		renderSequence: 41,
	};
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		const deliveryKey = `pibo.output:${piboSessionId}:assistant_message:${event.eventId}:0`;
		reliability.enqueue({
			queue: "output-persistence-cli",
			idempotencyKey: JSON.stringify([deliveryKey]),
			payload: {
				key: JSON.stringify([deliveryKey]),
				piboSessionId,
				eventId: deliveryKey,
				state: { version: 1, piboSessionId, deliveries: [{ event }] },
			},
		});

		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability });
		await source.close();
		assert.equal(reliability.listJobs({ queue: "output-persistence-cli" }).length, 0);
		const rows = dataStore.db.prepare("SELECT type, preview_text FROM event_log WHERE session_id = ?").all(piboSessionId);
		assert.deepEqual(rows.map((row) => ({ ...row })), [{ type: "assistant_message", preview_text: "resumed final" }]);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
