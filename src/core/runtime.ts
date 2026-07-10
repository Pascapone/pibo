import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createBashToolDefinition,
	getAgentDir,
	InteractiveMode,
	SessionManager,
	type AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type CreateAgentSessionRuntimeFactory,
	type ExtensionFactory,
	type ResourceDiagnostic,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_BUILTIN_TOOL_NAMES,
	InitialSessionContext,
	type ContextFileProfile,
	type ModelProfile,
	type ToolDefinitionContext,
	type ToolProfile,
} from "./profiles.js";
import { loadPiboModelDefaults, selectRequestedModelProfile, selectRequestedThinkingLevel, type PiboModelDefaults } from "./model-defaults.js";
import { createDefaultPiboProfile } from "../plugins/builtin.js";
import {
	createSubagentToolDefinitions,
	createSubagentToolName,
	type PiboSubagentRunner,
} from "../subagents/tool.js";
import { createRunToolDefinitions, type PiboRunToolController } from "../runs/tools.js";
import type { PiboThinkingLevel } from "./thinking.js";
import { getInstalledCliToolContextFile } from "../tools/registry.js";
import { createCodexCompatToolDefinitions } from "../tools/codex-compat.js";
import { createCodexCompatExtension } from "./codex-compat.js";
import { createWebSearchProviderExtension, isWebSearchProviderTool } from "../tools/web-search.js";
import { getMcpAgentContextFile } from "../mcp/agent-context.js";
import { createPiboSystemPromptTemplateExtension } from "./system-prompt-template.js";
import { getActivePiboBasePromptPath } from "./base-prompt.js";
import { createPiboCompactionPromptExtension } from "./compaction-prompt.js";
import { createPiboAssistantContextGuardExtension } from "./context-guard.js";
import { getPiPackageRuntimeOptions } from "../pi-packages/runtime.js";
import { getDefaultPiboWorkspace } from "./workspace.js";
import { DEFAULT_USER_TIMEZONE } from "./user-settings.js";
import { registerMiniMaxProvider, type MiniMaxModelRegistryLike } from "../providers/minimax.js";
import { registerGlmProvider, type GlmModelRegistryLike } from "../providers/glm.js";
import { registerOpenAiGpt56Models, type OpenAiGpt56ModelRegistryLike } from "../providers/openai-gpt56.js";
import { PIBO_APP_CONTEXT } from "../app-context.js";
import { createRuntimeToolDefinition, type PiboRuntimeToolController } from "../tools/runtime/tool.js";
import { RuntimeSessionRegistry } from "../tools/runtime/registry.js";
import { compactValidationToolResultForContext } from "./test-output-compaction.js";

export type PiboRuntimeOptions = {
	cwd?: string;
	persistSession?: boolean;
	profile?: InitialSessionContext;
	thinkingLevel?: PiboThinkingLevel;
	extensionFactories?: ExtensionFactory[];
	subagentRunner?: PiboSubagentRunner;
	runToolController?: PiboRunToolController;
	runtimeToolController?: PiboRuntimeToolController;
	/** Product-level model defaults selected outside the workspace, e.g. Chat Web settings. */
	modelDefaults?: PiboModelDefaults;
	/** SessionStore-persisted model. Routed sessions must prefer this over current defaults. */
	activeModel?: ModelProfile;
	/** Product metadata that is always injected into runtime context. */
	sessionContext?: PiboRuntimeSessionContext;
};

export type PiboRuntimeSessionContext = {
	piboSessionId?: string;
	piboRoomId?: string;
	timezone?: string;
};

export type PiboProfileInspection = {
	profileName: string;
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
	toolPackages: InitialSessionContext["toolPackages"];
	skills: Array<{ name: string; path: string }>;
	tools: Array<{ name: string; hasDefinition: boolean; registered: boolean; active: boolean }>;
	subagents: Array<{ name: string; targetProfile: string; active: boolean }>;
	mcpServers: string[];
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

function mergeContextFiles(
	base: Array<{ path: string; content: string }>,
	additional: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
	const seen = new Set<string>();
	const merged: Array<{ path: string; content: string }> = [];

	for (const contextFile of [...base, ...additional]) {
		if (seen.has(contextFile.path)) continue;
		seen.add(contextFile.path);
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

function getEnabledToolDefinitions(
	profile: InitialSessionContext,
	options: {
		runtimeCwd: string;
		shellCommandPrefix?: string;
		shellPath?: string;
		toolContext?: ToolDefinitionContext;
	},
	subagentRunner?: PiboSubagentRunner,
	runToolController?: PiboRunToolController,
	runtimeToolController?: PiboRuntimeToolController,
): ToolDefinition[] {
	const runtimeProfileTool = profile.tools.find(isEnabledRuntimeTool);
	const runtimeTool = runtimeProfileTool && runtimeToolController
		? createRuntimeToolDefinition(runtimeToolController)
		: undefined;
	const profileTools = profile.tools.filter((tool) => !isRuntimeTool(tool)).filter(hasEnabledToolDefinition);
	const profileToolDefinitions = profileTools.map((tool) => getToolDefinition(tool, options.toolContext));
	const codexCompatEnabled = profile.toolPackages.codexCompat === true;
	const runControlEnabled = profile.toolPackages.runControl === true;
	const runControlBashTool: ToolDefinition | undefined = runControlEnabled && runToolController
		? createBashToolDefinition(options.runtimeCwd, {
				commandPrefix: options.shellCommandPrefix,
				shellPath: options.shellPath,
			}) as unknown as ToolDefinition
		: undefined;
	const subagentTools = subagentRunner
		? createSubagentToolDefinitions(profile.subagents, subagentRunner)
		: [];
	const codexCompatTools = codexCompatEnabled
		? createCodexCompatToolDefinitions()
		: [];
	const yieldableTools = [
		...(runControlBashTool ? [runControlBashTool] : []),
		...profileTools.filter((tool) => tool.yieldable !== false).map((tool) => getToolDefinition(tool, options.toolContext)),
		...(runtimeTool && runtimeProfileTool?.yieldable !== false ? [runtimeTool] : []),
		...subagentTools,
		...codexCompatTools,
	];
	const runTools = runControlEnabled && runToolController && yieldableTools.length > 0
		? createRunToolDefinitions(yieldableTools, runToolController)
		: [];

	return [
		...(runControlBashTool ? [runControlBashTool] : []),
		...profileToolDefinitions,
		...(runtimeTool ? [runtimeTool] : []),
		...subagentTools,
		...codexCompatTools,
		...runTools,
	];
}

function hasEnabledToolDefinition(tool: ToolProfile): tool is ToolProfile & ({ definition: ToolDefinition } | { createDefinition: (context: ToolDefinitionContext) => ToolDefinition }) {
	return tool.enabled !== false && (tool.definition !== undefined || tool.createDefinition !== undefined);
}

function getToolDefinition(
	tool: ToolProfile & ({ definition: ToolDefinition } | { createDefinition: (context: ToolDefinitionContext) => ToolDefinition }),
	context: ToolDefinitionContext = {},
): ToolDefinition {
	if (tool.definition) return tool.definition;
	return tool.createDefinition!(context);
}

function isRuntimeTool(tool: ToolProfile): boolean {
	return tool.builtInPiboTool === "runtime" || tool.name === "runtime";
}

function isEnabledRuntimeTool(tool: ToolProfile): boolean {
	return tool.enabled !== false && isRuntimeTool(tool);
}

function isGeneratedPiboTool(name: string): boolean {
	return name === "runtime" || name.startsWith("pibo_subagent_") || name.startsWith("pibo_run_");
}

function getBuiltinToolAllowlist(profile: InitialSessionContext, customTools: readonly ToolDefinition[]): string[] | undefined {
	if (profile.builtinTools === "disabled") return undefined;
	const defaultBuiltinTools = new Set<string>(DEFAULT_BUILTIN_TOOL_NAMES);
	const selectedBuiltinTools = profile.builtinToolNames.filter((name) => defaultBuiltinTools.has(name));
	if (selectedBuiltinTools.length === DEFAULT_BUILTIN_TOOL_NAMES.length) return undefined;
	return [...selectedBuiltinTools, ...customTools.map((tool) => tool.name)];
}

function getProfileExtensionFactories(
	profile: InitialSessionContext,
	extensionFactories: readonly ExtensionFactory[] | undefined,
): ExtensionFactory[] | undefined {
	const piboPromptTemplateExtension = createPiboSystemPromptTemplateExtension();
	const piboCompactionPromptExtension = createPiboCompactionPromptExtension();
	const piboContextGuardExtension = createPiboAssistantContextGuardExtension();
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
	const authStorage = AuthStorage.create();

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSessionManager,
		sessionStartEvent,
	}) => {
		const contextFiles = await loadContextFiles(runtimeCwd, profile.contextFiles);
		const sessionContextFile = createSessionContextFile({ piboSessionId: profile.sessionId, ...options.sessionContext });
		const installedToolContextFile = getInstalledCliToolContextFile();
		const mcpAgentContextFile = await getMcpAgentContextFile(profile.mcpServers);
		const skillPaths = getEnabledSkillPaths(runtimeCwd, profile);
		const piPackageOptions = getPiPackageRuntimeOptions(runtimeCwd, profile);
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			authStorage,
			resourceLoaderOptions: {
				...piPackageOptions.resourceLoaderOptions,
				additionalSkillPaths: skillPaths,
				extensionFactories: getProfileExtensionFactories(profile, options.extensionFactories),
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
							sessionContextFile,
							...contextFiles,
							...(installedToolContextFile ? [installedToolContextFile] : []),
							...(mcpAgentContextFile ? [mcpAgentContextFile] : []),
						],
					),
				}),
			},
		});
		registerOpenAiGpt56Models(services.modelRegistry as OpenAiGpt56ModelRegistryLike);
		registerMiniMaxProvider(services.modelRegistry as MiniMaxModelRegistryLike);
		registerGlmProvider(services.modelRegistry as GlmModelRegistryLike);
		const ownsLocalRuntimeRegistry = options.runtimeToolController === undefined && profile.tools.some(isEnabledRuntimeTool);
		const localRuntimeRegistry = ownsLocalRuntimeRegistry ? new RuntimeSessionRegistry({ cwd: runtimeCwd }) : undefined;
		const runtimeToolController = options.runtimeToolController
			?? localRuntimeRegistry?.createController(profile.sessionId ?? "local");
		const customTools = getEnabledToolDefinitions(
			profile,
			{
				runtimeCwd,
				shellCommandPrefix: services.settingsManager.getShellCommandPrefix(),
				shellPath: services.settingsManager.getShellPath(),
				toolContext: {
					piboSessionId: options.sessionContext?.piboSessionId ?? profile.sessionId,
					piboRoomId: options.sessionContext?.piboRoomId,
				},
			},
			options.subagentRunner,
			options.runToolController,
			runtimeToolController,
		);
		const modelDefaults = options.modelDefaults ?? loadPiboModelDefaults(runtimeCwd);

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
			model: resolveProfileModel(profile, services, runtimeCwd, modelDefaults, options.activeModel),
			thinkingLevel: options.thinkingLevel ?? selectRequestedThinkingLevel(profile, modelDefaults),
			customTools,
			noTools: profile.builtinTools === "disabled" ? "builtin" : undefined,
			tools: getBuiltinToolAllowlist(profile, customTools),
		});

		installValidationOutputCompaction(created.session.agent);

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

		if (localRuntimeRegistry) {
			const originalDispose = created.session.dispose.bind(created.session);
			created.session.dispose = () => {
				void localRuntimeRegistry.closeControllerSessions(profile.sessionId ?? "local", { force: true });
				originalDispose();
			};
		}

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
	services: Awaited<ReturnType<typeof createAgentSessionServices>>,
	cwd: string,
	modelDefaults?: PiboModelDefaults,
	activeModel?: ModelProfile,
) {
	const requestedModel = activeModel ? { ...activeModel } : selectRequestedModelProfile(profile, modelDefaults ?? loadPiboModelDefaults(cwd));
	if (!requestedModel) return undefined;

	const model = services.modelRegistry.find(requestedModel.provider, requestedModel.id);
	if (!model) {
		throw new Error(
			`Profile "${profile.profileName}" requests unknown model ${requestedModel.provider}/${requestedModel.id}.`,
		);
	}

	if (!services.modelRegistry.hasConfiguredAuth(model)) {
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
			toolPackages: { ...profile.toolPackages },
			skills: resourceLoader.getSkills().skills.map((skill) => ({
				name: skill.name,
				path: skill.filePath,
			})),
			tools: profile.tools.map((tool) => ({
				name: tool.name,
				hasDefinition: Boolean(tool.definition) || Boolean(tool.createDefinition) || isRuntimeTool(tool),
				registered: registeredToolNames.has(tool.name) || tool.providerTool !== undefined || isRuntimeTool(tool),
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

	const runtime = await createPiboRuntime({ ...options, profile });

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
