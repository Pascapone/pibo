import { DatabaseSync } from "node:sqlite";
import type { PiboEventSource, PiboOutputEvent } from "../core/events.js";
import { ChatDataIngestService } from "../data/ingest-service.js";
import { PiboDataStore } from "../data/pibo-store.js";
import { PiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { ResolvedPiboDebugStore } from "./stores.js";

const REPAIR_ERROR = "Output persistence repair closed an incomplete persisted turn.";
const EVENT_SOURCES = new Set<PiboEventSource>(["user", "ui", "service", "actor"]);

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

export type OutputTurnRepairInspection = {
	piboSessionId: string;
	eventId: string;
	sessionExists: boolean;
	repairable: boolean;
	reason?: "session_not_found" | "message_start_missing" | "message_start_duplicated" | "already_terminal";
	plannedEvent?: {
		type: "message_finished" | "session_error";
		source?: PiboEventSource;
		error?: string;
	};
	observed: {
		messageStarted: number;
		assistantMessages: number;
		messageFinished: number;
		sessionErrors: number;
		openThinkingParts: number;
		openToolInvocations: number;
		identityCollisions: number;
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
	};
	warnings: string[];
	nextCommands: string[];
};

export function inspectOutputTurnRepair(input: {
	store: ResolvedPiboDebugStore;
	piboSessionId: string;
	eventId: string;
}): OutputTurnRepairInspection {
	if (!input.store.exists) throw new Error(`Debug store "pibo-data" not found at ${input.store.path}`);
	const db = new DatabaseSync(input.store.path, { readOnly: true });
	try {
		return inspectOutputTurnDb(db, input.piboSessionId, input.eventId);
	} finally {
		db.close();
	}
}

export function repairOutputTurn(input: {
	store: ResolvedPiboDebugStore;
	piboSessionId: string;
	eventId: string;
	apply?: boolean;
	now?: () => string;
}): OutputTurnRepairResult {
	const mode: OutputTurnRepairResult["mode"] = input.apply ? "apply" : "dry-run";
	const inspection = inspectOutputTurnRepair(input);
	const base = {
		resultType: "debug.repair.output" as const,
		mode,
		store: { path: input.store.path, exists: input.store.exists },
		warnings: [
			"Confirm the target turn is not active before applying repair.",
			"This repair does not delete or replay pending or dead output-persistence jobs.",
		],
		nextCommands: [
			`pibo debug trace ${input.piboSessionId} --check`,
			`pibo debug events ${input.piboSessionId} --limit 50`,
			"pibo debug jobs dead --queue output-persistence",
		],
	};
	if (!input.apply || !inspection.repairable || !inspection.plannedEvent) {
		return { ...base, applied: false, inspection };
	}

	const data = new PiboDataStore(input.store.path);
	try {
		return data.transaction(() => {
			const current = inspectOutputTurnDb(data.db, input.piboSessionId, input.eventId);
			if (!current.repairable || !current.plannedEvent) {
				return { ...base, applied: false, inspection: current };
			}
			const sessionStore = new PiboDataSessionStore(data);
			const session = sessionStore.get(input.piboSessionId);
			if (!session) {
				return { ...base, applied: false, inspection: { ...current, repairable: false, reason: "session_not_found" as const } };
			}
			const room = data.db.prepare("SELECT room_id AS roomId FROM sessions WHERE id = ?").get(input.piboSessionId) as RoomRow | undefined;
			const event = repairEvent(input.piboSessionId, input.eventId, current.plannedEvent);
			const persisted = new ChatDataIngestService(data).ingestOutputEvent({
				session,
				...(room?.roomId ? { roomId: room.roomId } : {}),
				actorId: "pibo-debug-repair",
				event,
				createdAt: input.now?.() ?? new Date().toISOString(),
			});
			return {
				...base,
				applied: true,
				inspection: current,
				persisted: {
					type: current.plannedEvent.type,
					streamId: persisted.streamId,
					duplicate: persisted.duplicate,
				},
			};
		});
	} finally {
		data.close();
	}
}

export function formatOutputTurnRepair(result: OutputTurnRepairResult): string {
	const inspection = result.inspection;
	const lines = [
		"pibo debug repair output",
		`mode\t${result.mode}`,
		`applied\t${result.applied}`,
		`session\t${inspection.piboSessionId}`,
		`event\t${inspection.eventId}`,
		`repairable\t${inspection.repairable}`,
		...(inspection.reason ? [`reason\t${inspection.reason}`] : []),
		...(inspection.plannedEvent ? [`plannedEvent\t${inspection.plannedEvent.type}`] : []),
		`messageStarted\t${inspection.observed.messageStarted}`,
		`assistantMessages\t${inspection.observed.assistantMessages}`,
		`messageFinished\t${inspection.observed.messageFinished}`,
		`sessionErrors\t${inspection.observed.sessionErrors}`,
		`openThinkingParts\t${inspection.observed.openThinkingParts}`,
		`openToolInvocations\t${inspection.observed.openToolInvocations}`,
		`identityCollisions\t${inspection.observed.identityCollisions}`,
		...(result.persisted ? [`persisted\t${result.persisted.type}@${result.persisted.streamId}`] : []),
		"",
		...result.warnings.map((warning) => `warning\t${warning}`),
		"",
		"Next:",
		...result.nextCommands.map((command) => `  ${command}`),
	];
	return lines.join("\n");
}

function inspectOutputTurnDb(db: DatabaseSync, piboSessionId: string, eventId: string): OutputTurnRepairInspection {
	const sessionExists = Boolean(db.prepare("SELECT 1 FROM sessions WHERE id = ? AND deleted_at IS NULL").get(piboSessionId));
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
	const observed = {
		messageStarted: Number(counts.messageStarted ?? 0),
		assistantMessages: Number(counts.assistantMessages ?? 0),
		messageFinished: Number(counts.messageFinished ?? 0),
		sessionErrors: Number(counts.sessionErrors ?? 0),
		openThinkingParts: countOpenThinkingParts(db, piboSessionId, eventId),
		openToolInvocations: countOpenToolInvocations(db, piboSessionId, eventId),
		identityCollisions: Number(counts.identityCollisions ?? 0),
	};
	const base = { piboSessionId, eventId, sessionExists, observed };
	if (!sessionExists) return { ...base, repairable: false, reason: "session_not_found" };
	if (observed.messageStarted === 0) return { ...base, repairable: false, reason: "message_start_missing" };
	if (observed.messageStarted !== 1) return { ...base, repairable: false, reason: "message_start_duplicated" };
	if (observed.messageFinished + observed.sessionErrors > 0) return { ...base, repairable: false, reason: "already_terminal" };
	if (observed.assistantMessages > 0) {
		return {
			...base,
			repairable: true,
			plannedEvent: { type: "message_finished", ...messageSource(db, piboSessionId, eventId) },
		};
	}
	return {
		...base,
		repairable: true,
		plannedEvent: { type: "session_error", error: REPAIR_ERROR },
	};
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

function repairEvent(
	piboSessionId: string,
	eventId: string,
	planned: NonNullable<OutputTurnRepairInspection["plannedEvent"]>,
): PiboOutputEvent {
	if (planned.type === "message_finished") {
		return { type: "message_finished", piboSessionId, eventId, ...(planned.source ? { source: planned.source } : {}) };
	}
	return { type: "session_error", piboSessionId, eventId, error: planned.error ?? REPAIR_ERROR };
}
