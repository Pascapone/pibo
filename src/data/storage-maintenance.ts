import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

const ROW_SAMPLE_LIMIT = 10_000;
const TABLE_LIMIT = 64;
const DEFAULT_DB_WARN_BYTES = 8 * 1024 ** 3;
const DEFAULT_WAL_WARN_BYTES = 256 * 1024 ** 2;
const DEFAULT_PAYLOAD_WARN_BYTES = 8 * 1024 ** 3;
const MAINTENANCE_LOG_SUFFIX = ".maintenance.jsonl";

export type StorageVerificationResult = {
	resultType: "storage.verification";
	path: string;
	mode: "quick" | "full";
	status: "complete" | "partial" | "failed";
	healthy: boolean;
	elapsedMs: number;
	progress: Array<{ stage: string; elapsedMs: number }>;
	messages: string[];
	reason?: string;
};

export type StorageStatus = {
	resultType: "storage.status";
	readOnly: true;
	path: string;
	exists: boolean;
	health: "healthy" | "degraded";
	sizes: { database: number; wal: number; shm: number; payloadStore: number };
	pages: { pageSize: number; pageCount: number; freelistCount: number; freelistRatio: number };
	wal: { busy: number; logPages: number; checkpointedPages: number; pressure: boolean };
	rows: Array<{ name: string; kind: "table" | "index"; boundedCount?: number; countComplete?: boolean; estimatedRows?: number }>;
	payloads: { rows: number; referencedRows: number; metadataOrphans: number; brokenReferences: number };
	thresholds: { databaseBytes: number; walBytes: number; payloadBytes: number };
	last: { checkpoint?: Record<string, unknown>; backup?: Record<string, unknown>; verification?: Record<string, unknown>; retention?: Record<string, unknown> };
	warnings: string[];
};

export function inspectStorageStatus(input: { path: string; databaseWarnBytes?: number; walWarnBytes?: number; payloadWarnBytes?: number }): StorageStatus {
	const path = resolve(input.path);
	const thresholds = {
		databaseBytes: validThreshold(input.databaseWarnBytes, DEFAULT_DB_WARN_BYTES),
		walBytes: validThreshold(input.walWarnBytes, DEFAULT_WAL_WARN_BYTES),
		payloadBytes: validThreshold(input.payloadWarnBytes, DEFAULT_PAYLOAD_WARN_BYTES),
	};
	if (!existsSync(path)) return { resultType: "storage.status", readOnly: true, path, exists: false, health: "degraded", sizes: { database: 0, wal: 0, shm: 0, payloadStore: 0 }, pages: { pageSize: 0, pageCount: 0, freelistCount: 0, freelistRatio: 0 }, wal: { busy: 0, logPages: 0, checkpointedPages: 0, pressure: false }, rows: [], payloads: { rows: 0, referencedRows: 0, metadataOrphans: 0, brokenReferences: 0 }, thresholds, last: {}, warnings: ["Database does not exist"] };
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		db.exec("PRAGMA busy_timeout = 50");
		const pageSize = pragmaNumber(db, "page_size"), pageCount = pragmaNumber(db, "page_count"), freelistCount = pragmaNumber(db, "freelist_count");
		const walRow = { busy: 0, logPages: pageSize ? Math.ceil(fileSize(`${path}-wal`) / pageSize) : 0, checkpointedPages: 0 };
		const schemas = db.prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name LIMIT ?").all(TABLE_LIMIT) as Array<{ name: string; type: "table" | "index" }>;
		const estimates = statEstimates(db);
		const rows = schemas.map((schema) => {
			if (schema.type === "index") return { name: schema.name, kind: "index" as const, ...(estimates.get(schema.name) !== undefined ? { estimatedRows: estimates.get(schema.name) } : {}) };
			const count = boundedCount(db, schema.name);
			return { name: schema.name, kind: "table" as const, boundedCount: count.count, countComplete: count.complete, ...(estimates.get(schema.name) !== undefined ? { estimatedRows: estimates.get(schema.name) } : {}) };
		});
		const payload = payloadIntegrity(db);
		const sizes = { database: fileSize(path), wal: fileSize(`${path}-wal`), shm: fileSize(`${path}-shm`), payloadStore: payload.bytes };
		const walPressure = sizes.wal >= thresholds.walBytes;
		const warnings = [
			...(sizes.database >= thresholds.databaseBytes ? ["database_size_threshold"] : []),
			...(sizes.wal >= thresholds.walBytes ? ["wal_size_threshold"] : []),
			...(sizes.payloadStore >= thresholds.payloadBytes ? ["payload_size_threshold"] : []),
			...(walPressure ? ["wal_checkpoint_pressure"] : []),
			...(payload.metadataOrphans ? ["payload_metadata_orphans"] : []),
			...(payload.brokenReferences ? ["broken_payload_references"] : []),
		];
		return {
			resultType: "storage.status", readOnly: true, path, exists: true, health: warnings.length ? "degraded" : "healthy", sizes,
			pages: { pageSize, pageCount, freelistCount, freelistRatio: pageCount ? freelistCount / pageCount : 0 },
			wal: { ...walRow, pressure: walPressure }, rows, payloads: { rows: payload.rows, referencedRows: payload.referencedRows, metadataOrphans: payload.metadataOrphans, brokenReferences: payload.brokenReferences }, thresholds,
			last: readMaintenanceMetadata(path), warnings,
		};
	} finally { db.close(); }
}

export async function verifyStorage(input: { path: string; mode?: "quick" | "full"; timeoutMs?: number; signal?: AbortSignal; onProgress?: (progress: { stage: string; elapsedMs: number }) => void }): Promise<StorageVerificationResult> {
	const path = resolve(input.path), mode = input.mode ?? "quick", timeoutMs = input.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error("Verification timeout must be between 1 and 3600000 ms");
	const started = Date.now(), progress: StorageVerificationResult["progress"] = [];
	const record = (stage: string, elapsedMs = Date.now() - started) => { const item = { stage, elapsedMs }; if (progress.length < 32) progress.push(item); input.onProgress?.(item); };
	record("starting", 0);
	let worker: Worker | undefined;
	const result = await new Promise<StorageVerificationResult>((resolveResult) => {
		let settled = false;
		const finish = (value: StorageVerificationResult) => { if (settled) return; settled = true; clearTimeout(timer); input.signal?.removeEventListener("abort", cancel); resolveResult(value); };
		const partial = (reason: string) => { record("cancelled"); void worker?.terminate(); finish({ resultType: "storage.verification", path, mode, status: "partial", healthy: false, elapsedMs: Date.now() - started, progress, messages: [], reason }); };
		const cancel = () => partial("cancelled");
		const timer = setTimeout(() => partial("timeout"), timeoutMs);
		if (input.signal?.aborted) { partial("cancelled"); return; }
		input.signal?.addEventListener("abort", cancel, { once: true });
		worker = new Worker(new URL("./storage-verification-worker.js", import.meta.url), { workerData: { path, mode } });
		worker.on("message", (message: Record<string, unknown>) => {
			if (message.type === "progress") { record(String(message.stage), Number(message.elapsedMs)); return; }
			if (message.type === "result") {
				record("complete", Number(message.elapsedMs));
				const messages = Array.isArray(message.messages) ? message.messages.map(String).slice(0, 100) : [];
				finish({ resultType: "storage.verification", path, mode, status: message.ok === true ? "complete" : "failed", healthy: message.ok === true, elapsedMs: Date.now() - started, progress, messages, ...(message.ok === true ? {} : { reason: "integrity_errors" }) });
			} else if (message.type === "error") finish({ resultType: "storage.verification", path, mode, status: "failed", healthy: false, elapsedMs: Date.now() - started, progress, messages: [], reason: String(message.message ?? "worker_failed") });
		});
		worker.on("error", (error) => finish({ resultType: "storage.verification", path, mode, status: "failed", healthy: false, elapsedMs: Date.now() - started, progress, messages: [], reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) }));
		worker.on("exit", (code) => { if (!settled && code !== 0) finish({ resultType: "storage.verification", path, mode, status: "failed", healthy: false, elapsedMs: Date.now() - started, progress, messages: [], reason: `worker_exit_${code}` }); });
	});
	if (result.status !== "partial") {
		try { recordMaintenance(path, { operation: "verification", at: new Date().toISOString(), mode, status: result.status, healthy: result.healthy, elapsedMs: result.elapsedMs }); }
		catch { /* A read-only verification result remains valid when metadata storage is unavailable. */ }
	}
	return result;
}

export function checkpointStorage(input: { path: string; mode?: "passive" | "restart" | "truncate"; apply?: boolean }): Record<string, unknown> {
	const path = resolve(input.path), mode = input.mode ?? "passive";
	if (!input.apply) return { resultType: "storage.checkpoint", mode: "dry-run", path, checkpointMode: mode, mutation: false };
	const db = new DatabaseSync(path);
	try {
		db.exec("PRAGMA busy_timeout = 100");
		const row = db.prepare(`PRAGMA wal_checkpoint(${mode.toUpperCase()})`).get() as Record<string, unknown>;
		const result = { resultType: "storage.checkpoint", mode: "apply", path, checkpointMode: mode, mutation: true, busy: Number(row.busy ?? 0), logPages: Number(row.log ?? 0), checkpointedPages: Number(row.checkpointed ?? 0), at: new Date().toISOString() };
		recordMaintenance(path, { operation: "checkpoint", ...result });
		return result;
	} finally { db.close(); }
}

export async function maintainStorageRetention(input: { path: string; before: string; limit?: number; apply?: boolean; payloadRoot?: string }): Promise<Record<string, unknown>> {
	const path = resolve(input.path), limit = input.limit ?? 1000;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Retention limit must be between 1 and 10000");
	if (!Number.isFinite(Date.parse(input.before))) throw new Error("Retention --before must be an ISO date");
	const db = new DatabaseSync(path, { readOnly: !input.apply });
	const target = tableExists(db, "event_log") ? { table: "event_log", time: "created_at" } : tableExists(db, "pibo_event_stream") ? { table: "pibo_event_stream", time: "created_at" } : undefined;
	try {
		if (!target) return { resultType: "storage.retention", mode: input.apply ? "apply" : "dry-run", path, eligible: 0, deleted: 0, policy: "live_delta_only", preserved: ["chat_message", "audit_event", "idempotency_evidence", "referenced_payloads"] };
		const eligible = Number((db.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${target.table} WHERE retention_class = 'live_delta' AND ${target.time} < ? ORDER BY ${target.time} LIMIT ?)` ).get(input.before, limit) as { count: number }).count);
		const plan = retentionPlan(db, target.table, target.time, input.before, limit);
		if (!input.apply) return { resultType: "storage.retention", mode: "dry-run", path, eligible, deleteLimit: limit, policy: "live_delta_only", plan, preserved: ["chat_message", "audit_event", "idempotency_evidence", "referenced_payloads"] };
		const releasedPayloadIds = target.table === "event_log" && columnExists(db, "event_log", "payload_ref")
			? (db.prepare(`SELECT DISTINCT payload_ref AS id FROM event_log WHERE rowid IN (SELECT rowid FROM event_log WHERE retention_class = 'live_delta' AND ${target.time} < ? ORDER BY ${target.time} LIMIT ?) AND payload_ref IS NOT NULL`).all(input.before, limit) as Array<{ id: string }>).map((row) => row.id)
			: [];
		db.exec("PRAGMA busy_timeout = 100; BEGIN IMMEDIATE");
		let deleted = 0;
		try {
			const result = db.prepare(`DELETE FROM ${target.table} WHERE rowid IN (SELECT rowid FROM ${target.table} WHERE retention_class = 'live_delta' AND ${target.time} < ? ORDER BY ${target.time} LIMIT ?)` ).run(input.before, limit);
			deleted = Number(result.changes);
			db.exec("COMMIT");
		} catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
		const orphanResult = await reconcilePayloadOrphans(db, releasedPayloadIds, input.payloadRoot);
		const result = { resultType: "storage.retention", mode: "apply", path, eligible, deleted, deleteLimit: limit, policy: "live_delta_only", plan, payloads: orphanResult, preserved: ["chat_message", "audit_event", "idempotency_evidence", "referenced_payloads"], at: new Date().toISOString() };
		recordMaintenance(path, { operation: "retention", ...result });
		return result;
	} finally { db.close(); }
}

function retentionPlan(db: DatabaseSync, table: string, time: string, before: string, limit: number): Array<Record<string, unknown>> {
	const classes = ["live_delta", "trace_event", "chat_message", "audit_event"];
	return classes.map((retentionClass) => {
		const rows = Number((db.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${table} WHERE retention_class=? AND ${time} < ? LIMIT ?)` ).get(retentionClass, before, limit + 1) as { count: number }).count);
		return {
			retentionClass,
			rows: Math.min(rows, limit),
			bounded: rows > limit,
			disposition: retentionClass === "live_delta" ? "eligible" : retentionClass === "trace_event" ? "deferred_requires_policy" : "preserve",
		};
	});
}

function payloadIntegrity(db: DatabaseSync): { rows: number; referencedRows: number; metadataOrphans: number; brokenReferences: number; bytes: number } {
	if (!tableExists(db, "payloads")) return { rows: 0, referencedRows: 0, metadataOrphans: 0, brokenReferences: 0, bytes: 0 };
	const refs = payloadReferenceUnion(db);
	const rows = Number((db.prepare("SELECT COUNT(*) AS count FROM payloads").get() as { count: number }).count);
	const bytes = Number((db.prepare("SELECT COALESCE(SUM(COALESCE(compressed_byte_size, byte_size)),0) AS count FROM payloads").get() as { count: number }).count);
	if (!refs) return { rows, referencedRows: 0, metadataOrphans: rows, brokenReferences: 0, bytes };
	const referencedRows = Number((db.prepare(`SELECT COUNT(DISTINCT payload_ref) AS count FROM (${refs}) WHERE payload_ref IS NOT NULL`).get() as { count: number }).count);
	const metadataOrphans = Number((db.prepare(`SELECT COUNT(*) AS count FROM payloads p WHERE NOT EXISTS (SELECT 1 FROM (${refs}) r WHERE r.payload_ref = p.id)`).get() as { count: number }).count);
	const brokenReferences = Number((db.prepare(`SELECT COUNT(DISTINCT r.payload_ref) AS count FROM (${refs}) r LEFT JOIN payloads p ON p.id=r.payload_ref WHERE r.payload_ref IS NOT NULL AND p.id IS NULL`).get() as { count: number }).count);
	return { rows, referencedRows, metadataOrphans, brokenReferences, bytes };
}

async function reconcilePayloadOrphans(db: DatabaseSync, candidateIds: string[], payloadRoot?: string): Promise<{ metadataOrphans: number; removedMetadata: number; removedFiles: number; brokenReferences: number }> {
	const integrity = payloadIntegrity(db);
	if (!tableExists(db, "payloads")) return { metadataOrphans: 0, removedMetadata: 0, removedFiles: 0, brokenReferences: 0 };
	const refs = payloadReferenceUnion(db);
	if (!refs) return { metadataOrphans: integrity.metadataOrphans, removedMetadata: 0, removedFiles: 0, brokenReferences: integrity.brokenReferences };
	const boundedIds = [...new Set(candidateIds)].slice(0, 1000);
	const orphans = boundedIds.flatMap((id) => db.prepare(`SELECT id, storage_path AS storagePath FROM payloads p WHERE id=? AND NOT EXISTS (SELECT 1 FROM (${refs}) r WHERE r.payload_ref=p.id)`).all(id) as Array<{ id: string; storagePath: string | null }>);
	db.exec("BEGIN IMMEDIATE");
	try { for (const orphan of orphans) db.prepare(`DELETE FROM payloads WHERE id=? AND NOT EXISTS (SELECT 1 FROM (${refs}) r WHERE r.payload_ref=?)`).run(orphan.id, orphan.id); db.exec("COMMIT"); }
	catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
	let removedFiles = 0;
	if (payloadRoot) for (const orphan of orphans) {
		if (!orphan.storagePath) continue;
		const root = resolve(payloadRoot), file = resolve(root, orphan.storagePath), rel = relative(root, file);
		if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) continue;
		await rm(file, { force: true }); removedFiles += 1;
	}
	return { metadataOrphans: integrity.metadataOrphans, removedMetadata: orphans.length, removedFiles, brokenReferences: integrity.brokenReferences };
}

function payloadReferenceUnion(db: DatabaseSync): string | undefined {
	const specs = [["event_log", "payload_ref"], ["chat_messages", "content_payload_ref"], ["observations", "payload_ref"], ["message_commands", "payload_ref"], ["telemetry_turns", "payload_ref"], ["telemetry_phases", "payload_ref"], ["telemetry_provider_requests", "payload_ref"], ["telemetry_provider_events", "payload_ref"], ["telemetry_provider_events", "payload_preview_ref"], ["telemetry_tool_calls", "payload_ref"]];
	const available = specs.filter(([table, column]) => tableExists(db, table) && columnExists(db, table, column));
	return available.length ? available.map(([table, column]) => `SELECT ${column} AS payload_ref FROM ${table} WHERE ${column} IS NOT NULL`).join(" UNION ALL ") : undefined;
}
function statEstimates(db: DatabaseSync): Map<string, number> { const result = new Map<string, number>(); if (!tableExists(db, "sqlite_stat1")) return result; try { for (const row of db.prepare("SELECT tbl, idx, stat FROM sqlite_stat1 LIMIT 256").all() as Array<{ tbl: string; idx: string | null; stat: string }>) { const estimate = Number.parseInt(row.stat.split(" ")[0] ?? "", 10); if (Number.isFinite(estimate)) { result.set(row.tbl, estimate); if (row.idx) result.set(row.idx, estimate); } } } catch {} return result; }
function boundedCount(db: DatabaseSync, name: string): { count: number; complete: boolean } { const quoted = `"${name.replaceAll('"', '""')}"`; try { const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${quoted} LIMIT ?)` ).get(ROW_SAMPLE_LIMIT + 1) as { count: number }).count); return { count: Math.min(count, ROW_SAMPLE_LIMIT), complete: count <= ROW_SAMPLE_LIMIT }; } catch { return { count: 0, complete: false }; } }
function pragmaNumber(db: DatabaseSync, name: string): number { return Number(Object.values(db.prepare(`PRAGMA ${name}`).get() ?? { value: 0 })[0] ?? 0); }
function tableExists(db: DatabaseSync, table: string): boolean { return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)); }
function columnExists(db: DatabaseSync, table: string, column: string): boolean { return Boolean(db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, column)); }
function fileSize(path: string): number { try { return statSync(path).size; } catch { return 0; } }
function validThreshold(value: number | undefined, fallback: number): number { return Number.isSafeInteger(value) && value! > 0 ? value! : fallback; }
export function recordStorageMaintenance(path: string, value: Record<string, unknown>): void { appendFileSync(`${resolve(path)}${MAINTENANCE_LOG_SUFFIX}`, `${JSON.stringify(value)}\n`, { mode: 0o600 }); }
function recordMaintenance(path: string, value: Record<string, unknown>): void { recordStorageMaintenance(path, value); }
function readMaintenanceMetadata(path: string): StorageStatus["last"] { const result: StorageStatus["last"] = {}; try { const metadataPath = `${path}${MAINTENANCE_LOG_SUFFIX}`; const bytes = statSync(metadataPath).size; if (bytes > 1024 * 1024) return result; const lines = readFileSync(metadataPath, "utf8").trim().split("\n").slice(-100); for (const line of lines) { const row = JSON.parse(line) as Record<string, unknown>; const operation = row.operation; if (operation === "checkpoint") result.checkpoint = row; else if (operation === "backup") result.backup = row; else if (operation === "verification") result.verification = row; else if (operation === "retention") result.retention = row; } } catch {} return result; }
