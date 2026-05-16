import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiboGatewayToolProfiles } from "../gateway/tool.js";
import type {
	PiboExecutionEvent,
	PiboJsonObject,
	PiboSessionForkParams,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboThinkingParams,
} from "../core/events.js";
import { InitialSessionContextBuilder, type InitialSessionContext } from "../core/profiles.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";
import { createWebSearchToolProfile } from "../tools/web-search.js";
import { createRuntimeToolProfile } from "../tools/runtime/tool.js";
import { completeLogin, getLoginStatus, removeLogin, setApiKey, startLogin } from "../auth/login-actions.js";
import { loadModelCatalog } from "../apps/chat/model-catalog.js";
import { piboCodexCompatPlugin } from "./codex-compat.js";
import { addPiboNativeToolingContext, registerPiboNativeTooling } from "./native-tooling.js";
import { definePiboPlugin, PiboPluginRegistry } from "./registry.js";
import type { PiboPlugin, PiboProfileBuildContext } from "./types.js";

const GATEWAY_PROFILE_TOOLS = ["pibo_gateway_send"] as const;
const PIBO_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function builtinSkillPath(name: string): string {
	return resolve(PIBO_PACKAGE_ROOT, "skills", "builtin", name, "SKILL.md");
}

const LOGIN_PROVIDERS = [
	{ id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)", authMethods: ["device_code"] },
	{ id: "openai", name: "OpenAI API", authMethods: ["api_key"] },
	{ id: "anthropic", name: "Anthropic", authMethods: ["api_key"] },
	{ id: "kimi-coding", name: "Kimi for Coding", authMethods: ["api_key"] },
	{ id: "google", name: "Google Gemini", authMethods: ["api_key"] },
	{ id: "groq", name: "Groq", authMethods: ["api_key"] },
	{ id: "ollama", name: "Ollama", authMethods: ["api_key"] },
] as const;

function getObjectParams(event: PiboExecutionEvent): PiboJsonObject | undefined {
	const params = "params" in event ? event.params : undefined;
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	return params;
}

function requireForkParams(event: PiboExecutionEvent): PiboSessionForkParams {
	const params = getObjectParams(event);
	if (!params || typeof params.entryId !== "string" || params.entryId.length === 0) {
		throw new Error("session.fork requires params.entryId");
	}
	return { entryId: params.entryId };
}

function requireTreeNavigateParams(event: PiboExecutionEvent): PiboSessionTreeNavigateParams {
	const raw = getObjectParams(event);
	if (!raw || typeof raw.entryId !== "string" || raw.entryId.length === 0) {
		throw new Error("session.tree_navigate requires params.entryId");
	}

	const params: PiboSessionTreeNavigateParams = { entryId: raw.entryId };
	if (typeof raw.summarize === "boolean") params.summarize = raw.summarize;
	if (typeof raw.customInstructions === "string") params.customInstructions = raw.customInstructions;
	if (typeof raw.replaceInstructions === "boolean") params.replaceInstructions = raw.replaceInstructions;
	if (typeof raw.label === "string") params.label = raw.label;
	return params;
}

function requireSwitchParams(event: PiboExecutionEvent): PiboSessionSwitchParams {
	const raw = getObjectParams(event);
	if (!raw || typeof raw.sessionFile !== "string" || raw.sessionFile.length === 0) {
		throw new Error("session.switch requires params.sessionFile");
	}

	const params: PiboSessionSwitchParams = { sessionFile: raw.sessionFile };
	if (typeof raw.cwdOverride === "string") params.cwdOverride = raw.cwdOverride;
	return params;
}

function getThinkingParams(event: PiboExecutionEvent): PiboThinkingParams {
	const raw = getObjectParams(event);
	if (!raw || raw.level === undefined) return {};
	if (typeof raw.level !== "string") throw new Error("thinking requires params.level to be a string");
	return { level: parsePiboThinkingLevel(raw.level) };
}

function requireLoginStartParams(event: PiboExecutionEvent): { provider: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.start requires params.provider");
	}
	return { provider: params.provider };
}

function requireLoginCompleteParams(event: PiboExecutionEvent): { provider: string; code?: string; state: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.complete requires params.provider");
	}
	if (params.code !== undefined && typeof params.code !== "string") {
		throw new Error("login.complete params.code must be a string when provided");
	}
	if (typeof params.state !== "string" || params.state.length === 0) {
		throw new Error("login.complete requires params.state");
	}
	return { provider: params.provider, code: params.code, state: params.state };
}

function requireLoginApiKeyParams(event: PiboExecutionEvent): { provider: string; apiKey: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.apikey requires params.provider");
	}
	if (typeof params.apiKey !== "string" || params.apiKey.length === 0) {
		throw new Error("login.apikey requires params.apiKey");
	}
	return { provider: params.provider, apiKey: params.apiKey };
}

function requireLogoutParams(event: PiboExecutionEvent): { provider: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("logout requires params.provider");
	}
	return { provider: params.provider };
}

function createBaseProfileBuilder(
	profileName: string,
	context: PiboProfileBuildContext,
): InitialSessionContextBuilder {
	return addPiboNativeToolingContext(
		new InitialSessionContextBuilder(profileName)
			.addSkill(context.getSkill("pi-agent-harness")),
		context,
	);
}

export const piboCorePlugin = definePiboPlugin({
	id: "pibo.core",
	name: "Pibo Core",
	register(api) {
		api.registerSkill({
			name: "pi-agent-harness",
			path: builtinSkillPath("pi-agent-harness"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "pibo-spec-writing",
			path: builtinSkillPath("pibo-spec-writing"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "pibo-docker-system",
			path: builtinSkillPath("pibo-docker-system"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "prd",
			path: builtinSkillPath("prd"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "skill-creator",
			path: builtinSkillPath("skill-creator"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "ralph-loop",
			path: builtinSkillPath("ralph-loop"),
			kind: "builtin",
		});
		api.registerSkill({
			name: "ralph-prd-json",
			path: builtinSkillPath("ralph-prd-json"),
			kind: "builtin",
		});
		api.registerTool(createWebSearchToolProfile());
		api.registerTool(createRuntimeToolProfile());
		registerPiboNativeTooling(api);
		api.registerProfile({
			name: "pibo-kimi-coding",
			aliases: ["kimi", "kimi-coding"],
			description: "Pibo profile pinned to Kimi For Coding. Requires KIMI_API_KEY or configured kimi-coding auth.",
			create(context) {
				return createBaseProfileBuilder("pibo-kimi-coding", context)
					.withModel({ provider: "kimi-coding", id: "kimi-for-coding" })
					.createSession();
			},
		});
		api.registerGatewayAction({
			name: "status",
			description: "Return current session status with context usage quota.",
			slashCommands: ["status"],
			async execute(context) {
				const providerUsage = await context.getProviderUsage();
				return {
					...context.getStatus(),
					activeModel: context.getActiveModel(),
					contextUsage: context.getContextUsage(),
					...(providerUsage ? { providerUsage } : {}),
				};
			},
		});
		api.registerGatewayAction({
			name: "compact",
			description: "Manually compact the session context.",
			slashCommands: ["compact"],
			async execute(context, event) {
				const params = getObjectParams(event);
				const customInstructions = typeof params?.customInstructions === "string" ? params.customInstructions : undefined;
				return await context.compact(customInstructions);
			},
		});
		api.registerGatewayAction({
			name: "session_id",
			description: "Return the routed Pibo session id.",
			slashCommands: ["session"],
			execute(context) {
				return { piboSessionId: context.piboSessionId };
			},
		});
		api.registerGatewayAction({
			name: "clear_queue",
			description: "Clear queued messages that have not started yet.",
			slashCommands: ["clear"],
			execute(context) {
				return { cleared: context.clearQueue() };
			},
		});
		api.registerGatewayAction({
			name: "abort",
			description: "Abort the active Pi agent run.",
			slashCommands: ["abort"],
			async execute(context) {
				await context.abort();
				return { aborted: true };
			},
		});
		api.registerGatewayAction({
			name: "kill",
			description: "Kill the active agent run and all subagent sessions recursively.",
			slashCommands: ["kill"],
			async execute(context) {
				return await context.kill();
			},
		});
		api.registerGatewayAction({
			name: "kill_all",
			description: "Kill the active agent run, all subagent sessions recursively, and all yielded runs.",
			slashCommands: ["kill-all"],
			async execute(context) {
				return await context.killAll();
			},
		});
		api.registerGatewayAction({
			name: "dispose",
			description: "Dispose the routed session runtime.",
			hidden: true,
			async execute(context) {
				await context.dispose();
				return { disposed: true };
			},
		});
		api.registerGatewayAction({
			name: "thinking",
			description: "Show or set the routed Pi thinking level.",
			slashCommands: ["thinking"],
			execute(context, event) {
				const params = getThinkingParams(event);
				return params.level ? context.setThinkingLevel(params.level) : context.getThinkingLevel();
			},
		});
		api.registerGatewayAction({
			name: "fast_mode",
			description: "Toggle OpenAI priority service tier for fast-capable reasoning models.",
			slashCommands: ["fast"],
			execute(context) {
				const current = context.getFastMode();
				if (!current.supported) return { ...current, changed: false };
				return context.setFastMode(current.mode !== "fast");
			},
		});
		api.registerGatewayAction({
			name: "session.current",
			description: "Return the active Pi session metadata for this routed session.",
			slashCommands: ["session-current"],
			execute(context) {
				return context.getCurrentSession();
			},
		});
		api.registerGatewayAction({
			name: "session.list",
			description: "List persisted Pi sessions for this workspace.",
			slashCommands: ["sessions"],
			execute(context) {
				return context.listSessions();
			},
		});
		api.registerGatewayAction({
			name: "session.fork_candidates",
			description: "Return user messages that can be used as fork targets.",
			slashCommands: ["fork-candidates"],
			execute(context) {
				return { messages: context.getForkCandidates() };
			},
		});
		api.registerGatewayAction({
			name: "session.fork",
			description: "Fork before a selected user message and create a visible Pibo session for the fork.",
			async execute(context, event) {
				const params = requireForkParams(event);
				return await context.forkSession(params.entryId);
			},
		});
		api.registerGatewayAction({
			name: "session.clone",
			description: "Clone the current leaf and create a visible Pibo session for the clone.",
			slashCommands: ["clone"],
			execute(context) {
				return context.cloneSession();
			},
		});
		api.registerGatewayAction({
			name: "session.tree",
			description: "Return the current Pi session tree and active leaf.",
			slashCommands: ["tree"],
			execute(context) {
				return context.getSessionTree();
			},
		});
		api.registerGatewayAction({
			name: "session.tree_navigate",
			description: "Move the current Pi session leaf to a selected tree entry.",
			async execute(context, event) {
				return await context.navigateSessionTree(requireTreeNavigateParams(event));
			},
		});
		api.registerGatewayAction({
			name: "session.switch",
			description: "Switch the active Pi session to a persisted session file.",
			async execute(context, event) {
				return await context.switchSession(requireSwitchParams(event));
			},
		});
		api.registerGatewayAction({
			name: "login",
			description: "Open the interactive provider login menu.",
			slashCommands: ["login"],
			execute() {
				const statuses = new Map(getLoginStatus().map((status) => [status.id, status.configured]));
				return {
					action: "show_login_menu",
					providers: LOGIN_PROVIDERS.map((provider) => ({
						...provider,
						authMethods: [...provider.authMethods],
						configured: statuses.get(provider.id) ?? false,
					})),
				};
			},
		});
		api.registerGatewayAction({
			name: "model",
			description: "Open the interactive model selector for authenticated providers.",
			slashCommands: ["model"],
			async execute() {
				const catalog = await loadModelCatalog(process.cwd());
				return {
					action: "show_model_menu",
					providers: catalog.providers
						.filter((provider) => provider.authConfigured)
						.map((provider) => ({
							...provider,
							models: provider.models.filter((model) => model.authConfigured !== false),
						})),
				};
			},
		});
		api.registerGatewayAction({
			name: "login.start",
			description: "Start an OAuth login flow for a provider. Returns a URL to open in a browser.",
			slashCommands: [],
			async execute(_context, event) {
				const params = requireLoginStartParams(event);
				return await startLogin(params.provider);
			},
		});
		api.registerGatewayAction({
			name: "login.complete",
			description: "Complete an OAuth login flow with the authorization code from the provider callback.",
			slashCommands: [],
			async execute(_context, event) {
				const params = requireLoginCompleteParams(event);
				return await completeLogin(params.provider, params.code, params.state);
			},
		});
		api.registerGatewayAction({
			name: "login.apikey",
			description: "Set an API key directly for a provider.",
			slashCommands: [],
			execute(_context, event) {
				const params = requireLoginApiKeyParams(event);
				return setApiKey(params.provider, params.apiKey);
			},
		});
		api.registerGatewayAction({
			name: "login.status",
			description: "Check the authentication status for providers.",
			slashCommands: [],
			execute(_context, event) {
				const params = getObjectParams(event);
				const provider = typeof params?.provider === "string" ? params.provider : undefined;
				return { providers: getLoginStatus(provider) };
			},
		});
		api.registerGatewayAction({
			name: "logout",
			description: "Remove stored credentials for a provider.",
			slashCommands: [],
			execute(_context, event) {
				const params = requireLogoutParams(event);
				return removeLogin(params.provider);
			},
		});
	},
});

export const piboGatewayProducerPlugin = definePiboPlugin({
	id: "pibo.gateway-producer",
	name: "Pibo Gateway Producer",
	register(api) {
		api.registerTools(createPiboGatewayToolProfiles());
		api.registerProfile({
			name: "pibo-gateway-producer",
			aliases: ["gateway-producer"],
			description: "Pibo profile that can send messages through the local gateway.",
			create(context) {
				return createBaseProfileBuilder("pibo-gateway-producer", context)
					.addTools(context.getTools(GATEWAY_PROFILE_TOOLS))
					.createSession();
			},
		});
	},
});

export function createDefaultPiboPlugins(): PiboPlugin[] {
	return [piboCorePlugin, piboCodexCompatPlugin];
}

export function createGatewayProducerPiboPluginRegistry(): PiboPluginRegistry {
	return PiboPluginRegistry.create({
		plugins: [piboCorePlugin, piboGatewayProducerPlugin, piboCodexCompatPlugin],
	});
}

export function createDefaultPiboPluginRegistry(): PiboPluginRegistry {
	return PiboPluginRegistry.create({ plugins: createDefaultPiboPlugins() });
}

export function createDefaultPiboProfile(): InitialSessionContext {
	return createDefaultPiboPluginRegistry().createProfile("codex-compat-openai-web");
}

export function createGatewayProducerPiboProfile(): InitialSessionContext {
	return createGatewayProducerPiboPluginRegistry().createProfile("pibo-gateway-producer");
}
