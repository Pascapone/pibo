import type { PiboThinkingLevel } from "./thinking.js";

export type PiboEventSource = "user" | "ui" | "service" | "actor";

export type PiboJsonValue =
	| null
	| boolean
	| number
	| string
	| PiboJsonValue[]
	| { [key: string]: PiboJsonValue };

export type PiboJsonObject = { [key: string]: PiboJsonValue };

export type PiboMessageEvent = {
	type: "message";
	piboSessionId: string;
	text: string;
	source?: PiboEventSource;
	id?: string;
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

export type PiboExecutionAction =
	| BuiltinPiboExecutionAction
	| PiboSessionExecutionAction
	| PiboThinkingExecutionAction
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

export type PiboThinkingResult = {
	level: PiboThinkingLevel;
	availableLevels: PiboThinkingLevel[];
	supported: boolean;
};

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

export type PiboKnownExecutionEvent =
	| PiboNoParamsExecutionEvent
	| PiboSessionForkEvent
	| PiboSessionTreeNavigateEvent
	| PiboSessionSwitchEvent
	| PiboThinkingEvent;

export type PiboCustomExecutionEvent = PiboExecutionEventBase<string & {}> & {
	params?: PiboJsonValue;
};

export type PiboExecutionEvent = PiboKnownExecutionEvent | PiboCustomExecutionEvent;

export type PiboInputEvent = PiboMessageEvent | PiboExecutionEvent;

export type PiboSessionStatus = {
	piboSessionId: string;
	queuedMessages: number;
	processing: boolean;
	streaming: boolean;
	activeTools: string[];
	cwd: string;
	disposed: boolean;
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
};

export type PiboMessageStartedEvent = {
	type: "message_started";
	piboSessionId: string;
	eventId?: string;
	text: string;
	source?: PiboEventSource;
};

export type PiboAssistantMessageEvent = {
	type: "assistant_message";
	piboSessionId: string;
	eventId?: string;
	assistantIndex?: number;
	contentIndex?: number;
	text: string;
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
};

export type PiboToolExecutionStartedEvent = {
	type: "tool_execution_started";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type PiboToolExecutionUpdatedEvent = {
	type: "tool_execution_updated";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	partialResult: unknown;
};

export type PiboToolExecutionFinishedEvent = {
	type: "tool_execution_finished";
	piboSessionId: string;
	eventId?: string;
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
};

export type PiboCompactionStartEvent = {
	type: "compaction_start";
	piboSessionId: string;
	reason: string;
};

export type PiboCompactionEndEvent = {
	type: "compaction_end";
	piboSessionId: string;
	reason: string;
	result?: unknown;
	aborted: boolean;
	errorMessage?: string;
};

export type PiboOutputEvent =
	| PiboMessageQueuedEvent
	| PiboMessageStartedEvent
	| { type: "message_finished"; piboSessionId: string; eventId?: string; source?: PiboEventSource }
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
	| PiboCompactionStartEvent
	| PiboCompactionEndEvent
	| { type: "execution_result"; piboSessionId: string; eventId?: string; action: PiboExecutionAction; result: unknown }
	| { type: "session_error"; piboSessionId: string; eventId?: string; error: string }
	| { type: "pi_event"; piboSessionId: string; event: unknown };

export type PiboEventListener = (event: PiboOutputEvent) => void;
