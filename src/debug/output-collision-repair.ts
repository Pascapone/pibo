import { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import { legacyOutputIdempotencyKey, outputPersistenceDeliveryKey } from "../data/ingest-service.js";
import { PiboDataStore } from "../data/pibo-store.js";
import type { ResolvedPiboDebugStore } from "./stores.js";

type ProjectionState = "complete" | "missing" | "inconsistent" | "not_applicable";
type DeadRow = { jobId: string; payloadJson: string; lastError: string | null; deadAt: string };
type ExistingRow = { streamId: number; sessionId: string; eventId: string | null; type: string; attributesJson: string };

export type OutputCollisionRepairResult = {
	resultType: "debug.repair.output-collision";
	mode: "dry-run" | "apply";
	jobId: string;
	collisionKey?: string;
	decision: "keep-existing";
	applied: boolean;
	idempotent: boolean;
	conflict: { existingFingerprint?: string; incomingFingerprint?: string; bodyCompared: false };
	projections: { transcript: ProjectionState; trace: ProjectionState; navigation: ProjectionState; command: ProjectionState };
	auditStreamId?: number;
	warnings: string[];
};

export function repairOutputCollision(input: {
	dataStore: ResolvedPiboDebugStore;
	reliabilityStore: ResolvedPiboDebugStore;
	jobId: string;
	apply?: boolean;
	keepExisting?: boolean;
	now?: () => string;
}): OutputCollisionRepairResult {
	if (!input.dataStore.exists) throw new Error(`Debug store "pibo-data" not found at ${input.dataStore.path}`);
	if (!input.reliabilityStore.exists) throw new Error(`Debug store "reliability" not found at ${input.reliabilityStore.path}`);
	if (input.apply && !input.keepExisting) throw new Error("Collision apply requires --keep-existing; conflicting bodies are never selected automatically");
	const reliability = new DatabaseSync(input.reliabilityStore.path, { readOnly: true });
	let dead: DeadRow | undefined;
	try {
		dead = reliability.prepare("SELECT job_id AS jobId, payload_json AS payloadJson, last_error AS lastError, dead_at AS deadAt FROM pibo_dead_jobs WHERE job_id = ? AND queue IN ('output-persistence', 'output-persistence-cli')").get(input.jobId) as DeadRow | undefined;
	} finally { reliability.close(); }
	if (!dead) throw new Error(`Output-persistence dead letter "${input.jobId}" was not found`);
	const collision = findCollisionEvent(dead.payloadJson, dead.lastError);
	if (!collision) throw new Error(`Dead letter "${input.jobId}" does not contain a bounded, valid collision delivery`);
	const { event: incoming, key } = collision;
	const data = new PiboDataStore(input.dataStore.path, { readOnly: !input.apply });
	try {
		const existing = data.db.prepare("SELECT stream_id AS streamId, session_id AS sessionId, event_id AS eventId, type, attributes_json AS attributesJson FROM event_log WHERE idempotency_key = ?").get(key) as ExistingRow | undefined;
		if (!existing) throw new Error(`Canonical output for collision key "${key}" was not found`);
		const attrs = parseObject(existing.attributesJson);
		const projections = inspectProjections(data.db, existing, incoming);
		let auditStreamId: number | undefined;
		let idempotent = false;
		if (input.apply) {
			const auditKey = `pibo.output.collision.reconcile:${input.jobId}:keep-existing`;
			const prior = data.eventLog.findByIdempotencyKey(auditKey);
			if (prior) { auditStreamId = prior.streamId; idempotent = true; }
			else {
				const at = input.now?.() ?? new Date().toISOString();
				const sequence = Number((data.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS value FROM event_log WHERE session_id = ?").get(existing.sessionId) as { value: number }).value);
				auditStreamId = data.eventLog.appendEvent({
					sessionId: existing.sessionId, sessionSequence: sequence, topic: "pibo.audit", type: "pibo.output.collision_reconciled",
					source: "pibo-debug-repair", actorType: "system", actorId: "pibo-debug-repair", eventId: existing.eventId ?? undefined,
					idempotencyKey: auditKey, retentionClass: "audit_event", previewText: "Output collision reconciled by keeping existing canonical output",
					attributes: { repairVersion: 1, deadJobId: input.jobId, outputIdempotencyKey: key, decision: "keep-existing", projections, sideEffectsReplayed: false } as PiboJsonObject,
					createdAt: at, indexedAt: at,
				}).streamId;
			}
		}
		return {
			resultType: "debug.repair.output-collision", mode: input.apply ? "apply" : "dry-run", jobId: input.jobId,
			collisionKey: key, decision: "keep-existing", applied: Boolean(input.apply), idempotent,
			conflict: {
				...(typeof attrs.identityFingerprint === "string" ? { existingFingerprint: attrs.identityFingerprint } : {}),
				...(collisionFingerprint(data.db, existing.sessionId, key) ? { incomingFingerprint: collisionFingerprint(data.db, existing.sessionId, key)! } : {}),
				bodyCompared: false,
			},
			projections, ...(auditStreamId !== undefined ? { auditStreamId } : {}),
			warnings: [
				"The incoming body is never compared, copied, or replayed by this repair.",
				"Apply records an idempotent keep-existing decision and does not delete the dead letter or replay side effects.",
			],
		};
	} finally { data.close(); }
}

function inspectProjections(db: DatabaseSync, existing: ExistingRow, incoming: PiboOutputEvent): OutputCollisionRepairResult["projections"] {
	const transcriptCount = incoming.type === "assistant_message" ? projectionCount(db,
		"SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_stream_id = ? AND role = 'assistant'", existing.sessionId, existing.streamId) : 0;
	const traceCount = projectionCount(db, "SELECT COUNT(*) AS count FROM observations WHERE session_id = ? AND event_stream_id = ?", existing.sessionId, existing.streamId);
	const session = db.prepare("SELECT room_id AS roomId FROM sessions WHERE id = ?").get(existing.sessionId) as { roomId: string | null } | undefined;
	const navigationCount = session?.roomId ? projectionCount(db, "SELECT COUNT(*) AS count FROM session_navigation WHERE session_id = ? AND room_id = ?", existing.sessionId, session.roomId) : 0;
	return {
		transcript: incoming.type !== "assistant_message" ? "not_applicable" : projectionState(transcriptCount),
		trace: projectionState(traceCount),
		navigation: !session?.roomId ? "not_applicable" : projectionState(navigationCount),
		command: "not_applicable",
	};
}

function projectionState(count: number): ProjectionState { return count === 1 ? "complete" : count === 0 ? "missing" : "inconsistent"; }

function projectionCount(db: DatabaseSync, sql: string, ...values: Array<string | number>): number {
	try { return Number((db.prepare(sql).get(...values) as { count: number }).count); } catch { return 0; }
}

function collisionFingerprint(db: DatabaseSync, sessionId: string, key: string): string | undefined {
	const row = db.prepare("SELECT json_extract(attributes_json, '$.incomingFingerprint') AS value FROM event_log WHERE session_id = ? AND type = 'pibo.output.identity_collision' AND json_extract(attributes_json, '$.outputIdempotencyKey') = ? ORDER BY stream_id DESC LIMIT 1").get(sessionId, key) as { value: string | null } | undefined;
	return row?.value ?? undefined;
}

function findCollisionEvent(payloadJson: string, lastError: string | null): { event: PiboOutputEvent; key: string } | undefined {
	let value: unknown;
	try { value = JSON.parse(payloadJson); } catch { return undefined; }
	const key = lastError?.match(/Pibo output identity collision for "([^"]+)"/)?.[1];
	const candidates: unknown[] = [];
	const visit = (item: unknown, depth: number): void => {
		if (depth > 6 || candidates.length > 200 || !item || typeof item !== "object") return;
		if (!Array.isArray(item) && "type" in item && "piboSessionId" in item) candidates.push(item);
		if (Array.isArray(item)) for (const child of item.slice(0, 100)) visit(child, depth + 1);
		else for (const field of ["state", "deliveries", "event", "payload"]) visit((item as Record<string, unknown>)[field], depth + 1);
	};
	visit(value, 0);
	if (!key) return undefined;
	const event = candidates.find((item) => {
		try { return outputPersistenceDeliveryKey(item as PiboOutputEvent) === key || legacyOutputIdempotencyKey(item as PiboOutputEvent) === key; } catch { return false; }
	}) as PiboOutputEvent | undefined;
	return event ? { event, key } : undefined;
}

function parseObject(value: string): Record<string, unknown> {
	try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
	catch { return {}; }
}
