import type { EffectivePluginPlan } from "./contributions.js";
import type { ContextFileProfile, SkillProfile } from "../core/profiles.js";
import type { PiboProfileDefinition } from "./types.js";
import type { PluginConsumerCollector } from "./operations.js";
import type { PluginHost } from "./host.js";
import type { PluginInstallation } from "./manifest.js";

/** Stable services provided by the product composition through the plugin host. */
export const PLUGIN_HOST_SERVICE = "pibo.plugins.host";
export const PLUGIN_MANAGEMENT_SERVICE = "pibo.plugins.management";
export const PLUGIN_SESSION_PLAN_SERVICE = "pibo.plugins.session-plan";
export const PIBO_PRODUCT_OPTIONS_SERVICE = "pibo.product.options";
export const PIBO_LOOP_SERVICE = "pibo.loops.service";
export const PIBO_USER_RESOURCES_SERVICE = "pibo.user-resources.service";

export type PiboUserResourcesService = {
	upsertProfile(profile: PiboProfileDefinition): void;
	removeProfile(name: string): void;
	upsertContextFile(file: ContextFileProfile): void;
	removeContextFile(key: string): void;
	upsertSkill(skill: SkillProfile): void;
	removeSkill(name: string): void;
};

export type PiboPluginProductOptions = {
	loopStorePath?: string;
	dataStorePath?: string;
	dataPayloadRootDir?: string;
	userResources?: {
		contextFilesMode?: "full" | "catalog";
		userSkills?: { globalRoot?: string; workspaceRoot?: string };
		contextFiles?: { metadataPath?: string; storePath?: string; managedRoot?: string; globalDir?: string; agentWorkspaceRoot?: string };
		customAgents?: { agentStorePath?: string };
	};
	web?: {
		authMode: "better-auth" | "dev-auth";
		auth?: Record<string, unknown>;
		channel?: Record<string, unknown>;
		chat?: Record<string, unknown>;
	};
};
/** Optional plugin-owned live/business consumer collectors used by uninstall impact analysis. */
export const PLUGIN_CONSUMER_COLLECTOR_RESOURCE = "plugin-consumer-collector";
export type PluginOwnedConsumerCollector = PluginConsumerCollector;

/** Safe service metadata includes core and plugin providers; values remain host-private. */
export function catalogPluginServices(host: PluginHost | undefined, _installations: readonly PluginInstallation[]) {
	if (!host) return { services: undefined, serviceProviders: undefined };
	return { services: host.services.versions(), serviceProviders: host.services.owners() };
}

/** Read-only runtime projection. Preview must use the pure resolver and never open a runtime. */
export type PluginSessionPlanReader = (piboSessionId: string, kind: "actual" | "current" | "preview") => Promise<{
	plan: EffectivePluginPlan;
	agentId?: string;
	roomId?: string;
}>;
