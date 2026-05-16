import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PiboAuthError } from "../auth/types.js";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import { handleSimpleAgentApiRequest } from "../api/simple-agent-api.js";
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
	canonicalBaseURL?: string;
	gatewayMode?: "dev" | "prod" | "fallback" | "unknown";
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

function isActiveRunStatus(status: unknown): boolean {
	return typeof status === "string" && ["queued", "starting", "running", "streaming", "waiting", "blocked", "retrying", "compacting", "pausing"].includes(status);
}

function isActiveRunSnapshotStatus(status: unknown): boolean {
	return typeof status === "string" && (status === "queued" || status === "running");
}

function gatewayMode(options: WebHostChannelOptions): "dev" | "prod" | "fallback" | "unknown" {
	if (process.env.PIBO_FALLBACK_MODE === "1") return "fallback";
	return options.gatewayMode ?? "unknown";
}

function collectActiveRuns(channelContext: PiboChannelContext): unknown[] {
	const directRuns = channelContext.listRuns?.({ includeConsumed: true, includeDetached: true });
	if (directRuns) return directRuns.filter((run) => isActiveRunSnapshotStatus(run.status));

	const sessions = channelContext.listSessions?.() ?? [];
	const runs: unknown[] = [];
	const seen = new Set<string>();
	for (const session of sessions) {
		const snapshot = channelContext.snapshotSignalTree?.(session.id) as unknown;
		const snapshotObject = snapshot && typeof snapshot === "object" ? snapshot as { sessions?: unknown[] | Record<string, unknown> } : undefined;
		const rawSessions = snapshotObject?.sessions;
		const sessionSnapshots = Array.isArray(rawSessions) ? rawSessions : rawSessions && typeof rawSessions === "object" ? Object.values(rawSessions) : [];
		for (const item of sessionSnapshots) {
			if (!item || typeof item !== "object") continue;
			const activeRuns = (item as { activeRuns?: unknown[] }).activeRuns;
			if (!Array.isArray(activeRuns)) continue;
			for (const run of activeRuns) {
				if (!run || typeof run !== "object") continue;
				const runId = String((run as { runId?: unknown }).runId ?? "");
				const status = (run as { status?: unknown }).status;
				if (!isActiveRunStatus(status)) continue;
				const key = runId || JSON.stringify(run);
				if (seen.has(key)) continue;
				seen.add(key);
				runs.push(run);
			}
		}
	}
	return runs;
}

function createGatewayRuntimeStatuses(channelContext: PiboChannelContext): unknown[] {
	const statuses = channelContext.listSessionRuntimeStatuses?.() ?? [];
	return statuses.map((status) => {
		try {
			const snapshot = channelContext.snapshotSignalSession?.(status.piboSessionId);
			const activeTelemetry = snapshot?.sessions[status.piboSessionId]?.activeTelemetry;
			return activeTelemetry ? { ...status, activeTelemetry } : status;
		} catch {
			return status;
		}
	});
}

function createGatewayStatusResponse(channelContext: PiboChannelContext, options: WebHostChannelOptions): Response {
	const mode = gatewayMode(options);
	return responseJson({
		status: "ok",
		mode,
		health: { status: "ok", mode },
		runtimeStatuses: createGatewayRuntimeStatuses(channelContext),
		activeRuns: collectActiveRuns(channelContext),
	});
}

function createCanonicalRedirect(request: Request, canonicalBaseURL: string | undefined): Response | undefined {
	if (!canonicalBaseURL || (request.method !== "GET" && request.method !== "HEAD")) return undefined;
	const url = new URL(request.url);
	const canonical = new URL(canonicalBaseURL);
	if (url.origin === canonical.origin) return undefined;
	if (url.pathname !== "/" && !matchPrefix(url.pathname, "/apps") && !matchPrefix(url.pathname, "/api/auth")) {
		return undefined;
	}
	return redirect(new URL(`${url.pathname}${url.search}`, canonical.origin).toString());
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
			const canonicalRedirect = createCanonicalRedirect(request, options.canonicalBaseURL);
			if (canonicalRedirect) {
				await sendWebResponse(nodeResponse, canonicalRedirect);
				return;
			}

			if (url.pathname === "/health") {
				await sendWebResponse(
					nodeResponse,
					responseJson({
						status: "ok",
						mode: process.env.PIBO_FALLBACK_MODE === "1" ? "fallback" : "main",
					}),
				);
				return;
			}

			if (url.pathname === "/gateway/status") {
				await sendWebResponse(nodeResponse, createGatewayStatusResponse(requireContext(), options));
				return;
			}

			if (url.pathname.startsWith("/api/auth/")) {
				await sendWebResponse(nodeResponse, await handleAuthRequest(request));
				return;
			}

			const ctx = requireContext();
			const simpleApiResponse = await handleSimpleAgentApiRequest(request, ctx);
			if (simpleApiResponse) {
				await sendWebResponse(nodeResponse, simpleApiResponse);
				return;
			}

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
