import { randomUUID } from "node:crypto";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type { AgentRuntimeUsage } from "../../agent-runtime/events.js";
import { OmpRpcClient, OmpRpcClientError, OmpRpcResponseError } from "./client.js";
import type {
	OmpRpcAgentEvent,
	OmpRpcAssistantMessageEvent,
	OmpRpcFrame,
} from "./protocol-types.js";

/** Hard cap on how long a streaming turn may run before we resolve it. */
const DEFAULT_TURN_STREAM_TIMEOUT_MS = 10 * 60 * 1_000;
// Test hook: allows the deadline to be set tiny (e.g. 250ms) so unit tests can
// exercise the timeout path without waiting ten minutes.
function turnStreamTimeoutMs(): number {
	if (typeof process !== "undefined" && process.env?.PIBO_OMP_TURN_TIMEOUT_MS) {
		const parsed = Number(process.env.PIBO_OMP_TURN_TIMEOUT_MS);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_TURN_STREAM_TIMEOUT_MS;
}
type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
	const d = {} as Deferred<T>;
	d.promise = new Promise<T>((resolve, reject) => {
		d.resolve = resolve;
		d.reject = reject;
	});
	return d;
}

type PendingPrompt = {
	/** Whether the response confirmed an agent invocation (true = wait for agent_end). */
	agentInvoked: boolean;
	/** Fulfilled when the response to the prompt command arrives. */
	responseSettled: Deferred<void>;
	/** Fulfilled when the turn is terminal (agent_end isTerminal). */
	turnSettled: Deferred<void>;
	interrupted: boolean;
};

export class OmpRpcClientProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OmpRpcClientProtocolError";
	}
}

function isOmpRpcAgentEvent(frame: OmpRpcFrame): frame is OmpRpcAgentEvent {
	return frame.type === "agent_start"
		|| frame.type === "agent_end"
		|| frame.type === "turn_start"
		|| frame.type === "turn_end"
		|| frame.type === "message_start"
		|| frame.type === "message_end"
		|| frame.type === "auto_compaction_start"
		|| frame.type === "auto_compaction_end"
		|| frame.type === "auto_retry_start"
		|| frame.type === "auto_retry_end"
		|| frame.type === "retry_fallback_applied"
		|| frame.type === "retry_fallback_succeeded"
		|| frame.type === "model_changed"
		|| frame.type === "ttsr_triggered"
		|| frame.type === "todo_reminder"
		|| frame.type === "todo_auto_clear"
		|| frame.type === "irc_message"
		|| frame.type === "notice"
		|| frame.type === "thinking_level_changed"
		|| frame.type === "goal_updated";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assistantEventText(event: OmpRpcAssistantMessageEvent): { text?: string; thinking?: string } | undefined {
	if (event.type === "text_delta") return { text: event.delta };
	if (event.type === "text_end") return { text: event.content };
	if (event.type === "thinking_delta") return { thinking: event.delta };
	if (event.type === "thinking_end") return { thinking: event.content };
	return undefined;
}

function toolCallFromEvent(event: OmpRpcAssistantMessageEvent): { id: string; name: string; args?: unknown } | undefined {
	if (event.type !== "toolcall_end") return undefined;
	const toolCall = event.toolCall;
	if (!toolCall) return undefined;
	return { id: toolCall.id, name: toolCall.name, args: toolCall.arguments };
}

export class OmpRpcTurnController {
	private pending?: PendingPrompt;
	private disposed = false;
	private readonly unsubscribeFrames: () => void;

	constructor(
		private readonly client: OmpRpcClient,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
	) {
		this.unsubscribeFrames = client.subscribeFrames((frame) => {
			if (this.disposed) return;
			try {
				this.handleFrame(frame);
			} catch (error) {
				this.handleProtocolFailure(error);
			}
		});
		this.client.subscribeDiagnostics((message) => {
			if (this.pending && message) this.emitWarning(message);
		});
	}

	get streaming(): boolean {
		return this.pending !== undefined;
	}

	private emitWarning(message: string): void {
		this.emit({ type: "warning", message });
	}

	private handleProtocolFailure(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.emit({ type: "error", message });
		if (this.pending && !this.pending.interrupted) {
			this.pending.turnSettled.reject(
				new OmpRpcClientProtocolError(`OMP RPC protocol failure while streaming a turn: ${message}`),
			);
		}
	}

	/**
	 * Start a prompt turn. Strategy per MUST-FIX #4:
	 * - Send `prompt`, wait for the correlated `response`.
	 * - If the response reports agentInvoked:false (a local-only slash command or
	 *   skill that never invokes the model), resolve the turn IMMEDIATELY —
	 *   there is no agent_start/agent_end stream.
	 * - If agentInvoked:true, await the terminal agent_end with isTerminal:true.
	 */
	async prompt(text: string): Promise<void> {
		this.assertActive();
		if (this.pending) throw new Error("An OMP turn is already in progress.");
		// Set pending BEFORE sending so frames emitted in the same stdout chunk
		// (or before the response resolves) are attributed to this turn.
		const turn: PendingPrompt = {
			agentInvoked: true,
			responseSettled: deferred(),
			turnSettled: deferred(),
			interrupted: false,
		};
		this.pending = turn;
		try {
			await this.executePrompt(turn, text);
		} catch (error) {
			if (this.pending === turn) this.pending = undefined;
			throw error;
		}
	}

	private async executePrompt(turn: PendingPrompt, text: string): Promise<void> {
		let response;
		try {
			response = await this.client.request({ type: "prompt", message: text }, "prompt");
		} finally {
			turn.responseSettled.resolve();
		}
		const data = response["data" as keyof typeof response];
		const invoked = !isRecord(data) || !("agentInvoked" in data) || data.agentInvoked !== false;
		turn.agentInvoked = invoked;
		if (!invoked) {
			// Local-only slash/skill command: no agent stream will come (MUST-FIX #4).
			if (this.pending === turn) this.pending = undefined;
			turn.turnSettled.resolve();
			return;
		}
		// A running agent turn normally ends with a terminal agent_end. Guard
		// against OMP never emitting it: resolve after a hard deadline so
		// prompt() cannot hang forever.
		const deadline = setTimeout(() => {
			if (this.pending === turn) this.pending = undefined;
			turn.turnSettled.resolve();
		}, turnStreamTimeoutMs());
		try {
			await turn.turnSettled.promise;
		} finally {
			clearTimeout(deadline);
			if (this.pending === turn) this.pending = undefined;
		}
	}

	async steer(text: string): Promise<void> {
		this.assertActive();
		await this.client.request({ type: "steer", message: text }, "steer");
	}

	async interrupt(): Promise<void> {
		this.assertActive();
		if (this.pending) this.pending.interrupted = true;
		try {
			await this.client.request({ type: "abort" }, "abort");
		} catch (error) {
			if (this.pending && !this.pending.interrupted) throw error;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.unsubscribeFrames();
		if (this.pending) {
			this.pending.turnSettled.reject(new Error("OMP turn disposed."));
			this.pending = undefined;
		}
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("OMP turn controller is disposed.");
	}

	private handleFrame(frame: OmpRpcFrame): void {
		if (this.pending === undefined) return;
		if (frame.type === "agent_end") {
			if (frame.isTerminal !== false) {
				const turn = this.pending;
				this.pending = undefined;
				turn.turnSettled.resolve();
				turn.responseSettled.resolve();
			}
			return;
		}
		if (frame.type === "message_update") {
			const event = frame.assistantMessageEvent;
			if (!event) return;
			if (event.type === "text_delta" || event.type === "text_end") {
				this.emit({ type: "assistant_delta", text: event.type === "text_end" ? event.content : event.delta, contentIndex: event.contentIndex });
			} else if (event.type === "thinking_delta" || event.type === "thinking_end") {
				this.emit({ type: "reasoning_delta", text: event.type === "thinking_end" ? event.content : event.delta, contentIndex: event.contentIndex });
			} else if (event.type === "thinking_start") {
				this.emit({ type: "reasoning_started", contentIndex: event.contentIndex });
			} else if (event.type === "toolcall_end") {
				this.emit({
					type: "tool_call",
					toolCallId: event.toolCall.id,
					toolName: event.toolCall.name,
					args: event.toolCall.arguments,
					argsComplete: true,
				});
			} else if (event.type === "done") {
				// message done; terminal is signalled by agent_end
			}
			return;
		}
		if (frame.type === "tool_execution_start") {
			const intent = typeof frame.intent === "string" ? frame.intent.trim() : "";
			this.emit({
				type: "tool_execution_started",
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				args: frame.args,
				...(intent ? { intent } : {}),
			});
			return;
		}
		if (frame.type === "tool_execution_update") {
			this.emit({
				type: "tool_execution_updated",
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				args: frame.args,
				partialResult: frame.partialResult,
			});
			return;
		}
		if (frame.type === "tool_execution_end") {
			this.emit({
				type: "tool_execution_finished",
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				result: frame.result,
				isError: frame.isError === true,
			});
			return;
		}
		this.handleSessionEvent(frame);
	}

	private handleSessionEvent(frame: OmpRpcFrame): void {
		if (!isOmpRpcAgentEvent(frame)) return;
		switch (frame.type) {
			case "turn_start":
				this.emit({ type: "turn_started" });
				break;
			case "turn_end":
				this.emit({ type: "turn_completed", status: "completed" });
				break;
			case "auto_compaction_start":
				this.emit({ type: "compaction_start", reason: frame.reason });
				break;
			case "auto_compaction_end":
				this.emit({
					type: "compaction_end",
					reason: frame.action,
					aborted: frame.aborted,
					errorMessage: frame.errorMessage,
					result: frame.result,
				});
				break;
			case "notice":
				if (frame.level === "error") {
					this.emit({ type: "error", message: frame.message });
				} else {
					this.emit({ type: "warning", message: frame.message });
				}
				break;
			default:
				break;
		}
	}

	/** Normalize an OMP AgentMessage usage into Pibo usage, if present. */
	static usageFromMessage(message: unknown): AgentRuntimeUsage | undefined {
		if (!isRecord(message)) return undefined;
		const usage = (message as { usage?: unknown }).usage;
		if (!isRecord(usage)) return undefined;
		const record = usage as {
			inputTokens?: unknown;
			outputTokens?: unknown;
			cachedInputTokens?: unknown;
			reasoningTokens?: unknown;
			totalTokens?: unknown;
		};
		const input = typeof record.inputTokens === "number" ? record.inputTokens : 0;
		const output = typeof record.outputTokens === "number" ? record.outputTokens : 0;
		const total = typeof record.totalTokens === "number" ? record.totalTokens : input + output;
		return {
			inputTokens: input,
			outputTokens: output,
			cacheReadTokens: typeof record.cachedInputTokens === "number" ? record.cachedInputTokens : 0,
			cacheWriteTokens: 0,
			reasoningTokens: typeof record.reasoningTokens === "number" ? record.reasoningTokens : 0,
			totalTokens: total,
		};
	}
}