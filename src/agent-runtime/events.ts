import type { PiboJsonObject, PiboJsonValue, PiboSessionErrorDetails } from "../core/events.js";

export type AgentRuntimeUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	totalTokens: number;
	contextWindow?: number;
};

export type AgentRuntimeApprovalDecision = {
	id: string;
	label: string;
	description?: string;
};

export type AgentRuntimeApprovalRequest = {
	requestId: string;
	requestType: string;
	title?: string;
	detail?: string;
	arguments?: PiboJsonValue;
	decisions?: readonly AgentRuntimeApprovalDecision[];
};

export type AgentRuntimeUserInputQuestion = {
	id: string;
	header?: string;
	question: string;
	options?: readonly { label: string; description?: string }[];
	multiSelect?: boolean;
	allowFreeform?: boolean;
	secret?: boolean;
};

export type AgentRuntimeUserInputRequest = {
	requestId: string;
	questions: readonly AgentRuntimeUserInputQuestion[];
	blocking?: boolean;
};

export type AgentRuntimeRequestResolution = "responded" | "cleared" | "aborted" | "expired";

export type AgentRuntimeSemanticEvent =
	| { type: "turn_started"; turnId?: string }
	| { type: "turn_completed"; turnId?: string; status?: string }
	| { type: "turn_failed"; turnId?: string; message: string; details?: PiboSessionErrorDetails }
	| { type: "adapter_lifecycle"; state: "starting" | "ready" | "restarting" | "stopped" | "crashed"; message?: string }
	| { type: "assistant_delta"; text: string; contentIndex?: number }
	| { type: "assistant_message"; text: string; contentIndex?: number }
	| { type: "reasoning_started"; contentIndex?: number }
	| { type: "reasoning_delta"; text: string; contentIndex?: number }
	| { type: "reasoning_finished"; text?: string; contentIndex?: number }
	| { type: "tool_call"; toolCallId: string; toolName: string; args: unknown; argsComplete: boolean; intent?: string }
	| { type: "tool_execution_started"; toolCallId: string; toolName: string; args: unknown; intent?: string }
	| { type: "tool_execution_updated"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown; intent?: string }
	| { type: "tool_execution_finished"; toolCallId: string; toolName: string; result: unknown; isError: boolean; intent?: string }
	| { type: "usage"; usage: AgentRuntimeUsage }
	| { type: "plan_updated"; plan: PiboJsonValue }
	| { type: "diff_updated"; diff: PiboJsonValue }
	| { type: "compaction_start"; reason: string }
	| { type: "compaction_end"; reason: string; result?: unknown; aborted: boolean; errorMessage?: string }
	| { type: "approval_requested"; request: AgentRuntimeApprovalRequest }
	| { type: "approval_resolved"; requestId: string; resolution: AgentRuntimeRequestResolution }
	| { type: "user_input_requested"; request: AgentRuntimeUserInputRequest }
	| { type: "user_input_resolved"; requestId: string; resolution: AgentRuntimeRequestResolution }
	| { type: "warning"; message: string; details?: PiboJsonObject }
	| { type: "error"; message: string; details?: PiboSessionErrorDetails }
	| { type: "native_event"; event: unknown; redacted?: boolean };

export type AgentRuntimeEventListener = (event: AgentRuntimeSemanticEvent) => void;
