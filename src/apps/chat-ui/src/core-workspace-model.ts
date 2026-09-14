import type { ChatAppRoute } from "./app-routes";

export type CoreWorkspaceArea = "agents" | "context" | "settings";
export type CoreWorkspaceRoute = Extract<ChatAppRoute, { area: CoreWorkspaceArea }>;

export type CoreWorkspaceCatalogEntry = {
	id: CoreWorkspaceArea;
	title: string;
	description: string;
};

export type CoreSessionViewId = "raw-events" | "session-inspector";

export const CORE_WORKSPACE_CATALOG: readonly CoreWorkspaceCatalogEntry[] = [
	{ id: "agents", title: "Agent Designer", description: "Agents, profiles, and capability selection" },
	{ id: "context", title: "Context", description: "Context files, prompts, and user skills" },
	{ id: "settings", title: "Settings", description: "Core, provider, and plugin settings" },
] as const;

export const CORE_SESSION_VIEW_CATALOG: readonly { id: CoreSessionViewId; title: string; description: string }[] = [
	{ id: "raw-events", title: "Raw Events", description: "Raw trace and event payloads" },
	{ id: "session-inspector", title: "Session Inspector", description: "Session, signal, and runtime metadata" },
] as const;

export function isCoreWorkspaceRoute(route: Exclude<ChatAppRoute, { area: "sessions" }>): route is CoreWorkspaceRoute {
	return route.area === "agents" || route.area === "context" || route.area === "settings";
}
