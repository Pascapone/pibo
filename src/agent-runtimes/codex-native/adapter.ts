import { randomUUID } from "node:crypto";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
import {
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../../agent-runtime/errors.js";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	AgentRuntimeModelCatalog,
	AgentRuntimeProductContext,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeStatus,
	InspectAgentRuntimeHistoryInput,
	LogoutAgentRuntimeAuthInput,
	OpenAgentRuntimeSessionInput,
	ReadAgentRuntimeHistoryInput,
	RuntimeSessionBinding,
	StartAgentRuntimeAuthInput,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import {
	selectRequestedFastMode,
	selectRequestedModelProfile,
	selectRequestedThinkingLevel,
	type PiboModelDefaults,
} from "../../core/model-defaults.js";
import {
	CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA,
	defaultCodexNativeRuntimeConfig,
	parseCodexNativeRuntimeConfig,
	type CodexNativeRuntimeConfig,
} from "./config.js";
import {
	diagnoseCodexNativeRuntime,
	startCodexNativeAppServer,
	type CodexNativeAppServerProcess,
} from "./process.js";
import {
	inspectCodexThreadHistory,
	pageCodexThreadHistory,
	unavailableCodexThreadHistoryInspection,
} from "./history.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CodexNativeThreadController,
	CodexNativeThreadMissingError,
} from "./thread.js";
import type { CodexAppServerThread } from "./protocol-types.js";
import {
	CODEX_APP_SERVER_PROTOCOL_NAME,
	CODEX_APP_SERVER_SUPPORTED_RANGE,
	CODEX_APP_SERVER_VERSION,
} from "./protocol-version.js";
import { CodexNativeTurnController } from "./turn.js";
import { CodexNativeRequestController } from "./requests.js";
import { CodexNativeResourceDelivery } from "./resource-delivery.js";
import {
	CODEX_NATIVE_MODEL_OPTIONS_SCHEMA,
	CODEX_NATIVE_MODEL_PROVIDER_ID,
	CODEX_NATIVE_REASONING_VALUES,
	CodexNativeSessionSettingsController,
	parseCodexNativeProfileOptions,
	readCodexNativeModelCatalog,
	readCodexNativePersistedSettings,
	toAgentRuntimeModelCatalog,
	type CodexNativeModelCatalog,
} from "./models.js";
import { CodexNativeAuthController } from "./auth.js";
import { injectPortableHistoryIntoCodex } from "./portable-history.js";

export { CODEX_NATIVE_ADAPTER_ID } from "./thread.js";

export const CODEX_NATIVE_ADAPTER_VERSION = "1.0.0";

function codexNativeCapabilities(structuredUserInput: boolean): AgentRuntimeCapabilities {
	return {
		lifecycle: {
			persistent: true,
			lazyBinding: false,
			resume: true,
			attach: true,
			listNativeSessions: true,
			fork: true,
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
			diffs: false,
			rawNativeEvents: false,
		},
		tools: {
			piboManaged: { support: "mcp", transports: ["streamable-http"] },
			nativeToolInspection: {
				support: "degraded",
				mode: "observed-runtime-items",
				reason: "Stable Codex App Server 0.147.0 does not expose a complete pre-turn native-tool inventory; Pibo reports selected MCP tools immediately and harness-native tools after stable item notifications prove they are active.",
			},
			nativeToolYielding: unsupportedAgentRuntimeCapability(
				"Codex native tools remain harness-owned and are not wrapped as Pibo yielded tools.",
			),
			intentTracing: {
				supported: false,
				configurable: false,
				enabledByDefault: false,
			},
		},
		mcp: {
			externalServers: { support: "mcp", transports: ["streamable-http", "stdio"] },
			statusInspection: true,
		},
		skills: { support: "materialized", modes: ["codex-extra-roots"] },
		context: { support: "materialized", modes: ["native-project-discovery", "codex-developer-instructions"] },
		contextDiscovery: {
			supported: true,
			configurable: false,
			enabledByDefault: true,
			strategy: "codex-project",
			knownFileNames: ["AGENTS.override.md", "AGENTS.md"],
		},
		nativeSubagents: {
			supported: true,
			configurable: true,
			enabledByDefault: true,
		},
		historyImport: true,
		auth: {
			status: true,
			methods: [
				{ id: "device_code", completion: "notification" },
				{ id: "api_key", completion: "immediate" },
			],
			cancel: true,
			logout: true,
			credentialScope: "runtime-instance",
		},
		models: {
			catalog: true,
			switchInSession: true,
			optionsSchema: CODEX_NATIVE_MODEL_OPTIONS_SCHEMA,
		},
		reasoning: {
			supported: true,
			values: CODEX_NATIVE_REASONING_VALUES,
		},
		approvals: {
			supported: true,
			structuredUserInput,
		},
		maintenance: {
			compaction: true,
			contextUsage: true,
			history: true,
			health: true,
		},
	};
}

export const CODEX_NATIVE_THREAD_CAPABILITIES = codexNativeCapabilities(false);

function timestamp(seconds: number): string {
	return new Date(seconds * 1_000).toISOString();
}

function safeThreadMetadata(
	thread: CodexAppServerThread,
	previous: PiboJsonObject = {},
	settings: PiboJsonObject = {},
): PiboJsonObject {
	const {
		diagnosticCode: _diagnosticCode,
		diagnosticMessage: _diagnosticMessage,
		...metadata
	} = previous;
	return {
		...metadata,
		...settings,
		persistent: true,
		nativePresenceExpected: true,
		threadCreatedAt: timestamp(thread.createdAt),
		threadUpdatedAt: timestamp(thread.updatedAt),
		threadStatus: thread.status.type,
		modelProvider: thread.modelProvider,
	};
}

function bindingForThread(input: {
	piboSessionId: string;
	runtimeInstanceId: string;
	previous?: RuntimeSessionBinding;
	thread: CodexAppServerThread;
	settings?: PiboJsonObject;
}): RuntimeSessionBinding {
	return {
		...(input.previous ? structuredClone(input.previous) : {}),
		piboSessionId: input.piboSessionId,
		runtimeInstanceId: input.runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId: input.thread.id,
		state: "bound",
		protocol: CODEX_APP_SERVER_PROTOCOL_NAME,
		protocolVersion: CODEX_APP_SERVER_VERSION,
		adapterVersion: CODEX_NATIVE_ADAPTER_VERSION,
		locator: { kind: "adapter-resolved" },
		metadata: safeThreadMetadata(input.thread, input.previous?.metadata, input.settings),
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
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound" as const,
		};
	if (binding.piboSessionId !== input.piboSession.id) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Codex binding belongs to a different Pibo Session.");
	}
	if (binding.runtimeInstanceId !== runtimeInstanceId || binding.adapterId !== CODEX_NATIVE_ADAPTER_ID) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Codex binding does not match the configured runtime instance.");
	}
	if (binding.state === "missing") {
		throw new AgentRuntimeBindingMissingError(binding.piboSessionId, runtimeInstanceId, binding.nativeSessionId);
	}
	if (binding.state === "error") {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Codex binding is in an error state.");
	}
	if (binding.state === "bound" && !binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Codex binding has no native thread id.");
	}
	if (binding.state === "unbound" && binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "An unbound Codex binding cannot contain a native thread id.");
	}
	return binding;
}

type CodexNativeProcessBundle = {
	process: CodexNativeAppServerProcess;
	resourceDelivery: CodexNativeResourceDelivery;
};

type CodexNativeProcessReloader = () => Promise<CodexNativeProcessBundle>;

const RESOURCE_MAINTENANCE_RETRY_MS = 5_000;
const MAX_INSPECTED_SELECTED_TOOL_NAMES = 512;
const MAX_INSPECTED_TOOL_NAMES = 256;

export class CodexNativeThreadSession implements AgentRuntimeSession {
	readonly adapterId = CODEX_NATIVE_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeCapabilities;
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private turns: CodexNativeTurnController;
	private requests: CodexNativeRequestController;
	private process: CodexNativeAppServerProcess;
	private threads: CodexNativeThreadController;
	private resourceDelivery: CodexNativeResourceDelivery;
	private binding: RuntimeSessionBinding;
	private disposed = false;
	private operationInFlight = false;
	private resourceMaintenanceTimer?: ReturnType<typeof setTimeout>;
	private resourceRefresh?: Promise<void>;
	private resourceWarning?: string;
	private resourceProcessUnavailable = false;
	private recycleProcessAfterInterruptedTurn = false;
	private selectedToolNames = new Set<string>();
	private readonly observedToolNames = new Set<string>();
	private toolInventoryWarning?: string;

	constructor(
		readonly runtimeInstanceId: string,
		process: CodexNativeAppServerProcess,
		threads: CodexNativeThreadController,
		private readonly settings: CodexNativeSessionSettingsController,
		resourceDelivery: CodexNativeResourceDelivery,
		binding: RuntimeSessionBinding,
		private readonly structuredUserInput: boolean,
		private readonly reloadProcess: CodexNativeProcessReloader,
		private readonly productContext?: AgentRuntimeProductContext,
	) {
		this.process = process;
		this.threads = threads;
		this.resourceDelivery = resourceDelivery;
		this.updateSelectedToolNames(resourceDelivery);
		this.cwd = threads.thread.cwd;
		this.binding = structuredClone(binding);
		this.capabilities = codexNativeCapabilities(structuredUserInput);
		this.turns = new CodexNativeTurnController(process.client, threads, (event) => this.emit(event));
		this.requests = this.createRequestController(process);
		this.controls = {
			getCurrentSession: () => this.threads.getSnapshot(this.runtimeInstanceId),
			listSessions: () => this.threads.list(this.runtimeInstanceId, this.cwd),
			getForkCandidates: () => this.threads.getForkCandidates(),
			forkSession: async (entryId) => await this.runIdleOperation(async () => {
				const result = await this.threads.fork(
					this.runtimeInstanceId,
					this.cwd,
					entryId,
					async (threadId) => await this.resourceDelivery.verifyThread(this.process.client, threadId),
				);
				this.settings.attachThread(this.threads.thread.id, this.threads.configuration);
				this.updateBindingFromCurrentThread();
				return result;
			}),
			cloneSession: async () => await this.runIdleOperation(async () => {
				const result = await this.threads.clone(
					this.runtimeInstanceId,
					this.cwd,
					async (threadId) => await this.resourceDelivery.verifyThread(this.process.client, threadId),
				);
				this.settings.attachThread(this.threads.thread.id, this.threads.configuration);
				this.updateBindingFromCurrentThread();
				return result;
			}),
			getReasoning: () => this.settings.reasoning,
			setReasoning: (value) => {
				this.assertIdle();
				return this.settings.setReasoning(value);
			},
			cycleReasoning: () => {
				this.assertIdle();
				return this.settings.cycleReasoning();
			},
			getFastMode: () => this.settings.fastMode,
			setFastMode: (enabled) => {
				this.assertIdle();
				return this.settings.setFastMode(enabled);
			},
			setModel: async (model) => {
				this.assertIdle();
				return this.settings.setModel(model);
			},
			compact: async (customInstructions) => await this.runIdleOperation(async () => {
				const customInstructionsRequested = Boolean(customInstructions?.trim());
				if (customInstructionsRequested) {
					this.emit({
						type: "warning",
						message: "Native Codex compaction owns its summary and cannot apply custom Pibo compaction instructions; the native compaction is continuing without them.",
					});
				}
				await this.turns.compact();
				this.updateBindingFromCurrentThread();
				return {
					native: true,
					method: "thread/compact/start",
					customInstructionsApplied: !customInstructionsRequested,
				};
			}),
			respondToApproval: (requestId, decision) => this.requests.respondToApproval(requestId, decision),
			respondToUserInput: (requestId, answers) => this.requests.respondToUserInput(requestId, answers),
		};
		this.scheduleResourceMaintenance();
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
		this.updateBindingFromCurrentThread();
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.assertActive();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.ensureFreshResourcesForTurn();
		this.operationInFlight = true;
		try {
			await this.turns.start(
				input.text,
				this.productContext?.getActiveMessage?.()?.id ?? randomUUID(),
				this.settings.turnOptions,
			);
			this.updateBindingFromCurrentThread();
		} finally {
			this.operationInFlight = false;
			if (this.recycleProcessAfterInterruptedTurn && !this.disposed) {
				this.recycleProcessAfterInterruptedTurn = false;
				try {
					await this.rolloverResourceProcess();
				} catch (error) {
					this.resourceWarning = error instanceof Error
						? error.message
						: "Native Codex process recycling failed after turn interruption; Pibo will retry while the session remains idle.";
				}
			}
			this.scheduleResourceMaintenance();
		}
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.turns.steer(input.text, randomUUID());
	}

	async abort(): Promise<void> {
		this.assertActive();
		if (!this.turns.streaming) {
			await this.turns.interrupt();
			return;
		}
		this.recycleProcessAfterInterruptedTurn = true;
		try {
			await this.turns.interrupt();
		} catch (error) {
			this.recycleProcessAfterInterruptedTurn = false;
			throw error;
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.resourceMaintenanceTimer) clearTimeout(this.resourceMaintenanceTimer);
		this.resourceMaintenanceTimer = undefined;
		await this.resourceRefresh?.catch(() => {});
		this.requests.dispose();
		this.turns.dispose();
		this.settings.dispose();
		this.listeners.clear();
		try {
			await this.process.close();
		} finally {
			this.resourceDelivery.dispose();
		}
	}

	getStatus(): AgentRuntimeStatus {
		const diagnostics = this.process.client.getDiagnostics();
		return {
			streaming: this.turns.streaming,
			enabledTools: [...new Set([...this.selectedToolNames, ...this.observedToolNames])].sort(),
			cwd: this.cwd,
			activeModel: this.settings.activeModel,
			reasoning: this.settings.reasoning,
			fastMode: this.settings.fastMode,
			contextUsage: this.settings.currentContextUsage,
			warnings: [
				...diagnostics.filter((entry) => entry.level === "warning").map((entry) => entry.message),
				...(this.resourceWarning ? [this.resourceWarning] : []),
				...(this.toolInventoryWarning ? [this.toolInventoryWarning] : []),
			],
			errors: [
				...diagnostics.filter((entry) => entry.level === "error").map((entry) => entry.message),
				...(this.resourceProcessUnavailable
					? ["Native Codex resource process is unavailable pending a bounded retry."]
					: []),
			],
		};
	}

	getNativeCompatibilityHandle(): unknown {
		return this.process.client;
	}

	private createRequestController(process: CodexNativeAppServerProcess): CodexNativeRequestController {
		return new CodexNativeRequestController(
			process.client,
			() => this.threads.thread.id,
			() => this.turns.activeTurnId,
			this.structuredUserInput,
			(event) => this.emit(event),
		);
	}

	private async runIdleOperation<T>(operation: () => Promise<T>): Promise<T> {
		await this.resourceRefresh;
		this.assertIdle();
		this.operationInFlight = true;
		try {
			return await operation();
		} finally {
			this.operationInFlight = false;
			this.scheduleResourceMaintenance();
		}
	}

	private scheduleResourceMaintenance(delayMs?: number): void {
		if (this.resourceMaintenanceTimer) clearTimeout(this.resourceMaintenanceTimer);
		this.resourceMaintenanceTimer = undefined;
		if (this.disposed) return;
		const maintenanceAt = this.resourceDelivery.nextCredentialMaintenanceAt;
		if (maintenanceAt === undefined && delayMs === undefined) return;
		const delay = delayMs ?? Math.max(25, maintenanceAt! - Date.now());
		this.resourceMaintenanceTimer = setTimeout(() => {
			this.resourceMaintenanceTimer = undefined;
			void this.maintainResourceCredential();
		}, Math.max(25, delay));
		this.resourceMaintenanceTimer.unref?.();
	}

	private async maintainResourceCredential(): Promise<void> {
		if (this.disposed) return;
		const busy = this.operationInFlight
			|| this.turns.streaming
			|| this.requests.pendingApprovals.length > 0
			|| this.requests.pendingUserInputs.length > 0;
		try {
			if (this.resourceProcessUnavailable) {
				if (busy) {
					this.scheduleResourceMaintenance(RESOURCE_MAINTENANCE_RETRY_MS);
					return;
				}
				await this.rolloverResourceProcess();
			} else if (this.resourceDelivery.shouldRolloverCredential()) {
				if (busy) {
					this.resourceDelivery.renewCredential();
					this.resourceWarning = undefined;
					this.scheduleResourceMaintenance(RESOURCE_MAINTENANCE_RETRY_MS);
					return;
				}
				await this.rolloverResourceProcess();
			} else {
				try {
					this.resourceDelivery.renewCredential();
				} catch {
					if (busy) throw new Error("Native Codex portable-resource credentials could not be renewed during the active turn.");
					await this.rolloverResourceProcess();
				}
			}
			this.resourceWarning = undefined;
			this.scheduleResourceMaintenance();
		} catch (error) {
			this.resourceWarning = error instanceof Error
				? error.message
				: "Native Codex portable-resource credentials could not be refreshed; Pibo will retry while the session remains idle.";
			this.scheduleResourceMaintenance(RESOURCE_MAINTENANCE_RETRY_MS);
		}
	}

	private async ensureFreshResourcesForTurn(): Promise<void> {
		await this.resourceRefresh;
		this.assertActive();
		if (this.resourceProcessUnavailable || this.resourceDelivery.needsCredentialRolloverForTurn()) {
			await this.rolloverResourceProcess();
			return;
		}
		const maintenanceAt = this.resourceDelivery.nextCredentialMaintenanceAt;
		if (maintenanceAt !== undefined && maintenanceAt <= Date.now()) {
			try {
				this.resourceDelivery.renewCredential();
				this.resourceWarning = undefined;
			} catch {
				await this.rolloverResourceProcess();
			}
		}
		this.scheduleResourceMaintenance();
	}

	private async rolloverResourceProcess(): Promise<void> {
		if (this.resourceRefresh) return await this.resourceRefresh;
		const refresh = this.performResourceProcessRollover();
		this.resourceRefresh = refresh;
		try {
			await refresh;
		} finally {
			if (this.resourceRefresh === refresh) this.resourceRefresh = undefined;
		}
	}

	private async performResourceProcessRollover(): Promise<void> {
		this.assertActive();
		if (this.operationInFlight || this.turns.streaming || this.requests.pendingApprovals.length > 0 || this.requests.pendingUserInputs.length > 0) {
			throw new Error("Native Codex portable resources can only be refreshed while the session is idle.");
		}
		const previousProcess = this.process;
		const previousThreads = this.threads;
		const previousTurns = this.turns;
		const previousRequests = this.requests;
		const previousDelivery = this.resourceDelivery;
		const previousThread = previousThreads.thread;
		let next: CodexNativeProcessBundle | undefined;
		let reboundSettings = false;
		let phase = "stopping the previous process";
		try {
			await previousProcess.close();
			this.resourceProcessUnavailable = true;
			phase = "starting the replacement process";
			next = await this.reloadProcess();
			phase = "resuming the native thread";
			this.assertActive();
			this.settings.bindClient(next.process.client);
			reboundSettings = true;
			const selection = {
				...this.settings.threadSelection,
				...(next.resourceDelivery.threadConfig ? { config: next.resourceDelivery.threadConfig } : {}),
				...(next.resourceDelivery.developerInstructions
					? { developerInstructions: next.resourceDelivery.developerInstructions }
					: {}),
			};
			const nextThreads = previousThread.turns.length === 0 && !previousThread.path
				? await CodexNativeThreadController.start(next.process.client, this.cwd, selection)
				: await CodexNativeThreadController.resume(next.process.client, previousThread.id, this.cwd, selection);
			this.settings.attachThread(nextThreads.thread.id, nextThreads.configuration);
			phase = "verifying portable resources";
			await next.resourceDelivery.verifyThread(next.process.client, nextThreads.thread.id);
			phase = "activating the replacement process";
			this.assertActive();
			const nextTurns = new CodexNativeTurnController(next.process.client, nextThreads, (event) => this.emit(event));
			this.process = next.process;
			this.threads = nextThreads;
			this.resourceDelivery = next.resourceDelivery;
			this.updateSelectedToolNames(next.resourceDelivery);
			this.turns = nextTurns;
			this.requests = this.createRequestController(next.process);
			previousRequests.dispose();
			previousTurns.dispose();
			this.updateBindingFromCurrentThread();
			this.resourceProcessUnavailable = false;
			this.resourceWarning = undefined;
			next = undefined;
			previousDelivery.dispose();
		} catch {
			if (reboundSettings) {
				this.settings.bindClient(previousProcess.client);
				this.settings.attachThread(previousThread.id, previousThreads.configuration);
			}
			if (next) {
				await next.process.close().catch(() => {});
				next.resourceDelivery.dispose();
			}
			throw new Error(`Native Codex portable-resource credential refresh failed while ${phase}; Pibo will retry while the session remains idle.`);
		}
	}

	private updateSelectedToolNames(resourceDelivery: CodexNativeResourceDelivery): void {
		const names = [...new Set(resourceDelivery.enabledToolNames)].sort();
		this.selectedToolNames = new Set(names.slice(0, MAX_INSPECTED_SELECTED_TOOL_NAMES));
		this.toolInventoryWarning = names.length > MAX_INSPECTED_SELECTED_TOOL_NAMES
			? `Native Codex selected-tool status is limited to ${MAX_INSPECTED_SELECTED_TOOL_NAMES} names.`
			: undefined;
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		if (this.disposed) return;
		if (
			event.type === "tool_call"
			&& event.toolName.trim()
			&& event.toolName.length <= 512
			&& (this.observedToolNames.has(event.toolName) || this.observedToolNames.size < MAX_INSPECTED_TOOL_NAMES)
		) {
			this.observedToolNames.add(event.toolName);
		}
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// Runtime listeners are isolated from the owned Codex process lifecycle.
			}
		}
	}

	private updateBindingFromCurrentThread(): void {
		this.binding = bindingForThread({
			piboSessionId: this.binding.piboSessionId,
			runtimeInstanceId: this.runtimeInstanceId,
			previous: this.binding,
			thread: this.threads.thread,
			settings: this.settings.bindingMetadata,
		});
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Codex runtime session is disposed.");
	}

	private assertIdle(): void {
		this.assertActive();
		if (this.turns.streaming || this.resourceRefresh || this.resourceProcessUnavailable) {
			throw new Error("Codex runtime controls can only change while the session is idle.");
		}
	}
}

type CodexNativeCompatibilityServices = {
	thinkingLevel?: string;
	modelDefaults?: PiboModelDefaults;
	initialFastMode?: boolean;
};

export class CodexNativeAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly descriptor: AgentRuntimeDriver<CodexNativeRuntimeConfig>["descriptor"];
	readonly config: CodexNativeRuntimeConfig;
	readonly displayName: string;
	readonly enabled: boolean;
	private modelCatalogCache?: { expiresAt: number; value: Promise<CodexNativeModelCatalog> };
	private readonly authController: CodexNativeAuthController;

	constructor(
		readonly instanceId: string,
		config: CodexNativeRuntimeConfig,
		displayName: string | undefined,
		enabled: boolean,
	) {
		this.config = structuredClone(config);
		this.descriptor = {
			...CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor,
			capabilities: codexNativeCapabilities(config.experimentalUserInput),
		};
		this.displayName = displayName ?? this.descriptor.displayName;
		this.enabled = enabled;
		this.authController = new CodexNativeAuthController({
			config: this.config,
			startProcess: async (sessionGeneration) => await startCodexNativeAppServer({
				config: this.config,
				runtimeInstanceId: this.instanceId,
				piboSessionId: "runtime-auth",
				sessionGeneration,
				workspace: process.cwd(),
				clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
			}),
		});
	}

	diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return diagnoseCodexNativeRuntime(this.config, this.instanceId);
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

	async completeAuth(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return await this.authController.complete(input);
	}

	async cancelAuth(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return await this.authController.cancel(input);
	}

	async logoutAuth(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return await this.authController.logout(input);
	}

	async disposeAuth(): Promise<void> {
		await this.authController.dispose();
	}

	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] {
		const diagnostics: AgentRuntimeDiagnostic[] = [];
		if (input.profile.runtimeInstanceId !== this.instanceId) {
			diagnostics.push({
				severity: "error",
				code: "runtime_instance_mismatch",
				message: `Profile "${input.profile.profileName}" selects runtime instance "${input.profile.runtimeInstanceId}", not "${this.instanceId}".`,
			});
		}
		try {
			parseCodexNativeProfileOptions(input.profile.runtimeOptions);
		} catch (error) {
			diagnostics.push({
				severity: "error",
				code: "codex_native_runtime_options_invalid",
				message: error instanceof Error ? error.message : "Native Codex runtime options are invalid.",
				path: "runtimeOptions",
			});
		}
		for (const [path, model] of [
			["model", input.profile.model],
			["mainModel", input.profile.mainModel],
			["subagentModel", input.profile.subagentModel],
		] as const) {
			if (model && model.provider !== CODEX_NATIVE_MODEL_PROVIDER_ID) {
				diagnostics.push({
					severity: "error",
					code: "codex_native_model_provider_invalid",
					message: `Native Codex models use provider "${CODEX_NATIVE_MODEL_PROVIDER_ID}", not "${model.provider}".`,
					path,
				});
			}
		}
		return diagnostics;
	}

	async resolveBinding(input: { binding: RuntimeSessionBinding; workspace: string }): Promise<RuntimeSessionBinding> {
		const binding = structuredClone(input.binding);
		if (binding.state !== "bound") return binding;
		if (!binding.nativeSessionId) {
			return {
				...binding,
				state: "error",
				metadata: {
					...(binding.metadata ?? {}),
					diagnosticCode: "codex_native_thread_id_missing",
					diagnosticMessage: "The persisted Codex binding has no native thread id.",
				},
			};
		}
		try {
			const thread = await this.withProcess(binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, binding.nativeSessionId!, false));
			return bindingForThread({
				piboSessionId: binding.piboSessionId,
				runtimeInstanceId: this.instanceId,
				previous: binding,
				thread,
			});
		} catch (error) {
			if (error instanceof CodexNativeThreadMissingError) {
				return {
					...binding,
					state: "missing",
					metadata: {
						...(binding.metadata ?? {}),
						diagnosticCode: "codex_native_thread_missing",
						diagnosticMessage: "The bound Codex thread is no longer available in this configured runtime instance.",
					},
				};
			}
			throw new AgentRuntimeUnavailableError(
				this.instanceId,
				`Codex binding inspection failed for runtime instance "${this.instanceId}".`,
			);
		}
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const binding = validateOpenBinding(input, this.instanceId);
		const sessionGeneration = input.services?.resources?.sessionGeneration
			?? input.services?.portableTools?.sessionGeneration
			?? randomUUID();
		const resourceInput = {
			workspace: input.workspace,
			portableTools: input.services?.portableTools,
			resources: input.services?.resources,
			nativeSubagentsEnabled: input.profile.nativeSubagents,
		};
		const startProcessBundle = async (processGeneration: string): Promise<CodexNativeProcessBundle> => {
			let delivery: CodexNativeResourceDelivery | undefined;
			let ownedProcess: CodexNativeAppServerProcess | undefined;
			try {
				delivery = await CodexNativeResourceDelivery.prepare(resourceInput);
				ownedProcess = await startCodexNativeAppServer({
					config: this.config,
					runtimeInstanceId: this.instanceId,
					piboSessionId: input.piboSession.id,
					sessionGeneration: processGeneration,
					workspace: input.workspace,
					clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
					resourceEnvironment: delivery.environment,
				});
				await delivery.configureProcess(ownedProcess.client, input.workspace);
				return { process: ownedProcess, resourceDelivery: delivery };
			} catch (error) {
				await ownedProcess?.close().catch(() => {});
				delivery?.dispose();
				throw error;
			}
		};
		let resourceDelivery: CodexNativeResourceDelivery | undefined;
		let process: CodexNativeAppServerProcess | undefined;
		let settings: CodexNativeSessionSettingsController | undefined;
		try {
			const initial = await startProcessBundle(sessionGeneration);
			resourceDelivery = initial.resourceDelivery;
			process = initial.process;
			const compatibility = input.services?.compatibility as CodexNativeCompatibilityServices | undefined;
			const catalog = await this.loadModelCatalog(process.client);
			const profileOptions = parseCodexNativeProfileOptions(input.profile.runtimeOptions);
			const persisted = binding.state === "bound"
				? readCodexNativePersistedSettings(binding.metadata)
				: { profileOptions: {} };
			const persistedOptions = persisted.profileOptions;
			const hasPersistedServiceTier = Object.hasOwn(persistedOptions, "serviceTier");
			settings = new CodexNativeSessionSettingsController(process.client, catalog, {
				activeModel: input.activeModel
					?? persisted.activeModel
					?? selectRequestedModelProfile(input.profile, compatibility?.modelDefaults),
				reasoningLevel: persisted.reasoningLevel
					?? compatibility?.thinkingLevel
					?? selectRequestedThinkingLevel(input.profile, compatibility?.modelDefaults),
				initialFastMode: hasPersistedServiceTier
					? undefined
					: compatibility?.initialFastMode
						?? selectRequestedFastMode(input.profile, compatibility?.modelDefaults),
				profileOptions: {
					serviceTier: hasPersistedServiceTier ? persistedOptions.serviceTier : profileOptions.serviceTier,
					personality: Object.hasOwn(persistedOptions, "personality")
						? persistedOptions.personality
						: profileOptions.personality,
					reasoningSummary: Object.hasOwn(persistedOptions, "reasoningSummary")
						? persistedOptions.reasoningSummary
						: profileOptions.reasoningSummary,
				},
			});
			const threadSelection = {
				...settings.threadSelection,
				...(resourceDelivery.threadConfig ? { config: resourceDelivery.threadConfig } : {}),
				...(resourceDelivery.developerInstructions
					? { developerInstructions: resourceDelivery.developerInstructions }
					: {}),
			};
			let threads: CodexNativeThreadController;
			try {
				threads = binding.state === "bound"
					? await CodexNativeThreadController.resume(
						process.client,
						binding.nativeSessionId!,
						input.workspace,
						threadSelection,
					)
					: await CodexNativeThreadController.start(process.client, input.workspace, threadSelection);
			} catch (error) {
				if (error instanceof CodexNativeThreadMissingError || !resourceDelivery.hasMcpServers) throw error;
				throw new Error("Codex could not initialize every selected MCP server.");
			}
			if (input.historyHandoff?.mode === "import") {
				if (binding.state === "bound") {
					throw new Error("Native Codex portable history import requires a new thread.");
				}
				await injectPortableHistoryIntoCodex(process.client, threads.thread.id, input.historyHandoff.history);
			}
			settings.attachThread(threads.thread.id, threads.configuration);
			await resourceDelivery.verifyThread(process.client, threads.thread.id);
			return new CodexNativeThreadSession(
				this.instanceId,
				process,
				threads,
				settings,
				resourceDelivery,
				bindingForThread({
					piboSessionId: input.piboSession.id,
					runtimeInstanceId: this.instanceId,
					previous: binding,
					thread: threads.thread,
					settings: settings.bindingMetadata,
				}),
				this.config.experimentalUserInput,
				async () => await startProcessBundle(`${sessionGeneration}-credential-${randomUUID()}`),
				input.productContext,
			);
		} catch (error) {
			settings?.dispose();
			await process?.close().catch(() => {});
			resourceDelivery?.dispose();
			if (error instanceof CodexNativeThreadMissingError) {
				throw new AgentRuntimeBindingMissingError(input.piboSession.id, this.instanceId, binding.nativeSessionId);
			}
			throw error;
		}
	}

	async inspectHistory(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection> {
		const threadId = input.binding.nativeSessionId;
		if (!threadId) {
			return unavailableCodexThreadHistoryInspection(
				this.instanceId,
				input.binding,
				"codex_native_history_thread_id_missing",
				"The Codex runtime binding has no native thread id for history lookup.",
			);
		}
		try {
			const thread = await this.withProcess(input.binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, threadId, false));
			return inspectCodexThreadHistory(this.instanceId, input.binding, thread);
		} catch (error) {
			return unavailableCodexThreadHistoryInspection(
				this.instanceId,
				input.binding,
				error instanceof CodexNativeThreadMissingError ? "codex_native_history_not_found" : "codex_native_history_unavailable",
				error instanceof CodexNativeThreadMissingError
					? "The bound Codex thread is unavailable for native history inspection."
					: "Codex native history inspection failed safely.",
			);
		}
	}

	async readHistory(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage> {
		const threadId = input.binding.nativeSessionId;
		if (!threadId) {
			const inspection = await this.inspectHistory(input);
			return {
				runtimeInstanceId: this.instanceId,
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				source: "native",
				entries: [],
				hasMore: false,
				inspection,
			};
		}
		try {
			const thread = await this.withProcess(input.binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, threadId, true));
			return pageCodexThreadHistory({
				runtimeInstanceId: this.instanceId,
				binding: input.binding,
				thread,
				cursor: input.cursor,
				beforeTimestamp: input.beforeTimestamp,
				limit: input.limit,
			});
		} catch (error) {
			if (error instanceof CodexNativeThreadMissingError) {
				const inspection = unavailableCodexThreadHistoryInspection(
					this.instanceId,
					input.binding,
					"codex_native_history_not_found",
					"The bound Codex thread is unavailable for native history reads.",
				);
				return {
					runtimeInstanceId: this.instanceId,
					adapterId: CODEX_NATIVE_ADAPTER_ID,
					source: "native",
					entries: [],
					hasMore: false,
					inspection,
				};
			}
			throw new AgentRuntimeUnavailableError(
				this.instanceId,
				`Codex native history read failed for runtime instance "${this.instanceId}".`,
			);
		}
	}

	private loadModelCatalog(client?: CodexNativeAppServerProcess["client"]): Promise<CodexNativeModelCatalog> {
		const now = Date.now();
		if (this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) return this.modelCatalogCache.value;
		const value = client
			? readCodexNativeModelCatalog(client)
			: this.withProcess("model-catalog", process.cwd(), async (catalogProcess) =>
				await readCodexNativeModelCatalog(catalogProcess.client));
		this.modelCatalogCache = { expiresAt: now + 5_000, value };
		value.catch(() => {
			if (this.modelCatalogCache?.value === value) this.modelCatalogCache = undefined;
		});
		return value;
	}

	private async withProcess<T>(
		piboSessionId: string,
		workspace: string,
		operation: (process: CodexNativeAppServerProcess) => Promise<T>,
	): Promise<T> {
		const process = await startCodexNativeAppServer({
			config: this.config,
			runtimeInstanceId: this.instanceId,
			piboSessionId,
			sessionGeneration: `inspection-${randomUUID()}`,
			workspace,
			clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
		});
		try {
			return await operation(process);
		} finally {
			await process.close();
		}
	}
}

export const CODEX_NATIVE_AGENT_RUNTIME_DRIVER: AgentRuntimeDriver<CodexNativeRuntimeConfig> = {
	descriptor: {
		id: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex App Server",
		transport: "stdio-rpc",
		configSchema: CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA,
		capabilities: CODEX_NATIVE_THREAD_CAPABILITIES,
		protocol: {
			name: CODEX_APP_SERVER_PROTOCOL_NAME,
			supportedRange: CODEX_APP_SERVER_SUPPORTED_RANGE,
		},
		supportsMultipleInstances: true,
	},
	defaultConfig: defaultCodexNativeRuntimeConfig,
	parseConfig: parseCodexNativeRuntimeConfig,
	create(input) {
		return new CodexNativeAgentRuntimeAdapter(
			input.instanceId,
			input.config,
			input.displayName,
			input.enabled,
		);
	},
};

export function getCodexNativeClient(session: AgentRuntimeSession): unknown {
	if (session.adapterId !== CODEX_NATIVE_ADAPTER_ID) return undefined;
	return session.getNativeCompatibilityHandle?.();
}
