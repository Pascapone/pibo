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
import { getDelegatedAgentContextFile } from "../../subagents/context.js";
import { PIBO_AGENT_TOOL_NAMES } from "../../subagents/tool.js";
import { resolvePiboSubagentRuntimeSelections } from "../../subagents/runtime-selection.js";
import { mapThinkingLevelForPi, type PiboThinkingLevel } from "../../core/thinking.js";
import { getInstalledCliToolContextFile } from "../../tools/registry.js";
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
import { pluginOnlyPiServicesOptions } from "./plugin-discovery.js";
import { getDefaultPiboWorkspace } from "../../core/workspace.js";
import { DEFAULT_USER_TIMEZONE } from "../../core/user-settings.js";
import { registerMiniMaxProvider, type MiniMaxModelRegistryLike } from "../../providers/minimax.js";
import { registerGlmProvider, type GlmModelRegistryLike } from "../../providers/glm.js";
import { registerQwenTokenPlanProvider, type QwenTokenPlanModelRegistryLike } from "../../providers/qwen-token-plan.js";
import { registerOpenAiSupplementalModels, type OpenAiSupplementalModelRegistryLike } from "../../providers/openai-gpt56.js";
import { PIBO_APP_CONTEXT } from "../../app-context.js";
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
import { createPiboSessionToolDefinitions } from "../../tools/session-tool-set.js";

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
	/** Router-owned portable tool scope shared with external-harness MCP delivery. */
	portableTools?: PiboPortableToolSession;
	/** Router-owned selected skills, context, and external MCP generation scope. */
	resources?: PiboRuntimeResourceSession;
	/** Product-level model defaults selected outside the workspace, e.g. Chat Web settings. */
	modelDefaults?: PiboModelDefaults;
	/** Resolve delegated target profiles for exact profile-inspection runtime selection. */
	subagentProfileResolver?: (profileName: string) => InitialSessionContext;
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
	mainModelFallbacks: ModelProfile[];
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
	subagents: Array<{
		name: string;
		targetProfile: string;
		configuredModel?: ModelProfile;
		effectiveModel?: ModelProfile;
		configuredThinkingLevel?: PiboThinkingLevel;
		effectiveThinkingLevel?: PiboThinkingLevel;
		active: boolean;
	}>;
	mcpServers: string[];
	mcpStatus: AgentRuntimeExternalMcpServerInspection[];
	resourceDelivery: AgentRuntimeDeliveryReport[];
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
	const replacedBuiltinTools = new Set(
		profile.tools
			.filter((tool) => tool.enabled !== false)
			.flatMap((tool) => tool.replacesBuiltinTools ?? []),
	);
	const selectedBuiltinTools = profile.builtinToolNames.filter(
		(name) => defaultBuiltinTools.has(name) && !replacedBuiltinTools.has(name),
	);
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
	const systemPromptTransformerExtension: ExtensionFactory | undefined = profile.systemPromptTransformers.length > 0
		? (pi) => {
			pi.on("before_agent_start", (event, context) => ({
				systemPrompt: profile.systemPromptTransformers.reduce((prompt, binding) => binding.transformer.transform(prompt, {
					cwd: context.cwd,
					shell: process.env.SHELL ?? "bash",
					isChildSession: profile.parentSessionId !== undefined,
				}), event.systemPrompt),
			}));
		}
		: undefined;
	return [
		piboPromptTemplateExtension,
		piboCompactionPromptExtension,
		piboContextGuardExtension,
		...(systemPromptTransformerExtension ? [systemPromptTransformerExtension] : []),
		...providerToolExtensions,
		...(extensionFactories ?? []),
	];
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
	if (profile.effectivePluginPlan && !options.resources) throw new Error("Plugin generations require a host-owned RuntimeResourceSession; legacy Pi resource discovery is not a fallback");
	if (profile.effectivePluginPlan && profile.tools.some((tool) => tool.enabled !== false && tool.providerBacked === true) && !options.portableTools) {
		throw new Error("Plugin generations with provider-backed tools require a host-owned PortableToolSession; legacy Pi tool assembly is not a fallback");
	}
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
		const delegatedAgentContextFile = options.resources
			? undefined
			: getDelegatedAgentContextFile(profile.subagents);
		const skillPaths = options.resources
			? [...options.resources.getSkillPaths("source")]
			: getEnabledSkillPaths(runtimeCwd, profile);
		let runtimeSettingsManager: SettingsManager | undefined;
		const services = await createAgentSessionServices(pluginOnlyPiServicesOptions({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			modelRuntime: options.modelRuntime,
			resourceLoaderOptions: {
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
							...(delegatedAgentContextFile ? [delegatedAgentContextFile] : []),
							...(installedToolContextFile ? [installedToolContextFile] : []),
							...(mcpAgentContextFile ? [mcpAgentContextFile] : []),
						],
					),
				}),
			},
		}));
		runtimeSettingsManager = services.settingsManager;
		applyPiboRuntimeRetryDefaults(services.settingsManager, options.retryDefaults);
		const modelRegistry = new ModelRegistry(services.modelRuntime);
		registerOpenAiSupplementalModels(modelRegistry as OpenAiSupplementalModelRegistryLike);
		registerMiniMaxProvider(modelRegistry as MiniMaxModelRegistryLike);
		registerGlmProvider(modelRegistry as GlmModelRegistryLike);
		registerQwenTokenPlanProvider(modelRegistry as QwenTokenPlanModelRegistryLike);
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
		const needsPiBashOverride = options.portableTools?.includeNativeTools === true
			|| (hasAdapterEnvironment && profileEnablesBash);
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
		options.portableTools?.setConversationEntriesProvider(() => runtimeSessionManager.getBranch());
		const piboToolDefinitions = options.portableTools
			? options.portableTools.createDefinitions({ nativeYieldableTools: piNativeYieldableTools })
			: createPiboSessionToolDefinitions({
				profile,
				toolContext,
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
			thinkingLevel: mapThinkingLevelForPi(options.thinkingLevel ?? selectRequestedThinkingLevel(profile, modelDefaults)),
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
			...profile.diagnostics.map((diagnostic) => ({
				type: diagnostic.severity,
				message: `[${diagnostic.code}] ${diagnostic.message}`,
			})),
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
	const inspectionModelDefaults = options.modelDefaults ?? loadPiboModelDefaults(cwd);

	const activeToolNames = new Set(options.portableTools?.getDefinitions().map((tool) => tool.name) ?? []);
	const selectedToolNames = new Set(profile.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name));
	const registeredToolNames = new Set([...activeToolNames, ...selectedToolNames]);
	const hasDelegatedAgents = profile.subagents.some((subagent) => subagent.enabled !== false);
	const generatedTools: PiboProfileInspection["tools"] = hasDelegatedAgents
		? PIBO_AGENT_TOOL_NAMES.map((name) => ({ name, hasDefinition: true, registered: true, active: true }))
		: [];

		return {
			profileName: profile.profileName,
			runtimeInstanceId: profile.runtimeInstanceId,
			runtimeOptions: structuredClone(profile.runtimeOptions),
			...(profile.model ? { model: { ...profile.model } } : {}),
			...(profile.mainModel ? { mainModel: { ...profile.mainModel } } : {}),
			mainModelFallbacks: profile.mainModelFallbacks.map((model) => ({ ...model })),
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
			skills: profile.skills.filter((skill) => skill.enabled !== false).map((skill) => ({ name: skill.name, path: skill.path })),
			tools: profile.tools.map((tool) => ({
				name: tool.name,
				hasDefinition: Boolean(tool.definition) || Boolean(tool.createDefinition) || tool.providerBacked === true,
				registered: registeredToolNames.has(tool.name) || tool.providerTool !== undefined || tool.providerBacked === true,
				active: tool.direct !== false
					&& (activeToolNames.has(tool.name) || selectedToolNames.has(tool.name) || tool.providerTool !== undefined),
			})).concat(generatedTools),
			subagents: resolvePiboSubagentRuntimeSelections(
				profile.subagents,
				options.subagentProfileResolver,
				inspectionModelDefaults,
			).map(({ enabled, ...subagent }) => ({
				...subagent,
				active: enabled,
			})),
			mcpServers: [...profile.mcpServers],
			mcpStatus: options.resources?.getInspection().mcpServers.map((server) => structuredClone(server)) ?? [],
			resourceDelivery: options.resources?.getInspection().delivery.map((report) => ({ ...report })) ?? [],
			contextFiles: options.resources
				? options.resources.getContextContributions().map((file) => ({ path: file.path ?? file.sourcePath ?? file.id, bytes: file.byteSize ?? 0 }))
				: profile.contextFiles.filter((file) => file.enabled !== false).map((file) => ({ path: file.path, bytes: 0 })),
			diagnostics: [
				...profile.diagnostics.map((diagnostic) => ({
					type: diagnostic.severity,
					message: `[${diagnostic.code}] ${diagnostic.message}`,
				})),
				{ type: "warning", message: "Read-only declared profile preview; dynamic tool factories, MCP and runtime creation were not executed." },
			],
		};
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
