import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { loadPiboConfig } from "../config/config.js";
import { PiboWebHttpError, responseHtml, responseJson } from "../web/http.js";
import type { PiboWebApp, PiboWebAppContext } from "../web/types.js";
import {
	DEFAULT_PREVIEW_SESSION_TTL_MINUTES,
	DEFAULT_PREVIEW_TICKET_TTL_SECONDS,
	PREVIEW_TLS_AUTHORIZATION_PATH,
	previewIdFromHostname,
	previewPublicURL,
	requirePreviewBaseURL,
} from "./config.js";
import {
	createDefaultPreviewProcessController,
	reconcileManagedPreviews,
	startManagedPreview,
	stopManagedPreview,
	type PreviewManagerOptions,
} from "./manager.js";
import { isPreviewTargetProcessCurrent, probePreviewTarget } from "./network.js";
import {
	cookieValue,
	DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS,
	DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW,
	PreviewProxyLimiter,
	previewSessionCookieName,
	proxyPreviewHttp,
	proxyPreviewWebSocket,
} from "./proxy.js";
import { PreviewCapacityError, PreviewStore, createDefaultPreviewStore, previewExposureState } from "./store.js";
import type { PreviewExposure, PreviewHealthState, PublicPreviewExposure } from "./types.js";

export const PREVIEW_WEB_APP_NAME = "pibo.session-live-previews";
export const PREVIEW_WEB_MOUNT_PATH = "/apps/previews";
export const PREVIEW_WEB_API_PREFIX = "/api/previews";
export const PREVIEW_EVENTS_PATH = `${PREVIEW_WEB_API_PREFIX}/events`;
export const PREVIEW_SESSION_EXCHANGE_PATH = "/__pibo/session";
const DEFAULT_PREVIEW_EVENT_POLL_INTERVAL_MS = 1_000;
const PREVIEW_EVENT_HEARTBEAT_INTERVAL_MS = 25_000;

export type PreviewWebAppOptions = {
	baseURL?: string;
	databasePath?: string;
	piboBaseURL?: string;
	ticketTtlSeconds?: number;
	browserSessionTtlMinutes?: number;
	managerOptions?: PreviewManagerOptions;
	reaperIntervalMs?: number | false;
	eventPollIntervalMs?: number;
	maxProxyConnections?: number;
	maxProxyConnectionsPerPreview?: number;
};

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function sameOriginMutation(request: Request): void {
	const origin = request.headers.get("origin");
	if (!origin || origin !== new URL(request.url).origin) {
		throw new PiboWebHttpError("Origin is not allowed", 403);
	}
}

function withStore<T>(path: string | undefined, action: (store: PreviewStore) => T): T {
	const store = path ? new PreviewStore(path) : createDefaultPreviewStore();
	try {
		return action(store);
	} finally {
		store.close();
	}
}

async function withStoreAsync<T>(path: string | undefined, action: (store: PreviewStore) => Promise<T>): Promise<T> {
	const store = path ? new PreviewStore(path) : createDefaultPreviewStore();
	try {
		return await action(store);
	} finally {
		store.close();
	}
}

async function exposureHealth(exposure: PreviewExposure): Promise<PreviewHealthState> {
	const state = previewExposureState(exposure);
	if (state !== "active") return state;
	if (exposure.managementMode === "managed") {
		if (exposure.serverState === "starting") return "starting";
		if (exposure.serverState === "stopping") return "stopping";
		if (exposure.serverState === "stopped") return "stopped";
		if (exposure.serverState === "error") return "error";
	}
	const processCurrent = isPreviewTargetProcessCurrent(exposure);
	const online = processCurrent ? Boolean(await probePreviewTarget(exposure.targetPort, { timeoutMs: 500 })) : false;
	return online ? "online" : "offline";
}

async function publicExposure(exposure: PreviewExposure, baseURL: URL): Promise<PublicPreviewExposure> {
	const {
		workspace: _workspace,
		startCommand: _startCommand,
		targetHost: _targetHost,
		targetPort: _targetPort,
		managementMode: _managementMode,
		proxyMode: _proxyMode,
		targetProcessId: _targetProcessId,
		targetProcessStartTicks: _targetProcessStartTicks,
		serverError: _serverError,
		serverGeneration: _serverGeneration,
		managerKind: _managerKind,
		managerId: _managerId,
		managerPid: _managerPid,
		managerProcessStartTicks: _managerProcessStartTicks,
		...publicFields
	} = exposure;
	return {
		...publicFields,
		managed: exposure.managementMode === "managed",
		state: previewExposureState(exposure),
		health: await exposureHealth(exposure),
		publicUrl: previewPublicURL(exposure.id, baseURL).toString(),
		openUrl: `${PREVIEW_WEB_API_PREFIX}/${encodeURIComponent(exposure.id)}/open`,
	};
}

function writePreviewEvent(controller: ReadableStreamDefaultController<Uint8Array>, preview: PublicPreviewExposure): void {
	controller.enqueue(new TextEncoder().encode([
		"event: preview-created",
		`data: ${JSON.stringify({ type: "preview-created", preview })}`,
		"",
		"",
	].join("\n")));
}

function createPreviewEventStream(input: {
	baseURL: URL;
	databasePath?: string;
	piboSessionId: string;
	pollIntervalMs: number;
}): Response {
	const store = input.databasePath ? new PreviewStore(input.databasePath) : createDefaultPreviewStore();
	const knownPreviewIds = new Set(store.listExposures({ piboSessionId: input.piboSessionId }).map((preview) => preview.id));
	let closed = false;
	let polling = false;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	const close = () => {
		if (closed) return;
		closed = true;
		if (pollTimer) clearInterval(pollTimer);
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		store.close();
	};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(": ready\n\n"));
			const poll = async () => {
				if (closed || polling) return;
				polling = true;
				try {
					const created = store.listExposures({ piboSessionId: input.piboSessionId })
						.filter((preview) => !knownPreviewIds.has(preview.id))
						.reverse();
					for (const exposure of created) {
						knownPreviewIds.add(exposure.id);
						const preview = await publicExposure(exposure, input.baseURL);
						if (closed) return;
						writePreviewEvent(controller, preview);
					}
				} catch (error) {
					if (!closed) controller.error(error);
					close();
				} finally {
					polling = false;
				}
			};
			pollTimer = setInterval(() => void poll(), input.pollIntervalMs);
			heartbeatTimer = setInterval(() => {
				if (!closed) controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
			}, PREVIEW_EVENT_HEARTBEAT_INTERVAL_MS);
		},
		cancel() {
			close();
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			"content-encoding": "identity",
			"x-accel-buffering": "no",
			connection: "keep-alive",
		},
	});
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		const contentLength = Number(request.headers["content-length"]);
		if (Number.isFinite(contentLength) && contentLength > maxBytes) {
			reject(new Error("Preview session exchange body is too large"));
			request.destroy();
			return;
		}
		const chunks: Buffer[] = [];
		let total = 0;
		request.on("data", (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			total += buffer.length;
			if (total > maxBytes) {
				reject(new Error("Preview session exchange body is too large"));
				request.destroy();
				return;
			}
			chunks.push(buffer);
		});
		request.once("end", () => resolve(Buffer.concat(chunks)));
		request.once("error", reject);
	});
}

function nodeJson(response: ServerResponse, status: number, payload: unknown): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	response.end(JSON.stringify(payload));
}

function nodePreviewUnavailable(response: ServerResponse, status = 503): void {
	response.writeHead(status, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
	});
	response.end("<!doctype html><title>Preview server stopped</title><p>Start this Preview server from Chat Web and reload.</p>");
}

function unauthorizedPreview(response: ServerResponse): void {
	response.writeHead(401, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
	});
	response.end("<!doctype html><title>Preview authentication required</title><p>Open this preview from an authenticated Pibo session.</p>");
}

function previewSessionCookie(token: string, requestURL: URL, expiresAt: string): string {
	const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
	const secure = requestURL.protocol === "https:";
	return [
		`${previewSessionCookieName(requestURL.protocol)}=${encodeURIComponent(token)}`,
		"Path=/",
		"HttpOnly",
		secure ? "Secure" : undefined,
		secure ? "SameSite=None" : "SameSite=Strict",
		secure ? "Partitioned" : undefined,
		`Max-Age=${maxAge}`,
	].filter(Boolean).join("; ");
}

function previewOpenHtml(exposure: PreviewExposure, ticket: string, baseURL: URL): Response {
	const action = new URL(PREVIEW_SESSION_EXCHANGE_PATH, previewPublicURL(exposure.id, baseURL)).toString();
	const html = `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Opening ${escapeHtml(exposure.label)}</title>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
<noscript><button type="submit">Open preview</button></noscript>
</form>
<script>document.forms[0].submit()</script>`;
	return responseHtml(html, {
		headers: {
			"cache-control": "no-store",
			"content-security-policy": `default-src 'none'; form-action ${new URL(action).origin}; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'`,
			"referrer-policy": "no-referrer",
		},
	});
}

async function proxyablePreviewExposure(
	store: PreviewStore,
	previewId: string,
	managerOptions: PreviewManagerOptions,
): Promise<PreviewExposure | undefined> {
	await reconcileManagedPreviews(store, managerOptions);
	const exposure = store.getExposure(previewId);
	if (!exposure || previewExposureState(exposure) !== "active") return undefined;
	if (exposure.managementMode === "managed" && exposure.serverState !== "running") return undefined;
	if (!isPreviewTargetProcessCurrent(exposure)) {
		if (exposure.managementMode === "external") store.closeExposure(previewId);
		return undefined;
	}
	return await probePreviewTarget(exposure.targetPort, { timeoutMs: 500 }) ? exposure : undefined;
}

async function authorizedProxyablePreviewExposure(
	store: PreviewStore,
	token: string | undefined,
	expectedExposure: PreviewExposure,
	managerOptions: PreviewManagerOptions,
): Promise<
	{ status: "authorized"; exposure: PreviewExposure } |
	{ status: "unauthorized" } |
	{ status: "unavailable" }
> {
	await reconcileManagedPreviews(store, managerOptions);
	const exposure = store.authorizedBrowserSessionExposure(token, expectedExposure.id, expectedExposure);
	if (!exposure) return { status: "unauthorized" };
	if (!isPreviewTargetProcessCurrent(expectedExposure)) {
		if (expectedExposure.managementMode === "external") store.closeExposure(expectedExposure.id);
		return { status: "unavailable" };
	}
	const online = Boolean(await probePreviewTarget(expectedExposure.targetPort, { timeoutMs: 500 }));
	if (!store.authorizedBrowserSessionExposure(token, expectedExposure.id, expectedExposure)) {
		return { status: "unauthorized" };
	}
	return online
		? { status: "authorized", exposure: expectedExposure }
		: { status: "unavailable" };
}

function lifecycleErrorResponse(error: unknown): Response {
	const message = error instanceof PreviewCapacityError
		? error.message
		: "Preview server operation failed";
	return responseJson({ error: message }, { status: 409 });
}

export function createPreviewWebApp(options: PreviewWebAppOptions = {}): PiboWebApp {
	const configured = loadPiboConfig();
	const baseURL = options.baseURL ? requirePreviewBaseURL(options.baseURL) : configured.preview?.baseURL ? requirePreviewBaseURL(configured.preview.baseURL) : undefined;
	const databasePath = options.databasePath ?? configured.preview?.databasePath;
	const piboOrigin = (() => {
		const value = options.piboBaseURL ?? configured.auth?.baseURL;
		if (!value) return undefined;
		try { return new URL(value).origin; } catch { return undefined; }
	})();
	const ticketTtlSeconds = options.ticketTtlSeconds ?? DEFAULT_PREVIEW_TICKET_TTL_SECONDS;
	const browserSessionTtlMinutes = options.browserSessionTtlMinutes ?? DEFAULT_PREVIEW_SESSION_TTL_MINUTES;
	if (!Number.isInteger(ticketTtlSeconds) || ticketTtlSeconds < 1 || ticketTtlSeconds > 300) {
		throw new Error("Preview ticket lifetime must be between 1 and 300 seconds");
	}
	if (!Number.isInteger(browserSessionTtlMinutes) || browserSessionTtlMinutes < 1 || browserSessionTtlMinutes > 24 * 60) {
		throw new Error("Preview browser session lifetime must be between 1 minute and 24 hours");
	}
	const eventPollIntervalMs = Math.max(50, options.eventPollIntervalMs ?? DEFAULT_PREVIEW_EVENT_POLL_INTERVAL_MS);
	const maxProxyConnections = options.maxProxyConnections ??
		configured.preview?.maxProxyConnections ??
		DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS;
	const proxyLimiter = new PreviewProxyLimiter(
		maxProxyConnections,
		options.maxProxyConnectionsPerPreview ??
			configured.preview?.maxProxyConnectionsPerPreview ??
			Math.min(DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW, maxProxyConnections),
	);
	const managerOptions: PreviewManagerOptions = {
		...options.managerOptions,
		controller: options.managerOptions?.controller ?? createDefaultPreviewProcessController(),
	};
	let reaperPromise: Promise<void> | undefined;
	const runReaper = () => {
		if (reaperPromise) return;
		reaperPromise = withStoreAsync(databasePath, async (store) => {
			await reconcileManagedPreviews(store, managerOptions);
			store.prune();
		})
			.catch((error) => console.error(`Preview server reconciliation failed: ${error instanceof Error ? error.message : String(error)}`))
			.finally(() => { reaperPromise = undefined; });
	};
	const reaperIntervalMs = !baseURL || options.reaperIntervalMs === false
		? false
		: Math.max(1_000, options.reaperIntervalMs ?? 5_000);
	const reaperTimer = reaperIntervalMs === false ? undefined : setInterval(runReaper, reaperIntervalMs);
	reaperTimer?.unref();
	if (reaperTimer) runReaper();

	return {
		name: PREVIEW_WEB_APP_NAME,
		mountPath: PREVIEW_WEB_MOUNT_PATH,
		apiPrefix: PREVIEW_WEB_API_PREFIX,
		async dispose() {
			if (reaperTimer) clearInterval(reaperTimer);
			await reaperPromise;
		},
		matchesHost(hostname) {
			return baseURL ? previewIdFromHostname(hostname, baseURL) !== undefined : false;
		},
		async handleRequest(request, context) {
			const url = new URL(request.url);
			if (!url.pathname.startsWith(PREVIEW_WEB_API_PREFIX)) return undefined;

			if (url.pathname === PREVIEW_TLS_AUTHORIZATION_PATH) {
				if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
				const previewId = baseURL ? previewIdFromHostname(url.searchParams.get("domain") ?? "", baseURL) : undefined;
				const allowed = previewId ? withStore(databasePath, (store) => {
					const exposure = store.getExposure(previewId);
					return Boolean(exposure && previewExposureState(exposure) === "active");
				}) : false;
				return new Response(null, { status: allowed ? 200 : 403, headers: { "cache-control": "no-store" } });
			}

			await context.requireSession({ request });

			if (url.pathname === PREVIEW_EVENTS_PATH && request.method === "GET") {
				const piboSessionId = url.searchParams.get("piboSessionId")?.trim();
				if (!piboSessionId) return responseJson({ error: "piboSessionId is required" }, { status: 400 });
				if (!baseURL) return responseJson({ error: "Live previews are not configured. Set preview.baseURL." }, { status: 503 });
				return createPreviewEventStream({ baseURL, databasePath, piboSessionId, pollIntervalMs: eventPollIntervalMs });
			}

			if (url.pathname === PREVIEW_WEB_API_PREFIX && request.method === "GET") {
				const piboSessionId = url.searchParams.get("piboSessionId")?.trim();
				if (!piboSessionId) return responseJson({ error: "piboSessionId is required" }, { status: 400 });
				if (!baseURL) return responseJson({ configured: false, previews: [] });
				const exposures = await withStoreAsync(databasePath, async (store) => {
					await reconcileManagedPreviews(store, managerOptions);
					return store.listExposures({ piboSessionId });
				});
				return responseJson({ configured: true, previews: await Promise.all(exposures.map((exposure) => publicExposure(exposure, baseURL))) });
			}

			if (!baseURL) return responseJson({ error: "Live previews are not configured. Set preview.baseURL." }, { status: 503 });

			const openMatch = url.pathname.match(/^\/api\/previews\/([^/]+)\/open$/);
			if (openMatch && request.method === "GET") {
				const id = decodeURIComponent(openMatch[1]!);
				const result = await withStoreAsync(databasePath, async (store) => {
					const exposure = await proxyablePreviewExposure(store, id, managerOptions);
					if (!exposure) return undefined;
					return { exposure, ticket: store.createTicket(id, ticketTtlSeconds).token };
				});
				if (!result) return responseJson({ error: "Preview server is not running" }, { status: 409 });
				return previewOpenHtml(result.exposure, result.ticket, baseURL);
			}

			const lifecycleMatch = url.pathname.match(/^\/api\/previews\/([^/]+)\/(start|stop)$/);
			if (lifecycleMatch && request.method === "POST") {
				sameOriginMutation(request);
				const id = decodeURIComponent(lifecycleMatch[1]!);
				try {
					const exposure = await withStoreAsync(databasePath, (store) => lifecycleMatch[2] === "start"
						? startManagedPreview(store, id, managerOptions)
						: stopManagedPreview(store, id, managerOptions));
					return responseJson({ preview: await publicExposure(exposure, baseURL) });
				} catch (error) {
					return lifecycleErrorResponse(error);
				}
			}

			const previewMatch = url.pathname.match(/^\/api\/previews\/([^/]+)$/);
			if (previewMatch && request.method === "GET") {
				const id = decodeURIComponent(previewMatch[1]!);
				const exposure = await withStoreAsync(databasePath, async (store) => {
					await reconcileManagedPreviews(store, managerOptions);
					return store.getExposure(id);
				});
				if (!exposure) return responseJson({ error: "Preview not found" }, { status: 404 });
				return responseJson({ preview: await publicExposure(exposure, baseURL) });
			}
			if (previewMatch && request.method === "DELETE") {
				sameOriginMutation(request);
				const id = decodeURIComponent(previewMatch[1]!);
				try {
					const exposure = await withStoreAsync(databasePath, async (store) => {
						const current = store.getExposure(id);
						if (!current) return undefined;
						if (current.managementMode === "managed" && ["running", "starting", "stopping", "error"].includes(current.serverState ?? "")) {
							await stopManagedPreview(store, id, managerOptions);
						}
						return store.closeExposure(id);
					});
					if (!exposure) return responseJson({ error: "Preview not found" }, { status: 404 });
					return responseJson({ removed: true, preview: await publicExposure(exposure, baseURL) });
				} catch (error) {
					return lifecycleErrorResponse(error);
				}
			}

			return responseJson({ error: "Not found" }, { status: 404 });
		},
		async handleNodeRequest(request, response, _context: PiboWebAppContext, requestURL) {
			if (!baseURL) {
				nodeJson(response, 503, { error: "Live previews are not configured" });
				return;
			}
			const previewId = previewIdFromHostname(requestURL.hostname, baseURL);
			if (!previewId) {
				nodeJson(response, 404, { error: "Preview not found" });
				return;
			}

			if (requestURL.pathname === PREVIEW_SESSION_EXCHANGE_PATH) {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST", "cache-control": "no-store" });
					response.end();
					return;
				}
				try {
					if (!request.headers["content-type"]?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
						response.writeHead(415, { "cache-control": "no-store" });
						response.end();
						return;
					}
					const body = await readBody(request, 8 * 1024);
					const ticket = new URLSearchParams(body.toString("utf8")).get("ticket") ?? "";
					const browserSession = withStore(databasePath, (store) =>
						store.exchangeTicketForBrowserSession(ticket, previewId, browserSessionTtlMinutes));
					if (!browserSession) {
						unauthorizedPreview(response);
						return;
					}
					response.writeHead(303, {
						location: "/",
						"cache-control": "no-store",
						"set-cookie": previewSessionCookie(browserSession.token, requestURL, browserSession.expiresAt),
					});
					response.end();
				} catch (error) {
					nodeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
				}
				return;
			}

			const cookie = cookieValue(request.headers.cookie, previewSessionCookieName(requestURL.protocol));
			const access = await withStoreAsync(databasePath, async (store) => {
				const exposure = store.authorizedBrowserSessionExposure(cookie, previewId);
				if (!exposure) return { status: "unauthorized" as const };
				return authorizedProxyablePreviewExposure(store, cookie, exposure, managerOptions);
			});
			if (access.status === "unauthorized") {
				unauthorizedPreview(response);
				return;
			}
			if (access.status === "unavailable") {
				nodePreviewUnavailable(response);
				return;
			}
			const release = proxyLimiter.tryAcquire(previewId);
			if (!release) {
				nodeJson(response, 503, { error: "Preview connection limit reached" });
				return;
			}
			try {
				const exposure = withStore(databasePath, (store) =>
					store.authorizedBrowserSessionExposure(cookie, previewId, access.exposure));
				if (!exposure) {
					unauthorizedPreview(response);
					return;
				}
				await proxyPreviewHttp({ request, response, requestURL, exposure, piboOrigin });
			} finally {
				release();
			}
		},
		async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, _context: PiboWebAppContext, requestURL: URL) {
			if (!baseURL) {
				socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
				return;
			}
			const previewId = previewIdFromHostname(requestURL.hostname, baseURL);
			const upgrade = Array.isArray(request.headers.upgrade) ? request.headers.upgrade[0] : request.headers.upgrade;
			if (upgrade?.toLowerCase() !== "websocket") {
				socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
				return;
			}
			const cookie = cookieValue(request.headers.cookie, previewSessionCookieName(requestURL.protocol));
			const access = previewId ? await withStoreAsync(databasePath, async (store) => {
				const exposure = store.authorizedBrowserSessionExposure(cookie, previewId);
				if (!exposure) return { status: "unauthorized" as const };
				return authorizedProxyablePreviewExposure(store, cookie, exposure, managerOptions);
			}) : undefined;
			if (!access || access.status === "unauthorized") {
				socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				return;
			}
			if (access.status === "unavailable") {
				socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
				return;
			}
			const release = proxyLimiter.tryAcquire(previewId!);
			if (!release) {
				socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
				return;
			}
			try {
				const exposure = withStore(databasePath, (store) =>
					store.authorizedBrowserSessionExposure(cookie, previewId!, access.exposure));
				if (!exposure) {
					socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
					return;
				}
				await proxyPreviewWebSocket({ request, socket, head, requestURL, exposure });
			} finally {
				release();
			}
		},
	};
}
