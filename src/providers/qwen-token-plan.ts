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

function qwenModel(
	id: string,
	name: string,
	input: OpenAiCompatModelSpec["input"],
): OpenAiCompatModelSpec {
	return {
		id,
		name,
		reasoning: true,
		compat: QWEN_COMPAT,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		input,
	};
}

export const QWEN_TOKEN_PLAN_MODELS: readonly OpenAiCompatModelSpec[] = [
	qwenModel("qwen3.7-max", "Qwen3.7 Max", ["text"]),
	qwenModel("qwen3.7-plus", "Qwen3.7 Plus", ["text", "image"]),
	qwenModel("qwen3.6-plus", "Qwen3.6 Plus", ["text", "image"]),
	qwenModel("qwen3.6-flash", "Qwen3.6 Flash", ["text", "image"]),
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
