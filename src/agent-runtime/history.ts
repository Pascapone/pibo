import type { PiboJsonObject, PiboJsonValue } from "../core/events.js";
import type { RuntimeSessionBinding } from "../sessions/runtime-binding.js";
import type { AgentRuntimeDiagnostic } from "./types.js";

export type AgentRuntimeHistorySource = "product" | "native";

export type AgentRuntimeHistoryTextPart = {
	type: "text";
	text: string;
};

export type AgentRuntimeHistoryReasoningPart = {
	type: "reasoning";
	text: string;
};

export type AgentRuntimeHistoryToolCallPart = {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input?: PiboJsonValue;
};

export type AgentRuntimeHistoryContentPart =
	| AgentRuntimeHistoryTextPart
	| AgentRuntimeHistoryReasoningPart
	| AgentRuntimeHistoryToolCallPart;

export type AgentRuntimeHistoryMessageStatus = "complete" | "running" | "error";

export type AgentRuntimeHistoryMessageEntry = {
	id: string;
	type: "message";
	source: AgentRuntimeHistorySource;
	createdAt: string;
	sequence?: number;
	turnId?: string;
	nativeTurnId?: string;
	nativeEntryId?: string;
	role: "user" | "assistant" | "tool" | "system";
	content: string | readonly AgentRuntimeHistoryContentPart[];
	assistantIndex?: number;
	contentIndex?: number;
	status?: AgentRuntimeHistoryMessageStatus;
	error?: string;
	toolCallId?: string;
	toolName?: string;
	result?: PiboJsonValue;
	isError?: boolean;
	metadata?: PiboJsonObject;
};

export type AgentRuntimeHistorySessionInfoEntry = {
	id: string;
	type: "session_info";
	source: AgentRuntimeHistorySource;
	createdAt: string;
	sequence?: number;
	nativeEntryId?: string;
	name: string;
	metadata?: PiboJsonObject;
};

export type AgentRuntimeHistoryEntry =
	| AgentRuntimeHistoryMessageEntry
	| AgentRuntimeHistorySessionInfoEntry;

export type AgentRuntimeHistoryInspection = {
	runtimeInstanceId: string;
	adapterId: string;
	bindingState: RuntimeSessionBinding["state"];
	available: boolean;
	locator?: RuntimeSessionBinding["locator"];
	title?: string;
	firstMessage?: string;
	createdAt?: string;
	updatedAt?: string;
	entryCount?: number;
	sizeBytes?: number;
	version?: string;
	diagnostics: readonly AgentRuntimeDiagnostic[];
};

export type AgentRuntimeHistoryPage = {
	runtimeInstanceId: string;
	adapterId: string;
	source: "native";
	entries: readonly AgentRuntimeHistoryEntry[];
	orderOffset?: number;
	nextCursor?: string;
	hasMore: boolean;
	inspection?: AgentRuntimeHistoryInspection;
};

export type InspectAgentRuntimeHistoryInput = {
	binding: RuntimeSessionBinding;
	workspace: string;
};

export type ReadAgentRuntimeHistoryInput = InspectAgentRuntimeHistoryInput & {
	cursor?: string;
	beforeTimestamp?: string;
	limit?: number;
};
