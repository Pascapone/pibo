import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
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
	type ContextFileProfile,
	type InitialSessionContext,
	type ToolProfile,
} from "./profiles.js";
import { createDefaultPiboProfile } from "../plugins/builtin.js";

export type PiboRuntimeOptions = {
	cwd?: string;
	persistSession?: boolean;
	profile?: InitialSessionContext;
	extensionFactories?: ExtensionFactory[];
};

export type PiboProfileInspection = {
	profileName: string;
	skills: Array<{ name: string; path: string }>;
	tools: Array<{ name: string; hasDefinition: boolean; registered: boolean; active: boolean }>;
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

function getEnabledToolDefinitions(profile: InitialSessionContext): ToolDefinition[] {
	return profile.tools.filter(hasEnabledToolDefinition).map((tool) => tool.definition);
}

function hasEnabledToolDefinition(tool: ToolProfile): tool is ToolProfile & { definition: ToolDefinition } {
	return tool.enabled !== false && tool.definition !== undefined;
}

function createSessionManager(cwd: string, profile: InitialSessionContext, persistSession: boolean): SessionManager {
	const sessionManager = persistSession ? SessionManager.create(cwd) : SessionManager.inMemory(cwd);

	if (profile.sessionId) {
		sessionManager.newSession({ id: profile.sessionId });
	}

	return sessionManager;
}

export async function createPiboRuntime(options: PiboRuntimeOptions = {}): Promise<AgentSessionRuntime> {
	const cwd = options.cwd ?? process.cwd();
	const profile = options.profile ?? createDefaultPiboProfile();
	const agentDir = getAgentDir();
	const sessionManager = createSessionManager(cwd, profile, options.persistSession !== false);
	const authStorage = AuthStorage.create();

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSessionManager,
		sessionStartEvent,
	}) => {
		const contextFiles = await loadContextFiles(runtimeCwd, profile.contextFiles);
		const skillPaths = getEnabledSkillPaths(runtimeCwd, profile);
		const customTools = getEnabledToolDefinitions(profile);
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			authStorage,
			resourceLoaderOptions: {
				additionalSkillPaths: skillPaths,
				extensionFactories: options.extensionFactories,
				agentsFilesOverride: (base) => ({
					agentsFiles: mergeContextFiles(base.agentsFiles, contextFiles),
				}),
			},
		});

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
			customTools,
			noTools: profile.builtinTools === "disabled" ? "builtin" : undefined,
		});

		const resourceLoader = services.resourceLoader;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...services.diagnostics,
			...collectResourceDiagnostics(resourceLoader.getSkills().diagnostics),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];

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

export async function inspectPiboProfile(options: PiboRuntimeOptions = {}): Promise<PiboProfileInspection> {
	const cwd = options.cwd ?? process.cwd();
	const profile = options.profile ?? createDefaultPiboProfile();
	const runtime = await createPiboRuntime({ cwd, profile, persistSession: false });

	try {
		const resourceLoader = runtime.services.resourceLoader;
		const activeToolNames = new Set(runtime.session.getActiveToolNames());
		const registeredToolNames = new Set(runtime.session.getAllTools().map((tool) => tool.name));

		return {
			profileName: profile.profileName,
			skills: resourceLoader.getSkills().skills.map((skill) => ({
				name: skill.name,
				path: skill.filePath,
			})),
			tools: profile.tools.map((tool) => ({
				name: tool.name,
				hasDefinition: Boolean(tool.definition),
				registered: registeredToolNames.has(tool.name),
				active: activeToolNames.has(tool.name),
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
	const runtime = await createPiboRuntime(options);

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
