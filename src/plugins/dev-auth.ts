import { randomBytes } from "node:crypto";
import { definePiboPlugin } from "./registry.js";
import type { PiboAuthService, PiboAuthSession } from "../auth/types.js";

const COOKIE_NAME = "pibo_dev_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

function createDevAuthService(): PiboAuthService {
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
