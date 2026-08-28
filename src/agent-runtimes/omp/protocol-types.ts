/**
 * OMP RPC protocol wire types (read-only mirror of the OMP `--mode rpc`
 * JSON-lines-over-stdio protocol from `@oh-my-pi/pi-coding-agent`).
 *
 * These are Pibo-owned, structurally-typed representations of the wire frames
 * OMP emits/receives. They intentionally do NOT import from `@oh-my-pi/*`
 * (which is Bun-only and cannot be imported under Node). Field names and shapes
 * mirror OMP's `packages/coding-agent/src/modes/rpc/rpc-types.ts` and the
 * session/agent event unions so the Pibo OMP adapter can speak the protocol
 * without depending on the Bun runtime.
 */

export const OMP_RPC_PROTOCOL_NAME = "omp-rpc";
export const OMP_RPC_PROTOCOL_VERSION = 2;
export const OMP_RPC_SUPPORTED_PROTOCOL_VERSIONS = [1, 2] as const;
export const OMP_RPC_MAX_FRAME_BYTES = 1024 * 1024;
export const OMP_RPC_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
export const OMP_RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Command (stdin)
// ---------------------------------------------------------------------------

export type OmpRpcThinkingLevel = "none" | "low" | "medium" | "high" | string;
export type OmpRpcEffort = "low" | "medium" | "high" | "none" | string;

export type OmpRpcTodoPhase = {
	name: string;
	status?: string;
};

export type OmpRpcImageContent = {
	type: "image";
	source?: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
	data?: string;
	media_type?: string;
};

export type OmpRpcHostToolParameterSchema = {
	type?: string;
	properties?: Record<string, unknown>;
	required?: readonly string[];
	additionalProperties?: boolean;
	[extra: string]: unknown;
};

export type OmpRpcHostToolDefinition = {
	name: string;
	description: string;
	parameters: OmpRpcHostToolParameterSchema;
	/** Streaming partial-result delivery requested by the host. */
	stream?: boolean;
	[extra: string]: unknown;
};

export type OmpRpcHostUriSchemeDefinition = {
	scheme: string;
	description?: string;
	read: boolean;
	write: boolean;
};

export type OmpRpcHostToolResult = {
	content: unknown;
	isError?: boolean;
};

export type OmpRpcHostUriResult = {
	value: string;
	mimeType?: string;
};

export type OmpRpcSubagentSubscriptionLevel = "off" | "progress" | "events";

export type OmpRpcCommand =
	// Protocol
	| { id?: string; type: "negotiate_protocol"; protocolVersion: number }
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: OmpRpcImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: OmpRpcImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: OmpRpcImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "abort_and_prompt"; message: string; images?: OmpRpcImageContent[] }
	| { id?: string; type: "new_session"; parentSession?: string }
	// State
	| { id?: string; type: "get_state" }
	| { id?: string; type: "set_fast_mode"; enabled: boolean }
	| { id?: string; type: "get_available_commands" }
	| { id?: string; type: "set_todos"; phases: OmpRpcTodoPhase[] }
	| { id?: string; type: "set_host_tools"; tools: OmpRpcHostToolDefinition[] }
	| { id?: string; type: "set_host_uri_schemes"; schemes: OmpRpcHostUriSchemeDefinition[] }
	| { id?: string; type: "set_subagent_subscription"; level: OmpRpcSubagentSubscriptionLevel }
	| { id?: string; type: "get_subagents" }
	| { id?: string; type: "get_subagent_messages"; subagentId?: string; sessionFile?: string; fromByte?: number }
	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	// Thinking
	| { id?: string; type: "set_thinking_level"; level: OmpRpcThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }
	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_interrupt_mode"; mode: "immediate" | "wait" }
	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }
	// Bash
	| { id?: string; type: "bash"; command: string }
	| { id?: string; type: "abort_bash" }
	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork" | "branch"; entryId: string }
	| { id?: string; type: "get_fork_messages" | "get_branch_messages" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	| { id?: string; type: "handoff"; customInstructions?: string }
	// Messages
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }
	// Login
	| { id?: string; type: "get_login_providers" }
	| { id?: string; type: "login"; providerId: string };

export type OmpRpcCommandType = OmpRpcCommand["type"];

// ---------------------------------------------------------------------------
// Events (stdin side-channels, host → server)
// ---------------------------------------------------------------------------

export type OmpRpcHostToolUpdate = {
	type: "host_tool_update";
	toolCallId: string;
	partialResult: unknown;
};

export type OmpRpcHostToolResultFrame = {
	type: "host_tool_result";
	toolCallId: string;
	result: OmpRpcHostToolResult | string;
};

export type OmpRpcHostUriResultFrame = {
	type: "host_uri_result";
	requestId: string;
	result: OmpRpcHostUriResult | null;
	isError?: boolean;
};

export type OmpRpcExtensionUIResponse = {
	type: "extension_ui_response";
	requestId: string;
	data: unknown;
};

export type OmpRpcClientSideChannel =
	| OmpRpcHostToolUpdate
	| OmpRpcHostToolResultFrame
	| OmpRpcHostUriResultFrame
	| OmpRpcExtensionUIResponse;

// ---------------------------------------------------------------------------
// Responses (stdout, correlation by id)
// ---------------------------------------------------------------------------

export type OmpRpcSessionState = {
	model?: unknown;
	thinkingLevel?: OmpRpcThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	interruptMode: "immediate" | "wait";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	fastModeEnabled: boolean;
	fastModeActive: boolean;
	tokensPerSecond: number | null;
	messageCount: number;
	queuedMessageCount: number;
	todoPhases: OmpRpcTodoPhase[];
	systemPrompt?: string[];
	dumpTools?: Array<{ name: string; description: string; parameters: unknown }>;
	contextUsage?: { tokens?: number; contextWindow?: number; percent?: number };
};

export type OmpRpcAvailableSlashCommandSource = "builtin" | "skill" | "extension" | "custom" | "mcp_prompt" | "file" | string;

export type OmpRpcAvailableSlashCommand = {
	name: string;
	aliases?: string[];
	description?: string;
	input?: { hint?: string };
	subcommands?: Array<{ name: string; description?: string; usage?: string }>;
	source: OmpRpcAvailableSlashCommandSource;
};

export type OmpRpcBashResult = {
	output: string;
	exitCode: number | null;
	stderr?: string;
};

export type OmpRpcLoginProvider = {
	id: string;
	name: string;
	available: boolean;
	authenticated: boolean;
};

export type OmpRpcMessagesPage = {
	messages: unknown[];
	nextCursor?: string;
	totalMessages: number;
};

export type OmpRpcResponse =
	| { id?: string; type: "response"; command: "negotiate_protocol"; success: true; data: { protocolVersion: number } }
	| { id?: string; type: "response"; command: "prompt"; success: true; data?: { agentInvoked: boolean } }
	| { id?: string; type: "response"; command: "steer" | "follow_up" | "abort" | "abort_and_prompt"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "get_state"; success: true; data: OmpRpcSessionState }
	| { id?: string; type: "response"; command: "set_fast_mode"; success: true; data: { enabled: boolean; active: boolean } }
	| { id?: string; type: "response"; command: "get_available_commands"; success: true; data: { commands: OmpRpcAvailableSlashCommand[] } }
	| { id?: string; type: "response"; command: "set_todos"; success: true; data: { todoPhases: OmpRpcTodoPhase[] } }
	| { id?: string; type: "response"; command: "set_host_tools"; success: true; data: { toolNames: string[] } }
	| { id?: string; type: "response"; command: "set_host_uri_schemes"; success: true; data: { schemes: string[] } }
	| { id?: string; type: "response"; command: "set_subagent_subscription"; success: true; data: { level: OmpRpcSubagentSubscriptionLevel } }
	| { id?: string; type: "response"; command: "get_subagents"; success: true; data: { subagents: unknown[] } }
	| { id?: string; type: "response"; command: "get_subagent_messages"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "set_model"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "cycle_model"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "get_available_models"; success: true; data: { models: unknown[] } }
	| { id?: string; type: "response"; command: "set_thinking_level" | "cycle_thinking_level" | "set_steering_mode" | "set_follow_up_mode" | "set_interrupt_mode" | "set_auto_compaction" | "set_auto_retry" | "abort_retry" | "abort_bash" | "set_session_name"; success: true }
	| { id?: string; type: "response"; command: "compact"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "bash"; success: true; data: OmpRpcBashResult }
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "fork" | "branch"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "get_fork_messages" | "get_branch_messages"; success: true; data: { messages: Array<{ entryId: string; text: string }> } }
	| { id?: string; type: "response"; command: "get_last_assistant_text"; success: true; data: { text: string | null } }
	| { id?: string; type: "response"; command: "handoff"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: unknown[] } }
	| { id?: string; type: "response"; command: "get_messages_page"; success: true; data: OmpRpcMessagesPage }
	| { id?: string; type: "response"; command: "get_login_providers"; success: true; data: { providers: OmpRpcLoginProvider[] } }
	| { id?: string; type: "response"; command: "login"; success: true; data: { providerId: string } }
	| { id?: string; type: "response"; command: string; success: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Frames (stdout)
// ---------------------------------------------------------------------------

export type OmpRpcReadyFrame = {
	type: "ready";
	protocolVersion: 1;
	supportedProtocolVersions: readonly number[];
	maxFrameBytes: number;
	maxReassembledFrameBytes: number;
};

export type OmpRpcChunkFrame = {
	type: "rpc_chunk";
	chunkId: string;
	index: number;
	count: number;
	byteLength: number;
	data: string;
};

export type OmpRpcPromptResultFrame = {
	type: "prompt_result";
	id?: string;
	agentInvoked: boolean;
};

export type OmpRpcAvailableCommandsUpdateFrame = {
	type: "available_commands_update";
	commands: OmpRpcAvailableSlashCommand[];
};

export type OmpRpcSessionInfoUpdateFrame = {
	type: "session_info_update";
	title?: string;
	sessionId?: string;
};

export type OmpRpcConfigUpdateFrame = {
	type: "config_update";
	model?: unknown;
	thinkingLevel?: unknown;
};

export type OmpRpcCommandOutputFrame = {
	type: "command_output";
	text: string;
};

export type OmpRpcExtensionErrorFrame = {
	type: "extension_error";
	extensionPath?: string;
	event?: string;
	error?: unknown;
};

export type OmpRpcSessionShutdownFrame = {
	type: "session_shutdown";
};

// --- Assistant streaming events (inside message_update) ---

export type OmpRpcToolCall = {
	id: string;
	name: string;
	arguments?: unknown;
};

export type OmpRpcAssistantMessageEvent =
	| { type: "start"; partial: unknown }
	| { type: "text_start"; contentIndex: number; partial: unknown }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: unknown }
	| { type: "text_end"; contentIndex: number; content: string; partial: unknown }
	| { type: "thinking_start"; contentIndex: number; partial: unknown }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: unknown }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: unknown }
	| { type: "image_end"; contentIndex: number; content: unknown; partial: unknown }
	| { type: "toolcall_start"; contentIndex: number; partial: unknown }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: unknown }
	| { type: "toolcall_end"; contentIndex: number; toolCall: OmpRpcToolCall; partial: unknown }
	| { type: "done"; reason: "stop" | "length" | "toolUse"; message: unknown }
	| { type: "error"; reason: "aborted" | "error"; error: unknown };

// --- Agent session events ---

export type OmpRpcAgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages?: unknown[]; isTerminal?: boolean; willContinue?: boolean }
	| { type: "turn_start" }
	| { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
	| { type: "message_start"; message: unknown }
	| { type: "message_update"; message: unknown; assistantMessageEvent?: OmpRpcAssistantMessageEvent }
	| { type: "message_end"; message: unknown }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown; intent?: string }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError?: boolean }
	| { type: "auto_compaction_start"; reason: string; action?: string }
	| { type: "auto_compaction_end"; action: string; aborted: boolean; willRetry: boolean; result?: unknown; errorMessage?: string; skipped?: boolean }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string; errorId?: number }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "retry_fallback_applied"; from: string; to: string; role: string }
	| { type: "retry_fallback_succeeded"; model: string; role: string }
	| { type: "model_changed" }
	| { type: "ttsr_triggered"; rules: unknown[] }
	| { type: "todo_reminder"; todos: unknown[]; attempt: number; maxAttempts: number }
	| { type: "todo_auto_clear" }
	| { type: "irc_message"; message: unknown }
	| { type: "notice"; level: "info" | "warning" | "error"; message: string; source?: string }
	| { type: "thinking_level_changed"; thinkingLevel: unknown; configured?: unknown; resolved?: unknown }
	| { type: "goal_updated"; goal: unknown; state?: unknown };

// --- Host / extension / subagent frames (stdout) ---

export type OmpRpcHostToolCallRequest = {
	type: "host_tool_call";
	toolCallId: string;
	toolName: string;
	arguments: unknown;
};

export type OmpRpcHostToolCancelRequest = {
	type: "host_tool_cancel";
	toolCallId: string;
	toolName: string;
};

export type OmpRpcHostUriRequest = {
	type: "host_uri_request";
	requestId: string;
	scheme: string;
	uri: string;
	operation: "read" | "write";
	value?: string;
};

export type OmpRpcHostUriCancelRequest = {
	type: "host_uri_cancel";
	requestId: string;
	scheme: string;
	uri: string;
};

export type OmpRpcExtensionUIRequest = {
	type: "extension_ui_request";
	requestId: string;
	method: string;
	[extra: string]: unknown;
};

export type OmpRpcSubagentLifecycleFrame = {
	type: "subagent_lifecycle";
	payload: unknown;
};

export type OmpRpcSubagentProgressFrame = {
	type: "subagent_progress";
	payload: unknown;
};

export type OmpRpcSubagentEventFrame = {
	type: "subagent_event";
	payload: unknown;
};

export type OmpRpcFrame =
	| OmpRpcReadyFrame
	| OmpRpcResponse
	| OmpRpcPromptResultFrame
	| OmpRpcAvailableCommandsUpdateFrame
	| OmpRpcSessionInfoUpdateFrame
	| OmpRpcConfigUpdateFrame
	| OmpRpcCommandOutputFrame
	| OmpRpcExtensionErrorFrame
	| OmpRpcSessionShutdownFrame
	| OmpRpcChunkFrame
	| OmpRpcAgentEvent
	| OmpRpcHostToolCallRequest
	| OmpRpcHostToolCancelRequest
	| OmpRpcHostUriRequest
	| OmpRpcHostUriCancelRequest
	| OmpRpcExtensionUIRequest
	| OmpRpcSubagentLifecycleFrame
	| OmpRpcSubagentProgressFrame
	| OmpRpcSubagentEventFrame
	| { type: "rpc_frame_error"; message?: string };