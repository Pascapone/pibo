import { createDefaultPiboPlugins } from "../plugins/builtin.js";
import type { BetterAuthServiceOptions } from "../auth/better-auth.js";
import { createPiboBetterAuthPlugin } from "../plugins/better-auth.js";
import { createPiboChatWebPlugin, type ChatWebAppOptions } from "../plugins/chat-web.js";
import { createPiboContextFilesPlugin, type ContextFilesPluginOptions } from "../plugins/context-files.js";
import { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboWebHostPlugin } from "../plugins/web.js";
import { DEFAULT_WEB_CHANNEL_HOST, DEFAULT_WEB_CHANNEL_PORT, type WebHostChannelOptions } from "../web/channel.js";
import { loadPiboConfig } from "../config/config.js";
import { PiboGatewayServer, type GatewayServerOptions } from "./server.js";

export type WebGatewayServerOptions = GatewayServerOptions & {
	auth?: BetterAuthServiceOptions;
	web?: WebHostChannelOptions;
	chat?: ChatWebAppOptions;
	contextFiles?: ContextFilesPluginOptions;
};

const PUBLIC_WEB_CHANNEL_HOST = "0.0.0.0";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function authBaseURL(options: WebGatewayServerOptions): string | undefined {
	return options.auth?.baseURL ?? loadPiboConfig().auth?.baseURL;
}

function defaultWebHost(baseURL: string | undefined): string {
	if (!baseURL) return DEFAULT_WEB_CHANNEL_HOST;
	try {
		const hostname = new URL(baseURL).hostname;
		return LOOPBACK_HOSTS.has(hostname) ? DEFAULT_WEB_CHANNEL_HOST : PUBLIC_WEB_CHANNEL_HOST;
	} catch {
		return DEFAULT_WEB_CHANNEL_HOST;
	}
}

export function resolveWebGatewayServerOptions(options: WebGatewayServerOptions = {}): WebGatewayServerOptions {
	const baseURL = authBaseURL(options);
	return {
		...options,
		web: {
			...options.web,
			host: options.web?.host ?? defaultWebHost(baseURL),
		},
	};
}

export function createWebPiboPluginRegistry(options: WebGatewayServerOptions = {}): PiboPluginRegistry {
	const resolvedOptions = resolveWebGatewayServerOptions(options);
	return PiboPluginRegistry.create({
		plugins: [
			...createDefaultPiboPlugins(),
			createPiboBetterAuthPlugin(resolvedOptions.auth),
			createPiboWebHostPlugin({ announce: false, canonicalBaseURL: authBaseURL(resolvedOptions), ...resolvedOptions.web }),
			createPiboContextFilesPlugin(resolvedOptions.contextFiles),
			createPiboChatWebPlugin(resolvedOptions.chat),
		],
	});
}

function createChatAppURL(options: WebGatewayServerOptions, host: string, port: number): string {
	const baseURL = options.auth?.baseURL ?? loadPiboConfig().auth?.baseURL;
	if (baseURL) {
		try {
			return new URL("/apps/chat", baseURL).toString();
		} catch {
			// Fall through to the bound address below.
		}
	}
	return `http://${host}:${port}/apps/chat`;
}

export async function runWebGatewayServer(options: WebGatewayServerOptions = {}): Promise<void> {
	const resolvedOptions = resolveWebGatewayServerOptions(options);
	const pluginRegistry = resolvedOptions.pluginRegistry ?? createWebPiboPluginRegistry(resolvedOptions);
	const server = new PiboGatewayServer({
		...resolvedOptions,
		pluginRegistry,
	});
	await server.start();

	const host = resolvedOptions.web?.host ?? DEFAULT_WEB_CHANNEL_HOST;
	const port = resolvedOptions.web?.port ?? DEFAULT_WEB_CHANNEL_PORT;
	console.error(`pibo chat app available at ${createChatAppURL(resolvedOptions, host, port)}`);

	const stop = async () => {
		await server.stop();
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
