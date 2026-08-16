import type { Model } from "@earendil-works/pi-ai";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
	OPENAI_COMPLETIONS_API,
	registerOpenAiCompatProvider,
	resetOpenAiCompatProviderRegistration,
	unregisterOpenAiCompatProvider,
	type OpenAiCompatModelSpec,
	type OpenAiCompatProviderSpec,
	type OpenAiCompatRegistrationResult,
} from "./openai-compat.js";

export const QWEN_TOKEN_PLAN_PROVIDER_ID = "qwen-token-plan";
export const QWEN_TOKEN_PLAN_PROVIDER_NAME = "Qwen Token Plan";
export const QWEN_TOKEN_PLAN_DEFAULT_BASE_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
export const QWEN_TOKEN_PLAN_API_KEY_ENV = "QWEN_TOKEN_PLAN_API_KEY";

export type QwenTokenPlanModelInput = {
	provider?: string;
	id?: string;
};

export type QwenTokenPlanModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "unregisterProvider" | "find">;

const QWEN_COMPAT: NonNullable<OpenAiCompatModelSpec["compat"]> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	thinkingFormat: "qwen",
	maxTokensField: "max_tokens",
};

const DEEPSEEK_COMPAT: NonNullable<OpenAiCompatModelSpec["compat"]> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	thinkingFormat: "deepseek",
	maxTokensField: "max_tokens",
};

const DASHSCOPE_COMPAT: NonNullable<OpenAiCompatModelSpec["compat"]> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function model(
	id: string,
	name: string,
	compat: NonNullable<OpenAiCompatModelSpec["compat"]>,
	contextWindow: number,
	maxTokens: number,
	input: OpenAiCompatModelSpec["input"],
	reasoning = true,
): OpenAiCompatModelSpec {
	return { id, name, reasoning, compat, contextWindow, maxTokens, cost: ZERO_COST, input };
}

function qwenModel(
	id: string,
	name: string,
	input: OpenAiCompatModelSpec["input"],
	contextWindow = 1_000_000,
	maxTokens = 65_536,
): OpenAiCompatModelSpec {
	return model(id, name, QWEN_COMPAT, contextWindow, maxTokens, input);
}

function deepseekModel(
	id: string,
	name: string,
	contextWindow: number,
	maxTokens: number,
): OpenAiCompatModelSpec {
	return model(id, name, DEEPSEEK_COMPAT, contextWindow, maxTokens, ["text"]);
}

function thirdPartyModel(
	id: string,
	name: string,
	contextWindow: number,
	maxTokens: number,
	input: OpenAiCompatModelSpec["input"],
	reasoning = true,
): OpenAiCompatModelSpec {
	return model(id, name, DASHSCOPE_COMPAT, contextWindow, maxTokens, input, reasoning);
}

export const QWEN_TOKEN_PLAN_MODELS: readonly OpenAiCompatModelSpec[] = [
	// Qwen Max family
	qwenModel("qwen-max", "Qwen Max", ["text", "image"]),
	qwenModel("qwen3.7-max", "Qwen3.7 Max", ["text"]),
	qwenModel("qwen3-max", "Qwen3 Max", ["text"]),
	qwenModel("qwen3.6-max-preview", "Qwen3.6 Max Preview", ["text", "image"]),

	// Qwen Plus family
	qwenModel("qwen3.7-plus", "Qwen3.7 Plus", ["text", "image"]),
	qwenModel("qwen3.6-plus", "Qwen3.6 Plus", ["text", "image"]),
	qwenModel("qwen3.5-plus", "Qwen3.5 Plus", ["text", "image"]),
	qwenModel("qwen-plus", "Qwen Plus", ["text", "image"]),

	// Qwen Flash family
	qwenModel("qwen3.6-flash", "Qwen3.6 Flash", ["text", "image"]),
	qwenModel("qwen3.5-flash", "Qwen3.5 Flash", ["text", "image"]),
	qwenModel("qwen-flash", "Qwen Flash", ["text", "image"]),

	// Qwen Coder family
	qwenModel("qwen-coder-plus", "Qwen Coder Plus", ["text"], 131_072, 65_536),
	qwenModel("qwen-coder-turbo", "Qwen Coder Turbo", ["text"], 131_072, 65_536),

	// DeepSeek
	deepseekModel("deepseek-v4-flash", "DeepSeek V4 Flash", 1_000_000, 384_000),
	deepseekModel("deepseek-v4-pro", "DeepSeek V4 Pro", 1_000_000, 384_000),
	deepseekModel("deepseek-v3.2", "DeepSeek V3.2", 163_840, 65_536),
	deepseekModel("deepseek-r1", "DeepSeek R1", 128_000, 32_768),

	// Kimi (Moonshot AI)
	thirdPartyModel("kimi-k2.7-code", "Kimi K2.7 Code", 262_144, 65_536, ["text", "image"]),
	thirdPartyModel("kimi-k2.6", "Kimi K2.6", 262_144, 65_536, ["text", "image"]),

	// GLM (Z.ai)
	thirdPartyModel("glm-5.2", "GLM 5.2", 1_000_000, 131_072, ["text"]),
];

function resolveBaseUrl(): string {
	const envOverride = process.env.PIBO_QWEN_TOKEN_PLAN_BASE_URL;
	return envOverride && envOverride.length > 0
		? envOverride
		: QWEN_TOKEN_PLAN_DEFAULT_BASE_URL;
}

function buildQwenTokenPlanSpec(): OpenAiCompatProviderSpec {
	return {
		id: QWEN_TOKEN_PLAN_PROVIDER_ID,
		name: QWEN_TOKEN_PLAN_PROVIDER_NAME,
		baseUrl: resolveBaseUrl(),
		apiKeyEnv: QWEN_TOKEN_PLAN_API_KEY_ENV,
		models: QWEN_TOKEN_PLAN_MODELS,
	};
}

export function isQwenTokenPlanProvider(provider: string | undefined | null): boolean {
	return provider === QWEN_TOKEN_PLAN_PROVIDER_ID;
}

export function findQwenTokenPlanModel(
	modelRegistry: QwenTokenPlanModelRegistryLike,
	model: QwenTokenPlanModelInput | undefined,
): Model<any> | undefined {
	if (!model?.provider || !model.id) return undefined;
	if (!isQwenTokenPlanProvider(model.provider)) return undefined;
	return modelRegistry.find(model.provider, model.id);
}

export function registerQwenTokenPlanProvider(
	modelRegistry: QwenTokenPlanModelRegistryLike,
): OpenAiCompatRegistrationResult {
	return registerOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "registerProvider">,
		buildQwenTokenPlanSpec(),
		{ baseModels: [] },
	);
}

export function unregisterQwenTokenPlanProvider(
	modelRegistry: QwenTokenPlanModelRegistryLike,
): void {
	unregisterOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "unregisterProvider">,
		QWEN_TOKEN_PLAN_PROVIDER_ID,
	);
}

export function resetQwenTokenPlanProviderRegistration(): void {
	resetOpenAiCompatProviderRegistration();
}

export function getDefaultQwenTokenPlanModels(): readonly OpenAiCompatModelSpec[] {
	return QWEN_TOKEN_PLAN_MODELS;
}

export { OPENAI_COMPLETIONS_API };
