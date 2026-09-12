import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import type { PluginConfigurationSnapshot, PluginConfigurationTarget, PluginSessionTabset } from "../../plugins/manifest.js";
import type { PluginManager } from "../../plugins/manager.js";
import { PluginConflictError, PluginValidationError, pluginJson, pluginErrorMessage, type PluginStore } from "../../plugins/store.js";
import type { PluginSourceInput } from "../../plugins/sources.js";

export type PluginManagementRoute = {
	action: "list" | "inspect" | "install" | "show" | "activate" | "uninstall-plan" | "uninstall-confirm" | "recover" | "resume" | "cancel" | "config-read" | "config-write" | "tabs-read" | "tabs-write" | "builds" | "build" | "session-recovery";
	pluginId?: string;
	operationId?: string;
	piboSessionId?: string;
	snapshotId?: string;
};
export function pluginManagementRoute(pathname: string, method: string): PluginManagementRoute | undefined {
	const base = "/api/chat/plugins";
	if (pathname === base && method === "GET") return { action: "list" };
	for (const action of ["inspect", "install", "uninstall-confirm", "recover"] as const) if (pathname === `${base}/${action}` && method === "POST") return { action };
	const operation = pathname.match(/^\/api\/chat\/plugins\/operations\/([^/]+)\/(resume|cancel)$/);
	if (operation && method === "POST") return { action: operation[2] as "resume" | "cancel", operationId: decodeURIComponent(operation[1]!) };
	const plugin = pathname.match(/^\/api\/chat\/plugins\/([^/]+)(?:\/(activate|uninstall-plan|config))?$/);
	if (plugin) {
		const pluginId = decodeURIComponent(plugin[1]!);
		if (!plugin[2] && method === "GET") return { action: "show", pluginId };
		if (plugin[2] === "config" && ["GET", "PUT"].includes(method)) return { action: method === "GET" ? "config-read" : "config-write", pluginId };
		if (["activate", "uninstall-plan"].includes(plugin[2] ?? "") && method === "POST") return { action: plugin[2] as "activate" | "uninstall-plan", pluginId };
	}
	const session = pathname.match(/^\/api\/chat\/sessions\/(ps_[^/]+)\/(plugin-tabs|plugin-builds|plugin-recovery)(?:\/([^/]+))?$/);
	if (session) {
		const piboSessionId = decodeURIComponent(session[1]!);
		if (session[2] === "plugin-tabs" && !session[3] && ["GET", "PUT"].includes(method)) return { action: method === "GET" ? "tabs-read" : "tabs-write", piboSessionId };
		if (session[2] === "plugin-builds" && method === "GET") return { action: session[3] ? "build" : "builds", piboSessionId, snapshotId: session[3] ? decodeURIComponent(session[3]) : undefined };
		if (session[2] === "plugin-recovery" && !session[3] && method === "GET") return { action: "session-recovery", piboSessionId };
	}
	return undefined;
}
export function pluginManagementRouteRequiresSameOrigin(route: PluginManagementRoute): boolean {
	return !["list", "show", "config-read", "tabs-read", "build", "builds", "session-recovery"].includes(route.action);
}
function configTarget(url: URL, pluginId: string): PluginConfigurationTarget {
	const scope = url.searchParams.get("scope"); const id = url.searchParams.get("targetId");
	if (scope === "app" && (!id || id === "app")) return { scope, pluginId };
	if (scope === "agent" && id) return { scope, pluginId, agentId: id };
	if (scope === "session" && id?.startsWith("ps_")) return { scope, pluginId, piboSessionId: id };
	throw new PluginValidationError("Explicit app, agent or Pibo Session configuration target required");
}
async function pluginRequestBody<T extends object>(request: Request): Promise<T> {
	const body = await readJsonBody<T>(request);
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new PluginValidationError("Expected a plugin request object");
	return body;
}
/** Dispatcher owns authentication and same-origin checks before this handler. */
export async function handlePluginManagementRoute(options: {
	route: PluginManagementRoute;
	request: Request;
	manager: PluginManager;
	store: PluginStore;
	assertSessionAccess: (piboSessionId: string) => void | Promise<void>;
}): Promise<Response> {
	const { route, request, manager, store, assertSessionAccess } = options;
	try {
		if (route.piboSessionId) await assertSessionAccess(route.piboSessionId);
		switch (route.action) {
			case "list": return responseJson({ installations: store.listInstallations() });
			case "show": return responseJson(manager.diagnose(route.pluginId!));
			case "inspect": return responseJson(await manager.inspect((await pluginRequestBody<{ source: PluginSourceInput }>(request)).source));
			case "install": {
				const body = await pluginRequestBody<{ source: PluginSourceInput; expectedRevision: number; dryRun?: boolean }>(request);
				return responseJson(await manager.install(body.source, { expectedRevision: body.expectedRevision, dryRun: body.dryRun }));
			}
			case "activate": return responseJson(await manager.activate(route.pluginId!, await pluginRequestBody<{ expectedRevision: number }>(request)));
			case "uninstall-plan": return responseJson(await manager.planUninstall(route.pluginId!));
			case "uninstall-confirm": return responseJson(await manager.confirmUninstall(await pluginRequestBody<{ planId: string; pluginIdText: string; expectedRevision: number }>(request)));
			case "recover": return responseJson({ operations: await manager.recover() });
			case "resume": return responseJson(await manager.resumeOperation(route.operationId!));
			case "cancel": return responseJson(await manager.cancelOperation(route.operationId!));
			case "config-read":
			case "config-write": {
				const target = configTarget(new URL(request.url), route.pluginId!);
				if (target.scope === "session") await assertSessionAccess(target.piboSessionId);
				if (route.action === "config-read") return responseJson({ configuration: manager.getConfig(target) ?? null });
				const body = await pluginRequestBody<{ configuration: PluginConfigurationSnapshot; expectedRevision: number }>(request);
				if (!body.configuration || typeof body.configuration !== "object") throw new PluginValidationError("Configuration object required");
				if (pluginJson(body.configuration.target) !== pluginJson(target)) throw new PluginValidationError("Configuration body target differs from URL; stale saves cannot be retargeted");
				return responseJson({ configuration: manager.putConfig(body.configuration, body.expectedRevision) });
			}
			case "tabs-read": return responseJson({ tabset: store.getTabset(route.piboSessionId!) ?? null });
			case "tabs-write": {
				const body = await pluginRequestBody<{ tabset: PluginSessionTabset; expectedRevision: number }>(request);
				if (!body.tabset || typeof body.tabset !== "object") throw new PluginValidationError("Tabset object required");
				if (body.tabset.piboSessionId !== route.piboSessionId) throw new PluginValidationError("Tabset body and route session differ");
				return responseJson({ tabset: store.putTabset(body.tabset, body.expectedRevision) });
			}
			case "builds": return responseJson({ snapshots: store.listBuildSnapshots(route.piboSessionId!) });
			case "build": {
				const snapshot = store.getBuildSnapshot(route.piboSessionId!, route.snapshotId!);
				if (!snapshot) throw new PiboWebHttpError("Plugin build snapshot not found in this session", 404);
				return responseJson({ snapshot });
			}
			case "session-recovery": return responseJson(manager.sessionRecovery(route.piboSessionId!));
		}
	} catch (error) {
		if (error instanceof PluginConflictError) throw new PiboWebHttpError(pluginErrorMessage(error, "Plugin state conflict"), 409);
		if (error instanceof PluginValidationError || (error as { name?: string })?.name === "PluginValidationError") throw new PiboWebHttpError(pluginErrorMessage(error, "Invalid plugin input"), 400);
		throw error;
	}
}
