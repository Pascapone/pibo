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
	type ContextFileProfile,
	type InitialSessionContext,
	type ModelProfile,
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
import { getPiPackageRuntimeOptions } from "../pi-packages/runtime.js";
import { getDefaultPiboWorkspace } from "./workspace.js";
import { createRuntimeToolDefinition, type PiboRuntimeToolController } from "../tools/runtime/tool.js";
import { RuntimeSessionRegistry } from "../tools/runtime/registry.js";

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
};

export type PiboProfileInspection = {
	profileName: string;
	skills: Array<{ name: string; path: string }>;
	tools: Array<{ name: string; hasDefinition: boolean; registered: boolean; active: boolean }>;
	subagents: Array<{ name: string; targetProfile: string; active: boolean }>;
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
		...profileTools.filter((tool) => tool.yieldable !== false).map((tool) => tool.definition),
		...(runtimeTool && runtimeProfileTool?.yieldable !== false ? [runtimeTool] : []),
		...subagentTools,
		...codexCompatTools,
	];
	const runTools = runControlEnabled && runToolController && yieldableTools.length > 0
		? createRunToolDefinitions(yieldableTools, runToolController)
		: [];

	return [
		...(runControlBashTool ? [runControlBashTool] : []),
		...profileTools.map((tool) => tool.definition),
		...(runtimeTool ? [runtimeTool] : []),
		...subagentTools,
		...codexCompatTools,
		...runTools,
	];
}

function hasEnabledToolDefinition(tool: ToolProfile): tool is ToolProfile & { definition: ToolDefinition } {
	return tool.enabled !== false && tool.definition !== undefined;
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
	const providerToolExtensions = profile.tools
		.filter((tool) => tool.enabled !== false)
		.filter(isWebSearchProviderTool)
		.map((tool) => createWebSearchProviderExtension(tool.providerTool));
	if (profile.toolPackages.codexCompat !== true) {
		return [
			piboPromptTemplateExtension,
			piboCompactionPromptExtension,
			...providerToolExtensions,
			...(extensionFactories ?? []),
		];
	}
	return [
		piboPromptTemplateExtension,
		piboCompactionPromptExtension,
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
							...contextFiles,
							...(installedToolContextFile ? [installedToolContextFile] : []),
							...(mcpAgentContextFile ? [mcpAgentContextFile] : []),
						],
					),
				}),
			},
		});
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
				void localRuntimeRegistry.closeOwnerSessions(profile.sessionId ?? "local", { force: true });
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
	const hasEnabledSubagents = profile.subagents.some((subagent) => subagent.enabled !== false);
	const hasYieldableTools =
		profile.toolPackages.runControl === true ||
		hasEnabledSubagents ||
		profile.tools.some((tool) => tool.enabled !== false && tool.definition !== undefined && tool.yieldable !== false);
	const runtime = await createPiboRuntime({
		cwd,
		profile,
		persistSession: false,
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
			skills: resourceLoader.getSkills().skills.map((skill) => ({
				name: skill.name,
				path: skill.filePath,
			})),
			tools: profile.tools.map((tool) => ({
				name: tool.name,
				hasDefinition: Boolean(tool.definition) || isRuntimeTool(tool),
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
