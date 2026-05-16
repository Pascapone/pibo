import { DatabaseSync } from "node:sqlite";
import type { ProviderAwareTelemetryStaleWorkItem } from "../core/telemetry-staleness.js";
import { TelemetryStaleDetector } from "../core/telemetry-staleness.js";
import type {
	StoredTelemetryPhase,
	StoredTelemetryProviderEvent,
	StoredTelemetryProviderRequest,
	StoredTelemetryToolCall,
	TelemetryPreviewUnavailableResult,
	TelemetryProviderEventsPage,
	StoredTelemetryTurn,
	TelemetryPruneResult,
	TelemetryRetentionClass,
	TelemetryRetentionStats,
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

export type DebugTelemetryProviderOptions = {
	limit?: string;
	after?: string;
	fields?: string[];
};

export type DebugTelemetryStaleOptions = {
	limit?: string;
	thresholdMs?: string;
};

export type DebugTelemetryStatsOptions = {
	retention?: string;
};

export type DebugTelemetryPruneOptions = {
	retention?: string;
	before?: string;
	apply?: boolean;
};

const DEFAULT_TELEMETRY_CLI_LIMIT = 20;
const MAX_TELEMETRY_CLI_LIMIT = 200;
const TELEMETRY_RETENTION_CLASSES: TelemetryRetentionClass[] = ["live", "diagnostic", "provider_event", "payload_preview", "incident"];

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

export type DebugTelemetryProviderResult = {
	available: true;
	command: "provider";
	providerRequestId: string;
	request: StoredTelemetryProviderRequest;
	eventTypeRows: Array<{ eventType: string; count: number }>;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryProviderEventsResult = {
	available: true;
	command: "provider events";
	providerRequestId: string;
	limit: number;
	afterSequence: number;
	requestedFields: string[];
	page: TelemetryProviderEventsPage;
	rows: Array<StoredTelemetryProviderEvent & { selectedSafeFields: Record<string, string | number | boolean | null> }>;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryProviderPayloadResult = {
	available: true;
	command: "provider payload";
	providerRequestId: string;
	payloadRef: string;
	preview: TelemetryPreviewUnavailableResult;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryToolResult = {
	available: true;
	command: "tool";
	toolCallId: string;
	tool: StoredTelemetryToolCall;
	noExecutionStart: boolean;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryStaleResult = {
	available: true;
	command: "stale";
	limit: number;
	thresholdOverrideMs?: number;
	rowCount: number;
	rows: ProviderAwareTelemetryStaleWorkItem[];
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryStatsResult = {
	available: true;
	command: "stats";
	retentionClass?: TelemetryRetentionClass;
	stats: TelemetryRetentionStats;
	nextCommands: string[];
} | DebugTelemetryUnavailable;

export type DebugTelemetryPruneResult = {
	available: true;
	command: "prune";
	retentionClass: TelemetryRetentionClass;
	before: string;
	dryRun: boolean;
	result: TelemetryPruneResult;
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

export function inspectTelemetryProvider(store: ResolvedPiboDebugStore, providerRequestId: string): DebugTelemetryProviderResult {
	return withTelemetryStore(store, (telemetry) => {
		const request = telemetry.getProviderRequest(providerRequestId);
		if (!request) return notFound(`No telemetry found for provider request ${providerRequestId}.`);
		return {
			available: true,
			command: "provider",
			providerRequestId,
			request,
			eventTypeRows: providerEventTypeRows(request),
			nextCommands: providerNextCommands(request),
		};
	});
}

export function inspectTelemetryProviderEvents(store: ResolvedPiboDebugStore, providerRequestId: string, options: DebugTelemetryProviderOptions = {}): DebugTelemetryProviderEventsResult {
	const limit = parseTelemetryLimit(options.limit);
	const afterSequence = parseTelemetryCursor(options.after);
	return withTelemetryStore(store, (telemetry) => {
		const request = telemetry.getProviderRequest(providerRequestId);
		if (!request) return notFound(`No telemetry found for provider request ${providerRequestId}.`);
		const requestedFields = normalizeSafeFields(options.fields);
		const page = telemetry.listProviderEventsPage(providerRequestId, { limit, afterSequence });
		const rows = page.rows.map((row) => ({
			...row,
			selectedSafeFields: selectSafeFields(row.safeFields, requestedFields),
		}));
		return {
			available: true,
			command: "provider events",
			providerRequestId,
			limit,
			afterSequence,
			requestedFields,
			page,
			rows,
			nextCommands: providerNextCommands(request, page.nextAfterSequence),
		};
	});
}

export function inspectTelemetryProviderPayload(store: ResolvedPiboDebugStore, providerRequestId: string, payloadRef: string): DebugTelemetryProviderPayloadResult {
	return withTelemetryStore(store, (telemetry) => {
		const request = telemetry.getProviderRequest(providerRequestId);
		if (!request) return notFound(`No telemetry found for provider request ${providerRequestId}.`);
		return {
			available: true,
			command: "provider payload",
			providerRequestId,
			payloadRef,
			preview: telemetry.getPayloadPreview(payloadRef),
			nextCommands: providerNextCommands(request),
		};
	});
}

export function inspectTelemetryTool(store: ResolvedPiboDebugStore, toolCallId: string): DebugTelemetryToolResult {
	return withTelemetryStore(store, (telemetry) => {
		const tool = telemetry.getToolCall(toolCallId);
		if (!tool) return notFound(`No telemetry found for tool call ${toolCallId}.`);
		return {
			available: true,
			command: "tool",
			toolCallId,
			tool,
			noExecutionStart: !tool.executionStartedAt,
			nextCommands: toolNextCommands(tool),
		};
	});
}

export function inspectTelemetryStale(store: ResolvedPiboDebugStore, options: DebugTelemetryStaleOptions = {}): DebugTelemetryStaleResult {
	const limit = parseTelemetryLimit(options.limit);
	const thresholdOverrideMs = parseTelemetryThresholdMs(options.thresholdMs);
	return withTelemetryStore(store, (telemetry) => {
		const detector = new TelemetryStaleDetector(telemetry);
		const rows = detector.listStaleWork({ limit, thresholdMs: thresholdOverrideMs });
		return {
			available: true,
			command: "stale",
			limit,
			thresholdOverrideMs,
			rowCount: rows.length,
			rows,
			nextCommands: ["pibo debug telemetry sessions --active", "pibo debug telemetry session <pibo-session-id>"],
		};
	});
}

export function inspectTelemetryStats(store: ResolvedPiboDebugStore, options: DebugTelemetryStatsOptions = {}): DebugTelemetryStatsResult {
	const retentionClass = options.retention ? parseTelemetryRetentionClass(options.retention) : undefined;
	return withTelemetryStore(store, (telemetry) => {
		const stats = telemetry.getStats();
		const filteredStats = retentionClass
			? {
				rows: stats.rows.filter((row) => row.retentionClass === retentionClass),
				totalRows: stats.rows.filter((row) => row.retentionClass === retentionClass).reduce((sum, row) => sum + row.rowCount, 0),
				totalBytes: stats.rows.filter((row) => row.retentionClass === retentionClass).reduce((sum, row) => sum + row.byteCount, 0),
			}
			: stats;
		return {
			available: true,
			command: "stats",
			retentionClass,
			stats: filteredStats,
			nextCommands: ["pibo debug telemetry prune --retention diagnostic --before <iso-date>", "pibo debug telemetry sessions --active"],
		};
	});
}

export function inspectTelemetryPrune(store: ResolvedPiboDebugStore, options: DebugTelemetryPruneOptions = {}): DebugTelemetryPruneResult {
	if (!options.retention) throw new Error("pibo debug telemetry prune requires --retention <class>");
	if (!options.before) throw new Error("pibo debug telemetry prune requires --before <iso-date>");
	const retentionClass = parseTelemetryRetentionClass(options.retention);
	const before = parseTelemetryBefore(options.before);
	return withTelemetryStore(store, (telemetry) => {
		const result = telemetry.prune({ retentionClass, before, apply: options.apply === true });
		return {
			available: true,
			command: "prune",
			retentionClass,
			before,
			dryRun: options.apply !== true,
			result,
			nextCommands: ["pibo debug telemetry stats", "pibo debug telemetry sessions --active"],
		};
	}, { readOnly: false });
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

export function formatTelemetryProvider(result: DebugTelemetryProviderResult): string {
	if (!result.available) return formatUnavailable(result);
	const request = result.request;
	return [
		`pibo debug telemetry provider ${result.providerRequestId}`,
		`session\t${request.piboSessionId}`,
		`turn\t${request.turnId}`,
		`phase\t${request.phaseId ?? "-"}`,
		`status\t${request.status}`,
		`provider\t${request.provider}`,
		`api\t${request.api}`,
		`model\t${request.model}`,
		`transport\t${request.transport}`,
		`serviceTier\t${request.serviceTier ?? "-"}`,
		`httpStatus\t${request.httpStatus ?? "-"}`,
		`startedAt\t${request.startedAt}`,
		`responseHeadersAt\t${request.responseHeadersAt ?? "-"}`,
		`firstByteAt\t${request.firstByteAt ?? "-"}`,
		`lastRawEventAt\t${request.lastRawEventAt ?? "-"}`,
		`lastNormalizedEventAt\t${request.lastNormalizedEventAt ?? "-"}`,
		`completedAt\t${request.completedAt ?? "-"}`,
		`upstreamResponseId\t${request.upstreamResponseId ?? "-"}`,
		`captureMode\t${request.captureMode}`,
		`rawEventCount\t${request.rawEventCount}`,
		`normalizedEventCount\t${request.normalizedEventCount}`,
		`parseErrorCount\t${request.parseErrorCount}`,
		`unknownEventCount\t${request.unknownEventCount}`,
		`bytesReceived\t${request.bytesReceived ?? 0}`,
		"event_types:",
		formatRows(result.eventTypeRows),
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryProviderEvents(result: DebugTelemetryProviderEventsResult): string {
	if (!result.available) return formatUnavailable(result);
	return [
		`pibo debug telemetry provider ${result.providerRequestId} events`,
		`limit\t${result.limit}`,
		`afterSequence\t${result.afterSequence}`,
		`storageMode\t${result.page.storageMode}`,
		`hasMore\t${result.page.hasMore}`,
		`nextAfterSequence\t${result.page.nextAfterSequence ?? "-"}`,
		`fields\t${result.requestedFields.length > 0 ? result.requestedFields.join(",") : "all-safe"}`,
		formatRows(result.rows.map(compactProviderEventRow)),
		`truncated\t${result.page.truncated}`,
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryProviderPayload(result: DebugTelemetryProviderPayloadResult): string {
	if (!result.available) return formatUnavailable(result);
	return [
		`pibo debug telemetry provider ${result.providerRequestId} payload ${result.payloadRef}`,
		`status\t${result.preview.status}`,
		`reason\t${result.preview.reason}`,
		`captureMode\t${result.preview.captureMode}`,
		result.preview.message,
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryTool(result: DebugTelemetryToolResult): string {
	if (!result.available) return formatUnavailable(result);
	const tool = result.tool;
	return [
		`pibo debug telemetry tool ${result.toolCallId}`,
		`session\t${tool.piboSessionId}`,
		`turn\t${tool.turnId}`,
		`providerRequestId\t${tool.providerRequestId ?? "-"}`,
		`toolName\t${tool.toolName}`,
		`status\t${tool.status}`,
		`argsBytes\t${tool.argsBytes}`,
		`parseStatus\t${tool.parseStatus}`,
		`safeArgKeys\t${tool.safeArgKeys.length > 0 ? tool.safeArgKeys.join(",") : "-"}`,
		`argsStartedAt\t${tool.argsStartedAt ?? "-"}`,
		`firstDeltaAt\t${tool.firstDeltaAt ?? "-"}`,
		`lastDeltaAt\t${tool.lastDeltaAt ?? "-"}`,
		`argsCompletedAt\t${tool.argsCompletedAt ?? "-"}`,
		`executionStartedAt\t${tool.executionStartedAt ?? "-"}`,
		`executionEndedAt\t${tool.executionEndedAt ?? "-"}`,
		`durationMs\t${tool.durationMs ?? "-"}`,
		`noExecutionStart\t${result.noExecutionStart}`,
		`runId\t${tool.runId ?? "-"}`,
		`errorCategory\t${tool.errorCategory ?? "-"}`,
		`errorMessage\t${tool.errorMessage ?? "-"}`,
		`eventId\t${tool.eventId ?? "-"}`,
		`eventStreamId\t${tool.eventStreamId ?? "-"}`,
		`payloadRef\t${tool.payloadRef ?? "-"}`,
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryStale(result: DebugTelemetryStaleResult): string {
	if (!result.available) return formatUnavailable(result);
	return [
		"pibo debug telemetry stale",
		`limit\t${result.limit}`,
		`thresholdOverrideMs\t${result.thresholdOverrideMs ?? "-"}`,
		formatRows(result.rows.map(compactStaleRow)),
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryStats(result: DebugTelemetryStatsResult): string {
	if (!result.available) return formatUnavailable(result);
	return [
		"pibo debug telemetry stats",
		`retentionClass\t${result.retentionClass ?? "all"}`,
		`totalRows\t${result.stats.totalRows}`,
		`totalBytes\t${result.stats.totalBytes}`,
		formatRows(result.stats.rows),
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

export function formatTelemetryPrune(result: DebugTelemetryPruneResult): string {
	if (!result.available) return formatUnavailable(result);
	return [
		"pibo debug telemetry prune",
		`retentionClass\t${result.retentionClass}`,
		`before\t${result.before}`,
		`dryRun\t${result.dryRun}`,
		formatRows([result.result]),
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	].join("\n");
}

function withTelemetryStore<T>(store: ResolvedPiboDebugStore, action: (telemetry: TelemetryStore) => T, options: { readOnly?: boolean } = {}): T | DebugTelemetryUnavailable {
	if (!store.exists) {
		return {
			available: false,
			reason: "store_missing",
			message: `Debug store "${store.name}" not found at ${store.path}`,
			nextCommands: ["pibo debug db stores"],
		};
	}
	const db = options.readOnly === false ? openWritableDebugDatabase(store) : openReadOnlyDebugDatabase(store);
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

function openWritableDebugDatabase(store: ResolvedPiboDebugStore): DatabaseSync {
	if (!store.exists) throw new Error(`Debug store "${store.name}" not found at ${store.path}`);
	const db = new DatabaseSync(store.path);
	db.exec("PRAGMA busy_timeout = 5000");
	return db;
}

function parseTelemetryLimit(value: string | undefined): number {
	if (value === undefined) return DEFAULT_TELEMETRY_CLI_LIMIT;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Limit must be a positive integer");
	return Math.min(parsed, MAX_TELEMETRY_CLI_LIMIT);
}

function parseTelemetryThresholdMs(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--threshold-ms must be a positive integer");
	return parsed;
}

function parseTelemetryRetentionClass(value: string): TelemetryRetentionClass {
	if (TELEMETRY_RETENTION_CLASSES.includes(value as TelemetryRetentionClass)) return value as TelemetryRetentionClass;
	throw new Error(`Unknown telemetry retention class "${value}". Use one of: ${TELEMETRY_RETENTION_CLASSES.join(", ")}`);
}

function parseTelemetryBefore(value: string): string {
	if (!Number.isFinite(Date.parse(value))) throw new Error("--before must be a valid ISO date/time");
	return value;
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

function compactProviderEventRow(event: StoredTelemetryProviderEvent & { selectedSafeFields: Record<string, string | number | boolean | null> }): Record<string, unknown> {
	return {
		sequence: event.sequence,
		rawEventId: event.rawEventId,
		receivedAt: event.receivedAt,
		eventType: event.eventType,
		byteSize: event.byteSize,
		parseStatus: event.parseStatus,
		normalizedType: event.normalizedType,
		itemId: event.itemId,
		toolCallId: event.toolCallId,
		eventId: event.eventId,
		eventStreamId: event.eventStreamId,
		payloadPreviewRef: event.payloadPreviewRef,
		safeFields: formatSafeFields(event.selectedSafeFields),
	};
}

function compactStaleRow(item: ProviderAwareTelemetryStaleWorkItem): Record<string, unknown> {
	return {
		piboSessionId: item.piboSessionId,
		turnId: item.turnId,
		activePhase: item.activePhase ?? item.phase,
		staleForMs: item.staleForMs,
		lastProgressAt: item.lastProgressAt,
		queueDepth: item.queueDepth,
		appliedThresholdMs: item.appliedThresholdMs,
		thresholdSource: item.thresholdSource,
		thresholdKey: item.thresholdKey,
		provider: item.provider,
		model: item.model,
		profile: item.profile,
		next: item.nextCommands[0],
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

function parseTelemetryCursor(value: string | undefined): number {
	if (value === undefined) return -1;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--after must be a non-negative provider event sequence");
	return parsed;
}

const SAFE_FIELD_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function normalizeSafeFields(fields: string[] | undefined): string[] {
	return [...new Set((fields ?? []).filter((field) => SAFE_FIELD_NAME_PATTERN.test(field)))];
}

function selectSafeFields(value: Record<string, unknown>, requestedFields: string[]): Record<string, string | number | boolean | null> {
	const selected: Record<string, string | number | boolean | null> = {};
	const entries = requestedFields.length > 0
		? requestedFields.map((field) => [field, value[field]] as const)
		: Object.entries(value).slice(0, 20);
	for (const [key, raw] of entries) {
		if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) selected[key] = raw;
	}
	return selected;
}

function formatSafeFields(value: Record<string, string | number | boolean | null>): string {
	const entries = Object.entries(value);
	if (entries.length === 0) return "-";
	return entries.map(([key, raw]) => `${key}=${String(raw)}`).join(",");
}

function providerEventTypeRows(provider: StoredTelemetryProviderRequest): Array<{ eventType: string; count: number }> {
	return Object.entries(provider.eventTypeCounts)
		.filter((entry): entry is [string, number] => typeof entry[1] === "number")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([eventType, count]) => ({ eventType, count }));
}

function providerNextCommands(provider: StoredTelemetryProviderRequest, nextAfterSequence?: number): string[] {
	return [
		`pibo debug telemetry turn ${provider.turnId}`,
		`pibo debug telemetry provider ${provider.providerRequestId} events --limit 20`,
		typeof nextAfterSequence === "number" ? `pibo debug telemetry provider ${provider.providerRequestId} events --after ${nextAfterSequence} --limit 20` : undefined,
		`pibo debug telemetry session ${provider.piboSessionId}`,
	].filter((command): command is string => typeof command === "string");
}

function toolNextCommands(tool: StoredTelemetryToolCall): string[] {
	return [
		`pibo debug telemetry turn ${tool.turnId}`,
		tool.providerRequestId ? `pibo debug telemetry provider ${tool.providerRequestId}` : undefined,
		tool.providerRequestId ? `pibo debug telemetry provider ${tool.providerRequestId} events --limit 20` : undefined,
		`pibo debug telemetry session ${tool.piboSessionId}`,
	].filter((command): command is string => typeof command === "string");
}
