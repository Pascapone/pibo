import { Type } from "typebox";
import type { RemoteModuleTool, RemoteToolContext } from "../tool.js";
import { RemoteAgentError, REMOTE_AGENT_TOOL_NAMES } from "../types.js";

export type RemoteSessionSummary = {
	id: string;
	title?: string;
	profile: string;
	channel: string;
	kind: string;
	createdAt: string;
	updatedAt: string;
};

export type RemoteSessionPort = {
	listRoomSessions(roomId: string): RemoteSessionSummary[];
	getRoomSession(roomId: string, sessionId: string): (RemoteSessionSummary & { roomId: string }) | undefined;
	createRoomSession(roomId: string, input: { title?: string; profile?: string }): RemoteSessionSummary;
	sendSessionMessage(sessionId: string, message: string): Promise<{ eventId: string; reply?: string }>;
	listRoomAgents(roomId: string): { defaultProfile: string; runtime: string; runtimeInstanceId: string; agents: Array<{ name: string; isDefault: boolean }> };
};

export const REMOTE_SESSION_TITLE_MAX_LENGTH = 120;
export const REMOTE_SESSION_MESSAGE_MAX_LENGTH = 50_000;

function formatSession(session: RemoteSessionSummary): string {
	return `- ${session.id} — ${session.title?.trim() || "(untitled)"} [${session.profile}] updated ${session.updatedAt}`;
}

function sendResultText(sessionId: string, result: { eventId: string; reply?: string }): string {
	const lines = [`Message sent to session ${sessionId}.`, `eventId: ${result.eventId}`];
	if (result.reply?.trim()) lines.push("", "Assistant reply:", result.reply.trim());
	return lines.join("\n");
}

export function buildSessionModuleTools(port: RemoteSessionPort): RemoteModuleTool[] {
	const listTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionList,
		title: "List room sessions",
		description: "List the Pibo sessions of this room (id, title, profile, timestamps).",
		module: "sessions",
		inputSchema: Type.Object({}, { additionalProperties: false }),
		readOnly: true,
		async execute(_args, context: RemoteToolContext) {
			const sessions = port.listRoomSessions(context.roomId);
			if (sessions.length === 0) return { text: "This room has no sessions yet.", details: { sessions: [] } };
			return {
				text: `Sessions in this room:\n${sessions.map(formatSession).join("\n")}`,
				details: { sessions },
			};
		},
	};

	const createTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionCreate,
		title: "Create room session",
		description: "Create a new Pibo session in this room. Returns the new session id. The profile must be room-approved (see remote_session_agents); omit it for the room default.",
		module: "sessions",
		inputSchema: Type.Object({
			title: Type.Optional(Type.String({ description: "Human-readable session title.", maxLength: REMOTE_SESSION_TITLE_MAX_LENGTH })),
			profile: Type.Optional(Type.String({ description: "Profile name for the new session. Defaults to the room default." })),
		}, { additionalProperties: false }),
		async execute(args, context: RemoteToolContext) {
			const title = typeof args.title === "string" ? args.title.trim() : "";
			const profile = typeof args.profile === "string" && args.profile.trim() ? args.profile.trim() : undefined;
			const session = port.createRoomSession(context.roomId, {
				...(title ? { title } : {}),
				...(profile ? { profile } : {}),
			});
			return {
				text: `Created session ${session.id}${session.title ? ` ("${session.title}")` : ""} in this room.`,
				details: { session },
			};
		},
	};

	const sendTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionSend,
		title: "Send session message",
		description: "Write a message to a session of this room (give it a task). Returns the event id and, when available, the assistant reply.",
		module: "sessions",
		inputSchema: Type.Object({
			sessionId: Type.String({ description: "Target Pibo session id (ps_...). Must belong to this room." }),
			message: Type.String({ description: "Message text to enqueue for the session.", maxLength: REMOTE_SESSION_MESSAGE_MAX_LENGTH, minLength: 1 }),
		}, { additionalProperties: false }),
		async execute(args, context: RemoteToolContext) {
			const sessionId = String(args.sessionId ?? "").trim();
			const message = String(args.message ?? "");
			if (!sessionId) throw new RemoteAgentError("args_invalid", "sessionId is required.");
			if (!message.trim()) throw new RemoteAgentError("args_invalid", "message must not be empty.");
			const session = port.getRoomSession(context.roomId, sessionId);
			if (!session) throw new RemoteAgentError("session_forbidden", "Session not found in this room.");
			const result = await port.sendSessionMessage(sessionId, message);
			return { text: sendResultText(sessionId, result), details: { sessionId, ...result } };
		},
	};

	const agentsTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.sessionAgents,
		title: "List room agents",
		description: "List the agents (profiles) approved for new sessions in this room and the room default. New sessions run on the room runtime.",
		module: "sessions",
		inputSchema: Type.Object({}, { additionalProperties: false }),
		readOnly: true,
		async execute(_args, context: RemoteToolContext) {
			const info = port.listRoomAgents(context.roomId);
			const lines = info.agents.map((agent) => `- ${agent.name}${agent.isDefault ? " (default)" : ""}`);
			return {
				text: `Agents approved for this room (runtime ${info.runtime} / ${info.runtimeInstanceId}, default ${info.defaultProfile}):\n${lines.join("\n")}`,
				details: { defaultProfile: info.defaultProfile, runtime: info.runtime, runtimeInstanceId: info.runtimeInstanceId, agents: info.agents },
			};
		},
	};

	return [listTool, createTool, sendTool, agentsTool];
}
