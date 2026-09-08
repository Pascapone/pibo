import type { AgentSession, Skill } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";
import { preparePiPrefixNativeState, syncPiPrefixNativeState } from "./prefix-native-state.js";
import { resolvePiPrefixTransition } from "./prefix-lifecycle.js";

export const PI_CODEX_PREFIX_CODEC = "pi-0.85.0/openai-codex-responses/v3";
export const PI_RESPONSES_PREFIX_CODEC = "pi-0.85.0/openai-responses/v1";

export type PiPrefixSnapshot = {
	format: 3;
	systemPrompt: string;
	skills: Skill[];
	tools: NonNullable<Context["tools"]>;
	providerStatic: Record<string, unknown>;
	inputPrefix?: Record<string, unknown>[];
	modelConfiguration: Record<string, unknown>;
};

const PROVIDER_FIELDS = new Set([
	"model", "store", "stream", "instructions", "text", "include", "prompt_cache_key",
	"tool_choice", "parallel_tool_calls", "temperature", "service_tier", "tools", "reasoning",
	"max_output_tokens", "prompt_cache_retention", "prompt_cache_options",
]);

function codecForApi(api: string): string {
	if (api === "openai-codex-responses") return PI_CODEX_PREFIX_CODEC;
	if (api === "openai-responses") return PI_RESPONSES_PREFIX_CODEC;
	throw new PrefixRecoveryRequiredError("Pi prefix codec does not support this provider API");
}

function inputPrefixLength(input: unknown[]): number {
	let count = 0;
	while (true) {
		const item = input[count];
		if (!object(item) || !["system", "developer"].includes(String(item.role))) return count;
		if (++count > 32) throw new PrefixRecoveryRequiredError("unsupported provider input prefix layout");
	}
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Bounded model metadata controls historical Tool/Reasoning serialization too. */
function modelInputConfiguration(model: Model<Api>): Record<string, unknown> {
	if (typeof model.reasoning !== "boolean" || typeof model.provider !== "string" || !model.provider || model.provider.length > 256) throw new PrefixRecoveryRequiredError("invalid model input identity");
	const compat = model.compat as Record<string, unknown> | undefined;
	const flags = ["supportsDeveloperRole", "supportsLongCacheRetention", "supportsStrictMode", "supportsOpenAIGrammarTools",
		"supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens"];
	if (compat && (Object.keys(compat).some(key => !flags.includes(key) && key !== "sessionAffinityFormat")
		|| flags.some(key => compat[key] !== undefined && typeof compat[key] !== "boolean"))) throw new PrefixRecoveryRequiredError("unsupported model compatibility metadata");
	const reasoningLevels = ["off", "minimal", "low", "medium", "high", "xhigh"];
	if (model.thinkingLevelMap && (Object.keys(model.thinkingLevelMap).some(key => !reasoningLevels.includes(key))
		|| Object.values(model.thinkingLevelMap).some(value => value !== null && value !== undefined && (typeof value !== "string" || value.length > 64)))) throw new PrefixRecoveryRequiredError("unsupported reasoning mapping");
	const effective: Record<string, unknown> = {
		supportsStrictMode: compat?.supportsStrictMode ?? (model.api === "openai-codex-responses"),
		supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
		supportsAdditionalTools: compat?.supportsAdditionalTools ?? false,
		supportsToolSearch: compat?.supportsToolSearch ?? false,
	};
	if (model.api === "openai-responses") {
		const affinity = compat?.sessionAffinityFormat ?? (model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai") ? "openrouter" : "openai");
		if (!["openai", "openai-nosession", "openrouter"].includes(String(affinity))) throw new PrefixRecoveryRequiredError("unsupported session affinity format");
		Object.assign(effective, { sessionAffinityFormat: affinity, supportsDeveloperRole: compat?.supportsDeveloperRole ?? true,
			supportsLongCacheRetention: compat?.supportsLongCacheRetention ?? true, supportsMaxOutputTokens: compat?.supportsMaxOutputTokens ?? true,
			supportsExplicitPromptCacheMode: compat?.supportsExplicitPromptCacheMode ?? false });
	}
	return { provider: model.provider, reasoning: model.reasoning, compat: effective,
		thinkingLevelMap: Object.fromEntries(Object.entries(model.thinkingLevelMap ?? {}).filter(([, value]) => value !== undefined)) };
}

function decode(payload: string): PiPrefixSnapshot {
	let value: unknown;
	try { value = JSON.parse(payload); } catch { throw new PrefixRecoveryRequiredError("invalid Pi prefix payload"); }
	if (!object(value) || value.format !== 3 || !object(value.modelConfiguration) || typeof value.systemPrompt !== "string"
		|| !Array.isArray(value.skills) || value.skills.some(skill => !object(skill)
			|| typeof skill.name !== "string" || typeof skill.description !== "string"
			|| typeof skill.filePath !== "string" || typeof skill.baseDir !== "string"
			|| !object(skill.sourceInfo) || typeof skill.disableModelInvocation !== "boolean")
		|| !Array.isArray(value.tools) || !object(value.providerStatic)
		|| value.tools.some(tool => !object(tool) || typeof tool.name !== "string" || typeof tool.description !== "string" || !object(tool.parameters))) {
		throw new PrefixRecoveryRequiredError("unsupported Pi prefix payload");
	}
	for (const key of Object.keys(value.providerStatic)) {
		if (!PROVIDER_FIELDS.has(key)) throw new PrefixRecoveryRequiredError("unsupported Pi provider prefix field");
	}
	if (value.inputPrefix !== undefined && (!Array.isArray(value.inputPrefix)
		|| inputPrefixLength(value.inputPrefix) !== value.inputPrefix.length)) throw new PrefixRecoveryRequiredError("invalid Pi input prefix");
	return value as PiPrefixSnapshot;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function captureTools(tools: Context["tools"]): NonNullable<Context["tools"]> {
	// Executable closures and current credentials never enter the artifact.
	return (tools ?? []).map(tool => ({
		name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters),
		...(tool.constrainedSampling === undefined ? {} : { constrainedSampling: structuredClone(tool.constrainedSampling) }),
	}));
}

function inferenceFacts(snapshot: PiPrefixSnapshot): { cacheKeyDigest?: string; configurationDigest: string } {
	const fields = ["model", "reasoning", "text", "service_tier", "temperature"];
	return {
		configurationDigest: createHash("sha256").update(JSON.stringify([snapshot.modelConfiguration, fields.map(key => [key, snapshot.providerStatic[key]])])).digest("hex"),
		...(typeof snapshot.providerStatic.prompt_cache_key === "string" ? {
			cacheKeyDigest: createHash("sha256").update(`pibo-cache-key\0${snapshot.providerStatic.prompt_cache_key}`).digest("hex"),
		} : {}),
	};
}

/** Provider-executed tools cannot rely on Pibo's later local execution checks. */
function assertProviderToolAuthorization(snapshot: PiPrefixSnapshot, current: Record<string, unknown>): void {
	const frozenTools = snapshot.providerStatic.tools;
	if (frozenTools === undefined) return;
	if (!Array.isArray(frozenTools) || current.tools !== undefined && !Array.isArray(current.tools)) {
		throw new PrefixRecoveryRequiredError("unexpected provider tool envelope");
	}
	const available = new Map((Array.isArray(current.tools) ? current.tools : [])
		.filter((tool): tool is Record<string, unknown> => object(tool) && typeof tool.type === "string")
		.map(tool => [tool.type, tool]));
	for (const tool of frozenTools) {
		if (!object(tool) || typeof tool.type !== "string") throw new PrefixRecoveryRequiredError("invalid frozen provider tool");
		if (tool.type === "function" || tool.type === "custom") {
			const fields = tool.type === "function" ? ["type", "name", "description", "parameters", "strict", "defer_loading"] : ["type", "name", "description", "format"];
			if (Object.entries(tool).some(([key, value]) => value !== undefined && !fields.includes(key))) throw new PrefixRecoveryRequiredError("unsupported local provider tool fields");
			continue;
		}
		if (tool.type !== "web_search" || Object.keys(tool).some(key => !["type", "external_web_access", "filters", "user_location", "search_context_size"].includes(key))) {
			throw new PrefixRecoveryRequiredError("unsupported provider tool fields require a compatible prefix codec");
		}
		const offered = available.get(tool.type);
		if (!offered) throw new PrefixRecoveryRequiredError("a frozen provider tool is no longer available under current authorization");
		if (!isDeepStrictEqual(tool.filters, offered.filters) || tool.external_web_access !== offered.external_web_access) {
			throw new PrefixRecoveryRequiredError("provider tool authorization filters changed; explicit transition required");
		}
	}
}

/** Read before SDK resource discovery, not after live context was rebuilt. */
export async function restorePiPrefix(controller: SessionPrefixController): Promise<PiPrefixSnapshot | undefined> {
	const codec = controller.binding?.capsule.codec ?? PI_CODEX_PREFIX_CODEC;
	if (![PI_CODEX_PREFIX_CODEC, PI_RESPONSES_PREFIX_CODEC].includes(codec)) throw new PrefixRecoveryRequiredError("unsupported Pi prefix codec");
	const restored = await controller.restore(codec);
	if (restored === undefined) return undefined;
	const snapshot = decode(restored);
	if (codec === PI_RESPONSES_PREFIX_CODEC && !snapshot.inputPrefix) throw new PrefixRecoveryRequiredError("missing Pi Responses input prefix");
	return deepFreeze(snapshot);
}

/**
 * Narrow codec at the SDK's final onPayload seam, after provider extensions.
 * This is an adapter-input proof, not a claim that mutable native history or
 * resource paths have already met the complete session-resume contract.
 * Unsupported APIs/configuration transitions fail instead of rewriting them.
 */
export async function installPiPrefixCodec(
	session: AgentSession,
	controller: SessionPrefixController,
	preparedSnapshot?: PiPrefixSnapshot,
): Promise<void> {
	let snapshot = preparedSnapshot ?? await restorePiPrefix(controller);
	let codec = controller.binding?.capsule.codec;
	let facts = snapshot ? inferenceFacts(snapshot) : undefined;
	const historical = session.sessionManager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant");
	if (!snapshot && historical) throw new PrefixRecoveryRequiredError("Pi history has no captured original prefix");
	if (snapshot && controller.binding?.nativeSessionId !== session.sessionId) throw new PrefixRecoveryRequiredError("restored Pi session identity changed");
	await preparePiPrefixNativeState(session, Boolean(snapshot));
	await resolvePiPrefixTransition(session, controller);
	if (snapshot) {
		const available = new Map(session.agent.state.tools.map(tool => [tool.name, tool]));
		for (const tool of snapshot.tools) {
			const current = available.get(tool.name);
			if (!current || JSON.stringify(current.parameters) !== JSON.stringify(tool.parameters)
				|| JSON.stringify(current.constrainedSampling) !== JSON.stringify(tool.constrainedSampling)) {
				throw new PrefixRecoveryRequiredError(`frozen Pi tool ${tool.name} is unavailable or incompatible`);
			}
		}
		session.agent.state.systemPrompt = snapshot.systemPrompt;
	}
	const stream = session.agent.streamFunction;
	session.agent.streamFunction = async (model, context, options) => {
		// Compaction uses a separate summarization prompt and must retain native semantics.
		if (session.isCompacting) return stream(model, context, options);
		await resolvePiPrefixTransition(session, controller);
		const requestCodec = codecForApi(model.api);
		if (codec && codec !== requestCodec) throw new PrefixRecoveryRequiredError("provider API change requires an explicit prefix epoch transition");
		const modelConfiguration = modelInputConfiguration(model);
		if (snapshot && !isDeepStrictEqual(snapshot.modelConfiguration, modelConfiguration)) throw new PrefixRecoveryRequiredError("model input configuration changed; explicit transition required");
		if (snapshot && snapshot.providerStatic.model !== model.id) throw new PrefixRecoveryRequiredError("model change requires an explicit prefix epoch transition");
		if (snapshot) session.agent.state.systemPrompt = snapshot.systemPrompt;
		const frozenContext: Context = snapshot
			? { ...context, systemPrompt: snapshot.systemPrompt, tools: snapshot.tools }
			: context;
		const previousPayload = options?.onPayload;
		return stream(model, frozenContext, {
			...options,
			onPayload: async (raw, requestModel) => {
				const transformed = await previousPayload?.(raw, requestModel) ?? raw;
				if (!object(transformed) || !Array.isArray(transformed.input)) throw new PrefixRecoveryRequiredError("unexpected Pi provider payload");
				for (const key of Object.keys(transformed)) {
					if (key !== "input" && !PROVIDER_FIELDS.has(key)) throw new PrefixRecoveryRequiredError("new provider field requires a compatible prefix codec");
				}
				if (transformed.prompt_cache_options !== undefined && (!object(transformed.prompt_cache_options)
					|| transformed.prompt_cache_options.mode !== "explicit" || Object.keys(transformed.prompt_cache_options).some(key => key !== "mode"))) {
					throw new PrefixRecoveryRequiredError("unsupported prompt cache options");
				}
				const embeddedPrefixLength = requestCodec === PI_RESPONSES_PREFIX_CODEC ? inputPrefixLength(transformed.input) : undefined;
				if (embeddedPrefixLength !== undefined && Object.isFrozen(transformed.input)) throw new PrefixRecoveryRequiredError("provider input envelope cannot restore its prefix");
				if (!snapshot) {
					const providerStatic: Record<string, unknown> = {};
					for (const key of Object.keys(transformed)) if (key !== "input") providerStatic[key] = structuredClone(transformed[key]);
					const captured: PiPrefixSnapshot = {
						format: 3, modelConfiguration: structuredClone(modelConfiguration), systemPrompt: frozenContext.systemPrompt ?? "", skills: structuredClone(session.resourceLoader.getSkills().skills),
						tools: captureTools(frozenContext.tools), providerStatic,
						...(embeddedPrefixLength !== undefined ? { inputPrefix: structuredClone(transformed.input.slice(0, embeddedPrefixLength)) } : {}),
					};
					assertProviderToolAuthorization(captured, transformed);
					await syncPiPrefixNativeState(session);
					await controller.seal({
						codec: requestCodec, payload: JSON.stringify(captured), nativeSessionId: session.sessionId,
						evidence: "adapter-inputs", hasHistoricalModelInput: historical,
					});
					snapshot = deepFreeze(captured);
					codec = requestCodec;
					facts = inferenceFacts(snapshot);
				}
				// Configuration changes are not silently undone. They need a visible epoch transition.
				for (const key of ["model", "reasoning", "text", "service_tier", "temperature", "prompt_cache_key", "tool_choice", "max_output_tokens", "prompt_cache_retention", "prompt_cache_options"]) {
					if (JSON.stringify(transformed[key]) !== JSON.stringify(snapshot.providerStatic[key])) {
						throw new PrefixRecoveryRequiredError("provider configuration or cache affinity changed; explicit transition required");
					}
				}
				assertProviderToolAuthorization(snapshot, transformed);
				if (embeddedPrefixLength !== undefined) {
					if (snapshot.inputPrefix?.length !== embeddedPrefixLength) throw new PrefixRecoveryRequiredError("provider input prefix layout changed; explicit transition required");
					// The SDK owns this freshly converted request array. Replace only
					// its bounded static slots; do not copy or scan native history.
					for (let index = 0; index < embeddedPrefixLength; index++) transformed.input[index] = snapshot.inputPrefix[index];
				}
				// Only a shallow envelope allocation; no per-turn history or tools serialization.
				controller.recordInference(facts!);
				return { ...snapshot.providerStatic, input: transformed.input };
			},
		});
	};
}
