import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

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
	sizes: { database: number; wal: number; shm: number; payloadStoreMetadataSample: number; payloadStoreSampleComplete: boolean };
	pages: { pageSize: number; pageCount: number; freelistCount: number; freelistRatio: number };
	wal: { busy: number; logPages: number; checkpointedPages: number; pressure: boolean };
	rows: Array<{ name: string; kind: "table" | "index"; boundedCount?: number; countComplete?: boolean; estimatedRows?: number }>;
	payloads: { rows: number; rowsComplete: boolean; sampledRows: number; referencedRows: number; metadataOrphans: number; brokenReferences: number; integrityComplete: boolean };
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
	if (!existsSync(path)) return { resultType: "storage.status", readOnly: true, path, exists: false, health: "degraded", sizes: { database: 0, wal: 0, shm: 0, payloadStoreMetadataSample: 0, payloadStoreSampleComplete: true }, pages: { pageSize: 0, pageCount: 0, freelistCount: 0, freelistRatio: 0 }, wal: { busy: 0, logPages: 0, checkpointedPages: 0, pressure: false }, rows: [], payloads: { rows: 0, rowsComplete: true, sampledRows: 0, referencedRows: 0, metadataOrphans: 0, brokenReferences: 0, integrityComplete: true }, thresholds, last: {}, warnings: ["Database does not exist"] };
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
		const payload = inspectPayloadReferencesBounded(db);
		const sizes = {
			database: fileSize(path),
			wal: fileSize(`${path}-wal`),
			shm: fileSize(`${path}-shm`),
			payloadStoreMetadataSample: payload.metadataBytes,
			payloadStoreSampleComplete: payload.rowsComplete,
		};
		const walPressure = sizes.wal >= thresholds.walBytes;
		const warnings = [
			...(sizes.database >= thresholds.databaseBytes ? ["database_size_threshold"] : []),
			...(sizes.wal >= thresholds.walBytes ? ["wal_size_threshold"] : []),
			...(sizes.payloadStoreSampleComplete && sizes.payloadStoreMetadataSample >= thresholds.payloadBytes ? ["payload_size_threshold"] : []),
			...(walPressure ? ["wal_checkpoint_pressure"] : []),
			...(payload.metadataOrphans ? ["payload_metadata_orphans_sample"] : []),
			...(payload.brokenReferences ? ["broken_payload_references_sample"] : []),
		];
		return {
			resultType: "storage.status", readOnly: true, path, exists: true, health: warnings.length ? "degraded" : "healthy", sizes,
			pages: { pageSize, pageCount, freelistCount, freelistRatio: pageCount ? freelistCount / pageCount : 0 },
			wal: { ...walRow, pressure: walPressure }, rows,
			payloads: { rows: payload.rows, rowsComplete: payload.rowsComplete, sampledRows: payload.sampledRows, referencedRows: payload.referencedRows, metadataOrphans: payload.metadataOrphans, brokenReferences: payload.brokenReferences, integrityComplete: payload.integrityComplete },
			thresholds, last: readMaintenanceMetadata(path), warnings,
		};
	} finally { db.close(); }
}

export async function verifyStorage(input: { path: string; mode?: "quick" | "full"; timeoutMs?: number; signal?: AbortSignal; onProgress?: (progress: { stage: string; elapsedMs: number }) => void; /** Test-only native SQLite workload. */ testNativeLongRunning?: boolean }): Promise<StorageVerificationResult> {
	const path = resolve(input.path), mode = input.mode ?? "quick", timeoutMs = input.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error("Verification timeout must be between 1 and 3600000 ms");
	const started = Date.now(), progress: StorageVerificationResult["progress"] = [];
	const record = (stage: string, elapsedMs = Date.now() - started) => { const item = { stage, elapsedMs }; if (progress.length < 32) progress.push(item); input.onProgress?.(item); };
	const resultFor = (status: StorageVerificationResult["status"], healthy: boolean, reason?: string, messages: string[] = []): StorageVerificationResult => ({ resultType: "storage.verification", path, mode, status, healthy, elapsedMs: Date.now() - started, progress, messages, ...(reason ? { reason } : {}) });
	record("starting", 0);
	if (input.signal?.aborted) return resultFor("partial", false, "cancelled");
	const result = await new Promise<StorageVerificationResult>((resolveResult) => {
		let child: ChildProcess | undefined;
		let settled = false;
		let operationTimer: ReturnType<typeof setTimeout> | undefined;
		let pendingPartialReason: string | undefined;
		const startupTimer = setTimeout(() => requestStop("startup_timeout"), Math.min(5_000, Math.max(1_000, timeoutMs)));
		const finish = (value: StorageVerificationResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(startupTimer);
			if (operationTimer) clearTimeout(operationTimer);
			input.signal?.removeEventListener("abort", cancel);
			resolveResult(value);
		};
		const requestStop = (reason: string) => {
			if (settled || pendingPartialReason) return;
			pendingPartialReason = reason;
			record("terminating");
			if (!child?.kill("SIGKILL")) finish(resultFor("failed", false, "verification_process_not_terminated"));
		};
		const cancel = () => requestStop("cancelled");
		input.signal?.addEventListener("abort", cancel, { once: true });
		child = fork(fileURLToPath(new URL("./storage-verification-worker.js", import.meta.url)), [path, mode, ...(input.testNativeLongRunning ? ["native-long"] : [])], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
		child.on("message", (message: unknown) => {
			if (!message || typeof message !== "object") return;
			const item = message as Record<string, unknown>;
			if (item.type === "progress") {
				const stage = String(item.stage);
				record(stage, Number(item.elapsedMs));
				if (stage.endsWith("_check") && !operationTimer) {
					clearTimeout(startupTimer);
					operationTimer = setTimeout(() => requestStop("timeout"), timeoutMs);
				}
				return;
			}
			if (item.type === "result") {
				record("complete", Number(item.elapsedMs));
				const messages = Array.isArray(item.messages) ? item.messages.map(String).slice(0, 100) : [];
				finish(item.ok === true ? resultFor("complete", true, undefined, messages) : resultFor("failed", false, "integrity_errors", messages));
			} else if (item.type === "error") finish(resultFor("failed", false, String(item.message ?? "verification_failed")));
		});
		child.on("error", (error) => finish(resultFor("failed", false, (error instanceof Error ? error.message : String(error)).slice(0, 500))));
		child.on("exit", (code, signal) => {
			if (pendingPartialReason) {
				record("terminated");
				finish(resultFor("partial", false, pendingPartialReason));
			} else if (!settled && code !== 0) finish(resultFor("failed", false, `verification_process_exit_${code ?? signal ?? "unknown"}`));
		});
	});
	if (result.status !== "partial") {
		try { recordMaintenance(path, { operation: "verification", at: new Date().toISOString(), mode, status: result.status, healthy: result.healthy, elapsedMs: result.elapsedMs }); }
		catch { /* A read-only verification result remains valid when metadata storage is unavailable. */ }
	}
	return result;
}

export function checkpointStorage(input: { path: string; mode?: "passive" | "restart" | "truncate"; apply?: boolean }): Record<string, unknown> {
	const path = resolve(input.path), mode = input.mode ?? "passive";
	if (!existsSync(path)) throw new Error(`Checkpoint database does not exist: ${path}`);
	if (mode !== "passive" && mode !== "restart" && mode !== "truncate") throw new Error("Checkpoint mode must be passive, restart, or truncate");
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
		const eligibility = retentionEligibilitySql(target.table);
		const eligible = Number((db.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${target.table} WHERE ${eligibility} AND ${target.time} < ? ORDER BY ${target.time} LIMIT ?)` ).get(input.before, limit) as { count: number }).count);
		const plan = retentionPlan(db, target.table, target.time, input.before, limit);
		if (!input.apply) return { resultType: "storage.retention", mode: "dry-run", path, eligible, deleteLimit: limit, policy: "live_delta_only", plan, preserved: ["chat_message", "audit_event", "idempotency_evidence", "referenced_payloads"] };
		const auditId = `storage_retention_${randomUUID()}`;
		const at = new Date().toISOString();
		db.exec("PRAGMA busy_timeout = 100; BEGIN IMMEDIATE");
		try {
			db.exec(`CREATE TABLE IF NOT EXISTS storage_maintenance_audit (
				id TEXT PRIMARY KEY,
				operation TEXT NOT NULL,
				status TEXT NOT NULL,
				details_json TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`);
			const candidates = db.prepare(`SELECT rowid, ${target.table === "event_log" ? "payload_ref AS payloadRef" : "NULL AS payloadRef"} FROM ${target.table} WHERE ${eligibility} AND ${target.time} < ? ORDER BY ${target.time}, rowid LIMIT ?`).all(input.before, limit) as Array<{ rowid: number; payloadRef: string | null }>;
			const deletion = db.prepare(`DELETE FROM ${target.table} WHERE rowid IN (SELECT rowid FROM ${target.table} WHERE ${eligibility} AND ${target.time} < ? ORDER BY ${target.time}, rowid LIMIT ?)` ).run(input.before, limit);
			const deleted = Number(deletion.changes);
			if (deleted !== candidates.length) throw new Error("Retention candidate/delete count changed while holding the write transaction");
			const releasedPayloadIds = [...new Set(candidates.flatMap((row) => row.payloadRef ? [row.payloadRef] : []))];
			const payloads = inspectReleasedPayloadsBounded(db, releasedPayloadIds);
			const result = { resultType: "storage.retention", mode: "apply", path, eligible, deleted, deleteLimit: limit, policy: "live_delta_only", plan, payloads, auditId, preserved: ["chat_message", "audit_event", "idempotency_evidence", "referenced_payloads", "orphan_payload_files"], at };
			db.prepare("INSERT INTO storage_maintenance_audit (id, operation, status, details_json, created_at) VALUES (?, 'retention', 'complete', ?, ?)").run(auditId, JSON.stringify(result), at);
			db.exec("COMMIT");
			try { recordMaintenance(path, { operation: "retention", ...result }); } catch { /* Transactional audit is authoritative. */ }
			return result;
		} catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
	} finally { db.close(); }
}

function retentionEligibilitySql(table: string): string {
	return table === "event_log"
		? "retention_class = 'live_delta' AND idempotency_key IS NULL"
		: "retention_class = 'live_delta' AND idempotency_key IS NULL AND event_id IS NULL";
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

type PayloadReferenceColumn = { table: string; column: string };

type BoundedPayloadInspection = {
	rows: number;
	rowsComplete: boolean;
	sampledRows: number;
	metadataBytes: number;
	referencedRows: number;
	metadataOrphans: number;
	brokenReferences: number;
	integrityComplete: boolean;
};

function inspectPayloadReferencesBounded(db: DatabaseSync): BoundedPayloadInspection {
	if (!tableExists(db, "payloads")) return { rows: 0, rowsComplete: true, sampledRows: 0, metadataBytes: 0, referencedRows: 0, metadataOrphans: 0, brokenReferences: 0, integrityComplete: true };
	const rowCount = boundedCount(db, "payloads");
	const payloadRows = db.prepare("SELECT id, COALESCE(compressed_byte_size, byte_size) AS bytes FROM payloads ORDER BY id LIMIT 1001").all() as Array<{ id: string; bytes: number }>;
	const sample = payloadRows.slice(0, 1000);
	const references = discoverPayloadReferenceColumns(db);
	let referencedRows = 0;
	for (const payload of sample) if (payloadHasReference(db, payload.id, references)) referencedRows += 1;
	let brokenReferences = 0;
	let referenceSamplesComplete = true;
	for (const reference of references) {
		const table = quoteIdentifier(reference.table), column = quoteIdentifier(reference.column);
		const rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${column} IS NOT NULL LIMIT 101`).all() as Array<{ id: string }>;
		if (rows.length > 100) referenceSamplesComplete = false;
		for (const row of rows.slice(0, 100)) if (!db.prepare("SELECT 1 FROM payloads WHERE id = ?").get(row.id)) brokenReferences += 1;
	}
	return {
		rows: rowCount.count,
		rowsComplete: rowCount.complete,
		sampledRows: sample.length,
		metadataBytes: sample.reduce((total, row) => total + Number(row.bytes ?? 0), 0),
		referencedRows,
		metadataOrphans: sample.length - referencedRows,
		brokenReferences,
		integrityComplete: rowCount.complete && payloadRows.length <= 1000 && referenceSamplesComplete,
	};
}

function inspectReleasedPayloadsBounded(db: DatabaseSync, candidateIds: string[]): Record<string, unknown> {
	const references = discoverPayloadReferenceColumns(db);
	const bounded = [...new Set(candidateIds)].slice(0, 1000);
	const unreferenced = bounded.filter((id) => !payloadHasReference(db, id, references));
	return {
		candidates: candidateIds.length,
		candidatesInspected: bounded.length,
		candidatesTruncated: candidateIds.length > bounded.length,
		unreferencedCandidates: unreferenced.length,
		retainedMetadata: unreferenced.length,
		retainedFiles: unreferenced.length,
		action: "report_only",
	};
}

function discoverPayloadReferenceColumns(db: DatabaseSync): PayloadReferenceColumn[] {
	const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 128").all() as Array<{ name: string }>;
	const references: PayloadReferenceColumn[] = [];
	for (const { name } of tables) {
		const columns = db.prepare("SELECT name FROM pragma_table_info(?) LIMIT 128").all(name) as Array<{ name: string }>;
		for (const column of columns) {
			if (column.name === "payload_ref" || column.name === "content_payload_ref" || column.name === "payload_preview_ref") references.push({ table: name, column: column.name });
		}
	}
	return references.slice(0, 64);
}

function payloadHasReference(db: DatabaseSync, id: string, references: PayloadReferenceColumn[]): boolean {
	for (const reference of references) {
		const table = quoteIdentifier(reference.table), column = quoteIdentifier(reference.column);
		if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id)) return true;
	}
	return false;
}

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
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
