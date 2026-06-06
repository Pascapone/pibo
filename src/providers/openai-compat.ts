import type { Model } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

export const OPENAI_COMPLETIONS_API = "openai-completions" as const;

export type OpenAiCompatInputModality = "text" | "image";

export type OpenAiCompatModelSpec = {
	id: string;
	name: string;
	reasoning?: boolean;
	contextWindow: number;
	maxTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	input: readonly OpenAiCompatInputModality[];
};

export type OpenAiCompatModelEntry = {
	id: string;
	name: string;
	api: typeof OPENAI_COMPLETIONS_API;
	baseUrl: string;
	reasoning: boolean;
	input: OpenAiCompatInputModality[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
};

export type OpenAiCompatProviderSpec = {
	id: string;
	baseUrl: string;
	apiKeyEnv: string;
	models: readonly OpenAiCompatModelSpec[];
};

export type OpenAiCompatProviderConfig = {
	baseUrl: string;
	api: typeof OPENAI_COMPLETIONS_API;
	apiKey: string;
	models: OpenAiCompatModelEntry[];
};

export function buildOpenAiCompatConfig(
	spec: OpenAiCompatProviderSpec,
	baseModels: readonly Model<any>[] = [],
): OpenAiCompatProviderConfig {
	const baseEntries: OpenAiCompatModelEntry[] = baseModels
		.filter((model) => model.provider === spec.id)
		.map((model) => ({
			id: model.id,
			name: model.name,
			api: OPENAI_COMPLETIONS_API,
			baseUrl: spec.baseUrl,
			reasoning: Boolean(model.reasoning),
			input: [...model.input],
			cost: { ...model.cost },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		}));

	const customEntries: OpenAiCompatModelEntry[] = spec.models.map((model) => ({
		id: model.id,
		name: model.name,
		api: OPENAI_COMPLETIONS_API,
		baseUrl: spec.baseUrl,
		reasoning: model.reasoning ?? false,
		input: [...model.input],
		cost: { ...model.cost },
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	}));

	const byId = new Map<string, OpenAiCompatModelEntry>();
	for (const entry of baseEntries) byId.set(entry.id, entry);
	for (const entry of customEntries) byId.set(entry.id, entry);

	return {
		baseUrl: spec.baseUrl,
		api: OPENAI_COMPLETIONS_API,
		apiKey: spec.apiKeyEnv,
		models: [...byId.values()],
	};
}

export type OpenAiCompatRegistrationResult = {
	registered: boolean;
	models: number;
};

export function registerOpenAiCompatProvider(
	modelRegistry: Pick<ModelRegistry, "registerProvider">,
	spec: OpenAiCompatProviderSpec,
	options: {
		baseModels?: readonly Model<any>[];
	} = {},
): OpenAiCompatRegistrationResult {
	const config = buildOpenAiCompatConfig(spec, options.baseModels);
	modelRegistry.registerProvider(spec.id, config);
	return { registered: true, models: config.models.length };
}

export function unregisterOpenAiCompatProvider(
	modelRegistry: Pick<ModelRegistry, "unregisterProvider">,
	providerId: string,
): void {
	modelRegistry.unregisterProvider(providerId);
}

export function resetOpenAiCompatProviderRegistration(): void {
}
