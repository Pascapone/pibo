import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PiboAuthError } from "../auth/types.js";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import { requireWebSession } from "./auth.js";
import { PiboWebHttpError, nodeRequestToWebRequest, responseHtml, responseJson, sendWebResponse } from "./http.js";
import type { PiboWebAppContext } from "./types.js";

export const DEFAULT_WEB_CHANNEL_HOST = "127.0.0.1";
export const DEFAULT_WEB_CHANNEL_PORT = 4788;
export const WEB_CHANNEL_NAME = "web-host";

export type WebHostChannelOptions = {
	host?: string;
	port?: number;
	announce?: boolean;
};

export type WebHostChannel = PiboChannel & {
	getAddress(): { host: string; port: number } | undefined;
};

function redirect(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location },
	});
}

function matchPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function notFound(): Response {
	return responseJson({ error: "Not found" }, { status: 404 });
}

function createAppContext(channelContext: PiboChannelContext): PiboWebAppContext {
	return {
		channelContext,
		requireSession(input) {
			return requireWebSession(channelContext, input.request);
		},
	};
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	return raw?.split(",")[0]?.trim() || undefined;
}

function isLoopbackAddress(address: string | undefined): boolean {
	return address === "::1" || address === "127.0.0.1" || address?.startsWith("127.") === true || address?.startsWith("::ffff:127.") === true;
}

function createRequestBaseURL(nodeRequest: IncomingMessage, host: string, port: number): string {
	if (isLoopbackAddress(nodeRequest.socket.remoteAddress)) {
		const forwardedHost = firstHeaderValue(nodeRequest.headers["x-forwarded-host"]);
		const forwardedProto = firstHeaderValue(nodeRequest.headers["x-forwarded-proto"]);
		if (forwardedHost && (forwardedProto === "http" || forwardedProto === "https")) {
			return `${forwardedProto}://${forwardedHost}`;
		}
	}
	return `http://${nodeRequest.headers.host ?? `${host}:${port}`}`;
}

export function createWebHostChannel(options: WebHostChannelOptions = {}): WebHostChannel {
	const host = options.host ?? DEFAULT_WEB_CHANNEL_HOST;
	const port = options.port ?? DEFAULT_WEB_CHANNEL_PORT;
	let server: Server | undefined;
	let context: PiboChannelContext | undefined;

	const requireContext = (): PiboChannelContext => {
		if (!context) throw new Error("Web channel is not started");
		return context;
	};

	const handleAuthRequest = async (request: Request): Promise<Response> => {
		const auth = requireContext().auth;
		if (!auth?.handleRequest) {
			return responseJson({ error: "Auth service does not expose HTTP routes" }, { status: 500 });
		}
		return auth.handleRequest(request);
	};

	const handleRequest = async (nodeRequest: IncomingMessage, nodeResponse: ServerResponse): Promise<void> => {
		try {
			const baseURL = createRequestBaseURL(nodeRequest, host, port);
			const request = await nodeRequestToWebRequest(nodeRequest, baseURL);
			const url = new URL(request.url);

			if (url.pathname.startsWith("/api/auth/")) {
				await sendWebResponse(nodeResponse, await handleAuthRequest(request));
				return;
			}

			const ctx = requireContext();
			const apps = ctx.getWebApps();
			const app = apps.find(
				(candidate) => matchPrefix(url.pathname, candidate.mountPath) || matchPrefix(url.pathname, candidate.apiPrefix),
			);

			if (app) {
				const response = await app.handleRequest(request, createAppContext(ctx));
				await sendWebResponse(nodeResponse, response ?? notFound());
				return;
			}

			if (url.pathname === "/" && apps[0]) {
				await sendWebResponse(nodeResponse, redirect(apps[0].mountPath));
				return;
			}

			if (url.pathname === "/") {
				await sendWebResponse(nodeResponse, responseHtml("<!doctype html><title>Pibo</title><p>No web apps registered.</p>"));
				return;
			}

			await sendWebResponse(nodeResponse, notFound());
		} catch (error) {
			const status = error instanceof PiboAuthError || error instanceof PiboWebHttpError ? error.statusCode : 500;
			await sendWebResponse(
				nodeResponse,
				responseJson({ error: error instanceof Error ? error.message : String(error) }, { status }),
			);
		}
	};

	return {
		name: WEB_CHANNEL_NAME,
		kind: "web",
		description: "Same-origin HTTP host for pibo web apps and auth routes.",
		auth: { mode: "required" },
		async start(channelContext) {
			if (server) return;
			context = channelContext;
			server = createServer((request, response) => {
				void handleRequest(request, response);
			});
			await new Promise<void>((resolve, reject) => {
				server!.once("error", reject);
				server!.listen(port, host, () => {
					server!.off("error", reject);
					resolve();
				});
			});
			const address = this.getAddress();
			if (address && options.announce !== false) {
				console.error(`pibo web host listening on http://${address.host}:${address.port}`);
			}
		},
		async stop() {
			context = undefined;
			if (server) {
				await new Promise<void>((resolve, reject) => {
					server!.close((error) => (error ? reject(error) : resolve()));
				});
				server = undefined;
			}
		},
		getAddress() {
			const address = server?.address();
			if (!address || typeof address === "string") return undefined;
			return { host: address.address, port: address.port };
		},
	};
}
