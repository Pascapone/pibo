import { getModels, type Model } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

export const OPENAI_PROVIDER_ID = "openai";
export const OPENAI_RESPONSES_API = "openai-responses";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

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
	models: number;
	added: number;
};

export type OpenAiGpt56ModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "find">;

const GPT_56_CONTEXT_WINDOW = 1_050_000;
const GPT_56_MAX_TOKENS = 128_000;

// Register GPT-5.6 on the normal OpenAI API provider only.
// This keeps Pibo on the existing token-plan path (OPENAI_API_KEY) and does not
// route these models through ChatGPT/Codex OAuth (`openai-codex`).
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

export function getBuiltInOpenAiModels(): Model<any>[] {
	try {
		return getModels(OPENAI_PROVIDER_ID as any) as Model<any>[];
	} catch {
		return [];
	}
}

export function buildOpenAiGpt56Models(
	baseModels: readonly Model<any>[] = getBuiltInOpenAiModels(),
): Model<any>[] {
	const openAiBaseModels = baseModels
		.filter((model) => model.provider === OPENAI_PROVIDER_ID)
		.map((model) => ({
			...model,
			input: [...model.input],
			cost: { ...model.cost },
			headers: model.headers ? { ...model.headers } : undefined,
			compat: model.compat ? { ...model.compat } : undefined,
		}));
	const existingIds = new Set(openAiBaseModels.map((model) => model.id));
	const additions = OPENAI_GPT_56_MODELS
		.filter((model) => !existingIds.has(model.id))
		.map(openAiGpt56ModelToRegistryModel);

	return [...openAiBaseModels, ...additions];
}

export function registerOpenAiGpt56Models(
	modelRegistry: OpenAiGpt56ModelRegistryLike,
	options: {
		baseModels?: readonly Model<any>[];
	} = {},
): OpenAiGpt56RegistrationResult {
	const baseModels = options.baseModels ?? getBuiltInOpenAiModels();
	const models = buildOpenAiGpt56Models(baseModels);
	const baseOpenAiIds = new Set(baseModels.filter((model) => model.provider === OPENAI_PROVIDER_ID).map((model) => model.id));
	const added = OPENAI_GPT_56_MODELS.filter((model) => !baseOpenAiIds.has(model.id)).length;

	modelRegistry.registerProvider(OPENAI_PROVIDER_ID, {
		baseUrl: OPENAI_BASE_URL,
		api: OPENAI_RESPONSES_API,
		apiKey: OPENAI_API_KEY_ENV,
		models,
	});

	return { registered: true, models: models.length, added };
}

export function findOpenAiGpt56Model(
	modelRegistry: Pick<ModelRegistry, "find">,
	model: { provider?: string; id?: string } | undefined,
): Model<any> | undefined {
	if (model?.provider !== OPENAI_PROVIDER_ID || !model.id) return undefined;
	if (!OPENAI_GPT_56_MODELS.some((candidate) => candidate.id === model.id)) return undefined;
	return modelRegistry.find(OPENAI_PROVIDER_ID, model.id);
}

function openAiGpt56ModelToRegistryModel(model: OpenAiGpt56ModelSpec): Model<any> {
	return {
		id: model.id,
		name: model.name,
		api: OPENAI_RESPONSES_API,
		provider: OPENAI_PROVIDER_ID,
		baseUrl: OPENAI_BASE_URL,
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		cost: { ...model.cost },
		contextWindow: GPT_56_CONTEXT_WINDOW,
		maxTokens: GPT_56_MAX_TOKENS,
	};
}
