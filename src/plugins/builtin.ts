import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	PiboApprovalResponseParams,
	PiboExecutionEvent,
	PiboJsonObject,
	PiboSessionForkParams,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboThinkingParams,
	PiboUserInputResponseParams,
} from "../core/events.js";
import { InitialSessionContext, InitialSessionContextBuilder, type SkillProfile } from "../core/profiles.js";
import { createDefaultPiboProfile, DEFAULT_PIBO_PROFILE_NAME } from "../core/default-profile.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";
import { loadModelCatalog } from "../apps/chat/model-catalog.js";
import { piboCodexNativePlugin } from "./codex-native.js";
import { piboOmpPlugin } from "./omp.js";
import { piboOpenAiChatGptTranscriptionPlugin } from "./openai-chatgpt-transcription.js";
import { piboOpenAiTranscriptionPlugin } from "./openai-transcription.js";
import { definePiboPlugin, PiboPluginRegistry } from "./registry.js";
import { createAgentPluginSelectionForProfile } from "./selection.js";
import type { PiboGatewayAction, PiboPlugin, PiboProfileBuildContext } from "./types.js";

export { createDefaultPiboProfile, DEFAULT_PIBO_PROFILE_NAME } from "../core/default-profile.js";
export {
	CODEX_NATIVE_PROFILE_NAME,
	CODEX_NATIVE_RUNTIME_INSTANCE_ID,
	piboCodexNativePlugin,
} from "./codex-native.js";
export {
	OMP_PROFILE_NAME,
	OMP_RUNTIME_INSTANCE_ID,
	piboOmpPlugin,
} from "./omp.js";

const GATEWAY_PROFILE_TOOLS = ["pibo_gateway_send"] as const;
const PIBO_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function builtinSkillPath(name: string): string {
	return resolve(PIBO_PACKAGE_ROOT, "skills", "builtin", name, "SKILL.md");
}

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

function requireApprovalResponseParams(event: PiboExecutionEvent): PiboApprovalResponseParams {
	const params = getObjectParams(event);
	if (!params || typeof params.requestId !== "string" || !params.requestId.trim()) {
		throw new Error("runtime.approval.respond requires params.requestId");
	}
	if (typeof params.decision !== "string" || !params.decision.trim()) {
		throw new Error("runtime.approval.respond requires params.decision");
	}
	return { requestId: params.requestId, decision: params.decision };
}

function requireUserInputResponseParams(event: PiboExecutionEvent): PiboUserInputResponseParams {
	const params = getObjectParams(event);
	if (!params || typeof params.requestId !== "string" || !params.requestId.trim()) {
		throw new Error("runtime.user_input.respond requires params.requestId");
	}
	if (!params.answers || typeof params.answers !== "object" || Array.isArray(params.answers)) {
		throw new Error("runtime.user_input.respond requires params.answers");
	}
	return { requestId: params.requestId, answers: params.answers as PiboJsonObject };
}

function requireLoginStartParams(event: PiboExecutionEvent): {
	provider: string;
	method?: "device_code" | "browser_oauth";
} {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.start requires params.provider");
	}
	if (params.method !== undefined && params.method !== "device_code" && params.method !== "browser_oauth") {
		throw new Error("login.start params.method must be device_code or browser_oauth");
	}
	return { provider: params.provider, method: params.method };
}

function requireLoginCompleteParams(event: PiboExecutionEvent): { provider: string; code?: string; flowId: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.complete requires params.provider");
	}
	if (params.code !== undefined && typeof params.code !== "string") {
		throw new Error("login.complete params.code must be a string when provided");
	}
	const flowId = typeof params.flowId === "string" && params.flowId.length > 0
		? params.flowId
		: typeof params.state === "string" && params.state.length > 0
			? params.state
			: undefined;
	if (!flowId) throw new Error("login.complete requires params.flowId");
	return { provider: params.provider, code: params.code, flowId };
}

function requireLoginCancelParams(event: PiboExecutionEvent): { provider: string; flowId: string } {
	const params = getObjectParams(event);
	if (!params || typeof params.provider !== "string" || params.provider.length === 0) {
		throw new Error("login.cancel requires params.provider");
	}
	const flowId = typeof params.flowId === "string" && params.flowId.length > 0
		? params.flowId
		: typeof params.state === "string" && params.state.length > 0
			? params.state
			: undefined;
	if (!flowId) throw new Error("login.cancel requires params.flowId");
	return { provider: params.provider, flowId };
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
	return new InitialSessionContextBuilder(profileName)
		.withToolPackages({ goalControl: true })
		.addSkill(context.getSkill("pi-agent-harness"));
}

export type PiboCoreContributionSink = {
	addSkill(skill: SkillProfile): void;
	addGatewayAction(action: PiboGatewayAction): void;
};

export function definePiboCoreContributions(sink: PiboCoreContributionSink): void {
		sink.addSkill({
			name: "pi-agent-harness",
			path: builtinSkillPath("pi-agent-harness"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "pibo-agent-runtime-adapter",
			path: builtinSkillPath("pibo-agent-runtime-adapter"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "pibo-spec-writing",
			path: builtinSkillPath("pibo-spec-writing"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "pibo-docker-system",
			path: builtinSkillPath("pibo-docker-system"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "graphify",
			path: builtinSkillPath("graphify"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "prd",
			path: builtinSkillPath("prd"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "skill-creator",
			path: builtinSkillPath("skill-creator"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "loop",
			path: builtinSkillPath("loop"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "ralph-loop",
			path: builtinSkillPath("ralph-loop"),
			kind: "builtin",
		});
		sink.addSkill({
			name: "ralph-prd-json",
			path: builtinSkillPath("ralph-prd-json"),
			kind: "builtin",
		});
		sink.addGatewayAction({
			name: "status",
			description: "Return current session status with context usage quota.",
			slashCommands: ["status"],
			execute(context) {
				return context.getStatusSnapshot();
			},
		});
		sink.addGatewayAction({
			name: "compact",
			description: "Manually compact the session context.",
			slashCommands: ["compact"],
			async execute(context, event) {
				const params = getObjectParams(event);
				const customInstructions = typeof params?.customInstructions === "string" ? params.customInstructions : undefined;
				return await context.compact(customInstructions);
			},
		});
		sink.addGatewayAction({
			name: "runtime.approval.respond",
			description: "Respond to a pending runtime approval request.",
			hidden: true,
			async execute(context, event) {
				const params = requireApprovalResponseParams(event);
				await context.respondToApproval(params.requestId, params.decision);
				return { requestId: params.requestId, responded: true };
			},
		});
		sink.addGatewayAction({
			name: "runtime.user_input.respond",
			description: "Respond to a pending structured runtime user-input request.",
			hidden: true,
			async execute(context, event) {
				const params = requireUserInputResponseParams(event);
				await context.respondToUserInput(params.requestId, params.answers);
				return { requestId: params.requestId, responded: true };
			},
		});
		sink.addGatewayAction({
			name: "session_id",
			description: "Return the routed Pibo session id.",
			slashCommands: ["session"],
			execute(context) {
				return { piboSessionId: context.piboSessionId };
			},
		});
		sink.addGatewayAction({
			name: "clear_queue",
			description: "Clear queued messages that have not started yet.",
			slashCommands: ["clear"],
			execute(context) {
				return { cleared: context.clearQueue() };
			},
		});
		sink.addGatewayAction({
			name: "abort",
			description: "Abort the active Pi agent run.",
			slashCommands: ["abort"],
			async execute(context) {
				await context.abort();
				return { aborted: true };
			},
		});
		sink.addGatewayAction({
			name: "kill",
			description: "Kill the active agent run and all subagent sessions recursively.",
			slashCommands: ["kill"],
			async execute(context) {
				return await context.kill();
			},
		});
		sink.addGatewayAction({
			name: "kill_all",
			description: "Kill the active agent run, all subagent sessions recursively, and all yielded runs.",
			slashCommands: ["kill-all"],
			async execute(context) {
				return await context.killAll();
			},
		});
		sink.addGatewayAction({
			name: "dispose",
			description: "Dispose the routed session runtime.",
			hidden: true,
			async execute(context) {
				await context.dispose();
				return { disposed: true };
			},
		});
		sink.addGatewayAction({
			name: "thinking",
			description: "Show or set the active runtime reasoning level.",
			slashCommands: ["thinking"],
			execute(context, event) {
				const params = getThinkingParams(event);
				if (!params.level) return { ...context.getThinkingLevel(), action: "show_thinking_menu" };
				const previousLevel = context.getThinkingLevel().level;
				const result = context.setThinkingLevel(params.level);
				return {
					...result,
					action: "set_thinking_level",
					previousLevel,
					changed: previousLevel !== result.level,
				};
			},
		});
		sink.addGatewayAction({
			name: "fast_mode",
			description: "Toggle OpenAI priority service tier for fast-capable reasoning models.",
			slashCommands: ["fast"],
			execute(context) {
				const current = context.getFastMode();
				if (!current.supported) return { ...current, changed: false };
				return context.setFastMode(current.mode !== "fast");
			},
		});
		sink.addGatewayAction({
			name: "session.current",
			description: "Return the active Pi session metadata for this routed session.",
			slashCommands: ["session-current"],
			execute(context) {
				return context.getCurrentSession();
			},
		});
		sink.addGatewayAction({
			name: "session.list",
			description: "List persisted Pi sessions for this workspace.",
			slashCommands: ["sessions"],
			execute(context) {
				return context.listSessions();
			},
		});
		sink.addGatewayAction({
			name: "session.fork_candidates",
			description: "Return user messages that can be used as fork targets.",
			slashCommands: ["fork-candidates"],
			async execute(context) {
				return { messages: await context.getForkCandidates() };
			},
		});
		sink.addGatewayAction({
			name: "session.fork",
			description: "Fork before a selected user message and create a visible Pibo session for the fork.",
			async execute(context, event) {
				const params = requireForkParams(event);
				return await context.forkSession(params.entryId);
			},
		});
		sink.addGatewayAction({
			name: "session.clone",
			description: "Clone the current leaf and create a visible Pibo session for the clone.",
			slashCommands: ["clone"],
			execute(context) {
				return context.cloneSession();
			},
		});
		sink.addGatewayAction({
			name: "session.tree",
			description: "Return the current Pi session tree and active leaf.",
			slashCommands: ["tree"],
			execute(context) {
				return context.getSessionTree();
			},
		});
		sink.addGatewayAction({
			name: "session.tree_navigate",
			description: "Move the current Pi session leaf to a selected tree entry.",
			async execute(context, event) {
				return await context.navigateSessionTree(requireTreeNavigateParams(event));
			},
		});
		sink.addGatewayAction({
			name: "session.switch",
			description: "Switch the active Pi session to a persisted session file.",
			async execute(context, event) {
				return await context.switchSession(requireSwitchParams(event));
			},
		});
		sink.addGatewayAction({
			name: "login",
			description: "Open the interactive provider login menu for the active runtime.",
			slashCommands: ["login"],
			async execute(context) {
				const statuses = await context.getRuntimeAuthStatus();
				return {
					action: "show_login_menu",
					runtimeInstanceId: context.runtimeInstanceId,
					providers: statuses.map((status) => ({
						id: status.id,
						name: status.displayName ?? status.id,
						authMethods: status.methods.map((method) => method.id),
						configured: status.configured,
						state: status.state,
						message: status.message,
					})),
				};
			},
		});
		sink.addGatewayAction({
			name: "model",
			description: "Open the interactive model selector for the active runtime.",
			slashCommands: ["model"],
			async execute(context) {
				const runtimeCatalog = await context.getModelCatalog();
				if (runtimeCatalog) {
					let authStatusAvailable = false;
					let authStatuses = new Map<string, boolean>();
					try {
						const statuses = await context.getRuntimeAuthStatus();
						authStatusAvailable = true;
						authStatuses = new Map(statuses.map((status) => [status.id, status.configured]));
					} catch {
						// Runtimes that do not declare auth may use model-catalog compatibility metadata.
					}
					const providers = new Map<string, {
						id: string;
						label: string;
						authConfigured: boolean;
						models: Array<{ provider: string; id: string; label: string; supportsReasoning?: boolean }>;
					}>();
					for (const model of runtimeCatalog.models) {
						const providerId = model.provider ?? runtimeCatalog.runtimeInstanceId;
						const providerLabel = typeof model.options?.providerDisplayName === "string"
							? model.options.providerDisplayName
							: providerId;
						const authConfigured = authStatuses.get(providerId)
							?? (authStatusAvailable
								? false
								: typeof model.options?.authConfigured === "boolean"
									? model.options.authConfigured
									: !context.runtimeAuthRequired);
						let provider = providers.get(providerId);
						if (!provider) {
							provider = { id: providerId, label: providerLabel, authConfigured, models: [] };
							providers.set(providerId, provider);
						}
						provider.models.push({
							provider: providerId,
							id: model.id,
							label: model.displayName ?? model.id,
							...(model.reasoningOptions ? { supportsReasoning: model.reasoningOptions.length > 0 } : {}),
						});
					}
					return { action: "show_model_menu", providers: [...providers.values()] };
				}
				const catalog = await loadModelCatalog(process.cwd());
				return {
					action: "show_model_menu",
					providers: catalog.providers.map((provider) => ({
						...provider,
						models: provider.models,
					})),
				};
			},
		});
		sink.addGatewayAction({
			name: "login.start",
			description: "Start a provider login flow for the active runtime.",
			slashCommands: [],
			async execute(context, event) {
				const params = requireLoginStartParams(event);
				const status = (await context.getRuntimeAuthStatus()).find((candidate) => candidate.id === params.provider);
				const method = params.method ?? status?.methods.find((candidate) => candidate.id !== "api_key")?.id;
				if (method !== "device_code" && method !== "browser_oauth") {
					throw new Error(`Provider "${params.provider}" does not expose an interactive login method.`);
				}
				const result = await context.startRuntimeAuth({ providerId: params.provider, method });
				return {
					...result,
					runtimeInstanceId: context.runtimeInstanceId,
					...(result.flow ? {
						type: result.flow.method,
						url: result.flow.verificationUrl,
						verificationUrl: result.flow.verificationUrl,
						userCode: result.flow.userCode,
						instructions: result.flow.instructions,
						flowId: result.flow.flowId,
						state: result.flow.flowId,
					} : {}),
				};
			},
		});
		sink.addGatewayAction({
			name: "login.complete",
			description: "Read or complete a provider login flow for the active runtime.",
			slashCommands: [],
			async execute(context, event) {
				const params = requireLoginCompleteParams(event);
				return {
					...(await context.completeRuntimeAuth({ providerId: params.provider, flowId: params.flowId, code: params.code })),
					runtimeInstanceId: context.runtimeInstanceId,
				};
			},
		});
		sink.addGatewayAction({
			name: "login.apikey",
			description: "Set an API key for a provider on the active runtime.",
			slashCommands: [],
			async execute(context, event) {
				const params = requireLoginApiKeyParams(event);
				return {
					...(await context.startRuntimeAuth({ providerId: params.provider, method: "api_key", apiKey: params.apiKey })),
					runtimeInstanceId: context.runtimeInstanceId,
				};
			},
		});
		sink.addGatewayAction({
			name: "login.cancel",
			description: "Cancel a pending provider login for the active runtime.",
			slashCommands: [],
			async execute(context, event) {
				const params = requireLoginCancelParams(event);
				return {
					...(await context.cancelRuntimeAuth({ providerId: params.provider, flowId: params.flowId })),
					runtimeInstanceId: context.runtimeInstanceId,
				};
			},
		});
		sink.addGatewayAction({
			name: "login.status",
			description: "Check provider authentication status for the active runtime.",
			slashCommands: [],
			async execute(context, event) {
				const params = getObjectParams(event);
				const provider = typeof params?.provider === "string" ? params.provider : undefined;
				const providers = await context.getRuntimeAuthStatus();
				return {
					runtimeInstanceId: context.runtimeInstanceId,
					providers: provider ? providers.filter((status) => status.id === provider) : providers,
				};
			},
		});
	sink.addGatewayAction({
		name: "logout",
		description: "Remove stored credentials for a provider on the active runtime.",
		slashCommands: [],
		async execute(context, event) {
			const params = requireLogoutParams(event);
			return {
				...(await context.logoutRuntimeAuth({ providerId: params.provider })),
				runtimeInstanceId: context.runtimeInstanceId,
			};
		},
	});
}

export const piboCorePlugin = definePiboPlugin({
	id: "pibo.core",
	name: "Pibo Core",
	register(api) {
		definePiboCoreContributions({ addSkill: (skill) => api.registerSkill(skill), addGatewayAction: (action) => api.registerGatewayAction(action) });
	},
});

export const piboGatewayProducerPlugin = definePiboPlugin({
	id: "pibo.gateway-producer",
	name: "Pibo Gateway Producer",
	register(api) {
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
	return [piboCorePlugin, piboOpenAiChatGptTranscriptionPlugin, piboOpenAiTranscriptionPlugin];
}

export function createGatewayProducerPiboPluginRegistry(): PiboPluginRegistry {
	return PiboPluginRegistry.create({
		plugins: [piboCorePlugin, piboGatewayProducerPlugin, piboOpenAiChatGptTranscriptionPlugin, piboOpenAiTranscriptionPlugin],
	});
}

export function createDefaultPiboPluginRegistry(): PiboPluginRegistry {
	return PiboPluginRegistry.create({ plugins: createDefaultPiboPlugins() });
}

export function selectDefaultPiboProfileName(registry: PiboPluginRegistry): string {
	const names = registry.getProfileNames();
	return names.includes(DEFAULT_PIBO_PROFILE_NAME) ? DEFAULT_PIBO_PROFILE_NAME : names[0] ?? DEFAULT_PIBO_PROFILE_NAME;
}

export function resolvePiboProfileNameFromRegistryOrDefault(registry: PiboPluginRegistry, profileName?: string): string {
	const requestedProfileName = profileName ?? selectDefaultPiboProfileName(registry);
	try {
		return registry.resolveProfileName(requestedProfileName);
	} catch (error) {
		if (requestedProfileName === DEFAULT_PIBO_PROFILE_NAME) return DEFAULT_PIBO_PROFILE_NAME;
		if (requestedProfileName === "default") return selectDefaultPiboProfileName(registry);
		throw error;
	}
}

export function createPiboProfileFromRegistryOrDefault(registry: PiboPluginRegistry, profileName?: string): InitialSessionContext {
	const resolvedProfileName = resolvePiboProfileNameFromRegistryOrDefault(registry, profileName);
	const profile = resolvedProfileName === DEFAULT_PIBO_PROFILE_NAME && !registry.getProfileNames().includes(DEFAULT_PIBO_PROFILE_NAME)
		? createDefaultPiboProfile()
		: registry.createProfile(resolvedProfileName);
	if (profile.pluginSelection) return profile;
	const installations = registry.getPluginHost().inspect().plugins.filter((installation) =>
		installation.enabled
		&& ["active", "pending-activation"].includes(installation.state)
		&& installation.manifest.contributions.some((contribution) => contribution.scope === "agent"),
	);
	if (installations.length === 0) return profile;
	return new InitialSessionContext({
		...profile,
		pluginSelection: createAgentPluginSelectionForProfile(installations, profile),
		pluginSelectionRevision: installations.reduce((sum, installation) => sum + installation.stateRevision, 0),
	});
}

export function createGatewayProducerPiboProfile(): InitialSessionContext {
	return createGatewayProducerPiboPluginRegistry().createProfile("pibo-gateway-producer");
}
