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

const GLM_COMPAT: NonNullable<OpenAiCompatModelSpec["compat"]> = {
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

function glmModel(
	id: string,
	name: string,
	contextWindow: number,
	maxTokens: number,
): OpenAiCompatModelSpec {
	return model(id, name, GLM_COMPAT, contextWindow, maxTokens, ["text"]);
}

export const QWEN_TOKEN_PLAN_MODELS: readonly OpenAiCompatModelSpec[] = [
	// Qwen models (Token Plan)
	qwenModel("qwen3.8-max", "Qwen3.8 Max", ["text", "image"]),
	qwenModel("qwen3.7-plus", "Qwen3.7 Plus", ["text", "image"]),
	qwenModel("qwen3.7-max", "Qwen3.7 Max", ["text"]),
	qwenModel("qwen3.6-flash", "Qwen3.6 Flash", ["text", "image"]),

	// DeepSeek models (Token Plan)
	deepseekModel("deepseek-v4-pro-0813", "DeepSeek V4 Pro 0813", 1_000_000, 384_000),
	deepseekModel("deepseek-v4-pro", "DeepSeek V4 Pro", 1_000_000, 384_000),
	deepseekModel("deepseek-v4-flash-0731", "DeepSeek V4 Flash 0731", 1_000_000, 384_000),

	// GLM models (Token Plan)
	glmModel("glm-5.2", "GLM 5.2", 1_000_000, 131_072),
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
