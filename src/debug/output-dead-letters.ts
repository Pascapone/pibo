import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import type { OutputIntegrityFinding, OutputPersistenceDeadLetters } from "./output-integrity.js";
import type { ResolvedPiboDebugStore } from "./stores.js";

export type InspectionBudget = {
	runId?: string;
	workerPid?: number;
	complete: boolean;
	reason?: "result_limit" | "scan_limit" | "time_limit" | "byte_limit" | "cancelled";
	elapsedMs: number;
	scannedRows: number;
	maxScan: number;
	timeoutMs: number;
	nextCursor?: string;
	maxResultBytes?: number;
	returnedBytes?: number;
};
export type DeadLetterInput = {
	dataStore: ResolvedPiboDebugStore;
	reliabilityStore: ResolvedPiboDebugStore;
	piboSessionId?: string;
	since?: string;
	before?: string;
	limit?: string | number;
	maxScan?: number;
	timeoutMs?: number;
	cursor?: string;
	/** Collision relationship stream boundaries, not a lifecycle time filter. */
	afterStream?: number;
	beforeStream?: number;
};
export type BoundedDeadLetters = Omit<OutputPersistenceDeadLetters, "summary"> & {
	formatVersion: 2;
	budget: InspectionBudget;
	summary: Omit<OutputPersistenceDeadLetters["summary"], "deadOutputJobs"> & { deadOutputJobs: number | null; countsScope: "page" };
};

export function boundedInteger(value: string | number | undefined, fallback: number, maximum: number, name: string): number {
	const number = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${name} must be between 1 and ${maximum}`);
	return number;
}

// Use the stable TEXT primary key, not implicit rowid (which VACUUM can change).
// Scope filtering is deliberately AFTER this bounded indexed candidate query.
// A sparse scope therefore consumes work and returns partial, never a hidden JSON scan.
export const DEAD_LETTER_PAGE_SQL = `SELECT job_id AS jobId, queue, attempts, max_attempts AS maxAttempts,
	dead_at AS deadAt, substr(dead_reason, 1, 100) AS deadReason,
	last_error LIKE 'Pibo output identity collision for %' AS collision,
	length(CAST(payload_json AS BLOB)) AS payloadBytes, substr(payload_json, 1, 65537) AS payloadJson
	FROM pibo_dead_jobs WHERE job_id > ? ORDER BY job_id LIMIT ?`;

type Row = { jobId: string; queue: string; attempts: number; maxAttempts: number; deadAt: string; deadReason: string | null; collision: number; payloadBytes: number; payloadJson: string };

export function inspectOutputDeadLetters(input: DeadLetterInput, onProgress?: (result: BoundedDeadLetters) => void): BoundedDeadLetters {
	if (input.piboSessionId && Buffer.byteLength(input.piboSessionId) > 1024) throw new Error("Session scope exceeds 1024 bytes");
	const limit = boundedInteger(input.limit, 50, 1000, "limit");
	const maxScan = boundedInteger(input.maxScan, 1000, 1_000_000, "max-scan");
	const timeoutMs = boundedInteger(input.timeoutMs, 1000, 3_600_000, "timeout-ms");
	const started = performance.now();
	const scopeHash = createHash("sha256").update(JSON.stringify([input.reliabilityStore.path, input.dataStore.path, input.piboSessionId, input.since, input.before, input.afterStream, input.beforeStream])).digest("hex");
	let after = "";
	if (input.cursor) {
		try {
			if (input.cursor.length > 16384) throw new Error();
			const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
			if (cursor.v !== 1 || cursor.scope !== scopeHash || typeof cursor.after !== "string") throw new Error();
			after = cursor.after;
		} catch { throw new Error("Invalid cursor or changed inspection scope"); }
	}
	const result: BoundedDeadLetters = {
		resultType: "debug.persistence.dead-letters", formatVersion: 2, readOnly: true,
		scope: { piboSessionId: input.piboSessionId, since: input.since, before: input.before, limit },
		budget: { complete: false, elapsedMs: 0, scannedRows: 0, maxScan, timeoutMs, maxResultBytes: 1048576, returnedBytes: 0 },
		summary: { deadOutputJobs: null, returnedDeadLetters: 0, identityCollisions: 0, relatedIdentityCollisions: 0, countsScope: "page" },
		deadLetters: [], nextCommands: ["pibo debug persistence audit --help"],
	};
	let lastProgress = -Infinity;
	const checkpoint = (force = false) => {
		result.budget.elapsedMs = performance.now() - started;
		result.budget.nextCursor = result.budget.complete ? undefined : Buffer.from(JSON.stringify({ v: 1, scope: scopeHash, after })).toString("base64url");
		result.summary.returnedDeadLetters = result.deadLetters.length;
		if (force || result.budget.elapsedMs - lastProgress >= 50) { lastProgress = result.budget.elapsedMs; onProgress?.(result); }
	};
	if (!input.reliabilityStore.exists) { result.budget.complete = true; checkpoint(); return result; }
	const db = new DatabaseSync(input.reliabilityStore.path, { readOnly: true });
	let data: DatabaseSync | undefined;
	try {
		if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pibo_dead_jobs'").get()) { result.budget.complete = true; return result; }
		if (input.dataStore.exists) data = new DatabaseSync(input.dataStore.path, { readOnly: true });
		const hasEvents = data?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_log'").get();
		const page = db.prepare(DEAD_LETTER_PAGE_SQL);
		checkpoint();
		while (result.budget.scannedRows < maxScan && result.deadLetters.length < limit) {
			if (performance.now() - started >= timeoutMs) { result.budget.reason = "time_limit"; break; }
			// One candidate avoids advancing past unreturned findings; each statement releases its snapshot.
			const row = page.get(after, 1) as Row | undefined;
			if (!row) { result.budget.complete = true; break; }
			if (Buffer.byteLength(row.jobId) > 1024) throw new Error("Dead-letter key exceeds the bounded cursor format");
			result.budget.scannedRows++;
			const previousCursor = after;
			after = row.jobId;
			if (!["output-persistence", "output-persistence-cli"].includes(row.queue)) { checkpoint(); continue; }
			if (input.since && row.deadAt < input.since || input.before && row.deadAt >= input.before) { checkpoint(); continue; }
			let payload: Record<string, any> | undefined;
			try { if (row.payloadBytes <= 65536) { const parsed = JSON.parse(row.payloadJson); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed; } } catch { /* malformed payload is itself inspectable */ }
			const sessionId = payload?.piboSessionId ?? payload?.state?.piboSessionId;
			const eventId = payload?.eventId ?? payload?.state?.eventId;
			if (input.piboSessionId && sessionId !== input.piboSessionId) { checkpoint(); continue; }
			const finding: OutputIntegrityFinding = {
				kind: "dead_output_job", jobId: row.jobId, queue: row.queue, attempts: row.attempts, maxAttempts: row.maxAttempts,
				...(typeof sessionId === "string" ? { piboSessionId: sessionId } : {}), ...(typeof eventId === "string" ? { eventId } : {}),
				lastAt: row.deadAt, payloadValid: row.payloadBytes > 65536 ? undefined : Boolean(payload), identityCollision: Boolean(row.collision),
				// Do not print arbitrary error/reason text, which may contain user content.
				...(row.deadReason && /^(max_attempts|expired|permanent_failure|payload_malformed)$/.test(row.deadReason) ? { deadReason: row.deadReason } : {}),
			};
			// Relations have their own bounded scan. Unknown is omitted, not reported as false.
			if (hasEvents && typeof sessionId === "string" && typeof eventId === "string" && result.budget.scannedRows < maxScan) {
				const cap = Math.min(100, maxScan - result.budget.scannedRows);
				const collisions = data!.prepare(`SELECT event_id AS eventId, type FROM event_log
					WHERE session_id = ? AND stream_id > ? AND stream_id < ? ORDER BY stream_id LIMIT ?`).all(sessionId, input.afterStream ?? 0, input.beforeStream ?? Number.MAX_SAFE_INTEGER, cap) as Array<{ eventId: string; type: string }>;
				result.budget.scannedRows += collisions.length;
				if (collisions.some((item) => item.eventId === eventId && item.type === "pibo.output.identity_collision")) finding.relatedIdentityCollision = true;
				else if (collisions.length < cap) finding.relatedIdentityCollision = false;
			}
			const bytes = Buffer.byteLength(JSON.stringify(finding));
			if (result.budget.returnedBytes! + bytes > result.budget.maxResultBytes! - 16384) { after = previousCursor; result.budget.reason = "byte_limit"; break; }
			result.budget.returnedBytes! += bytes;
			result.deadLetters.push(finding);
			if (finding.identityCollision) result.summary.identityCollisions++;
			if (finding.relatedIdentityCollision) result.summary.relatedIdentityCollisions++;
			checkpoint();
		}
		if (!result.budget.complete && !result.budget.reason) result.budget.reason = result.deadLetters.length >= limit ? "result_limit" : "scan_limit";
		checkpoint(true);
		return result;
	} finally { data?.close(); db.close(); }
}
