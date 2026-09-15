import type { EffectivePluginPlan } from "./contributions.js";
import type { ContextFileProfile, SkillProfile } from "../core/profiles.js";
import type { PiboProfileDefinition } from "./types.js";
import type { PluginConsumerCollector } from "./operations.js";
import type { PluginHost } from "./host.js";
import type { PluginInstallation, PluginJsonObject } from "./manifest.js";
import type { PiboWebAppContext, PiboWebSession } from "../web/types.js";
import type { PiboRoom, PiboRoomNode } from "../apps/chat/types/rooms.js";

/** Stable services provided by the product composition through the plugin host. */
export const PLUGIN_HOST_SERVICE = "pibo.plugins.host";
export const PLUGIN_MANAGEMENT_SERVICE = "pibo.plugins.management";
export const PLUGIN_SESSION_PLAN_SERVICE = "pibo.plugins.session-plan";
export const PIBO_PRODUCT_OPTIONS_SERVICE = "pibo.product.options";
export const PIBO_LOOP_SERVICE = "pibo.loops.service";
export const PIBO_USER_RESOURCES_SERVICE = "pibo.user-resources.service";
export const PIBO_CHAT_EXTENSION_SERVICE = "pibo.chat.extensions";
export const PIBO_MESSAGE_PREFLIGHT_SERVICE = "pibo.message-preflight";

export type PiboChatRoomActions = {
	getRoom(id: string): PiboRoom | undefined;
	listRoomTree(): PiboRoomNode[];
	requireRoom(roomId: string): PiboRoom;
	ensureDefaultRoom(input?: { name?: string }): PiboRoom;
};

export type PiboChatApiRouteInput = {
	request: Request;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	roomService: PiboChatRoomActions;
	defaultProfile: string;
};

export type PiboChatMessageAugmentation = {
	messageText: string;
	payload?: PluginJsonObject;
	commit?(): void | Promise<void>;
};

export type PiboChatExtensionService = {
	registerApiRoute(handler: (input: PiboChatApiRouteInput) => Response | undefined | Promise<Response | undefined>): () => void;
	dispatchApiRoute(input: PiboChatApiRouteInput): Promise<Response | undefined>;
	registerMessageAugmenter(handler: (input: { piboSessionId: string; messageText: string; body: PluginJsonObject }) => PiboChatMessageAugmentation | Promise<PiboChatMessageAugmentation>): () => void;
	prepareMessage(input: { piboSessionId: string; messageText: string; body: PluginJsonObject }): Promise<PiboChatMessageAugmentation>;
};

export type { PiboMessagePreflight } from "../agent-runtime/routed-session.js";

export class PiboChatExtensionRegistry implements PiboChatExtensionService {
	private readonly apiRoutes: Array<(input: PiboChatApiRouteInput) => Response | undefined | Promise<Response | undefined>> = [];
	private readonly messageAugmenters: Array<(input: { piboSessionId: string; messageText: string; body: PluginJsonObject }) => PiboChatMessageAugmentation | Promise<PiboChatMessageAugmentation>> = [];

	registerApiRoute(handler: (input: PiboChatApiRouteInput) => Response | undefined | Promise<Response | undefined>): () => void {
		this.apiRoutes.push(handler);
		return () => { const index = this.apiRoutes.indexOf(handler); if (index >= 0) this.apiRoutes.splice(index, 1); };
	}

	async dispatchApiRoute(input: PiboChatApiRouteInput): Promise<Response | undefined> {
		for (const handler of this.apiRoutes) {
			const response = await handler(input);
			if (response) return response;
		}
		return undefined;
	}

	registerMessageAugmenter(handler: (input: { piboSessionId: string; messageText: string; body: PluginJsonObject }) => PiboChatMessageAugmentation | Promise<PiboChatMessageAugmentation>): () => void {
		this.messageAugmenters.push(handler);
		return () => { const index = this.messageAugmenters.indexOf(handler); if (index >= 0) this.messageAugmenters.splice(index, 1); };
	}

	async prepareMessage(input: { piboSessionId: string; messageText: string; body: PluginJsonObject }): Promise<PiboChatMessageAugmentation> {
		let messageText = input.messageText;
		const payload: PluginJsonObject = {};
		const commits: Array<() => void | Promise<void>> = [];
		for (const handler of this.messageAugmenters) {
			const result = await handler({ ...input, messageText });
			messageText = result.messageText;
			for (const [key, value] of Object.entries(result.payload ?? {})) {
				if (key in payload) throw new Error(`Chat message augmentation payload key conflict: ${key}`);
				payload[key] = value;
			}
			if (result.commit) commits.push(result.commit);
		}
		return {
			messageText,
			...(Object.keys(payload).length ? { payload } : {}),
			...(commits.length ? { commit: async () => { for (const commit of commits) await commit(); } } : {}),
		};
	}
}

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
