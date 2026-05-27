import { setMcpServerDescription } from "../../mcp/agent-context.js";
import { inspectPiPackageSource } from "../../pi-packages/metadata.js";
import { findPiPackage, listPiPackages, removePiPackage, setPiPackageEnabled, upsertPiPackage } from "../../pi-packages/store.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX, mcpServerResourceName, piPackageResourceId } from "./chat-api-routes.js";
import {
	normalizeMcpServerDescriptionBody,
	normalizePiPackageWebSource,
	type ChatMcpServerDescriptionBody,
	type ChatPiPackageBody,
	type ChatPiPackagePatchBody,
} from "./chat-request-normalizers.js";

export type ChatCapabilityRoute =
	| { kind: "pi-packages-list" }
	| { kind: "pi-packages-create" }
	| { kind: "pi-package-read"; packageId: string }
	| { kind: "pi-package-update"; packageId: string }
	| { kind: "pi-package-delete"; packageId: string }
	| { kind: "mcp-server-description-update"; serverName: string };

type PiPackageAgentSelection = { profileName: string };

export function chatCapabilityRoute(pathname: string, method: string): ChatCapabilityRoute | undefined {
	if (pathname === `${CHAT_WEB_API_PREFIX}/pi-packages` && method === "GET") return { kind: "pi-packages-list" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/pi-packages` && method === "POST") return { kind: "pi-packages-create" };

	const packageId = piPackageResourceId(pathname);
	if (packageId && method === "GET") return { kind: "pi-package-read", packageId };
	if (packageId && method === "PATCH") return { kind: "pi-package-update", packageId };
	if (packageId && method === "DELETE") return { kind: "pi-package-delete", packageId };

	const serverName = mcpServerResourceName(pathname);
	if (serverName && method === "PATCH") return { kind: "mcp-server-description-update", serverName };

	return undefined;
}

export function chatCapabilityRouteRequiresSameOrigin(route: ChatCapabilityRoute): boolean {
	return route.kind !== "pi-packages-list" && route.kind !== "pi-package-read";
}

export async function handleChatCapabilityRoute(options: {
	route: ChatCapabilityRoute;
	request: Request;
	cwd: string;
	invalidateBootstrapCatalogCache: () => void;
	agentsSelectingPiPackage: (packageId: string) => readonly PiPackageAgentSelection[];
}): Promise<Response> {
	const { route, request, cwd, invalidateBootstrapCatalogCache, agentsSelectingPiPackage } = options;
	switch (route.kind) {
		case "pi-packages-list":
			return responseJson({ packages: listPiPackages() });
		case "pi-packages-create": {
			const body = await readJsonBody<ChatPiPackageBody>(request);
			const source = normalizePiPackageWebSource(body.source);
			const pkg = upsertPiPackage(await inspectPiPackageSource(source, cwd), cwd);
			invalidateBootstrapCatalogCache();
			return responseJson({ package: pkg }, { status: 201 });
		}
		case "pi-package-read": {
			const pkg = findPiPackage(route.packageId);
			if (!pkg) throw new PiboWebHttpError("Pi package is not registered", 404);
			return responseJson({ package: pkg });
		}
		case "pi-package-update": {
			const existing = findPiPackage(route.packageId);
			if (!existing) throw new PiboWebHttpError("Pi package is not registered", 404);
			const body = await readJsonBody<ChatPiPackagePatchBody>(request);
			let pkg = existing;
			let changed = false;
			if (body.source !== undefined) {
				const source = normalizePiPackageWebSource(body.source);
				pkg = upsertPiPackage(await inspectPiPackageSource(source, cwd), cwd);
				changed = true;
			}
			if (body.enabled !== undefined) {
				if (typeof body.enabled !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
				const updated = setPiPackageEnabled(pkg.id, body.enabled);
				if (!updated) throw new PiboWebHttpError("Pi package is not registered", 404);
				pkg = updated;
				changed = true;
			}
			if (!changed) throw new PiboWebHttpError("No Pi package update fields provided", 400);
			invalidateBootstrapCatalogCache();
			return responseJson({ package: pkg });
		}
		case "pi-package-delete": {
			const existing = findPiPackage(route.packageId);
			if (!existing) throw new PiboWebHttpError("Pi package is not registered", 404);
			const affectedAgents = agentsSelectingPiPackage(route.packageId);
			if (affectedAgents.length > 0) {
				throw new PiboWebHttpError(
					`Pi package is selected by custom agents: ${affectedAgents.map((agent) => agent.profileName).join(", ")}`,
					409,
				);
			}
			const removed = removePiPackage(route.packageId);
			invalidateBootstrapCatalogCache();
			return responseJson({ removedPackage: removed });
		}
		case "mcp-server-description-update": {
			const body = await readJsonBody<ChatMcpServerDescriptionBody>(request);
			const server = await setMcpServerDescription(
				route.serverName,
				normalizeMcpServerDescriptionBody(body.description),
			);
			invalidateBootstrapCatalogCache();
			return responseJson({ server });
		}
	}
}
