import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import type { PiboChatApiRouteInput, PiboChatRoomActions } from "../../plugins/product-services.js";
import {
	effectiveRemoteInternetAccess,
	effectiveRemoteMode,
	isRemoteAgentModuleName,
	RemoteAgentError,
	REMOTE_AGENT_MODULES,
	type RemoteAgentModuleName,
	type RemoteRoomConfigPatch,
} from "../../remote-agent/types.js";
import type { PiboRemoteAgentService } from "../../remote-agent/service.js";
import { isPiboRoomArchived, roomWorkspaceFromMetadata } from "./types/rooms.js";

const CHAT_WEB_API_PREFIX = "/api/chat/remote-agent";

export type ChatRemoteAgentApiOptions = PiboChatApiRouteInput & {
	service: PiboRemoteAgentService;
};

function requireSameOriginJsonRequest(request: Request): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") throw new PiboWebHttpError("Content-Type must be application/json", 415);
	const origin = request.headers.get("origin");
	if (!origin) throw new PiboWebHttpError("Origin header is required", 403);
	if (origin !== new URL(request.url).origin) throw new PiboWebHttpError("Origin is not allowed", 403);
}

function requireRoom(roomService: PiboChatRoomActions, roomId: string) {
	let room;
	try {
		room = roomService.requireRoom(roomId);
	} catch {
		throw new PiboWebHttpError("Room not found", 404);
	}
	if (isPiboRoomArchived(room)) throw new PiboWebHttpError("Archived rooms are read-only", 403);
	return room;
}

function normalizePatch(body: Record<string, unknown>): RemoteRoomConfigPatch {
	const patch: RemoteRoomConfigPatch = {};
	if (body.enabled !== undefined) {
		if (typeof body.enabled !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
		patch.enabled = body.enabled;
	}
	if (body.mode !== undefined) {
		if (body.mode !== "sandbox" && body.mode !== "yolo") throw new PiboWebHttpError("mode must be sandbox or yolo", 400);
		patch.mode = body.mode;
	}
	if (body.runtime !== undefined) {
		if (body.runtime !== "muse" && body.runtime !== "pi") throw new PiboWebHttpError("runtime must be muse or pi", 400);
		patch.runtime = body.runtime;
	}
	if (body.sandboxPath !== undefined) {
		if (typeof body.sandboxPath !== "string") {
			throw new PiboWebHttpError("sandboxPath must be a string", 400);
		}
		// Empty clears the override: the room follows its default (project folder) again.
		patch.sandboxPath = body.sandboxPath.trim();
	}
	if (body.modules !== undefined) {
		if (!body.modules || typeof body.modules !== "object" || Array.isArray(body.modules)) {
			throw new PiboWebHttpError("modules must be an object", 400);
		}
		const modules: Partial<Record<RemoteAgentModuleName, boolean>> = {};
		for (const [key, value] of Object.entries(body.modules as Record<string, unknown>)) {
			if (!isRemoteAgentModuleName(key)) throw new PiboWebHttpError(`Unknown module: ${key}`, 400);
			if (typeof value !== "boolean") throw new PiboWebHttpError(`modules.${key} must be a boolean`, 400);
			modules[key] = value;
		}
		patch.modules = modules;
	}
	if (body.defaultProfile !== undefined) {
		if (typeof body.defaultProfile !== "string" || !body.defaultProfile.trim()) {
			throw new PiboWebHttpError("defaultProfile must be a non-empty string", 400);
		}
		patch.defaultProfile = body.defaultProfile.trim();
	}
	if (body.allowedProfiles !== undefined) {
		if (!Array.isArray(body.allowedProfiles)) throw new PiboWebHttpError("allowedProfiles must be an array of strings", 400);
		patch.allowedProfiles = body.allowedProfiles.map((entry) => {
			if (typeof entry !== "string" || !entry.trim()) throw new PiboWebHttpError("allowedProfiles must hold non-empty strings", 400);
			return entry.trim();
		});
	}
	if (body.allowInternet !== undefined) {
		if (typeof body.allowInternet !== "boolean") throw new PiboWebHttpError("allowInternet must be a boolean", 400);
		patch.allowInternet = body.allowInternet;
	}
	if (Object.keys(patch).length === 0) throw new PiboWebHttpError("No remote agent update fields provided", 400);
	return patch;
}

function roomResource(pathname: string): { roomId: string; child?: "codes" | "tokens" | "tool-calls"; tokenId?: string } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/rooms/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
	if (!parts[0] || parts.length > 3) return undefined;
	const [roomId, child, tokenId] = parts as [string, string?, string?];
	if (child && child !== "codes" && child !== "tokens" && child !== "tool-calls") return undefined;
	if (tokenId && child !== "tokens") return undefined;
	if (!child && tokenId) return undefined;
	return { roomId, ...(child ? { child: child as "codes" | "tokens" | "tool-calls" } : {}), ...(tokenId ? { tokenId } : {}) };
}

function remoteErrorResponse(error: unknown): never {
	if (error instanceof RemoteAgentError) {
		const status = error.code === "room_inactive" ? 409 : 400;
		throw new PiboWebHttpError(error.message, status);
	}
	throw error;
}

export async function handleChatRemoteAgentApiRequest(options: ChatRemoteAgentApiOptions): Promise<Response | undefined> {
	const { request, service, roomService } = options;
	const url = new URL(request.url);
	if (!url.pathname.startsWith(CHAT_WEB_API_PREFIX)) return undefined;

	if (url.pathname === `${CHAT_WEB_API_PREFIX}/status` && request.method === "GET") {
		const status = service.status();
		return responseJson({ status });
	}

	const resource = roomResource(url.pathname);
	if (!resource) return undefined;
	const room = requireRoom(roomService, resource.roomId);
	const roomId = room.id;

	if (!resource.child && request.method === "GET") {
		const config = service.getRoomConfig(roomId);
		return responseJson({
			config,
			effectiveMode: effectiveRemoteMode(config),
			effectiveInternet: effectiveRemoteInternetAccess(config),
			roomWorkspace: roomWorkspaceFromMetadata(room.metadata) ?? room.workspace ?? null,
			tokens: service.listTokens(roomId),
			mcpUrl: service.displayMcpUrl() ?? null,
		});
	}

	if (!resource.child && request.method === "PATCH") {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<Record<string, unknown>>(request);
		try {
			const patch = normalizePatch(body);
			if (patch.sandboxPath === undefined && patch.enabled === true) {
				const workspace = roomWorkspaceFromMetadata(room.metadata);
				if (workspace) patch.sandboxPath = workspace;
			}
			const config = service.setRoomConfig(roomId, patch);
			if (config.enabled) await service.ensureStarted();
			else if (service.listRoomConfigs().every((entry) => !entry.enabled)) await service.stop();
			return responseJson({
				config,
				effectiveMode: effectiveRemoteMode(config),
				effectiveInternet: effectiveRemoteInternetAccess(config),
				tokens: service.listTokens(roomId),
				mcpUrl: service.displayMcpUrl() ?? null,
			});
		} catch (error) {
			remoteErrorResponse(error);
		}
	}

	if (resource.child === "codes" && !resource.tokenId && request.method === "POST") {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<{ label?: unknown }>(request);
		const label = typeof body.label === "string" ? body.label : undefined;
		try {
			await service.ensureStarted();
			return responseJson({
				code: service.createDeviceCode(roomId, label),
				mcpUrl: service.displayMcpUrl() ?? null,
			}, { status: 201 });
		} catch (error) {
			remoteErrorResponse(error);
		}
	}

	if (resource.child === "tokens" && !resource.tokenId && request.method === "GET") {
		return responseJson({ tokens: service.listTokens(roomId) });
	}

	if (resource.child === "tokens" && !resource.tokenId && request.method === "POST") {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<{ label?: unknown }>(request);
		const label = typeof body.label === "string" ? body.label : undefined;
		try {
			await service.ensureStarted();
			const issued = service.createToken(roomId, label);
			return responseJson({
				token: issued.token,
				info: issued.info,
				mcpUrl: service.displayMcpUrl() ?? null,
			}, { status: 201 });
		} catch (error) {
			remoteErrorResponse(error);
		}
	}

	if (resource.child === "tool-calls" && !resource.tokenId && request.method === "GET") {
		const limitParam = url.searchParams.get("limit");
		const parsed = limitParam === null ? undefined : Number(limitParam);
		const toolCalls = parsed === undefined ? service.listToolCalls(roomId) : service.listToolCalls(roomId, parsed);
		return responseJson({ toolCalls });
	}

	if (resource.child === "tokens" && resource.tokenId && request.method === "DELETE") {
		requireSameOriginJsonRequest(request);
		const token = service.listTokens(roomId).find((entry) => entry.id === resource.tokenId);
		if (!token) throw new PiboWebHttpError("Connection not found", 404);
		return responseJson({ revoked: service.revokeToken(resource.tokenId) });
	}

	return undefined;
}

export const REMOTE_AGENT_KNOWN_MODULES = REMOTE_AGENT_MODULES;
