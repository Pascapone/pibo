import { randomUUID } from "node:crypto";
import { MspError } from "@muse-code/sdk";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
import {
	AgentRuntimeAuthError,
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../../agent-runtime/errors.js";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeModelCatalog,
	AgentRuntimePromptInput,
	AgentRuntimeSandboxResult,
	AgentRuntimeSession,
	AgentRuntimeStatus,
	LogoutAgentRuntimeAuthInput,
	OpenAgentRuntimeSessionInput,
	RuntimeSessionBinding,
	StartAgentRuntimeAuthInput,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import {
	selectRequestedModelProfile,
	selectRequestedThinkingLevel,
	type PiboModelDefaults,
} from "../../core/model-defaults.js";
import type { ModelProfile } from "../../core/profiles.js";
import {
	MUSE_NATIVE_APPROVAL_MODES,
	MUSE_NATIVE_RUNTIME_CONFIG_SCHEMA,
	MUSE_NATIVE_SANDBOX_MODES,
	defaultMuseNativeRuntimeConfig,
	parseMuseNativeRuntimeConfig,
	type MuseNativeRuntimeConfig,
	type MuseNativeSandboxMode,
} from "./config.js";
import {
	diagnoseMuseNativeRuntime,
	startMuseNativeHost,
	withTimeout,
	type MuseNativeHostProcess,
} from "./process.js";
import {
	MUSE_NATIVE_ADAPTER_ID,
	MuseNativeConnectionPump,
	MuseNativeSessionController,
	MuseNativeSessionMissingError,
	readMuseDurability,
	type MuseNativeSessionSummary,
} from "./sessions.js";
import {
	MUSE_PROTOCOL_NAME,
	MUSE_PROTOCOL_SUPPORTED_RANGE,
	MUSE_PROTOCOL_VERSION,
	MUSE_NATIVE_ADAPTER_VERSION,
} from "./protocol-version.js";
import { MUSE_FALLBACK_TOOL_NAME, MuseNativeTurnController, type MuseTurnRecoveryOptions } from "./turn.js";
import { MuseNativeRequestController } from "./requests.js";
import { MuseNativeResourceDelivery } from "./resource-delivery.js";
import {
	BINDING_SANDBOX_KEY,
	MUSE_NATIVE_MODEL_PROVIDER_ID,
	MUSE_NATIVE_REASONING_VALUES,
	MuseSessionSettingsController,
	mapThinkingLevelToReasoning,
	parseMuseProfileOptions,
	readMuseModelCatalog,
	readMusePersistedSettings,
	selectDefaultCatalogModel,
	toAgentRuntimeModelCatalog,
	type MuseNativeModelCatalog,
	type MuseNativeProfileOptions,
} from "./models.js";
import { MuseNativeAuthController } from "./auth.js";

export { MUSE_NATIVE_ADAPTER_ID } from "./sessions.js";

const MAX_INSPECTED_SELECTED_TOOL_NAMES = 512;
const MAX_INSPECTED_TOOL_NAMES = 256;
const MODEL_CATALOG_CACHE_TTL_MS = 5_000;
// Rejection signature of a wedged host turn intake: the next turn/start after a
// failed manual compaction is refused because re-appending an already-logged
// event id conflicts. The durable log stays intact, so a same-host re-sync
// clears the stale intake state and the prompt can be retried.
const WEDGED_TURN_INTAKE_SIGNATURE = "conflicts with an existing event";

function isWedgedTurnIntakeError(error: unknown): boolean {
	return error instanceof Error && error.message.toLowerCase().includes(WEDGED_TURN_INTAKE_SIGNATURE);
}

function museNativeCapabilities(): AgentRuntimeCapabilities {
	return {
		lifecycle: {
			persistent: true,
			lazyBinding: false,
			resume: true,
			attach: false,
			listNativeSessions: true,
			fork: true,
			forkWhileRunning: false,
			clone: true,
			tree: false,
		},
		input: {
			text: true,
			images: false,
			audio: false,
			steering: true,
			structuredOutput: false,
		},
		output: {
			assistantDeltas: true,
			reasoning: true,
			toolEvents: true,
			usage: true,
			plans: false,
			diffs: true,
			rawNativeEvents: false,
		},
		tools: {
			piboManaged: { support: "mcp", transports: ["streamable-http"] },
			nativeToolInspection: {
				support: "degraded",
				mode: "observed-runtime-items",
				reason: "Stable Muse 1.3.0 does not expose a complete pre-turn native-tool inventory; Pibo reports selected MCP tools immediately and harness-native tools after stable item notifications prove they are active.",
			},
			nativeToolYielding: unsupportedAgentRuntimeCapability(
				"Muse native tools remain harness-owned and are not wrapped as Pibo yielded tools.",
			),
			intentTracing: {
				supported: true,
				configurable: false,
				enabledByDefault: true,
			},
		},
		mcp: {
			externalServers: { support: "mcp", transports: ["streamable-http", "stdio"] },
			statusInspection: false,
		},
		skills: unsupportedAgentRuntimeCapability(
			"Muse skill discovery has no verified materialization path in this adapter; selected skills are not delivered.",
		),
		context: unsupportedAgentRuntimeCapability(
			"Muse context discovery has no verified materialization path in this adapter; selected context files are not delivered.",
		),
		contextDiscovery: {
			supported: false,
			configurable: false,
			enabledByDefault: false,
		},
		nativeSubagents: {
			supported: false,
			configurable: false,
			enabledByDefault: false,
		},
		historyImport: false,
		auth: {
			status: true,
			methods: [
				{ id: "api_key", completion: "immediate" },
			],
			cancel: false,
			logout: true,
			credentialScope: "runtime-instance",
		},
		models: {
			catalog: true,
			switchInSession: true,
			optionsSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					approvalMode: {
						type: "string",
						title: "Approval mode",
						enum: [...MUSE_NATIVE_APPROVAL_MODES],
						default: "onRequest",
						description: "Muse permissions: allowAll runs without prompts, promptUnmatched asks for unmatched work, onRequest asks when the model requests approval, denyUnmatched blocks unmatched work.",
					},
					sandbox: {
						type: "string",
						title: "Sandbox",
						enum: [...MUSE_NATIVE_SANDBOX_MODES],
						default: "auto",
						description: "Muse shell sandbox: auto engages sandboxing when bubblewrap works and degrades with a warning otherwise, enabled forces sandboxing, disabled turns it off.",
					},
				},
			},
		},
		reasoning: {
			supported: true,
			values: [...MUSE_NATIVE_REASONING_VALUES],
		},
		approvals: {
			supported: true,
			structuredUserInput: false,
		},
		maintenance: {
			compaction: true,
			contextUsage: true,
			history: false,
			health: true,
		},
	};
}

// Shared by the static driver descriptor; immutable by convention (adapter instances build fresh copies).
export const MUSE_NATIVE_SESSION_CAPABILITIES = museNativeCapabilities();

function stripStaleBindingDiagnostics(metadata: PiboJsonObject | undefined): PiboJsonObject {
	if (!metadata) return {};
	const { diagnosticCode: _diagnosticCode, diagnosticMessage: _diagnosticMessage, ...rest } = metadata;
	return rest;
}

function bindingForSession(input: {
	piboSessionId: string;
	runtimeInstanceId: string;
	previous?: RuntimeSessionBinding;
	summary: MuseNativeSessionSummary;
	settings?: PiboJsonObject;
}): RuntimeSessionBinding {
	return {
		...(input.previous ? structuredClone(input.previous) : {}),
		piboSessionId: input.piboSessionId,
		runtimeInstanceId: input.runtimeInstanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		nativeSessionId: input.summary.sessionId,
		state: "bound",
		protocol: MUSE_PROTOCOL_NAME,
		protocolVersion: MUSE_PROTOCOL_VERSION,
		adapterVersion: MUSE_NATIVE_ADAPTER_VERSION,
		locator: { kind: "adapter-resolved" },
		metadata: {
			...stripStaleBindingDiagnostics(input.previous?.metadata),
			...(input.settings ?? {}),
			persistent: true,
			nativePresenceExpected: true,
			...(input.summary.modelId ? { museModelId: input.summary.modelId } : {}),
			...(input.summary.providerId ? { museProviderId: input.summary.providerId } : {}),
			...(input.summary.createdAt ? { museCreatedAt: input.summary.createdAt } : {}),
		},
	};
}

function validateOpenBinding(
	input: OpenAgentRuntimeSessionInput,
	runtimeInstanceId: string,
): RuntimeSessionBinding {
	const binding = input.binding
		? structuredClone(input.binding)
		: {
			piboSessionId: input.piboSession.id,
			runtimeInstanceId,
			adapterId: MUSE_NATIVE_ADAPTER_ID,
			state: "unbound" as const,
		};
	if (binding.piboSessionId !== input.piboSession.id) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Muse binding belongs to a different Pibo Session.");
	}
	if (binding.runtimeInstanceId !== runtimeInstanceId || binding.adapterId !== MUSE_NATIVE_ADAPTER_ID) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Muse binding does not match the configured runtime instance.");
	}
	if (binding.state === "missing") {
		throw new AgentRuntimeBindingMissingError(binding.piboSessionId, runtimeInstanceId, binding.nativeSessionId);
	}
	if (binding.state === "error") {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Muse binding is in an error state.");
	}
	if (binding.state === "bound" && !binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Muse binding has no native session id.");
	}
	if (binding.state === "unbound" && binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "An unbound Muse binding contains an unsupported pending native session identity.");
	}
	return binding;
}

export type MuseNativeSessionSandboxInput = {
	config: MuseNativeRuntimeConfig;
	override?: MuseNativeSandboxMode;
};

export class MuseNativeSession implements AgentRuntimeSession {
	readonly adapterId = MUSE_NATIVE_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeCapabilities;
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private turns: MuseNativeTurnController;
	private requests: MuseNativeRequestController;
	private controller: MuseNativeSessionController;
	private host: MuseNativeHostProcess;
	private pump: MuseNativeConnectionPump;
	private binding: RuntimeSessionBinding;
	private disposed = false;
	private operationInFlight = false;
	private selectedToolNames = new Set<string>();
	private readonly observedToolNames = new Set<string>();
	private toolInventoryWarning?: string;
	private lastResourceWarningKey: string | undefined;
	private sandboxOverride: MuseNativeSandboxMode | undefined;

	constructor(
		readonly runtimeInstanceId: string,
		host: MuseNativeHostProcess,
		pump: MuseNativeConnectionPump,
		controller: MuseNativeSessionController,
		private readonly settings: MuseSessionSettingsController,
		private readonly resourceDelivery: MuseNativeResourceDelivery,
		binding: RuntimeSessionBinding,
		private readonly requestTimeoutMs: number,
		private readonly sandboxInput: MuseNativeSessionSandboxInput,
		private readonly turnRecovery: { pollMs: number; maxPages: number; abortTimeoutMs: number },
	) {
		this.host = host;
		this.pump = pump;
		this.controller = controller;
		this.cwd = controller.cwd;
		this.binding = structuredClone(binding);
		this.sandboxOverride = sandboxInput.override;
		this.capabilities = museNativeCapabilities();
		this.updateSelectedToolNames(resourceDelivery);
		this.turns = new MuseNativeTurnController(
			host.spawned.connection,
			controller.session,
			controller.sessionId,
			requestTimeoutMs,
			(event) => this.emit(event),
			this.turnRecoveryOptions(pump, controller.sessionId),
		);
		this.requests = new MuseNativeRequestController(controller.session, runtimeInstanceId, (event) => this.emit(event));
		pump.setObserver((method, params) => this.observeNotification(method, params));
		this.controls = {
			getCurrentSession: () => this.controller.getSnapshot(this.runtimeInstanceId),
			listSessions: async () =>
				await withTimeout(
					this.controller.listSessions(this.runtimeInstanceId),
					this.requestTimeoutMs,
					`Muse session list timed out after ${this.requestTimeoutMs}ms.`,
				),
			getForkCandidates: () => this.controller.getForkCandidates(),
			forkSession: async (entryId) => await this.runIdleOperation(async () => await this.adoptFork(entryId)),
			cloneSession: async () => await this.runIdleOperation(async () => await this.adoptFork(undefined)),
			getReasoning: () => this.settings.getReasoning(),
			setReasoning: (value) => {
				this.assertIdle();
				return this.settings.setReasoning(value);
			},
			cycleReasoning: () => {
				this.assertIdle();
				return this.settings.cycleReasoning();
			},
			getFastMode: () => this.settings.fastMode,
			getSandbox: () => this.getSandbox(),
			setSandbox: async (enabled) => await this.setSandbox(enabled),
			setModel: async (model) => {
				this.assertIdle();
				const selected = await withTimeout(
					this.settings.setModel(model),
					this.requestTimeoutMs,
					`Muse model switch timed out after ${this.requestTimeoutMs}ms.`,
				);
				const selection = this.settings.sessionSelection;
				this.controller.summary = {
					...this.controller.summary,
					modelId: selected.id,
					providerId: selection.providerId,
				};
				this.promoteBindingFromCurrentSession();
				return selected;
			},
			compact: async (customInstructions) => await this.runIdleOperation(async () => {
				const customInstructionsRequested = Boolean(customInstructions?.trim());
				if (customInstructionsRequested) {
					this.emit({
						type: "warning",
						message: "Native Muse compaction owns its summary and cannot apply custom Pibo compaction instructions; the native compaction is continuing without them.",
					});
				}
				this.emit({ type: "compaction_start", reason: "manual" });
				let status = "accepted";
				let reason: string | undefined;
				try {
					const ack = await withTimeout(
						this.host.spawned.connection.command("session/compact", { sessionId: this.controller.sessionId }),
						this.requestTimeoutMs,
						`Muse compaction timed out after ${this.requestTimeoutMs}ms.`,
					);
					if (typeof ack.status === "string" && ack.status.trim()) status = ack.status;
					if (typeof ack.reason === "string" && ack.reason.trim()) reason = ack.reason;
				} catch (error) {
					this.emit({
						type: "compaction_end",
						reason: "manual",
						aborted: true,
						errorMessage: error instanceof Error ? error.message : "Native Muse compaction failed.",
					});
					throw error;
				}
				this.emit({ type: "compaction_end", reason: "manual", aborted: false });
				return {
					native: true,
					method: "session/compact",
					status,
					...(reason ? { reason } : {}),
					customInstructionsApplied: !customInstructionsRequested,
				};
			}),
			respondToApproval: (requestId, decision) => this.requests.respondToApproval(requestId, decision),
			respondToUserInput: () => this.requests.respondToUserInput(),
		};
	}

	get pendingApproval() {
		return this.requests.pendingApproval;
	}

	get pendingUserInput() {
		return this.requests.pendingUserInput;
	}

	get pendingApprovals() {
		return this.requests.pendingApprovals;
	}

	get pendingUserInputs() {
		return this.requests.pendingUserInputs;
	}

	getBinding(): RuntimeSessionBinding {
		if (this.binding.state === "bound") this.promoteBindingFromCurrentSession();
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.assertActive();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		try {
			this.resourceDelivery.renewCredential();
		} catch {
			this.emit({
				type: "warning",
				message: "Native Muse portable-tool access could not be renewed; Pibo-managed tools may be unavailable until the session is reopened.",
			});
		}
		this.emitPendingResourceWarnings();
		this.assertIdle();
		this.operationInFlight = true;
		try {
			await this.startTurnWithIntakeRecovery(input);
			this.promoteBindingFromCurrentSession();
		} finally {
			this.operationInFlight = false;
		}
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.turns.steer(input.text, { ...this.settings.turnOptions, displayText: input.text });
	}

	async abort(): Promise<void> {
		this.assertActive();
		await this.turns.interrupt();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.turns.interrupt().catch(() => {});
		this.pump.setObserver(undefined);
		this.requests.dispose();
		this.turns.dispose();
		this.settings.dispose();
		this.listeners.clear();
		this.controller.detach();
		try {
			await this.host.close();
		} finally {
			this.resourceDelivery.dispose();
		}
	}

	getStatus(): AgentRuntimeStatus {
		const diagnostics = this.host.getDiagnostics();
		return {
			streaming: this.turns.streaming,
			enabledTools: [...new Set([...this.selectedToolNames, ...this.observedToolNames])].sort(),
			cwd: this.cwd,
			...(this.settings.activeModel ? { activeModel: this.settings.activeModel } : {}),
			reasoning: {
				...(this.settings.reasoningState.value ? { value: this.settings.reasoningState.value } : {}),
				availableValues: this.settings.reasoningState.availableValues,
				supported: true,
			},
			fastMode: this.settings.fastMode,
			sandbox: {
				supported: true,
				enabled: this.host.sandbox.enabled,
				mode: this.host.sandbox.mode,
			},
			contextUsage: this.settings.currentContextUsage,
			warnings: [
				...diagnostics.filter((entry) => entry.level === "warning").map((entry) => entry.message),
				...this.resourceDelivery.warnings.map((entry) => entry.message),
				...(this.toolInventoryWarning ? [this.toolInventoryWarning] : []),
				...this.settings.pendingSyncWarnings,
			],
			errors: [
				...diagnostics.filter((entry) => entry.level === "error").map((entry) => entry.message),
			],
		};
	}

	async getStatusSnapshot(): Promise<AgentRuntimeStatus> {
		return this.getStatus();
	}

	getNativeCompatibilityHandle(): unknown {
		return this.controller.session;
	}

	private async adoptFork(entryId: string | undefined) {
		const durability = readMuseDurability(this.host.spawned);
		const result = await withTimeout(
			this.controller.fork(this.runtimeInstanceId, this.cwd, entryId, durability),
			this.requestTimeoutMs,
			`Muse fork timed out after ${this.requestTimeoutMs}ms.`,
		);
		this.controller.detach();
		this.turns.dispose();
		this.requests.dispose();
		this.controller = result.controller;
		this.settings.bind(this.host.spawned.connection, result.controller.sessionId);
		this.settings.adoptNativeModel(result.controller.summary);
		this.turns = new MuseNativeTurnController(
			this.host.spawned.connection,
			result.controller.session,
			result.controller.sessionId,
			this.requestTimeoutMs,
			(event) => this.emit(event),
			this.turnRecoveryOptions(this.pump, result.controller.sessionId),
		);
		this.requests = new MuseNativeRequestController(result.controller.session, this.runtimeInstanceId, (event) => this.emit(event));
		this.promoteBindingFromCurrentSession();
		return { previous: result.previous, current: result.current, cancelled: false };
	}

	private async startTurnWithIntakeRecovery(input: AgentRuntimePromptInput): Promise<void> {
		const options = { ...this.settings.turnOptions, displayText: input.text };
		try {
			await this.turns.start(input.text, options);
			return;
		} catch (error) {
			if (!isWedgedTurnIntakeError(error)) throw error;
			this.emit({
				type: "warning",
				message: "Muse turn intake rejected the prompt as conflicting with an existing event; re-synced the native session and retrying once.",
			});
			try {
				await this.resyncNativeSession();
			} catch (resyncError) {
				const resyncMessage = resyncError instanceof Error ? resyncError.message : "unknown error";
				const originalMessage = error instanceof Error ? error.message : "unknown error";
				throw new Error(`${originalMessage} (automatic native session re-sync also failed: ${resyncMessage})`, { cause: error });
			}
			await this.turns.start(input.text, options);
		}
	}

	private async resyncNativeSession(): Promise<void> {
		const previous = this.controller;
		// No detach: resume() overwrites the pump registration under the same
		// native id, which preserves the per-session completed-turn ledgers
		// (fork candidates). Until resume succeeds, the previous fold keeps
		// routing, so a failed re-sync needs no rollback.
		const next = await withTimeout(
			MuseNativeSessionController.resume(
				this.host.spawned.connection,
				this.pump,
				readMuseDurability(this.host.spawned),
				previous.sessionId,
				this.cwd,
				this.resourceDelivery.sessionMcpConfig,
			),
			this.requestTimeoutMs,
			`Muse session re-sync timed out after ${this.requestTimeoutMs}ms.`,
		);
		this.turns.dispose();
		this.requests.dispose();
		this.controller = next;
		this.settings.bind(this.host.spawned.connection, next.sessionId);
		this.settings.adoptNativeModel(next.summary);
		this.turns = new MuseNativeTurnController(
			this.host.spawned.connection,
			next.session,
			next.sessionId,
			this.requestTimeoutMs,
			(event) => this.emit(event),
			this.turnRecoveryOptions(this.pump, next.sessionId),
		);
		this.requests = new MuseNativeRequestController(next.session, this.runtimeInstanceId, (event) => this.emit(event));
		this.promoteBindingFromCurrentSession();
	}

	private async runIdleOperation<T>(operation: () => Promise<T>): Promise<T> {
		this.assertIdle();
		this.operationInFlight = true;
		try {
			return await operation();
		} finally {
			this.operationInFlight = false;
		}
	}

	getSandbox(): AgentRuntimeSandboxResult {
		this.assertActive();
		return {
			supported: true,
			enabled: this.host.sandbox.enabled,
			mode: this.host.sandbox.mode,
		};
	}

	async setSandbox(enabled: boolean): Promise<AgentRuntimeSandboxResult> {
		this.assertActive();
		if (typeof enabled !== "boolean") throw new Error("Muse sandbox can only be switched on or off.");
		return await this.runIdleOperation(async () => await this.restartSandboxHost(enabled));
	}

	private async restartSandboxHost(enabled: boolean): Promise<AgentRuntimeSandboxResult> {
		const target: MuseNativeSandboxMode = enabled ? "enabled" : "disabled";
		const current = this.getSandbox();
		if (current.enabled === enabled) {
			return { supported: true, enabled: current.enabled, mode: current.mode, changed: false, restarted: false };
		}
		// Sandbox posture is fixed for the host's lifetime and is not negotiable over the
		// wire, so a toggle restarts the host and resumes the same native session. The new
		// host starts first: when it (or the resume) fails, the live session is untouched.
		// Portable-tool credentials stay valid because resource delivery outlives the restart.
		const nextHost = await startMuseNativeHost({
			config: { ...this.sandboxInput.config, sandbox: target },
			runtimeInstanceId: this.runtimeInstanceId,
			piboSessionId: this.binding.piboSessionId,
			sessionGeneration: `sandbox-toggle-${randomUUID()}`,
			workspace: this.cwd,
			resourceEnvironment: this.resourceDelivery.environment,
		});
		try {
			if (
				this.resourceDelivery.sessionMcpConfig
				&& !nextHost.spawned.initializeResult.grantedCapabilities.includes("sessionMcp")
			) {
				throw new Error(
					`Native Muse session MCP configuration requires the sessionMcp capability, which the restarted host for runtime instance "${this.runtimeInstanceId}" did not grant.`,
				);
			}
			const durability = readMuseDurability(nextHost.spawned);
			const nextPump = new MuseNativeConnectionPump(nextHost.spawned.connection);
			const nextController = await withTimeout(
				MuseNativeSessionController.resume(
					nextHost.spawned.connection,
					nextPump,
					durability,
					this.controller.sessionId,
					this.cwd,
					this.resourceDelivery.sessionMcpConfig,
				),
				this.requestTimeoutMs,
				`Muse sandbox toggle timed out after ${this.requestTimeoutMs}ms.`,
			);
			const previousHost = this.host;
			this.pump.setObserver(undefined);
			this.turns.dispose();
			this.requests.dispose();
			this.controller.detach();
			this.host = nextHost;
			this.pump = nextPump;
			this.controller = nextController;
			this.settings.bind(nextHost.spawned.connection, nextController.summary.sessionId);
			this.settings.adoptNativeModel(nextController.summary);
			this.turns = new MuseNativeTurnController(
				nextHost.spawned.connection,
				nextController.session,
				nextController.sessionId,
				this.requestTimeoutMs,
				(event) => this.emit(event),
				this.turnRecoveryOptions(nextPump, nextController.sessionId),
			);
			this.requests = new MuseNativeRequestController(nextController.session, this.runtimeInstanceId, (event) => this.emit(event));
			nextPump.setObserver((method, params) => this.observeNotification(method, params));
			this.sandboxOverride = target;
			this.promoteBindingFromCurrentSession();
			await previousHost.close().catch(() => {});
			const warning = nextHost.getDiagnostics().find((entry) => entry.level === "warning" || entry.level === "error");
			return {
				supported: true,
				enabled: nextHost.sandbox.enabled,
				mode: nextHost.sandbox.mode,
				changed: true,
				restarted: true,
				...(warning ? { warning: warning.message } : {}),
			};
		} catch (error) {
			await nextHost.close().catch(() => {});
			throw error;
		}
	}

	private turnRecoveryOptions(pump: MuseNativeConnectionPump, sessionId: string): MuseTurnRecoveryOptions {
		return {
			pollMs: this.turnRecovery.pollMs,
			maxPages: this.turnRecovery.maxPages,
			abortTimeoutMs: this.turnRecovery.abortTimeoutMs,
			lastViewCursor: () => pump.lastViewCursor(sessionId),
		};
	}

	private observeNotification(method: string, params: unknown): void {
		if (method !== "session/contextUsage" || !params || typeof params !== "object") return;
		const record = params as Record<string, unknown>;
		if (record.sessionId !== this.controller.sessionId) return;
		const usedTokens = record.usedTokens;
		const windowTokens = record.windowTokens;
		if (!Number.isSafeInteger(usedTokens)) return;
		this.settings.noteContextUsage({
			tokens: Number(usedTokens),
			...(Number.isSafeInteger(windowTokens) ? { contextWindow: Number(windowTokens) } : {}),
			...(Number.isSafeInteger(windowTokens) && Number(windowTokens) > 0
				? { percent: Math.min(100, Math.max(0, (Number(usedTokens) / Number(windowTokens)) * 100)) }
				: {}),
		});
	}

	private emitPendingResourceWarnings(): void {
		const warnings = this.resourceDelivery.warnings;
		const key = warnings.map((warning) => warning.code).join(",");
		if (key === this.lastResourceWarningKey) return;
		this.lastResourceWarningKey = key;
		for (const warning of warnings) {
			this.emit({ type: "warning", message: warning.message, details: { code: warning.code } });
		}
	}

	private updateSelectedToolNames(resourceDelivery: MuseNativeResourceDelivery): void {
		const names = [...new Set(resourceDelivery.enabledToolNames)].sort();
		this.selectedToolNames = new Set(names.slice(0, MAX_INSPECTED_SELECTED_TOOL_NAMES));
		this.toolInventoryWarning = names.length > MAX_INSPECTED_SELECTED_TOOL_NAMES
			? `Native Muse selected-tool status is limited to ${MAX_INSPECTED_SELECTED_TOOL_NAMES} names.`
			: undefined;
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		if (this.disposed) return;
		if (
			event.type === "tool_call"
			&& event.toolName.trim()
			&& event.toolName !== MUSE_FALLBACK_TOOL_NAME
			&& event.toolName.length <= 512
			&& (this.observedToolNames.has(event.toolName) || this.observedToolNames.size < MAX_INSPECTED_TOOL_NAMES)
		) {
			this.observedToolNames.add(event.toolName);
		}
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// Runtime listeners are isolated from the owned Muse process lifecycle.
			}
		}
	}

	private promoteBindingFromCurrentSession(): void {
		this.binding = bindingForSession({
			piboSessionId: this.binding.piboSessionId,
			runtimeInstanceId: this.runtimeInstanceId,
			previous: this.binding,
			summary: this.controller.summary,
			settings: {
				...this.settings.bindingMetadata,
				...(this.sandboxOverride ? { [BINDING_SANDBOX_KEY]: this.sandboxOverride } : {}),
			},
		});
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Muse runtime session is disposed.");
	}

	private assertIdle(): void {
		this.assertActive();
		if (this.operationInFlight || this.turns.streaming) {
			throw new Error("Muse runtime controls can only change while the session is idle.");
		}
	}
}

type MuseNativeCompatibilityServices = {
	thinkingLevel?: string;
	modelDefaults?: PiboModelDefaults;
};

class MuseNativeAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly descriptor: AgentRuntimeDriver<MuseNativeRuntimeConfig>["descriptor"];
	readonly config: MuseNativeRuntimeConfig;
	readonly displayName: string;
	readonly enabled: boolean;
	private modelCatalogCache?: { expiresAt: number; value: Promise<MuseNativeModelCatalog> };
	private probeSessionId: string | undefined;
	private readonly authController: MuseNativeAuthController;

	constructor(
		readonly instanceId: string,
		config: MuseNativeRuntimeConfig,
		displayName: string | undefined,
		enabled: boolean,
	) {
		this.config = structuredClone(config);
		this.descriptor = {
			...MUSE_NATIVE_AGENT_RUNTIME_DRIVER.descriptor,
			capabilities: museNativeCapabilities(),
		};
		this.displayName = displayName ?? this.descriptor.displayName;
		this.enabled = enabled;
		this.authController = new MuseNativeAuthController(this.config, this.instanceId);
	}

	diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return diagnoseMuseNativeRuntime(this.config, this.instanceId);
	}

	async listModels(): Promise<AgentRuntimeModelCatalog> {
		return toAgentRuntimeModelCatalog(this.instanceId, await this.loadModelCatalog());
	}

	async getAuthStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		return await this.authController.getStatus();
	}

	async startAuth(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return await this.authController.start(input);
	}

	async logoutAuth(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return await this.authController.logout(input);
	}

	async disposeAuth(): Promise<void> {
		await this.authController.dispose();
	}

	async validateProfile(input: ValidateAgentRuntimeProfileInput): Promise<readonly AgentRuntimeDiagnostic[]> {
		const diagnostics: AgentRuntimeDiagnostic[] = [];
		if (input.profile.runtimeInstanceId !== this.instanceId) {
			diagnostics.push({
				severity: "error",
				code: "runtime_instance_mismatch",
				message: `Profile "${input.profile.profileName}" selects runtime instance "${input.profile.runtimeInstanceId}", not "${this.instanceId}".`,
			});
		}
		try {
			parseMuseProfileOptions(input.profile.runtimeOptions);
		} catch (error) {
			diagnostics.push({
				severity: "error",
				code: "muse_native_runtime_options_invalid",
				message: error instanceof Error ? error.message : "Native Muse runtime options are invalid.",
				path: "runtimeOptions",
			});
		}
		const model = input.activeModel ?? selectRequestedModelProfile(input.profile);
		if (!model) return diagnostics;
		if (model.provider !== MUSE_NATIVE_MODEL_PROVIDER_ID) {
			diagnostics.push({
				severity: "error",
				code: "muse_native_model_provider_invalid",
				message: `Native Muse models use provider "${MUSE_NATIVE_MODEL_PROVIDER_ID}", not "${model.provider}".`,
				path: input.activeModel ? "activeModel" : input.profile.model ? "model" : input.profile.parentSessionId ? "subagentModel" : "mainModel",
			});
			return diagnostics;
		}
		try {
			const catalog = await this.loadModelCatalog();
			if (!catalog.models.some((entry) => entry.id === model.id)) {
				diagnostics.push({
					severity: "error",
					code: "muse_native_model_unavailable",
					message: `Native Muse model "${model.id}" is not available in runtime instance "${this.instanceId}".`,
					path: input.activeModel ? "activeModel" : input.profile.model ? "model" : input.profile.parentSessionId ? "subagentModel" : "mainModel",
				});
			}
		} catch {
			diagnostics.push({
				severity: "error",
				code: "muse_native_model_catalog_unavailable",
				message: `Native Muse model catalog is unavailable for runtime instance "${this.instanceId}"; refusing to bind an unverified model.`,
				path: input.activeModel ? "activeModel" : "model",
			});
		}
		return diagnostics;
	}

	async resolveBinding(input: { binding: RuntimeSessionBinding; workspace: string }): Promise<RuntimeSessionBinding> {
		const binding = structuredClone(input.binding);
		if (binding.state !== "bound" && binding.state !== "missing") return binding;
		if (!binding.nativeSessionId) {
			return {
				...binding,
				state: "error",
				metadata: {
					...(binding.metadata ?? {}),
					diagnosticCode: "muse_native_session_id_missing",
					diagnosticMessage: "The persisted Muse binding has no native session id.",
				},
			};
		}
		try {
			const summary = await this.withHost(
				binding.piboSessionId,
				input.workspace,
				async (host) => await MuseNativeSessionController.read(host.spawned.connection, binding.nativeSessionId!),
				`Muse binding inspection timed out after ${this.config.requestTimeoutMs}ms.`,
			);
			return bindingForSession({
				piboSessionId: binding.piboSessionId,
				runtimeInstanceId: this.instanceId,
				previous: binding,
				summary,
			});
		} catch (error) {
			if (error instanceof MuseNativeSessionMissingError) {
				return {
					...binding,
					state: "missing",
					metadata: {
						...(binding.metadata ?? {}),
						diagnosticCode: "muse_native_session_missing",
						diagnosticMessage: "The bound Muse session is no longer available in this configured runtime instance.",
					},
				};
			}
			if (error instanceof AgentRuntimeAuthError || error instanceof AgentRuntimeUnavailableError) throw error;
			throw new AgentRuntimeUnavailableError(
				this.instanceId,
				`Muse binding inspection failed for runtime instance "${this.instanceId}"; this is not authoritative evidence that the native session is absent.`,
				{ cause: error },
			);
		}
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const binding = validateOpenBinding(input, this.instanceId);
		if (input.historyHandoff?.mode === "import") {
			throw new Error("Native Muse portable history import is not supported.");
		}
		const sessionGeneration = input.services?.resources?.sessionGeneration
			?? input.services?.portableTools?.sessionGeneration
			?? randomUUID();
		const profileOptions: MuseNativeProfileOptions = parseMuseProfileOptions(input.profile.runtimeOptions);
		const compatibility = input.services?.compatibility as MuseNativeCompatibilityServices | undefined;
		const persisted: {
			activeModel?: ModelProfile;
			reasoningLevel?: string;
			profileOptions: MuseNativeProfileOptions;
			sandboxOverride?: MuseNativeSandboxMode;
		} = binding.state === "bound" ? readMusePersistedSettings(binding.metadata) : { profileOptions: {} };
		const effectiveSandbox = persisted.sandboxOverride ?? profileOptions.sandbox ?? this.config.sandbox;
		let resourceDelivery: MuseNativeResourceDelivery | undefined;
		let host: MuseNativeHostProcess | undefined;
		let settings: MuseSessionSettingsController | undefined;
		try {
			resourceDelivery = await MuseNativeResourceDelivery.prepare({
				workspace: input.workspace,
				portableTools: input.services?.portableTools,
				resources: input.services?.resources,
			});
			host = await startMuseNativeHost({
				config: { ...this.config, sandbox: effectiveSandbox },
				runtimeInstanceId: this.instanceId,
				piboSessionId: input.piboSession.id,
				sessionGeneration,
				workspace: input.workspace,
				resourceEnvironment: resourceDelivery.environment,
			});
			const durability = readMuseDurability(host.spawned);
			const pump = new MuseNativeConnectionPump(host.spawned.connection);
			const requestedModel: ModelProfile | undefined = input.activeModel
				?? persisted.activeModel
				?? selectRequestedModelProfile(input.profile, compatibility?.modelDefaults)
				?? undefined;
			if (requestedModel && requestedModel.provider !== MUSE_NATIVE_MODEL_PROVIDER_ID) {
				throw new Error(`Native Muse models use provider "${MUSE_NATIVE_MODEL_PROVIDER_ID}", not "${requestedModel.provider}".`);
			}
			if (resourceDelivery.sessionMcpConfig && !host.spawned.initializeResult.grantedCapabilities.includes("sessionMcp")) {
				throw new Error(
					`Native Muse session MCP configuration requires the sessionMcp capability, which the host for runtime instance "${this.instanceId}" did not grant.`,
				);
			}
			const controller = await withTimeout(
				binding.state === "bound" && binding.nativeSessionId
					? MuseNativeSessionController.resume(
						host.spawned.connection,
						pump,
						durability,
						binding.nativeSessionId,
						input.workspace,
						resourceDelivery.sessionMcpConfig,
					)
					: MuseNativeSessionController.start(
						host.spawned.connection,
						pump,
						durability,
						{
							workspaceRoot: input.workspace,
							...(requestedModel ? { modelId: requestedModel.id } : {}),
							...(profileOptions.providerId ? { providerId: profileOptions.providerId } : {}),
							approvalMode: profileOptions.approvalMode ?? this.config.approvalMode,
							...(resourceDelivery.sessionMcpConfig ? { mcpConfig: resourceDelivery.sessionMcpConfig } : {}),
						},
					),
				this.config.requestTimeoutMs,
				`Muse session open timed out after ${this.config.requestTimeoutMs}ms.`,
			);
			const catalog = await this.loadModelCatalogForSession(host, controller.summary.sessionId);
			if (requestedModel && !catalog.models.some((entry) => entry.id === requestedModel.id)) {
				throw new Error(`Native Muse model "${requestedModel.id}" is not available in runtime instance "${this.instanceId}".`);
			}
			settings = new MuseSessionSettingsController({
				activeModel: requestedModel ?? selectDefaultCatalogModel(catalog),
				reasoningLevel: persisted.reasoningLevel
					?? mapThinkingLevelToReasoning(compatibility?.thinkingLevel)
					?? mapThinkingLevelToReasoning(selectRequestedThinkingLevel(input.profile, compatibility?.modelDefaults)),
				profileOptions,
				catalog,
			});
			settings.bind(host.spawned.connection, controller.summary.sessionId);
			settings.adoptNativeModel(controller.summary);
			const openedBinding = bindingForSession({
				piboSessionId: input.piboSession.id,
				runtimeInstanceId: this.instanceId,
				previous: binding,
				summary: controller.summary,
				settings: settings.bindingMetadata,
			});
			return new MuseNativeSession(
				this.instanceId,
				host,
				pump,
				controller,
				settings,
				resourceDelivery,
				openedBinding,
				this.config.requestTimeoutMs,
				{
					config: this.config,
					...(persisted.sandboxOverride ? { override: persisted.sandboxOverride } : {}),
				},
				{
					pollMs: this.config.viewRecoveryPollMs,
					maxPages: this.config.viewRecoveryMaxPages,
					abortTimeoutMs: this.config.abortTimeoutMs,
				},
			);
		} catch (error) {
			settings?.dispose();
			await host?.close().catch(() => {});
			resourceDelivery?.dispose();
			if (error instanceof MuseNativeSessionMissingError) {
				throw new AgentRuntimeBindingMissingError(input.piboSession.id, this.instanceId, binding.nativeSessionId);
			}
			throw error;
		}
	}

	private loadModelCatalogForSession(host: MuseNativeHostProcess, sessionId: string): Promise<MuseNativeModelCatalog> {
		const now = Date.now();
		if (this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) return this.modelCatalogCache.value;
		const value = withTimeout(
			readMuseModelCatalog(host.spawned.connection, sessionId),
			this.config.requestTimeoutMs,
			`Muse model catalog timed out after ${this.config.requestTimeoutMs}ms.`,
		);
		this.modelCatalogCache = { expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS, value };
		value.catch(() => {
			if (this.modelCatalogCache?.value === value) this.modelCatalogCache = undefined;
		});
		return value;
	}

	private loadModelCatalog(): Promise<MuseNativeModelCatalog> {
		const now = Date.now();
		if (this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) return this.modelCatalogCache.value;
		const value = this.withHost("model-catalog", process.cwd(), async (host) => {
			// MSP offers no session delete, so catalog probes share one sticky
			// session per adapter instance instead of leaking one per cache miss.
			if (this.probeSessionId) {
				try {
					return await readMuseModelCatalog(host.spawned.connection, this.probeSessionId);
				} catch (error) {
					// A host-authored rejection retires the probe; anything else propagates.
					if (!(error instanceof MspError)) throw error;
					this.probeSessionId = undefined;
				}
			}
			const started = await host.spawned.connection.command("session/start", { workspaceRoot: process.cwd() });
			const session = (started as Record<string, unknown>).session as Record<string, unknown> | undefined;
			const sessionId = typeof session?.sessionId === "string" ? session.sessionId : undefined;
			if (!sessionId) throw new Error("Muse model catalog inspection could not open a session.");
			this.probeSessionId = sessionId;
			return await readMuseModelCatalog(host.spawned.connection, sessionId);
		}, `Muse model catalog timed out after ${this.config.requestTimeoutMs}ms.`);
		this.modelCatalogCache = { expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS, value };
		value.catch(() => {
			if (this.modelCatalogCache?.value === value) this.modelCatalogCache = undefined;
		});
		return value;
	}

	private async withHost<T>(
		piboSessionId: string,
		workspace: string,
		operation: (host: MuseNativeHostProcess) => Promise<T>,
		timeoutLabel: string,
	): Promise<T> {
		const host = await startMuseNativeHost({
			config: this.config,
			runtimeInstanceId: this.instanceId,
			piboSessionId,
			sessionGeneration: `inspection-${randomUUID()}`,
			workspace,
		});
		try {
			return await withTimeout(operation(host), this.config.requestTimeoutMs, timeoutLabel);
		} finally {
			await host.close();
		}
	}
}

export const MUSE_NATIVE_AGENT_RUNTIME_DRIVER: AgentRuntimeDriver<MuseNativeRuntimeConfig> = {
	descriptor: {
		id: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse",
		transport: "stdio-rpc",
		configSchema: MUSE_NATIVE_RUNTIME_CONFIG_SCHEMA,
		capabilities: MUSE_NATIVE_SESSION_CAPABILITIES,
		protocol: {
			name: MUSE_PROTOCOL_NAME,
			supportedRange: MUSE_PROTOCOL_SUPPORTED_RANGE,
		},
		supportsMultipleInstances: true,
	},
	defaultConfig: defaultMuseNativeRuntimeConfig,
	parseConfig: parseMuseNativeRuntimeConfig,
	create(input) {
		return new MuseNativeAgentRuntimeAdapter(
			input.instanceId,
			input.config,
			input.displayName,
			input.enabled,
		);
	},
};

export function getMuseNativeSession(session: AgentRuntimeSession): unknown {
	if (session.adapterId !== MUSE_NATIVE_ADAPTER_ID) return undefined;
	return session.getNativeCompatibilityHandle?.();
}
