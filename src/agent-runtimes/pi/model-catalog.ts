import {
	ModelRegistry,
	createAgentSessionServices,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerMiniMaxProvider, type MiniMaxModelRegistryLike } from "../../providers/minimax.js";
import { registerGlmProvider, type GlmModelRegistryLike } from "../../providers/glm.js";
import { registerQwenTokenPlanProvider, type QwenTokenPlanModelRegistryLike } from "../../providers/qwen-token-plan.js";
import { registerOpenAiGpt56Models, type OpenAiGpt56ModelRegistryLike } from "../../providers/openai-gpt56.js";
import type { AgentRuntimeAuthStatus, AgentRuntimeModelCatalog } from "../../agent-runtime/types.js";
import { piAuthMethodsForProvider } from "./auth.js";

export type ModelCatalog = {
	providers: ProviderCatalogEntry[];
};

export type ProviderCatalogEntry = {
	id: string;
	label: string;
	authConfigured: boolean;
	models: ModelCatalogEntry[];
};

export type ModelCatalogEntry = {
	provider: string;
	id: string;
	label: string;
	authConfigured?: boolean;
	supportsReasoning?: boolean;
};

type ModelCatalogRegistry = {
	getAll(): Model<Api>[];
	getProviderDisplayName?: (provider: string) => string;
	getProviderAuthStatus?: (provider: string) => { configured: boolean };
};

type ModelCatalogServices = {
	modelRegistry?: ModelCatalogRegistry;
	modelRuntime?: ModelRuntime;
};

type ModelCatalogServicesFactory = (options: { cwd: string }) => Promise<ModelCatalogServices>;

type ModelRegistryExtensionHook = (registry: MiniMaxModelRegistryLike & GlmModelRegistryLike & OpenAiGpt56ModelRegistryLike) => void;

export function buildModelCatalogFromRegistry(registry: ModelCatalogRegistry): ModelCatalog {
	const providers = new Map<string, ProviderCatalogEntry>();

	for (const model of registry.getAll()) {
		const providerId = model.provider;
		let provider = providers.get(providerId);
		if (!provider) {
			const authConfigured = registry.getProviderAuthStatus?.(providerId).configured ?? false;
			provider = {
				id: providerId,
				label: registry.getProviderDisplayName?.(providerId) ?? providerId,
				authConfigured,
				models: [],
			};
			providers.set(providerId, provider);
		}

		provider.models.push({
			provider: providerId,
			id: model.id,
			label: model.name || model.id,
			authConfigured: provider.authConfigured,
			supportsReasoning: model.reasoning || undefined,
		});
	}

	return {
		providers: [...providers.values()]
			.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
			.map((provider) => ({
				...provider,
				models: [...provider.models].sort(
					(left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
				),
			})),
	};
}

export async function loadModelCatalogWithServices(
	createServices: ModelCatalogServicesFactory,
	cwd = process.cwd(),
	extensionHook?: ModelRegistryExtensionHook,
): Promise<ModelCatalog> {
	try {
		const services = await createServices({ cwd });
		const registry = services.modelRegistry
			?? (services.modelRuntime ? new ModelRegistry(services.modelRuntime) : undefined);
		if (!registry) throw new Error("Pi model services did not provide a model runtime.");
		extensionHook?.(registry as unknown as MiniMaxModelRegistryLike & GlmModelRegistryLike & OpenAiGpt56ModelRegistryLike);
		return buildModelCatalogFromRegistry(registry);
	} catch {
		return { providers: [] };
	}
}

export async function loadModelCatalog(cwd = process.cwd()): Promise<ModelCatalog> {
	return loadModelCatalogWithServices(createAgentSessionServices, cwd, (registry) => {
		registerOpenAiGpt56Models(registry);
		registerMiniMaxProvider(registry);
		registerGlmProvider(registry);
		registerQwenTokenPlanProvider(registry);
	});
}

export function piAgentRuntimeModelCatalog(runtimeInstanceId: string, catalog: ModelCatalog): AgentRuntimeModelCatalog {
	return {
		runtimeInstanceId,
		models: catalog.providers.flatMap((provider) => provider.models.map((model) => ({
			id: model.id,
			provider: model.provider,
			displayName: model.label,
			...(model.supportsReasoning ? { reasoningOptions: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } : {}),
			options: {
				providerDisplayName: provider.label,
				authConfigured: provider.authConfigured,
			},
		}))),
		...(catalog.providers.length === 0 ? {
			diagnostics: [{
				severity: "warning",
				code: "pi_model_catalog_empty",
				message: "The Pi model registry did not return any models.",
			}],
		} : {}),
	};
}

export function piAgentRuntimeAuthStatus(catalog: ModelCatalog): AgentRuntimeAuthStatus[] {
	return catalog.providers.map((provider) => ({
		id: provider.id,
		displayName: provider.label,
		state: provider.authConfigured ? "connected" : "disconnected",
		configured: provider.authConfigured,
		methods: [...piAuthMethodsForProvider(provider.id)],
	}));
}
