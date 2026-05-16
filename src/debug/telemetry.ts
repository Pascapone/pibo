import type {
	StoredTelemetryPhase,
	StoredTelemetryProviderRequest,
	StoredTelemetryToolCall,
	StoredTelemetryTurn,
	TelemetrySessionDetail,
	TelemetrySessionSummary,
	TelemetryStore,
	TelemetryTurnTimeline,
} from "../data/telemetry.js";
import { TelemetryStore as PiboTelemetryStore } from "../data/telemetry.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { formatRows, openReadOnlyDebugDatabase } from "./sql.js";

export type DebugTelemetryListOptions = {
	limit?: string;
	active?: boolean;
	stale?: boolean;
};

export type DebugTelemetryDetailOptions = {
	limit?: string;
	events?: boolean;
};

const DEFAULT_TELEMETRY_CLI_LIMIT = 20;
const MAX_TELEMETRY_CLI_LIMIT = 200;

export type DebugTelemetryUnavailable = {
	available: false;
	reason: "store_missing" | "tables_missing" | "not_found";
	message: string;
	nextCommands: string[];
};

export type DebugTelemetrySessionsResult = {
	available: true;
	command: "sessions";
	filters: {
		active: boolean;
		stale: boolean;
	};
	limit: number;
	rowCount: number;
	truncated: boolean;
	rows: TelemetrySessionSummary[];
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetrySessionResult = {
	available: true;
	command: "session";
	piboSessionId: string;
	limit: number;
	truncated: {
		recentTurns: boolean;
		providerRequests: boolean;
		toolCalls: boolean;
	};
	detail: TelemetrySessionDetail;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryTurnResult = {
	available: true;
	command: "turn";
	turnIdOrEventId: string;
	limit: number;
	includeEventRefs: boolean;
	truncated: {
		phases: boolean;
		providerRequests: boolean;
		toolCalls: boolean;
	};
	timeline: TelemetryTurnTimeline;
	openPhases: number;
	missingTerminalEvent: boolean;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export function inspectTelemetrySessions(store: ResolvedPiboDebugStore, options: DebugTelemetryListOptions = {}): DebugTelemetrySessionsResult {
	const limit = parseTelemetryLimit(options.limit);
	return withTelemetryStore(store, (telemetry) => {
		const readLimit = options.active || options.stale ? MAX_TELEMETRY_CLI_LIMIT : limit;
		const rows = telemetry.listSessions({ limit: readLimit })
			.filter((row) => !options.active || row.status === "queued" || row.status === "running")
			.filter((row) => !options.stale || row.isStale)
			.slice(0, limit);
		return {
			available: true,
			command: "sessions",
			filters: { active: options.active === true, stale: options.stale === true },
			limit,
			rowCount: rows.length,
			truncated: rows.length >= limit,
			rows,
			nextCommands: [
				"pibo debug telemetry session <pibo-session-id>",
				"pibo debug telemetry stale",
			],
		};
	});
}

export function inspectTelemetrySession(store: ResolvedPiboDebugStore, piboSessionId: string, options: DebugTelemetryDetailOptions = {}): DebugTelemetrySessionResult {
	const limit = parseTelemetryLimit(options.limit);
	return withTelemetryStore(store, (telemetry) => {
		const detail = telemetry.getSessionTelemetry(piboSessionId, { limit });
		if (!detail) return notFound(`No telemetry found for Pibo Session ${piboSessionId}.`, piboSessionId);
		return {
			available: true,
			command: "session",
			piboSessionId,
			limit,
			truncated: {
				recentTurns: detail.recentTurns.length >= limit,
				providerRequests: detail.providerRequests.length >= limit,
				toolCalls: detail.toolCalls.length >= limit,
			},
			detail,
			nextCommands: detail.nextCommands,
		};
	});
}

export function inspectTelemetryTurn(store: ResolvedPiboDebugStore, turnIdOrEventId: string, options: DebugTelemetryDetailOptions = {}): DebugTelemetryTurnResult {
	const limit = parseTelemetryLimit(options.limit);
	return withTelemetryStore(store, (telemetry) => {
		const timeline = telemetry.getTurnTimeline(turnIdOrEventId, { limit });
		if (!timeline) return notFound(`No telemetry found for turn or event ${turnIdOrEventId}.`, undefined, turnIdOrEventId);
		const openPhases = timeline.phases.filter((phase) => phase.status === "open").length;
		const missingTerminalEvent = timeline.turn.status === "running" && !timeline.phases.some((phase) => phase.name === "finish" && phase.status === "ok");
		return {
			available: true,
			command: "turn",
			turnIdOrEventId,
			limit,
			includeEventRefs: options.events === true,
			truncated: {
				phases: timeline.phases.length >= limit,
				providerRequests: timeline.providerRequests.length >= limit,
				toolCalls: timeline.toolCalls.length >= limit,
			},
			timeline,
			openPhases,
			missingTerminalEvent,
			nextCommands: timeline.nextCommands,
		};
	});
}

export function formatTelemetrySessions(result: DebugTelemetrySessionsResult): string {
	if (!result.available) return formatUnavailable(result);
	const rows = result.rows.map((row) => ({
		piboSessionId: row.piboSessionId,
		status: row.status,
		activeTurnId: row.activeTurnId,
		activePhase: formatPhaseRef(row.activePhase),
		queueDepth: row.queueDepth,
		lastProgressAt: row.lastProgressAt,
		staleForMs: row.staleForMs,
		isStale: row.isStale,
		next: row.nextCommands[0],
	}));
	return [
		"pibo debug telemetry sessions",
		`filters\tactive=${result.filters.active}\tstale=${result.filters.stale}\tlimit=${result.limit}`,
		formatRows(rows),
		`truncated\t${result.truncated}`,
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetrySession(result: DebugTelemetrySessionResult): string {
	if (!result.available) return formatUnavailable(result);
	const detail = result.detail;
	const activeTurn = detail.activeTurn;
	const activePhase = detail.activePhase;
	const providerRequestId = firstId(detail.providerRequests, "providerRequestId");
	const toolCallId = firstId(detail.toolCalls, "toolCallId");
	return [
		`pibo debug telemetry session ${result.piboSessionId}`,
		`status\t${activeTurn?.status ?? "idle"}`,
		`queueDepth\t${activeTurn?.queueDepth ?? "-"}`,
		`activeTurn\t${activeTurn?.turnId ?? "-"}`,
		`activePhase\t${formatPhaseRef(activePhase)}`,
		`lastProgressAt\t${activePhase?.lastProgressAt ?? activeTurn?.lastProgressAt ?? "-"}`,
		`staleForMs\t${formatAgeMs(activePhase?.lastProgressAt ?? activeTurn?.lastProgressAt)}`,
		`providerRequestId\t${providerRequestId ?? "-"}`,
		`toolCallId\t${toolCallId ?? "-"}`,
		"recent_turns:",
		formatRows(detail.recentTurns.map(compactTurnRow)),
		"providers:",
		formatRows(detail.providerRequests.map(compactProviderRow)),
		"tools:",
		formatRows(detail.toolCalls.map(compactToolRow)),
		`truncated\trecentTurns=${result.truncated.recentTurns}\tproviderRequests=${result.truncated.providerRequests}\ttoolCalls=${result.truncated.toolCalls}`,
		"Next:",
		...(result.nextCommands.length > 0 ? result.nextCommands.map((command) => `  ${command}`) : ["  pibo debug telemetry sessions"]),
	].join("\n");
}

export function formatTelemetryTurn(result: DebugTelemetryTurnResult): string {
	if (!result.available) return formatUnavailable(result);
	const timeline = result.timeline;
	const phaseRows = timeline.phases.map((phase) => compactPhaseRow(phase, result.includeEventRefs));
	return [
		`pibo debug telemetry turn ${timeline.turn.turnId}`,
		`session\t${timeline.turn.piboSessionId}`,
		`status\t${timeline.turn.status}`,
		`currentPhase\t${timeline.turn.currentPhase ?? "-"}`,
		`openPhases\t${result.openPhases}`,
		`missingTerminalEvent\t${result.missingTerminalEvent}`,
		"phases:",
		formatRows(phaseRows),
		"providers:",
		formatRows(timeline.providerRequests.map(compactProviderRow)),
		"tools:",
		formatRows(timeline.toolCalls.map(compactToolRow)),
		`truncated\tphases=${result.truncated.phases}\tproviderRequests=${result.truncated.providerRequests}\ttoolCalls=${result.truncated.toolCalls}`,
		"Next:",
		...(result.nextCommands.length > 0 ? result.nextCommands.map((command) => `  ${command}`) : [`  pibo debug telemetry session ${timeline.turn.piboSessionId}`]),
	].join("\n");
}

function withTelemetryStore<T>(store: ResolvedPiboDebugStore, action: (telemetry: TelemetryStore) => T): T | DebugTelemetryUnavailable {
	if (!store.exists) {
		return {
			available: false,
			reason: "store_missing",
			message: `Debug store "${store.name}" not found at ${store.path}`,
			nextCommands: ["pibo debug db stores"],
		};
	}
	const db = openReadOnlyDebugDatabase(store);
	try {
		const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'telemetry_%'").all() as Array<{ name: string }>;
		if (tables.length === 0) {
			return {
				available: false,
				reason: "tables_missing",
				message: "Telemetry tables are not present in pibo.sqlite; no telemetry is available for this store.",
				nextCommands: ["pibo debug db schema pibo-data"],
			};
		}
		return action(new PiboTelemetryStore(db));
	} finally {
		db.close();
	}
}

function parseTelemetryLimit(value: string | undefined): number {
	if (value === undefined) return DEFAULT_TELEMETRY_CLI_LIMIT;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Limit must be a positive integer");
	return Math.min(parsed, MAX_TELEMETRY_CLI_LIMIT);
}

function notFound(message: string, piboSessionId?: string, turnId?: string): DebugTelemetryUnavailable {
	return {
		available: false,
		reason: "not_found",
		message,
		nextCommands: [
			piboSessionId ? `pibo debug session ${piboSessionId}` : undefined,
			turnId ? "pibo debug telemetry sessions" : undefined,
			"pibo debug events <pibo-session-id> --limit 20",
		].filter((command): command is string => typeof command === "string"),
	};
}

function formatUnavailable(result: DebugTelemetryUnavailable): string {
	return [
		result.message,
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

function compactTurnRow(turn: StoredTelemetryTurn): Record<string, unknown> {
	return {
		turnId: turn.turnId,
		status: turn.status,
		currentPhase: turn.currentPhase,
		queuedAt: turn.queuedAt,
		startedAt: turn.startedAt,
		completedAt: turn.completedAt,
		lastProgressAt: turn.lastProgressAt,
		queueDepth: turn.queueDepth,
		next: `pibo debug telemetry turn ${turn.turnId}`,
	};
}

function compactPhaseRow(phase: StoredTelemetryPhase, includeEventRefs: boolean): Record<string, unknown> {
	return {
		phaseId: phase.phaseId,
		name: phase.name,
		status: phase.status,
		startedAt: phase.startedAt,
		endedAt: phase.endedAt ?? "open",
		durationMs: phase.durationMs,
		lastProgressAt: phase.lastProgressAt,
		staleForMs: formatAgeMs(phase.lastProgressAt ?? phase.startedAt),
		providerRequestId: phase.providerRequestId,
		toolCallId: phase.toolCallId,
		...(includeEventRefs ? { eventId: phase.eventId, eventStreamId: phase.eventStreamId, payloadRef: phase.payloadRef } : {}),
	};
}

function compactProviderRow(provider: StoredTelemetryProviderRequest): Record<string, unknown> {
	return {
		providerRequestId: provider.providerRequestId,
		status: provider.status,
		provider: provider.provider,
		api: provider.api,
		model: provider.model,
		firstByteAt: provider.firstByteAt,
		lastRawEventAt: provider.lastRawEventAt,
		lastNormalizedEventAt: provider.lastNormalizedEventAt,
		rawEventCount: provider.rawEventCount,
		parseErrorCount: provider.parseErrorCount,
		unknownEventCount: provider.unknownEventCount,
		next: `pibo debug telemetry provider ${provider.providerRequestId}`,
	};
}

function compactToolRow(tool: StoredTelemetryToolCall): Record<string, unknown> {
	return {
		toolCallId: tool.toolCallId,
		status: tool.status,
		toolName: tool.toolName,
		argsBytes: tool.argsBytes,
		parseStatus: tool.parseStatus,
		argsCompletedAt: tool.argsCompletedAt,
		executionStartedAt: tool.executionStartedAt,
		executionEndedAt: tool.executionEndedAt,
		next: `pibo debug telemetry tool ${tool.toolCallId}`,
	};
}

function formatPhaseRef(phase: StoredTelemetryPhase | undefined): string {
	return phase ? `${phase.name}:${phase.status}` : "-";
}

function formatAgeMs(timestamp: string | undefined): number | "-" {
	if (!timestamp) return "-";
	const parsed = Date.parse(timestamp);
	if (!Number.isFinite(parsed)) return "-";
	return Math.max(0, Date.now() - parsed);
}

function firstId<T extends Record<string, unknown>>(items: T[], key: keyof T): unknown {
	return items.length > 0 ? items[0]?.[key] : undefined;
}
