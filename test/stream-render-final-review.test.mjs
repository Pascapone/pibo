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

test("streamed tool call and lifecycle attach to the durable invocation across reopen and routers", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-tool-open-restart-");
	const base = { piboSessionId: "ps-tool-open-restart", eventId: "turn-open", toolCallId: "same-tool", toolName: "read" };
	try {
		let firstData = new PiboDataStore(databasePath);
		let firstSessions = new PiboDataSessionStore(firstData);
		firstSessions.create({ id: base.piboSessionId, channel: "test", kind: "chat", profile: "base" });
		let firstRouter = new PiboSessionRouter({ sessionStore: firstSessions, persistSession: false, routedSessionIdleTimeoutMs: false });
		const firstEvents = [];
		firstRouter.subscribe((event) => firstEvents.push(event));
		firstRouter.emitOutput({ ...base, type: "tool_call", args: { path: "READ" }, argsComplete: false });
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
			secondRouter.emitOutput({ ...base, type: "tool_call", args: { path: "README.md" }, argsComplete: true });
			secondRouter.emitOutput({ ...base, type: "tool_execution_started", args: { path: "README.md" } });
			thirdRouter.emitOutput({ ...base, type: "tool_execution_updated", args: { path: "README.md" }, partialResult: "chunk" });
			secondRouter.emitOutput({ ...base, type: "tool_execution_finished", result: "done", isError: false });
			assert.deepEqual(resumed.map((event) => event.toolInvocationOrdinal), [0, 0, 0, 0]);
			const row = secondData.db.prepare(`
				SELECT invocation_ordinal, call_fingerprint, status, seen_call, seen_started, seen_updated, seen_finished
				FROM session_tool_invocations
				WHERE pibo_session_id = ? AND event_id = ? AND tool_call_id = ?
			`).get(base.piboSessionId, base.eventId, base.toolCallId);
			assert.equal(typeof row.call_fingerprint, "string");
			const { call_fingerprint: _callFingerprint, ...lifecycle } = row;
			assert.deepEqual({ ...lifecycle }, {
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
				version: 1,
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

test("local CLI quarantines a versionless durable envelope without executing its state", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-versionless-envelope-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps_cli_versionless_envelope";
	const secret = "cli-versionless-secret-marker";
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		reliability.enqueue({
			queue: "output-persistence-cli",
			idempotencyKey: "legacy-cli-versionless",
			payload: {
				key: "legacy-cli-versionless",
				state: {
					version: 1,
					piboSessionId,
					deliveries: [{ event: { type: "assistant_message", piboSessionId, eventId: "legacy-cli", text: secret, renderSequence: 1 } }],
				},
			},
		});

		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability });
		await source.close();
		assert.equal(Number(dataStore.db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId).count), 0);
		assert.equal(reliability.listJobs({ queue: "output-persistence-cli" }).length, 0);
		const dead = reliability.listDead({ queue: "output-persistence-cli" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].deadReason, "payload_version_unsupported");
		assert.equal(JSON.stringify(dead).includes(secret), false);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI persists the declared message_steered runtime payload", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-steered-runtime-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps_cli_steered_runtime";
	let listener;
	const router = {
		subscribe(next) { listener = next; return () => { listener = undefined; }; },
	};
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability, router });
		listener({ type: "message_steered", piboSessionId, eventId: "steer-cli-runtime", activeEventId: "active-cli-turn", text: "valid CLI steer", source: "user" });
		await source.close();
		const row = dataStore.db.prepare("SELECT event_id, idempotency_key, preview_text, attributes_json FROM event_log WHERE session_id = ? AND type = 'message_steered'").get(piboSessionId);
		assert.equal(row.event_id, "steer-cli-runtime");
		assert.equal(row.idempotency_key, `pibo.output:${piboSessionId}:message_steered:steer-cli-runtime:main`);
		assert.equal(row.preview_text, "valid CLI steer");
		assert.equal(JSON.parse(row.attributes_json).activeEventId, "active-cli-turn");
		assert.equal(reliability.listJobs({ queue: "output-persistence-cli" }).length, 0);
		assert.equal(reliability.listDead({ queue: "output-persistence-cli" }).length, 0);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI recovers a valid V1 message_steered envelope without quarantine", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-steered-recovery-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps_cli_steered_recovery";
	const eventId = "steer-cli-recovery";
	const deliveryKey = `pibo.output:${piboSessionId}:message_steered:${eventId}:main`;
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		reliability.enqueue({
			queue: "output-persistence-cli",
			idempotencyKey: JSON.stringify([deliveryKey]),
			payload: {
				version: 1,
				key: JSON.stringify([deliveryKey]),
				piboSessionId,
				eventId: deliveryKey,
				state: {
					version: 1,
					piboSessionId,
					deliveries: [{ event: { type: "message_steered", piboSessionId, eventId, activeEventId: "active-cli-turn", text: "recover CLI steer", source: "user", renderSequence: 1 } }],
				},
			},
		});
		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability });
		await source.close();
		const row = dataStore.db.prepare("SELECT event_id, idempotency_key, preview_text FROM event_log WHERE session_id = ? AND type = 'message_steered'").get(piboSessionId);
		assert.deepEqual({ ...row }, { event_id: eventId, idempotency_key: deliveryKey, preview_text: "recover CLI steer" });
		assert.equal(reliability.listJobs({ queue: "output-persistence-cli" }).length, 0);
		assert.equal(reliability.listDead({ queue: "output-persistence-cli" }).length, 0);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI quarantines unknown runtime output before compaction, retry, or V2 write", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-unknown-output-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps_cli_unknown_output";
	const secret = "unknown-cli-secret-marker";
	let listener;
	const router = {
		subscribe(next) { listener = next; return () => { listener = undefined; }; },
	};
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability, router });
		listener({ type: "text_message", piboSessionId, text: "legacy cli output", secret });
		await source.close();
		assert.equal(Number(dataStore.db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId).count), 0);
		assert.equal(reliability.listJobs({ queue: "output-persistence-cli" }).length, 0);
		const dead = reliability.listDead({ queue: "output-persistence-cli" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].deadReason, "runtime_output_event_invalid");
		const serialized = JSON.stringify(dead);
		assert.equal(serialized.includes(secret), false);
		assert.equal(serialized.includes("legacy cli output"), false);
		assert.equal(serialized.includes("text_message"), false);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI recovery quarantines an unknown output variant with sanitized metadata", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-unknown-recovery-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	const piboSessionId = "ps_cli_unknown_recovery";
	const secret = "unknown-cli-recovery-secret-marker";
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		reliability.enqueue({
			queue: "output-persistence-cli",
			idempotencyKey: "unknown-cli-recovery",
			payload: {
				version: 1,
				key: `unknown-cli-recovery-${secret}`,
				state: { version: 1, piboSessionId, deliveries: [{ event: { type: "text_message", piboSessionId, text: secret } }] },
			},
		});
		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability });
		await source.close();
		assert.equal(Number(dataStore.db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId).count), 0);
		const dead = reliability.listDead({ queue: "output-persistence-cli" });
		assert.equal(dead.length, 1);
		assert.equal(dead[0].deadReason, "payload_invalid");
		assert.equal(JSON.stringify(dead).includes(secret), false);
		reliability.close();
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI close is bounded by local work while a foreign claim stays live", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-cli-foreign-close-");
	const reliabilityPath = path.join(directory, "reliability.sqlite");
	let heartbeat;
	try {
		const dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		const piboSessionId = "ps_cli_foreign_close";
		sessionStore.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
		const reliability = new PiboReliabilityStore(reliabilityPath);
		reliability.enqueue({
			jobId: "job_cli_foreign_close",
			queue: "output-persistence-cli",
			payload: { version: 1, key: "cli-foreign-close", state: { version: 1, piboSessionId, deliveries: [] } },
		});
		const claimed = reliability.claimRecoverableJob("job_cli_foreign_close", "foreign-cli-worker", 1_000);
		assert.ok(claimed);
		heartbeat = setInterval(() => reliability.heartbeat(claimed.jobId, claimed.workerId, 1_000, claimed.claimToken), 100);
		const source = new LocalCliSessionSource({ dataStore, sessionStore, reliabilityStore: reliability });
		await Promise.race([
			source.close(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("CLI close waited for foreign live claim")), 250)),
		]);
		const live = reliability.listJobs({ queue: "output-persistence-cli" });
		assert.equal(live.length, 1);
		assert.equal(live[0].workerId, "foreign-cli-worker");
		assert.equal(live[0].claimToken, claimed.claimToken);
		clearInterval(heartbeat);
		heartbeat = undefined;
		reliability.close();
		dataStore.close();
	} finally {
		if (heartbeat) clearInterval(heartbeat);
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
