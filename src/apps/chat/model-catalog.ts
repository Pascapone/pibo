import { createAgentSessionServices } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { registerMiniMaxProvider, type MiniMaxModelRegistryLike } from "../../providers/minimax.js";
import { registerGlmProvider, type GlmModelRegistryLike } from "../../providers/glm.js";
import { registerOpenAiGpt56Models, type OpenAiGpt56ModelRegistryLike } from "../../providers/openai-gpt56.js";

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
	modelRegistry: ModelCatalogRegistry;
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
		extensionHook?.(services.modelRegistry as unknown as MiniMaxModelRegistryLike & GlmModelRegistryLike & OpenAiGpt56ModelRegistryLike);
		return buildModelCatalogFromRegistry(services.modelRegistry);
	} catch {
		return { providers: [] };
	}
}

export async function loadModelCatalog(cwd = process.cwd()): Promise<ModelCatalog> {
	return loadModelCatalogWithServices(createAgentSessionServices, cwd, (registry) => {
		registerOpenAiGpt56Models(registry);
		registerMiniMaxProvider(registry);
		registerGlmProvider(registry);
	});
}
