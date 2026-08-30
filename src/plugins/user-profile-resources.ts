import {
	createPiboChatCustomAgentProfilesPlugin,
	type PiboChatCustomAgentProfilesPluginOptions,
} from "./chat-custom-agents.js";
import { createPiboChatUserSkillsPlugin, type PiboChatUserSkillsPluginOptions } from "./chat-user-skills.js";
import {
	createPiboContextFilesCatalogPlugin,
	createPiboContextFilesPlugin,
	type ContextFilesPluginOptions,
} from "./context-files.js";
import { createDefaultPiboPluginRegistry } from "./builtin.js";
import type { PiboPluginRegistry } from "./registry.js";
import type { PiboPlugin } from "./types.js";

export type PiboUserProfileResourcesOptions = {
	userSkills?: PiboChatUserSkillsPluginOptions;
	contextFiles?: ContextFilesPluginOptions;
	customAgents?: PiboChatCustomAgentProfilesPluginOptions;
	contextFilesMode?: "full" | "catalog";
};

export function createPiboUserProfileResourcePlugins(
	options: PiboUserProfileResourcesOptions = {},
): PiboPlugin[] {
	return [
		createPiboChatUserSkillsPlugin(options.userSkills),
		options.contextFilesMode === "catalog"
			? createPiboContextFilesCatalogPlugin(options.contextFiles)
			: createPiboContextFilesPlugin(options.contextFiles),
		createPiboChatCustomAgentProfilesPlugin(options.customAgents),
	];
}

export function createDefaultPiboUserProfileRegistry(
	options: PiboUserProfileResourcesOptions = {},
): PiboPluginRegistry {
	const registry = createDefaultPiboPluginRegistry();
	registerPiboUserProfileResources(registry, { contextFilesMode: "catalog", ...options });
	return registry;
}

export function registerPiboUserProfileResources(
	registry: PiboPluginRegistry,
	options: PiboUserProfileResourcesOptions = {},
): void {
	for (const plugin of createPiboUserProfileResourcePlugins(options)) registry.registerPlugin(plugin);
}
