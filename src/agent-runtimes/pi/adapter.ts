import { SessionManager, type AgentSessionRuntime, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getOpenAiCodexProviderUsageForActiveModel } from "../../auth/openai-codex-usage.js";
import { expandInlineSkills } from "../../core/skill-expansion.js";
import {
	normalizeAssistantUsageEvent,
	normalizePiEvent,
} from "../../core/routed-session.js";
import {
	InitialSessionContext,
	type ModelProfile,
} from "../../core/profiles.js";
import {
	createPiboRuntime,
	type PiboRuntimeOptions,
	type PiboRuntimeRetryDefaults,
	type PiboRuntimeSessionContext,
} from "../../core/runtime.js";
import type { PiboJsonObject, PiboOutputEvent } from "../../core/events.js";
import type { PiboSubagentRunner } from "../../subagents/tool.js";
import type { PiboRunToolController } from "../../runs/tools.js";
import type { PiboRuntimeToolController } from "../../tools/runtime/tool.js";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeSessionTreeNode,
	AgentRuntimeStatus,
	OpenAgentRuntimeSessionInput,
	RuntimeSessionBinding,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";

const PI_ADAPTER_ID = "pi";
const PI_PROTOCOL_VERSION = "0.80.6";

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
		nativeToolYielding: { support: "native" },
	},
	mcp: {
		externalServers: { support: "native" },
		statusInspection: false,
	},
	skills: { support: "native" },
	context: { support: "native" },
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
		toolPackages: profile.toolPackages,
	});
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAssistantMessageEnd(event: unknown): event is { type: "message_end"; message: { role?: unknown; usage?: unknown } } {
	if (!event || typeof event !== "object") return false;
	const candidate = event as { type?: unknown; message?: { role?: unknown } };
	return candidate.type === "message_end" && candidate.message?.role === "assistant";
}

function semanticEventFromPibo(event: PiboOutputEvent): AgentRuntimeSemanticEvent | undefined {
	switch (event.type) {
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
		default:
			return undefined;
	}
}

function normalizePiTree(nodes: ReturnType<AgentSessionRuntime["session"]["sessionManager"]["getTree"]>): AgentRuntimeSessionTreeNode[] {
	return nodes.map((node) => ({
		entry: JSON.parse(JSON.stringify(node.entry)) as PiboJsonObject,
		children: normalizePiTree(node.children),
		label: node.label,
		labelTimestamp: node.labelTimestamp,
	}));
}

class PiAgentRuntimeSession implements AgentRuntimeSession {
	readonly adapterId = PI_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities = PI_AGENT_RUNTIME_CAPABILITIES;
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private unsubscribePi?: () => void;
	private disposed = false;
	private readonly compatibilityHandle: AgentSessionRuntime;

	constructor(
		readonly runtimeInstanceId: string,
		private readonly piboSessionId: string,
		private readonly runtime: AgentSessionRuntime,
		private binding: RuntimeSessionBinding,
	) {
		this.cwd = runtime.cwd;
		this.controls = this.createControls();
		this.bindPiSession();
		runtime.setRebindSession(async () => this.bindPiSession());
		this.compatibilityHandle = this.createCompatibilityHandle();
	}

	getBinding(): RuntimeSessionBinding {
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		const text = expandInlineSkills(input.text, this.runtime.session.resourceLoader.getSkills().skills);
		await this.runtime.session.prompt(text, { source: input.source });
		const waitForIdle = (this.runtime.session as AgentSessionRuntime["session"] & { waitForIdle?: () => Promise<void> }).waitForIdle;
		if (waitForIdle) await waitForIdle.call(this.runtime.session);
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		const text = expandInlineSkills(input.text, this.runtime.session.resourceLoader.getSkills().skills);
		await this.runtime.session.steer(text);
	}

	async abort(): Promise<void> {
		await this.runtime.session.abort();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribePi?.();
		this.unsubscribePi = undefined;
		this.listeners.clear();
		await this.runtime.dispose();
	}

	getStatus(): AgentRuntimeStatus {
		const session = this.runtime.session;
		const model = session.model;
		const contextUsage = session.getContextUsage();
		return {
			streaming: this.disposed ? false : session.isStreaming,
			enabledTools: session.getActiveToolNames(),
			cwd: this.cwd,
			...(model ? { activeModel: { provider: model.provider, id: model.id } } : {}),
			reasoning: {
				value: session.thinkingLevel,
				availableValues: session.getAvailableThinkingLevels(),
				supported: session.supportsThinking(),
			},
			contextUsage: contextUsage
				? {
					tokens: contextUsage.tokens ?? undefined,
					contextWindow: contextUsage.contextWindow ?? undefined,
					percent: contextUsage.percent ?? undefined,
				}
				: contextUsage,
		};
	}

	async getStatusSnapshot(): Promise<AgentRuntimeStatus> {
		const status = this.getStatus();
		let providerUsage: AgentRuntimeStatus["providerUsage"];
		try {
			providerUsage = await getOpenAiCodexProviderUsageForActiveModel(status.activeModel);
		} catch {
			providerUsage = undefined;
		}
		return { ...status, ...(providerUsage ? { providerUsage } : {}) };
	}

	getNativeCompatibilityHandle(): AgentSessionRuntime {
		return this.compatibilityHandle;
	}

	private createCompatibilityHandle(): AgentSessionRuntime {
		return new Proxy(this.runtime, {
			get: (target, property, receiver) => {
				if (property === "dispose") return () => this.dispose();
				if (property === "setRebindSession") {
					return (listener: Parameters<AgentSessionRuntime["setRebindSession"]>[0]) => {
						target.setRebindSession(listener
							? async (session) => {
								this.bindPiSession();
								await listener(session);
							}
							: async () => this.bindPiSession());
					};
				}
				const value = Reflect.get(target, property, receiver) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}

	private bindPiSession(): void {
		this.unsubscribePi?.();
		const session = this.runtime.session;
		this.binding = {
			...this.binding,
			nativeSessionId: session.sessionId,
			state: "bound",
			locator: session.sessionFile ? { kind: "local-file", value: session.sessionFile } : undefined,
		};
		this.unsubscribePi = session.subscribe((event) => {
			const nativeType = event && typeof event === "object"
				? (event as { type?: unknown }).type
				: undefined;
			if (nativeType === "agent_start") this.emit({ type: "turn_started" });
			if (nativeType === "agent_end") this.emit({ type: "turn_completed", status: "completed" });
			const model = this.runtime.session.model as { contextWindow?: unknown } | undefined;
			const normalized = normalizePiEvent(this.piboSessionId, event, {
				contextWindow: numberValue(model?.contextWindow),
			});
			if (normalized) {
				const semantic = semanticEventFromPibo(normalized);
				if (semantic) this.emit(semantic);
			}
			if (isAssistantMessageEnd(event)) {
				const usage = normalizeAssistantUsageEvent(this.piboSessionId, event.message);
				if (usage) {
					const semantic = semanticEventFromPibo(usage);
					if (semantic) this.emit(semantic);
				}
			}
			if (event && typeof event === "object") {
				const candidate = event as { type?: unknown; reason?: unknown; result?: unknown; aborted?: unknown; errorMessage?: unknown };
				if (candidate.type === "compaction_start") {
					this.emit({
						type: "compaction_start",
						reason: typeof candidate.reason === "string" ? candidate.reason : "unknown",
					});
				} else if (candidate.type === "compaction_end") {
					this.emit({
						type: "compaction_end",
						reason: typeof candidate.reason === "string" ? candidate.reason : "unknown",
						result: candidate.result,
						aborted: candidate.aborted === true,
						errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
					});
				}
			}
			this.emit({ type: "native_event", event });
		});
	}

	private createControls(): NonNullable<AgentRuntimeSession["controls"]> {
		return {
			getCurrentSession: () => this.createSessionSnapshot(),
			listSessions: async () => {
				const manager = this.runtime.session.sessionManager;
				const sessions = await SessionManager.list(this.runtime.cwd, manager.getSessionDir());
				return sessions.map((session) => ({
					adapterId: this.adapterId,
					runtimeInstanceId: this.runtimeInstanceId,
					nativeSessionId: session.id,
					locator: { kind: "local-file" as const, value: session.path },
					cwd: session.cwd,
					name: session.name,
					parentLocator: session.parentSessionPath
						? { kind: "local-file" as const, value: session.parentSessionPath }
						: undefined,
					createdAt: session.created.toISOString(),
					updatedAt: session.modified.toISOString(),
					messageCount: session.messageCount,
					firstMessage: session.firstMessage,
				}));
			},
			getForkCandidates: () => this.runtime.session.getUserMessagesForForking(),
			forkSession: async (entryId) => {
				const previous = this.createSessionSnapshot();
				const result = await this.runtime.fork(entryId);
				return {
					previous,
					current: this.createSessionSnapshot(),
					cancelled: result.cancelled,
					selectedText: result.selectedText,
				};
			},
			cloneSession: async () => {
				const leafId = this.runtime.session.sessionManager.getLeafId();
				if (!leafId) throw new Error("Cannot clone session: no current entry selected");
				const previous = this.createSessionSnapshot();
				const result = await this.runtime.fork(leafId, { position: "at" });
				return {
					previous,
					current: this.createSessionSnapshot(),
					cancelled: result.cancelled,
				};
			},
			getSessionTree: () => ({
				current: this.createSessionSnapshot(),
				tree: normalizePiTree(this.runtime.session.sessionManager.getTree()),
			}),
			navigateSessionTree: async (params) => {
				if (typeof params.entryId !== "string") throw new Error("session tree navigation requires entryId");
				const previous = this.createSessionSnapshot();
				const result = await this.runtime.session.navigateTree(params.entryId, {
					summarize: typeof params.summarize === "boolean" ? params.summarize : undefined,
					customInstructions: typeof params.customInstructions === "string" ? params.customInstructions : undefined,
					replaceInstructions: typeof params.replaceInstructions === "boolean" ? params.replaceInstructions : undefined,
					label: typeof params.label === "string" ? params.label : undefined,
				});
				return {
					previous,
					current: this.createSessionSnapshot(),
					cancelled: result.cancelled,
					editorText: result.editorText,
					summaryEntryId: result.summaryEntry?.id,
				};
			},
			switchSession: async (params) => {
				if (typeof params.sessionFile !== "string") throw new Error("session switch requires sessionFile");
				const previous = this.createSessionSnapshot();
				const result = await this.runtime.switchSession(params.sessionFile, {
					cwdOverride: typeof params.cwdOverride === "string" ? params.cwdOverride : undefined,
				});
				return {
					previous,
					current: this.createSessionSnapshot(),
					cancelled: result.cancelled,
				};
			},
			getReasoning: () => ({
				value: this.runtime.session.thinkingLevel,
				availableValues: this.runtime.session.getAvailableThinkingLevels(),
				supported: this.runtime.session.supportsThinking(),
			}),
			setReasoning: (value) => {
				this.runtime.session.setThinkingLevel(value as Parameters<AgentSessionRuntime["session"]["setThinkingLevel"]>[0]);
				return {
					value: this.runtime.session.thinkingLevel,
					availableValues: this.runtime.session.getAvailableThinkingLevels(),
					supported: this.runtime.session.supportsThinking(),
				};
			},
			cycleReasoning: () => {
				this.runtime.session.cycleThinkingLevel();
				return {
					value: this.runtime.session.thinkingLevel,
					availableValues: this.runtime.session.getAvailableThinkingLevels(),
					supported: this.runtime.session.supportsThinking(),
				};
			},
			getFastMode: () => ({ mode: "normal", supported: false }),
			setFastMode: () => ({ mode: "normal", supported: false, changed: false }),
			setModel: async (model: ModelProfile) => {
				const resolved = this.runtime.session.modelRegistry.find(model.provider, model.id);
				if (!resolved) throw new Error(`Unknown model ${model.provider}/${model.id}`);
				await this.runtime.session.setModel(resolved);
				return { provider: resolved.provider, id: resolved.id };
			},
			compact: (customInstructions) => this.runtime.session.compact(customInstructions),
		};
	}

	private createSessionSnapshot(): AgentRuntimeNativeSessionSnapshot {
		const session = this.runtime.session;
		const manager = session.sessionManager;
		return {
			adapterId: this.adapterId,
			runtimeInstanceId: this.runtimeInstanceId,
			nativeSessionId: session.sessionId,
			locator: session.sessionFile ? { kind: "local-file", value: session.sessionFile } : undefined,
			leafId: manager.getLeafId(),
			cwd: this.runtime.cwd,
			name: session.sessionName,
			parentLocator: manager.getHeader()?.parentSession
				? { kind: "local-file", value: manager.getHeader()!.parentSession }
				: undefined,
		};
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

	constructor(
		readonly instanceId: string,
		config: PiboJsonObject,
		displayName: string | undefined,
		readonly enabled: boolean,
	) {
		this.config = structuredClone(config);
		this.displayName = displayName ?? this.descriptor.displayName;
	}

	async diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return [{
			severity: "info",
			code: "pi_runtime_available",
			message: `Pi Coding Agent SDK ${PI_PROTOCOL_VERSION} is available in-process.`,
		}];
	}

	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] {
		if (input.profile.runtimeInstanceId !== this.instanceId) {
			return [{
				severity: "error",
				code: "runtime_instance_mismatch",
				message: `Profile "${input.profile.profileName}" selects runtime instance "${input.profile.runtimeInstanceId}", not "${this.instanceId}".`,
			}];
		}
		return [];
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const compatibility = input.services?.compatibility as PiAgentRuntimeCompatibilityServices | undefined;
		const runtime = await createPiboRuntime({
			cwd: input.workspace,
			persistSession: compatibility?.persistSession,
			profile: cloneProfileForPiSession(input),
			thinkingLevel: compatibility?.thinkingLevel,
			retryDefaults: compatibility?.retryDefaults,
			extensionFactories: compatibility?.extensionFactories,
			subagentRunner: input.services?.subagentRunner as PiboSubagentRunner | undefined,
			runToolController: input.services?.runToolController as PiboRunToolController | undefined,
			runtimeToolController: input.services?.codeRuntimeToolController as PiboRuntimeToolController | undefined,
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
		const binding: RuntimeSessionBinding = {
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
		};
		return new PiAgentRuntimeSession(this.instanceId, input.piboSession.id, runtime, binding);
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
