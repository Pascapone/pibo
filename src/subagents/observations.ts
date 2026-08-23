import type { PiboJsonValue, PiboOutputEvent } from "../core/events.js";

export type PiboAgentObservationKind = "message" | "thinking" | "tool" | "error" | "lifecycle" | "event";
export type PiboAgentObservationOrder = "asc" | "desc";

export const PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES = 4 * 1024;
export const PIBO_AGENT_OBSERVATION_DETAILS_MAX_BYTES = 32 * 1024;
export const PIBO_AGENT_OBSERVATION_DEFAULT_LIMIT = 50;
export const PIBO_AGENT_OBSERVATION_MAX_LIMIT = 200;

export type PiboAgentObservationSource = {
	eventType: string;
	source?: string;
	text?: unknown;
	error?: unknown;
	args?: unknown;
	partialResult?: unknown;
	result?: unknown;
	action?: unknown;
	reason?: unknown;
	subagentName?: unknown;
	fallbackText?: unknown;
};

export function piboAgentObservationSourceFromEvent(event: PiboOutputEvent): PiboAgentObservationSource {
	const source: PiboAgentObservationSource = {
		eventType: event.type,
		fallbackText: "toolName" in event && typeof event.toolName === "string" ? event.toolName : event.type,
	};
	if ("source" in event && typeof event.source === "string") source.source = event.source;
	if ("text" in event) source.text = event.text;
	if (event.type === "session_error") source.error = event.error;
	if (event.type === "tool_call" || event.type === "tool_execution_started") source.args = event.args;
	if (event.type === "tool_execution_updated") source.partialResult = event.partialResult;
	if (event.type === "tool_execution_finished" || event.type === "execution_result" || event.type === "compaction_end") source.result = event.result;
	if (event.type === "execution_result") source.action = event.action;
	if (event.type === "compaction_start" || event.type === "compaction_end") source.reason = event.reason;
	if (event.type === "subagent_session") source.subagentName = event.subagentName;
	return source;
}

export function piboAgentObservationKind(eventType: string): PiboAgentObservationKind {
	if (["message_queued", "message_steered", "message_started", "assistant_delta", "assistant_message", "message_finished"].includes(eventType)) return "message";
	if (eventType.startsWith("thinking_")) return "thinking";
	if (eventType.startsWith("tool_") || eventType === "subagent_session") return "tool";
	if (eventType === "session_error") return "error";
	if (eventType === "execution_result" || eventType.startsWith("compaction_")) return "lifecycle";
	return "event";
}

export function piboAgentObservationRole(source: PiboAgentObservationSource): string | undefined {
	const eventType = source.eventType;
	if (eventType === "assistant_message" || eventType === "assistant_delta" || eventType.startsWith("thinking_")) return "assistant";
	if (eventType === "message_queued" || eventType === "message_steered" || eventType === "message_started" || eventType === "message_finished") return source.source ?? "actor";
	if (eventType.startsWith("tool_")) return "tool";
	if (eventType === "subagent_session") return "agent";
	if (eventType === "session_error" || eventType === "execution_result" || eventType.startsWith("compaction_")) return "system";
	return undefined;
}

export function piboAgentObservationText(source: PiboAgentObservationSource): string | undefined {
	if (typeof source.text === "string") return boundPiboAgentObservationText(source.text);
	if (typeof source.error === "string") return boundPiboAgentObservationText(source.error);
	if (source.eventType === "tool_call" || source.eventType === "tool_execution_started") {
		return stringifyPiboAgentObservationValue(source.args);
	}
	if (source.eventType === "tool_execution_updated") return stringifyPiboAgentObservationValue(source.partialResult);
	if (source.eventType === "tool_execution_finished") return stringifyPiboAgentObservationValue(source.result);
	if (source.eventType === "subagent_session" && typeof source.subagentName === "string") {
		return boundPiboAgentObservationText(source.subagentName);
	}
	if (source.eventType === "execution_result") {
		return stringifyPiboAgentObservationValue(source.result) ?? stringifyPiboAgentObservationValue(source.action);
	}
	if ((source.eventType === "compaction_start" || source.eventType === "compaction_end") && typeof source.reason === "string") {
		return boundPiboAgentObservationText(source.reason);
	}
	return stringifyPiboAgentObservationValue(source.fallbackText);
}

export function boundPiboAgentObservationText(value: string): string {
	if (Buffer.byteLength(value, "utf8") <= PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES) return value;
	const suffix = "…";
	let end = Math.min(value.length, PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES);
	while (end > 0 && Buffer.byteLength(`${value.slice(0, end)}${suffix}`, "utf8") > PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES) end -= 1;
	return `${value.slice(0, end)}${suffix}`;
}

export function stringifyPiboAgentObservationValue(value: unknown): string | undefined {
	if (typeof value === "string") return boundPiboAgentObservationText(value);
	if (value === undefined) return undefined;
	try {
		return boundPiboAgentObservationText(JSON.stringify(value));
	} catch {
		return boundPiboAgentObservationText(String(value));
	}
}

export function piboAgentObservationDetails(value: unknown): PiboJsonValue {
	let serialized: string;
	try {
		serialized = JSON.stringify(value) ?? "null";
	} catch {
		return { truncated: true, preview: boundPiboAgentObservationText(String(value)) };
	}
	if (Buffer.byteLength(serialized, "utf8") <= PIBO_AGENT_OBSERVATION_DETAILS_MAX_BYTES) {
		return JSON.parse(serialized) as PiboJsonValue;
	}
	return {
		truncated: true,
		preview: boundPiboAgentObservationText(serialized),
	};
}

export function parsePiboAgentObservationTimestamp(value: string | undefined, label: string): number | undefined {
	if (value === undefined) return undefined;
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		throw new Error(`Agent observation ${label} must be a valid ISO-8601 timestamp.`);
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`Agent observation ${label} must be a valid ISO-8601 timestamp.`);
	return timestamp;
}

export function normalizePiboAgentObservationOrder(value: PiboAgentObservationOrder | undefined): PiboAgentObservationOrder {
	if (value === undefined) return "asc";
	if (value !== "asc" && value !== "desc") throw new Error(`Agent observation order must be "asc" or "desc".`);
	return value;
}

export function normalizePiboAgentObservationLimit(value: number | undefined): number {
	if (value === undefined) return PIBO_AGENT_OBSERVATION_DEFAULT_LIMIT;
	if (!Number.isInteger(value) || value < 1 || value > PIBO_AGENT_OBSERVATION_MAX_LIMIT) {
		throw new Error(`Agent observation limit must be an integer from 1 to ${PIBO_AGENT_OBSERVATION_MAX_LIMIT}.`);
	}
	return value;
}

export function normalizePiboAgentObservationCursor(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 0) throw new Error("Agent observation afterSequence must be a non-negative integer.");
	return value;
}
