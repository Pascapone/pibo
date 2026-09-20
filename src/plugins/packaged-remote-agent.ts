import type { ChatWebAppOptions } from "../apps/chat/web-app.js";
import { handleChatRemoteAgentApiRequest } from "../apps/chat/remote-agent-api.js";
import { PiboRemoteAgentService } from "../remote-agent/service.js";
import { PiboRemoteAgentStore } from "../remote-agent/store.js";
import type { PluginSetupContext } from "./host.js";
import {
	PIBO_CHAT_EXTENSION_SERVICE,
	PIBO_PRODUCT_OPTIONS_SERVICE,
	type PiboChatExtensionService,
	type PiboPluginProductOptions,
} from "./product-services.js";

function mcpPortFromEnv(): number | undefined {
	const raw = process.env.PIBO_REMOTE_AGENT_MCP_PORT?.trim();
	if (!raw) return undefined;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`PIBO_REMOTE_AGENT_MCP_PORT must be a port number, got: ${raw}`);
	}
	return port;
}

function gatewayPortFromEnv(): number | undefined {
	const raw = process.env.PIBO_REMOTE_AGENT_GATEWAY_PORT?.trim();
	if (!raw) return undefined;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`PIBO_REMOTE_AGENT_GATEWAY_PORT must be a port number, got: ${raw}`);
	}
	return port;
}

/** Public base URL of the MCP listener (FRP/proxy). Feeds OAuth metadata + OpenAPI servers. */
function publicBaseUrlFromEnv(): string | undefined {
	const raw = process.env.PIBO_REMOTE_AGENT_PUBLIC_URL?.trim().replace(/\/+$/, "");
	if (!raw) return undefined;
	const url = new URL(raw);
	if (url.protocol !== "https:" && url.hostname !== "localhost") {
		throw new Error(`PIBO_REMOTE_AGENT_PUBLIC_URL must be https (or http://localhost for tests), got: ${raw}`);
	}
	return raw;
}

export function setupRemoteAgent(context: PluginSetupContext): () => void {
	const product = context.services.get<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const chatOptions = { ...(product?.web?.chat ?? {}) } as ChatWebAppOptions;
	context.register("view", {});
	for (const contribution of ["module-sessions", "module-observe", "module-files", "module-bash"] as const) {
		context.register(contribution, {});
	}
	const store = new PiboRemoteAgentStore({ ...(chatOptions.remoteAgentStorePath ? { path: chatOptions.remoteAgentStorePath } : {}) });
	const mcpPort = mcpPortFromEnv();
	const publicBaseUrl = publicBaseUrlFromEnv();
	const gatewayPort = gatewayPortFromEnv();
	const service = new PiboRemoteAgentService({
		store,
		...(chatOptions.defaultProfile ? { defaultProfile: chatOptions.defaultProfile } : {}),
		...(mcpPort !== undefined ? { mcpPort } : {}),
		...(publicBaseUrl ? { publicBaseUrl } : {}),
		...(gatewayPort !== undefined ? { gatewayPort } : {}),
	});
	const chatExtensions = context.services.require<PiboChatExtensionService>(PIBO_CHAT_EXTENSION_SERVICE);
	const disposeRoute = chatExtensions.registerApiRoute(async (input) => {
		if (!new URL(input.request.url).pathname.startsWith("/api/chat/remote-agent")) return undefined;
		return await handleChatRemoteAgentApiRequest({ ...input, service });
	});
	// Resume listening when rooms are already enabled (e.g. after a restart).
	void (async () => {
		try {
			if (service.listRoomConfigs().some((config) => config.enabled)) await service.ensureStarted();
		} catch (error) {
			console.error(`[pibo] Remote Agent MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`);
		}
	})();
	return () => {
		disposeRoute();
		void service.stop().finally(() => store.close());
	};
}
