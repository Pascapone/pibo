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
// Authoritative recovery checks (session/read, view/page) must answer quickly:
// they run inside a silence window and must never extend it materially.
const RECOVERY_REQUEST_TIMEOUT_MS = 15_000;
const RECOVERY_PAGE_LIMIT = 200;

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

function isAbortOutcome(outcome: unknown): outcome is { kind: "__aborted" } {
	return !!outcome && typeof outcome === "object" && (outcome as { kind?: unknown }).kind === "__aborted";
}

export type MuseTurnRecoveryOptions = {
	/** Silence interval between authoritative view checks. Defaults to 60_000. */
	pollMs?: number;
	/** Maximum view/page requests per check. Defaults to 25. */
	maxPages?: number;
	/** Bound for abort settlement before forcing local cancellation. Defaults to 15_000. */
	abortTimeoutMs?: number;
	/** Last live view cursor observed for this session, when known. */
	lastViewCursor?: () => string | undefined;
};

const DEFAULT_RECOVERY_POLL_MS = 60_000;
const DEFAULT_RECOVERY_MAX_PAGES = 25;
const DEFAULT_ABORT_TIMEOUT_MS = 15_000;

export class MuseNativeTurnController {
	private active: { turn: Turn; turnId: string; finished: Deferred<void>; forceSettle: () => Promise<void> } | undefined;
	private disposed = false;

	constructor(
		private readonly connection: Connection,
		private readonly session: Session,
		private readonly sessionId: string,
		private readonly requestTimeoutMs: number,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
		private readonly recovery: MuseTurnRecoveryOptions = {},
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
		const abortMs = this.recovery.abortTimeoutMs ?? DEFAULT_ABORT_TIMEOUT_MS;
		const settled = await withTimeout(
			active.finished.promise.then(() => true as const),
			abortMs,
			"Muse abort settlement timed out.",
		).catch(() => false as const);
		if (!settled) await active.forceSettle();
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
		// Short polls detect a dead view within about a minute; the outer budget
		// preserves the previous worst case (three request windows of no activity
		// at all, live or recovered).
		const windowMs = Math.min(this.recovery.pollMs ?? DEFAULT_RECOVERY_POLL_MS, this.requestTimeoutMs);
		const outerBudgetMs = MAX_SILENT_WINDOWS * this.requestTimeoutMs;
		const readTimeoutMs = Math.min(RECOVERY_REQUEST_TIMEOUT_MS, Math.max(LIVENESS_PROBE_MIN_TIMEOUT_MS, this.requestTimeoutMs));
		const maxPages = this.recovery.maxPages ?? DEFAULT_RECOVERY_MAX_PAGES;
		this.emit({ type: "turn_started", turnId });
		const seenItems = new Map<string, string>();
		const completedTools = new Set<string>();
		const emittedDiffs = new Map<string, string>();
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let rejectTimeout: ((error: Error) => void) | undefined;
		let abortResolve: ((value: { kind: "__aborted" }) => void) | undefined;
		const aborted = new Promise<{ kind: "__aborted" }>((resolve) => {
			abortResolve = resolve;
		});
		let silentMs = 0;
		let activityGeneration = 0;
		let recoveryAnnounced = false;
		let contradictionAnnounced = false;
		let gapStallWarned = false;
		let recoveredTotal = 0;
		let nativeOverWithoutTerminal = false;
		let recoveryCursor: string | undefined;
		const recoveredCursors = new Set<string>();
		let suppressActivity = false;
		let itemIter: AsyncIterableIterator<unknown> | undefined;
		let deltaIter: AsyncIterableIterator<unknown> | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			rejectTimeout = reject;
		});
		const livenessProbeTimeoutMs = Math.min(LIVENESS_PROBE_TIMEOUT_MS, Math.max(LIVENESS_PROBE_MIN_TIMEOUT_MS, this.requestTimeoutMs));
		const failSilent = (hostAlive: boolean): void => {
			settled = true;
			void this.connection.command("turn/interrupt", { sessionId: this.sessionId, turnId }).catch(() => {});
			rejectTimeout?.(new Error(`Muse turn timed out after ${silentMs}ms without activity for prompt "${boundedText(promptText).slice(0, 120)}" (host ${hostAlive ? "responsive" : "unresponsive"}).`));
		};
		const announce = (line: string): void => {
			this.emit({ type: "warning", message: line });
			this.emit({ type: "reasoning_started" });
			this.emit({ type: "reasoning_finished", text: line });
		};
		const readNativeTurnState = async (): Promise<{ activeTurnId: string | null } | undefined> => {
			let result: Record<string, unknown>;
			try {
				result = await withTimeout(
					this.connection.request("session/read", { sessionId: this.sessionId }),
					readTimeoutMs,
					"Muse session read timed out.",
				);
			} catch (error) {
				// A gone native session can never settle this turn; anything else is
				// indeterminate and falls back to the liveness probe below.
				if (error instanceof MspError && (error as { kind?: unknown }).kind === "sessionNotFound") {
					throw new MuseNativeTurnProtocolError(`Muse native session "${this.sessionId}" is gone; turn "${turnId}" cannot settle.`);
				}
				return undefined;
			}
			const session = result.session;
			if (!session || typeof session !== "object") return undefined;
			const activeTurnId = (session as Record<string, unknown>).activeTurnId;
			if (activeTurnId !== null && typeof activeTurnId !== "string") return undefined;
			return { activeTurnId };
		};
		const foldRecoveredPage = (events: unknown, acceptTerminal: boolean): { frames: number; terminal: boolean; stalled: boolean; contradicted: boolean } => {
			if (!Array.isArray(events)) return { frames: 0, terminal: false, stalled: false, contradicted: false };
			let frames = 0;
			let terminal = false;
			let contradicted = false;
			for (const event of events) {
				if (!event || typeof event !== "object") continue;
				const record = event as { method?: unknown; params?: unknown };
				if (typeof record.method !== "string") continue;
				// Never re-drive submission state: this turn already has a handle.
				if (record.method === "turn/started") continue;
				const params = record.params as { turnId?: unknown; viewCursor?: unknown } | undefined;
				const viewCursor = params?.viewCursor;
				if (!acceptTerminal && record.method === "turn/completed" && params?.turnId === turnId) {
					// The authoritative session/read says this turn is still
					// running: a terminal frame for it is stale, synthetic, or
					// corrupt and must not settle the turn. Leave the cursor
					// unconsumed so a later walk re-evaluates it once the
					// native turn is over (covers a read/walk race where the
					// terminal is real but landed after the read).
					if (typeof viewCursor === "string" && viewCursor) recoveredCursors.delete(viewCursor);
					contradicted = true;
					continue;
				}
				if (typeof viewCursor === "string" && viewCursor) {
					// Repeated walks overlap; fold each cursor once so progress
					// updates are never replayed and counts stay honest.
					if (recoveredCursors.has(viewCursor)) continue;
					recoveredCursors.add(viewCursor);
					if (recoveredCursors.size > 5_000) {
						const oldest = recoveredCursors.values().next();
						if (!oldest.done) recoveredCursors.delete(oldest.value);
					}
				}
				let outcome: { fold?: { kind?: string } };
				try {
					outcome = this.session.apply({ method: record.method, params: record.params }) as { fold?: { kind?: string } };
				} catch {
					continue;
				}
				if (outcome?.fold?.kind === "bufferedDuringGap") {
					// Not folded; a later walk must see this cursor again.
					if (typeof viewCursor === "string" && viewCursor) recoveredCursors.delete(viewCursor);
					return { frames, terminal, stalled: true, contradicted };
				}
				frames += 1;
				if (record.method === "turn/completed" && params?.turnId === turnId) {
					terminal = true;
					break;
				}
			}
			return { frames, terminal, stalled: false, contradicted };
		};
		const walkView = async (startCursor: string | undefined, acceptTerminal: boolean): Promise<{ frames: number; terminal: boolean; stalled: boolean; contradicted: boolean; pages: number; lastCursor: string | undefined }> => {
			let cursor = startCursor;
			let lastCursor = startCursor;
			let triedScratch = startCursor === undefined;
			let frames = 0;
			let terminal = false;
			let stalled = false;
			let contradicted = false;
			let pages = 0;
			for (;;) {
				if (settled || pages >= maxPages) break;
				pages += 1;
				let result: Record<string, unknown>;
				try {
					result = await withTimeout(
						this.connection.request("view/page", {
							sessionId: this.sessionId,
							...(cursor ? { cursor } : {}),
							limit: RECOVERY_PAGE_LIMIT,
						}),
						readTimeoutMs,
						"Muse view page timed out.",
					);
				} catch {
					// A cursor the host cannot resolve (e.g. past a dead projection
					// head) falls back to one walk from the beginning.
					if (!triedScratch) {
						triedScratch = true;
						cursor = undefined;
						continue;
					}
					break;
				}
				if (!Array.isArray(result.events) || (result.nextCursor !== null && typeof result.nextCursor !== "string")) {
					if (!triedScratch) {
						triedScratch = true;
						cursor = undefined;
						continue;
					}
					break;
				}
				const folded = foldRecoveredPage(result.events, acceptTerminal);
				frames += folded.frames;
				if (folded.contradicted) contradicted = true;
				if (folded.stalled) {
					stalled = true;
					break;
				}
				if (folded.terminal) {
					terminal = true;
					break;
				}
				const next = result.nextCursor;
				if (next === null || !next || next === cursor) break;
				cursor = next;
				lastCursor = next;
			}
			return { frames, terminal, stalled, contradicted, pages, lastCursor };
		};
		const reconcile = async (probeGeneration: number): Promise<void> => {
			let read: { activeTurnId: string | null } | undefined;
			try {
				read = await readNativeTurnState();
			} catch (error) {
				if (!settled && probeGeneration === activityGeneration) {
					settled = true;
					rejectTimeout?.(error instanceof Error ? error : new Error("Muse turn failed."));
				}
				return;
			}
			if (settled || probeGeneration !== activityGeneration) return;
			if (read) {
				const nativeRunning = read.activeTurnId === turnId;
				// Recovered frames route through the pumps, which would re-arm the
				// window and invalidate this generation before the walk is judged.
				// Suppress accounting during the walk; live frames that arrive
				// meanwhile are still applied, only their bookkeeping is deferred.
				suppressActivity = true;
				const liveBefore = this.recovery.lastViewCursor?.();
				// A recovered terminal settles the turn only when the
				// authoritative read agrees the native turn is over. A terminal
				// frame for a still-running turn is stale, synthetic, or corrupt
				// (observed against a dead view projection) and must not kill it.
				const walked = await walkView(recoveryCursor ?? liveBefore, !nativeRunning);
				// Recovered frames bypass the pump, so only a live arrival moves
				// this cursor; a revived stream wins over any recovery verdict.
				const liveRevived = this.recovery.lastViewCursor?.() !== liveBefore;
				suppressActivity = false;
				if (settled) return;
				if (walked.lastCursor) recoveryCursor = walked.lastCursor;
				if (liveRevived) {
					noteActivity();
					return;
				}
				if (probeGeneration !== activityGeneration) return;
				recoveredTotal += walked.frames;
				if (walked.frames > 0 || walked.contradicted || !nativeRunning || walked.stalled) {
					this.emit({
						type: "native_event",
						event: {
							kind: "muse-view-recovery",
							turnId,
							nativeRunning,
							pages: walked.pages,
							frames: walked.frames,
							terminalFound: walked.terminal,
							terminalContradicted: walked.contradicted,
							stalledBehindGap: walked.stalled,
						},
						redacted: true,
					});
				}
				if (walked.stalled) {
					if (!gapStallWarned) {
						gapStallWarned = true;
						this.emit({ type: "warning", message: "Muse view recovery stalled behind gap fill; waiting for the live stream to resume." });
					}
					silentMs += windowMs;
					if (silentMs >= outerBudgetMs) {
						failSilent(true);
						return;
					}
					armWindow();
					return;
				}
				if ((walked.frames > 0 || walked.contradicted || !nativeRunning) && !recoveryAnnounced) {
					recoveryAnnounced = true;
					announce("Muse view stream stalled — reconciling missed events…");
				}
				if (walked.contradicted && !contradictionAnnounced) {
					contradictionAnnounced = true;
					announce("Muse view returned a terminal for a turn that is still running natively; ignoring it as stale.");
				}
				if (walked.terminal) {
					announce(recoveredTotal === 1
						? "Muse view stream recovered — replayed 1 missed event."
						: `Muse view stream recovered — replayed ${recoveredTotal} missed events.`);
					noteActivity();
					return;
				}
				if (nativeRunning) {
					if (walked.frames > 0 || walked.contradicted) {
						noteActivity();
						return;
					}
					silentMs += windowMs;
					if (silentMs >= outerBudgetMs) {
						failSilent(true);
						return;
					}
					armWindow();
					return;
				}
				// The native turn is over but its terminal was not recovered yet;
				// one more window covers a read/walk race before failing fast.
				if (!nativeOverWithoutTerminal) {
					nativeOverWithoutTerminal = true;
					silentMs += windowMs;
					armWindow();
					return;
				}
				settled = true;
				rejectTimeout?.(new Error(`Muse turn "${turnId}" ended natively but its terminal could not be reconciled (view unavailable); replayed ${recoveredTotal} missed events.`));
				return;
			}
			let hostAlive = false;
			try {
				await withTimeout(this.connection.command("approval/listPending", { sessionId: this.sessionId }), livenessProbeTimeoutMs, "Muse host liveness probe timed out.");
				hostAlive = true;
			} catch (error) {
				// Any host-authored error response proves the host is alive; only transport/timeout failure means dead.
				hostAlive = error instanceof MspError;
			}
			if (settled || probeGeneration !== activityGeneration) return;
			silentMs += windowMs;
			if (hostAlive && silentMs < outerBudgetMs) {
				armWindow();
				return;
			}
			failSilent(hostAlive);
		};
		const armWindow = (): void => {
			if (timer) clearTimeout(timer);
			activityGeneration += 1;
			const probeGeneration = activityGeneration;
			timer = setTimeout(() => {
				void reconcile(probeGeneration);
			}, windowMs);
			timer.unref?.();
		};
		const noteActivity = (): void => {
			// Idle budget, not a total budget: a turn doing productive work
			// across many tool calls must survive; only silence is fatal.
			if (settled) return;
			if (suppressActivity) return;
			silentMs = 0;
			nativeOverWithoutTerminal = false;
			armWindow();
		};
		const forceSettle = async (): Promise<void> => {
			if (this.active?.turnId !== turnId) return;
			settled = true;
			if (timer) clearTimeout(timer);
			for (const iter of [itemIter, deltaIter]) {
				try {
					await iter?.return?.();
				} catch {
					// Already ended.
				}
			}
			if (this.active?.turnId === turnId) this.active = undefined;
			this.emit({ type: "warning", message: "Muse abort timed out — settled locally as cancelled." });
			this.emit({ type: "reasoning_started" });
			this.emit({ type: "reasoning_finished", text: "Muse abort timed out — settled locally as cancelled." });
			this.emit({ type: "turn_completed", turnId, status: "cancelled" });
			finished.resolve();
			abortResolve?.({ kind: "__aborted" });
		};
		this.active = { turn, turnId, finished, forceSettle };
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
				itemIter = turn.items() as unknown as AsyncIterableIterator<unknown>;
				for await (const item of itemIter) {
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
				deltaIter = turn.deltas() as unknown as AsyncIterableIterator<unknown>;
				for await (const delta of deltaIter) {
					noteActivity();
					this.routeDelta(delta as unknown as { itemId?: unknown; field?: unknown; delta?: unknown });
				}
			})();
			const outcome = await Promise.race([turn.completed, timeout, aborted]);
			settled = true;
			if (isAbortOutcome(outcome)) {
				// forceSettle already emitted the terminal and resolved finished.
				return;
			}
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
