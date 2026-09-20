import { Type } from "typebox";
import {
	piboAgentObservationCursorScopeKey,
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "../../subagents/observation-query.js";
import {
	piboAgentObservationDetails,
	piboAgentObservationKind,
	piboAgentObservationRole,
	piboAgentObservationText,
	type PiboAgentObservationSource,
} from "../../subagents/observations.js";
import {
	formatAgentObservationsForModel,
	type PiboAgentObservation,
	type PiboAgentObserveInput,
} from "../../subagents/tool.js";
import type { PiboJsonObject } from "../../core/events.js";
import type { RemoteModuleTool, RemoteToolContext } from "../tool.js";
import { RemoteAgentError, REMOTE_AGENT_TOOL_NAMES } from "../types.js";

export type RemoteMessageRecord = {
	id: string;
	role: string;
	/** Full resolved message text (payload, inline text, or preview fallback). */
	text: string;
	createdAt: string;
	turnId?: string;
	attributes?: PiboJsonObject;
};

export type RemoteObservationRecord = {
	sequence: number;
	status: string;
	startedAt: string;
	eventType?: string;
	/** Full resolved raw text for text-shaped events. */
	sourceText?: string;
	/** Full resolved payload value for JSON-shaped events (args/result/partialResult by event type). */
	sourceValue?: unknown;
	/** Legacy inline text; used as source text when no resolved content is present. */
	text?: string;
	toolName?: string;
	toolCallId?: string;
	requestId?: string;
	turnId?: string;
	attributes?: PiboJsonObject;
};

export type RemoteObservePort = {
	getRoomSession(roomId: string, sessionId: string): { id: string; title?: string } | undefined;
	listSessionMessages(sessionId: string): RemoteMessageRecord[];
	listSessionObservations(sessionId: string): RemoteObservationRecord[];
	getObservationCursor(sessionId: string, scope: string): number | undefined;
	advanceObservationCursor(sessionId: string, scope: string, sequence: number): number;
};

/** Remote cursors reuse the shared auto-cursor table under a namespaced scope. */
export function remoteObserveCursorScope(filters: PiboAgentObserveInput): string {
	return `remote:${piboAgentObservationCursorScopeKey(filters)}`;
}

function messageEventType(role: string): string {
	return role.toLowerCase().includes("assistant") ? "assistant_message" : "user_message";
}

function messageToObservation(
	message: RemoteMessageRecord,
	input: { sessionId: string; sessionName: string },
): Omit<PiboAgentObservation, "sequence"> {
	const eventType = messageEventType(message.role);
	const source: PiboAgentObservationSource = { eventType, text: message.text };
	const text = piboAgentObservationText(source);
	return {
		createdAt: message.createdAt,
		agentId: input.sessionId,
		name: input.sessionName,
		...(message.turnId ? { threadKey: message.turnId } : {}),
		eventType,
		kind: "message",
		role: message.role,
		...(text !== undefined ? { text } : {}),
		details: piboAgentObservationDetails({ type: eventType, role: message.role, ...(message.attributes ?? {}), text: message.text }),
	};
}

function observationSource(record: RemoteObservationRecord, eventType: string): PiboAgentObservationSource {
	const source: PiboAgentObservationSource = { eventType };
	const text = record.sourceText ?? record.text;
	if (text !== undefined) source.text = text;
	if (record.sourceValue !== undefined) {
		if (eventType === "tool_call" || eventType === "tool_execution_started") source.args = record.sourceValue;
		else if (eventType === "tool_execution_updated") source.partialResult = record.sourceValue;
		else if (eventType === "tool_execution_finished" || eventType === "execution_result") source.result = record.sourceValue;
		else source.fallbackText = record.sourceValue;
	}
	return source;
}

function observationDetailsValue(record: RemoteObservationRecord, eventType: string): PiboJsonObject {
	const value: Record<string, unknown> = { type: eventType, ...(record.attributes ?? {}) };
	if (record.sourceValue !== undefined) {
		if (eventType === "tool_call" || eventType === "tool_execution_started") value.args = record.sourceValue;
		else if (eventType === "tool_execution_updated") value.partialResult = record.sourceValue;
		else if (eventType === "tool_execution_finished" || eventType === "execution_result") value.result = record.sourceValue;
		else value.payload = record.sourceValue;
	}
	const text = record.sourceText ?? record.text;
	if (text !== undefined) value.text = text;
	if (record.toolName !== undefined) value.toolName = record.toolName;
	if (record.toolCallId !== undefined) value.toolCallId = record.toolCallId;
	return value as PiboJsonObject;
}

function recordToObservation(
	record: RemoteObservationRecord,
	input: { sessionId: string; sessionName: string },
): Omit<PiboAgentObservation, "sequence"> {
	const toolName = record.toolName?.trim();
	const eventType = record.eventType ?? (toolName ? "tool_call" : "event");
	const source = observationSource(record, eventType);
	const role = piboAgentObservationRole(source);
	const text = piboAgentObservationText(source);
	const failed = eventType === "session_error" || record.status.toLowerCase() === "error";
	return {
		createdAt: record.startedAt,
		agentId: input.sessionId,
		name: input.sessionName,
		...(record.requestId ? { requestId: record.requestId } : {}),
		...(record.turnId ? { threadKey: record.turnId } : {}),
		eventType,
		kind: piboAgentObservationKind(eventType),
		...(role ? { role } : {}),
		...(text !== undefined ? { text } : {}),
		...(toolName ? { toolName } : {}),
		...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
		...(eventType === "tool_execution_finished" ? { isError: failed } : failed ? { isError: true } : {}),
		details: piboAgentObservationDetails(observationDetailsValue(record, eventType)),
	};
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const entries = value.filter((entry): entry is string => typeof entry === "string");
	return entries.length === value.length ? entries : undefined;
}

function observeInputFromArgs(args: Record<string, unknown>): PiboAgentObserveInput {
	const input: PiboAgentObserveInput = {};
	const strings = (key: string): string[] | undefined => asStringArray(args[key]);
	const requestIds = strings("requestIds");
	if (requestIds) input.requestIds = requestIds;
	const toolCallIds = strings("toolCallIds");
	if (toolCallIds) input.toolCallIds = toolCallIds;
	const agentIds = strings("agentIds");
	if (agentIds) input.agentIds = agentIds;
	const names = strings("names");
	if (names) input.names = names;
	const threadKeys = strings("threadKeys");
	if (threadKeys) input.threadKeys = threadKeys;
	const eventTypes = strings("eventTypes");
	if (eventTypes) input.eventTypes = eventTypes;
	const kinds = strings("kinds");
	if (kinds) input.kinds = kinds as PiboAgentObserveInput["kinds"];
	const roles = strings("roles");
	if (roles) input.roles = roles;
	if (typeof args.since === "string") input.since = args.since;
	if (typeof args.until === "string") input.until = args.until;
	if (typeof args.textContains === "string" && args.textContains) input.textContains = args.textContains;
	if (typeof args.textRegex === "string" && args.textRegex) input.textRegex = args.textRegex;
	if (args.cursorMode === "auto" || args.cursorMode === "history") input.cursorMode = args.cursorMode;
	if (typeof args.afterSequence === "number") input.afterSequence = args.afterSequence;
	if (args.order === "asc" || args.order === "desc") input.order = args.order;
	if (typeof args.limit === "number") input.limit = args.limit;
	if (typeof args.includeTools === "boolean") input.includeTools = args.includeTools;
	if (args.toolDetail === "summary" || args.toolDetail === "full") input.toolDetail = args.toolDetail;
	if (typeof args.includeDetails === "boolean") input.includeDetails = args.includeDetails;
	return input;
}

export function buildObserveModuleTools(port: RemoteObservePort): RemoteModuleTool[] {
	const observeTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionObserve,
		title: "Observe room session",
		description: [
			"Read completed room-session messages with bounded cursor, identity, event, time, substring, regex, order, and limit filters.",
			"Default cursorMode=auto: the first equivalent query returns the newest 20 completed assistant messages; later calls return only unread messages. Streaming deltas, duplicate tool progress events, and tools stay hidden.",
			"Use cursorMode=history only to reread earlier observations. Inspect tools only when a session appears stuck, reports a problem, or needs targeted diagnosis; prefer exact toolCallIds, then includeTools=true, and use toolDetail=full only when compact summaries are insufficient.",
		].join("\n"),
		module: "observe",
		inputSchema: Type.Object({
			sessionId: Type.String({ description: "Pibo session id (ps_...). Must belong to this room." }),
			requestIds: Type.Optional(Type.Array(Type.String({ description: "Exact run/request ID" }), { maxItems: 50 })),
			toolCallIds: Type.Optional(Type.Array(Type.String({ description: "Exact existing toolCallId. Multiple values use OR semantics and return only matching tool observations." }), { maxItems: 50 })),
			agentIds: Type.Optional(Type.Array(Type.String({ description: "Exact agent (session) id. Only observations of a listed id match, so include sessionId." }), { maxItems: 50 })),
			names: Type.Optional(Type.Array(Type.String({ description: "Exact session title" }), { maxItems: 50 })),
			threadKeys: Type.Optional(Type.Array(Type.String({ description: "Exact turn id; groups one assistant turn with its tool activity." }), { maxItems: 50 })),
			eventTypes: Type.Optional(Type.Array(Type.String({ description: "Exact Pibo output event type. Explicit filters can retrieve progress events hidden by the default view." }), { maxItems: 50 })),
			kinds: Type.Optional(Type.Array(Type.Union([Type.Literal("message"), Type.Literal("thinking"), Type.Literal("tool"), Type.Literal("error"), Type.Literal("lifecycle"), Type.Literal("event")], { description: "Optional broad event kinds, including progress events. Omit eventTypes and kinds for the compact default view." }), { maxItems: 6 })),
			roles: Type.Optional(Type.Array(Type.String({ description: "Exact normalized role, for example assistant" }), { maxItems: 20 })),
			since: Type.Optional(Type.String({ description: "Inclusive ISO-8601 lower timestamp bound" })),
			until: Type.Optional(Type.String({ description: "Inclusive ISO-8601 upper timestamp bound" })),
			textContains: Type.Optional(Type.String({ description: "Case-insensitive substring match against normalized observation text" })),
			textRegex: Type.Optional(Type.String({ description: "Case-sensitive rg/Rust-regex match against normalized observation text. Use inline flags such as (?i) to change case behavior. Combines with textContains using AND semantics. NUL text and literal or escaped NUL patterns are rejected; regex use requires the optional rg platform binary." })),
			cursorMode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("history")], { default: "auto", description: "auto remembers this normalized query and returns only unread observations after its first newest-message snapshot. history ignores and does not change the saved cursor, allowing deliberate rereads." })),
			afterSequence: Type.Optional(Type.Integer({ description: "Explicit exclusive cursor override. In auto mode it replaces and advances the saved cursor for this normalized query; cursor pages consume the oldest unseen matches and desc reverses only the returned page.", minimum: 0 })),
			order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")], { default: "desc", description: "Newest first by default when no cursor is supplied" })),
			limit: Type.Optional(Type.Integer({ description: "Maximum completed messages or activity records to return. Use 50 explicitly when needed.", minimum: 1, maximum: 200, default: 20 })),
			includeTools: Type.Optional(Type.Boolean({ description: "Include compact tool calls and terminal results. Default false; enable only for stalls, errors, or targeted diagnosis. Prefer exact toolCallIds when known.", default: false })),
			toolDetail: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("full")], { default: "summary", description: "Tool text detail when tools are included. summary is compact; full remains bounded to the observation text limit." })),
			includeDetails: Type.Optional(Type.Boolean({ description: "Include the normalized source event in structured details. Default false; use only for diagnostics.", default: false })),
		}, { additionalProperties: false }),
		readOnly: true,
		async execute(args, context: RemoteToolContext) {
			const sessionId = String(args.sessionId ?? "").trim();
			if (!sessionId) throw new RemoteAgentError("args_invalid", "sessionId is required.");
			const session = port.getRoomSession(context.roomId, sessionId);
			if (!session) throw new RemoteAgentError("session_forbidden", "Session not found in this room.");
			const sessionName = session.title?.trim() || sessionId;
			const input = observeInputFromArgs(args);
			// Same query engine, filters, paging, cursors, and truncation as pibo_agents_observe.
			const baseQuery = preparePiboAgentObservationQuery(input);
			const cursorScope = remoteObserveCursorScope(baseQuery.filters);
			const explicitAfterSequence = input.afterSequence !== undefined;
			const savedAfterSequence = baseQuery.cursorMode === "auto" && !explicitAfterSequence
				? port.getObservationCursor(sessionId, cursorScope)
				: undefined;
			const query = savedAfterSequence === undefined
				? baseQuery
				: preparePiboAgentObservationQuery({ ...input, afterSequence: savedAfterSequence });
			const pending: Array<{ time: string; messageFirst: number; id: string; observation: Omit<PiboAgentObservation, "sequence"> }> = [];
			for (const message of port.listSessionMessages(sessionId)) {
				pending.push({
					time: message.createdAt,
					messageFirst: 0,
					id: message.id,
					observation: messageToObservation(message, { sessionId, sessionName }),
				});
			}
			for (const record of port.listSessionObservations(sessionId)) {
				pending.push({
					time: record.startedAt,
					messageFirst: 1,
					id: `${record.sequence}`,
					observation: recordToObservation(record, { sessionId, sessionName }),
				});
			}
			pending.sort((left, right) =>
				left.time < right.time ? -1
				: left.time > right.time ? 1
				: left.messageFirst - right.messageFirst || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
			const observations: PiboAgentObservation[] = pending.map((entry, index) => ({ ...entry.observation, sequence: index + 1 }));
			const ordered = query.scanOrder === "desc" ? [...observations].reverse() : observations;
			const page = selectPiboAgentObservationPage(ordered, query);
			if (query.cursorMode === "history") {
				return { text: formatAgentObservationsForModel(page), details: page };
			}
			const highWaterSequence = observations.length;
			const initialSnapshot = !explicitAfterSequence && savedAfterSequence === undefined;
			const nextAfterSequence = initialSnapshot || !page.truncated
				? Math.max(page.nextAfterSequence, highWaterSequence)
				: page.nextAfterSequence;
			const result = {
				...page,
				autoCursorSequence: port.advanceObservationCursor(sessionId, cursorScope, nextAfterSequence),
			};
			return { text: formatAgentObservationsForModel(result), details: result };
		},
	};
	return [observeTool];
}
