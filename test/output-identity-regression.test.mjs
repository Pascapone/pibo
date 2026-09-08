import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { OutputRenderSequencer, outputIdentityFingerprint } from "../dist/core/output-render-sequence.js";
import { ChatDataIngestService, legacyOutputIdempotencyKey, outputPersistenceDeliveryKey } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { inspectOutputIntegrity } from "../dist/debug/output-integrity.js";
import { repairOutputCollision } from "../dist/debug/output-collision-repair.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-output-identity-"));
	const dataPath = join(root, "pibo.sqlite"), reliabilityPath = join(root, "pibo-events.sqlite");
	const data = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
	const reliability = new PiboReliabilityStore(reliabilityPath);
	const sessions = new PiboDataSessionStore(data);
	const session = sessions.create({ id: "ps_identity_regression", channel: "test", kind: "chat", profile: "base", metadata: { roomId: "room_test" } });
	return { root, dataPath, reliabilityPath, data, reliability, sessions, session, close() { try { reliability.close(); } catch {} try { data.close(); } catch {} rmSync(root, { recursive: true, force: true }); } };
}

test("different assistant finals in one turn receive distinct durable identities while exact replay reattaches", () => {
	const f = fixture();
	try {
		const sequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: f.sessions });
		const base = { type: "assistant_message", piboSessionId: f.session.id, eventId: "turn", assistantIndex: 0 };
		const first = sequencer.position({ ...base, text: "first" });
		const replay = sequencer.position({ ...base, text: "first" });
		const second = sequencer.position({ ...base, text: "second" });
		assert.equal(first.assistantIndex, 0);
		assert.equal(replay.assistantIndex, 0);
		const withoutHighWater = new OutputRenderSequencer(() => 1);
		withoutHighWater.position({ ...base, type: "assistant_delta", text: "first" });
		const localFinal = withoutHighWater.position({ ...base, text: "first" });
		assert.equal(withoutHighWater.position({ ...base, text: "first" }).assistantIndex, localFinal.assistantIndex);
		assert.equal(second.assistantIndex, 1);
		const ingest = new ChatDataIngestService(f.data);
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: first }).duplicate, false);
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: replay }).duplicate, true);
		const restarted = new OutputRenderSequencer({ now: () => 2, highWaterStore: f.sessions });
		const restartedReplay = restarted.position({ ...base, text: "first" });
		assert.equal(restartedReplay.assistantIndex, 0);
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: restartedReplay }).duplicate, true);
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: second }).duplicate, false);
		assert.equal(f.data.eventLog.listEvents({ sessionId: f.session.id }).filter((row) => row.type === "pibo.output.identity_collision").length, 0);
	} finally { f.close(); }
});

test("equivalent assistant aliases fingerprint identically and compact queued/completed results do not collide", () => {
	const f = fixture();
	try {
		const aliasA = { type: "assistant_message", piboSessionId: f.session.id, eventId: "alias", assistantIndex: 0, text: "same" };
		const aliasB = { type: "assistant_message", piboSessionId: f.session.id, eventId: "alias", contentIndex: 0, text: "same" };
		assert.equal(outputIdentityFingerprint(aliasA), outputIdentityFingerprint(aliasB));
		const queued = { type: "execution_result", piboSessionId: f.session.id, eventId: "compact-action", action: "compact", result: { queued: true, queuedMessages: 1 } };
		const completed = { ...queued, result: { compacted: true } };
		assert.match(outputPersistenceDeliveryKey(queued), /:compact:queued$/);
		assert.match(outputPersistenceDeliveryKey(completed), /:compact:complete$/);
		const ingest = new ChatDataIngestService(f.data);
		ingest.ingestOutputEvent({ session: f.session, event: queued });
		ingest.ingestOutputEvent({ session: f.session, event: completed });
		assert.equal(f.data.eventLog.listEvents({ sessionId: f.session.id }).filter((row) => row.type === "execution_result").length, 2);
		const legacyAssistant = { type: "assistant_message", piboSessionId: f.session.id, eventId: "legacy-turn", assistantIndex: 0, text: "legacy answer" };
		f.data.eventLog.appendEvent({ sessionId: f.session.id, sessionSequence: 3, topic: "pibo.output", type: "assistant_message", source: "actor", eventId: legacyAssistant.eventId, idempotencyKey: outputPersistenceDeliveryKey(legacyAssistant), retentionClass: "chat_message", attributes: { identityFingerprint: "ecc97ef0b52978e49d94a8a43284af4437dd0ca95422da089810227c9b2f204f", inlinePayload: legacyAssistant.text, assistantIndex: 0 }, createdAt: "2026-09-08T00:00:00Z" });
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: legacyAssistant }).duplicate, true);
		const { assistantIndex: _legacyIndex, ...legacyAliasBase } = legacyAssistant;
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: { ...legacyAliasBase, contentIndex: 0, provenance: { producer: "upgraded-replay", projection: "test", phase: "replay" } } }).duplicate, true);
		assert.throws(() => ingest.ingestOutputEvent({ session: f.session, event: { ...legacyAssistant, text: "changed" } }), { code: "pibo_output_identity_collision" });
		const legacyThinking = { type: "thinking_finished", piboSessionId: f.session.id, eventId: "legacy-thinking", thinkingIndex: 0, text: "legacy thought" };
		f.data.eventLog.appendEvent({ sessionId: f.session.id, sessionSequence: 4, topic: "pibo.output", type: "thinking_finished", source: "actor", eventId: legacyThinking.eventId, idempotencyKey: outputPersistenceDeliveryKey(legacyThinking), retentionClass: "trace_event", attributes: { identityFingerprint: "fd464da45df38010f3aeb1accf0f68891327d5d52b48f2ff3f17b4a68602d339", inlinePayload: legacyThinking.text, thinkingIndex: 0 }, createdAt: "2026-09-08T00:00:00Z" });
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: { type: "thinking_finished", piboSessionId: f.session.id, eventId: "legacy-thinking", contentIndex: 0, text: "legacy thought", provenance: { producer: "upgraded-replay", projection: "test", phase: "replay" } } }).duplicate, true);
		assert.throws(() => ingest.ingestOutputEvent({ session: f.session, event: { ...legacyThinking, text: "changed thought" } }), { code: "pibo_output_identity_collision" });
		const legacyEquivalent = { ...completed, eventId: "legacy-compact" };
		f.data.eventLog.appendEvent({ sessionId: f.session.id, sessionSequence: 5, topic: "pibo.output", type: "execution_result", source: "actor", eventId: legacyEquivalent.eventId, idempotencyKey: legacyOutputIdempotencyKey(legacyEquivalent), retentionClass: "trace_event", attributes: { identityFingerprint: "e4c9969cb6a881b186cc55fbc2ddb5ca6ed7a17e172dc64d69dd06ee34c81ec3", inlinePayload: legacyEquivalent.result, action: "compact" }, createdAt: "2026-09-08T00:00:00Z" });
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: legacyEquivalent }).duplicate, true);
		const legacyQueuedPhase = { ...legacyEquivalent, result: { queued: true, queuedMessages: 1 } };
		assert.equal(ingest.ingestOutputEvent({ session: f.session, event: legacyQueuedPhase }).duplicate, false);
		assert.equal(outputPersistenceDeliveryKey(legacyQueuedPhase).endsWith(":compact:queued"), true);
		assert.throws(() => ingest.ingestOutputEvent({ session: f.session, event: { ...legacyEquivalent, result: { compacted: false } } }), { code: "pibo_output_identity_collision" });
	} finally { f.close(); }
});

test("collision diagnostics are redacted and dead-letter reconciliation is explicit, audited, and idempotent", () => {
	const f = fixture();
	try {
		const ingest = new ChatDataIngestService(f.data);
		const first = { type: "assistant_message", piboSessionId: f.session.id, eventId: "collision", assistantIndex: 0, text: "secret first body" };
		const incoming = { ...first, text: "secret incoming body" };
		ingest.ingestOutputEvent({ session: f.session, roomId: "room_test", event: first, persistenceProvenance: { producer: "chat-web", projection: "product-history", phase: "live" } });
		assert.throws(() => ingest.ingestOutputEvent({ session: f.session, roomId: "room_test", event: incoming, persistenceProvenance: { producer: "local-cli", projection: "product-history", phase: "durable-replay" } }), { code: "pibo_output_identity_collision" });
		const collision = f.data.eventLog.listEvents({ sessionId: f.session.id }).find((row) => row.type === "pibo.output.identity_collision");
		assert.deepEqual(collision.attributes.existingProvenance, { producer: "chat-web", projection: "product-history", phase: "live" });
		assert.deepEqual(collision.attributes.incomingProvenance, { producer: "local-cli", projection: "product-history", phase: "durable-replay" });
		assert.deepEqual(collision.attributes.fieldDifferences, [{ field: "text", change: "changed" }]);
		assert.equal(JSON.stringify(collision.attributes).includes("secret"), false);
		const key = outputPersistenceDeliveryKey(incoming);
		f.reliability.db.prepare(`INSERT INTO pibo_dead_jobs (job_id, queue, payload_json, attempts, max_attempts, idempotency_key, created_at, updated_at, last_error, dead_at, dead_reason) VALUES (?, 'output-persistence', ?, 1, 5, ?, ?, ?, ?, ?, 'permanent')`).run(
			"dead_collision", JSON.stringify({ version: 1, state: { version: 1, piboSessionId: f.session.id, deliveries: [{ deliveryId: key, event: incoming }] } }), key,
			"2026-09-08T00:00:00Z", "2026-09-08T00:00:00Z", `Pibo output identity collision for "${key}"`, "2026-09-08T00:00:00Z",
		);
		f.data.close(); f.reliability.close();
		const stores = { dataStore: { path: f.dataPath, exists: true }, reliabilityStore: { path: f.reliabilityPath, exists: true } };
		const cliDryRun = JSON.parse(execFileSync(process.execPath, [resolve("dist/bin/pibo.js"), "debug", "repair", "output-collision", "--job", "dead_collision", "--dry-run", "--json"], { env: { ...process.env, PIBO_HOME: f.root }, encoding: "utf8" }));
		assert.equal(cliDryRun.projections.transcript, "complete");
		const audit = inspectOutputIntegrity({ ...stores, limit: 20 });
		assert.equal(audit.health.status, "degraded");
		const finding = audit.findings.find((item) => item.kind === "identity_collision");
		assert.equal(finding.fieldDifferences[0].field, "text");
		const dry = repairOutputCollision({ ...stores, jobId: "dead_collision" });
		assert.deepEqual(dry.projections, { transcript: "complete", trace: "complete", navigation: "complete", command: "not_applicable" });
		assert.throws(() => repairOutputCollision({ ...stores, jobId: "dead_collision", apply: true }), /--keep-existing/);
		const applied = repairOutputCollision({ ...stores, jobId: "dead_collision", apply: true, keepExisting: true, now: () => "2026-09-08T01:00:00Z" });
		const repeated = repairOutputCollision({ ...stores, jobId: "dead_collision", apply: true, keepExisting: true, now: () => "2026-09-08T02:00:00Z" });
		assert.equal(applied.applied, true); assert.equal(applied.idempotent, false);
		assert.equal(repeated.idempotent, true); assert.equal(repeated.auditStreamId, applied.auditStreamId);
	} finally { f.close(); }
});
