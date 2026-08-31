import { DatabaseSync } from "node:sqlite";
import type { AgentRuntimeHistoryEntry } from "../agent-runtime/history.js";
import { isPiboOutputEvent, type PiboEventSource, type PiboJsonObject, type PiboJsonValue, type PiboOutputEvent } from "../core/events.js";
import { ChatDataIngestService } from "../data/ingest-service.js";
import { PiboDataStore } from "../data/pibo-store.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { RuntimeSessionBinding } from "../sessions/runtime-binding.js";
import { PiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { ResolvedPiboDebugStore } from "./stores.js";

const EVENT_SOURCES = new Set<PiboEventSource>(["user", "ui", "service", "actor"]);
const REPAIR_LIMIT_MAX = 100;
const RELIABILITY_SCAN_LIMIT = 5000;

type TurnCountsRow = {
	messageStarted: number;
	assistantMessages: number;
	messageFinished: number;
	sessionErrors: number;
	identityCollisions: number;
};

type CountRow = { count: number | bigint };
type SourceRow = { source: string | null };
type RoomRow = { roomId: string | null };
type SessionRow = { status: string; workspace: string | null; created_at: string; updated_at: string; pi_session_id: string | null };
type CandidateRow = { eventId: string; startedAt: string };
type ReliabilityPayloadRow = { jobId: string; payloadJson: string };

export type OutputRepairEvidenceSource = "reliability_payload" | "pibo_product_history" | "adapter_history";

export type OutputRepairAdapterEvidence = {
	available: boolean;
	entries: readonly AgentRuntimeHistoryEntry[];
	error?: string;
};

type ReliabilityEvidence = {
	terminalEvents: Array<{ event: PiboOutputEvent; reference: string }>;
	references: string[];
};

export type OutputTurnRepairInspection = {
	piboSessionId: string;
	eventId: string;
	sessionExists: boolean;
	repairable: boolean;
	reason?:
		| "session_not_found"
		| "session_active"
		| "message_start_missing"
		| "message_start_duplicated"
		| "already_terminal"
		| "lifecycle_open"
		| "evidence_missing"
		| "evidence_conflict";
	plannedEvent?: {
		type: "message_finished" | "session_error";
		source?: PiboEventSource;
		evidenceSources: OutputRepairEvidenceSource[];
	};
	evidence: Array<{
		source: OutputRepairEvidenceSource;
		kind: "exact_terminal" | "completed_assistant" | "running_entry";
		count: number;
		references: string[];
	}>;
	observed: {
		sessionStatus?: string;
		messageStarted: number;
		assistantMessages: number;
		productAssistantMessages: number;
		messageFinished: number;
		sessionErrors: number;
		openThinkingParts: number;
		openToolInvocations: number;
		identityCollisions: number;
		reliabilityTerminalCandidates: number;
		adapterCompletedAssistantMessages: number;
		adapterRunningEntries: number;
	};
};

export type OutputTurnRepairResult = {
	resultType: "debug.repair.output";
	mode: "dry-run" | "apply";
	applied: boolean;
	store: { path: string; exists: boolean };
	inspection: OutputTurnRepairInspection;
	persisted?: {
		type: "message_finished" | "session_error";
		streamId: number;
		duplicate: boolean;
		auditStreamId: number;
	};
	warnings: string[];
	nextCommands: string[];
};

export type OutputRepairScopeResult = {
	resultType: "debug.repair.output.scope";
	mode: "dry-run" | "apply";
	scope: { piboSessionId: string; since?: string; before?: string; limit: number };
	candidateCount: number;
	repairableCount: number;
	appliedCount: number;
	results: OutputTurnRepairResult[];
	warnings: string[];
	nextCommands: string[];
};

type InternalRepairPlan = {
	inspection: OutputTurnRepairInspection;
	terminalEvent?: PiboOutputEvent;
	evidenceReferences: string[];
};

export function inspectOutputTurnRepair(input: {
	store: ResolvedPiboDebugStore;
	reliabilityStore?: ResolvedPiboDebugStore;
	piboSessionId: string;
	eventId: string;
	adapterEvidence?: OutputRepairAdapterEvidence;
}): OutputTurnRepairInspection {
	return buildRepairPlan(input).inspection;
}

export function repairOutputTurn(input: {
	store: ResolvedPiboDebugStore;
	reliabilityStore?: ResolvedPiboDebugStore;
	piboSessionId: string;
	eventId: string;
	adapterEvidence?: OutputRepairAdapterEvidence;
	apply?: boolean;
	now?: () => string;
}): OutputTurnRepairResult {
	const mode: OutputTurnRepairResult["mode"] = input.apply ? "apply" : "dry-run";
	const reliabilityEvidence = collectReliabilityEvidence(input.reliabilityStore, input.piboSessionId, input.eventId);
	const initial = buildRepairPlan(input, reliabilityEvidence);
	const base = resultBase(input.store, input.piboSessionId, mode);
	if (!input.apply || !initial.inspection.repairable || !initial.terminalEvent) {
		return { ...base, applied: false, inspection: initial.inspection };
	}

	const data = new PiboDataStore(input.store.path);
	try {
		return data.transaction(() => {
			const current = buildRepairPlanFromDb(data.db, input.piboSessionId, input.eventId, reliabilityEvidence, input.adapterEvidence);
			if (!current.inspection.repairable || !current.terminalEvent) {
				return { ...base, applied: false, inspection: current.inspection };
			}
			const sessionStore = new PiboDataSessionStore(data);
			const session = sessionStore.get(input.piboSessionId);
			if (!session) {
				return {
					...base,
					applied: false,
					inspection: { ...current.inspection, repairable: false, reason: "session_not_found" as const },
				};
			}
			const room = data.db.prepare("SELECT room_id AS roomId FROM sessions WHERE id = ?").get(input.piboSessionId) as RoomRow | undefined;
			const createdAt = input.now?.() ?? new Date().toISOString();
			const persisted = new ChatDataIngestService(data).ingestOutputEvent({
				session,
				...(room?.roomId ? { roomId: room.roomId } : {}),
				actorId: "pibo-debug-repair",
				event: current.terminalEvent,
				createdAt,
			});
			const audit = data.eventLog.appendEvent({
				sessionId: input.piboSessionId,
				sessionSequence: nextEventSequence(data.db, input.piboSessionId),
				...(room?.roomId ? { roomId: room.roomId } : {}),
				topic: "pibo.audit",
				type: "pibo.output.repair_applied",
				source: "pibo-debug-repair",
				actorType: "system",
				actorId: "pibo-debug-repair",
				eventId: input.eventId,
				idempotencyKey: `pibo.output.repair:${input.piboSessionId}:${input.eventId}:${current.terminalEvent.type}`,
				retentionClass: "audit_event",
				previewText: `Output repair applied ${current.terminalEvent.type}`,
				attributes: {
					repairVersion: 1,
					targetEventId: input.eventId,
					terminalType: current.terminalEvent.type,
					terminalStreamId: persisted.streamId,
					evidenceSources: current.inspection.plannedEvent?.evidenceSources ?? [],
					evidenceReferences: current.evidenceReferences,
				} as PiboJsonObject,
				createdAt,
				indexedAt: createdAt,
			});
			return {
				...base,
				applied: true,
				inspection: current.inspection,
				persisted: {
					type: current.terminalEvent.type,
					streamId: persisted.streamId,
					duplicate: persisted.duplicate,
					auditStreamId: audit.streamId,
				},
			};
		});
	} finally {
		data.close();
	}
}

export function repairOutputTurns(input: {
	store: ResolvedPiboDebugStore;
	reliabilityStore?: ResolvedPiboDebugStore;
	piboSessionId: string;
	since?: string;
	before?: string;
	limit?: string | number;
	adapterEvidence?: OutputRepairAdapterEvidence;
	apply?: boolean;
	now?: () => string;
}): OutputRepairScopeResult {
	if (!input.store.exists) throw new Error(`Debug store "pibo-data" not found at ${input.store.path}`);
	const limit = normalizeRepairLimit(input.limit);
	const db = new DatabaseSync(input.store.path, { readOnly: true });
	let candidates: CandidateRow[];
	try {
		const clauses = ["session_id = ?", "type = 'message_started'", "event_id IS NOT NULL"];
		const params: Array<string | number> = [input.piboSessionId];
		if (input.since) { clauses.push("created_at >= ?"); params.push(input.since); }
		if (input.before) { clauses.push("created_at < ?"); params.push(input.before); }
		candidates = db.prepare(`
			SELECT event_id AS eventId, MIN(created_at) AS startedAt
			FROM event_log
			WHERE ${clauses.join(" AND ")}
			GROUP BY event_id
			ORDER BY startedAt ASC
			LIMIT ?
		`).all(...params, limit) as CandidateRow[];
	} finally {
		db.close();
	}
	const results = candidates.map((candidate) => repairOutputTurn({
		store: input.store,
		reliabilityStore: input.reliabilityStore,
		piboSessionId: input.piboSessionId,
		eventId: candidate.eventId,
		adapterEvidence: input.adapterEvidence,
		apply: input.apply,
		now: input.now,
	}));
	const mode = input.apply ? "apply" : "dry-run";
	return {
		resultType: "debug.repair.output.scope",
		mode,
		scope: {
			piboSessionId: input.piboSessionId,
			...(input.since ? { since: input.since } : {}),
			...(input.before ? { before: input.before } : {}),
			limit,
		},
		candidateCount: results.length,
		repairableCount: results.filter((result) => result.inspection.repairable).length,
		appliedCount: results.filter((result) => result.applied).length,
		results,
		warnings: resultWarnings(),
		nextCommands: resultNextCommands(input.piboSessionId),
	};
}

export async function readOutputRepairAdapterEvidence(input: {
	store: ResolvedPiboDebugStore;
	piboSessionId: string;
}): Promise<OutputRepairAdapterEvidence> {
	if (!input.store.exists) return { available: false, entries: [] };
	const db = new DatabaseSync(input.store.path, { readOnly: true });
	try {
		const session = db.prepare("SELECT status, workspace, created_at, updated_at, pi_session_id FROM sessions WHERE id = ?").get(input.piboSessionId) as SessionRow | undefined;
		if (!session) return { available: false, entries: [] };
		const binding = readRuntimeBinding(db, input.piboSessionId, session);
		if (!binding) return { available: false, entries: [] };
		const adapter = createDefaultPiboPluginRegistry().getAgentRuntimeAdapter(binding.runtimeInstanceId);
		if (!adapter?.descriptor.capabilities.maintenance.history || !adapter.readHistory) {
			return { available: false, entries: [] };
		}
		try {
			const page = await adapter.readHistory({ binding, workspace: session.workspace ?? process.cwd(), limit: 500 });
			return { available: true, entries: page.entries };
		} catch (error) {
			return { available: false, entries: [], error: redactError(error) };
		}
	} finally {
		db.close();
	}
}

export function formatOutputTurnRepair(result: OutputTurnRepairResult | OutputRepairScopeResult): string {
	if (result.resultType === "debug.repair.output.scope") {
		const lines = [
			"pibo debug repair output",
			`mode\t${result.mode}`,
			`session\t${result.scope.piboSessionId}`,
			...(result.scope.since ? [`since\t${result.scope.since}`] : []),
			...(result.scope.before ? [`before\t${result.scope.before}`] : []),
			`candidates\t${result.candidateCount}`,
			`repairable\t${result.repairableCount}`,
			`applied\t${result.appliedCount}`,
			...result.results.map((item) => `${item.inspection.eventId}\t${item.applied ? "applied" : item.inspection.repairable ? "repairable" : item.inspection.reason ?? "not-repairable"}`),
			"",
			...result.warnings.map((warning) => `warning\t${warning}`),
			"",
			"Next:",
			...result.nextCommands.map((command) => `  ${command}`),
		];
		return lines.join("\n");
	}
	const inspection = result.inspection;
	const lines = [
		"pibo debug repair output",
		`mode\t${result.mode}`,
		`applied\t${result.applied}`,
		`session\t${inspection.piboSessionId}`,
		`event\t${inspection.eventId}`,
		`repairable\t${inspection.repairable}`,
		...(inspection.reason ? [`reason\t${inspection.reason}`] : []),
		...(inspection.plannedEvent ? [`plannedEvent\t${inspection.plannedEvent.type}`, `evidenceSources\t${inspection.plannedEvent.evidenceSources.join(",")}`] : []),
		`messageStarted\t${inspection.observed.messageStarted}`,
		`assistantMessages\t${inspection.observed.assistantMessages}`,
		`productAssistantMessages\t${inspection.observed.productAssistantMessages}`,
		`messageFinished\t${inspection.observed.messageFinished}`,
		`sessionErrors\t${inspection.observed.sessionErrors}`,
		`openThinkingParts\t${inspection.observed.openThinkingParts}`,
		`openToolInvocations\t${inspection.observed.openToolInvocations}`,
		`identityCollisions\t${inspection.observed.identityCollisions}`,
		`reliabilityTerminalCandidates\t${inspection.observed.reliabilityTerminalCandidates}`,
		`adapterCompletedAssistantMessages\t${inspection.observed.adapterCompletedAssistantMessages}`,
		...(result.persisted ? [`persisted\t${result.persisted.type}@${result.persisted.streamId}`, `audit\t${result.persisted.auditStreamId}`] : []),
		"",
		...result.warnings.map((warning) => `warning\t${warning}`),
		"",
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	];
	return lines.join("\n");
}

function buildRepairPlan(input: {
	store: ResolvedPiboDebugStore;
	reliabilityStore?: ResolvedPiboDebugStore;
	piboSessionId: string;
	eventId: string;
	adapterEvidence?: OutputRepairAdapterEvidence;
}, reliabilityEvidence = collectReliabilityEvidence(input.reliabilityStore, input.piboSessionId, input.eventId)): InternalRepairPlan {
	if (!input.store.exists) throw new Error(`Debug store "pibo-data" not found at ${input.store.path}`);
	const db = new DatabaseSync(input.store.path, { readOnly: true });
	try {
		return buildRepairPlanFromDb(db, input.piboSessionId, input.eventId, reliabilityEvidence, input.adapterEvidence);
	} finally {
		db.close();
	}
}

function buildRepairPlanFromDb(
	db: DatabaseSync,
	piboSessionId: string,
	eventId: string,
	reliability: ReliabilityEvidence,
	adapterEvidence?: OutputRepairAdapterEvidence,
): InternalRepairPlan {
	const session = db.prepare("SELECT status, workspace, created_at, updated_at, pi_session_id FROM sessions WHERE id = ? AND deleted_at IS NULL").get(piboSessionId) as SessionRow | undefined;
	const counts = db.prepare(`
		SELECT
			SUM(type = 'message_started') AS messageStarted,
			SUM(type = 'assistant_message') AS assistantMessages,
			SUM(type = 'message_finished') AS messageFinished,
			SUM(type = 'session_error') AS sessionErrors,
			SUM(type = 'pibo.output.identity_collision') AS identityCollisions
		FROM event_log
		WHERE session_id = ? AND event_id = ?
	`).get(piboSessionId, eventId) as TurnCountsRow;
	const productAssistantMessages = tableExists(db, "chat_messages")
		? Number((db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND turn_id = ? AND role = 'assistant' AND status = 'complete'").get(piboSessionId, eventId) as CountRow).count)
		: 0;
	const productRunningMessages = tableExists(db, "chat_messages")
		? Number((db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND turn_id = ? AND role = 'assistant' AND status IN ('running', 'streaming')").get(piboSessionId, eventId) as CountRow).count)
		: 0;
	const adapterEntries = (adapterEvidence?.entries ?? []).filter((entry) => entry.type === "message" && entry.turnId === eventId);
	const adapterCompleted = adapterEntries.filter((entry) => entry.type === "message" && entry.role === "assistant" && entry.status !== "running" && entry.status !== "error");
	const adapterRunning = adapterEntries.filter((entry) => entry.type === "message" && entry.status === "running");
	const observed = {
		...(session?.status ? { sessionStatus: session.status } : {}),
		messageStarted: Number(counts.messageStarted ?? 0),
		assistantMessages: Number(counts.assistantMessages ?? 0),
		productAssistantMessages,
		messageFinished: Number(counts.messageFinished ?? 0),
		sessionErrors: Number(counts.sessionErrors ?? 0),
		openThinkingParts: countOpenThinkingParts(db, piboSessionId, eventId),
		openToolInvocations: countOpenToolInvocations(db, piboSessionId, eventId),
		identityCollisions: Number(counts.identityCollisions ?? 0),
		reliabilityTerminalCandidates: reliability.terminalEvents.length,
		adapterCompletedAssistantMessages: adapterCompleted.length,
		adapterRunningEntries: adapterRunning.length,
	};
	const evidence: OutputTurnRepairInspection["evidence"] = [];
	if (reliability.terminalEvents.length) evidence.push({ source: "reliability_payload", kind: "exact_terminal", count: reliability.terminalEvents.length, references: reliability.references });
	const productCompleted = observed.assistantMessages + productAssistantMessages;
	if (productCompleted) evidence.push({ source: "pibo_product_history", kind: "completed_assistant", count: productCompleted, references: productReferences(db, piboSessionId, eventId) });
	if (adapterCompleted.length) evidence.push({ source: "adapter_history", kind: "completed_assistant", count: adapterCompleted.length, references: adapterCompleted.map((entry) => entry.id).slice(0, 20) });
	if (adapterRunning.length) evidence.push({ source: "adapter_history", kind: "running_entry", count: adapterRunning.length, references: adapterRunning.map((entry) => entry.id).slice(0, 20) });
	if (productRunningMessages) evidence.push({ source: "pibo_product_history", kind: "running_entry", count: productRunningMessages, references: [] });
	const base = { piboSessionId, eventId, sessionExists: Boolean(session), observed, evidence };
	const refuse = (reason: NonNullable<OutputTurnRepairInspection["reason"]>): InternalRepairPlan => ({
		inspection: { ...base, repairable: false, reason },
		evidenceReferences: [],
	});
	if (!session) return refuse("session_not_found");
	if (session.status === "running") return refuse("session_active");
	if (observed.messageStarted === 0) return refuse("message_start_missing");
	if (observed.messageStarted !== 1) return refuse("message_start_duplicated");
	if (observed.messageFinished + observed.sessionErrors > 0) return refuse("already_terminal");
	if (adapterRunning.length || productRunningMessages) return refuse("session_active");

	const exactTerminal = uniqueReliabilityTerminal(reliability.terminalEvents.map((item) => item.event));
	if (exactTerminal === "conflict") return refuse("evidence_conflict");
	if (exactTerminal) {
		const sources: OutputRepairEvidenceSource[] = ["reliability_payload"];
		return {
			inspection: {
				...base,
				repairable: true,
				plannedEvent: {
					type: exactTerminal.type,
					...(exactTerminal.type === "message_finished" && "source" in exactTerminal && exactTerminal.source ? { source: exactTerminal.source } : {}),
					evidenceSources: sources,
				},
			},
			terminalEvent: exactTerminal,
			evidenceReferences: reliability.references,
		};
	}
	if (observed.openThinkingParts || observed.openToolInvocations) return refuse("lifecycle_open");
	const completedSources: OutputRepairEvidenceSource[] = [];
	if (productCompleted) completedSources.push("pibo_product_history");
	if (adapterCompleted.length) completedSources.push("adapter_history");
	if (!completedSources.length) return refuse("evidence_missing");
	const source = messageSource(db, piboSessionId, eventId);
	const terminalEvent: PiboOutputEvent = { type: "message_finished", piboSessionId, eventId, ...source };
	return {
		inspection: {
			...base,
			repairable: true,
			plannedEvent: { type: "message_finished", ...source, evidenceSources: completedSources },
		},
		terminalEvent,
		evidenceReferences: evidence.flatMap((item) => item.references).slice(0, 50),
	};
}

function collectReliabilityEvidence(store: ResolvedPiboDebugStore | undefined, piboSessionId: string, eventId: string): ReliabilityEvidence {
	if (!store?.exists) return { terminalEvents: [], references: [] };
	const db = new DatabaseSync(store.path, { readOnly: true });
	try {
		const rows: Array<ReliabilityPayloadRow & { table: string }> = [];
		for (const table of ["pibo_jobs", "pibo_dead_jobs"]) {
			if (!tableExists(db, table)) continue;
			const tableRows = db.prepare(`
				SELECT job_id AS jobId, payload_json AS payloadJson
				FROM ${table}
				WHERE queue IN ('output-persistence', 'output-persistence-cli')
				ORDER BY updated_at DESC
				LIMIT ?
			`).all(RELIABILITY_SCAN_LIMIT) as ReliabilityPayloadRow[];
			rows.push(...tableRows.map((row) => ({ ...row, table })));
		}
		const terminalEvents: ReliabilityEvidence["terminalEvents"] = [];
		for (const row of rows) {
			const payload = parseJson(row.payloadJson);
			for (const event of outputEventsInPayload(payload)) {
				if (event.piboSessionId !== piboSessionId || !("eventId" in event) || event.eventId !== eventId) continue;
				if (event.type !== "message_finished" && event.type !== "session_error") continue;
				terminalEvents.push({ event, reference: `${row.table}:${row.jobId}` });
			}
		}
		return {
			terminalEvents,
			references: [...new Set(terminalEvents.map((item) => item.reference))].slice(0, 50),
		};
	} finally {
		db.close();
	}
}

function outputEventsInPayload(value: PiboJsonValue | undefined): PiboOutputEvent[] {
	const found: PiboOutputEvent[] = [];
	let visited = 0;
	const visit = (candidate: unknown, depth: number): void => {
		if (depth > 8 || visited >= 2000 || candidate === null || typeof candidate !== "object") return;
		visited += 1;
		if (isPiboOutputEvent(candidate)) { found.push(candidate); return; }
		if (Array.isArray(candidate)) {
			for (const item of candidate.slice(0, 500)) visit(item, depth + 1);
			return;
		}
		const record = candidate as Record<string, unknown>;
		for (const key of ["event", "deliveries", "state", "payload"]) {
			if (key in record) visit(record[key], depth + 1);
		}
	};
	visit(value, 0);
	return found;
}

function uniqueReliabilityTerminal(events: PiboOutputEvent[]): PiboOutputEvent | "conflict" | undefined {
	if (!events.length) return undefined;
	const bySignature = new Map<string, PiboOutputEvent>();
	for (const event of events) bySignature.set(stableJson(event), event);
	if (bySignature.size !== 1) return "conflict";
	return [...bySignature.values()][0];
}

function productReferences(db: DatabaseSync, piboSessionId: string, eventId: string): string[] {
	const eventRows = db.prepare("SELECT stream_id AS id FROM event_log WHERE session_id = ? AND event_id = ? AND type = 'assistant_message' ORDER BY stream_id LIMIT 20").all(piboSessionId, eventId) as Array<{ id: number }>;
	const messageRows = tableExists(db, "chat_messages")
		? db.prepare("SELECT id FROM chat_messages WHERE session_id = ? AND turn_id = ? AND role = 'assistant' AND status = 'complete' ORDER BY sequence LIMIT 20").all(piboSessionId, eventId) as Array<{ id: string }>
		: [];
	return [...eventRows.map((row) => `event_log:${row.id}`), ...messageRows.map((row) => `chat_messages:${row.id}`)];
}

function countOpenThinkingParts(db: DatabaseSync, piboSessionId: string, eventId: string): number {
	const row = db.prepare(`
		SELECT COUNT(*) AS count FROM (
			SELECT CASE WHEN json_valid(attributes_json)
				THEN COALESCE(json_extract(attributes_json, '$.thinkingIndex'), json_extract(attributes_json, '$.contentIndex'), 0)
				ELSE 0 END AS thinking_index
			FROM event_log
			WHERE session_id = ? AND event_id = ? AND type IN ('thinking_started', 'thinking_finished')
			GROUP BY thinking_index
			HAVING SUM(type = 'thinking_started') != SUM(type = 'thinking_finished')
		)
	`).get(piboSessionId, eventId) as CountRow;
	return Number(row.count);
}

function countOpenToolInvocations(db: DatabaseSync, piboSessionId: string, eventId: string): number {
	const row = db.prepare(`
		SELECT COUNT(*) AS count FROM (
			SELECT
				CASE WHEN tool_call_id IS NOT NULL THEN tool_call_id
					WHEN json_valid(attributes_json) THEN json_extract(attributes_json, '$.toolCallId') END AS tool_call_id,
				CASE WHEN json_valid(attributes_json) THEN COALESCE(json_extract(attributes_json, '$.toolInvocationOrdinal'), 0) ELSE 0 END AS ordinal
			FROM event_log
			WHERE session_id = ? AND event_id = ?
				AND type IN ('tool_call', 'tool_execution_started', 'tool_execution_finished')
			GROUP BY tool_call_id, ordinal
			HAVING SUM(type = 'tool_call') != 1
				OR SUM(type = 'tool_execution_started') != 1
				OR SUM(type = 'tool_execution_finished') != 1
		)
	`).get(piboSessionId, eventId) as CountRow;
	return Number(row.count);
}

function messageSource(db: DatabaseSync, piboSessionId: string, eventId: string): { source?: PiboEventSource } {
	const row = db.prepare(`
		SELECT CASE WHEN json_valid(attributes_json)
			THEN COALESCE(json_extract(attributes_json, '$.source'), json_extract(attributes_json, '$.inlinePayload.source')) END AS source
		FROM event_log
		WHERE session_id = ? AND event_id = ? AND type = 'message_started'
		ORDER BY stream_id ASC
		LIMIT 1
	`).get(piboSessionId, eventId) as SourceRow | undefined;
	return row?.source && EVENT_SOURCES.has(row.source as PiboEventSource) ? { source: row.source as PiboEventSource } : {};
}

function readRuntimeBinding(db: DatabaseSync, piboSessionId: string, session: SessionRow): RuntimeSessionBinding | undefined {
	if (!tableExists(db, "session_runtime_bindings")) {
		return {
			piboSessionId,
			runtimeInstanceId: "pi",
			adapterId: "pi",
			nativeSessionId: session.pi_session_id ?? undefined,
			state: session.pi_session_id ? "bound" : "unbound",
			protocol: "pi-sdk",
			metadata: { source: "legacy-synthesized" },
			revision: 1,
			createdAt: session.created_at,
			updatedAt: session.updated_at,
		};
	}
	const row = db.prepare("SELECT * FROM session_runtime_bindings WHERE pibo_session_id = ?").get(piboSessionId) as Record<string, unknown> | undefined;
	if (!row) return undefined;
	const locator = parseObject(typeof row.locator_json === "string" ? row.locator_json : null);
	return {
		piboSessionId,
		runtimeInstanceId: String(row.runtime_instance_id),
		adapterId: String(row.runtime_adapter_id),
		nativeSessionId: typeof row.native_session_id === "string" ? row.native_session_id : undefined,
		state: row.binding_state as RuntimeSessionBinding["state"],
		protocol: typeof row.protocol === "string" ? row.protocol : undefined,
		protocolVersion: typeof row.protocol_version === "string" ? row.protocol_version : undefined,
		adapterVersion: typeof row.adapter_version === "string" ? row.adapter_version : undefined,
		locator: typeof locator.kind === "string" ? locator as RuntimeSessionBinding["locator"] : undefined,
		metadata: parseObject(typeof row.metadata_json === "string" ? row.metadata_json : null),
		revision: Number(row.revision),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

function resultBase(store: ResolvedPiboDebugStore, piboSessionId: string, mode: OutputTurnRepairResult["mode"]) {
	return {
		resultType: "debug.repair.output" as const,
		mode,
		store: { path: store.path, exists: store.exists },
		warnings: resultWarnings(),
		nextCommands: resultNextCommands(piboSessionId),
	};
}

function resultWarnings(): string[] {
	return [
		"Repair refuses active or ambiguous turns and never invents assistant content.",
		"Every applied terminal event is paired with a pibo.output.repair_applied audit event.",
		"This repair does not delete or replay pending or dead output-persistence jobs.",
	];
}

function resultNextCommands(piboSessionId: string): string[] {
	return [
		`pibo debug trace ${piboSessionId} --check`,
		`pibo debug events ${piboSessionId} --limit 50`,
		`pibo debug jobs dead --queue output-persistence`,
	];
}

function normalizeRepairLimit(value: string | number | undefined): number {
	const parsed = typeof value === "number" ? value : value === undefined ? 20 : Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--limit must be a positive integer");
	return Math.min(parsed, REPAIR_LIMIT_MAX);
}

function nextEventSequence(db: DatabaseSync, piboSessionId: string): number {
	return Number((db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS nextSequence FROM event_log WHERE session_id = ?").get(piboSessionId) as { nextSequence: number }).nextSequence);
}

function tableExists(db: DatabaseSync, table: string): boolean {
	return db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function parseJson(value: string): PiboJsonValue | undefined {
	try { return JSON.parse(value) as PiboJsonValue; } catch { return undefined; }
}

function parseObject(value: string | null): PiboJsonObject {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : {};
	} catch { return {}; }
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
}

function redactError(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.replace(/(bearer|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
		.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, "//[redacted]@")
		.slice(0, 500);
}
