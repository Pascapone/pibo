import type { AgentRuntimeInstanceInspection } from "../../agent-runtime/types.js";

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

function stringOption(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function buildModelCatalogFromRuntimeInspections(inspections: readonly AgentRuntimeInstanceInspection[]): ModelCatalog {
	const providers = new Map<string, ProviderCatalogEntry>();
	for (const runtime of inspections) {
		for (const model of runtime.models?.models ?? []) {
			const providerId = model.provider ?? runtime.adapterId;
			const auth = runtime.auth?.find((candidate) => candidate.id === providerId);
			const providerLabel = stringOption(model.options?.providerDisplayName) ?? auth?.displayName ?? providerId;
			const authConfigured = auth?.configured ?? booleanOption(model.options?.authConfigured) ?? false;
			let provider = providers.get(providerId);
			if (!provider) {
				provider = { id: providerId, label: providerLabel, authConfigured, models: [] };
				providers.set(providerId, provider);
			} else if (authConfigured) {
				provider.authConfigured = true;
			}
			if (!provider.models.some((candidate) => candidate.id === model.id)) {
				provider.models.push({
					provider: providerId,
					id: model.id,
					label: model.displayName ?? model.id,
					authConfigured,
					supportsReasoning: model.reasoningOptions !== undefined && model.reasoningOptions.length > 0 || undefined,
				});
			}
		}
	}
	return {
		providers: [...providers.values()]
			.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
			.map((provider) => ({
				...provider,
				models: provider.models.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)),
			})),
	};
}

export async function loadModelCatalog(
	inspectRuntimeInstances: (() => Promise<AgentRuntimeInstanceInspection[]>) | undefined,
): Promise<ModelCatalog> {
	if (!inspectRuntimeInstances) return { providers: [] };
	try {
		return buildModelCatalogFromRuntimeInspections(await inspectRuntimeInstances());
	} catch {
		return { providers: [] };
	}
}
