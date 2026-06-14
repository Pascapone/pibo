import { randomBytes } from "node:crypto";
import { definePiboPlugin } from "./registry.js";
import { SOCKET_PEER_HEADER } from "../web/channel.js";
import type { PiboAuthService, PiboAuthSession } from "../auth/types.js";

const COOKIE_NAME = "pibo_dev_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function generateToken(): string {
	return randomBytes(32).toString("hex");
}

function setCookie(value: string, maxAge = COOKIE_MAX_AGE): string {
	return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(): string {
	return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getCookieValue(headers: Headers): string | undefined {
	const cookie = headers.get("cookie");
	if (!cookie) return undefined;
	const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
	return match?.[1];
}

function firstHeaderValue(value: string | null): string | undefined {
	return value?.split(",")[0]?.trim() || undefined;
}

function isLoopbackHost(value: string | undefined): boolean {
	if (!value) return false;
	try {
		const hostname = new URL(`http://${value}`).hostname;
		return LOOPBACK_HOSTS.has(hostname);
	} catch {
		return false;
	}
}

function isLoopbackSocketAddress(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
	return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

/**
 * Read the TCP socket peer address attached to the request by the web host
 * channel via the `x-pibo-socket-peer` header. The header is internal and
 * stripped from any outgoing response, so it can be trusted.
 */
export function getSocketPeerForDevAuth(request: Request): string | undefined {
	return firstHeaderValue(request.headers.get(SOCKET_PEER_HEADER));
}

/**
 * Check whether the TCP socket peer attached by the channel is loopback.
 * Returns `false` (fail-closed) when the header is missing, so a request
 * that did not flow through the web host channel is never accepted.
 */
export function isLoopbackSocketPeerForDevAuth(request: Request): boolean {
	return isLoopbackSocketAddress(getSocketPeerForDevAuth(request));
}

export function isLoopbackDevAuthRequest(request: Request): boolean {
	const host = firstHeaderValue(request.headers.get("host"));
	const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
	return isLoopbackHost(host) && (!forwardedHost || isLoopbackHost(forwardedHost));
}

/**
 * Headers-only variants of the loopback predicates so `getSession` can
 * evaluate the same checks without holding on to the full `Request`
 * object. `getSession` is part of the auth service contract and only
 * receives `headers`, but the channel guarantees that the same
 * `host`, `x-forwarded-host`, and `x-pibo-socket-peer` headers are
 * present as they would be on a full `Request`.
 */
export function isLoopbackDevAuthHeaders(headers: Headers): boolean {
	const host = firstHeaderValue(headers.get("host"));
	const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
	return isLoopbackHost(host) && (!forwardedHost || isLoopbackHost(forwardedHost));
}

export function isLoopbackSocketPeerForDevAuthHeaders(headers: Headers): boolean {
	return isLoopbackSocketAddress(firstHeaderValue(headers.get(SOCKET_PEER_HEADER)));
}

export function createDevAuthService(): PiboAuthService {
	const containerToken = generateToken();
	const debugSession: PiboAuthSession = {
		identity: {
			userId: "dev-user-001",
			email: "dev@pibo.local",
			name: "Dev User",
			image: undefined,
			provider: "dev",
		},
		sessionId: "dev-session-001",
		expiresAt: new Date(Date.now() + COOKIE_MAX_AGE * 1000),
	};

	return {
		name: "dev-auth",
		async start() {
			console.error("[dev-auth] Debug auth service started");
		},
		stop() {},
		async getSession(headers) {
			// In local auth mode the loopback bind is the real security
			// boundary. Once the channel has confirmed that the request
			// reached us from a loopback host and a loopback TCP socket
			// peer, the caller is on the same host as the gateway and
			// there is no cookie jar to share. Headless clients (VS Code
			// extension, CLI scripts) can use the same dev identity as the
			// browser without needing the HttpOnly session cookie.
			if (isLoopbackDevAuthHeaders(headers) && isLoopbackSocketPeerForDevAuthHeaders(headers)) {
				return debugSession;
			}
			const token = getCookieValue(headers);
			if (token === containerToken) return debugSession;
			return undefined;
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) {
				const err = new Error("Unauthenticated") as Error & { statusCode: number };
				err.statusCode = 401;
				throw err;
			}
			return session;
		},
		async handleRequest(request) {
			if (!isLoopbackDevAuthRequest(request)) {
				return Response.json({ error: "Dev auth only accepts loopback requests" }, { status: 403 });
			}
			if (!isLoopbackSocketPeerForDevAuth(request)) {
				return Response.json({ error: "Dev auth only accepts loopback socket peers" }, { status: 403 });
			}

			const url = new URL(request.url);

			if (url.pathname === "/api/auth/sign-in/social") {
				// Simulate the Google OAuth redirect — go straight to callback
				return new Response(null, {
					status: 302,
					headers: {
						location: "/api/auth/callback/google?code=dev",
					},
				});
			}

			if (url.pathname === "/api/auth/callback/google") {
				// Set session cookie and redirect to app
				return new Response(null, {
					status: 302,
					headers: {
						"Set-Cookie": setCookie(containerToken),
						location: "/apps/chat",
					},
				});
			}

			if (url.pathname === "/api/auth/sign-out") {
				return new Response(null, {
					status: 302,
					headers: {
						"Set-Cookie": clearCookie(),
						location: "/apps/chat",
					},
				});
			}

			if (url.pathname === "/api/auth/session") {
				const session = await this.getSession(request.headers);
				return Response.json(session ?? null);
			}

			return new Response("Not found", { status: 404 });
		},
	};
}

export function createPiboDevAuthPlugin() {
	return definePiboPlugin({
		id: "pibo.dev-auth",
		name: "Dev Auth",
		register(api) {
			api.registerAuthService(createDevAuthService());
		},
	});
}
