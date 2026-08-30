import type { PiboOutputEvent } from "../../core/events.js";

export type LiveOnlyOutputEvent = Extract<
	PiboOutputEvent,
	{ type: "assistant_delta" | "thinking_delta" | "tool_execution_updated" }
>;

export function isLiveOnlyOutputEvent(event: PiboOutputEvent): event is LiveOnlyOutputEvent {
	return event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated";
}

export function isPersistableOutputEvent(event: unknown): boolean {
	return isPiboOutputEvent(event) && !isLiveOnlyOutputEvent(event);
}

export function isPiboOutputEvent(value: unknown): value is PiboOutputEvent {
	if (!isRecord(value) || typeof value.type !== "string" || typeof value.piboSessionId !== "string") return false;
	if (value.eventId !== undefined && typeof value.eventId !== "string") return false;
	if (value.renderSequence !== undefined && !isPositiveSafeInteger(value.renderSequence)) return false;
	if (value.toolInvocationOrdinal !== undefined && !isNonNegativeSafeInteger(value.toolInvocationOrdinal)) return false;
	if (value.provenance !== undefined && !isMessageProvenance(value.provenance)) return false;

	switch (value.type) {
		case "message_queued":
			return typeof value.text === "string"
				&& isNonNegativeSafeInteger(value.queuedMessages)
				&& isOptionalEventSource(value.source);
		case "message_steered":
			return typeof value.text === "string"
				&& isOptionalEventSource(value.source)
				&& isOptionalString(value.activeEventId);
		case "message_started":
			return typeof value.text === "string" && isOptionalEventSource(value.source);
		case "assistant_delta":
		case "assistant_message":
			return typeof value.text === "string"
				&& isOptionalNonNegativeSafeInteger(value.assistantIndex)
				&& isOptionalNonNegativeSafeInteger(value.contentIndex);
		case "thinking_delta":
			return typeof value.text === "string"
				&& isOptionalNonNegativeSafeInteger(value.thinkingIndex)
				&& isOptionalNonNegativeSafeInteger(value.contentIndex);
		case "message_finished":
			return isOptionalEventSource(value.source);
		case "thinking_started":
			return isOptionalNonNegativeSafeInteger(value.thinkingIndex) && isOptionalNonNegativeSafeInteger(value.contentIndex);
		case "thinking_finished":
			return isOptionalString(value.text)
				&& isOptionalNonNegativeSafeInteger(value.thinkingIndex)
				&& isOptionalNonNegativeSafeInteger(value.contentIndex);
		case "tool_call":
			return hasOwn(value, "args")
				&& typeof value.toolCallId === "string"
				&& typeof value.toolName === "string"
				&& typeof value.argsComplete === "boolean"
				&& isOptionalString(value.intent);
		case "tool_execution_started":
			return hasOwn(value, "args")
				&& typeof value.toolCallId === "string"
				&& typeof value.toolName === "string"
				&& isOptionalString(value.intent);
		case "tool_execution_updated":
			return hasOwn(value, "args")
				&& hasOwn(value, "partialResult")
				&& typeof value.toolCallId === "string"
				&& typeof value.toolName === "string"
				&& isOptionalString(value.intent);
		case "tool_execution_finished":
			return hasOwn(value, "result")
				&& typeof value.toolCallId === "string"
				&& typeof value.toolName === "string"
				&& typeof value.isError === "boolean"
				&& isOptionalString(value.intent);
		case "subagent_session":
			return typeof value.toolName === "string"
				&& typeof value.subagentName === "string"
				&& typeof value.childPiboSessionId === "string"
				&& isOptionalString(value.requestId)
				&& isOptionalString(value.toolCallId)
				&& isOptionalString(value.threadKey);
		case "assistant_usage":
			return isFiniteNumber(value.totalTokens)
				&& isOptionalNonNegativeSafeInteger(value.usageIndex)
				&& ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"].every((key) => isOptionalFiniteNumber(value[key]))
				&& isOptionalFiniteNumber(value.costUsd);
		case "compaction_start":
			return typeof value.reason === "string" && isOptionalNonNegativeSafeInteger(value.compactionIndex);
		case "compaction_end":
			return typeof value.reason === "string"
				&& typeof value.aborted === "boolean"
				&& isOptionalNonNegativeSafeInteger(value.compactionIndex)
				&& isOptionalString(value.errorMessage);
		case "approval_requested":
			return isApprovalRequest(value.request);
		case "approval_resolved":
		case "user_input_resolved":
			return typeof value.requestId === "string" && isRuntimeRequestResolution(value.resolution);
		case "user_input_requested":
			return isUserInputRequest(value.request);
		case "execution_result":
			return typeof value.action === "string" && hasOwn(value, "result");
		case "session_error":
			return typeof value.error === "string" && (value.errorDetails === undefined || isRecord(value.errorDetails));
		case "pi_event":
			return hasOwn(value, "event");
		default:
			return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
	return value === undefined || isFiniteNumber(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isOptionalNonNegativeSafeInteger(value: unknown): boolean {
	return value === undefined || isNonNegativeSafeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRuntimeRequestResolution(value: unknown): boolean {
	return value === "responded" || value === "cleared" || value === "aborted" || value === "expired";
}

function isOptionalEventSource(value: unknown): boolean {
	return value === undefined || value === "user" || value === "ui" || value === "service" || value === "actor";
}

function isMessageProvenance(value: unknown): boolean {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	if (value.kind === "loop-run") {
		return typeof value.jobId === "string"
			&& typeof value.runId === "string"
			&& (value.cause === undefined || value.cause === "run-reminder")
			&& isOptionalString(value.rootEventId);
	}
	if (value.kind === "subagent-request") {
		return typeof value.requestId === "string"
			&& typeof value.controllerPiboSessionId === "string"
			&& isOptionalString(value.loopJobId)
			&& isOptionalString(value.loopRunId);
	}
	return false;
}

function isApprovalRequest(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.requestId === "string"
		&& typeof value.requestType === "string"
		&& isOptionalString(value.title)
		&& isOptionalString(value.detail)
		&& (value.decisions === undefined || (
			Array.isArray(value.decisions)
			&& value.decisions.every((decision) => isRecord(decision)
				&& typeof decision.id === "string"
				&& typeof decision.label === "string"
				&& isOptionalString(decision.description))
		));
}

function isUserInputRequest(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.requestId === "string"
		&& Array.isArray(value.questions)
		&& isOptionalBoolean(value.blocking)
		&& value.questions.every((question) => isRecord(question)
			&& typeof question.id === "string"
			&& typeof question.question === "string"
			&& isOptionalString(question.header)
			&& isOptionalBoolean(question.multiSelect)
			&& isOptionalBoolean(question.allowFreeform)
			&& isOptionalBoolean(question.secret)
			&& (question.options === undefined || (
				Array.isArray(question.options)
				&& question.options.every((option) => isRecord(option)
					&& typeof option.label === "string"
					&& isOptionalString(option.description))
			)));
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === "boolean";
}

export function assistantOutputKey(event: Extract<PiboOutputEvent, { type: "assistant_delta" | "assistant_message" }>): string {
	const partIndex = event.assistantIndex ?? event.contentIndex ?? 0;
	return [event.piboSessionId, event.eventId ?? "", partIndex].join(":");
}

export function thinkingOutputKey(
	event: Extract<PiboOutputEvent, { type: "thinking_started" | "thinking_delta" | "thinking_finished" }>,
): string {
	const partIndex = event.thinkingIndex ?? event.contentIndex ?? 0;
	return [event.piboSessionId, event.eventId ?? "", partIndex].join(":");
}

export function toolOutputKey(
	event: Extract<PiboOutputEvent, { type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" }>,
): string {
	return [event.piboSessionId, event.eventId ?? "", event.toolCallId, event.toolInvocationOrdinal ?? 0].join(":");
}
