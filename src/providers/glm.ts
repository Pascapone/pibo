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

export const GLM_PROVIDER_ID = "glm";
export const GLM_DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
export const GLM_API_KEY_ENV = "GLM_API_KEY";

export type GlmModelInput = {
	provider?: string;
	id?: string;
};

export type GlmModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "unregisterProvider" | "find">;

export const GLM_5_2_MODEL: OpenAiCompatModelSpec = {
	id: "GLM-5.2",
	name: "GLM 5.2",
	reasoning: false,
	contextWindow: 200000,
	maxTokens: 8192,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	input: ["text"],
};

function resolveBaseUrl(defaultBaseUrl: string): string {
	const envOverride = process.env[`PIBO_${GLM_PROVIDER_ID.toUpperCase()}_BASE_URL`];
	return envOverride && envOverride.length > 0 ? envOverride : defaultBaseUrl;
}

function buildGlmSpec(
	customModels: readonly OpenAiCompatModelSpec[] = [GLM_5_2_MODEL],
): OpenAiCompatProviderSpec {
	return {
		id: GLM_PROVIDER_ID,
		baseUrl: resolveBaseUrl(GLM_DEFAULT_BASE_URL),
		apiKeyEnv: GLM_API_KEY_ENV,
		models: customModels,
	};
}

export function isGlmProvider(provider: string | undefined | null): boolean {
	return provider === GLM_PROVIDER_ID;
}

export function findGlmModel(
	modelRegistry: GlmModelRegistryLike,
	model: GlmModelInput,
): Model<any> | undefined {
	if (!model?.provider || !model.id) return undefined;
	if (!isGlmProvider(model.provider)) return undefined;
	return modelRegistry.find(model.provider, model.id);
}

export function getBuiltInGlmModels(): Model<any>[] {
	try {
		return getModels(GLM_PROVIDER_ID as any) as Model<any>[];
	} catch {
		return [];
	}
}

export function registerGlmProvider(
	modelRegistry: GlmModelRegistryLike,
	options: {
		customModels?: readonly OpenAiCompatModelSpec[];
		baseModels?: readonly Model<any>[];
	} = {},
): OpenAiCompatRegistrationResult {
	const spec = buildGlmSpec(options.customModels ?? [GLM_5_2_MODEL]);
	const baseModels = options.baseModels ?? getBuiltInGlmModels();
	return registerOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "registerProvider">,
		spec,
		{ baseModels },
	);
}

export function unregisterGlmProvider(
	modelRegistry: GlmModelRegistryLike,
): void {
	unregisterOpenAiCompatProvider(
		modelRegistry as Pick<ModelRegistry, "unregisterProvider">,
		GLM_PROVIDER_ID,
	);
}

export function resetGlmProviderRegistration(): void {
	resetOpenAiCompatProviderRegistration();
}

export function getDefaultGlmModels(): readonly OpenAiCompatModelSpec[] {
	return [GLM_5_2_MODEL];
}

export { OPENAI_COMPLETIONS_API };
