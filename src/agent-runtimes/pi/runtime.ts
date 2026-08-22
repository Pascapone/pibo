import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createBashToolDefinition,
	getAgentDir,
	InteractiveMode,
	ModelRegistry,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type CreateAgentSessionRuntimeFactory,
	type ExtensionFactory,
	type ResourceDiagnostic,
	type RetrySettings,
} from "@earendil-works/pi-coding-agent";
import type { PiboJsonObject } from "../../core/events.js";
import {
	DEFAULT_BUILTIN_TOOL_NAMES,
	InitialSessionContext,
	type ContextFileProfile,
	type ModelProfile,
	type ToolDefinitionContext,
} from "../../core/profiles.js";
import { loadPiboModelDefaults, selectRequestedModelProfile, selectRequestedThinkingLevel, type PiboModelDefaults } from "../../core/model-defaults.js";
import { createDefaultPiboProfile } from "../../core/default-profile.js";
import {
	createSubagentToolName,
	type PiboSubagentRunner,
} from "../../subagents/tool.js";
import type { PiboRunToolController } from "../../runs/tools.js";
import type { PiboThinkingLevel } from "../../core/thinking.js";
import { getInstalledCliToolContextFile } from "../../tools/registry.js";
import { createCodexCompatExtension } from "../../core/codex-compat.js";
import { createWebSearchProviderExtension, isWebSearchProviderTool } from "../../tools/web-search.js";
import { getMcpAgentContextFile } from "../../mcp/agent-context.js";
import { createPiboSystemPromptTemplateExtension } from "../../core/system-prompt-template.js";
import { getActivePiboBasePromptPath } from "../../core/base-prompt.js";
import { createPiboCompactionPromptExtension } from "../../core/compaction-prompt.js";
import {
	cancelPiboAssistantContextGuardRecovery,
	createPiboAssistantContextGuardExtension,
	createPiboAssistantContextGuardRecovery,
	isPiboAssistantContextGuardRecoveryPending,
	registerPiboAssistantContextGuardRecovery,
	type PiboAssistantContextGuardRecovery,
} from "../../core/context-guard.js";
import { getPiPackageRuntimeOptions } from "../../pi-packages/runtime.js";
import { getDefaultPiboWorkspace } from "../../core/workspace.js";
import { DEFAULT_USER_TIMEZONE } from "../../core/user-settings.js";
import { registerMiniMaxProvider, type MiniMaxModelRegistryLike } from "../../providers/minimax.js";
import { registerGlmProvider, type GlmModelRegistryLike } from "../../providers/glm.js";
import { registerQwenTokenPlanProvider, type QwenTokenPlanModelRegistryLike } from "../../providers/qwen-token-plan.js";
import { registerOpenAiGpt56Models, type OpenAiGpt56ModelRegistryLike } from "../../providers/openai-gpt56.js";
import { PIBO_APP_CONTEXT } from "../../app-context.js";
import type { PiboRuntimeToolController } from "../../tools/runtime/tool.js";
import { RuntimeSessionRegistry } from "../../tools/runtime/registry.js";
import { CodexBrowserSessionController } from "../../tools/codex-browser.js";
import { compactValidationToolResultForContext } from "../../core/test-output-compaction.js";
import { installPiboTranscriptIntegrity } from "../../core/transcript-integrity.js";
import {
	normalizePiboToolDefinition,
	type LegacyPiToolDefinitionLike,
	type PiboToolDefinition,
} from "../../tools/contract.js";
import { compilePiboToolForPi } from "./tool-compiler.js";
import { installPiIntentTracing, piIntentTracingEnabled } from "./intent-tracing.js";
import type { PiboPortableToolSession } from "../../tools/session-service.js";
import type {
	AgentRuntimeDeliveryReport,
	AgentRuntimeExternalMcpServerInspection,
	PiboRuntimeResourceSession,
} from "../../agent-runtime/resources.js";
import {
	createPiboSessionToolDefinitions,
	isCodexBrowserToolProfile as isCodexBrowserTool,
	isEnabledCodexBrowserToolProfile as isEnabledCodexBrowserTool,
	isEnabledRuntimeToolProfile as isEnabledRuntimeTool,
	isGeneratedPiboTool,
	isRuntimeToolProfile as isRuntimeTool,
} from "../../tools/session-tool-set.js";

export type PiboRuntimeRetryDefaults = Readonly<Pick<RetrySettings, "enabled" | "maxRetries" | "baseDelayMs">>;

function hasOwnRetrySetting(settings: RetrySettings | undefined, key: keyof PiboRuntimeRetryDefaults): boolean {
	return settings !== undefined && settings !== null && Object.prototype.hasOwnProperty.call(settings, key);
}

export function applyPiboRuntimeRetryDefaults(
	settingsManager: SettingsManager,
	defaults: PiboRuntimeRetryDefaults | undefined,
): void {
	if (!defaults) return;
	const globalRetry = settingsManager.getGlobalSettings().retry;
	const projectRetry = settingsManager.getProjectSettings().retry;
	const overrides: RetrySettings = {};

	if (!hasOwnRetrySetting(globalRetry, "enabled") && !hasOwnRetrySetting(projectRetry, "enabled") && defaults.enabled !== undefined) {
		overrides.enabled = defaults.enabled;
	}
	if (!hasOwnRetrySetting(globalRetry, "maxRetries") && !hasOwnRetrySetting(projectRetry, "maxRetries") && defaults.maxRetries !== undefined) {
		overrides.maxRetries = defaults.maxRetries;
	}
	if (!hasOwnRetrySetting(globalRetry, "baseDelayMs") && !hasOwnRetrySetting(projectRetry, "baseDelayMs") && defaults.baseDelayMs !== undefined) {
		overrides.baseDelayMs = defaults.baseDelayMs;
	}
	if (Object.keys(overrides).length > 0) settingsManager.applyOverrides({ retry: overrides });
}

export type PiboRuntimeOptions = {
	cwd?: string;
	persistSession?: boolean;
	profile?: InitialSessionContext;
	thinkingLevel?: PiboThinkingLevel;
	/** Runtime-only retry defaults. Explicit Pi global or project settings take precedence. */
	retryDefaults?: PiboRuntimeRetryDefaults;
	/** Optional Pi model runtime override for embedded callers and deterministic tests. */
	modelRuntime?: ModelRuntime;
	extensionFactories?: ExtensionFactory[];
	subagentRunner?: PiboSubagentRunner;
	runToolController?: PiboRunToolController;
	runtimeToolController?: PiboRuntimeToolController;
	/** Router-owned portable tool scope shared with external-harness MCP delivery. */
	portableTools?: PiboPortableToolSession;
	/** Router-owned selected skills, context, and external MCP generation scope. */
	resources?: PiboRuntimeResourceSession;
	/** Product-level model defaults selected outside the workspace, e.g. Chat Web settings. */
	modelDefaults?: PiboModelDefaults;
	/** SessionStore-persisted model. Routed sessions must prefer this over current defaults. */
	activeModel?: ModelProfile;
	/** Product metadata that is always injected into runtime context. */
	sessionContext?: PiboRuntimeSessionContext;
	/** Keep direct-TUI input behind context-guard continuation turns. */
	contextGuardTuiQueueOrdering?: boolean;
};

export type PiboRuntimeSessionContext = {
	piboSessionId?: string;
	piboRoomId?: string;
	timezone?: string;
	getActiveMessage?: ToolDefinitionContext["getActiveMessage"];
};

export type PiboProfileInspection = {
	profileName: string;
	runtimeInstanceId: string;
	runtimeOptions: PiboJsonObject;
	model?: ModelProfile;
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	mainThinkingLevel?: PiboThinkingLevel;
	subagentThinkingLevel?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools: InitialSessionContext["builtinTools"];
	builtinToolNames: readonly string[];
	autoContextFiles: boolean;
	nativeSubagents?: boolean;
	toolPackages: InitialSessionContext["toolPackages"];
	skills: Array<{ name: string; path: string }>;
	tools: Array<{ name: string; hasDefinition: boolean; registered: boolean; active: boolean }>;
	subagents: Array<{ name: string; targetProfile: string; active: boolean }>;
	mcpServers: string[];
	mcpStatus: AgentRuntimeExternalMcpServerInspection[];
	resourceDelivery: AgentRuntimeDeliveryReport[];
	piPackages: Array<{ id: string; active: boolean }>;
	contextFiles: Array<{ path: string; bytes: number }>;
	diagnostics: AgentSessionRuntimeDiagnostic[];
};

function resolveProfilePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

async function loadContextFiles(
	cwd: string,
	contextFiles: readonly ContextFileProfile[],
): Promise<Array<{ path: string; content: string }>> {
	const loaded: Array<{ path: string; content: string }> = [];

	for (const contextFile of contextFiles) {
		if (contextFile.enabled === false) continue;

		const path = resolveProfilePath(cwd, contextFile.path);
		const content = await readFile(path, "utf-8");
		loaded.push({ path, content });
	}

	return loaded;
}

function createSessionContextFile(context: PiboRuntimeSessionContext | undefined): { path: string; content: string } {
	const piboSessionId = context?.piboSessionId?.trim() || "unknown";
	const piboRoomId = context?.piboRoomId?.trim() || "unknown";
	const timezone = context?.timezone?.trim() || DEFAULT_USER_TIMEZONE;
	return {
		path: "pibo://runtime/session-context.md",
		content: [
			"# Pibo Runtime Context",
			"",
			`- App context: ${PIBO_APP_CONTEXT.id}`,
			`- Pibo Session ID: ${piboSessionId}`,
			`- Pibo Room ID: ${piboRoomId}`,
			`- User timezone: ${timezone}`,
			"",
			"Login identity gates app access only. Use the Pibo Session ID or Room ID when scheduling jobs, correlating events, or referring to the current session or room.",
		].join("\n"),
	};
}

function contextFileIdentity(path: string): string {
	if (path.includes("://")) return path;
	let canonical: string;
	try {
		canonical = realpathSync(path);
	} catch {
		canonical = resolve(path);
	}
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function mergeContextFiles(
	base: Array<{ path: string; content: string }>,
	additional: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
	const seen = new Set<string>();
	const merged: Array<{ path: string; content: string }> = [];

	for (const contextFile of [...base, ...additional]) {
		const identity = contextFileIdentity(contextFile.path);
		if (seen.has(identity)) continue;
		seen.add(identity);
		merged.push(contextFile);
	}

	return merged;
}

function collectResourceDiagnostics(resourceDiagnostics: ResourceDiagnostic[]): AgentSessionRuntimeDiagnostic[] {
	return resourceDiagnostics.map((diagnostic) => ({
		type: diagnostic.type === "collision" ? "warning" : diagnostic.type,
		message: diagnostic.path ? `${diagnostic.path}: ${diagnostic.message}` : diagnostic.message,
	}));
}

function getEnabledSkillPaths(cwd: string, profile: InitialSessionContext): string[] {
	return profile.skills
		.filter((skill) => skill.enabled !== false)
		.map((skill) => resolveProfilePath(cwd, skill.path));
}

function getBuiltinToolAllowlist(profile: InitialSessionContext, customTools: readonly PiboToolDefinition[]): string[] | undefined {
	if (profile.builtinTools === "disabled") return undefined;
	const defaultBuiltinTools = new Set<string>(DEFAULT_BUILTIN_TOOL_NAMES);
	const selectedBuiltinTools = profile.builtinToolNames.filter((name) => defaultBuiltinTools.has(name));
	if (selectedBuiltinTools.length === DEFAULT_BUILTIN_TOOL_NAMES.length) return undefined;
	return [...selectedBuiltinTools, ...customTools.map((tool) => tool.name)];
}

function getProfileExtensionFactories(
	profile: InitialSessionContext,
	extensionFactories: readonly ExtensionFactory[] | undefined,
	contextGuardRecovery: PiboAssistantContextGuardRecovery,
	getSettingsManager: () => SettingsManager | undefined,
): ExtensionFactory[] | undefined {
	const piboPromptTemplateExtension = createPiboSystemPromptTemplateExtension();
	const piboCompactionPromptExtension = createPiboCompactionPromptExtension({ getSettingsManager });
	const piboContextGuardExtension = createPiboAssistantContextGuardExtension({}, contextGuardRecovery);
	const providerToolExtensions = profile.tools
		.filter((tool) => tool.enabled !== false)
		.filter(isWebSearchProviderTool)
		.map((tool) => createWebSearchProviderExtension(tool.providerTool));
	if (profile.toolPackages.codexCompat !== true) {
		return [
			piboPromptTemplateExtension,
			piboCompactionPromptExtension,
			piboContextGuardExtension,
			...providerToolExtensions,
			...(extensionFactories ?? []),
		];
	}
	return [
		piboPromptTemplateExtension,
		piboCompactionPromptExtension,
		piboContextGuardExtension,
		createCodexCompatExtension({
			isChildSession: profile.parentSessionId !== undefined,
		}),
		...providerToolExtensions,
		...(extensionFactories ?? []),
	];
}

function createInspectionSubagentRunner(): PiboSubagentRunner {
	return {
		async runSubagent() {
			throw new Error("Profile inspection cannot execute subagents");
		},
	};
}

function createInspectionRunToolController(): PiboRunToolController {
	const fail = () => {
		throw new Error("Profile inspection cannot execute run-control tools");
	};
	return {
		startToolRun: fail,
		listRuns: () => [],
		getRunStatus: fail,
		waitForRun: fail,
		readRun: fail,
		cancelRun: fail,
		ackRun: fail,
	};
}

async function createSessionManager(
	cwd: string,
	profile: InitialSessionContext,
	persistSession: boolean,
): Promise<SessionManager> {
	if (persistSession && profile.sessionId) {
		const existing = (await SessionManager.list(cwd)).find((session) => session.id === profile.sessionId);
		if (existing) return SessionManager.open(existing.path, undefined, cwd);
	}

	const sessionManager = persistSession ? SessionManager.create(cwd) : SessionManager.inMemory(cwd);

	if (profile.sessionId) {
		sessionManager.newSession({ id: profile.sessionId, parentSession: profile.parentSessionId });
	}

	return sessionManager;
}

export async function createPiboRuntime(options: PiboRuntimeOptions = {}): Promise<AgentSessionRuntime> {
	const cwd = options.cwd ?? getDefaultPiboWorkspace();
	const profile = options.profile ?? createDefaultPiboProfile();
	const agentDir = getAgentDir();
	const sessionManager = await createSessionManager(cwd, profile, options.persistSession !== false);

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSessionManager,
		sessionStartEvent,
	}) => {
		const contextGuardRecovery = createPiboAssistantContextGuardRecovery();
		const resourceContextFiles = options.resources?.getContextContributions()
			.flatMap((contribution) => contribution.content === undefined || contribution.nativeDiscovered ? [] : [{
				path: contribution.sourcePath ?? contribution.path ?? contribution.materializedPath ?? contribution.id,
				content: contribution.content,
			}]);
		const contextFiles = resourceContextFiles ?? await loadContextFiles(runtimeCwd, profile.contextFiles);
		const sessionContextFile = options.resources
			? undefined
			: createSessionContextFile({ piboSessionId: profile.sessionId, ...options.sessionContext });
		const installedToolContextFile = options.resources ? undefined : getInstalledCliToolContextFile();
		const mcpAgentContextFile = options.resources ? undefined : await getMcpAgentContextFile(profile.mcpServers);
		const skillPaths = options.resources
			? [...options.resources.getSkillPaths("source")]
			: getEnabledSkillPaths(runtimeCwd, profile);
		const piPackageOptions = getPiPackageRuntimeOptions(runtimeCwd, profile);
		let runtimeSettingsManager: SettingsManager | undefined;
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			modelRuntime: options.modelRuntime,
			resourceLoaderOptions: {
				...piPackageOptions.resourceLoaderOptions,
				additionalSkillPaths: skillPaths,
				extensionFactories: getProfileExtensionFactories(
					profile,
					options.extensionFactories,
					contextGuardRecovery,
					() => runtimeSettingsManager,
				),
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: profile.autoContextFiles === false,
				systemPrompt: getActivePiboBasePromptPath(runtimeCwd),
				agentsFilesOverride: (base) => ({
					agentsFiles: mergeContextFiles(
						base.agentsFiles,
						[
							...(sessionContextFile ? [sessionContextFile] : []),
							...contextFiles,
							...(installedToolContextFile ? [installedToolContextFile] : []),
							...(mcpAgentContextFile ? [mcpAgentContextFile] : []),
						],
					),
				}),
			},
		});
		runtimeSettingsManager = services.settingsManager;
		applyPiboRuntimeRetryDefaults(services.settingsManager, options.retryDefaults);
		const modelRegistry = new ModelRegistry(services.modelRuntime);
		registerOpenAiGpt56Models(modelRegistry as OpenAiGpt56ModelRegistryLike);
		registerMiniMaxProvider(modelRegistry as MiniMaxModelRegistryLike);
		registerGlmProvider(modelRegistry as GlmModelRegistryLike);
		registerQwenTokenPlanProvider(modelRegistry as QwenTokenPlanModelRegistryLike);
		const ownsLocalRuntimeRegistry = options.runtimeToolController === undefined && profile.tools.some(isEnabledRuntimeTool);
		const localRuntimeRegistry = ownsLocalRuntimeRegistry ? new RuntimeSessionRegistry({ cwd: runtimeCwd }) : undefined;
		const runtimeToolController = options.runtimeToolController
			?? localRuntimeRegistry?.createController(profile.sessionId ?? "local");
		const codexBrowserController = profile.tools.some(isEnabledCodexBrowserTool)
			? new CodexBrowserSessionController({
				cwd: runtimeCwd,
				piboSessionId: options.sessionContext?.piboSessionId ?? profile.sessionId ?? runtimeSessionManager.getSessionId(),
			})
			: undefined;
		const toolContext: ToolDefinitionContext = {
			piboSessionId: options.sessionContext?.piboSessionId ?? profile.sessionId,
			piboRoomId: options.sessionContext?.piboRoomId,
			profileName: profile.profileName,
			cwd: runtimeCwd,
			getActiveMessage: options.sessionContext?.getActiveMessage,
			getConversationEntries: () => runtimeSessionManager.getBranch(),
		};
		const adapterEnvironment = options.resources?.getAdapterEnvironment() ?? {};
		const hasAdapterEnvironment = Object.keys(adapterEnvironment).length > 0;
		const profileEnablesBash = profile.builtinTools !== "disabled" && profile.builtinToolNames.includes("bash");
		const needsPiBashOverride = (
			profile.toolPackages.runControl === true && options.runToolController !== undefined
		) || (hasAdapterEnvironment && profileEnablesBash);
		const piNativeYieldableTools = needsPiBashOverride
			? [normalizePiboToolDefinition(createBashToolDefinition(runtimeCwd, {
				commandPrefix: services.settingsManager.getShellCommandPrefix(),
				shellPath: services.settingsManager.getShellPath(),
				...(hasAdapterEnvironment
					? {
						spawnHook: (context) => ({
							...context,
							env: { ...context.env, ...adapterEnvironment },
						}),
					}
					: {}),
			}) as unknown as LegacyPiToolDefinitionLike)]
			: [];
		options.portableTools?.configureControllers({ codexBrowserController });
		options.portableTools?.setConversationEntriesProvider(() => runtimeSessionManager.getBranch());
		const piboToolDefinitions = options.portableTools
			? options.portableTools.createDefinitions({ nativeYieldableTools: piNativeYieldableTools })
			: createPiboSessionToolDefinitions({
				profile,
				toolContext,
				subagentRunner: options.subagentRunner,
				runToolController: options.runToolController,
				runtimeToolController,
				codexBrowserController,
				nativeYieldableTools: piNativeYieldableTools,
			});
		const customTools = piboToolDefinitions.map((definition) => compilePiboToolForPi(definition, {
			...toolContext,
			runtimeInstanceId: profile.runtimeInstanceId,
			sessionGeneration: options.resources?.sessionGeneration ?? options.portableTools?.sessionGeneration,
		}));
		const modelDefaults = options.modelDefaults ?? loadPiboModelDefaults(runtimeCwd);

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
			model: resolveProfileModel(profile, modelRegistry, runtimeCwd, modelDefaults, options.activeModel),
			thinkingLevel: options.thinkingLevel ?? selectRequestedThinkingLevel(profile, modelDefaults),
			customTools,
			noTools: profile.builtinTools === "disabled" ? "builtin" : undefined,
			tools: getBuiltinToolAllowlist(profile, piboToolDefinitions),
		});

		if (piIntentTracingEnabled(profile.runtimeOptions)) installPiIntentTracing(created.session);
		installPiboTranscriptIntegrity(created.session);
		installValidationOutputCompaction(created.session.agent);
		registerPiboAssistantContextGuardRecovery(created.session, contextGuardRecovery);
		if (options.contextGuardTuiQueueOrdering === true) {
			installPiboContextGuardTuiQueueOrdering(created.session);
		}

		const resourceLoader = services.resourceLoader;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...piPackageOptions.diagnostics,
			...services.diagnostics,
			...collectResourceDiagnostics(resourceLoader.getSkills().diagnostics),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];

		const originalDispose = created.session.dispose.bind(created.session);
		created.session.dispose = () => {
			cancelPiboAssistantContextGuardRecovery(
				created.session,
				new Error("Context guard recovery cancelled because the Pi session was disposed"),
			);
			if (localRuntimeRegistry) {
				void localRuntimeRegistry.closeControllerSessions(profile.sessionId ?? "local", { force: true });
			}
			void codexBrowserController?.dispose();
			originalDispose();
		};

		return {
			...created,
			services,
			diagnostics,
		};
	};

	return createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager,
	});
}

type PiboAgentWithAfterToolCall = {
	afterToolCall?: (context: Parameters<typeof compactValidationToolResultForContext>[0], signal?: AbortSignal) => Promise<unknown> | unknown;
};

function installValidationOutputCompaction(agent: unknown): void {
	const target = agent as PiboAgentWithAfterToolCall | undefined;
	if (!target) return;
	const previous = target.afterToolCall;
	target.afterToolCall = async (context, signal) => {
		const prior = await previous?.(context, signal);
		const mergedContext = mergePriorAfterToolCallResult(context, prior);
		return compactValidationToolResultForContext(mergedContext) ?? prior;
	};
}

function mergePriorAfterToolCallResult(
	context: Parameters<typeof compactValidationToolResultForContext>[0],
	prior: unknown,
): Parameters<typeof compactValidationToolResultForContext>[0] {
	if (!prior || typeof prior !== "object" || Array.isArray(prior)) return context;
	const replacement = prior as { content?: unknown; details?: unknown; isError?: unknown; terminate?: unknown };
	return {
		...context,
		isError: typeof replacement.isError === "boolean" ? replacement.isError : context.isError,
		result: {
			...context.result,
			content: Array.isArray(replacement.content) ? replacement.content as typeof context.result.content : context.result.content,
			details: replacement.details !== undefined ? replacement.details : context.result.details,
			terminate: typeof replacement.terminate === "boolean" ? replacement.terminate : context.result.terminate,
		},
	};
}

function resolveProfileModel(
	profile: InitialSessionContext,
	modelRegistry: ModelRegistry,
	cwd: string,
	modelDefaults?: PiboModelDefaults,
	activeModel?: ModelProfile,
) {
	const requestedModel = activeModel ? { ...activeModel } : selectRequestedModelProfile(profile, modelDefaults ?? loadPiboModelDefaults(cwd));
	if (!requestedModel) return undefined;

	const model = modelRegistry.find(requestedModel.provider, requestedModel.id);
	if (!model) {
		throw new Error(
			`Profile "${profile.profileName}" requests unknown model ${requestedModel.provider}/${requestedModel.id}.`,
		);
	}

	if (!modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(
			`Profile "${profile.profileName}" requires configured auth for ${requestedModel.provider}/${requestedModel.id}.`,
		);
	}

	return model;
}

export async function inspectPiboProfile(options: PiboRuntimeOptions = {}): Promise<PiboProfileInspection> {
	const cwd = options.cwd ?? process.cwd();
	const profile = options.profile ?? createDefaultPiboProfile();
	const runtimeProfile = new InitialSessionContext({
		profileName: profile.profileName,
		runtimeInstanceId: profile.runtimeInstanceId,
		runtimeOptions: profile.runtimeOptions,
		sessionId: profile.sessionId,
		parentSessionId: profile.parentSessionId,
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
	const hasEnabledSubagents = profile.subagents.some((subagent) => subagent.enabled !== false);
	const hasYieldableTools =
		profile.toolPackages.runControl === true ||
		hasEnabledSubagents ||
		profile.tools.some((tool) => tool.enabled !== false && (tool.definition !== undefined || tool.createDefinition !== undefined) && tool.yieldable !== false);
	const runtime = await createPiboRuntime({
		cwd,
		...options,
		profile: runtimeProfile,
		persistSession: false,
		modelDefaults: {},
		activeModel: undefined,
		subagentRunner: options.subagentRunner ?? (hasEnabledSubagents ? createInspectionSubagentRunner() : undefined),
		runToolController:
			options.runToolController ?? (hasYieldableTools ? createInspectionRunToolController() : undefined),
	});

	try {
		const resourceLoader = runtime.services.resourceLoader;
		const activeToolNames = new Set(runtime.session.getActiveToolNames());
		const registeredToolNames = new Set(runtime.session.getAllTools().map((tool) => tool.name));
		const profileToolNames = new Set(profile.tools.map((tool) => tool.name));
		const generatedTools = runtime.session
			.getAllTools()
			.filter((tool) => isGeneratedPiboTool(tool.name) && !profileToolNames.has(tool.name))
			.map((tool) => ({
				name: tool.name,
				hasDefinition: true,
				registered: true,
				active: activeToolNames.has(tool.name),
			}));

		return {
			profileName: profile.profileName,
			runtimeInstanceId: profile.runtimeInstanceId,
			runtimeOptions: structuredClone(profile.runtimeOptions),
			...(profile.model ? { model: { ...profile.model } } : {}),
			...(profile.mainModel ? { mainModel: { ...profile.mainModel } } : {}),
			...(profile.subagentModel ? { subagentModel: { ...profile.subagentModel } } : {}),
			...(profile.thinkingLevel ? { thinkingLevel: profile.thinkingLevel } : {}),
			...(profile.mainThinkingLevel ? { mainThinkingLevel: profile.mainThinkingLevel } : {}),
			...(profile.subagentThinkingLevel ? { subagentThinkingLevel: profile.subagentThinkingLevel } : {}),
			...(profile.fast !== undefined ? { fast: profile.fast } : {}),
			...(profile.mainFast !== undefined ? { mainFast: profile.mainFast } : {}),
			...(profile.subagentFast !== undefined ? { subagentFast: profile.subagentFast } : {}),
			builtinTools: profile.builtinTools,
			builtinToolNames: [...profile.builtinToolNames],
			autoContextFiles: profile.autoContextFiles,
			nativeSubagents: profile.nativeSubagents,
			toolPackages: { ...profile.toolPackages },
			skills: resourceLoader.getSkills().skills.map((skill) => ({
				name: skill.name,
				path: skill.filePath,
			})),
			tools: profile.tools.map((tool) => ({
				name: tool.name,
				hasDefinition: Boolean(tool.definition) || Boolean(tool.createDefinition) || isRuntimeTool(tool) || isCodexBrowserTool(tool),
				registered: registeredToolNames.has(tool.name) || tool.providerTool !== undefined || isRuntimeTool(tool) || isCodexBrowserTool(tool),
				active: activeToolNames.has(tool.name) || tool.providerTool !== undefined,
			})).concat(generatedTools),
			subagents: profile.subagents.map((subagent) => {
				const toolName = createSubagentToolName(subagent.name);
				return {
					name: subagent.name,
					targetProfile: subagent.targetProfile,
					active: activeToolNames.has(toolName),
				};
			}),
			mcpServers: [...profile.mcpServers],
			mcpStatus: options.resources?.getInspection().mcpServers.map((server) => structuredClone(server)) ?? [],
			resourceDelivery: options.resources?.getInspection().delivery.map((report) => ({ ...report })) ?? [],
			piPackages: profile.piPackages.map((pkg) => ({
				id: pkg.id,
				active: pkg.enabled !== false,
			})),
			contextFiles: resourceLoader.getAgentsFiles().agentsFiles.map((contextFile) => ({
				path: contextFile.path,
				bytes: Buffer.byteLength(contextFile.content, "utf-8"),
			})),
			diagnostics: [...runtime.diagnostics],
		};
	} finally {
		await runtime.dispose();
	}
}

function installPiboContextGuardTuiQueueOrdering(session: AgentSessionRuntime["session"]): void {
	const originalSubscribe = session.subscribe.bind(session);
	const originalPrompt = session.prompt.bind(session);
	const originalSteer = session.steer.bind(session);

	session.subscribe = ((listener) => originalSubscribe((event) => {
		if (
			event.type === "compaction_end"
			&& event.result
			&& isPiboAssistantContextGuardRecoveryPending(session)
		) {
			listener({ ...event, willRetry: true });
			return;
		}
		listener(event);
	})) as typeof session.subscribe;

	session.prompt = async (text, options) => {
		if (isPiboAssistantContextGuardRecoveryPending(session)) {
			if (!session.isStreaming) {
				await session.followUp(text, options?.images);
				options?.preflightResult?.(true);
				return;
			}
			await originalPrompt(text, { ...options, streamingBehavior: "followUp" });
			return;
		}
		await originalPrompt(text, options);
	};

	session.steer = async (text, images) => {
		if (isPiboAssistantContextGuardRecoveryPending(session)) {
			await session.followUp(text, images);
			return;
		}
		await originalSteer(text, images);
	};

}

export async function runPiboTui(options: PiboRuntimeOptions = {}): Promise<void> {
	const profile = options.profile ?? createDefaultPiboProfile();
	const hasEnabledSubagents = profile.subagents.some((subagent) => subagent.enabled !== false);
	if (hasEnabledSubagents && (!options.subagentRunner || !options.runToolController)) {
		console.error(
			`Error: Profile "${profile.profileName}" uses subagents and requires the routed pibo runtime. ` +
				`Use "npm run tui:routed -- ${profile.profileName}" for local TUI QA.`,
		);
		process.exitCode = 1;
		return;
	}

	const runtime = await createPiboRuntime({ ...options, profile, contextGuardTuiQueueOrdering: true });

	try {
		const fatal = runtime.diagnostics.find((diagnostic) => diagnostic.type === "error");

		for (const diagnostic of runtime.diagnostics) {
			const prefix = diagnostic.type === "warning" ? "Warning" : diagnostic.type === "error" ? "Error" : "Info";
			console.error(`${prefix}: ${diagnostic.message}`);
		}

		if (fatal) {
			process.exitCode = 1;
			return;
		}

		const interactiveMode = new InteractiveMode(runtime, {
			verbose: true,
			modelFallbackMessage: runtime.modelFallbackMessage,
		});
		await interactiveMode.run();
	} finally {
		await runtime.dispose();
	}
}
