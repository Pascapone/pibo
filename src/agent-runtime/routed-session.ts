import type { ModelProfile } from "../core/profiles.js";
import {
	PiboSteeringUnavailableError,
	type PiboEventListener,
	type PiboEventSource,
	type PiboExecutionEvent,
	type PiboForkCandidate,
	type PiboJsonObject,
	type PiboMessageEvent,
	type PiboOutputEvent,
	type PiboPiSessionSnapshot,
	type PiboSessionListItem,
	type PiboSessionOperationResult,
	type PiboSessionStatus,
	type PiboSessionErrorDetails,
	type PiboSessionSwitchParams,
	type PiboSessionTreeNavigateParams,
	type PiboSessionTreeResult,
	type PiboThinkingResult,
} from "../core/events.js";
import { PIBO_PROVIDER_RECOVERY_PROMPT, isPiboProviderFallbackError } from "../core/provider-recovery.js";
import { normalizeSessionErrorDetails, runtimeSessionErrorDetails } from "../core/session-errors.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../core/thinking.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type { PiboGatewayActionContext } from "../plugins/types.js";
import { AgentRuntimeCapabilityUnavailableError } from "./errors.js";
import type { AgentRuntimeSemanticEvent } from "./events.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimeSession,
	AgentRuntimeSessionOperationResult,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	RuntimeSessionBinding,
	StartAgentRuntimeAuthInput,
} from "./types.js";

const RUN_REMINDER_CAPABILITY_TOOLS = new Set([
	"pibo_run_status",
	"pibo_run_wait",
	"pibo_run_read",
	"pibo_run_cancel",
	"pibo_run_ack",
]);

// Run reminders are autonomous service wakeups, so their provider/tool loop needs a deterministic boundary.
const RUN_REMINDER_MAX_TOOL_EXECUTIONS = 64;
const RUN_REMINDER_MAX_PROVIDER_ROUNDS = 64;
const RUN_REMINDER_MAX_ACTIVE_TOKENS = 2_000_000;
export const RUN_REMINDER_MAX_DURATION_MS = 15 * 60 * 1000;
const RUN_REMINDER_MAX_REPEATED_TOOL_CALLS = 12;

type RunReminderTurnGuard = {
	eventId?: string;
	toolExecutions: number;
	providerRounds: number;
	activeTokens: number;
	toolSignatures: Map<string, number>;
	tripped: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

function serializedToolArgs(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

type RuntimeRoutedQueueItem =
	| { kind: "message"; event: PiboMessageEvent }
	| { kind: "compact"; event: PiboExecutionEvent };

type RuntimeInFlightMessage = {
	event: PiboMessageEvent;
	cancelled: boolean;
	settled: Promise<void>;
	resolveSettled: () => void;
	cancellation?: Promise<void>;
};

type PiboSessionOperationListener = (
	result: PiboSessionOperationResult,
	event: PiboExecutionEvent,
) => void | Promise<void>;

type PiboMessageInterruptionListener = (messages: readonly PiboMessageEvent[], reason: string) => void;

export type PiboMessagePreflight = (
	event: PiboMessageEvent,
) => Promise<{ allowed: boolean; reason?: string; code?: string }> | { allowed: boolean; reason?: string; code?: string };

export type RuntimeRoutedSessionOptions = {
	forwardLegacyPiEvents?: boolean;
	onNativeEventTelemetry?: (
		piboSessionId: string,
		event: unknown,
		context: { status?: PiboSessionStatus; activeEventId?: string },
	) => void;
	onSessionOperation?: PiboSessionOperationListener;
	onBeforeSessionIdentityOperation?: (event: PiboExecutionEvent) => void | Promise<void>;
	onKillChildren?: (
		piboSessionId: string,
		options?: { includeRuns?: boolean },
	) => Promise<{ killed: string[]; cancelledRuns: string[] }>;
	onStateChange?: (state: { processing: boolean; queuedMessages: number; disposed: boolean; sessionIdentityOperationInFlight: boolean }) => void;
	onMessagesInterrupted?: PiboMessageInterruptionListener;
	messagePreflight?: PiboMessagePreflight;
	modelFallbacks?: readonly ModelProfile[];
	getRuntimeAuthStatus?: () => Promise<readonly AgentRuntimeAuthStatus[]>;
	startRuntimeAuth?: (input: StartAgentRuntimeAuthInput) => Promise<AgentRuntimeAuthOperationResult>;
	completeRuntimeAuth?: (input: CompleteAgentRuntimeAuthInput) => Promise<AgentRuntimeAuthOperationResult>;
	cancelRuntimeAuth?: (input: CancelAgentRuntimeAuthInput) => Promise<AgentRuntimeAuthOperationResult>;
	logoutRuntimeAuth?: (input: LogoutAgentRuntimeAuthInput) => Promise<AgentRuntimeAuthOperationResult>;
	statusResources?: Pick<PiboSessionStatus, "enabledSkills" | "contextFiles">;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function sameModel(left: ModelProfile | undefined, right: ModelProfile | undefined): boolean {
	return Boolean(left && right && left.provider === right.provider && left.id === right.id);
}

function uniqueModels(models: readonly ModelProfile[]): ModelProfile[] {
	const seen = new Set<string>();
	return models.flatMap((model) => {
		const provider = model.provider.trim();
		const id = model.id.trim();
		if (!provider || !id) return [];
		const key = `${provider}\u0000${id}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [{ provider, id }];
	});
}

function runtimeCapabilityError(session: AgentRuntimeSession, capability: string): AgentRuntimeCapabilityUnavailableError {
	return new AgentRuntimeCapabilityUnavailableError(
		capability,
		session.runtimeInstanceId,
		`Runtime instance "${session.runtimeInstanceId}" does not support ${capability}.`,
	);
}

function nativeSnapshotToPiCompatibility(
	session: AgentRuntimeSession,
	snapshot: AgentRuntimeNativeSessionSnapshot,
): PiboPiSessionSnapshot {
	const nativeSessionId = snapshot.nativeSessionId;
	if (!nativeSessionId) throw runtimeCapabilityError(session, "a native session identifier");
	return {
		piSessionId: nativeSessionId,
		sessionFile: snapshot.locator?.kind === "local-file" ? snapshot.locator.value : undefined,
		leafId: snapshot.leafId ?? null,
		cwd: snapshot.cwd,
		sessionName: snapshot.name,
		parentSessionFile: snapshot.parentLocator?.kind === "local-file"
			? snapshot.parentLocator.value
			: undefined,
	};
}

function nativeOperationToPiCompatibility(
	session: AgentRuntimeSession,
	piboSessionId: string,
	result: AgentRuntimeSessionOperationResult,
): PiboSessionOperationResult {
	// Keep the legacy Pi-shaped result while allowing an adapter-native fork to
	// describe a fresh branch that has no native session yet.
	const current = result.current.nativeSessionId
		? nativeSnapshotToPiCompatibility(session, result.current)
		: {
			piSessionId: "",
			leafId: result.current.leafId ?? null,
			cwd: result.current.cwd,
			sessionName: result.current.name,
			parentSessionFile: result.current.parentLocator?.kind === "local-file"
				? result.current.parentLocator.value
				: undefined,
		};
	return {
		piboSessionId,
		previous: nativeSnapshotToPiCompatibility(session, result.previous),
		current,
		cancelled: result.cancelled,
		selectedText: result.selectedText,
		editorText: result.editorText,
		summaryEntryId: result.summaryEntryId,
		sourceSessionUnchanged: result.sourceSessionUnchanged,
	};
}

function nativeSessionInfoToPiCompatibility(
	session: AgentRuntimeSession,
	info: AgentRuntimeNativeSessionInfo,
): PiboSessionListItem {
	if (!info.nativeSessionId) throw runtimeCapabilityError(session, "native session listing identifiers");
	return {
		path: info.locator?.value ?? info.nativeSessionId,
		id: info.nativeSessionId,
		cwd: info.cwd,
		name: info.name,
		parentSessionPath: info.parentLocator?.value,
		created: info.createdAt ?? "",
		modified: info.updatedAt ?? info.createdAt ?? "",
		messageCount: info.messageCount ?? 0,
		firstMessage: info.firstMessage ?? "",
	};
}

function isSessionOperationResult(value: unknown): value is PiboSessionOperationResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { piboSessionId?: unknown; current?: { piSessionId?: unknown } };
	return typeof candidate.piboSessionId === "string"
		&& Boolean(candidate.current)
		&& typeof candidate.current?.piSessionId === "string";
}

export class RuntimeRoutedSession {
	/** @deprecated Pi compatibility handle for existing direct test/TUI consumers. */
	readonly runtime: unknown;
	private readonly queue: RuntimeRoutedQueueItem[] = [];
	private processing = false;
	private disposed = false;
	private disposePromise?: Promise<void>;
	private runtimeDisposePromise?: Promise<void>;
	private forceDisposalStarted = false;
	private drainPromise?: Promise<void>;
	private inFlightMessage?: RuntimeInFlightMessage;
	private activeMessage?: PiboMessageEvent;
	private activeExecutionEvent?: PiboExecutionEvent;
	private activeMessageFailed = false;
	private runReminderTurnGuard?: RunReminderTurnGuard;
	private activeAssistantIndex?: number;
	private nextAssistantIndex = 0;
	private activeThinkingIndex?: number;
	private nextThinkingIndex = 0;
	private sessionIdentityOperationInFlight = false;
	private forkWhileRunningOperationInFlight = false;
	private forkCandidatesRequest?: Promise<PiboForkCandidate[]>;
	private primaryModel?: ModelProfile;
	private readonly modelFallbacks: readonly ModelProfile[];
	private suppressProviderFailures = false;
	private pendingProviderFailure?: { message: string; details: PiboSessionErrorDetails };
	private unsubscribe?: () => void;

	constructor(
		private readonly piboSessionId: string,
		private readonly runtimeSession: AgentRuntimeSession,
		private readonly emit: PiboEventListener,
		private readonly pluginRegistry: PiboPluginRegistry,
		private readonly options: RuntimeRoutedSessionOptions = {},
	) {
		this.runtime = runtimeSession.getNativeCompatibilityHandle?.() ?? runtimeSession;
		this.primaryModel = runtimeSession.getStatus().activeModel
			? { ...runtimeSession.getStatus().activeModel! }
			: undefined;
		this.modelFallbacks = uniqueModels(options.modelFallbacks ?? []);
		this.unsubscribe = runtimeSession.subscribe((event) => this.handleRuntimeEvent(event));
	}

	enqueueMessage(event: PiboMessageEvent, onAccepted: () => void = () => {}): PiboOutputEvent {
		this.assertActive();
		if (this.sessionIdentityOperationInFlight && !this.forkCandidatesRequest) {
			throw new Error("Pibo session cannot accept messages while a session identity operation is in progress.");
		}
		onAccepted();
		this.queue.push({ kind: "message", event });
		const output: PiboOutputEvent = {
			type: "message_queued",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			queuedMessages: this.queue.length,
			text: event.text,
			source: event.source,
			provenance: event.provenance,
		};
		this.emit(output);
		this.notifyState();
		this.startDrain();
		return output;
	}

	async steerMessage(event: PiboMessageEvent): Promise<PiboOutputEvent> {
		this.assertActive();
		const activeMessage = this.activeMessage;
		if (!activeMessage || !this.processing || !this.runtimeSession.getStatus().streaming || !this.runtimeSession.steer) {
			throw new PiboSteeringUnavailableError();
		}
		try {
			await this.runtimeSession.steer({
				text: event.text,
				source: promptSource(event.source),
				capabilityScope: event.capabilityScope,
			});
		} catch (error) {
			throw new PiboSteeringUnavailableError(
				`The active session could not accept steering: ${errorMessage(error)}`,
				{ cause: error },
			);
		}
		const output: PiboOutputEvent = {
			type: "message_steered",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			activeEventId: activeMessage.id,
			text: event.text,
			source: event.source,
		};
		this.emit(output);
		return output;
	}

	async executeAction(event: PiboExecutionEvent): Promise<PiboOutputEvent> {
		this.assertActive();
		if (event.action === "compact") return this.enqueueCompactAction(event);
		const sessionIdentityOperation = event.action === "session.fork"
			? "fork"
			: event.action === "session.clone"
				? "clone"
				: event.action === "session.switch"
					? "switch"
					: undefined;
		const status = this.getStatus();
		const sourceHasWork = status.processing || status.streaming || status.queuedMessages > 0;
		const forkWhileRunning = event.action === "session.fork"
			&& sourceHasWork
			&& Boolean(this.runtimeSession.controls?.forkSessionWhileRunning);
		if (sessionIdentityOperation) {
			if (forkWhileRunning) {
				if (this.forkWhileRunningOperationInFlight) {
					throw new Error("Pibo session already has a running-safe fork in progress.");
				}
				this.forkWhileRunningOperationInFlight = true;
			} else {
				this.assertSessionIdentityOperationIdle(sessionIdentityOperation);
				this.sessionIdentityOperationInFlight = true;
				this.notifyState();
			}
		}
		try {
			if (sessionIdentityOperation) await this.options.onBeforeSessionIdentityOperation?.(event);
			const result = await this.runAction(event);
			if (isSessionOperationResult(result)) await this.options.onSessionOperation?.(result, event);
			const output: PiboOutputEvent = {
				type: "execution_result",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				action: event.action,
				result,
			};
			this.emit(output);
			return output;
		} finally {
			if (forkWhileRunning) {
				this.forkWhileRunningOperationInFlight = false;
			} else if (sessionIdentityOperation) {
				this.sessionIdentityOperationInFlight = false;
				this.notifyState();
				this.startDrain();
			}
		}
	}

	getActiveMessage(): Pick<PiboMessageEvent, "id" | "source" | "provenance"> | undefined {
		if (!this.activeMessage) return undefined;
		return {
			id: this.activeMessage.id,
			source: this.activeMessage.source,
			provenance: this.activeMessage.provenance,
		};
	}

	getStatus(): PiboSessionStatus {
		const status = this.runtimeSession.getStatus();
		const binding = this.runtimeSession.getBinding();
		const pendingApprovals = this.runtimeSession.pendingApprovals
			?? (this.runtimeSession.pendingApproval ? [this.runtimeSession.pendingApproval] : []);
		const pendingUserInputs = this.runtimeSession.pendingUserInputs
			?? (this.runtimeSession.pendingUserInput ? [this.runtimeSession.pendingUserInput] : []);
		const thinkingLevel = status.reasoning?.value && isPiboThinkingLevel(status.reasoning.value)
			? status.reasoning.value
			: undefined;
		return {
			piboSessionId: this.piboSessionId,
			runtimeBinding: {
				runtimeInstanceId: binding.runtimeInstanceId,
				adapterId: binding.adapterId,
				nativeSessionId: binding.nativeSessionId,
				state: binding.state,
				protocol: binding.protocol,
				protocolVersion: binding.protocolVersion,
				adapterVersion: binding.adapterVersion,
				revision: binding.revision,
			},
			queuedMessages: this.queue.length,
			processing: this.disposed ? false : this.processing,
			streaming: this.disposed ? false : status.streaming,
			activeTools: [...status.enabledTools],
			enabledTools: [...status.enabledTools],
			enabledSkills: [...(this.options.statusResources?.enabledSkills ?? [])],
			contextFiles: [...(this.options.statusResources?.contextFiles ?? [])],
			cwd: status.cwd,
			disposed: this.disposed,
			thinkingLevel,
			fastMode: status.fastMode?.mode === "fast",
			retry: status.retry as PiboSessionStatus["retry"],
			warnings: status.warnings,
			errors: status.errors,
			...(pendingApprovals.length > 0
				? { pendingApprovals: pendingApprovals.map((request) => structuredClone(request)) }
				: {}),
			...(pendingUserInputs.length > 0
				? { pendingUserInputs: pendingUserInputs.map((request) => structuredClone(request)) }
				: {}),
		};
	}

	async getStatusSnapshot(): Promise<PiboSessionStatus> {
		const status = this.runtimeSession.getStatusSnapshot
			? await this.runtimeSession.getStatusSnapshot()
			: this.runtimeSession.getStatus();
		return {
			...this.getStatus(),
			activeModel: status.activeModel,
			contextUsage: status.contextUsage,
			providerUsage: status.providerUsage,
			warnings: status.warnings,
			errors: status.errors,
		};
	}

	getContextUsage(): PiboSessionStatus["contextUsage"] {
		return this.runtimeSession.getStatus().contextUsage;
	}

	getActiveModel(): ModelProfile | undefined {
		return this.runtimeSession.getStatus().activeModel;
	}

	getRuntimeBinding(): RuntimeSessionBinding {
		return this.runtimeSession.getBinding();
	}

	async getProviderUsage(): Promise<PiboSessionStatus["providerUsage"]> {
		const status = this.runtimeSession.getStatusSnapshot
			? await this.runtimeSession.getStatusSnapshot()
			: this.runtimeSession.getStatus();
		return status.providerUsage;
	}

	private getActionContextUsage(): ReturnType<PiboGatewayActionContext["getContextUsage"]> {
		const usage = this.getContextUsage();
		if (!usage) return undefined;
		return {
			tokens: usage.tokens ?? null,
			contextWindow: usage.contextWindow ?? null,
			percent: usage.percent ?? null,
		} as ReturnType<PiboGatewayActionContext["getContextUsage"]>;
	}

	private async getActionProviderUsage(): ReturnType<PiboGatewayActionContext["getProviderUsage"]> {
		const usage = await this.getProviderUsage();
		if (!usage || typeof (usage as { fetchedAt?: unknown }).fetchedAt !== "string") return undefined;
		return usage as Awaited<ReturnType<PiboGatewayActionContext["getProviderUsage"]>>;
	}

	removeQueuedMessages(predicate: (event: PiboMessageEvent) => boolean): number {
		this.assertActive();
		const removedMessages: PiboMessageEvent[] = [];
		for (let index = this.queue.length - 1; index >= 0; index -= 1) {
			const item = this.queue[index];
			if (item.kind !== "message" || !predicate(item.event)) continue;
			this.queue.splice(index, 1);
			removedMessages.push(item.event);
		}
		removedMessages.reverse();
		this.notifyMessagesInterrupted(removedMessages, "queued message removed");
		return removedMessages.length;
	}

	getCurrentSession(): PiboPiSessionSnapshot {
		const getCurrentSession = this.runtimeSession.controls?.getCurrentSession;
		if (!getCurrentSession) throw runtimeCapabilityError(this.runtimeSession, "native session inspection");
		return nativeSnapshotToPiCompatibility(this.runtimeSession, getCurrentSession());
	}

	async listSessions(): Promise<PiboSessionListItem[]> {
		const listSessions = this.runtimeSession.controls?.listSessions;
		if (!listSessions) throw runtimeCapabilityError(this.runtimeSession, "native session listing");
		return (await listSessions()).map((info) => nativeSessionInfoToPiCompatibility(this.runtimeSession, info));
	}

	async getForkCandidates(): Promise<PiboForkCandidate[]> {
		if (this.forkCandidatesRequest) return await this.forkCandidatesRequest;
		if (this.sessionIdentityOperationInFlight) {
			throw new Error("Pibo session already has a session identity operation in progress; cannot inspect fork candidates.");
		}
		const status = this.getStatus();
		const sourceHasWork = status.processing || status.streaming || status.queuedMessages > 0;
		if (sourceHasWork) {
			const getForkCandidatesWhileRunning = this.runtimeSession.controls?.getForkCandidatesWhileRunning;
			if (!getForkCandidatesWhileRunning) this.assertSessionWorkIdle("inspect fork candidates");
			const request = Promise.resolve().then(async () => await getForkCandidatesWhileRunning!());
			this.forkCandidatesRequest = request;
			try {
				return await request;
			} finally {
				if (this.forkCandidatesRequest === request) this.forkCandidatesRequest = undefined;
			}
		}

		const getForkCandidates = this.runtimeSession.controls?.getForkCandidates;
		if (!getForkCandidates) throw runtimeCapabilityError(this.runtimeSession, "native session fork candidates");
		this.sessionIdentityOperationInFlight = true;
		this.notifyState();
		const request = Promise.resolve().then(async () => await getForkCandidates());
		this.forkCandidatesRequest = request;
		try {
			return await request;
		} finally {
			if (this.forkCandidatesRequest === request) this.forkCandidatesRequest = undefined;
			this.sessionIdentityOperationInFlight = false;
			this.notifyState();
			this.startDrain();
		}
	}

	async forkSession(entryId: string): Promise<PiboSessionOperationResult> {
		if (this.forkWhileRunningOperationInFlight) {
			const forkSessionWhileRunning = this.runtimeSession.controls?.forkSessionWhileRunning;
			if (!forkSessionWhileRunning) throw runtimeCapabilityError(this.runtimeSession, "forking completed history while running");
			return nativeOperationToPiCompatibility(
				this.runtimeSession,
				this.piboSessionId,
				await forkSessionWhileRunning(entryId),
			);
		}
		this.assertSessionWorkIdle("fork");
		const forkSession = this.runtimeSession.controls?.forkSession;
		if (!forkSession) throw runtimeCapabilityError(this.runtimeSession, "native session fork");
		return nativeOperationToPiCompatibility(this.runtimeSession, this.piboSessionId, await forkSession(entryId));
	}

	async cloneSession(): Promise<PiboSessionOperationResult> {
		this.assertSessionWorkIdle("clone");
		const cloneSession = this.runtimeSession.controls?.cloneSession;
		if (!cloneSession) throw runtimeCapabilityError(this.runtimeSession, "native session clone");
		return nativeOperationToPiCompatibility(this.runtimeSession, this.piboSessionId, await cloneSession());
	}

	private assertSessionIdentityOperationIdle(operation: string): void {
		if (this.sessionIdentityOperationInFlight) {
			throw new Error(`Pibo session already has a session identity operation in progress; cannot ${operation}.`);
		}
		this.assertSessionWorkIdle(operation);
	}

	private assertSessionWorkIdle(operation: string): void {
		const status = this.getStatus();
		if (status.processing || status.streaming || status.queuedMessages > 0) {
			throw new Error(`Pibo session must be idle to ${operation}.`);
		}
	}

	getSessionTree(): PiboSessionTreeResult {
		const getSessionTree = this.runtimeSession.controls?.getSessionTree;
		if (!getSessionTree) throw runtimeCapabilityError(this.runtimeSession, "native session tree");
		const result = getSessionTree();
		return {
			current: nativeSnapshotToPiCompatibility(this.runtimeSession, result.current),
			tree: result.tree,
		};
	}

	async navigateSessionTree(params: PiboSessionTreeNavigateParams): Promise<PiboSessionOperationResult> {
		const navigate = this.runtimeSession.controls?.navigateSessionTree;
		if (!navigate) throw runtimeCapabilityError(this.runtimeSession, "native session tree navigation");
		return nativeOperationToPiCompatibility(
			this.runtimeSession,
			this.piboSessionId,
			await navigate(params as unknown as PiboJsonObject),
		);
	}

	async switchSession(params: PiboSessionSwitchParams): Promise<PiboSessionOperationResult> {
		const switchSession = this.runtimeSession.controls?.switchSession;
		if (!switchSession) throw runtimeCapabilityError(this.runtimeSession, "native session switching");
		return nativeOperationToPiCompatibility(
			this.runtimeSession,
			this.piboSessionId,
			await switchSession(params as unknown as PiboJsonObject),
		);
	}

	async setModel(model: ModelProfile): Promise<ModelProfile> {
		const selected = await this.setRuntimeModelPreservingReasoning(model);
		this.primaryModel = { ...selected };
		return selected;
	}

	private async setRuntimeModelPreservingReasoning(model: ModelProfile): Promise<ModelProfile> {
		const controls = this.runtimeSession.controls;
		const setModel = controls?.setModel;
		if (!setModel) throw runtimeCapabilityError(this.runtimeSession, "in-session model switching");
		const priorReasoning = controls.getReasoning?.() ?? this.runtimeSession.getStatus().reasoning;
		const selected = await setModel(model);
		if (!priorReasoning?.supported || !priorReasoning.value || !controls.setReasoning) return selected;

		const currentReasoning = controls.getReasoning?.() ?? this.runtimeSession.getStatus().reasoning;
		if (!currentReasoning?.supported || currentReasoning.value === priorReasoning.value) return selected;
		if (currentReasoning.availableValues?.length && !currentReasoning.availableValues.includes(priorReasoning.value)) {
			return selected;
		}
		controls.setReasoning(priorReasoning.value);
		return selected;
	}

	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult {
		const setReasoning = this.runtimeSession.controls?.setReasoning;
		if (!setReasoning) throw runtimeCapabilityError(this.runtimeSession, "reasoning-level selection");
		const result = setReasoning(level);
		return {
			level: typeof result.value === "string" && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result.availableValues.filter(isPiboThinkingLevel),
			supported: result.supported,
		};
	}

	cycleThinkingLevel(): PiboThinkingResult {
		const cycleReasoning = this.runtimeSession.controls?.cycleReasoning;
		if (!cycleReasoning) throw runtimeCapabilityError(this.runtimeSession, "reasoning-level cycling");
		const result = cycleReasoning();
		return {
			level: typeof result.value === "string" && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result.availableValues.filter(isPiboThinkingLevel),
			supported: result.supported,
		};
	}

	getFastMode(): { mode: "fast" | "normal"; supported: boolean } {
		const getFastMode = this.runtimeSession.controls?.getFastMode;
		return getFastMode ? getFastMode() : { mode: "normal", supported: false };
	}

	setFastMode(enabled: boolean): { mode: "fast" | "normal"; supported: boolean; changed: boolean } {
		const setFastMode = this.runtimeSession.controls?.setFastMode;
		if (!setFastMode) return { mode: "normal", supported: false, changed: false };
		const result = setFastMode(enabled);
		return { ...result, changed: result.changed ?? false };
	}

	async compact(customInstructions?: string): ReturnType<PiboGatewayActionContext["compact"]> {
		const compact = this.runtimeSession.controls?.compact;
		if (!compact) throw runtimeCapabilityError(this.runtimeSession, "compaction");
		return await compact(customInstructions) as Awaited<ReturnType<PiboGatewayActionContext["compact"]>>;
	}

	async respondToApproval(requestId: string, decision: string): Promise<void> {
		const respond = this.runtimeSession.controls?.respondToApproval;
		if (!respond) throw runtimeCapabilityError(this.runtimeSession, "approval responses");
		await respond(requestId, decision);
	}

	async respondToUserInput(requestId: string, answers: PiboJsonObject): Promise<void> {
		const respond = this.runtimeSession.controls?.respondToUserInput;
		if (!respond) throw runtimeCapabilityError(this.runtimeSession, "structured user-input responses");
		await respond(requestId, answers);
	}

	async dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposePromise = this.disposeUnsafe();
		return this.disposePromise;
	}

	forceDispose(reason = "session disposal timed out"): void {
		this.transitionToDisposed(reason);
		if (this.forceDisposalStarted) return;
		this.forceDisposalStarted = true;
		void this.runtimeSession.abort().catch(() => {});
		void this.disposeRuntime().catch(() => {});
	}

	async kill(): Promise<string> {
		this.notifyMessagesInterrupted(this.activeAndQueuedMessages(), "session killed");
		this.queue.length = 0;
		this.notifyState();
		await this.runtimeSession.abort();
		return this.piboSessionId;
	}

	async cancelMessage(eventId: string): Promise<boolean> {
		this.assertActive();
		const queuedIndex = this.queue.findIndex((item) => item.event.id === eventId);
		if (queuedIndex >= 0) {
			const [removed] = this.queue.splice(queuedIndex, 1);
			if (removed?.kind === "message") this.notifyMessagesInterrupted([removed.event], "message cancelled");
			this.notifyState();
			return true;
		}
		const inFlight = this.inFlightMessage;
		if (inFlight?.event.id === eventId) {
			if (!inFlight.cancellation) {
				inFlight.cancelled = true;
				this.notifyMessagesInterrupted([inFlight.event], "message cancelled");
				const active = this.activeMessage?.id === eventId;
				inFlight.cancellation = (async () => {
					try {
						if (active) await this.runtimeSession.abort();
						await inFlight.settled;
					} catch (error) {
						inFlight.cancelled = false;
						inFlight.cancellation = undefined;
						throw error;
					}
				})();
			}
			await inFlight.cancellation;
			return true;
		}
		if (this.activeMessage?.id === eventId) {
			this.notifyMessagesInterrupted([this.activeMessage], "message cancelled");
			await this.runtimeSession.abort();
			return true;
		}
		return false;
	}

	private handleRuntimeEvent(event: AgentRuntimeSemanticEvent): void {
		switch (event.type) {
			case "assistant_delta":
				this.emit(this.withActiveMessage({
					type: "assistant_delta",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "assistant_message":
				this.emit(this.withActiveMessage({
					type: "assistant_message",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_started":
				this.emit(this.withActiveMessage({
					type: "thinking_started",
					piboSessionId: this.piboSessionId,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_delta":
				this.emit(this.withActiveMessage({
					type: "thinking_delta",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_finished":
				this.emit(this.withActiveMessage({
					type: "thinking_finished",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "tool_call":
				this.emit(this.withActiveMessage({ ...event, type: "tool_call", piboSessionId: this.piboSessionId }));
				return;
			case "tool_execution_started":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_started", piboSessionId: this.piboSessionId }));
				this.trackRunReminderTurnGuard("tool_execution_started", { toolName: event.toolName, args: event.args });
				return;
			case "tool_execution_updated":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_updated", piboSessionId: this.piboSessionId }));
				return;
			case "tool_execution_finished":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_finished", piboSessionId: this.piboSessionId }));
				return;
			case "usage":
				this.emit(this.withActiveMessage({
					type: "assistant_usage",
					piboSessionId: this.piboSessionId,
					inputTokens: event.usage.inputTokens,
					outputTokens: event.usage.outputTokens,
					cacheReadTokens: event.usage.cacheReadTokens,
					cacheWriteTokens: event.usage.cacheWriteTokens,
					reasoningTokens: event.usage.reasoningTokens,
					totalTokens: event.usage.totalTokens,
					costUsd: event.usage.costUsd,
					provenance: this.activeMessage?.provenance,
				}));
				this.trackRunReminderTurnGuard("usage", {
					totalTokens: event.usage.totalTokens,
					cacheReadTokens: event.usage.cacheReadTokens,
				});
				return;
			case "compaction_start":
				this.emit(this.withActiveMessage({
					type: "compaction_start",
					piboSessionId: this.piboSessionId,
					reason: event.reason,
				}));
				return;
			case "compaction_end":
				// Compaction continues the same product turn and eventId, so close open
				// blocks without reusing their persisted output-part indices.
				if (event.result && !event.aborted) this.closeActiveContentParts();
				this.emit(this.withActiveMessage({
					type: "compaction_end",
					piboSessionId: this.piboSessionId,
					reason: event.reason,
					result: event.result,
					aborted: event.aborted,
					errorMessage: event.errorMessage,
				}));
				return;
			case "approval_requested":
				this.emit(this.withActiveMessage({
					type: "approval_requested",
					piboSessionId: this.piboSessionId,
					request: structuredClone(event.request),
				}));
				return;
			case "approval_resolved":
				this.emit(this.withActiveMessage({
					type: "approval_resolved",
					piboSessionId: this.piboSessionId,
					requestId: event.requestId,
					resolution: event.resolution,
				}));
				return;
			case "user_input_requested":
				this.emit(this.withActiveMessage({
					type: "user_input_requested",
					piboSessionId: this.piboSessionId,
					request: structuredClone(event.request),
				}));
				return;
			case "user_input_resolved":
				this.emit(this.withActiveMessage({
					type: "user_input_resolved",
					piboSessionId: this.piboSessionId,
					requestId: event.requestId,
					resolution: event.resolution,
				}));
				return;
			case "error":
				this.handleRuntimeFailure(event.message, event.details);
				return;
			case "turn_failed":
				this.handleRuntimeFailure(event.message, event.details);
				return;
			case "native_event":
				this.options.onNativeEventTelemetry?.(this.piboSessionId, event.event, {
					status: this.getStatus(),
					activeEventId: this.activeMessage?.id ?? this.activeExecutionEvent?.id,
				});
				if (
					this.options.forwardLegacyPiEvents
					&& this.runtimeSession.compatibility?.productRawEventType === "pi_event"
				) {
					this.emit({ type: "pi_event", piboSessionId: this.piboSessionId, event: event.event });
				}
				return;
			default:
				return;
		}
	}

	private handleRuntimeFailure(message: string, details?: PiboSessionErrorDetails): void {
		const normalized = normalizeSessionErrorDetails(message, details);
		if (this.suppressProviderFailures && isPiboProviderFallbackError(message, normalized)) {
			this.pendingProviderFailure = { message, details: normalized };
			return;
		}
		this.emitRuntimeError(message, normalized);
	}

	private emitRuntimeError(message: string, details?: PiboSessionErrorDetails): void {
		if (this.activeMessageFailed) return;
		this.activeMessageFailed = true;
		this.emit(this.withActiveMessage({
			type: "session_error",
			piboSessionId: this.piboSessionId,
			error: message,
			errorDetails: details ?? runtimeSessionErrorDetails(message),
			provenance: this.activeMessage?.provenance,
		}));
	}

	private startDrain(): void {
		if (this.drainPromise || this.sessionIdentityOperationInFlight) return;
		const drain = this.drain();
		this.drainPromise = drain;
		void drain.finally(() => {
			if (this.drainPromise !== drain) return;
			this.drainPromise = undefined;
			if (this.queue.length > 0 && !this.disposed) this.startDrain();
		});
	}

	private async drain(): Promise<void> {
		if (this.processing || this.disposed) return;
		this.processing = true;
		this.notifyState();
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const item = this.queue.shift()!;
				this.notifyState();
				if (item.kind === "compact") await this.processQueuedCompact(item.event);
				else await this.processQueuedMessage(item.event);
			}
		} finally {
			this.processing = false;
			this.notifyState();
		}
	}

	private async promptWithModelFallbacks(
		event: PiboMessageEvent,
		inFlight: RuntimeInFlightMessage,
	): Promise<void> {
		const canSetModel = Boolean(this.runtimeSession.controls?.setModel);
		const fallbackModels = this.modelFallbacks.filter((model) => !sameModel(model, this.primaryModel));
		if (!canSetModel || fallbackModels.length === 0) {
			await this.runtimeSession.prompt({
				text: event.text,
				source: promptSource(event.source),
				capabilityScope: event.capabilityScope,
			});
			return;
		}

		this.suppressProviderFailures = true;
		let switchedModel = false;
		let finalFailure: { message: string; details: PiboSessionErrorDetails } | undefined;
		try {
			for (let attempt = 0; attempt <= fallbackModels.length; attempt += 1) {
				if (this.disposed || inFlight.cancelled) return;
				if (attempt > 0) {
					try {
						await this.setRuntimeModelPreservingReasoning(fallbackModels[attempt - 1]!);
						switchedModel = true;
					} catch {
						continue;
					}
				}

				this.pendingProviderFailure = undefined;
				let promptError: unknown;
				try {
					await this.runtimeSession.prompt({
						text: attempt === 0 ? event.text : PIBO_PROVIDER_RECOVERY_PROMPT,
						source: attempt === 0 ? promptSource(event.source) : "rpc",
						capabilityScope: event.capabilityScope,
					});
				} catch (error) {
					promptError = error;
				}
				if (this.disposed || inFlight.cancelled) return;

				const failure = this.pendingProviderFailure;
				if (!failure) {
					if (promptError) throw promptError;
					return;
				}
				finalFailure = failure;
			}

			if (finalFailure) this.emitRuntimeError(finalFailure.message, finalFailure.details);
		} finally {
			this.suppressProviderFailures = false;
			this.pendingProviderFailure = undefined;
			if (switchedModel && this.primaryModel && !this.disposed) {
				try {
					await this.setRuntimeModelPreservingReasoning(this.primaryModel);
				} catch (error) {
					console.warn(`Failed to restore primary model for Pibo session "${this.piboSessionId}": ${errorMessage(error)}`);
				}
			}
		}
	}

	private async processQueuedMessage(event: PiboMessageEvent): Promise<void> {
		const inFlight = this.beginInFlightMessage(event);
		try {
			const preflight = await this.options.messagePreflight?.(event);
			if (this.disposed || inFlight.cancelled) return;
			if (preflight && !preflight.allowed) {
				this.emit({
					type: "session_error",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					error: preflight.reason ?? "Queued message is no longer authorized",
					errorDetails: {
						category: "loop_lifecycle",
						errorClass: "runtime_abort",
						code: preflight.code ?? "message_preflight_rejected",
						origin: "runtime",
						retryable: false,
					},
					provenance: event.provenance,
				});
				return;
			}
			this.activeMessage = event;
			this.activeMessageFailed = false;
			this.beginRunReminderTurnGuard(event);
			this.resetContentIndices();
			this.emit({
				type: "message_started",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				text: event.text,
				source: event.source,
				provenance: event.provenance,
			});
			if (inFlight.cancelled) return;
			await this.promptWithModelFallbacks(event, inFlight);
			if (this.disposed || inFlight.cancelled) return;
			if (!this.activeMessageFailed) {
				this.emit({
					type: "message_finished",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					source: event.source,
					provenance: event.provenance,
				});
			}
		} catch (error) {
			if (this.disposed || inFlight.cancelled) return;
			if (!this.activeMessageFailed) {
				const message = errorMessage(error);
				this.emit({
					type: "session_error",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					error: message,
					errorDetails: runtimeSessionErrorDetails(message),
					provenance: event.provenance,
				});
			}
		} finally {
			this.suppressProviderFailures = false;
			this.pendingProviderFailure = undefined;
			this.activeMessage = undefined;
			this.activeMessageFailed = false;
			this.resetContentIndices();
			this.clearRunReminderTurnGuard();
			if (this.inFlightMessage === inFlight) this.inFlightMessage = undefined;
			inFlight.resolveSettled();
		}
	}

	private beginInFlightMessage(event: PiboMessageEvent): RuntimeInFlightMessage {
		let resolveSettled: (() => void) | undefined;
		const inFlight: RuntimeInFlightMessage = {
			event,
			cancelled: false,
			settled: new Promise<void>((resolve) => { resolveSettled = resolve; }),
			resolveSettled: () => { resolveSettled?.(); },
		};
		this.inFlightMessage = inFlight;
		return inFlight;
	}

	private beginRunReminderTurnGuard(event: PiboMessageEvent): void {
		this.clearRunReminderTurnGuard();
		if (event.source !== "service" || !event.text.startsWith("<pibo_run_notification>")) return;
		const guard: RunReminderTurnGuard = {
			eventId: event.id,
			toolExecutions: 0,
			providerRounds: 0,
			activeTokens: 0,
			toolSignatures: new Map<string, number>(),
			tripped: false,
		};
		guard.timer = setTimeout(() => {
			this.tripRunReminderTurnGuard(guard, `exceeded ${RUN_REMINDER_MAX_DURATION_MS / 60_000} minutes`);
		}, RUN_REMINDER_MAX_DURATION_MS);
		guard.timer.unref?.();
		this.runReminderTurnGuard = guard;
	}

	private clearRunReminderTurnGuard(): void {
		const guard = this.runReminderTurnGuard;
		if (!guard) return;
		if (guard.timer) clearTimeout(guard.timer);
		this.runReminderTurnGuard = undefined;
	}

	private trackRunReminderTurnGuard(
		type: "usage" | "tool_execution_started",
		payload: { totalTokens?: number; cacheReadTokens?: number } | { toolName?: string; args?: unknown },
	): void {
		const guard = this.runReminderTurnGuard;
		if (!guard || guard.tripped || guard.eventId !== this.activeMessage?.id) return;
		if (type === "usage") {
			const usage = payload as { totalTokens?: number; cacheReadTokens?: number };
			const activeTokens = Math.max(0, (usage.totalTokens ?? 0) - (usage.cacheReadTokens ?? 0));
			guard.activeTokens += activeTokens;
			guard.providerRounds += 1;
			if (guard.activeTokens > RUN_REMINDER_MAX_ACTIVE_TOKENS) {
				this.tripRunReminderTurnGuard(guard, `exceeded ${RUN_REMINDER_MAX_ACTIVE_TOKENS} active tokens`);
				return;
			}
			if (guard.providerRounds > RUN_REMINDER_MAX_PROVIDER_ROUNDS) {
				this.tripRunReminderTurnGuard(guard, `exceeded ${RUN_REMINDER_MAX_PROVIDER_ROUNDS} provider rounds`);
			}
			return;
		}
		const toolName = (payload as { toolName?: string }).toolName;
		const args = (payload as { toolName?: string; args?: unknown }).args;
		guard.toolExecutions += 1;
		if (guard.toolExecutions > RUN_REMINDER_MAX_TOOL_EXECUTIONS) {
			this.tripRunReminderTurnGuard(guard, `exceeded ${RUN_REMINDER_MAX_TOOL_EXECUTIONS} tool executions`);
			return;
		}
		const signature = `${String(toolName ?? "unknown")}:${serializedToolArgs(args)}`;
		const repeated = (guard.toolSignatures.get(signature) ?? 0) + 1;
		guard.toolSignatures.set(signature, repeated);
		if (repeated > RUN_REMINDER_MAX_REPEATED_TOOL_CALLS) {
			this.tripRunReminderTurnGuard(guard, `repeated the same tool call more than ${RUN_REMINDER_MAX_REPEATED_TOOL_CALLS} times`);
		}
	}

	private tripRunReminderTurnGuard(guard: RunReminderTurnGuard, reason: string): void {
		if (guard.tripped || this.runReminderTurnGuard !== guard) return;
		guard.tripped = true;
		this.activeMessageFailed = true;
		const error = `Run-reminder turn stopped because it ${reason}.`;
		this.emit({
			type: "session_error",
			piboSessionId: this.piboSessionId,
			eventId: guard.eventId,
			error,
			errorDetails: {
				category: "runtime_abort",
				errorClass: "runtime_abort",
				code: "run_reminder_limit_exceeded",
				origin: "runtime",
				retryable: false,
				userMessage: error,
			},
			provenance: this.activeMessage?.provenance,
		});
		void Promise.resolve(this.runtimeSession.abort()).catch(() => undefined);
	}

	private async processQueuedCompact(event: PiboExecutionEvent): Promise<void> {
		this.activeExecutionEvent = event;
		try {
			const result = await this.runAction(event);
			if (this.disposed) return;
			this.emit({
				type: "execution_result",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				action: event.action,
				result,
			});
		} catch (error) {
			if (this.disposed) return;
			const message = errorMessage(error);
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				error: message,
				errorDetails: runtimeSessionErrorDetails(message),
			});
		} finally {
			this.activeExecutionEvent = undefined;
		}
	}

	private enqueueCompactAction(event: PiboExecutionEvent): PiboOutputEvent {
		this.queue.push({ kind: "compact", event });
		const output: PiboOutputEvent = {
			type: "execution_result",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			action: event.action,
			result: { queued: true, queuedMessages: this.queue.length },
		};
		this.emit(output);
		this.notifyState();
		this.startDrain();
		return output;
	}

	private async runAction(event: PiboExecutionEvent): Promise<unknown> {
		const gatewayAction = this.pluginRegistry.getGatewayAction(event.action);
		if (!gatewayAction) throw new Error(`Unknown execution action "${event.action}"`);
		return await gatewayAction.execute(
			{
				piboSessionId: this.piboSessionId,
				runtimeInstanceId: this.runtimeSession.runtimeInstanceId,
				runtimeAuthRequired: this.runtimeSession.capabilities.auth.status
					&& this.runtimeSession.capabilities.auth.methods.length > 0,
				getStatus: () => this.getStatus(),
				getStatusSnapshot: () => this.getStatusSnapshot(),
				getContextUsage: () => this.getActionContextUsage(),
				getActiveModel: () => this.getActiveModel(),
				getModelCatalog: async () => {
					const adapter = this.pluginRegistry.getAgentRuntimeAdapter(this.runtimeSession.runtimeInstanceId);
					return adapter?.listModels
						? await adapter.listModels()
						: { runtimeInstanceId: this.runtimeSession.runtimeInstanceId, models: [] };
				},
				getRuntimeAuthStatus: async () => this.options.getRuntimeAuthStatus
					? await this.options.getRuntimeAuthStatus()
					: await this.pluginRegistry.getAgentRuntimeAuthStatus(this.runtimeSession.runtimeInstanceId),
				startRuntimeAuth: async (input) => this.options.startRuntimeAuth
					? await this.options.startRuntimeAuth(input)
					: await this.pluginRegistry.startAgentRuntimeAuth(this.runtimeSession.runtimeInstanceId, input),
				completeRuntimeAuth: async (input) => this.options.completeRuntimeAuth
					? await this.options.completeRuntimeAuth(input)
					: await this.pluginRegistry.completeAgentRuntimeAuth(this.runtimeSession.runtimeInstanceId, input),
				cancelRuntimeAuth: async (input) => this.options.cancelRuntimeAuth
					? await this.options.cancelRuntimeAuth(input)
					: await this.pluginRegistry.cancelAgentRuntimeAuth(this.runtimeSession.runtimeInstanceId, input),
				logoutRuntimeAuth: async (input) => this.options.logoutRuntimeAuth
					? await this.options.logoutRuntimeAuth(input)
					: await this.pluginRegistry.logoutAgentRuntimeAuth(this.runtimeSession.runtimeInstanceId, input),
				getProviderUsage: () => this.getActionProviderUsage(),
				clearQueue: () => this.clearQueue(),
				abort: async () => {
					if (this.activeMessage) this.notifyMessagesInterrupted([this.activeMessage], "abort requested");
					await this.runtimeSession.abort();
				},
				dispose: () => this.dispose(),
				getCurrentSession: () => this.getCurrentSession(),
				listSessions: () => this.listSessions(),
				getForkCandidates: () => this.getForkCandidates(),
				forkSession: (entryId) => this.forkSession(entryId),
				cloneSession: () => this.cloneSession(),
				getSessionTree: () => this.getSessionTree(),
				navigateSessionTree: (params) => this.navigateSessionTree(params),
				switchSession: (params) => this.switchSession(params),
				getThinkingLevel: () => this.getThinkingResult(),
				setThinkingLevel: (level) => this.setThinkingLevel(level),
				cycleThinkingLevel: () => this.cycleThinkingLevel(),
				getFastMode: () => this.getFastMode(),
				setFastMode: (enabled) => this.setFastMode(enabled),
				setModel: (model) => this.setModel(model),
				compact: (customInstructions) => this.compact(customInstructions),
				respondToApproval: (requestId, decision) => this.respondToApproval(requestId, decision),
				respondToUserInput: (requestId, answers) => this.respondToUserInput(requestId, answers),
				kill: async () => {
					const killed = [await this.kill()];
					let cancelledRuns: string[] = [];
					if (this.options.onKillChildren) {
						const children = await this.options.onKillChildren(this.piboSessionId);
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
				killAll: async () => {
					const killed = [await this.kill()];
					let cancelledRuns: string[] = [];
					if (this.options.onKillChildren) {
						const children = await this.options.onKillChildren(this.piboSessionId, { includeRuns: true });
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
			},
			event,
		);
	}

	private getThinkingResult(): PiboThinkingResult {
		const result = this.runtimeSession.controls?.getReasoning?.();
		return {
			level: result?.value && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result?.availableValues.filter(isPiboThinkingLevel) ?? [],
			supported: result?.supported ?? false,
		};
	}

	private transitionToDisposed(reason: string): boolean {
		if (this.disposed) return false;
		const activeMessage = this.activeMessage;
		this.notifyMessagesInterrupted(this.activeAndQueuedMessages(), reason);
		if (activeMessage) {
			const error = `Session disposed while a message was active: ${reason}`;
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: activeMessage.id,
				error,
				errorDetails: runtimeSessionErrorDetails(error),
			});
		}
		this.queue.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		this.processing = false;
		this.notifyState();
		return true;
	}

	private disposeRuntime(): Promise<void> {
		if (!this.runtimeDisposePromise) {
			try {
				this.runtimeDisposePromise = Promise.resolve(this.runtimeSession.dispose());
			} catch (error) {
				this.runtimeDisposePromise = Promise.reject(error);
			}
		}
		return this.runtimeDisposePromise;
	}

	private async disposeUnsafe(): Promise<void> {
		if (!this.transitionToDisposed("session disposed")) return;
		try {
			await Promise.allSettled([this.runtimeSession.abort()]);
			await this.drainPromise;
		} finally {
			await this.disposeRuntime();
		}
	}

	private clearQueue(): number {
		const cleared = this.queue.length;
		const removedMessages = this.queue.flatMap((item) => item.kind === "message" ? [item.event] : []);
		this.queue.length = 0;
		this.notifyMessagesInterrupted(removedMessages, "queue cleared");
		this.notifyState();
		return cleared;
	}

	private activeAndQueuedMessages(): PiboMessageEvent[] {
		const messages = this.queue.flatMap((item) => item.kind === "message" ? [item.event] : []);
		const inFlight = this.inFlightMessage?.event;
		if (this.activeMessage) return [this.activeMessage, ...messages];
		return inFlight ? [inFlight, ...messages] : messages;
	}

	private notifyMessagesInterrupted(messages: readonly PiboMessageEvent[], reason: string): void {
		if (messages.length === 0) return;
		this.options.onMessagesInterrupted?.(messages, reason);
	}

	private notifyState(): void {
		this.options.onStateChange?.({
			processing: this.processing,
			queuedMessages: this.queue.length,
			disposed: this.disposed,
			sessionIdentityOperationInFlight: this.sessionIdentityOperationInFlight,
		});
	}

	private closeActiveContentParts(): void {
		this.activeAssistantIndex = undefined;
		this.activeThinkingIndex = undefined;
	}

	private resetContentIndices(): void {
		this.closeActiveContentParts();
		this.nextAssistantIndex = 0;
		this.nextThinkingIndex = 0;
	}

	private withActiveMessage(event: PiboOutputEvent): PiboOutputEvent {
		const activeMessage = this.activeMessage;
		if (!activeMessage?.id) return event;
		const correlation = {
			eventId: activeMessage.id,
			...(activeMessage.provenance ? { provenance: activeMessage.provenance } : {}),
		};
		if (event.type === "assistant_delta") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) {
				this.nextAssistantIndex += 1;
				this.activeAssistantIndex = assistantIndex;
			}
			return { ...event, ...correlation, assistantIndex };
		}
		if (event.type === "assistant_message") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) this.nextAssistantIndex += 1;
			this.activeAssistantIndex = undefined;
			return { ...event, ...correlation, assistantIndex };
		}
		if (event.type === "thinking_started") {
			const thinkingIndex = this.nextThinkingIndex;
			this.nextThinkingIndex += 1;
			this.activeThinkingIndex = thinkingIndex;
			return { ...event, ...correlation, thinkingIndex };
		}
		if (event.type === "thinking_delta" || event.type === "thinking_finished") {
			const thinkingIndex = this.activeThinkingIndex ?? this.nextThinkingIndex;
			if (this.activeThinkingIndex === undefined) {
				this.nextThinkingIndex += 1;
				this.activeThinkingIndex = thinkingIndex;
			}
			const output = { ...event, ...correlation, thinkingIndex };
			if (event.type === "thinking_finished") this.activeThinkingIndex = undefined;
			return output;
		}
		if (
			event.type === "assistant_usage"
			|| event.type === "compaction_start"
			|| event.type === "compaction_end"
			|| event.type === "tool_call"
			|| event.type === "tool_execution_started"
			|| event.type === "tool_execution_updated"
			|| event.type === "tool_execution_finished"
			|| event.type === "approval_requested"
			|| event.type === "approval_resolved"
			|| event.type === "user_input_requested"
			|| event.type === "user_input_resolved"
			|| event.type === "session_error"
			|| event.type === "execution_result"
		) {
			return { ...event, ...correlation };
		}
		return event;
	}

	private assertActive(): void {
		if (this.disposed) throw new Error(`Session "${this.piboSessionId}" has been disposed`);
	}
}

export function runtimeReminderToolNames(toolNames: readonly string[]): string[] {
	return toolNames.filter((name) => RUN_REMINDER_CAPABILITY_TOOLS.has(name));
}
