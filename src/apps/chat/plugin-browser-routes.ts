import { readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type { EffectivePluginPlan, PluginBrowserCatalog, PluginInstallation } from "../../plugins/sdk.js";
import { PiboWebHttpError, responseJson } from "../../web/http.js";

export type PluginBrowserRoute = { action: "catalog" } | { action: "plan"; piboSessionId: string } | { action: "asset"; pluginId: string; revision: string; path: string };
function decodePluginRoutePart(value: string): string {
	try { return decodeURIComponent(value); }
	catch { throw new PiboWebHttpError("Invalid plugin route encoding", 400); }
}
export function pluginBrowserRoute(pathname: string, method: string): PluginBrowserRoute | undefined {
	if (method !== "GET") return undefined;
	if (pathname === "/api/chat/plugin-browser/catalog") return { action: "catalog" };
	const plan = pathname.match(/^\/api\/chat\/sessions\/(ps_[^/]+)\/plugin-plan$/);
	if (plan) return { action: "plan", piboSessionId: decodePluginRoutePart(plan[1]!) };
	const asset = pathname.match(/^\/api\/chat\/plugin-browser\/assets\/([^/]+)\/([^/]+)\/(.+)$/);
	if (asset) return { action: "asset", pluginId: decodePluginRoutePart(asset[1]!), revision: decodePluginRoutePart(asset[2]!), path: decodePluginRoutePart(asset[3]!) };
	return undefined;
}
export function pluginBrowserCatalog(installations: readonly PluginInstallation[], revision: number): PluginBrowserCatalog {
	return {
		schemaVersion: 1, revision, diagnostics: [],
		plugins: installations.filter((item) => item.enabled && ["active", "pending-activation", "retiring"].includes(item.state)).map((item) => ({
			pluginId: item.pluginId, revision: item.revision, version: item.version, contentHash: item.contentHash,
			browserEntry: item.manifest.entrypoints?.browser ? `/api/chat/plugin-browser/assets/${encodeURIComponent(item.pluginId)}/${encodeURIComponent(item.revision)}/${item.manifest.entrypoints.browser.split("/").map(encodeURIComponent).join("/")}` : undefined,
			contributions: item.manifest.contributions,
		})),
	};
}
/** Authentication is mandatory in the dispatcher, including for module assets. Never starts a runtime. */
export async function handlePluginBrowserRoute(options: {
	route: PluginBrowserRoute;
	request: Request;
	installations: readonly PluginInstallation[];
	catalogRevision: number;
	assertSessionAccess: (id: string) => void | Promise<void>;
	getSessionPlan: (id: string) => Promise<{ plan: EffectivePluginPlan; agentId?: string; roomId?: string }>;
}): Promise<Response> {
	const { route } = options;
	if (route.action === "catalog") return responseJson(pluginBrowserCatalog(options.installations, options.catalogRevision));
	if (route.action === "plan") {
		await options.assertSessionAccess(route.piboSessionId);
		const result = await options.getSessionPlan(route.piboSessionId);
		if (result.plan.piboSessionId !== route.piboSessionId) throw new PiboWebHttpError("Plugin plan belongs to another session", 409);
		return responseJson(result);
	}
	const installation = options.installations.find((item) => item.pluginId === route.pluginId && item.revision === route.revision && item.enabled && ["active", "pending-activation", "retiring"].includes(item.state));
	if (!installation?.artifactPath || !installation.manifest.entrypoints?.browser) throw new PiboWebHttpError("Plugin browser artifact unavailable", 404);
	if (!route.path || route.path.includes("\\") || route.path.includes("\0") || route.path.split("/").some((part) => !part || part === "." || part === "..")) throw new PiboWebHttpError("Invalid plugin asset path", 400);
	const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
	const type = types[extname(route.path)];
	if (!type) throw new PiboWebHttpError("Unsupported browser asset", 404);
	try {
		const root = await realpath(installation.artifactPath);
		const browserEntry = await realpath(resolve(root, installation.manifest.entrypoints.browser));
		const browserRoot = await realpath(resolve(root, installation.manifest.entrypoints.browser, ".."));
		const file = await realpath(resolve(root, route.path));
		// A root entry must be self-contained. It never makes the whole package public.
		if (browserRoot === root && file !== browserEntry) throw new PiboWebHttpError("Plugin asset outside browser entry", 403);
		const backend = installation.manifest.entrypoints.backend;
		if (backend) {
			const backendFile = await realpath(resolve(root, backend));
			const backendRelative = relative(browserRoot, backendFile);
			const backendInBrowserTree = backendRelative !== ".." && !backendRelative.startsWith(`..${sep}`) && !backendRelative.startsWith(sep);
			if (file === backendFile || browserRoot !== root && backendInBrowserTree) throw new PiboWebHttpError("Backend and public browser artifacts must be separate", 403);
		}
		for (const base of [root, browserRoot]) {
			const child = relative(base, file);
			if (child === ".." || child.startsWith(`..${sep}`) || child.startsWith(sep)) throw new PiboWebHttpError("Plugin asset outside browser root", 403);
		}
		if (!(await stat(file)).isFile()) throw new PiboWebHttpError("Plugin asset not found", 404);
		return new Response(new Uint8Array(await readFile(file)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
	} catch (error) {
		if (error instanceof PiboWebHttpError) throw error;
		throw new PiboWebHttpError("Plugin asset not found", 404);
	}
}
