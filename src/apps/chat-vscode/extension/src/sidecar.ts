// Port-mapped extension-host sidecar for the Pibo VS Code extension.
//
// Why a sidecar?
// VS Code 1.117.0+ tightened the workbench CSP for webviews. The old
// `window.location.replace('http://127.0.0.1:4788/apps/chat-vscode/')`
// in the empty-state shell is now rejected with
// `frame-src 'self'`. We cannot relax the workbench's CSP. Instead,
// we keep the webview on its own `vscode-webview://<id>` origin and
// route its `/api/...` calls through a small Node.js HTTP server bound
// to 127.0.0.1, using VS Code's `portMapping` webview option. The
// port-mapped origin (`https://<id>.vscode-resource.vscode-cdn.net:<port>`)
// is whitelisted in the workbench's `connect-src`, so fetch and
// EventSource succeed. The sidecar then proxies to the gateway and
// streams responses 1:1 (important for SSE).
//
// The sidecar holds a dev-auth session cookie in memory and attaches
// it to every proxied request. It binds to loopback only, enforces a
// strict CORS allowlist, and never echoes the dev-auth token to the
// webview.

import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import { Socket } from "node:net";
import type { SidecarAuthBridge } from "./sidecar-auth";

// Helper re-exported from sidecar-auth so that the sidecar can be the
// single integration point for production code (the extension
// constructs both at once) while keeping the runtime import graph
// free of cross-file TypeScript-only dependencies. The runtime
// implementation is loaded lazily; the sidecar is happy to receive
// an externally-built `SidecarAuthBridge` instead.
export type { SidecarAuthBridge } from "./sidecar-auth";

const ALLOWED_ORIGIN_PATTERN = /^vscode-webview:\/\/[^/]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PROXIED_REQUEST_TIMEOUT_MS = 30_000;
const PROXIED_REQUEST_BODY_LIMIT = 5 * 1024 * 1024; // 5 MB
const SOCKET_DRAIN_TIMEOUT_MS = 5_000;

export const DEFAULT_SIDECAR_PORT = 4789;
export const HEALTH_PROBE_TIMEOUT_MS = 1_500;

export type SidecarLogLevel = "info" | "warn" | "error" | "debug";

export type SidecarLogger = {
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
};

export type SidecarOptions = {
	/** Base URL of the gateway (e.g. `http://127.0.0.1:4788`). */
	gatewayBaseUrl: string;
	/** Loopback port to bind. Defaults to `DEFAULT_SIDECAR_PORT`. */
	sidecarPort?: number;
	/** VS Code webview id, used to validate CORS origins. */
	webviewId: string;
	/** Optional health-probe timeout, in ms. */
	healthProbeTimeoutMs?: number;
	/** Optional logger for diagnostics. */
	logger?: SidecarLogger;
	/**
	 * Optional pre-built auth bridge. Useful for tests that want to
	 * share a fixture handshake across multiple sidecar instances.
	 */
	authBridge?: SidecarAuthBridge;
	/**
	 * Optional override for the underlying `fetch` used to proxy
	 * requests. Tests use this to script the gateway side.
	 */
	fetchImpl?: typeof fetch;
};

export type Sidecar = {
	start(): Promise<void>;
	stop(): Promise<void>;
	/**
	 * The port the sidecar ended up listening on. If the requested
	 * port was busy and a fallback port was chosen, this is the
	 * fallback port. Callers MUST use this value when building the
	 * webview's `portMapping` and `<base>` href.
	 */
	port(): number;
	/**
	 * `true` when the sidecar is bound and accepting connections.
	 */
	isRunning(): boolean;
	/**
	 * The port-mapped origin the webview should target, e.g.
	 * `https://<webviewId>.vscode-resource.vscode-cdn.net:<port>`.
	 */
	getOrigin(): string;
	/**
	 * Probe the gateway for reachability. Returns `true` when a
	 * request to `/api/auth/session` completes (regardless of HTTP
	 * status) and `false` on any network error or timeout.
	 */
	isHealthy(): Promise<boolean>;
	/**
	 * Try to mint the dev-auth session cookie by running the OAuth
	 * handshake. Returns `true` when the handshake completed, `false`
	 * when it failed (e.g. the gateway is in Better Auth mode and the
	 * local dev-auth flow is not available). On failure the error
	 * message is exposed via `lastHandshakeError`.
	 */
	tryHandshake(): Promise<boolean>;
	/**
	 * Most recent error message from a failed `tryHandshake`. Used by
	 * the webview host to surface an actionable hint when the swap
	 * cannot complete because the gateway is not in dev-auth mode.
	 */
	lastHandshakeError(): string | undefined;
	/**
	 * Number of proxied requests handled since `start()`. Exposed for
	 * diagnostics.
	 */
	requestCount(): number;
};

export function createSidecar(options: SidecarOptions): Sidecar {
	const requestedPort = options.sidecarPort ?? DEFAULT_SIDECAR_PORT;
	const logger = options.logger ?? consoleLogger();
	const authBridge = options.authBridge;
	if (!authBridge) {
		throw new Error(
			"createSidecar requires an `authBridge`; build one with createSidecarAuthBridge(gatewayBaseUrl) from './sidecar-auth' and pass it in.",
		);
	}
	const gatewayBaseUrl = options.gatewayBaseUrl.replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const healthProbeTimeoutMs = options.healthProbeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;

	let server: HttpServer | null = null;
	let actualPort = requestedPort;
	let inFlight = 0;
	let proxiedRequests = 0;
	let started = false;
	let lastHandshakeErrorMessage: string | undefined;

	const log: SidecarLogger = {
		info: (m, ...args) => logger.info(`[pibo-sidecar:${actualPort}] ${m}`, ...args),
		warn: (m, ...args) => logger.warn(`[pibo-sidecar:${actualPort}] ${m}`, ...args),
		error: (m, ...args) => logger.error(`[pibo-sidecar:${actualPort}] ${m}`, ...args),
		debug: (m, ...args) => logger.debug(`[pibo-sidecar:${actualPort}] ${m}`, ...args),
	};

	const portMappedOrigin = (port: number): string =>
		`https://${options.webviewId}.vscode-resource.vscode-cdn.net:${port}`;

	const isLoopbackRequest = (req: IncomingMessage): boolean => {
		const remote = req.socket?.remoteAddress;
		if (!remote) return false;
		const normalized = remote.startsWith("::ffff:") ? remote.slice("::ffff:".length) : remote;
		return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith("127.");
	};

	const corsHeadersFor = (origin: string | undefined): Record<string, string> => {
		if (!origin) return {};
		if (!ALLOWED_ORIGIN_PATTERN.test(origin)) return {};
		return {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
			vary: "Origin",
		};
	};

	const sendJson = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extra });
		res.end(JSON.stringify(body));
	};

	const sendNoContent = (res: ServerResponse, extra: Record<string, string> = {}): void => {
		res.writeHead(204, extra);
		res.end();
	};

	const sendError = (res: ServerResponse, status: number, message: string, extra: Record<string, string> = {}): void => {
		sendJson(res, status, { error: message }, extra);
	};

	const readBodyWithLimit = (req: IncomingMessage, limit: number): Promise<Buffer> => {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let total = 0;
			let aborted = false;
			req.on("data", (chunk: Buffer) => {
				if (aborted) return;
				total += chunk.length;
				if (total > limit) {
					aborted = true;
					reject(new Error("request body too large"));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => {
				if (aborted) return;
				resolve(Buffer.concat(chunks));
			});
			req.on("error", (err) => {
				if (aborted) return;
				reject(err);
			});
		});
	};

	const forwardRequest = async (req: IncomingMessage, res: ServerResponse, requestPath: string, method: string): Promise<void> => {
		proxiedRequests += 1;
		const inboundHeaders = headersToRecord(req);
		const cors = corsHeadersFor(req.headers.origin);
		let cookieHeader: string;
		try {
			cookieHeader = await authBridge.getCookieHeader();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			lastHandshakeErrorMessage = message;
			log.warn(`auth handshake failed for ${method} ${requestPath}: ${message}`);
			sendError(res, 502, `auth handshake failed: ${message}`, cors);
			return;
		}
		const outbound = new Headers();
		for (const [name, value] of Object.entries(inboundHeaders)) {
			const lower = name.toLowerCase();
			if (
				lower === "host" ||
				lower === "connection" ||
				lower === "content-length" ||
				lower === "transfer-encoding" ||
				lower === "x-pibo-socket-peer" ||
				lower === "cookie"
			) {
				continue;
			}
			outbound.set(name, value);
		}
		outbound.set("cookie", cookieHeader);

		let body: Buffer | undefined;
		if (method !== "GET" && method !== "HEAD") {
			try {
				body = await readBodyWithLimit(req, PROXIED_REQUEST_BODY_LIMIT);
			} catch (err) {
				log.warn(`rejecting proxied ${method} ${requestPath}: ${err instanceof Error ? err.message : String(err)}`);
				sendError(res, 413, "request body too large", cors);
				return;
			}
		}

		// Copy the body into a fresh ArrayBuffer so the global `fetch`
		// typing accepts it. A shared `Buffer` view trips the stricter
		// TypeScript 6.0 lib for `BodyInit`. We only feed non-shared
		// buffers in practice (Node `Buffer` pools are detached from
		// any cross-agent `SharedArrayBuffer`), so the cast is safe.
		const fetchBody: ArrayBuffer | undefined =
			body && body.length > 0
				? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
				: undefined;

		const targetUrl = `${gatewayBaseUrl}${requestPath}`;
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), PROXIED_REQUEST_TIMEOUT_MS);
		const onClientClose = (): void => {
			ctl.abort();
		};
		req.once("close", onClientClose);

		try {
			const upstream = await fetchImpl(targetUrl, {
				method,
				headers: outbound,
				body: fetchBody,
				signal: ctl.signal,
			});
			clearTimeout(t);

			const upstreamHeaders: Record<string, string> = {};
			upstream.headers.forEach((value, name) => {
				const lower = name.toLowerCase();
				if (lower === "content-encoding" || lower === "transfer-encoding" || lower === "connection") {
					return;
				}
				upstreamHeaders[name] = value;
			});

			// Disable Nagle's algorithm so SSE events arrive promptly.
			if (req.socket instanceof Socket) {
				req.socket.setNoDelay(true);
			}

			res.writeHead(upstream.status, { ...upstreamHeaders, ...cors });
			if (upstream.body) {
				const reader = upstream.body.getReader();
				const pump = async (): Promise<void> => {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						if (!res.write(Buffer.from(value))) {
							await new Promise<void>((resolve) => res.once("drain", resolve));
						}
					}
					res.end();
				};
				await pump();
			} else {
				res.end();
			}
		} catch (err) {
			clearTimeout(t);
			const message = err instanceof Error ? err.message : String(err);
			if (err instanceof Error && err.name === "AbortError") {
				log.debug(`proxied ${method} ${requestPath} aborted (${message})`);
				if (!res.headersSent) sendError(res, 504, "gateway timeout", cors);
				else res.end();
			} else {
				log.warn(`proxied ${method} ${requestPath} failed: ${message}`);
				if (!res.headersSent) sendError(res, 502, `gateway unreachable: ${message}`, cors);
				else res.end();
			}
		} finally {
			req.removeListener("close", onClientClose);
		}
	};

	const handleHealth = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const cors = corsHeadersFor(req.headers.origin);
		const healthy = await probeHealth(fetchImpl, gatewayBaseUrl, healthProbeTimeoutMs);
		sendJson(res, 200, { gateway: healthy ? "reachable" : "unreachable" }, cors);
	};

	const handleStatus = (req: IncomingMessage, res: ServerResponse): void => {
		const cors = corsHeadersFor(req.headers.origin);
		sendJson(res, 200, {
			gateway: gatewayBaseUrl,
			webviewId: options.webviewId,
			startedAt: new Date(startTimestamp).toISOString(),
			port: actualPort,
			requestCount: proxiedRequests,
		}, cors);
	};

	const handleCorsPreflight = (req: IncomingMessage, res: ServerResponse, requestPath: string): void => {
		const origin = req.headers.origin;
		const cors = corsHeadersFor(origin);
		if (!cors["access-control-allow-origin"]) {
			sendError(res, 403, "origin not allowed");
			return;
		}
		const requestedHeaders = (req.headers["access-control-request-headers"] as string | undefined) ?? "content-type, accept, cache-control";
		const requestedMethod = (req.headers["access-control-request-method"] as string | undefined) ?? "GET, POST, PUT, PATCH, DELETE";
		res.writeHead(204, {
			...cors,
			"access-control-allow-methods": requestedMethod,
			"access-control-allow-headers": requestedHeaders,
			"access-control-max-age": "600",
		});
		res.end();
		void requestPath;
	};

	const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		inFlight += 1;
		try {
			if (!isLoopbackRequest(req)) {
				log.warn(`rejecting request from non-loopback peer ${req.socket?.remoteAddress ?? "unknown"}`);
				sendError(res, 403, "loopback only");
				return;
			}
			const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
			const method = (req.method ?? "GET").toUpperCase();

			if (requestUrl.pathname === "/health" && method === "GET") {
				await handleHealth(req, res);
				return;
			}
			if (requestUrl.pathname === "/status" && method === "GET") {
				handleStatus(req, res);
				return;
			}
			if (method === "OPTIONS") {
				handleCorsPreflight(req, res, requestUrl.pathname);
				return;
			}

			const origin = req.headers.origin;
			if (origin && !ALLOWED_ORIGIN_PATTERN.test(origin)) {
				log.warn(`rejecting proxied ${method} ${requestUrl.pathname} from non-webview origin ${origin}`);
				sendError(res, 403, "origin not allowed");
				return;
			}

			// `/api/...` and any other same-origin path falls through to the
			// gateway proxy. We forward both the path and the search string
			// so that query parameters (e.g. `?roomId=...`) survive the round
			// trip.
			const target = `${requestUrl.pathname}${requestUrl.search}`;
			await forwardRequest(req, res, target, method);
		} finally {
			inFlight -= 1;
		}
	};

	const tryListen = (port: number, host: string): Promise<number> => {
		return new Promise((resolve, reject) => {
			const s = createServer((req, res) => {
				void handleRequest(req, res);
			});
			s.once("error", (err) => {
				s.removeAllListeners();
				reject(err);
			});
			s.listen(port, host, () => {
				const address = s.address();
				if (!address || typeof address === "string") {
					s.close();
					reject(new Error("sidecar failed to determine bound address"));
					return;
				}
				resolve(address.port);
			});
			server = s;
		});
	};

	const start = async (): Promise<void> => {
		if (started) return;
		if (!LOOPBACK_HOSTS.has("127.0.0.1")) {
			throw new Error("invariant: 127.0.0.1 is not in the loopback set");
		}
		try {
			actualPort = await tryListen(requestedPort, "127.0.0.1");
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EADDRINUSE") {
				log.warn(`requested port ${requestedPort} is busy, falling back to 127.0.0.1:0`);
				actualPort = await tryListen(0, "127.0.0.1");
			} else {
				throw err;
			}
		}
		started = true;
		log.info(`bound 127.0.0.1:${actualPort}, proxying to ${gatewayBaseUrl}`);
	};

	const stop = async (): Promise<void> => {
		if (!started) return;
		started = false;
		const s = server;
		server = null;
		if (!s) return;
		const closePromise = new Promise<void>((resolve) => {
			s.close(() => resolve());
		});
		// If the port mapper is gone, in-flight requests will abort on
		// their own. Give them a bounded window to drain.
		const drainDeadline = Date.now() + SOCKET_DRAIN_TIMEOUT_MS;
		while (inFlight > 0 && Date.now() < drainDeadline) {
			await new Promise((r) => setTimeout(r, 50));
		}
		// Node's `server.close()` does not terminate active connections
		// on its own. Force-close any that linger on the keep-alive
		// socket so the close callback fires promptly.
		if (typeof s.closeAllConnections === "function") {
			s.closeAllConnections();
		}
		await closePromise;
		log.info("stopped");
	};

	const startTimestamp = Date.now();

	const tryHandshake = async (): Promise<boolean> => {
		try {
			await authBridge.handshake();
			lastHandshakeErrorMessage = undefined;
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			lastHandshakeErrorMessage = message;
			log.warn(`handshake failed: ${message}`);
			return false;
		}
	};

	return {
		start,
		stop,
		port: () => actualPort,
		isRunning: () => started,
		getOrigin: () => portMappedOrigin(actualPort),
		isHealthy: () => probeHealth(fetchImpl, gatewayBaseUrl, healthProbeTimeoutMs),
		tryHandshake,
		lastHandshakeError: () => lastHandshakeErrorMessage,
		requestCount: () => proxiedRequests,
	};
}

function headersToRecord(req: IncomingMessage): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			out[name] = value.join(", ");
		} else {
			out[name] = value;
		}
	}
	return out;
}

async function probeHealth(fetchImpl: typeof fetch, gatewayBaseUrl: string, timeoutMs: number): Promise<boolean> {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const res = await fetchImpl(`${gatewayBaseUrl}/api/auth/session`, {
			method: "GET",
			signal: ctl.signal,
		});
		// We do not require a 2xx — the gateway may respond 401 if we
		// lack a session. Both outcomes prove the gateway is up.
		void res.body?.cancel();
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(t);
	}
}

function consoleLogger(): SidecarLogger {
	const noop = (): void => {};
	return {
		info: (...args) => console.log(...args),
		warn: (...args) => console.warn(...args),
		error: (...args) => console.error(...args),
		debug: noop,
	};
}
