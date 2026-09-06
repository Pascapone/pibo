import type { PiboJsonValue, PiboOutputEvent } from "../core/events.js";

export type PiboAgentObservationKind = "message" | "thinking" | "tool" | "error" | "lifecycle" | "event";
export type PiboAgentObservationOrder = "asc" | "desc";
export type PiboAgentObservationCursorMode = "auto" | "history";
export type PiboAgentObservationToolDetail = "summary" | "full";

export const PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES = 4 * 1024;
export const PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES = 768;
export const PIBO_AGENT_OBSERVATION_DETAILS_MAX_BYTES = 32 * 1024;
export const PIBO_AGENT_OBSERVATION_DEFAULT_LIMIT = 20;
export const PIBO_AGENT_OBSERVATION_MAX_LIMIT = 200;
export const PIBO_AGENT_OBSERVATION_DEFAULT_EVENT_TYPES = ["assistant_message"] as const;
export const PIBO_AGENT_OBSERVATION_DEFAULT_TOOL_EVENT_TYPES = ["tool_call", "tool_execution_finished"] as const;

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

function boundPiboAgentObservationTextBytes(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	const suffix = "…";
	let end = Math.min(value.length, maxBytes);
	while (end > 0 && Buffer.byteLength(`${value.slice(0, end)}${suffix}`, "utf8") > maxBytes) end -= 1;
	return `${value.slice(0, end)}${suffix}`;
}

export function boundPiboAgentObservationText(value: string): string {
	return boundPiboAgentObservationTextBytes(value, PIBO_AGENT_OBSERVATION_TEXT_MAX_BYTES);
}

function piboAgentToolSummaryValue(value: unknown): unknown {
	if (typeof value === "string") {
		return boundPiboAgentObservationTextBytes(value, 256);
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	return undefined;
}

function piboAgentToolSummarySource(text: string | undefined, details: unknown): unknown {
	if (details && typeof details === "object" && !Array.isArray(details)) {
		const record = details as Record<string, unknown>;
		if (record.result !== undefined) return record.result;
		if (record.args !== undefined) return record.args;
		if (record.partialResult !== undefined) return record.partialResult;
		if (!text && record.truncated === true && typeof record.preview === "string") return record.preview;
	}
	if (!text) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function piboAgentToolSummaryPreview(value: unknown): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(value) ?? String(value);
	} catch {
		try {
			serialized = String(value);
		} catch {
			serialized = "[unserializable tool value]";
		}
	}
	return boundPiboAgentObservationTextBytes(serialized.replace(/\s+/g, " ").trim(), 512);
}

export function piboAgentObservationToolSummary(
	text: string | undefined,
	isError?: boolean,
	details?: unknown,
): string | undefined {
	const parsed = piboAgentToolSummarySource(text, details);
	if (parsed === undefined) return isError ? "{\"isError\":true}" : undefined;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return boundPiboAgentObservationTextBytes(String(parsed).replace(/\s+/g, " ").trim(), PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES);
	}
	const record = parsed as Record<string, unknown>;
	const summary: Record<string, unknown> = {};
	for (const key of ["status", "exitCode", "durationMs", "command", "path", "pattern", "query", "runId"]) {
		const value = piboAgentToolSummaryValue(record[key]);
		if (value !== undefined) summary[key] = value;
	}
	const output = typeof record.output === "string"
		? record.output
		: typeof record.delta === "string"
			? record.delta
			: undefined;
	if (output !== undefined) {
		summary.outputBytes = Buffer.byteLength(output, "utf8");
		summary.outputPreview = boundPiboAgentObservationTextBytes(output.replace(/\s+/g, " ").trim(), 256);
	}
	if (Object.keys(summary).length === 0) {
		summary.preview = piboAgentToolSummaryPreview(parsed);
	}
	if (isError === true) summary.isError = true;
	return boundPiboAgentObservationTextBytes(JSON.stringify(summary), PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES);
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
	if (value === undefined) return "desc";
	if (value !== "asc" && value !== "desc") throw new Error(`Agent observation order must be "asc" or "desc".`);
	return value;
}

export function normalizePiboAgentObservationCursorMode(
	value: PiboAgentObservationCursorMode | undefined,
): PiboAgentObservationCursorMode {
	if (value === undefined) return "auto";
	if (value !== "auto" && value !== "history") {
		throw new Error(`Agent observation cursorMode must be "auto" or "history".`);
	}
	return value;
}

export function normalizePiboAgentObservationToolDetail(
	value: PiboAgentObservationToolDetail | undefined,
): PiboAgentObservationToolDetail {
	if (value === undefined) return "summary";
	if (value !== "summary" && value !== "full") {
		throw new Error(`Agent observation toolDetail must be "summary" or "full".`);
	}
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
