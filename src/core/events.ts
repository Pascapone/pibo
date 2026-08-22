import type { PiboThinkingLevel } from "./thinking.js";

export type PiboEventSource = "user" | "ui" | "service" | "actor";
export type PiboMessageDelivery = "queue" | "steer";
export type PiboMessageCapabilityScope = "run-reminder";

export class PiboSteeringUnavailableError extends Error {
	constructor(message = "The active session cannot accept steering right now.", options?: ErrorOptions) {
		super(message, options);
		this.name = "PiboSteeringUnavailableError";
	}
}

export type PiboJsonValue =
	| null
	| boolean
	| number
	| string
	| PiboJsonValue[]
	| { [key: string]: PiboJsonValue };

export type PiboJsonObject = { [key: string]: PiboJsonValue };

export type PiboLoopMessageProvenance = {
	kind: "loop-run";
	jobId: string;
	runId: string;
};

export type PiboMessageProvenance = PiboLoopMessageProvenance;

export type PiboMessageEvent = {
	type: "message";
	piboSessionId: string;
	text: string;
	delivery?: PiboMessageDelivery;
	source?: PiboEventSource;
	capabilityScope?: PiboMessageCapabilityScope;
	id?: string;
	provenance?: PiboMessageProvenance;
};

export type BuiltinPiboExecutionAction = "status" | "session_id" | "clear_queue" | "abort" | "dispose" | "kill_all";

export type PiboSessionExecutionAction =
	| "session.current"
	| "session.list"
	| "session.fork_candidates"
	| "session.fork"
	| "session.clone"
	| "session.tree"
	| "session.tree_navigate"
	| "session.switch";

export type PiboThinkingExecutionAction = "thinking";

export type PiboRuntimeRequestExecutionAction =
	| "runtime.approval.respond"
	| "runtime.user_input.respond";

export type PiboExecutionAction =
	| BuiltinPiboExecutionAction
	| PiboSessionExecutionAction
	| PiboThinkingExecutionAction
	| PiboRuntimeRequestExecutionAction
	| (string & {});

export type PiboSessionForkParams = {
	entryId: string;
};

export type PiboSessionTreeNavigateParams = {
	entryId: string;
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
};

export type PiboSessionSwitchParams = {
	sessionFile: string;
	cwdOverride?: string;
};

export type PiboThinkingParams = {
	level?: PiboThinkingLevel;
};

export type PiboApprovalResponseParams = {
	requestId: string;
	decision: string;
};

export type PiboUserInputResponseParams = {
	requestId: string;
	answers: PiboJsonObject;
};

export type PiboThinkingResult = {
	level: PiboThinkingLevel;
	availableLevels: PiboThinkingLevel[];
	supported: boolean;
	action?: "show_thinking_menu" | "set_thinking_level";
	previousLevel?: PiboThinkingLevel;
	changed?: boolean;
};

export type PiboApprovalDecision = {
	id: string;
	label: string;
	description?: string;
};

export type PiboApprovalRequest = {
	requestId: string;
	requestType: string;
	title?: string;
	detail?: string;
	arguments?: PiboJsonValue;
	decisions?: readonly PiboApprovalDecision[];
};

export type PiboUserInputQuestion = {
	id: string;
	header?: string;
	question: string;
	options?: readonly { label: string; description?: string }[];
	multiSelect?: boolean;
	allowFreeform?: boolean;
	secret?: boolean;
};

export type PiboUserInputRequest = {
	requestId: string;
	questions: readonly PiboUserInputQuestion[];
	blocking?: boolean;
};

export type PiboRuntimeRequestResolution = "responded" | "cleared" | "aborted" | "expired";

export type PiboExecutionEventBase<TAction extends PiboExecutionAction = PiboExecutionAction> = {
	type: "execution";
	piboSessionId: string;
	action: TAction;
	id?: string;
};

export type PiboNoParamsExecutionEvent = PiboExecutionEventBase<
	| BuiltinPiboExecutionAction
	| "session.current"
	| "session.list"
	| "session.fork_candidates"
	| "session.clone"
	| "session.tree"
>;

export type PiboSessionForkEvent = PiboExecutionEventBase<"session.fork"> & {
	params: PiboSessionForkParams;
};

export type PiboSessionTreeNavigateEvent = PiboExecutionEventBase<"session.tree_navigate"> & {
	params: PiboSessionTreeNavigateParams;
};

export type PiboSessionSwitchEvent = PiboExecutionEventBase<"session.switch"> & {
	params: PiboSessionSwitchParams;
};

export type PiboThinkingEvent = PiboExecutionEventBase<"thinking"> & {
	params?: PiboThinkingParams;
};

export type PiboApprovalResponseEvent = PiboExecutionEventBase<"runtime.approval.respond"> & {
	params: PiboApprovalResponseParams;
};

export type PiboUserInputResponseEvent = PiboExecutionEventBase<"runtime.user_input.respond"> & {
	params: PiboUserInputResponseParams;
};

export type PiboKnownExecutionEvent =
	| PiboNoParamsExecutionEvent
	| PiboSessionForkEvent
	| PiboSessionTreeNavigateEvent
	| PiboSessionSwitchEvent
	| PiboThinkingEvent
	| PiboApprovalResponseEvent
	| PiboUserInputResponseEvent;

export type PiboCustomExecutionEvent = PiboExecutionEventBase<string & {}> & {
	params?: PiboJsonValue;
};

export type PiboExecutionEvent = PiboKnownExecutionEvent | PiboCustomExecutionEvent;

export type PiboInputEvent = PiboMessageEvent | PiboExecutionEvent;

export type PiboSessionStatus = {
	piboSessionId: string;
	activeModel?: { provider: string; id: string };
	runtimeBinding?: {
		runtimeInstanceId: string;
		adapterId: string;
		nativeSessionId?: string;
		state: "unbound" | "bound" | "missing" | "error";
		protocol?: string;
		protocolVersion?: string;
		adapterVersion?: string;
		revision?: number;
	};
	queuedMessages: number;
	processing: boolean;
	streaming: boolean;
	/** @deprecated Use enabledTools. This lists configured/available tools, not currently executing tool calls. */
	activeTools: string[];
	enabledTools: string[];
	cwd: string;
	disposed: boolean;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
	retry?: {
		enabled: boolean;
		maxRetries: number;
		baseDelayMs: number;
		provider: { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number };
	};
	contextUsage?: { tokens?: number; contextWindow?: number; percent?: number } | null;
	providerUsage?: {
		provider?: string;
		planType?: string;
		limits?: readonly { label?: string; usedPercent?: number; remainingPercent?: number; resetsAt?: string }[];
		credits?: { unlimited?: boolean; balance?: string };
	} | null;
	warnings?: readonly string[];
	errors?: readonly string[];
	pendingApprovals?: readonly PiboApprovalRequest[];
	pendingUserInputs?: readonly PiboUserInputRequest[];
};

export type PiboPiSessionSnapshot = {
	piSessionId: string;
	sessionFile?: string;
	leafId: string | null;
	cwd: string;
	sessionName?: string;
	parentSessionFile?: string;
};

export type PiboSessionOperationResult = {
	piboSessionId: string;
	previous: PiboPiSessionSnapshot;
	current: PiboPiSessionSnapshot;
	cancelled: boolean;
	selectedText?: string;
	editorText?: string;
	summaryEntryId?: string;
};

export type PiboForkCandidate = {
	entryId: string;
	text: string;
};

export type PiboSessionListItem = {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
};

export type PiboSessionTreeNode = {
	entry: PiboJsonObject;
	children: PiboSessionTreeNode[];
	label?: string;
	labelTimestamp?: string;
};

export type PiboSessionTreeResult = {
	current: PiboPiSessionSnapshot;
	tree: PiboSessionTreeNode[];
};

export type PiboMessageQueuedEvent = {
	type: "message_queued";
	piboSessionId: string;
	eventId?: string;
	queuedMessages: number;
	text: string;
	source?: PiboEventSource;
	provenance?: PiboMessageProvenance;
};

export type PiboMessageSteeredEvent = {
	type: "message_steered";
	piboSessionId: string;
	eventId?: string;
	activeEventId?: string;
	text: string;
	source?: PiboEventSource;
	provenance?: PiboMessageProvenance;
};

export type PiboMessageStartedEvent = {
	type: "message_started";
	piboSessionId: string;
	eventId?: string;
	text: string;
	source?: PiboEventSource;
	provenance?: PiboMessageProvenance;
};

export type PiboAssistantMessageEvent = {
	type: "assistant_message";
	piboSessionId: string;
	eventId?: string;
	assistantIndex?: number;
	contentIndex?: number;
	text: string;
	provenance?: PiboMessageProvenance;
};

export type PiboAssistantUsageEvent = {
	type: "assistant_usage";
	piboSessionId: string;
	eventId?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalTokens: number;
	provenance?: PiboMessageProvenance;
};

export type PiboSubagentSessionEvent = {
	type: "subagent_session";
	piboSessionId: string;
	toolCallId?: string;
	toolName: string;
	subagentName: string;
	childPiboSessionId: string;
	threadKey?: string;
};

export type PiboThinkingStartedEvent = {
	type: "thinking_started";
	piboSessionId: string;
	eventId?: string;
	contentIndex?: number;
	thinkingIndex?: number;
};

export type PiboThinkingDeltaEvent = {
	type: "thinking_delta";
	piboSessionId: string;
	eventId?: string;
	contentIndex?: number;
	thinkingIndex?: number;
	text: string;
};

export type PiboThinkingFinishedEvent = {
	type: "thinking_finished";
	piboSessionId: string;
	eventId?: string;
	contentIndex?: number;
	thinkingIndex?: number;
	text?: string;
};

export type PiboToolCallEvent = {
	type: "tool_call";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	argsComplete: boolean;
	intent?: string;
};

export type PiboToolExecutionStartedEvent = {
	type: "tool_execution_started";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	intent?: string;
};

export type PiboToolExecutionUpdatedEvent = {
	type: "tool_execution_updated";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	partialResult: unknown;
	intent?: string;
};

export type PiboToolExecutionFinishedEvent = {
	type: "tool_execution_finished";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
	intent?: string;
};

export type PiboCompactionStartEvent = {
	type: "compaction_start";
	piboSessionId: string;
	eventId?: string;
	reason: string;
};

export type PiboCompactionEndEvent = {
	type: "compaction_end";
	piboSessionId: string;
	eventId?: string;
	reason: string;
	result?: unknown;
	aborted: boolean;
	errorMessage?: string;
};

export type PiboApprovalRequestedEvent = {
	type: "approval_requested";
	piboSessionId: string;
	eventId?: string;
	request: PiboApprovalRequest;
};

export type PiboApprovalResolvedEvent = {
	type: "approval_resolved";
	piboSessionId: string;
	eventId?: string;
	requestId: string;
	resolution: PiboRuntimeRequestResolution;
};

export type PiboUserInputRequestedEvent = {
	type: "user_input_requested";
	piboSessionId: string;
	eventId?: string;
	request: PiboUserInputRequest;
};

export type PiboUserInputResolvedEvent = {
	type: "user_input_resolved";
	piboSessionId: string;
	eventId?: string;
	requestId: string;
	resolution: PiboRuntimeRequestResolution;
};

export type PiboSessionErrorClass =
	| "provider_transport"
	| "provider_context"
	| "provider_auth"
	| "provider_rate_limit"
	| "provider_server"
	| "provider_error"
	| "transcript_integrity"
	| "runtime_abort"
	| "runtime_error"
	| "unknown";

export type PiboSessionErrorDetails = {
	category?: string;
	errorClass?: PiboSessionErrorClass;
	code?: string;
	origin?: "provider" | "runtime" | "gateway" | "system" | "unknown";
	severity?: "error" | "fatal";
	retryable?: boolean;
	userMessage?: string;
	providerType?: string;
	providerCode?: string;
	providerParam?: string;
	providerMessage?: string;
	api?: string;
	provider?: string;
	model?: string;
	contextWindow?: number;
	contextTokens?: number;
};

export type PiboOutputEvent =
	| PiboMessageQueuedEvent
	| PiboMessageSteeredEvent
	| PiboMessageStartedEvent
	| { type: "message_finished"; piboSessionId: string; eventId?: string; source?: PiboEventSource; provenance?: PiboMessageProvenance }
	| { type: "assistant_delta"; piboSessionId: string; eventId?: string; assistantIndex?: number; contentIndex?: number; text: string }
	| PiboThinkingStartedEvent
	| PiboThinkingDeltaEvent
	| PiboThinkingFinishedEvent
	| PiboToolCallEvent
	| PiboToolExecutionStartedEvent
	| PiboToolExecutionUpdatedEvent
	| PiboToolExecutionFinishedEvent
	| PiboSubagentSessionEvent
	| PiboAssistantMessageEvent
	| PiboAssistantUsageEvent
	| PiboCompactionStartEvent
	| PiboCompactionEndEvent
	| PiboApprovalRequestedEvent
	| PiboApprovalResolvedEvent
	| PiboUserInputRequestedEvent
	| PiboUserInputResolvedEvent
	| { type: "execution_result"; piboSessionId: string; eventId?: string; action: PiboExecutionAction; result: unknown }
	| { type: "session_error"; piboSessionId: string; eventId?: string; error: string; errorDetails?: PiboSessionErrorDetails; provenance?: PiboMessageProvenance }
	| { type: "pi_event"; piboSessionId: string; event: unknown };

export type PiboEventListener = (event: PiboOutputEvent) => void;
