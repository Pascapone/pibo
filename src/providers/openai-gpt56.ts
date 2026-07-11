import type { Model } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const OPENAI_PROVIDER_ID = "openai";
export const OPENAI_RESPONSES_API = "openai-responses";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
export const OPENAI_CODEX_RESPONSES_API = "openai-codex-responses";
export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export type OpenAiGpt56ModelId =
	| "gpt-5.6"
	| "gpt-5.6-sol"
	| "gpt-5.6-terra"
	| "gpt-5.6-luna";

export type OpenAiGpt56ModelSpec = {
	id: OpenAiGpt56ModelId;
	name: string;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
};

export type OpenAiGpt56RegistrationResult = {
	registered: boolean;
	providers: number;
	models: number;
	added: number;
};

export type OpenAiGpt56ModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "find">;

const OPENAI_GPT_56_CONTEXT_WINDOW = 1_050_000;
const OPENAI_CODEX_GPT_56_CONTEXT_WINDOW = 272_000;
const GPT_56_MAX_TOKENS = 128_000;

export const OPENAI_GPT_56_MODELS: readonly OpenAiGpt56ModelSpec[] = [
	{
		id: "gpt-5.6",
		name: "GPT-5.6 (Sol alias)",
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		id: "gpt-5.6-sol",
		name: "GPT-5.6 Sol",
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		id: "gpt-5.6-terra",
		name: "GPT-5.6 Terra",
		cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
	},
	{
		id: "gpt-5.6-luna",
		name: "GPT-5.6 Luna",
		cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
	},
];

const OPENAI_GPT_56_MODEL_IDS = new Set(OPENAI_GPT_56_MODELS.map((model) => model.id));

export function getBuiltInOpenAiModels(): Model<any>[] {
	return getBuiltInProviderModels(OPENAI_PROVIDER_ID);
}

export function getBuiltInOpenAiCodexModels(): Model<any>[] {
	return getBuiltInProviderModels(OPENAI_CODEX_PROVIDER_ID);
}

export function buildOpenAiGpt56Models(
	baseModels: readonly Model<any>[] = getBuiltInOpenAiModels(),
): Model<any>[] {
	return buildProviderGpt56Models({
		providerId: OPENAI_PROVIDER_ID,
		api: OPENAI_RESPONSES_API,
		baseUrl: OPENAI_BASE_URL,
		contextWindow: OPENAI_GPT_56_CONTEXT_WINDOW,
		thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
		baseModels,
		modelCost: (model) => model.cost,
	});
}

export function buildOpenAiCodexGpt56Models(
	baseModels: readonly Model<any>[] = getBuiltInOpenAiCodexModels(),
): Model<any>[] {
	return buildProviderGpt56Models({
		providerId: OPENAI_CODEX_PROVIDER_ID,
		api: OPENAI_CODEX_RESPONSES_API,
		baseUrl: OPENAI_CODEX_BASE_URL,
		contextWindow: OPENAI_CODEX_GPT_56_CONTEXT_WINDOW,
		thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
		baseModels,
		modelCost: (model) => ({ ...model.cost, cacheWrite: 0 }),
	});
}

export function registerOpenAiGpt56Models(
	modelRegistry: OpenAiGpt56ModelRegistryLike,
	options: {
		baseOpenAiModels?: readonly Model<any>[];
		baseOpenAiCodexModels?: readonly Model<any>[];
	} = {},
): OpenAiGpt56RegistrationResult {
	const baseOpenAiModels = options.baseOpenAiModels ?? getBuiltInOpenAiModels();
	const openAiModels = buildOpenAiGpt56Models(baseOpenAiModels);
	const openAiAdded = countMissingGpt56Models(baseOpenAiModels, OPENAI_PROVIDER_ID);

	modelRegistry.registerProvider(OPENAI_PROVIDER_ID, {
		baseUrl: OPENAI_BASE_URL,
		api: OPENAI_RESPONSES_API,
		apiKey: OPENAI_API_KEY_ENV,
		models: openAiModels,
	});

	const baseOpenAiCodexModels = options.baseOpenAiCodexModels ?? getBuiltInOpenAiCodexModels();
	const openAiCodexModels = buildOpenAiCodexGpt56Models(baseOpenAiCodexModels);
	const openAiCodexAdded = countMissingGpt56Models(baseOpenAiCodexModels, OPENAI_CODEX_PROVIDER_ID);
	const openAiCodexOAuth = getOpenAiCodexOAuthConfig();

	modelRegistry.registerProvider(OPENAI_CODEX_PROVIDER_ID, {
		name: openAiCodexOAuth.name,
		baseUrl: OPENAI_CODEX_BASE_URL,
		api: OPENAI_CODEX_RESPONSES_API,
		oauth: openAiCodexOAuth,
		models: openAiCodexModels,
	});

	return {
		registered: true,
		providers: 2,
		models: openAiModels.length + openAiCodexModels.length,
		added: openAiAdded + openAiCodexAdded,
	};
}

export function findOpenAiGpt56Model(
	modelRegistry: Pick<ModelRegistry, "find">,
	model: { provider?: string; id?: string } | undefined,
): Model<any> | undefined {
	if (!model?.provider || !model.id) return undefined;
	if (model.provider !== OPENAI_PROVIDER_ID && model.provider !== OPENAI_CODEX_PROVIDER_ID) return undefined;
	if (!OPENAI_GPT_56_MODEL_IDS.has(model.id as OpenAiGpt56ModelId)) return undefined;
	return modelRegistry.find(model.provider, model.id);
}

function getBuiltInProviderModels(providerId: string): Model<any>[] {
	try {
		return getModels(providerId as any) as Model<any>[];
	} catch {
		return [];
	}
}

function buildProviderGpt56Models(options: {
	providerId: string;
	api: string;
	baseUrl: string;
	contextWindow: number;
	thinkingLevelMap: Model<any>["thinkingLevelMap"];
	baseModels: readonly Model<any>[];
	modelCost: (model: OpenAiGpt56ModelSpec) => OpenAiGpt56ModelSpec["cost"];
}): Model<any>[] {
	const providerBaseModels = options.baseModels
		.filter((model) => model.provider === options.providerId)
		.map(cloneModel);
	const existingIds = new Set(providerBaseModels.map((model) => model.id));
	const additions = OPENAI_GPT_56_MODELS
		.filter((model) => !existingIds.has(model.id))
		.map((model) => openAiGpt56ModelToRegistryModel(model, options));

	return [...providerBaseModels, ...additions];
}

function countMissingGpt56Models(baseModels: readonly Model<any>[], providerId: string): number {
	const existingIds = new Set(baseModels.filter((model) => model.provider === providerId).map((model) => model.id));
	return OPENAI_GPT_56_MODELS.filter((model) => !existingIds.has(model.id)).length;
}

function cloneModel(model: Model<any>): Model<any> {
	return {
		...model,
		input: [...model.input],
		cost: { ...model.cost },
		headers: model.headers ? { ...model.headers } : undefined,
		compat: model.compat ? { ...model.compat } : undefined,
	};
}

function openAiGpt56ModelToRegistryModel(
	model: OpenAiGpt56ModelSpec,
	options: {
		providerId: string;
		api: string;
		baseUrl: string;
		contextWindow: number;
		thinkingLevelMap: Model<any>["thinkingLevelMap"];
		modelCost: (model: OpenAiGpt56ModelSpec) => OpenAiGpt56ModelSpec["cost"];
	},
): Model<any> {
	return {
		id: model.id,
		name: model.name,
		api: options.api as any,
		provider: options.providerId,
		baseUrl: options.baseUrl,
		reasoning: true,
		thinkingLevelMap: options.thinkingLevelMap,
		input: ["text", "image"],
		cost: options.modelCost(model),
		contextWindow: options.contextWindow,
		maxTokens: GPT_56_MAX_TOKENS,
	};
}

function getOpenAiCodexOAuthConfig() {
	const provider = getOAuthProvider(OPENAI_CODEX_PROVIDER_ID);
	if (!provider) throw new Error("OpenAI Codex OAuth provider is unavailable.");
	const { id: _id, ...oauth } = provider;
	return oauth;
}
