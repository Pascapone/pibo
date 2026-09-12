import type { EffectivePluginPlan } from "./contributions.js";

/** Stable services provided by the product composition through the plugin host. */
export const PLUGIN_MANAGEMENT_SERVICE = "pibo.plugins.management";
export const PLUGIN_SESSION_PLAN_SERVICE = "pibo.plugins.session-plan";

/** Read-only runtime projection. Preview must use the pure resolver and never open a runtime. */
export type PluginSessionPlanReader = (piboSessionId: string, kind: "actual" | "preview") => Promise<{
	plan: EffectivePluginPlan;
	agentId?: string;
	roomId?: string;
}>;
