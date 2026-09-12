import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import type { PiboOutputEvent, PiboJsonObject } from "../core/events.js";
import { outputPersistenceDeliveryKey } from "../data/ingest-service.js";
import { PayloadStore } from "../data/payload-store.js";
import { PiboEventLogStore } from "../data/event-log.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { boundedInteger } from "./output-dead-letters.js";

type Classification = { classification: string; repairable: boolean; fingerprintVersion: number; bodyCompared: boolean; reason: string };
type Classifier = (input: { incoming: PiboOutputEvent; existing: { event: PiboOutputEvent; identityFingerprint: string; identityFingerprintVersion?: number }; maxBytes?: number }) => Classification;
type Canonical = { streamId: number; sessionId: string; eventId: string | null; type: string; attributesJson: string; attributeBytes: number; payloadRef: string | null };
type DeliveryDecision = Classification & { deliveryId: string; streamId?: number; prior: { persisted: boolean; sideEffectsDelivered: boolean } };
export type CollisionEquivalenceResult = {
	resultType: "debug.repair.output-equivalence";
	mode: "dry-run" | "apply";
	jobId: string;
	evidenceDigest: string;
	repairable: boolean;
	applied: boolean;
	idempotent: boolean;
	deliveries: DeliveryDecision[];
	auditStreamId?: number;
	deadLetterPreserved: true;
	sideEffectsReplayed: false;
	effect: "record-equivalence-decision-only";
	budget: { maxBytes: number; maxDeliveries: 100; timeoutMs: 1000; elapsedMs: number };
};

/** Bounded AP04 adapter for the Storage-owned pure semantic classifier.
 * Neither classification nor an operator keep-existing decision replays delivery.
 * Apply locks both SQLite files, revalidates the dry-run digest, and writes only
 * the product audit. There is no claim of an atomic two-store write transaction.
 */
export async function reconcileOutputCollisionEquivalence(input: {
	dataStore: ResolvedPiboDebugStore;
	reliabilityStore: ResolvedPiboDebugStore;
	jobId: string;
	apply?: boolean;
	expectedDigest?: string;
	maxBytes?: number;
}): Promise<CollisionEquivalenceResult> {
	const started = performance.now();
	const checkTime = () => { if (performance.now() - started > 1000) throw new Error("Classification time budget exceeded; no repair applied"); };
	const maxBytes = boundedInteger(input.maxBytes, 262144, 1048576, "max-bytes");
	if (!input.dataStore.exists || !input.reliabilityStore.exists) throw new Error("Both existing stores are required; repair never creates or migrates stores");
	if (input.apply && !/^[a-f0-9]{64}$/.test(input.expectedDigest ?? "")) throw new Error("Safe apply requires --expected-digest from the dry-run");
	// Additive cross-package contract. Fail closed until the Storage package is installed.
	const classifierPath = "../core/output-collision-classification.js";
	const { classifyOutputCollision } = await import(classifierPath) as { classifyOutputCollision: Classifier };
	const db = new DatabaseSync(input.dataStore.path, { readOnly: !input.apply });
	let reliability: DatabaseSync | undefined;
	try {
		db.exec("PRAGMA busy_timeout=50");
		if (input.apply) {
			db.prepare("ATTACH DATABASE ? AS repair_reliability").run(input.reliabilityStore.path);
			db.exec("BEGIN IMMEDIATE");
		} else {
			reliability = new DatabaseSync(input.reliabilityStore.path, { readOnly: true });
			reliability.exec("BEGIN"); db.exec("BEGIN");
		}
		const dead = (reliability ?? db).prepare(`SELECT substr(payload_json,1,?) AS payloadJson,
			length(CAST(payload_json AS BLOB)) AS bytes FROM ${input.apply ? "repair_reliability." : ""}pibo_dead_jobs
			WHERE job_id=? AND queue IN ('output-persistence','output-persistence-cli')`).get(maxBytes + 1, input.jobId) as { payloadJson: string; bytes: number } | undefined;
		if (!dead) throw new Error("Output dead letter not found");
		if (dead.bytes > maxBytes) throw new Error("Dead-letter payload exceeds max-bytes");
		const envelope = object(JSON.parse(dead.payloadJson));
		const state = object(envelope?.state ?? envelope);
		const deliveries = state?.deliveries;
		if (!Array.isArray(deliveries) || !deliveries.length || deliveries.length > 100) throw new Error("Expected 1..100 explicit persisted deliveries; refusing ambiguous envelope");
		const decisions: DeliveryDecision[] = [];
		const evidence: unknown[] = [input.dataStore.path, input.reliabilityStore.path, input.jobId, hash(dead.payloadJson)];
		const payloads = new PayloadStore(db, join(dirname(input.dataStore.path), "payloads"), true);
		let remaining = maxBytes - dead.bytes;
		let sessionId: string | undefined;
		for (let index = 0; index < deliveries.length; index++) {
			checkTime();
			const delivery = object(deliveries[index]);
			const event = object(delivery?.event) as PiboOutputEvent | undefined;
			const prior = { persisted: Boolean(object(delivery?.v2)?.streamId), sideEffectsDelivered: delivery?.sideEffectsDelivered === true };
			const deliveryId = typeof delivery?.deliveryId === "string" ? delivery.deliveryId : `delivery-${index}`;
			const incomplete = (reason: string): DeliveryDecision => ({ deliveryId, prior, classification: "insufficient-evidence", repairable: false, fingerprintVersion: 2, bodyCompared: false, reason });
			if (!event || typeof event.type !== "string" || typeof event.piboSessionId !== "string") { decisions.push(incomplete("Invalid failed delivery")); continue; }
			if (sessionId && event.piboSessionId !== sessionId) { decisions.push(incomplete("Mixed-session job")); continue; }
			sessionId = event.piboSessionId;
			const key = outputPersistenceDeliveryKey(event);
			const row = db.prepare(`SELECT stream_id AS streamId,session_id AS sessionId,event_id AS eventId,type,
				length(CAST(attributes_json AS BLOB)) AS attributeBytes,substr(attributes_json,1,?) AS attributesJson,payload_ref AS payloadRef
				FROM event_log WHERE idempotency_key=?`).get(Math.max(1, remaining + 1), key) as Canonical | undefined;
			if (!row || row.attributeBytes > remaining) { decisions.push(incomplete(row ? "Canonical metadata exceeds remaining byte budget" : "Canonical committed delivery missing")); continue; }
			remaining -= row.attributeBytes;
			evidence.push([key, row.streamId, hash(row.attributesJson), row.payloadRef]);
			const attrs = object(JSON.parse(row.attributesJson));
			if (!attrs || typeof attrs.identityFingerprint !== "string") { decisions.push(incomplete("Stored fingerprint missing")); continue; }
			if (row.sessionId !== event.piboSessionId || row.type !== event.type || row.eventId !== ("eventId" in event ? event.eventId : null)) { decisions.push(incomplete("Canonical identity columns disagree")); continue; }
			if (prior.persisted && object(delivery?.v2)?.streamId !== row.streamId) { decisions.push(incomplete("Persisted delivery points at a different stream")); continue; }
			const canonical: Record<string, unknown> = { type: row.type, piboSessionId: row.sessionId, ...(row.eventId ? { eventId: row.eventId } : {}) };
			// Explicit reconstruction only. Storage validates the exact persisted hash;
			// missing producer/provenance fields cannot be guessed from incoming text.
			if (row.type === "assistant_message") {
				let text: unknown = attrs.inlinePayload;
				if (row.payloadRef) {
					try { if (remaining < 1) throw new Error("byte budget exhausted"); const bytes = payloads.readPayloadBytesBounded(row.payloadRef, remaining); remaining -= bytes.byteLength; text = Buffer.from(bytes).toString("utf8"); evidence.push(hash(Buffer.from(bytes))); }
					catch { decisions.push(incomplete("Canonical full payload unavailable, oversized, or corrupt")); continue; }
				}
				if (typeof text !== "string") { decisions.push(incomplete("Canonical full text is unavailable; preview is not evidence")); continue; }
				Object.assign(canonical, { text, assistantIndex: attrs.assistantIndex, contentIndex: attrs.contentIndex });
			} else if (row.type === "message_finished") canonical.source = attrs.source;
			else { decisions.push(incomplete("Delivery type lacks a lossless canonical reconstruction")); continue; }
			if (attrs.provenance !== undefined) canonical.provenance = attrs.provenance;
			const decision = classifyOutputCollision({ incoming: event, existing: { event: canonical as PiboOutputEvent, identityFingerprint: attrs.identityFingerprint, identityFingerprintVersion: typeof attrs.identityFingerprintVersion === "number" ? attrs.identityFingerprintVersion : undefined }, maxBytes });
			decisions.push({ ...decision, deliveryId, streamId: row.streamId, prior });
		}
		const evidenceDigest = hash(JSON.stringify(evidence));
		const repairable = decisions.length === deliveries.length && decisions.every(item => item.repairable && item.bodyCompared && item.fingerprintVersion === 2 && ["equivalent-v2", "equivalent-legacy"].includes(item.classification));
		const result: CollisionEquivalenceResult = { resultType: "debug.repair.output-equivalence", mode: input.apply ? "apply" : "dry-run", jobId: input.jobId, evidenceDigest, repairable, applied: false, idempotent: false, deliveries: decisions, deadLetterPreserved: true, sideEffectsReplayed: false, effect: "record-equivalence-decision-only", budget: { maxBytes, maxDeliveries: 100, timeoutMs: 1000, elapsedMs: performance.now() - started } };
		checkTime();
		if (input.apply) {
			if (input.expectedDigest !== evidenceDigest) throw new Error("Repair evidence changed since dry-run; run classification again");
			if (!repairable || !sessionId) throw new Error("Equivalence is not proven for every delivery; preserve the conflict and inspect the dry-run");
			const events = new PiboEventLogStore(db);
			const auditKey = `pibo.output.equivalence:${input.jobId}:${evidenceDigest}`;
			const prior = events.findByIdempotencyKey(auditKey);
			if (prior) { result.idempotent = true; result.auditStreamId = prior.streamId; }
			else {
				const sequence = Number((db.prepare("SELECT COALESCE(MAX(session_sequence),0)+1 AS n FROM event_log WHERE session_id=?").get(sessionId) as { n: number }).n);
				result.auditStreamId = events.appendEvent({ sessionId, sessionSequence: sequence, topic: "pibo.audit", type: "pibo.output.equivalence_reconciled", source: "pibo-debug-repair", actorType: "system", actorId: "pibo-debug-repair", idempotencyKey: auditKey, retentionClass: "audit_event", attributes: { repairVersion: 1, deadJobId: input.jobId, evidenceDigest, deliveries: decisions, sideEffectsReplayed: false, deadLetterPreserved: true } as unknown as PiboJsonObject }).streamId;
			}
			result.applied = true;
		}
		db.exec("COMMIT");
		return result;
	} finally {
		if (db.isTransaction) db.exec("ROLLBACK");
		if (reliability?.isTransaction) reliability.exec("ROLLBACK");
		reliability?.close(); db.close();
	}
}
function object(value: unknown): Record<string, any> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined; }
function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
