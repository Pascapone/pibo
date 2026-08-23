import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { SessionManager, type AgentSessionRuntime, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	InitialSessionContext,
	type ModelProfile,
} from "../../core/profiles.js";
import {
	createPiboRuntime,
	type PiboRuntimeOptions,
	type PiboRuntimeRetryDefaults,
	type PiboRuntimeSessionContext,
} from "./runtime.js";
import type {
	PiboJsonObject,
	PiboOutputEvent,
	PiboPiSessionSnapshot,
	PiboSessionListItem,
	PiboSessionOperationResult,
	PiboSessionTreeResult,
} from "../../core/events.js";
import type { PiboSubagentRunner } from "../../subagents/tool.js";
import type { PiboRunToolController } from "../../runs/tools.js";
import type { PiboRuntimeToolController } from "../../tools/runtime/tool.js";
import { PiboPluginRegistry } from "../../plugins/registry.js";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
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
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeModelCatalog,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeSessionOperationResult,
	AgentRuntimeStatus,
	InspectAgentRuntimeHistoryInput,
	LogoutAgentRuntimeAuthInput,
	OpenAgentRuntimeSessionInput,
	ReadAgentRuntimeHistoryInput,
	RuntimeSessionBinding,
	StartAgentRuntimeAuthInput,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";
import { RoutedSession as PiRoutedSession } from "./routed-session.js";
import {
	loadModelCatalog as loadPiModelCatalog,
	piAgentRuntimeModelCatalog,
	type ModelCatalog as PiModelCatalog,
} from "./model-catalog.js";
import {
	inspectPiAgentRuntimeHistory,
	readPiAgentRuntimeHistory,
} from "./history.js";
import { PiAgentRuntimeAuthController } from "./auth.js";
import { importPortableHistoryIntoPi } from "./portable-history.js";
import { piIntentTracingEnabled } from "./intent-tracing.js";

const PI_ADAPTER_ID = "pi";
export const PI_PROTOCOL_VERSION = "0.84.2";

export const PI_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
	lifecycle: {
		persistent: true,
		lazyBinding: false,
		resume: true,
		attach: true,
		listNativeSessions: true,
		fork: true,
		clone: true,
		tree: true,
	},
	input: {
		text: true,
		images: true,
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
		rawNativeEvents: true,
	},
	tools: {
		piboManaged: { support: "direct" },
		nativeToolInspection: { support: "native" },
		nativeToolYielding: { support: "native" },
		intentTracing: {
			supported: true,
			configurable: true,
			enabledByDefault: false,
		},
	},
	mcp: {
		externalServers: { support: "materialized", modes: ["isolated-pibo-mcp-config"] },
		statusInspection: true,
	},
	skills: { support: "native" },
	context: { support: "native" },
	contextDiscovery: {
		supported: true,
		configurable: true,
		enabledByDefault: true,
		strategy: "filesystem-ancestors",
		knownFileNames: ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"],
	},
	nativeSubagents: {
		supported: false,
		configurable: false,
		enabledByDefault: false,
	},
	historyImport: true,
	auth: {
		status: true,
		methods: [
			{ id: "device_code", completion: "explicit" },
			{ id: "browser_oauth", completion: "explicit" },
			{ id: "api_key", completion: "immediate" },
		],
		cancel: true,
		logout: true,
		credentialScope: "adapter-shared",
	},
	models: {
		catalog: true,
		switchInSession: true,
	},
	reasoning: {
		supported: true,
		values: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	},
	approvals: {
		supported: false,
		structuredUserInput: false,
	},
	maintenance: {
		compaction: true,
		contextUsage: true,
		history: true,
		health: true,
	},
};

export type PiAgentRuntimeCompatibilityServices = {
	persistSession?: boolean;
	thinkingLevel?: PiboRuntimeOptions["thinkingLevel"];
	retryDefaults?: PiboRuntimeRetryDefaults;
	extensionFactories?: ExtensionFactory[];
	modelDefaults?: PiboRuntimeOptions["modelDefaults"];
	contextGuardTuiQueueOrdering?: boolean;
	initialFastMode?: boolean;
};

type PendingPiPrompt = {
	id: string;
	terminal: boolean;
	resolve: () => void;
	reject: (error: unknown) => void;
};

function cloneProfileForPiSession(input: OpenAgentRuntimeSessionInput): InitialSessionContext {
	const profile = input.profile;
	const nativeSessionId = input.binding?.nativeSessionId ?? input.piboSession.piSessionId;
	return new InitialSessionContext({
		profileName: profile.profileName,
		runtimeInstanceId: profile.runtimeInstanceId,
		runtimeOptions: profile.runtimeOptions,
		sessionId: nativeSessionId,
		parentSessionId: profile.parentSessionId,
		model: profile.model,
		mainModel: profile.mainModel,
		subagentModel: profile.subagentModel,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel,
		fast: profile.fast,
		mainFast: profile.mainFast,
		subagentFast: profile.subagentFast,
		skills: profile.skills,
		tools: profile.tools,
		subagents: profile.subagents,
		mcpServers: profile.mcpServers,
		piPackages: profile.piPackages,
		contextFiles: profile.contextFiles,
		builtinTools: profile.builtinTools,
		builtinToolNames: profile.builtinToolNames,
		autoContextFiles: profile.autoContextFiles,
		nativeSubagents: profile.nativeSubagents,
		toolPackages: profile.toolPackages,
	});
}

function nativeSnapshotFromPi(
	runtimeInstanceId: string,
	snapshot: PiboPiSessionSnapshot,
): AgentRuntimeNativeSessionSnapshot {
	return {
		adapterId: PI_ADAPTER_ID,
		runtimeInstanceId,
		nativeSessionId: snapshot.piSessionId,
		locator: snapshot.sessionFile ? { kind: "local-file", value: snapshot.sessionFile } : undefined,
		leafId: snapshot.leafId,
		cwd: snapshot.cwd,
		name: snapshot.sessionName,
		parentLocator: snapshot.parentSessionFile
			? { kind: "local-file", value: snapshot.parentSessionFile }
			: undefined,
	};
}

function nativeOperationFromPi(
	runtimeInstanceId: string,
	result: PiboSessionOperationResult,
): AgentRuntimeSessionOperationResult {
	return {
		previous: nativeSnapshotFromPi(runtimeInstanceId, result.previous),
		current: nativeSnapshotFromPi(runtimeInstanceId, result.current),
		cancelled: result.cancelled,
		selectedText: result.selectedText,
		editorText: result.editorText,
		summaryEntryId: result.summaryEntryId,
	};
}

function nativeSessionInfoFromPi(
	runtimeInstanceId: string,
	info: PiboSessionListItem,
): AgentRuntimeNativeSessionInfo {
	return {
		adapterId: PI_ADAPTER_ID,
		runtimeInstanceId,
		nativeSessionId: info.id,
		locator: { kind: "local-file", value: info.path },
		cwd: info.cwd,
		name: info.name,
		parentLocator: info.parentSessionPath
			? { kind: "local-file", value: info.parentSessionPath }
			: undefined,
		createdAt: info.created,
		updatedAt: info.modified,
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
	};
}

export function semanticEventFromPibo(event: PiboOutputEvent): AgentRuntimeSemanticEvent | undefined {
	switch (event.type) {
		case "message_started":
			return { type: "turn_started", turnId: event.eventId };
		case "message_finished":
			return { type: "turn_completed", turnId: event.eventId, status: "completed" };
		case "assistant_delta":
			return { type: "assistant_delta", text: event.text, contentIndex: event.contentIndex };
		case "assistant_message":
			return { type: "assistant_message", text: event.text, contentIndex: event.contentIndex };
		case "thinking_started":
			return { type: "reasoning_started", contentIndex: event.contentIndex };
		case "thinking_delta":
			return { type: "reasoning_delta", text: event.text, contentIndex: event.contentIndex };
		case "thinking_finished":
			return { type: "reasoning_finished", text: event.text, contentIndex: event.contentIndex };
		case "tool_call":
			return {
				type: "tool_call",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				argsComplete: event.argsComplete,
				...(event.intent ? { intent: event.intent } : {}),
			};
		case "tool_execution_started":
			return { ...event, type: "tool_execution_started" };
		case "tool_execution_updated":
			return { ...event, type: "tool_execution_updated" };
		case "tool_execution_finished":
			return { ...event, type: "tool_execution_finished" };
		case "assistant_usage":
			return {
				type: "usage",
				usage: {
					inputTokens: event.inputTokens,
					outputTokens: event.outputTokens,
					cacheReadTokens: event.cacheReadTokens,
					cacheWriteTokens: event.cacheWriteTokens,
					totalTokens: event.totalTokens,
				},
			};
		case "compaction_start":
			return { type: "compaction_start", reason: event.reason };
		case "compaction_end":
			return {
				type: "compaction_end",
				reason: event.reason,
				result: event.result,
				aborted: event.aborted,
				errorMessage: event.errorMessage,
			};
		case "session_error":
			return { type: "error", message: event.error, details: event.errorDetails };
		case "pi_event":
			return { type: "native_event", event: event.event };
		default:
			return undefined;
	}
}

class PiAgentRuntimeSession implements AgentRuntimeSession {
	readonly adapterId = PI_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities = PI_AGENT_RUNTIME_CAPABILITIES;
	readonly compatibility = { productRawEventType: "pi_event" as const };
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private readonly routed: PiRoutedSession;
	private readonly compatibilityHandle: AgentSessionRuntime;
	private pendingPrompt?: PendingPiPrompt;
	private engineProcessing = false;
	private bindingNativeSessionId: string;
	private nativePresenceExpected: boolean;
	private disposed = false;

	constructor(
		readonly runtimeInstanceId: string,
		private readonly piboSessionId: string,
		private readonly runtime: AgentSessionRuntime,
		private readonly binding: RuntimeSessionBinding,
		initialFastMode: boolean,
	) {
		this.cwd = runtime.cwd;
		this.bindingNativeSessionId = runtime.session.sessionId;
		this.nativePresenceExpected = runtime.session.sessionManager.buildSessionContext().messages.length > 0;
		this.routed = new PiRoutedSession(
			piboSessionId,
			runtime,
			(event) => this.handlePiboEvent(event),
			PiboPluginRegistry.create(),
			true,
			undefined,
			initialFastMode,
			undefined,
			undefined,
			(state) => this.handleEngineState(state),
		);
		this.controls = this.createControls();
		this.compatibilityHandle = this.createCompatibilityHandle();
	}

	getBinding(): RuntimeSessionBinding {
		const persistent = this.binding.metadata?.persistent !== false;
		if (this.bindingNativeSessionId !== this.runtime.session.sessionId) {
			this.bindingNativeSessionId = this.runtime.session.sessionId;
			this.nativePresenceExpected = this.runtime.session.sessionManager.buildSessionContext().messages.length > 0;
		}
		return {
			...structuredClone(this.binding),
			nativeSessionId: this.runtime.session.sessionId,
			state: "bound",
			locator: this.runtime.session.sessionFile
				? { kind: "local-file", value: this.runtime.session.sessionFile }
				: undefined,
			metadata: {
				...(this.binding.metadata ?? {}),
				nativePresenceExpected: persistent && this.nativePresenceExpected,
			},
		};
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		if (this.pendingPrompt) throw new Error(`Pi runtime session "${this.piboSessionId}" already has an active prompt.`);
		const id = randomUUID();
		await new Promise<void>((resolve, reject) => {
			this.pendingPrompt = { id, terminal: false, resolve, reject };
			try {
				this.routed.enqueueMessage({
					type: "message",
					piboSessionId: this.piboSessionId,
					id,
					text: input.text,
					source: input.source === "interactive" ? "user" : "service",
					capabilityScope: input.capabilityScope === "run-reminder" ? "run-reminder" : undefined,
				});
			} catch (error) {
				this.pendingPrompt = undefined;
				reject(error);
			}
		});
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.routed.steerMessage({
			type: "message",
			piboSessionId: this.piboSessionId,
			id: randomUUID(),
			text: input.text,
			delivery: "steer",
			source: input.source === "interactive" ? "user" : "service",
		});
	}

	async abort(): Promise<void> {
		const pending = this.pendingPrompt;
		if (pending) {
			const cancelled = await this.routed.cancelMessage(pending.id);
			if (!cancelled) await this.runtime.session.abort();
			pending.terminal = true;
			this.settlePromptIfReady();
			return;
		}
		await this.runtime.session.abort();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.routed.dispose();
		const pending = this.pendingPrompt;
		this.pendingPrompt = undefined;
		pending?.resolve();
		this.listeners.clear();
	}

	getStatus(): AgentRuntimeStatus {
		const status = this.routed.getStatus();
		return {
			streaming: status.streaming,
			enabledTools: status.enabledTools,
			cwd: status.cwd,
			activeModel: this.routed.getActiveModel(),
			reasoning: {
				value: status.thinkingLevel,
				availableValues: this.runtime.session.getAvailableThinkingLevels(),
				supported: this.runtime.session.supportsThinking(),
			},
			fastMode: this.routed.getFastMode(),
			retry: status.retry ? structuredClone(status.retry) as unknown as PiboJsonObject : undefined,
			warnings: status.warnings,
			errors: status.errors,
		};
	}

	async getStatusSnapshot(): Promise<AgentRuntimeStatus> {
		const status = await this.routed.getStatusSnapshot();
		return {
			...this.getStatus(),
			activeModel: status.activeModel,
			contextUsage: status.contextUsage,
			providerUsage: status.providerUsage,
		};
	}

	getNativeCompatibilityHandle(): AgentSessionRuntime {
		return this.compatibilityHandle;
	}

	private handlePiboEvent(event: PiboOutputEvent): void {
		if (event.type === "message_started") this.nativePresenceExpected = true;
		const eventId = "eventId" in event ? event.eventId : undefined;
		const pending = this.pendingPrompt;
		if (pending && eventId === pending.id) {
			if (event.type === "message_finished" || event.type === "session_error") pending.terminal = true;
		}
		const semantic = semanticEventFromPibo(event);
		if (semantic) this.emit(semantic);
		if (event.type === "session_error") {
			this.emit({
				type: "turn_failed",
				turnId: event.eventId,
				message: event.error,
				details: event.errorDetails,
			});
		}
		this.settlePromptIfReady();
	}

	private handleEngineState(state: { processing: boolean; queuedMessages: number; disposed: boolean }): void {
		this.engineProcessing = state.processing;
		this.settlePromptIfReady();
	}

	private settlePromptIfReady(): void {
		const pending = this.pendingPrompt;
		if (!pending || !pending.terminal || this.engineProcessing) return;
		this.pendingPrompt = undefined;
		pending.resolve();
	}

	private createControls(): NonNullable<AgentRuntimeSession["controls"]> {
		return {
			getCurrentSession: () => nativeSnapshotFromPi(this.runtimeInstanceId, this.routed.getCurrentSession()),
			listSessions: async () => (await this.routed.listSessions()).map((info) => nativeSessionInfoFromPi(this.runtimeInstanceId, info)),
			getForkCandidates: () => this.routed.getForkCandidates(),
			forkSession: async (entryId) => nativeOperationFromPi(this.runtimeInstanceId, await this.routed.forkSession(entryId)),
			cloneSession: async () => nativeOperationFromPi(this.runtimeInstanceId, await this.routed.cloneSession()),
			getSessionTree: () => {
				const result: PiboSessionTreeResult = this.routed.getSessionTree();
				return {
					current: nativeSnapshotFromPi(this.runtimeInstanceId, result.current),
					tree: result.tree,
				};
			},
			navigateSessionTree: async (params) => nativeOperationFromPi(
				this.runtimeInstanceId,
				await this.routed.navigateSessionTree({
					entryId: String(params.entryId ?? ""),
					summarize: typeof params.summarize === "boolean" ? params.summarize : undefined,
					customInstructions: typeof params.customInstructions === "string" ? params.customInstructions : undefined,
					replaceInstructions: typeof params.replaceInstructions === "boolean" ? params.replaceInstructions : undefined,
					label: typeof params.label === "string" ? params.label : undefined,
				}),
			),
			switchSession: async (params) => nativeOperationFromPi(
				this.runtimeInstanceId,
				await this.routed.switchSession({
					sessionFile: String(params.sessionFile ?? ""),
					cwdOverride: typeof params.cwdOverride === "string" ? params.cwdOverride : undefined,
				}),
			),
			getReasoning: () => ({
				value: this.runtime.session.thinkingLevel,
				availableValues: this.runtime.session.getAvailableThinkingLevels(),
				supported: this.runtime.session.supportsThinking(),
			}),
			setReasoning: (value) => {
				const result = this.routed.setThinkingLevel(value as Parameters<PiRoutedSession["setThinkingLevel"]>[0]);
				return { value: result.level, availableValues: result.availableLevels, supported: result.supported };
			},
			cycleReasoning: () => {
				const result = this.routed.cycleThinkingLevel();
				return { value: result.level, availableValues: result.availableLevels, supported: result.supported };
			},
			getFastMode: () => this.routed.getFastMode(),
			setFastMode: (enabled) => this.routed.setFastMode(enabled),
			setModel: async (model: ModelProfile) => await this.routed.setModel(model),
			compact: async (customInstructions) => await this.routed.compact(customInstructions),
		};
	}

	private createCompatibilityHandle(): AgentSessionRuntime {
		return new Proxy(this.runtime, {
			get: (target, property, receiver) => {
				if (property === "dispose") return () => this.dispose();
				const value = Reflect.get(target, property, receiver) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private assertActive(): void {
		if (this.disposed) throw new Error(`Pi runtime session "${this.piboSessionId}" is disposed.`);
	}
}

class PiAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly descriptor = PI_AGENT_RUNTIME_DRIVER.descriptor;
	readonly config: PiboJsonObject;
	readonly displayName: string;
	private modelCatalogCache?: { expiresAt: number; value: Promise<PiModelCatalog> };
	private readonly authController: PiAgentRuntimeAuthController;

	constructor(
		readonly instanceId: string,
		config: PiboJsonObject,
		displayName: string | undefined,
		readonly enabled: boolean,
	) {
		this.config = structuredClone(config);
		this.displayName = displayName ?? this.descriptor.displayName;
		this.authController = new PiAgentRuntimeAuthController(
			() => this.loadModelCatalog(),
			() => {
				this.modelCatalogCache = undefined;
			},
		);
	}

	async diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return [{
			severity: "info",
			code: "pi_runtime_available",
			message: `Pi Coding Agent SDK ${PI_PROTOCOL_VERSION} is available in-process.`,
		}];
	}

	async listModels(): Promise<AgentRuntimeModelCatalog> {
		return piAgentRuntimeModelCatalog(this.instanceId, await this.loadModelCatalog());
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

	async inspectHistory(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection> {
		return await inspectPiAgentRuntimeHistory(this.instanceId, input);
	}

	async readHistory(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage> {
		return await readPiAgentRuntimeHistory(this.instanceId, input);
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
		const runtimeOptionKeys = Object.keys(input.profile.runtimeOptions);
		for (const key of runtimeOptionKeys) {
			if (key === "intentTracing") continue;
			diagnostics.push({
				severity: "error",
				code: "pi_runtime_option_unsupported",
				message: `The Pi runtime does not accept profile option "${key}".`,
				path: `runtimeOptions.${key}`,
			});
		}
		if ("intentTracing" in input.profile.runtimeOptions && typeof input.profile.runtimeOptions["intentTracing"] !== "boolean") {
			diagnostics.push({
				severity: "error",
				code: "pi_intent_tracing_invalid",
				message: "Pi intentTracing must be a boolean.",
				path: "runtimeOptions.intentTracing",
			});
		}
		const profileProvidesBash = input.profile.toolPackages.runControl === true
			|| (input.profile.builtinTools !== "disabled" && input.profile.builtinToolNames.includes("bash"));
		if (input.profile.mcpServers.length > 0 && !profileProvidesBash) {
			diagnostics.push({
				severity: "error",
				code: "pi_mcp_bash_required",
				message: "Pi delivers selected external MCP servers through the session-scoped Pibo MCP CLI configuration, which requires the Bash tool.",
				path: "mcpServers",
			});
		}
		return diagnostics;
	}

	async resolveBinding(input: { binding: RuntimeSessionBinding; workspace: string }): Promise<RuntimeSessionBinding> {
		const binding = structuredClone(input.binding);
		if (binding.state !== "bound" || binding.metadata?.persistent === false) return binding;
		if (!binding.nativeSessionId) {
			return {
				...binding,
				state: "error",
				metadata: {
					...(binding.metadata ?? {}),
					diagnosticCode: "pi_binding_native_id_missing",
					diagnosticMessage: "The persisted Pi binding is bound but has no native session id.",
				},
			};
		}
		const existing = (await SessionManager.list(input.workspace)).find((session) => session.id === binding.nativeSessionId);
		if (existing) {
			return {
				...binding,
				locator: { kind: "local-file", value: existing.path },
				metadata: {
					...(binding.metadata ?? {}),
					nativePresenceExpected: existing.messageCount > 0,
				},
			};
		}
		if (binding.metadata?.nativePresenceExpected === false) return binding;
		return {
			...binding,
			state: "missing",
			metadata: {
				...(binding.metadata ?? {}),
				diagnosticCode: "pi_session_missing",
				diagnosticMessage: `Pi session "${binding.nativeSessionId}" was not found for workspace "${input.workspace}".`,
			},
		};
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		if (input.historyHandoff?.mode === "import" && input.binding?.state === "bound") {
			throw new Error("Pi portable history import requires a new native session.");
		}
		const compatibility = input.services?.compatibility as PiAgentRuntimeCompatibilityServices | undefined;
		const profile = cloneProfileForPiSession(input);
		const intentTracing = piIntentTracingEnabled(profile.runtimeOptions);
		const runtime = await createPiboRuntime({
			cwd: input.workspace,
			persistSession: compatibility?.persistSession,
			profile,
			thinkingLevel: compatibility?.thinkingLevel,
			retryDefaults: compatibility?.retryDefaults,
			extensionFactories: compatibility?.extensionFactories,
			subagentRunner: input.services?.subagentRunner as PiboSubagentRunner | undefined,
			runToolController: input.services?.runToolController as PiboRunToolController | undefined,
			runtimeToolController: input.services?.codeRuntimeToolController as PiboRuntimeToolController | undefined,
			portableTools: input.services?.portableTools,
			resources: input.services?.resources,
			modelDefaults: compatibility?.modelDefaults,
			activeModel: input.activeModel,
			sessionContext: {
				piboSessionId: input.productContext.piboSessionId,
				piboRoomId: input.productContext.piboRoomId,
				timezone: input.productContext.timezone,
				getActiveMessage: input.productContext.getActiveMessage as PiboRuntimeSessionContext["getActiveMessage"],
			},
			contextGuardTuiQueueOrdering: compatibility?.contextGuardTuiQueueOrdering,
		});
		if (input.historyHandoff?.mode === "import") {
			try {
				importPortableHistoryIntoPi(runtime.session.sessionManager, input.historyHandoff.history);
			} catch (error) {
				const partialSessionFile = runtime.session.sessionFile;
				await runtime.dispose().catch(() => {});
				if (partialSessionFile) await rm(partialSessionFile, { force: true }).catch(() => {});
				throw error;
			}
		}
		const binding: RuntimeSessionBinding = {
			...(input.binding ? structuredClone(input.binding) : {}),
			piboSessionId: input.piboSession.id,
			runtimeInstanceId: this.instanceId,
			adapterId: this.descriptor.id,
			nativeSessionId: runtime.session.sessionId,
			state: "bound",
			protocol: "pi-sdk",
			protocolVersion: PI_PROTOCOL_VERSION,
			locator: runtime.session.sessionFile
				? { kind: "local-file", value: runtime.session.sessionFile }
				: undefined,
			metadata: {
				...(input.binding?.metadata ?? {}),
				persistent: compatibility?.persistSession !== false,
				intentTracing,
				nativePresenceExpected:
					compatibility?.persistSession !== false
					&& runtime.session.sessionManager.buildSessionContext().messages.length > 0,
			},
		};
		return new PiAgentRuntimeSession(
			this.instanceId,
			input.piboSession.id,
			runtime,
			binding,
			compatibility?.initialFastMode ?? false,
		);
	}

	private loadModelCatalog(): Promise<PiModelCatalog> {
		const now = Date.now();
		if (this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) return this.modelCatalogCache.value;
		const value = loadPiModelCatalog(process.cwd());
		this.modelCatalogCache = { expiresAt: now + 5_000, value };
		value.catch(() => {
			if (this.modelCatalogCache?.value === value) this.modelCatalogCache = undefined;
		});
		return value;
	}
}

export const PI_AGENT_RUNTIME_DRIVER: AgentRuntimeDriver<PiboJsonObject> = {
	descriptor: {
		id: PI_ADAPTER_ID,
		displayName: "Pi Coding Agent",
		transport: "embedded",
		configSchema: {
			type: "object",
			additionalProperties: false,
		},
		capabilities: PI_AGENT_RUNTIME_CAPABILITIES,
		protocol: {
			name: "pi-sdk",
			supportedRange: PI_PROTOCOL_VERSION,
		},
		supportsMultipleInstances: true,
	},
	defaultConfig: () => ({}),
	parseConfig(value) {
		if (Object.keys(value).length > 0) throw new Error("Pi runtime config does not accept instance fields yet.");
		return {};
	},
	create(input) {
		return new PiAgentRuntimeAdapter(
			input.instanceId,
			input.config,
			input.displayName,
			input.enabled,
		);
	},
};

export function getPiAgentRuntimeCompatibilityHandle(session: AgentRuntimeSession): AgentSessionRuntime | undefined {
	if (session.adapterId !== PI_ADAPTER_ID) return undefined;
	return session.getNativeCompatibilityHandle?.() as AgentSessionRuntime | undefined;
}

export const PI_NATIVE_TOOL_YIELDING_LIMITATION = unsupportedAgentRuntimeCapability(
	"Only Pi direct tools can be wrapped natively. External harness-native tools require an explicit host-tool capability.",
);
