import type { DatabaseSync } from "node:sqlite";
import {
	phaseFromRow,
	providerEventFromRow,
	providerRequestFromRow,
	toolCallFromRow,
	turnFromRow,
	type TelemetryPhaseRow,
	type TelemetryProviderEventRow,
	type TelemetryProviderRequestRow,
	type TelemetryToolCallRow,
	type TelemetryTurnRow,
} from "./telemetry-rows.js";
import type {
	StoredTelemetryPhase,
	StoredTelemetryProviderRequest,
	StoredTelemetryToolCall,
	StoredTelemetryTurn,
	TelemetryListOptions,
	TelemetryProviderEventListOptions,
	TelemetryProviderEventsPage,
	TelemetrySessionDetail,
	TelemetrySessionSummary,
	TelemetryStaleOptions,
	TelemetryStaleWorkItem,
	TelemetryTurnTimeline,
} from "./telemetry.js";

const DEFAULT_TELEMETRY_LIST_LIMIT = 20;
const MAX_TELEMETRY_LIST_LIMIT = 200;
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function listTelemetrySessions(db: DatabaseSync, input: TelemetryStaleOptions = {}): TelemetrySessionSummary[] {
	const limit = normalizeTelemetryListLimit(input.limit);
	const nowMs = Date.parse(input.now ?? new Date().toISOString());
	const thresholdMs = input.thresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
	const rows = db.prepare(`
		SELECT t.*, counts.turn_count AS turn_count FROM telemetry_turns t
		JOIN (
			SELECT pibo_session_id, MAX(updated_at) AS max_updated, COUNT(*) AS turn_count
			FROM telemetry_turns
			GROUP BY pibo_session_id
		) counts ON counts.pibo_session_id = t.pibo_session_id AND counts.max_updated = t.updated_at
		ORDER BY t.updated_at DESC
		LIMIT ?
	`).all(limit) as Array<TelemetryTurnRow & { turn_count: number }>;
	return rows.map((row) => telemetrySessionSummaryFromTurnRow(db, row, Number(row.turn_count), nowMs, thresholdMs));
}

export function getTelemetrySessionDetail(db: DatabaseSync, piboSessionId: string, input: TelemetryListOptions = {}): TelemetrySessionDetail | undefined {
	const recentTurns = listTelemetryTurnsForSession(db, piboSessionId, input);
	if (recentTurns.length === 0) return undefined;
	const activeTurn = recentTurns.find((turn) => turn.status === "queued" || turn.status === "running") ?? recentTurns[0];
	const activePhase = getTelemetryActivePhaseForSession(db, piboSessionId, activeTurn.turnId);
	const providerRequests = listTelemetryProviderRequestsForTurn(db, activeTurn.turnId, input);
	const toolCalls = listTelemetryToolCallsForTurn(db, activeTurn.turnId, input);
	return {
		piboSessionId,
		activeTurn,
		activePhase,
		recentTurns,
		providerRequests,
		toolCalls,
		nextCommands: telemetryNextCommands({ piboSessionId, turnId: activeTurn.turnId, providerRequests, toolCalls }),
	};
}

export function getTelemetryTurnTimeline(db: DatabaseSync, turnIdOrEventId: string, input: TelemetryListOptions = {}): TelemetryTurnTimeline | undefined {
	const turn = getTelemetryTurn(db, turnIdOrEventId) ?? getTelemetryTurnByEventId(db, turnIdOrEventId);
	if (!turn) return undefined;
	const limit = normalizeTelemetryListLimit(input.limit);
	const phaseRows = db.prepare(`
		SELECT * FROM telemetry_phases
		WHERE turn_id = ?
		ORDER BY started_at ASC, created_at ASC
		LIMIT ?
	`).all(turn.turnId, limit) as TelemetryPhaseRow[];
	const phases = phaseRows.map(phaseFromRow);
	const providerRequests = listTelemetryProviderRequestsForTurn(db, turn.turnId, input);
	const toolCalls = listTelemetryToolCallsForTurn(db, turn.turnId, input);
	return {
		turn,
		phases,
		providerRequests,
		toolCalls,
		nextCommands: telemetryNextCommands({ piboSessionId: turn.piboSessionId, turnId: turn.turnId, providerRequests, toolCalls }),
	};
}

export function listTelemetryProviderEventsPage(db: DatabaseSync, providerRequestId: string, input: TelemetryProviderEventListOptions = {}): TelemetryProviderEventsPage {
	const limit = normalizeTelemetryListLimit(input.limit);
	const afterSequence = input.afterSequence ?? -1;
	const rows = db.prepare(`
		SELECT * FROM telemetry_provider_events
		WHERE provider_request_id = ? AND sequence > ?
		ORDER BY sequence ASC
		LIMIT ?
	`).all(providerRequestId, afterSequence, limit + 1) as TelemetryProviderEventRow[];
	const hasMore = rows.length > limit;
	const pageRows = rows.slice(0, limit).map(providerEventFromRow);
	return {
		providerRequestId,
		rows: pageRows,
		limit,
		afterSequence,
		nextAfterSequence: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]?.sequence : undefined,
		hasMore,
		truncated: hasMore,
		storageMode: "per_event",
	};
}

export function listTelemetryStaleWork(db: DatabaseSync, input: TelemetryStaleOptions = {}): TelemetryStaleWorkItem[] {
	const limit = normalizeTelemetryListLimit(input.limit);
	const thresholdMs = input.thresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
	const nowMs = Date.parse(input.now ?? new Date().toISOString());
	const rows = db.prepare(`
		SELECT * FROM telemetry_phases
		WHERE status = 'open'
		ORDER BY COALESCE(last_progress_at, started_at) ASC
		LIMIT ?
	`).all(MAX_TELEMETRY_LIST_LIMIT) as TelemetryPhaseRow[];
	return rows.map(phaseFromRow)
		.map((phase) => {
			const progress = phase.lastProgressAt ?? phase.startedAt;
			const staleForMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - Date.parse(progress)) : 0;
			const turn = getTelemetryTurn(db, phase.turnId);
			return { phase, staleForMs, turn };
		})
		.filter((item) => item.staleForMs >= thresholdMs)
		.slice(0, limit)
		.map(({ phase, staleForMs, turn }) => ({
			piboSessionId: phase.piboSessionId,
			turnId: phase.turnId,
			phaseId: phase.phaseId,
			phase: phase.name,
			lastProgressAt: phase.lastProgressAt ?? phase.startedAt,
			staleForMs,
			thresholdMs,
			queueDepth: turn?.queueDepth,
			nextCommands: telemetryNextCommands({ piboSessionId: phase.piboSessionId, turnId: phase.turnId, phase }),
		}));
}

function getTelemetryTurn(db: DatabaseSync, turnId: string): StoredTelemetryTurn | undefined {
	const row = db.prepare("SELECT * FROM telemetry_turns WHERE turn_id = ?").get(turnId) as TelemetryTurnRow | undefined;
	return row ? turnFromRow(row) : undefined;
}

function listTelemetryTurnsForSession(db: DatabaseSync, piboSessionId: string, input: TelemetryListOptions = {}): StoredTelemetryTurn[] {
	const limit = normalizeTelemetryListLimit(input.limit);
	const rows = db.prepare(`
		SELECT * FROM telemetry_turns
		WHERE pibo_session_id = ?
		ORDER BY updated_at DESC
		LIMIT ?
	`).all(piboSessionId, limit) as TelemetryTurnRow[];
	return rows.map(turnFromRow);
}

function getTelemetryTurnByEventId(db: DatabaseSync, eventId: string): StoredTelemetryTurn | undefined {
	const row = db.prepare(`
		SELECT * FROM telemetry_turns
		WHERE event_id = ? OR input_event_id = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`).get(eventId, eventId) as TelemetryTurnRow | undefined;
	return row ? turnFromRow(row) : undefined;
}

function getTelemetryActivePhaseForSession(db: DatabaseSync, piboSessionId: string, turnId?: string): StoredTelemetryPhase | undefined {
	const row = turnId
		? db.prepare(`
			SELECT * FROM telemetry_phases
			WHERE pibo_session_id = ? AND turn_id = ? AND status = 'open'
			ORDER BY COALESCE(last_progress_at, started_at) DESC
			LIMIT 1
		`).get(piboSessionId, turnId) as TelemetryPhaseRow | undefined
		: db.prepare(`
			SELECT * FROM telemetry_phases
			WHERE pibo_session_id = ? AND status = 'open'
			ORDER BY COALESCE(last_progress_at, started_at) DESC
			LIMIT 1
		`).get(piboSessionId) as TelemetryPhaseRow | undefined;
	return row ? phaseFromRow(row) : undefined;
}

function listTelemetryProviderRequestsForTurn(db: DatabaseSync, turnId: string, input: TelemetryListOptions = {}): StoredTelemetryProviderRequest[] {
	const limit = normalizeTelemetryListLimit(input.limit);
	const rows = db.prepare(`
		SELECT * FROM telemetry_provider_requests
		WHERE turn_id = ?
		ORDER BY started_at ASC
		LIMIT ?
	`).all(turnId, limit) as TelemetryProviderRequestRow[];
	return rows.map(providerRequestFromRow);
}

function listTelemetryToolCallsForTurn(db: DatabaseSync, turnId: string, input: TelemetryListOptions = {}): StoredTelemetryToolCall[] {
	const limit = normalizeTelemetryListLimit(input.limit);
	const rows = db.prepare(`
		SELECT * FROM telemetry_tool_calls
		WHERE turn_id = ?
		ORDER BY COALESCE(args_started_at, created_at) ASC
		LIMIT ?
	`).all(turnId, limit) as TelemetryToolCallRow[];
	return rows.map(toolCallFromRow);
}

function telemetrySessionSummaryFromTurnRow(db: DatabaseSync, row: TelemetryTurnRow, turnCount: number, nowMs: number, thresholdMs: number): TelemetrySessionSummary {
	const turn = turnFromRow(row);
	const activePhase = getTelemetryActivePhaseForSession(db, turn.piboSessionId, turn.turnId);
	const lastProgressAt = activePhase?.lastProgressAt ?? activePhase?.startedAt ?? turn.lastProgressAt ?? turn.startedAt ?? turn.queuedAt;
	const staleForMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - Date.parse(lastProgressAt)) : undefined;
	return {
		piboSessionId: turn.piboSessionId,
		status: turn.status ?? "idle",
		activeTurnId: turn.status === "queued" || turn.status === "running" ? turn.turnId : undefined,
		activePhase,
		queueDepth: turn.queueDepth,
		lastProgressAt,
		staleForMs,
		isStale: typeof staleForMs === "number" && staleForMs >= thresholdMs && (turn.status === "queued" || turn.status === "running" || activePhase?.status === "open"),
		turnCount,
		nextCommands: telemetryNextCommands({ piboSessionId: turn.piboSessionId, turnId: turn.turnId, phase: activePhase }),
	};
}

function telemetryNextCommands(input: {
	piboSessionId?: string;
	turnId?: string;
	phase?: StoredTelemetryPhase;
	providerRequests?: StoredTelemetryProviderRequest[];
	toolCalls?: StoredTelemetryToolCall[];
}): string[] {
	const commands: string[] = [];
	if (input.piboSessionId) commands.push(`pibo debug telemetry session ${input.piboSessionId}`);
	if (input.turnId) commands.push(`pibo debug telemetry turn ${input.turnId}`);
	const providerRequestId = input.phase?.providerRequestId ?? input.providerRequests?.[0]?.providerRequestId;
	if (providerRequestId) {
		commands.push(`pibo debug telemetry provider ${providerRequestId}`);
		commands.push(`pibo debug telemetry provider ${providerRequestId} events --limit 20`);
	}
	const toolCallId = input.phase?.toolCallId ?? input.toolCalls?.[0]?.toolCallId;
	if (toolCallId) commands.push(`pibo debug telemetry tool ${toolCallId}`);
	return [...new Set(commands)];
}

function normalizeTelemetryListLimit(value: number | undefined): number {
	return clampLimit(value ?? DEFAULT_TELEMETRY_LIST_LIMIT, 1, MAX_TELEMETRY_LIST_LIMIT);
}

function clampLimit(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}
