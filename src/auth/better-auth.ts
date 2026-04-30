import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer } from "better-auth/plugins";
import { loadPiboConfig } from "../config/config.js";
import type { PiboAuthService, PiboAuthSession } from "./types.js";
import { createForbiddenAuthError, createUnauthenticatedError } from "./types.js";

export type BetterAuthServiceOptions = {
	baseURL?: string;
	databasePath?: string;
	secret?: string;
	googleClientId?: string;
	googleClientSecret?: string;
	trustedOrigins?: string[];
	allowedEmails?: string[];
};

export function createTrustedOrigins(baseURL: string, configuredOrigins?: string[]): string[] {
	const origins = new Set<string>(configuredOrigins ?? []);
	const parsed = new URL(baseURL);
	origins.add(parsed.origin);

	const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
	if (!loopbackHosts.has(parsed.hostname)) return [...origins];

	for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
		const url = new URL(parsed.origin);
		url.hostname = host;
		origins.add(url.origin);
	}
	return [...origins];
}

function requiredOption(value: string | undefined, key: string): string {
	if (!value) throw new Error(`${key} is required in pibo config for Better Auth`);
	return value;
}

function requiredSecret(value: string | undefined): string {
	const secret = requiredOption(value, "auth.secret");
	if (secret.length < 32) {
		throw new Error("auth.secret must be at least 32 characters for pibo Better Auth");
	}
	return secret;
}

function createAllowedEmailSet(emails: string[]): Set<string> {
	return new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function createDatabase(path: string): DatabaseSync {
	const resolvedPath = path === ":memory:" ? path : resolve(path);
	if (resolvedPath !== ":memory:") {
		mkdirSync(dirname(resolvedPath), { recursive: true });
	}
	return new DatabaseSync(resolvedPath);
}

function requiredAllowedEmails(options: BetterAuthServiceOptions, configAllowedEmails: string[] | undefined): Set<string> {
	const allowedEmails =
		options.allowedEmails !== undefined
			? createAllowedEmailSet(options.allowedEmails)
			: configAllowedEmails !== undefined
				? createAllowedEmailSet(configAllowedEmails)
				: undefined;
	if (!allowedEmails || allowedEmails.size === 0) {
		throw new Error("auth.allowedEmails must contain at least one email in pibo config for Better Auth");
	}
	return allowedEmails;
}

export function createBetterAuthService(options: BetterAuthServiceOptions = {}): PiboAuthService {
	const config = loadPiboConfig();
	const authConfig = config.auth;
	const baseURL = requiredOption(options.baseURL ?? authConfig?.baseURL, "auth.baseURL");
	const googleClientId = requiredOption(
		options.googleClientId ?? authConfig?.googleClientId,
		"auth.googleClientId",
	);
	const googleClientSecret = requiredOption(
		options.googleClientSecret ?? authConfig?.googleClientSecret,
		"auth.googleClientSecret",
	);
	const secret = requiredSecret(options.secret ?? authConfig?.secret);
	const allowedEmails = requiredAllowedEmails(options, authConfig?.allowedEmails);
	const database = createDatabase(options.databasePath ?? authConfig?.databasePath ?? ".pibo/auth.sqlite");
	const trustedOrigins = options.trustedOrigins ?? authConfig?.trustedOrigins;
	const authOptions: BetterAuthOptions = {
		appName: "Pibo",
		baseURL,
		secret,
		database,
		trustedOrigins: createTrustedOrigins(baseURL, trustedOrigins),
		socialProviders: {
			google: {
				clientId: googleClientId,
				clientSecret: googleClientSecret,
				prompt: "select_account",
			},
		},
		plugins: [bearer()],
	};
	const auth = betterAuth(authOptions);

	return {
		name: "better-auth",
		async start() {
			const migrations = await getMigrations(authOptions);
			await migrations.runMigrations();
		},
		stop() {
			database.close();
		},
		async getSession(headers) {
			const session = await auth.api.getSession({ headers });
			if (!session) return undefined;

			const user = session.user;
			if (!allowedEmails.has(user.email.toLowerCase())) {
				throw createForbiddenAuthError();
			}

			const authSession = session.session;
			const mapped: PiboAuthSession = {
				identity: {
					userId: user.id,
					email: user.email,
					name: user.name,
					image: user.image ?? undefined,
					provider: "google",
				},
				sessionId: authSession.id,
				expiresAt: authSession.expiresAt,
			};
			return mapped;
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw createUnauthenticatedError();
			return session;
		},
		handleRequest(request) {
			return auth.handler(request);
		},
	};
}
