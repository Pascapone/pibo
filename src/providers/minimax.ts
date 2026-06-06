import { getModels, type Model } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";
import {
	OPENAI_COMPLETIONS_API,
	registerOpenAiCompatProvider,
	resetOpenAiCompatProviderRegistration,
	unregisterOpenAiCompatProvider,
	type OpenAiCompatModelSpec,
	type OpenAiCompatProviderSpec,
	type OpenAiCompatRegistrationResult,
} from "./openai-compat.js";

export const MINIMAX_PROVIDER_ID = "minimax";
export const MINIMAX_CN_PROVIDER_ID = "minimax-cn";
export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimax.io/v1";
export const MINIMAX_CN_DEFAULT_BASE_URL = "https://api.minimax.cn/v1";
export const MINIMAX_API_KEY_ENV = "MINIMAX_API_KEY";
export const MINIMAX_CN_API_KEY_ENV = "MINIMAX_API_KEY";

export type MiniMaxProviderId =
	| typeof MINIMAX_PROVIDER_ID
	| typeof MINIMAX_CN_PROVIDER_ID;

export type MiniMaxModelInput = {
	provider?: string;
	id?: string;
};

export type MiniMaxModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "unregisterProvider" | "find">;

export const MINIMAX_M3_MODEL: OpenAiCompatModelSpec = {
	id: "MiniMax-M3",
	name: "MiniMax-M3",
	reasoning: true,
	contextWindow: 1000000,
	maxTokens: 131072,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	input: ["text", "image"],
};

function resolveBaseUrl(providerId: MiniMaxProviderId, defaultBaseUrl: string): string {
	const envKey = `PIBO_${providerId.toUpperCase().replace(/-/g, "_")}_BASE_URL`;
	const envOverride = process.env[envKey];
	return envOverride && envOverride.length > 0 ? envOverride : defaultBaseUrl;
}

function buildMiniMaxSpec(
	providerId: MiniMaxProviderId = MINIMAX_PROVIDER_ID,
	customModels: readonly OpenAiCompatModelSpec[] = [MINIMAX_M3_MODEL],
): OpenAiCompatProviderSpec {
	const defaultBaseUrl =
		providerId === MINIMAX_CN_PROVIDER_ID
			? MINIMAX_CN_DEFAULT_BASE_URL
			: MINIMAX_DEFAULT_BASE_URL;
	return {
		id: providerId,
		baseUrl: resolveBaseUrl(providerId, defaultBaseUrl),
		apiKeyEnv:
			providerId === MINIMAX_CN_PROVIDER_ID
				? MINIMAX_CN_API_KEY_ENV
				: MINIMAX_API_KEY_ENV,
		models: customModels,
	};
}

export function isMiniMaxProvider(provider: string | undefined | null): boolean {
	return provider === MINIMAX_PROVIDER_ID || provider === MINIMAX_CN_PROVIDER_ID;
}

export function findMiniMaxModel(
	modelRegistry: MiniMaxModelRegistryLike,
	model: MiniMaxModelInput,
): Model<any> | undefined {
	if (!model?.provider || !model.id) return undefined;
	if (!isMiniMaxProvider(model.provider)) return undefined;
	return modelRegistry.find(model.provider, model.id);
}

export function getBuiltInMiniMaxModels(providerId: MiniMaxProviderId = MINIMAX_PROVIDER_ID): Model<any>[] {
	try {
		return getModels(providerId as any) as Model<any>[];
	} catch {
		return [];
	}
}

export function registerMiniMaxProvider(
	modelRegistry: MiniMaxModelRegistryLike,
	options: {
		providerId?: MiniMaxProviderId;
		customModels?: readonly OpenAiCompatModelSpec[];
		baseModels?: readonly Model<any>[];
		force?: boolean;
	} = {},
): OpenAiCompatRegistrationResult {
	const providerId = options.providerId ?? MINIMAX_PROVIDER_ID;
	const spec = buildMiniMaxSpec(providerId, options.customModels ?? [MINIMAX_M3_MODEL]);
	const baseModels = options.baseModels ?? getBuiltInMiniMaxModels(providerId);
	return registerOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "registerProvider">,
		spec,
		{ baseModels, force: options.force },
	);
}

export function unregisterMiniMaxProvider(
	modelRegistry: MiniMaxModelRegistryLike,
	options: { providerId?: MiniMaxProviderId } = {},
): void {
	const providerId = options.providerId ?? MINIMAX_PROVIDER_ID;
	unregisterOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "unregisterProvider">,
		providerId,
	);
}

export function resetMiniMaxProviderRegistration(): void {
	resetOpenAiCompatProviderRegistration();
}

export function getDefaultMiniMaxModels(): readonly OpenAiCompatModelSpec[] {
	return [MINIMAX_M3_MODEL];
}

export { OPENAI_COMPLETIONS_API };
