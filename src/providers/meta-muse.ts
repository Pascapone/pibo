import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
	registerOpenAiCompatProvider,
	type OpenAiCompatModelSpec,
	type OpenAiCompatRegistrationResult,
} from "./openai-compat.js";

export const META_MUSE_PROVIDER_ID = "meta-muse";
export const META_MUSE_PROVIDER_NAME = "Meta Muse";
export const META_MUSE_DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const META_MUSE_API_KEY_ENV = "META_API_KEY";

const COMPAT: NonNullable<OpenAiCompatModelSpec["compat"]> = {
	supportsStore: false,
	maxTokensField: "max_tokens",
};

const REASONING_LEVELS: NonNullable<OpenAiCompatModelSpec["thinkingLevelMap"]> = {
	off: null,
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

export const META_MUSE_MODELS: readonly OpenAiCompatModelSpec[] = [
	{
		id: "muse-spark-1.3",
		name: "Muse Spark 1.3",
		reasoning: true,
		thinkingLevelMap: REASONING_LEVELS,
		compat: COMPAT,
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
		input: ["text", "image"],
	},
	{
		id: "muse-spark-1.3-contributor",
		name: "Muse Spark 1.3 Contributor",
		reasoning: true,
		thinkingLevelMap: { ...REASONING_LEVELS, max: null },
		compat: COMPAT,
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		cost: { input: 0.10, output: 0.20, cacheRead: 0.002, cacheWrite: 0 },
		input: ["text", "image"],
	},
];

export function registerMetaMuseProvider(
	modelRegistry: Pick<ModelRegistry, "registerProvider">,
): OpenAiCompatRegistrationResult {
	return registerOpenAiCompatProvider(modelRegistry, {
		id: META_MUSE_PROVIDER_ID,
		name: META_MUSE_PROVIDER_NAME,
		baseUrl: process.env.PIBO_META_MUSE_BASE_URL || META_MUSE_DEFAULT_BASE_URL,
		apiKeyEnv: META_MUSE_API_KEY_ENV,
		models: META_MUSE_MODELS,
	});
}
