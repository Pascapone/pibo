import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { loadPiboConfig } from "../config/config.js";
import { PiboWebHttpError, responseHtml, responseJson } from "../web/http.js";
import type { PiboWebApp, PiboWebAppContext } from "../web/types.js";
import {
	DEFAULT_PREVIEW_SESSION_TTL_MINUTES,
	DEFAULT_PREVIEW_TICKET_TTL_SECONDS,
	previewIdFromHostname,
	previewPublicURL,
	requirePreviewBaseURL,
} from "./config.js";
import { isPreviewTargetProcessCurrent, probePreviewTarget } from "./network.js";
import { cookieValue, PREVIEW_SESSION_COOKIE, proxyPreviewHttp, proxyPreviewWebSocket } from "./proxy.js";
import { PreviewStore, createDefaultPreviewStore, previewExposureState } from "./store.js";
import type { PreviewExposure, PublicPreviewExposure } from "./types.js";

export const PREVIEW_WEB_APP_NAME = "pibo.session-live-previews";
export const PREVIEW_WEB_MOUNT_PATH = "/apps/previews";
export const PREVIEW_WEB_API_PREFIX = "/api/previews";
export const PREVIEW_SESSION_EXCHANGE_PATH = "/__pibo/session";

export type PreviewWebAppOptions = {
	baseURL?: string;
	databasePath?: string;
	piboBaseURL?: string;
	ticketTtlSeconds?: number;
	browserSessionTtlMinutes?: number;
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

async function publicExposure(exposure: PreviewExposure, baseURL: URL): Promise<PublicPreviewExposure> {
	const state = previewExposureState(exposure);
	const processCurrent = state === "active" ? isPreviewTargetProcessCurrent(exposure) : false;
	const online = processCurrent ? Boolean(await probePreviewTarget(exposure.targetPort, { timeoutMs: 500 })) : false;
	const { workspace: _workspace, targetProcessId: _targetProcessId, targetProcessStartTicks: _targetProcessStartTicks, ...publicFields } = exposure;
	return {
		...publicFields,
		state,
		health: state === "active" ? (online ? "online" : "offline") : state,
		publicUrl: previewPublicURL(exposure.id, baseURL).toString(),
		openUrl: `${PREVIEW_WEB_API_PREFIX}/${encodeURIComponent(exposure.id)}/open`,
	};
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
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
		`${PREVIEW_SESSION_COOKIE}=${encodeURIComponent(token)}`,
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

function validPreviewExposure(store: PreviewStore, previewId: string): PreviewExposure | undefined {
	const exposure = store.getExposure(previewId);
	if (!exposure || previewExposureState(exposure) !== "active") return undefined;
	if (isPreviewTargetProcessCurrent(exposure)) return exposure;
	store.closeExposure(previewId);
	return undefined;
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

	return {
		name: PREVIEW_WEB_APP_NAME,
		mountPath: PREVIEW_WEB_MOUNT_PATH,
		apiPrefix: PREVIEW_WEB_API_PREFIX,
		matchesHost(hostname) {
			return baseURL ? previewIdFromHostname(hostname, baseURL) !== undefined : false;
		},
		async handleRequest(request, context) {
			const url = new URL(request.url);
			if (!url.pathname.startsWith(PREVIEW_WEB_API_PREFIX)) return undefined;
			await context.requireSession({ request });

			if (url.pathname === PREVIEW_WEB_API_PREFIX && request.method === "GET") {
				const piboSessionId = url.searchParams.get("piboSessionId")?.trim();
				if (!piboSessionId) return responseJson({ error: "piboSessionId is required" }, { status: 400 });
				if (!baseURL) return responseJson({ configured: false, previews: [] });
				const exposures = withStore(databasePath, (store) => store.listExposures({ piboSessionId }));
				return responseJson({ configured: true, previews: await Promise.all(exposures.map((exposure) => publicExposure(exposure, baseURL))) });
			}

			if (!baseURL) return responseJson({ error: "Live previews are not configured. Set preview.baseURL." }, { status: 503 });

			const openMatch = url.pathname.match(/^\/api\/previews\/([^/]+)\/open$/);
			if (openMatch && request.method === "GET") {
				const id = decodeURIComponent(openMatch[1]!);
				const result = withStore(databasePath, (store) => {
					const exposure = validPreviewExposure(store, id);
					if (!exposure) return undefined;
					return { exposure, ticket: store.createTicket(id, ticketTtlSeconds).token };
				});
				if (!result) return responseJson({ error: "Preview not found or inactive" }, { status: 404 });
				return previewOpenHtml(result.exposure, result.ticket, baseURL);
			}

			const previewMatch = url.pathname.match(/^\/api\/previews\/([^/]+)$/);
			if (previewMatch && request.method === "GET") {
				const id = decodeURIComponent(previewMatch[1]!);
				const exposure = withStore(databasePath, (store) => store.getExposure(id));
				if (!exposure) return responseJson({ error: "Preview not found" }, { status: 404 });
				return responseJson({ preview: await publicExposure(exposure, baseURL) });
			}
			if (previewMatch && request.method === "DELETE") {
				sameOriginMutation(request);
				const id = decodeURIComponent(previewMatch[1]!);
				const exposure = withStore(databasePath, (store) => store.closeExposure(id));
				if (!exposure) return responseJson({ error: "Preview not found" }, { status: 404 });
				return responseJson({ closed: true, preview: await publicExposure(exposure, baseURL) });
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
					const body = await readBody(request, 8 * 1024);
					const ticket = new URLSearchParams(body.toString("utf8")).get("ticket") ?? "";
					const browserSession = withStore(databasePath, (store) => {
						if (!store.consumeTicket(ticket, previewId)) return undefined;
						return store.createBrowserSession(previewId, browserSessionTtlMinutes);
					});
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

			const cookie = cookieValue(request.headers.cookie, PREVIEW_SESSION_COOKIE);
			const exposure = withStore(databasePath, (store) => {
				if (!store.authenticateBrowserSession(cookie, previewId)) return undefined;
				return validPreviewExposure(store, previewId);
			});
			if (!exposure) {
				unauthorizedPreview(response);
				return;
			}
			await proxyPreviewHttp({ request, response, requestURL, exposure, piboOrigin });
		},
		async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, _context: PiboWebAppContext, requestURL: URL) {
			if (!baseURL) {
				socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
				return;
			}
			const previewId = previewIdFromHostname(requestURL.hostname, baseURL);
			const cookie = cookieValue(request.headers.cookie, PREVIEW_SESSION_COOKIE);
			const exposure = previewId ? withStore(databasePath, (store) => {
				if (!store.authenticateBrowserSession(cookie, previewId)) return undefined;
				return validPreviewExposure(store, previewId);
			}) : undefined;
			if (!exposure) {
				socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				return;
			}
			await proxyPreviewWebSocket({ request, socket, head, requestURL, exposure });
		},
	};
}
