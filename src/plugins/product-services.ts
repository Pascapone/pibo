import type { EffectivePluginPlan } from "./contributions.js";
import type { PluginConsumerCollector } from "./operations.js";
import type { PluginHost } from "./host.js";
import type { PluginInstallation } from "./manifest.js";

/** Stable services provided by the product composition through the plugin host. */
export const PLUGIN_HOST_SERVICE = "pibo.plugins.host";
export const PLUGIN_MANAGEMENT_SERVICE = "pibo.plugins.management";
export const PLUGIN_SESSION_PLAN_SERVICE = "pibo.plugins.session-plan";
/** Optional plugin-owned live/business consumer collectors used by uninstall impact analysis. */
export const PLUGIN_CONSUMER_COLLECTOR_RESOURCE = "plugin-consumer-collector";
export type PluginOwnedConsumerCollector = PluginConsumerCollector;

/** Product-internal services stay callable but never masquerade as selectable catalog providers. */
export function catalogPluginServices(host: PluginHost | undefined, installations: readonly PluginInstallation[]) {
	if (!host) return { services: undefined, serviceProviders: undefined };
	const catalogPluginIds = new Set(installations.map((installation) => installation.pluginId));
	const serviceProviders = Object.fromEntries(Object.entries(host.services.owners()).filter(([, pluginId]) => catalogPluginIds.has(pluginId)));
	const versions = host.services.versions();
	const services = Object.fromEntries(Object.keys(serviceProviders).map((id) => [id, versions[id]!]));
	return { services, serviceProviders };
}

/** Read-only runtime projection. Preview must use the pure resolver and never open a runtime. */
export type PluginSessionPlanReader = (piboSessionId: string, kind: "actual" | "preview") => Promise<{
	plan: EffectivePluginPlan;
	agentId?: string;
	roomId?: string;
}>;
