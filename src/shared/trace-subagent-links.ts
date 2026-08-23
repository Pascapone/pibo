import type { PiboOutputEvent } from "../core/events.js";
import type { ChatWebStoredEvent } from "./trace-types.js";

export type TraceChildSession = {
	id: string;
	parentId?: string | null;
	metadata?: Record<string, unknown>;
};

type TraceSubagentToolEvent = Extract<
	PiboOutputEvent,
	{
		type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished";
	}
>;

export function mapTraceChildSessionsByParent(
	sessions: readonly TraceChildSession[],
): Map<string, TraceChildSession[]> {
	const result = new Map<string, TraceChildSession[]>();
	for (const session of sessions) {
		if (!session.parentId) continue;
		const children = result.get(session.parentId) ?? [];
		children.push(session);
		result.set(session.parentId, children);
	}
	return result;
}

export function mapTraceSubagentSessionLinks(events: readonly ChatWebStoredEvent[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		if (event.type !== "subagent_session" || !event.toolCallId) continue;
		result.set(event.toolCallId, event.childPiboSessionId);
	}
	return result;
}

export function findLikelyTraceChildSession(
	piboSessionId: string,
	toolName: string,
	event: TraceSubagentToolEvent,
	childByParent: Map<string, readonly TraceChildSession[]>,
): string | undefined {
	if (!isSubagentToolName(toolName)) return undefined;
	const agentName = toolEventAgentName(event);
	const candidates =
		childByParent
			.get(piboSessionId)
			?.filter((session) => {
				if (toolName === "pibo_agents_send_message") {
					return session.metadata?.subagentToolName === toolName
						&& (!agentName || session.metadata?.subagentName === agentName);
				}
				return session.metadata?.subagentToolName === toolName;
			}) ?? [];
	const threadKey = toolEventThreadKey(event);
	if (threadKey) {
		return candidates.find((session) => session.metadata?.threadKey === threadKey)?.id;
	}
	return candidates.length === 1 ? candidates[0].id : undefined;
}

export function isSubagentToolName(name: string): boolean {
	return name === "pibo_agents_send_message" || name.startsWith("pibo_subagent_");
}

export function subagentNameFromToolName(toolName: string): string {
	return toolName === "pibo_agents_send_message" ? "agent" : toolName.slice("pibo_subagent_".length);
}

function toolEventArguments(event: TraceSubagentToolEvent): Record<string, unknown> | undefined {
	return "args" in event && event.args && typeof event.args === "object" && !Array.isArray(event.args)
		? event.args as Record<string, unknown>
		: undefined;
}

function toolEventAgentName(event: TraceSubagentToolEvent): string | undefined {
	const name = toolEventArguments(event)?.name;
	return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function toolEventThreadKey(event: TraceSubagentToolEvent): string | undefined {
	const threadKey = toolEventArguments(event)?.threadKey;
	return typeof threadKey === "string" && threadKey.trim() ? threadKey.trim() : undefined;
}
