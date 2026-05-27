import type { DatabaseSync } from "node:sqlite";

export type TelemetryRetentionClass = "live" | "diagnostic" | "provider_event" | "payload_preview" | "incident";

export type TelemetryRetentionStatsRow = {
	retentionClass: TelemetryRetentionClass;
	table: "turns" | "phases" | "provider_requests" | "provider_events" | "tool_calls";
	rowCount: number;
	byteCount: number;
};

export type TelemetryRetentionStats = {
	rows: TelemetryRetentionStatsRow[];
	totalRows: number;
	totalBytes: number;
};

export type TelemetryPruneInput = {
	retentionClass: TelemetryRetentionClass;
	before: string;
	apply?: boolean;
};

export type TelemetryPruneResult = {
	retentionClass: TelemetryRetentionClass;
	before: string;
	applied: boolean;
	rowsMatched: number;
	bytesMatched: number;
	rowsDeleted: number;
};

const RETENTION_CLASSES: TelemetryRetentionClass[] = ["live", "diagnostic", "provider_event", "incident", "payload_preview"];

const PRUNE_TABLES = [
	{ table: "telemetry_provider_events", cutoffColumn: "received_at", byteExpression: "byte_size" },
	{ table: "telemetry_tool_calls", cutoffColumn: "updated_at", byteExpression: "0" },
	{ table: "telemetry_provider_requests", cutoffColumn: "updated_at", byteExpression: "COALESCE(bytes_received, 0)" },
	{ table: "telemetry_phases", cutoffColumn: "updated_at", byteExpression: "0" },
	{ table: "telemetry_turns", cutoffColumn: "updated_at", byteExpression: "0" },
] as const;

export function getTelemetryRetentionStats(db: DatabaseSync): TelemetryRetentionStats {
	const rows: TelemetryRetentionStatsRow[] = [];
	for (const retentionClass of RETENTION_CLASSES) {
		rows.push(statsForTable(db, "turns", "telemetry_turns", "0", retentionClass));
		rows.push(statsForTable(db, "phases", "telemetry_phases", "0", retentionClass));
		rows.push(statsForTable(db, "provider_requests", "telemetry_provider_requests", "COALESCE(bytes_received, 0)", retentionClass));
		rows.push(statsForTable(db, "provider_events", "telemetry_provider_events", "byte_size", retentionClass));
		rows.push(statsForTable(db, "tool_calls", "telemetry_tool_calls", "0", retentionClass));
	}
	const presentRows = rows.filter((row) => row.rowCount > 0 || row.retentionClass === "payload_preview");
	return {
		rows: presentRows,
		totalRows: presentRows.reduce((sum, row) => sum + row.rowCount, 0),
		totalBytes: presentRows.reduce((sum, row) => sum + row.byteCount, 0),
	};
}

export function pruneTelemetryRetention(db: DatabaseSync, input: TelemetryPruneInput): TelemetryPruneResult {
	const plan = telemetryPrunePlan(db, input.retentionClass, input.before);
	if (!input.apply) {
		return { retentionClass: input.retentionClass, before: input.before, applied: false, rowsMatched: plan.rows, bytesMatched: plan.bytes, rowsDeleted: 0 };
	}
	let rowsDeleted = 0;
	for (const spec of PRUNE_TABLES) {
		const result = db.prepare(`DELETE FROM ${spec.table} WHERE retention_class = ? AND ${spec.cutoffColumn} < ?`).run(input.retentionClass, input.before);
		rowsDeleted += Number(result.changes ?? 0);
	}
	return { retentionClass: input.retentionClass, before: input.before, applied: true, rowsMatched: plan.rows, bytesMatched: plan.bytes, rowsDeleted };
}

function statsForTable(db: DatabaseSync, table: TelemetryRetentionStatsRow["table"], sqlTable: string, byteExpression: string, retentionClass: TelemetryRetentionClass): TelemetryRetentionStatsRow {
	const row = db.prepare(`SELECT COUNT(*) AS row_count, COALESCE(SUM(${byteExpression}), 0) AS byte_count FROM ${sqlTable} WHERE retention_class = ?`).get(retentionClass) as { row_count: number; byte_count: number };
	return { retentionClass, table, rowCount: Number(row.row_count ?? 0), byteCount: Number(row.byte_count ?? 0) };
}

function telemetryPrunePlan(db: DatabaseSync, retentionClass: TelemetryRetentionClass, before: string): { rows: number; bytes: number } {
	let rows = 0;
	let bytes = 0;
	for (const spec of PRUNE_TABLES) {
		const row = db.prepare(`SELECT COUNT(*) AS row_count, COALESCE(SUM(${spec.byteExpression}), 0) AS byte_count FROM ${spec.table} WHERE retention_class = ? AND ${spec.cutoffColumn} < ?`).get(retentionClass, before) as { row_count: number; byte_count: number };
		rows += Number(row.row_count ?? 0);
		bytes += Number(row.byte_count ?? 0);
	}
	return { rows, bytes };
}
