import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { ToolProfile, WebSearchProviderOptions, WebSearchProviderToolProfile } from "../core/profiles.js";

export type OpenAiWebSearchConfig = {
	external_web_access: boolean;
	filters?: {
		allowed_domains?: string[];
		blocked_domains?: string[];
	};
	user_location?: {
		type: "approximate";
		country?: string;
		region?: string;
		city?: string;
		timezone?: string;
	};
	search_context_size?: "low" | "medium" | "high";
	include_sources?: boolean;
};

type ProviderPayload = {
	input?: unknown;
	tools?: unknown;
	include?: unknown;
	[key: string]: unknown;
};

export type WebSearchProviderAdapter = {
	provider: WebSearchProviderToolProfile["provider"];
	createExtension(options: WebSearchProviderOptions | undefined): ExtensionFactory;
};

export const WEB_SEARCH_PROMPT_CONTRIBUTION = "web_search is available as a Pibo native tool through the OpenAI provider adapter. Use it when current or externally sourced information is needed.";

const WEB_SEARCH_SOURCES_INCLUDE = "web_search_call.action.sources";

function hasProviderResponsesShape(payload: unknown): payload is ProviderPayload {
	return Boolean(payload && typeof payload === "object" && "input" in payload);
}

function hasWebSearchTool(tools: unknown[]): boolean {
	return tools.some((tool) => {
		if (!tool || typeof tool !== "object") return false;
		const type = (tool as { type?: unknown }).type;
		return type === "web_search_preview" || type === "web_search";
	});
}

function isValidDomainFilter(value: string): boolean {
	const domain = value.trim();
	return domain.length > 0 && !domain.includes("://") && !/[/?#\s]/.test(domain);
}

function normalizedDomainFilters(values: readonly string[] | undefined): string[] | undefined {
	const domains = values?.map((value) => value.trim()).filter(isValidDomainFilter) ?? [];
	return domains.length > 0 ? domains : undefined;
}

function normalizedLocation(
	location: WebSearchProviderOptions["userLocation"],
): OpenAiWebSearchConfig["user_location"] | undefined {
	if (!location) return undefined;
	const country = location.country?.trim();
	const region = location.region?.trim();
	const city = location.city?.trim();
	const timezone = location.timezone?.trim();
	if (!country && !region && !city && !timezone) return undefined;
	return {
		type: "approximate",
		...(country ? { country } : {}),
		...(region ? { region } : {}),
		...(city ? { city } : {}),
		...(timezone ? { timezone } : {}),
	};
}

export function normalizeOpenAiWebSearchConfig(
	options: WebSearchProviderOptions | undefined,
): OpenAiWebSearchConfig {
	const allowedDomains = normalizedDomainFilters(options?.allowedDomains);
	const blockedDomains = normalizedDomainFilters(options?.blockedDomains);
	const userLocation = normalizedLocation(options?.userLocation);

	return {
		external_web_access: options?.externalWebAccess ?? true,
		search_context_size: options?.searchContextSize ?? "medium",
		include_sources: options?.includeSources ?? true,
		...(allowedDomains || blockedDomains
			? {
					filters: {
						...(allowedDomains ? { allowed_domains: allowedDomains } : {}),
						...(blockedDomains ? { blocked_domains: blockedDomains } : {}),
					},
				}
			: {}),
		...(userLocation ? { user_location: userLocation } : {}),
	};
}

function buildOpenAiWebSearchProviderTool(config: OpenAiWebSearchConfig): Record<string, unknown> {
	const tool: Record<string, unknown> = {
		type: "web_search",
		external_web_access: config.external_web_access,
	};
	if (config.search_context_size) tool.search_context_size = config.search_context_size;
	if (config.user_location) tool.user_location = config.user_location;
	if (config.filters?.allowed_domains?.length || config.filters?.blocked_domains?.length) {
		tool.filters = {
			...(config.filters.allowed_domains?.length ? { allowed_domains: config.filters.allowed_domains } : {}),
			...(config.filters.blocked_domains?.length ? { blocked_domains: config.filters.blocked_domains } : {}),
		};
	}
	return tool;
}

function addOpenAiWebSearchSourcesInclude(
	payload: ProviderPayload,
	config: OpenAiWebSearchConfig,
): Pick<ProviderPayload, "include"> {
	if (!config.include_sources) return {};
	const include = Array.isArray(payload.include) ? [...payload.include] : [];
	if (!include.includes(WEB_SEARCH_SOURCES_INCLUDE)) include.push(WEB_SEARCH_SOURCES_INCLUDE);
	return { include };
}

export function addOpenAiWebSearchProviderTool(payload: unknown, config: OpenAiWebSearchConfig): unknown {
	if (!hasProviderResponsesShape(payload)) return payload;

	const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
	if (hasWebSearchTool(tools)) return payload;

	return {
		...payload,
		...addOpenAiWebSearchSourcesInclude(payload, config),
		tools: [...tools, buildOpenAiWebSearchProviderTool(config)],
	};
}

const openAiWebSearchAdapter: WebSearchProviderAdapter = {
	provider: "openai",
	createExtension(options) {
		const config = normalizeOpenAiWebSearchConfig(options);
		return (pi) => {
			pi.on("before_agent_start", (event) => ({
				systemPrompt: [
					event.systemPrompt,
					"# Native Web Search",
					WEB_SEARCH_PROMPT_CONTRIBUTION,
				].join("\n\n"),
			}));
			pi.on("before_provider_request", (event) => addOpenAiWebSearchProviderTool(event.payload, config));
		};
	},
};

const WEB_SEARCH_PROVIDER_ADAPTERS: Record<WebSearchProviderToolProfile["provider"], WebSearchProviderAdapter> = {
	openai: openAiWebSearchAdapter,
};

export function getWebSearchProviderAdapter(provider: WebSearchProviderToolProfile["provider"]): WebSearchProviderAdapter {
	return WEB_SEARCH_PROVIDER_ADAPTERS[provider];
}

export function createWebSearchProviderExtension(providerTool: WebSearchProviderToolProfile): ExtensionFactory {
	return getWebSearchProviderAdapter(providerTool.provider).createExtension(providerTool.options);
}

export function isWebSearchProviderTool(tool: ToolProfile): tool is ToolProfile & { providerTool: WebSearchProviderToolProfile } {
	return tool.providerTool?.kind === "web_search";
}

export function createWebSearchToolProfile(options: WebSearchProviderOptions = {}): ToolProfile {
	return {
		name: "web_search",
		description: "Searches the web through the configured provider adapter.",
		providerTool: {
			kind: "web_search",
			provider: "openai",
			options: {
				externalWebAccess: true,
				searchContextSize: "medium",
				includeSources: true,
				...options,
			},
		},
	};
}
