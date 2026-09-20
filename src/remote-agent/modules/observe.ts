import { Type } from "typebox";
import {
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "../../subagents/observation-query.js";
import type { PiboAgentObservation } from "../../subagents/tool.js";
import type { RemoteModuleTool, RemoteToolContext } from "../tool.js";
import { RemoteAgentError, REMOTE_AGENT_TOOL_NAMES } from "../types.js";

export type RemoteMessageRecord = {
	id: string;
	role: string;
	text: string;
	createdAt: string;
};

export type RemoteObservationRecord = {
	sequence: number;
	kind: string;
	status: string;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	startedAt: string;
};

export type RemoteObservePort = {
	getRoomSession(roomId: string, sessionId: string): { id: string; title?: string } | undefined;
	listSessionMessages(sessionId: string): RemoteMessageRecord[];
	listSessionObservations(sessionId: string, limit: number): RemoteObservationRecord[];
};

function messageToObservation(
	message: RemoteMessageRecord,
	input: { sequence: number; sessionId: string; sessionName: string },
): PiboAgentObservation {
	const role = message.role.toLowerCase();
	const isAssistant = role.includes("assistant");
	return {
		sequence: input.sequence,
		createdAt: message.createdAt,
		agentId: input.sessionId,
		name: input.sessionName,
		eventType: isAssistant ? "assistant_message" : "user_message",
		kind: "message",
		role: isAssistant ? "assistant" : "user",
		text: message.text,
	};
}

function recordToObservation(
	record: RemoteObservationRecord,
	input: { sessionId: string; sessionName: string },
): PiboAgentObservation {
	const toolName = record.toolName?.trim();
	return {
		sequence: record.sequence,
		createdAt: record.startedAt,
		agentId: input.sessionId,
		name: input.sessionName,
		eventType: toolName ? "tool_call" : "event",
		kind: toolName ? "tool" : "event",
		...(toolName ? { toolName } : {}),
		...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
		isError: record.status.toLowerCase().includes("error") || record.status.toLowerCase().includes("fail"),
		...(record.text ? { text: record.text } : {}),
	};
}

function formatObservation(observation: PiboAgentObservation): string {
	const head = `#${observation.sequence} ${observation.createdAt} ${observation.eventType}`;
	if (observation.kind === "tool") return `${head} ${observation.toolName ?? "tool"}${observation.isError ? " (error)" : ""}${observation.text ? `\n${observation.text}` : ""}`;
	return `${head} [${observation.role ?? "?"}]${observation.text ? `\n${observation.text}` : ""}`;
}

export function buildObserveModuleTools(port: RemoteObservePort): RemoteModuleTool[] {
	const observeTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionObserve,
		title: "Observe room session",
		description: "Read what happened in a session of this room: messages and tool activity, newest last. Supports paging via afterSequence/limit.",
		module: "observe",
		inputSchema: Type.Object({
			sessionId: Type.String({ description: "Pibo session id (ps_...). Must belong to this room." }),
			afterSequence: Type.Optional(Type.Number({ description: "Return only observations after this sequence (use nextAfterSequence)." })),
			limit: Type.Optional(Type.Number({ description: "Max observations to return (default 20, max 200)." })),
			order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")], { description: "Sequence order (default asc)." })),
			eventTypes: Type.Optional(Type.Array(Type.String(), { description: "Event types to include (default: assistant_message only). Use [\"user_message\", \"assistant_message\"] for full chat." })),
			includeTools: Type.Optional(Type.Boolean({ description: "Include tool activity (default false)." })),
			textContains: Type.Optional(Type.String({ description: "Only observations whose text contains this string." })),
		}, { additionalProperties: false }),
		readOnly: true,
		async execute(args, context: RemoteToolContext) {
			const sessionId = String(args.sessionId ?? "").trim();
			if (!sessionId) throw new RemoteAgentError("args_invalid", "sessionId is required.");
			const session = port.getRoomSession(context.roomId, sessionId);
			if (!session) throw new RemoteAgentError("session_forbidden", "Session not found in this room.");
			const sessionName = session.title?.trim() || sessionId;
			const messages = port.listSessionMessages(sessionId);
			const observations: PiboAgentObservation[] = messages.map((message, index) =>
				messageToObservation(message, { sequence: index + 1, sessionId, sessionName }),
			);
			const messageCount = observations.length;
			for (const record of port.listSessionObservations(sessionId, 200)) {
				observations.push(recordToObservation({ ...record, sequence: messageCount + record.sequence }, { sessionId, sessionName }));
			}
			observations.sort((left, right) => left.sequence - right.sequence);
			// Same query engine, filters, paging, and truncation as pibo_agents_observe.
			const query = preparePiboAgentObservationQuery({
				...(typeof args.afterSequence === "number" ? { afterSequence: args.afterSequence } : {}),
				...(typeof args.limit === "number" ? { limit: args.limit } : {}),
				...(args.order === "asc" || args.order === "desc" ? { order: args.order } : {}),
				...(Array.isArray(args.eventTypes) ? { eventTypes: args.eventTypes.filter((entry): entry is string => typeof entry === "string") } : {}),
				...(typeof args.includeTools === "boolean" ? { includeTools: args.includeTools } : {}),
				...(typeof args.textContains === "string" && args.textContains ? { textContains: args.textContains } : {}),
			});
			const page = selectPiboAgentObservationPage(observations, query);
			if (page.observations.length === 0) {
				return { text: `No observations for session ${sessionId} with these filters.`, details: page };
			}
			const lines = [
				`Observations for session ${sessionId} (${page.observations.length} shown${page.truncated ? ", truncated" : ""}, nextAfterSequence ${page.nextAfterSequence}):`,
				...page.observations.map(formatObservation),
			];
			return { text: lines.join("\n\n"), details: page };
		},
	};
	return [observeTool];
}
