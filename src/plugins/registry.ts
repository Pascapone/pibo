import type { ContextFileProfile, InitialSessionContext, SkillProfile, ToolProfile } from "../core/profiles.js";
import type { PiboOutputEvent } from "../core/events.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type {
	PiboGatewayAction,
	PiboGatewayActionInfo,
	PiboPlugin,
	PiboPluginApi,
	PiboPluginEventListener,
	PiboProfileBuildContext,
	PiboProfileDefinition,
} from "./types.js";

export type PiboPluginRegistryOptions = {
	plugins?: readonly PiboPlugin[];
};

export class PiboPluginRegistry {
	private readonly tools = new Map<string, ToolProfile>();
	private readonly skills = new Map<string, SkillProfile>();
	private readonly contextFiles = new Map<string, ContextFileProfile>();
	private readonly profiles = new Map<string, PiboProfileDefinition>();
	private readonly profileAliases = new Map<string, string>();
	private readonly gatewayActions = new Map<string, PiboGatewayAction>();
	private readonly gatewaySlashCommands = new Map<string, string>();
	private readonly channels = new Map<string, PiboChannel>();
	private authService?: PiboAuthService;
	private readonly eventListeners = new Set<PiboPluginEventListener>();
	private readonly pluginIds = new Set<string>();
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
		plugin.register(this.createApi());
	}

	registerTool(tool: ToolProfile): void {
		this.addUnique(this.tools, tool.name, tool, "tool");
	}

	registerTools(tools: readonly ToolProfile[]): void {
		for (const tool of tools) {
			this.registerTool(tool);
		}
	}

	registerSkill(skill: SkillProfile): void {
		this.addUnique(this.skills, skill.name, skill, "skill");
	}

	registerContextFile(contextFile: ContextFileProfile): void {
		this.addUnique(this.contextFiles, contextFileKey(contextFile), contextFile, "context file");
	}

	registerProfile(profile: PiboProfileDefinition): void {
		this.addUnique(this.profiles, profile.name, profile, "profile");
		for (const alias of profile.aliases ?? []) {
			if (this.profiles.has(alias) || this.profileAliases.has(alias)) {
				throw new Error(`Profile alias "${alias}" is already registered`);
			}
			this.profileAliases.set(alias, profile.name);
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

	onEvent(listener: PiboPluginEventListener): void {
		this.eventListeners.add(listener);
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

	private createApi(): PiboPluginApi {
		return {
			registerTool: (tool) => this.registerTool(tool),
			registerTools: (tools) => this.registerTools(tools),
			registerSkill: (skill) => this.registerSkill(skill),
			registerContextFile: (contextFile) => this.registerContextFile(contextFile),
			registerProfile: (profile) => this.registerProfile(profile),
			registerGatewayAction: (action) => this.registerGatewayAction(action),
			registerChannel: (channel) => this.registerChannel(channel),
			registerAuthService: (service) => this.registerAuthService(service),
			onEvent: (listener) => this.onEvent(listener),
		};
	}

	private createProfileBuildContext(): PiboProfileBuildContext {
		return {
			getTool: (name) => this.getRequired(this.tools, name, "tool"),
			getTools: (names) => names.map((name) => this.getRequired(this.tools, name, "tool")),
			getSkill: (name) => this.getRequired(this.skills, name, "skill"),
			getContextFile: (key) => this.getRequired(this.contextFiles, key, "context file"),
		};
	}

	private getRequired<T>(map: ReadonlyMap<string, T>, key: string, label: string): T {
		const value = map.get(key);
		if (!value) {
			throw new Error(`Unknown ${label} "${key}"`);
		}
		return value;
	}

	private addUnique<T>(map: Map<string, T>, key: string, value: T, label: string): void {
		if (map.has(key)) {
			throw new Error(`Duplicate ${label} "${key}"`);
		}
		map.set(key, value);
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
	return contextFile.label ?? contextFile.path;
}

export function definePiboPlugin(plugin: PiboPlugin): PiboPlugin {
	return plugin;
}
