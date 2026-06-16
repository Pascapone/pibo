// Bridge between the VS Code extension's sidecar and the Pibo gateway's
// dev-auth flow.
//
// Why a separate module?
// The sidecar lives in the extension host process, not in the gateway
// process. Even when the sidecar makes a loopback HTTP request to the
// gateway at http://127.0.0.1:4788, the gateway's dev-auth plugin
// requires either:
//
//   1. A `pibo_dev_session` cookie whose value equals the in-process
//      `containerToken` minted by the dev-auth service, OR
//   2. A loopback TCP socket peer AND a loopback Host header (i.e. the
//      same Node.js process is talking to itself, as happens inside
//      the gateway's in-process test fixtures).
//
// Path 1 is the one we can rely on from a separate process. The
// SidecarAuthBridge performs the simulated OAuth handshake at sidecar
// start time, captures the resulting session cookie, and re-uses it
// on every proxied request. It also refreshes the handshake once on
// a 401 in case the gateway rotated its token.
//
// This module deliberately avoids any VS Code types so it can be
// unit-tested with a plain `node:http` mock gateway.

export const DEV_AUTH_COOKIE_NAME = "pibo_dev_session";
export const DEV_AUTH_HANDSHAKE_TIMEOUT_MS = 5_000;

export type SidecarAuthOptions = {
	/**
	 * Base URL of the gateway (e.g. `http://127.0.0.1:4788`). Must be
	 * loopback — the dev-auth plugin refuses non-loopback requests.
	 */
	gatewayBaseUrl: string;
	/**
	 * Optional `fetch`-compatible implementation. Defaults to the
	 * global `fetch`. Tests can inject a mock to script the handshake.
	 */
	fetchImpl?: typeof fetch;
};

export type SidecarAuthBridge = {
	/**
	 * Run the simulated OAuth handshake. Resolves to the captured
	 * `pibo_dev_session` cookie value, or throws if the gateway never
	 * completes the flow.
	 */
	handshake(): Promise<string>;
	/**
	 * Build a `Cookie` header value for outbound proxied requests.
	 * Performs the handshake lazily on the first call, and refreshes
	 * once if the prior handshake has been invalidated.
	 */
	getCookieHeader(): Promise<string>;
	/**
	 * Clear any in-memory state. Used by `start()` to reset between
	 * webview sessions in tests.
	 */
	reset(): void;
	/**
	 * For tests: report the current cached cookie value, if any.
	 */
	getCachedToken(): string | undefined;
};

export function createSidecarAuthBridge(options: SidecarAuthOptions): SidecarAuthBridge {
	const baseUrl = options.gatewayBaseUrl.replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	let cachedToken: string | undefined;

	const extractCookie = (setCookie: string | null): string | undefined => {
		if (!setCookie) return undefined;
		// `Set-Cookie` may appear multiple times; take the first
		// `pibo_dev_session=...` entry and ignore the rest.
		for (const part of setCookie.split(/,\s*(?=[^;]+=[^;]+)/)) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			const name = part.slice(0, eq).trim();
			if (name !== DEV_AUTH_COOKIE_NAME) continue;
			const value = part.slice(eq + 1).split(";", 1)[0]?.trim();
			if (value) return value;
		}
		return undefined;
	};

	const runHandshake = async (): Promise<string> => {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), DEV_AUTH_HANDSHAKE_TIMEOUT_MS);
		try {
			// Step 1: hit the social sign-in endpoint. The dev-auth
			// plugin returns a 302 to `/api/auth/callback/google?code=dev`.
			const signInRes = await fetchImpl(`${baseUrl}/api/auth/sign-in/social`, {
				method: "GET",
				redirect: "manual",
				signal: ctl.signal,
			});
			const signInStatus = signInRes.status;
			if (signInStatus !== 302 && signInStatus !== 303 && signInStatus !== 307) {
				throw new Error(
					`dev-auth handshake: /api/auth/sign-in/social expected 30x, got ${signInStatus}`,
				);
			}
			const location = signInRes.headers.get("location");
			if (!location) {
				throw new Error("dev-auth handshake: missing Location header on /api/auth/sign-in/social");
			}

			// Step 2: follow the redirect. Resolve the relative path
			// against the gateway base URL.
			const callbackUrl = new URL(location, baseUrl).toString();
			const callbackRes = await fetchImpl(callbackUrl, {
				method: "GET",
				redirect: "manual",
				signal: ctl.signal,
			});
			const callbackStatus = callbackRes.status;
			if (callbackStatus !== 302 && callbackStatus !== 303 && callbackStatus !== 307) {
				throw new Error(
					`dev-auth handshake: callback expected 30x, got ${callbackStatus}`,
				);
			}
			const cookieHeader = callbackRes.headers.get("set-cookie");
			const token = extractCookie(cookieHeader);
			if (!token) {
				throw new Error("dev-auth handshake: callback did not set pibo_dev_session cookie");
			}
			return token;
		} finally {
			clearTimeout(t);
		}
	};

	const getCookieHeader = async (): Promise<string> => {
		if (!cachedToken) {
			cachedToken = await runHandshake();
		}
		return `${DEV_AUTH_COOKIE_NAME}=${cachedToken}`;
	};

	const handshake = async (): Promise<string> => {
		cachedToken = await runHandshake();
		return cachedToken;
	};

	const reset = (): void => {
		cachedToken = undefined;
	};

	return {
		handshake,
		getCookieHeader,
		reset,
		getCachedToken: () => cachedToken,
	};
}

/**
 * Convenience helper for the sidecar's HTTP proxy path. Builds the
 * outbound headers the sidecar should attach to a request to the
 * gateway, given the inbound headers from the webview and a cookie
 * value from the auth bridge.
 */
export function buildProxiedHeaders(
	inboundHeaders: Headers,
	cookieHeader: string,
): Headers {
	const outbound = new Headers();
	for (const [name, value] of inboundHeaders) {
		// Strip hop-by-hop and request-internal headers that should not
		// be forwarded to the gateway, and let Node.js auto-generate a
		// fresh Host header.
		const lower = name.toLowerCase();
		if (
			lower === "host" ||
			lower === "connection" ||
			lower === "content-length" ||
			lower === "transfer-encoding" ||
			lower === "x-pibo-socket-peer"
		) {
			continue;
		}
		outbound.set(name, value);
	}
	outbound.set("cookie", cookieHeader);
	return outbound;
}

