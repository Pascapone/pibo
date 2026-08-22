import { randomUUID } from "node:crypto";
import type {
	ContextFileProfile,
	InitialSessionContext,
	SkillProfile,
	SubagentProfile,
	ToolProfile,
	ToolProfileRegistration,
} from "../core/profiles.js";
import { normalizeToolProfile } from "../core/profiles.js";
import type { PiboOutputEvent } from "../core/events.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type {
	PiboTranscriptionProvider,
	PiboTranscriptionProviderInfo,
	PiboTranscriptionRequest,
	PiboTranscriptionResult,
} from "../transcription/types.js";
import type {
	PiboGatewayAction,
	PiboGatewayActionInfo,
	PiboPlugin,
	PiboPluginApi,
	PiboPluginEventListener,
	PiboProductEvent,
	PiboProductEventInput,
	PiboProductEventListener,
	PiboCapabilityCatalog,
	PiboCapabilityPackageInfo,
	PiboProfileInfo,
	PiboProfileBuildContext,
	PiboProfileDefinition,
	PiboLoopStopConditionDefinition,
} from "./types.js";
import { listInstalledCliToolAgentContexts } from "../tools/registry.js";
import { listPiPackages } from "../pi-packages/store.js";
import { AgentRuntimeAdapterRegistry } from "../agent-runtime/registry.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeDriver,
	AgentRuntimeInstanceDefinition,
	AgentRuntimeSession,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	OpenAgentRuntimeSessionInput,
	StartAgentRuntimeAuthInput,
} from "../agent-runtime/types.js";

export type PiboPluginRegistryOptions = {
	plugins?: readonly PiboPlugin[];
};

type WebAppRoute = {
	label: "mountPath" | "apiPrefix";
	prefix: string;
};

function getWebAppRoutes(app: PiboWebApp): WebAppRoute[] {
	return [
		{ label: "mountPath", prefix: app.mountPath },
		{ label: "apiPrefix", prefix: app.apiPrefix },
	];
}

function validateWebRoute(appName: string, label: string, prefix: string): void {
	if (!prefix.startsWith("/")) {
		throw new Error(`Web app "${appName}" ${label} must start with "/"`);
	}
	if (prefix.length > 1 && prefix.endsWith("/")) {
		throw new Error(`Web app "${appName}" ${label} must not end with "/"`);
	}
}

function webRoutesOverlap(left: string, right: string): boolean {
	return left === right || left === "/" || right === "/" || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function toolIsPortable(tool: ToolProfile): boolean {
	if (tool.definition) return tool.definition.portable !== false;
	if (!tool.createDefinition) return true;
	try {
		return tool.createDefinition({}).portable !== false;
	} catch {
		return false;
	}
}

export class PiboPluginRegistry {
	private readonly agentRuntimes = new AgentRuntimeAdapterRegistry();
	private readonly tools = new Map<string, ToolProfile>();
	private readonly subagents = new Map<string, SubagentProfile>();
	private readonly skills = new Map<string, SkillProfile>();
	private readonly contextFiles = new Map<string, ContextFileProfile>();
	private readonly profiles = new Map<string, PiboProfileDefinition>();
	private readonly profileAliases = new Map<string, string>();
	private readonly gatewayActions = new Map<string, PiboGatewayAction>();
	private readonly gatewaySlashCommands = new Map<string, string>();
	private readonly channels = new Map<string, PiboChannel>();
	private authService?: PiboAuthService;
	private readonly transcriptionProviders = new Map<string, PiboTranscriptionProvider>();
	private readonly webApps = new Map<string, PiboWebApp>();
	private readonly capabilityPackages = new Map<string, PiboCapabilityPackageInfo>();
	private readonly eventListeners = new Set<PiboPluginEventListener>();
	private readonly productEventListeners = new Set<PiboProductEventListener>();
	private readonly loopStopConditions = new Map<string, { definition: PiboLoopStopConditionDefinition; pluginId?: string }>();
	private readonly pluginIds = new Set<string>();
	private readonly pluginNames = new Map<string, string>();
	private readonly eventErrors: string[] = [];

	static create(options: PiboPluginRegistryOptions = {}): PiboPluginRegistry {
		const registry = new PiboPluginRegistry();
		for (const plugin of options.plugins ?? []) {
			registry.registerPlugin(plugin);
		}
		return registry;
	}

	registerPlugin(plugin: PiboPlugin): void {
		if (this.pluginIds.has(plugin.id)) {
			throw new Error(`Plugin "${plugin.id}" is already registered`);
		}

		this.pluginIds.add(plugin.id);
		this.pluginNames.set(plugin.id, plugin.name ?? plugin.id);
		plugin.register(this.createApi(plugin.id));
	}

	registerAgentRuntimeDriver<TConfig>(driver: AgentRuntimeDriver<TConfig>): void {
		this.agentRuntimes.registerDriver(driver);
	}

	registerAgentRuntimeInstance(instance: AgentRuntimeInstanceDefinition): AgentRuntimeAdapter {
		return this.agentRuntimes.registerInstance(instance);
	}

	getAgentRuntimeAdapter(instanceId: string): AgentRuntimeAdapter | undefined {
		return this.agentRuntimes.getInstance(instanceId);
	}

	requireAgentRuntimeAdapter(instanceId: string): AgentRuntimeAdapter {
		return this.agentRuntimes.requireInstance(instanceId);
	}

	openAgentRuntimeSession(instanceId: string, input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		return this.agentRuntimes.openSession(instanceId, input);
	}

	getAgentRuntimeInstanceIds(): string[] {
		return this.agentRuntimes.getInstanceIds();
	}

	inspectAgentRuntimeInstances() {
		return this.agentRuntimes.inspectInstances();
	}

	getAgentRuntimeAuthStatus(runtimeInstanceId: string) {
		return this.agentRuntimes.getAuthStatus(runtimeInstanceId);
	}

	startAgentRuntimeAuth(runtimeInstanceId: string, input: StartAgentRuntimeAuthInput) {
		return this.agentRuntimes.startAuth(runtimeInstanceId, input);
	}

	completeAgentRuntimeAuth(runtimeInstanceId: string, input: CompleteAgentRuntimeAuthInput) {
		return this.agentRuntimes.completeAuth(runtimeInstanceId, input);
	}

	cancelAgentRuntimeAuth(runtimeInstanceId: string, input: CancelAgentRuntimeAuthInput) {
		return this.agentRuntimes.cancelAuth(runtimeInstanceId, input);
	}

	logoutAgentRuntimeAuth(runtimeInstanceId: string, input: LogoutAgentRuntimeAuthInput) {
		return this.agentRuntimes.logoutAuth(runtimeInstanceId, input);
	}

	disposeAgentRuntimeAuth() {
		return this.agentRuntimes.disposeAuth();
	}

	validateAgentRuntimeProfile(profile: InitialSessionContext, workspace?: string) {
		return this.agentRuntimes.validateProfile({ profile, workspace });
	}

	registerTool(tool: ToolProfileRegistration): void {
		const normalized = normalizeToolProfile(tool);
		this.addUnique(this.tools, normalized.name, normalized, "tool");
	}

	registerTools(tools: readonly ToolProfileRegistration[]): void {
		for (const tool of tools) {
			this.registerTool(tool);
		}
	}

	registerSubagent(subagent: SubagentProfile): void {
		this.addUnique(this.subagents, subagent.name, subagent, "subagent");
	}

	registerSubagents(subagents: readonly SubagentProfile[]): void {
		for (const subagent of subagents) {
			this.registerSubagent(subagent);
		}
	}

	registerSkill(skill: SkillProfile): void {
		this.addUnique(this.skills, skill.name, skill, "skill");
	}

	unregisterSkill(name: string): boolean {
		return this.skills.delete(name);
	}

	getRegisteredSkillNames(): string[] {
		return [...this.skills.keys()];
	}

	registerContextFile(contextFile: ContextFileProfile): void {
		this.addUnique(this.contextFiles, contextFileKey(contextFile), contextFile, "context file");
	}

	upsertContextFile(contextFile: ContextFileProfile): void {
		this.contextFiles.set(contextFileKey(contextFile), contextFile);
	}

	removeContextFile(key: string): void {
		this.contextFiles.delete(key);
	}

	registerProfile(profile: PiboProfileDefinition): void {
		this.addUnique(this.profiles, profile.name, profile, "profile");
		this.registerProfileAliases(profile);
	}

	upsertProfile(profile: PiboProfileDefinition): void {
		this.profiles.set(profile.name, profile);
		for (const [alias, profileName] of this.profileAliases.entries()) {
			if (profileName === profile.name) this.profileAliases.delete(alias);
		}
		this.registerProfileAliases(profile);
	}

	removeProfile(name: string): void {
		const resolvedName = this.profileAliases.get(name) ?? name;
		if (!this.profiles.delete(resolvedName)) return;
		for (const [alias, profileName] of this.profileAliases.entries()) {
			if (profileName === resolvedName) this.profileAliases.delete(alias);
		}
	}

	registerGatewayAction(action: PiboGatewayAction): void {
		const slashCommands = this.getGatewaySlashCommandsToRegister(action);
		this.addUnique(this.gatewayActions, action.name, action, "gateway action");
		for (const slashCommand of slashCommands) {
			this.gatewaySlashCommands.set(slashCommand, action.name);
		}
	}

	registerChannel(channel: PiboChannel): void {
		this.addUnique(this.channels, channel.name, channel, "channel");
	}

	registerAuthService(service: PiboAuthService): void {
		if (this.authService) {
			throw new Error(`Auth service "${this.authService.name}" is already registered`);
		}
		this.authService = service;
	}

	registerTranscriptionProvider(provider: PiboTranscriptionProvider): void {
		this.addUnique(this.transcriptionProviders, provider.id, provider, "transcription provider");
	}

	async getTranscriptionProviderInfos(): Promise<PiboTranscriptionProviderInfo[]> {
		return await Promise.all([...this.transcriptionProviders.values()].map(async (provider) => ({
			id: provider.id,
			name: provider.name,
			description: provider.description,
			configured: provider.isConfigured ? await Promise.resolve(provider.isConfigured()).catch(() => false) : true,
			pluginId: provider.pluginId,
			pluginName: provider.pluginId ? this.pluginNames.get(provider.pluginId) : undefined,
		})));
	}

	async transcribe(providerId: string, input: PiboTranscriptionRequest): Promise<PiboTranscriptionResult> {
		const provider = this.getRequired(this.transcriptionProviders, providerId, "transcription provider");
		return { providerId, ...await provider.transcribe(input) };
	}

	registerWebApp(app: PiboWebApp): void {
		if (this.webApps.has(app.name)) {
			throw new Error(`Duplicate web app "${app.name}"`);
		}
		this.validateWebAppRoutes(app);
		this.webApps.set(app.name, app);
	}

	registerCapabilityPackage(pkg: PiboCapabilityPackageInfo): void {
		this.addUnique(this.capabilityPackages, pkg.name, { ...pkg, toolNames: [...pkg.toolNames] }, "capability package");
	}

	registerLoopStopCondition(condition: PiboLoopStopConditionDefinition, pluginId?: string): void {
		if (!condition.type.trim()) throw new Error('Loop stop condition type is required');
		if (!condition.name.trim()) throw new Error(`Loop stop condition "${condition.type}" name is required`);
		if (condition.phases.length === 0) throw new Error(`Loop stop condition "${condition.type}" must support at least one phase`);
		this.addUnique(this.loopStopConditions, condition.type, { definition: { ...condition, phases: [...condition.phases] }, pluginId }, 'Loop stop condition');
	}

	registerRalphStopCondition(condition: PiboLoopStopConditionDefinition, pluginId?: string): void { this.registerLoopStopCondition(condition, pluginId); }

	getLoopStopConditionDefinitions(): PiboLoopStopConditionDefinition[] {
		return [...this.loopStopConditions.values()].map((entry) => entry.definition);
	}

	getRalphStopConditionDefinitions(): PiboLoopStopConditionDefinition[] { return this.getLoopStopConditionDefinitions(); }

	getLoopStopConditionInfos() {
		return [...this.loopStopConditions.values()].map((entry) => ({
			type: entry.definition.type,
			name: entry.definition.name,
			description: entry.definition.description,
			phases: [...entry.definition.phases],
			optionsSchema: entry.definition.optionsSchema,
			defaultOptions: entry.definition.defaultOptions,
			pluginId: entry.pluginId,
			pluginName: entry.pluginId ? this.pluginNames.get(entry.pluginId) : undefined,
		}));
	}

	getRalphStopConditionInfos() { return this.getLoopStopConditionInfos(); }

	onEvent(listener: PiboPluginEventListener): void {
		this.eventListeners.add(listener);
	}

	onProductEvent(listener: PiboProductEventListener): () => void {
		this.productEventListeners.add(listener);
		return () => {
			this.productEventListeners.delete(listener);
		};
	}

	createProfile(name: string): InitialSessionContext {
		const resolvedName = this.resolveProfileName(name);
		const profile = this.profiles.get(resolvedName);
		if (!profile) throw new Error(`Unknown profile "${name}"`);

		return profile.create(this.createProfileBuildContext());
	}

	getProfileNames(): string[] {
		return [...this.profiles.keys()];
	}

	getProfileInfos(): PiboProfileInfo[] {
		const context = this.createProfileBuildContext();
		return [...this.profiles.values()].map((profile) => {
			const sessionContext = profile.create(context);
			return {
				name: profile.name,
				description: profile.description,
				aliases: [...(profile.aliases ?? [])],
				runtimeInstanceId: sessionContext.runtimeInstanceId,
				runtimeOptions: structuredClone(sessionContext.runtimeOptions),
				nativeTools: sessionContext.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name),
				skills: sessionContext.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.name),
				contextFiles: sessionContext.contextFiles.filter((contextFile) => contextFile.enabled !== false).map(contextFileKey),
				subagents: sessionContext.subagents.filter((subagent) => subagent.enabled !== false),
				mcpServers: [...sessionContext.mcpServers],
				piPackages: sessionContext.piPackages.filter((pkg) => pkg.enabled !== false).map((pkg) => pkg.id),
				model: sessionContext.model ? { ...sessionContext.model } : undefined,
				mainModel: sessionContext.mainModel ? { ...sessionContext.mainModel } : undefined,
				subagentModel: sessionContext.subagentModel ? { ...sessionContext.subagentModel } : undefined,
				thinkingLevel: sessionContext.thinkingLevel,
				mainThinkingLevel: sessionContext.mainThinkingLevel,
				subagentThinkingLevel: sessionContext.subagentThinkingLevel,
				fast: sessionContext.fast,
				mainFast: sessionContext.mainFast,
				subagentFast: sessionContext.subagentFast,
				builtinTools: sessionContext.builtinTools,
				builtinToolNames: [...sessionContext.builtinToolNames],
				autoContextFiles: sessionContext.autoContextFiles,
				nativeSubagents: sessionContext.nativeSubagents,
				runControl: sessionContext.toolPackages.runControl === true,
				goalControl: sessionContext.toolPackages.goalControl !== false,
			};
		});
	}

	getCapabilityCatalog(): PiboCapabilityCatalog {
		return {
			agentRuntimes: this.agentRuntimes.getInstanceInfos(),
			nativeTools: [...this.tools.values()].map((tool) => ({
				name: tool.name,
				description: tool.description,
				yieldable: tool.yieldable !== false,
				hasDefinition: tool.definition !== undefined || tool.createDefinition !== undefined,
				portable: toolIsPortable(tool),
				pluginId: tool.pluginId,
				pluginName: tool.pluginId ? this.pluginNames.get(tool.pluginId) : undefined,
				...(tool.providerTool ? { providerTool: tool.providerTool } : {}),
			})),
			skills: [...this.skills.values()].map((skill) => ({
				name: skill.name,
				path: skill.path,
				kind: skill.kind ?? "plugin",
				pluginId: skill.pluginId,
				pluginName: skill.pluginId ? this.pluginNames.get(skill.pluginId) : undefined,
			})),
			subagents: [...this.subagents.values()].map((subagent) => ({
				name: subagent.name,
				description: subagent.description,
				targetProfile: subagent.targetProfile,
				timeoutMs: subagent.timeoutMs,
				model: subagent.model ? { ...subagent.model } : undefined,
				thinkingLevel: subagent.thinkingLevel,
				maxDepth: subagent.maxDepth,
			})),
			contextFiles: [...this.contextFiles.entries()].map(([key, contextFile]) => ({
				key,
				label: contextFile.label,
				path: contextFile.path,
				scope: contextFile.scope ?? "global",
				source: contextFile.source ?? "plugin",
				pluginId: contextFile.pluginId,
				pluginName: contextFile.pluginId ? this.pluginNames.get(contextFile.pluginId) : undefined,
				agentProfileName: contextFile.agentProfileName,
			})),
			packages: [
				{
					name: "pibo-run-control",
					description: "Expose pibo_run_* for Pibo-managed tools and subagents; private harness-native tools require explicit runtime capability.",
					toolNames: [
						"pibo_run_start",
						"pibo_run_list",
						"pibo_run_status",
						"pibo_run_wait",
						"pibo_run_read",
						"pibo_run_cancel",
						"pibo_run_ack",
					],
				},
				{
					name: "pibo-goal-control",
					description: "Expose get_goal, create_goal, and update_goal as one native goal lifecycle package.",
					toolNames: ["get_goal", "create_goal", "update_goal"],
				},
				...[...this.capabilityPackages.values()].map((pkg) => ({
					...pkg,
					toolNames: [...pkg.toolNames],
					pluginName: pkg.pluginId ? this.pluginNames.get(pkg.pluginId) : pkg.pluginName,
				})),
			],
			piboTools: listInstalledCliToolAgentContexts(),
			mcpServers: [],
			piPackages: listPiPackages(),
			loopStopConditions: this.getLoopStopConditionInfos(),
			ralphStopConditions: this.getLoopStopConditionInfos(),
		};
	}

	resolveProfileName(name: string): string {
		const resolvedName = this.profileAliases.get(name) ?? name;
		if (!this.profiles.has(resolvedName)) {
			throw new Error(`Unknown profile "${name}". Available profiles: ${this.getProfileNames().join(", ")}`);
		}
		return resolvedName;
	}

	getGatewayAction(name: string): PiboGatewayAction | undefined {
		return this.gatewayActions.get(name);
	}

	getGatewayActionInfos(): PiboGatewayActionInfo[] {
		return [...this.gatewayActions.values()]
			.filter((action) => action.hidden !== true)
			.map((action) => ({
				name: action.name,
				description: action.description,
				slashCommands: [...(action.slashCommands ?? [])],
			}));
	}

	getChannels(): PiboChannel[] {
		return [...this.channels.values()];
	}

	getAuthService(): PiboAuthService | undefined {
		return this.authService;
	}

	getWebApps(): PiboWebApp[] {
		return [...this.webApps.values()];
	}

	getEventErrors(): string[] {
		return [...this.eventErrors];
	}

	notifyEvent(event: PiboOutputEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (error) {
				this.eventErrors.push(error instanceof Error ? error.message : String(error));
			}
		}
	}

	emitProductEvent(input: PiboProductEventInput): PiboProductEvent {
		const event: PiboProductEvent = {
			...input,
			id: input.id ?? randomUUID(),
			createdAt: input.createdAt ?? new Date().toISOString(),
		};
		for (const listener of this.productEventListeners) {
			try {
				listener(event);
			} catch (error) {
				this.eventErrors.push(error instanceof Error ? error.message : String(error));
			}
		}
		return event;
	}

	private createApi(pluginId: string): PiboPluginApi {
		const withPluginToolContext = (tool: ToolProfileRegistration): ToolProfileRegistration => ({ ...tool, pluginId: tool.pluginId ?? pluginId });
		const withPluginSkillContext = (skill: SkillProfile): SkillProfile => (
			skill.kind === "user"
				? skill
				: {
					...skill,
					kind: skill.kind ?? "plugin",
					pluginId: skill.pluginId ?? pluginId,
				}
		);
		const withPluginContext = (contextFile: ContextFileProfile): ContextFileProfile => (
			contextFile.source === "managed" ? contextFile : { ...contextFile, pluginId: contextFile.pluginId ?? pluginId }
		);
		const withPluginPackageContext = (pkg: PiboCapabilityPackageInfo): PiboCapabilityPackageInfo => ({
			...pkg,
			toolNames: [...pkg.toolNames],
			pluginId: pkg.pluginId ?? pluginId,
		});
		const withPluginTranscriptionProviderContext = (provider: PiboTranscriptionProvider): PiboTranscriptionProvider => ({
			...provider,
			pluginId: provider.pluginId ?? pluginId,
		});
		return {
			registerAgentRuntimeDriver: (driver) => this.registerAgentRuntimeDriver(driver),
			registerAgentRuntimeInstance: (instance) => this.registerAgentRuntimeInstance(instance),
			registerTool: (tool) => this.registerTool(withPluginToolContext(tool)),
			registerTools: (tools) => this.registerTools(tools.map(withPluginToolContext)),
			registerSubagent: (subagent) => this.registerSubagent(subagent),
			registerSubagents: (subagents) => this.registerSubagents(subagents),
			registerSkill: (skill) => this.registerSkill(withPluginSkillContext(skill)),
			registerContextFile: (contextFile) => this.registerContextFile(withPluginContext(contextFile)),
			upsertContextFile: (contextFile) => this.upsertContextFile(withPluginContext(contextFile)),
			removeContextFile: (key) => this.removeContextFile(key),
			registerProfile: (profile) => this.registerProfile(profile),
			upsertProfile: (profile) => this.upsertProfile(profile),
			registerGatewayAction: (action) => this.registerGatewayAction(action),
			registerChannel: (channel) => this.registerChannel(channel),
			registerAuthService: (service) => this.registerAuthService(service),
			registerTranscriptionProvider: (provider) => this.registerTranscriptionProvider(withPluginTranscriptionProviderContext(provider)),
			registerWebApp: (app) => this.registerWebApp(app),
			registerCapabilityPackage: (pkg) => this.registerCapabilityPackage(withPluginPackageContext(pkg)),
			registerLoopStopCondition: (condition) => this.registerLoopStopCondition(condition, pluginId),
			registerRalphStopCondition: (condition) => this.registerLoopStopCondition(condition, pluginId),
			onEvent: (listener) => this.onEvent(listener),
			emitProductEvent: (event) => this.emitProductEvent(event),
			onProductEvent: (listener) => this.onProductEvent(listener),
		};
	}

	private createProfileBuildContext(): PiboProfileBuildContext {
		return {
			getTool: (name) => this.getRequired(this.tools, name, "tool"),
			getTools: (names) => names.map((name) => this.getRequired(this.tools, name, "tool")),
			getSkill: (name) => this.getRequired(this.skills, name, "skill"),
			getContextFile: (key) => this.getRequired(this.contextFiles, key, "context file"),
			getSubagent: (name) => this.getRequired(this.subagents, name, "subagent"),
			getSubagents: (names) => names.map((name) => this.getRequired(this.subagents, name, "subagent")),
		};
	}

	private getRequired<T>(map: ReadonlyMap<string, T>, key: string, label: string): T {
		const value = map.get(key);
		if (!value) {
			throw new Error(`Unknown ${label} "${key}"`);
		}
		return value;
	}

	private registerProfileAliases(profile: PiboProfileDefinition): void {
		for (const alias of profile.aliases ?? []) {
			const existingAliasProfile = this.profileAliases.get(alias);
			if (this.profiles.has(alias) || (existingAliasProfile && existingAliasProfile !== profile.name)) {
				throw new Error(`Profile alias "${alias}" is already registered`);
			}
			this.profileAliases.set(alias, profile.name);
		}
	}

	private addUnique<T>(map: Map<string, T>, key: string, value: T, label: string): void {
		if (map.has(key)) {
			throw new Error(`Duplicate ${label} "${key}"`);
		}
		map.set(key, value);
	}

	private validateWebAppRoutes(app: PiboWebApp): void {
		const routes = getWebAppRoutes(app);
		for (const route of routes) {
			validateWebRoute(app.name, route.label, route.prefix);
		}
		for (const existing of this.webApps.values()) {
			for (const route of routes) {
				for (const existingRoute of getWebAppRoutes(existing)) {
					if (webRoutesOverlap(route.prefix, existingRoute.prefix)) {
						throw new Error(
							`Web app route "${route.prefix}" for "${app.name}" overlaps ${existingRoute.label} "${existingRoute.prefix}" from web app "${existing.name}"`,
						);
					}
				}
			}
		}
	}

	private getGatewaySlashCommandsToRegister(action: PiboGatewayAction): string[] {
		if (action.hidden === true) return [];
		const slashCommands: string[] = [];
		for (const slashCommand of action.slashCommands ?? []) {
			if (!slashCommand || slashCommand.startsWith("/") || /\s/.test(slashCommand)) {
				throw new Error(`Invalid slash command "${slashCommand}" for gateway action "${action.name}"`);
			}
			const existingAction = this.gatewaySlashCommands.get(slashCommand);
			if (existingAction) {
				throw new Error(
					`Duplicate slash command "${slashCommand}" for gateway actions "${existingAction}" and "${action.name}"`,
				);
			}
			if (slashCommands.includes(slashCommand)) {
				throw new Error(`Duplicate slash command "${slashCommand}" for gateway action "${action.name}"`);
			}
			slashCommands.push(slashCommand);
		}
		return slashCommands;
	}
}

function contextFileKey(contextFile: ContextFileProfile): string {
	return contextFile.key ?? contextFile.label ?? contextFile.path;
}

export function definePiboPlugin(plugin: PiboPlugin): PiboPlugin {
	return plugin;
}
