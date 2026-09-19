import {
	isLaunchFailure,
	MspError,
	type Connection,
	type Session,
	type Turn,
} from "@muse-code/sdk";
import type { AgentRuntimeSemanticEvent, AgentRuntimeUsage } from "../../agent-runtime/events.js";
import type { PiboJsonObject } from "../../core/events.js";
import { MUSE_NATIVE_REASONING_VALUES, type MuseNativeReasoningValue, type MuseSdkReasoningEffort } from "./models.js";
import { withTimeout } from "./process.js";
import { redactMuseNativeSensitiveText } from "./redaction.js";

const MAX_TEXT_CHARS = 64 * 1024;
const MAX_ARGS_CHARS = 16 * 1024;
// A silent-but-alive host is typically waiting out provider retry backoff (the
// SDK does not surface turn/retryScheduled to turn consumers), so the idle
// budget spans a few windows while liveness probes keep answering. A host
// that answers nothing fails at the first window, as before.
const MAX_SILENT_WINDOWS = 3;
const LIVENESS_PROBE_TIMEOUT_MS = 10_000;
const LIVENESS_PROBE_MIN_TIMEOUT_MS = 1_000;

export const MUSE_FALLBACK_TOOL_NAME = "muse-tool";

export type MuseTurnStartOptions = {
	reasoningEffort?: string;
	displayText?: string;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function boundedText(value: unknown): string {
	if (typeof value !== "string") return "";
	return redactMuseNativeSensitiveText(value).slice(0, MAX_TEXT_CHARS);
}

const MAX_ARG_STRING_CHARS = 1024;
const MAX_ARG_ENTRIES = 256;
const MAX_ARG_DEPTH = 32;

function boundParsedArgs(value: unknown, depth = 0, seen: Set<object> = new Set()): unknown {
	if (typeof value === "string") {
		return value.length > MAX_ARG_STRING_CHARS ? `${value.slice(0, MAX_ARG_STRING_CHARS)}…[truncated]` : value;
	}
	if (!value || typeof value !== "object" || depth > MAX_ARG_DEPTH || seen.has(value)) return value;
	seen.add(value);
	if (Array.isArray(value)) return value.slice(0, MAX_ARG_ENTRIES).map((entry) => boundParsedArgs(entry, depth + 1, seen));
	return Object.fromEntries(Object.entries(value).slice(0, MAX_ARG_ENTRIES).map(([key, entry]) => [key, boundParsedArgs(entry, depth + 1, seen)]));
}

function parseToolArgs(args: unknown): { value: unknown; complete: boolean } {
	if (typeof args !== "string" || !args.trim()) return { value: {}, complete: true };
	try {
		const parsed = JSON.parse(args) as unknown;
		return { value: args.length > MAX_ARGS_CHARS ? boundParsedArgs(parsed) : parsed, complete: true };
	} catch {
		return { value: args.slice(0, MAX_ARGS_CHARS), complete: false };
	}
}

const MAX_INTENT_CHARS = 512;

export function splitMuseToolIntent(args: unknown): { args: unknown; intent: string | undefined } {
	if (!args || typeof args !== "object" || Array.isArray(args)) return { args, intent: undefined };
	const { description, ...rest } = args as Record<string, unknown>;
	if (typeof description !== "string") return { args, intent: undefined };
	const intent = redactMuseNativeSensitiveText(description.trim()).slice(0, MAX_INTENT_CHARS).trim();
	if (!intent) return { args, intent: undefined };
	return { args: rest, intent };
}

function toRuntimeUsage(usage: {
	inputTokens?: unknown;
	outputTokens?: unknown;
	cacheReadTokens?: unknown;
	cacheWriteTokens?: unknown;
	reasoningTokens?: unknown;
}): AgentRuntimeUsage {
	const inputTokens = Number.isSafeInteger(usage.inputTokens) ? Number(usage.inputTokens) : 0;
	const outputTokens = Number.isSafeInteger(usage.outputTokens) ? Number(usage.outputTokens) : 0;
	return {
		...(Number.isSafeInteger(usage.inputTokens) ? { inputTokens } : {}),
		...(Number.isSafeInteger(usage.outputTokens) ? { outputTokens } : {}),
		...(Number.isSafeInteger(usage.cacheReadTokens) ? { cacheReadTokens: Number(usage.cacheReadTokens) } : {}),
		...(Number.isSafeInteger(usage.cacheWriteTokens) ? { cacheWriteTokens: Number(usage.cacheWriteTokens) } : {}),
		...(Number.isSafeInteger(usage.reasoningTokens) ? { reasoningTokens: Number(usage.reasoningTokens) } : {}),
		totalTokens: inputTokens + outputTokens,
	};
}

function turnFailureMessage(params: {
	terminal: string;
	reason?: string;
	error?: { message?: string; kind?: string };
}): string {
	const error = params.error;
	if (error && typeof error.message === "string" && error.message.trim()) {
		return redactMuseNativeSensitiveText(error.message).slice(0, 4_000);
	}
	if (typeof params.reason === "string" && params.reason.trim()) {
		return redactMuseNativeSensitiveText(params.reason).slice(0, 4_000);
	}
	return `Muse turn ended with terminal "${params.terminal}".`;
}

export class MuseNativeTurnProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MuseNativeTurnProtocolError";
	}
}

export class MuseNativeTurnController {
	private active: { turn: Turn; turnId: string; finished: Deferred<void> } | undefined;
	private disposed = false;

	constructor(
		private readonly connection: Connection,
		private readonly session: Session,
		private readonly sessionId: string,
		private readonly requestTimeoutMs: number,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
	) {}

	get streaming(): boolean {
		return this.active !== undefined;
	}

	get activeTurnId(): string | undefined {
		return this.active?.turnId;
	}

	async start(text: string, options: MuseTurnStartOptions = {}): Promise<void> {
		this.assertUsable();
		if (this.active) throw new Error("A Muse turn is already running for this session.");
		this.assertReasoningEffort(options.reasoningEffort);
		const turn = await this.session.sendUserTurn({
			input: [{ type: "text", text }],
			...(options.displayText ? { displayText: options.displayText } : {}),
			...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort as MuseSdkReasoningEffort } : {}),
		});
		await this.followTurn(turn, text);
	}

	async steer(text: string, options: MuseTurnStartOptions = {}): Promise<void> {
		this.assertUsable();
		const active = this.active;
		if (!active) throw new Error("Muse steering requires a running turn.");
		this.assertReasoningEffort(options.reasoningEffort);
		// turn/steer binds the input to the exact running turn; the host rejects
		// it when that turn already settled, so input can never leak into a new
		// turn and no second turn handle is left untracked. The active followTurn
		// observes the steered turn to its terminal.
		await withTimeout(
			this.connection.command("turn/steer", {
				sessionId: this.sessionId,
				expectedTurnId: active.turnId,
				input: [{ type: "text", text }],
				...(options.displayText ? { displayText: options.displayText } : {}),
				...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort as MuseSdkReasoningEffort } : {}),
			}),
			this.requestTimeoutMs,
			`Muse steer timed out after ${this.requestTimeoutMs}ms.`,
		);
	}

	async interrupt(): Promise<void> {
		const active = this.active;
		if (!active) return;
		try {
			await this.connection.command("turn/interrupt", { sessionId: this.sessionId, turnId: active.turnId });
		} catch {
			// Best effort: an already-settled turn reports through its terminal below.
		}
		await active.finished.promise.catch(() => {});
	}

	dispose(): void {
		this.disposed = true;
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error("Muse turn controller is disposed.");
	}

	private assertReasoningEffort(value: string | undefined): void {
		if (value !== undefined && !MUSE_NATIVE_REASONING_VALUES.includes(value as MuseNativeReasoningValue)) {
			throw new Error(`Muse reasoning effort must be one of ${MUSE_NATIVE_REASONING_VALUES.join(", ")}.`);
		}
	}

	private async followTurn(turn: Turn, promptText: string): Promise<void> {
		const turnId = turn.turnId;
		const finished = deferred<void>();
		this.active = { turn, turnId, finished };
		this.emit({ type: "turn_started", turnId });
		const seenItems = new Map<string, string>();
		const completedTools = new Set<string>();
		const emittedDiffs = new Map<string, string>();
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let rejectTimeout: ((error: Error) => void) | undefined;
		let silentWindows = 0;
		let activityGeneration = 0;
		const timeout = new Promise<never>((_resolve, reject) => {
			rejectTimeout = reject;
		});
		const livenessProbeTimeoutMs = Math.min(LIVENESS_PROBE_TIMEOUT_MS, Math.max(LIVENESS_PROBE_MIN_TIMEOUT_MS, this.requestTimeoutMs));
		const failSilent = (hostAlive: boolean): void => {
			settled = true;
			void this.connection.command("turn/interrupt", { sessionId: this.sessionId, turnId }).catch(() => {});
			const totalSilenceMs = silentWindows * this.requestTimeoutMs;
			rejectTimeout?.(new Error(`Muse turn timed out after ${totalSilenceMs}ms without activity for prompt "${boundedText(promptText).slice(0, 120)}" (host ${hostAlive ? "responsive" : "unresponsive"}).`));
		};
		const armWindow = (): void => {
			if (timer) clearTimeout(timer);
			activityGeneration += 1;
			timer = setTimeout(() => {
				void (async () => {
					const probeGeneration = activityGeneration;
					let hostAlive = false;
					try {
						await withTimeout(this.connection.command("approval/listPending", { sessionId: this.sessionId }), livenessProbeTimeoutMs, "Muse host liveness probe timed out.");
						hostAlive = true;
					} catch (error) {
						// Any host-authored error response proves the host is alive; only transport/timeout failure means dead.
						hostAlive = error instanceof MspError;
					}
					if (settled || probeGeneration !== activityGeneration) return;
					silentWindows += 1;
					if (hostAlive && silentWindows < MAX_SILENT_WINDOWS) {
						armWindow();
						return;
					}
					failSilent(hostAlive);
				})();
			}, this.requestTimeoutMs);
			timer.unref?.();
		};
		const noteActivity = (): void => {
			// Idle budget, not a total budget: a turn doing productive work
			// across many tool calls must survive; only silence is fatal.
			if (settled) return;
			silentWindows = 0;
			armWindow();
		};
		noteActivity();
		void finished.promise.finally(() => {
			settled = true;
			if (timer) clearTimeout(timer);
		});
		const fail = (error: Error): void => {
			settled = true;
			if (this.active?.turnId === turnId) this.active = undefined;
			this.emit({ type: "turn_failed", turnId, message: error.message });
			finished.resolve();
		};
		try {
			const itemPump = (async () => {
				for await (const item of turn.items()) {
					noteActivity();
					try {
						this.routeItem(item as unknown as Record<string, unknown>, seenItems, completedTools, emittedDiffs);
					} catch (error) {
						this.emit({
							type: "warning",
							message: redactMuseNativeSensitiveText(error instanceof Error ? `Muse item routing failed: ${error.message}` : "Muse item routing failed.").slice(0, 512),
						});
					}
				}
			})();
			const deltaPump = (async () => {
				for await (const delta of turn.deltas()) {
					noteActivity();
					this.routeDelta(delta as unknown as { itemId?: unknown; field?: unknown; delta?: unknown });
				}
			})();
			const outcome = await Promise.race([turn.completed, timeout]);
			settled = true;
			await Promise.allSettled([itemPump, deltaPump]);
			if (this.active?.turnId === turnId) this.active = undefined;
			if (outcome.kind === "unqueued") {
				this.emit({ type: "turn_failed", turnId, message: `Muse turn "${turnId}" was reclaimed before launch; the input never ran.` });
				finished.resolve();
				return;
			}
			if (outcome.kind === "terminalUnknown") {
				this.emit({ type: "turn_failed", turnId, message: `Muse host died during turn "${turnId}" before a terminal was recorded.` });
				finished.resolve();
				return;
			}
			const params = outcome.params as unknown as {
				terminal?: unknown;
				reason?: unknown;
				error?: { message?: unknown; kind?: unknown };
				usage?: {
					inputTokens?: unknown;
					outputTokens?: unknown;
					cacheReadTokens?: unknown;
					cacheWriteTokens?: unknown;
					reasoningTokens?: unknown;
				};
			};
			if (params.usage && typeof params.usage === "object") {
				this.emit({ type: "usage", usage: toRuntimeUsage(params.usage), target: { type: "turn" } });
			}
			const terminal = typeof params.terminal === "string" ? params.terminal : "completed";
			if (terminal === "failed" || isLaunchFailure(outcome)) {
				this.emit({
					type: "turn_failed",
					turnId,
					message: turnFailureMessage({
						terminal,
						reason: typeof params.reason === "string" ? params.reason : undefined,
						error: params.error && typeof params.error === "object"
							? {
								...(typeof params.error.message === "string" ? { message: params.error.message } : {}),
								...(typeof params.error.kind === "string" ? { kind: params.error.kind } : {}),
							}
							: undefined,
					}),
				});
				finished.resolve();
				return;
			}
			this.emit({ type: "turn_completed", turnId, status: terminal });
			finished.resolve();
		} catch (error) {
			fail(error instanceof Error ? error : new Error("Muse turn failed."));
			throw error;
		}
	}

	private routeItem(
		item: Record<string, unknown>,
		seenItems: Map<string, string>,
		completedTools: Set<string>,
		emittedDiffs: Map<string, string>,
	): void {
		const itemId = typeof item.itemId === "string" ? item.itemId : undefined;
		const kind = typeof item.kind === "string" ? item.kind : undefined;
		if (!itemId || !kind) return;
		const status = typeof item.status === "string" ? item.status : "inProgress";
		const previous = seenItems.get(itemId);
		seenItems.set(itemId, status);
		const terminal = status !== "inProgress";
		if (kind === "agentMessage") {
			if (terminal && previous !== status) {
				const text = boundedText(item.text);
				if (text) this.emit({ type: "assistant_message", text });
			}
			return;
		}
		if (kind === "reasoning") {
			if (!previous) this.emit({ type: "reasoning_started" });
			if (terminal && previous !== status) {
				const text = boundedText(item.text ?? item.summary);
				this.emit({ type: "reasoning_finished", ...(text ? { text } : {}) });
			}
			return;
		}
		if (kind === "toolCall") {
			const toolName = typeof item.tool === "string" && item.tool.trim() ? item.tool : MUSE_FALLBACK_TOOL_NAME;
			if (!previous) {
				const args = parseToolArgs(item.args);
				// The description moves to intent (Pi-style) so views never show it twice.
				const split = splitMuseToolIntent(args.value);
				this.emit({ type: "tool_call", toolCallId: itemId, toolName, args: split.args, argsComplete: args.complete, ...(split.intent ? { intent: split.intent } : {}) });
				this.emit({ type: "tool_execution_started", toolCallId: itemId, toolName, args: split.args, ...(split.intent ? { intent: split.intent } : {}) });
			}
			if (terminal && !completedTools.has(itemId)) {
				completedTools.add(itemId);
				const failed = status === "failed" || status === "rejected" || status === "timedOut";
				const result = item.visibleOutput ?? item.outputRef ?? item.failureReason ?? item.failureKind ?? null;
				this.emit({
					type: "tool_execution_finished",
					toolCallId: itemId,
					toolName,
					result: typeof result === "string" ? boundedText(result) : (result as PiboJsonObject | null),
					isError: failed,
				});
			}
			const patchSummary = item.patchSummary;
			if (patchSummary && typeof patchSummary === "object") {
				let fingerprint: string;
				try {
					fingerprint = JSON.stringify(patchSummary) ?? "";
				} catch {
					throw new MuseNativeTurnProtocolError(`Muse patch summary for tool "${toolName}" is not serializable.`);
				}
				if (fingerprint && emittedDiffs.get(itemId) !== fingerprint) {
					emittedDiffs.set(itemId, fingerprint);
					this.emit({ type: "diff_updated", diff: JSON.parse(fingerprint) as PiboJsonObject });
				}
			}
			return;
		}
	}

	private routeDelta(delta: { itemId?: unknown; field?: unknown; delta?: unknown }): void {
		if (typeof delta.itemId !== "string" || typeof delta.delta !== "string" || !delta.delta) return;
		let kind: string | undefined;
		try {
			const item = this.session.fold.items.get(delta.itemId) as unknown as Record<string, unknown> | undefined;
			kind = item && typeof item.kind === "string" ? item.kind : undefined;
		} catch {
			return;
		}
		const field = typeof delta.field === "string" ? delta.field : "text";
		const text = boundedText(delta.delta);
		if (!text) return;
		if (kind === "agentMessage" && field === "text") {
			this.emit({ type: "assistant_delta", text });
			return;
		}
		if (kind === "reasoning") {
			this.emit({ type: "reasoning_delta", text });
			return;
		}
		if (kind === "toolCall" && field === "output") {
			let toolName = MUSE_FALLBACK_TOOL_NAME;
			try {
				const item = this.session.fold.items.get(delta.itemId) as unknown as Record<string, unknown> | undefined;
				if (item && typeof item.tool === "string" && item.tool.trim()) toolName = item.tool;
			} catch {
				// Fall through with the generic tool name.
			}
			this.emit({ type: "tool_execution_updated", toolCallId: delta.itemId, toolName, args: {}, partialResult: text });
		}
	}
}
