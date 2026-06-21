// Shared GitHub App authentication helpers for the Pibo `gh`-free scripts.
//
// This module is the single source of truth for:
//   - resolving GitHub App credentials from CLI flags, env vars, or the
//     KEY=VALUE env file (with a sibling-PEM fallback for stale paths)
//   - signing App JWTs (RS256) and exchanging them for installation
//     access tokens
//   - making authenticated GitHub REST API calls
//
// Consumers:
//   - scripts/create-github-release.mjs
//   - scripts/create-github-pr.mjs
//   - scripts/test-github-app-auth.mjs
//
// The module exposes no script-level state; the caller passes its own
// `userAgent` (and optional `contentType`) to ghWithFetch, so each
// script keeps its own identity in the User-Agent header.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import jwt from "jsonwebtoken";

export const GITHUB_API_ROOT = "https://api.github.com";

const DEFAULT_USER_AGENT = "pibo-github-app-auth";

const DEFAULT_APP_ENV_LINUX = "/root/.pibo/uploads/github-app.env";
const DEFAULT_APP_ENV_WIN = join(homedir(), ".pibo", "uploads", "github-app.env");

/**
 * Return the default path to the GitHub App env file, platform-aware.
 * On Windows the path is relative to the user's home directory.
 */
export function defaultAppEnv() {
	if (process.platform === "win32") return DEFAULT_APP_ENV_WIN;
	return DEFAULT_APP_ENV_LINUX;
}

/**
 * Parse a simple KEY=VALUE env file. Empty lines and `#` comments are
 * ignored. Values are returned as strings (no shell-style unquoting).
 *
 * @param {string} path
 * @returns {Record<string, string>}
 */
export function readEnvFile(path) {
	const text = readFileSync(path, "utf8");
	const out = {};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return out;
}

/**
 * True if the file at `p` can be read as UTF-8 text. Used to probe for
 * stale absolute paths in the env file (e.g. server-side paths that
 * do not exist on a developer's laptop).
 *
 * @param {string} p
 * @returns {boolean}
 */
export function pathExists(p) {
	try {
		readFileSync(p, "utf8");
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the path to the GitHub App private key (PEM) given the parsed
 * env file. If `GITHUB_APP_PRIVATE_KEY` is set and the file is readable,
 * that path wins. Otherwise we fall back to the well-known sibling of
 * the env file itself (`<envDir>/github-app-private-key.pem`).
 *
 * Exported so test/inspection scripts can use the same fallback logic.
 *
 * @param {Record<string, string>} env parsed env file
 * @param {string} envPath path of the env file (used to compute the sibling)
 * @returns {string} absolute path to the PEM
 */
export function resolvePrivateKeyPath(env, envPath) {
	const fromEnv = env.GITHUB_APP_PRIVATE_KEY;
	if (fromEnv && pathExists(fromEnv)) return fromEnv;
	return join(dirname(envPath), "github-app-private-key.pem");
}

/**
 * Resolve GitHub App credentials from CLI args, env vars, and the env
 * file (in that order of precedence).
 *
 * Precedence per field:
 *   1. CLI flag (`cli.appId`, `cli.appKey`, `cli.appEnv`)
 *   2. Env var (`PIBO_GITHUB_APP_ID`, `PIBO_GITHUB_APP_KEY`, `PIBO_GITHUB_APP_ENV`)
 *   3. Env file (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`)
 *
 * The PEM path follows `resolvePrivateKeyPath` semantics.
 *
 * @param {{
 *   appId?: string;
 *   appKey?: string;
 *   appEnv?: string;
 * }} cli
 * @returns {{ appId: string, appKeyPath: string, owner: string | undefined, repo: string | undefined }}
 */
export function resolveAppCredentials(cli) {
	const appId = cli.appId ?? process.env.PIBO_GITHUB_APP_ID;
	let appKeyPath = cli.appKey ?? process.env.PIBO_GITHUB_APP_KEY;
	const envPath = cli.appEnv ?? process.env.PIBO_GITHUB_APP_ENV ?? defaultAppEnv();
	const fromFile = readEnvFile(envPath);
	const finalAppId = appId ?? fromFile.GITHUB_APP_ID;
	const finalKeyPath = appKeyPath ?? resolvePrivateKeyPath(fromFile, envPath);
	if (!finalAppId || !finalKeyPath) {
		throw new Error(
			`GitHub App credentials not found. Provide --app-id and --app-key, set PIBO_GITHUB_APP_ID and PIBO_GITHUB_APP_KEY, or use --app-env to point at a KEY=VALUE file.`,
		);
	}
	return {
		appId: finalAppId,
		appKeyPath: finalKeyPath,
		owner: fromFile.GITHUB_APP_OWNER,
		repo: fromFile.GITHUB_APP_REPO,
	};
}

/**
 * Make an authenticated GitHub REST API call. `userAgent` defaults to
 * `pibo-github-app-auth`; callers should pass their own script name.
 * `contentType` is only set when a JSON body is present.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} method HTTP method
 * @param {string} url full URL
 * @param {string} token bearer token (App JWT or installation access token)
 * @param {unknown} [body] request body; will be JSON.stringify'd unless string
 * @param {{ userAgent?: string, contentType?: string, signal?: AbortSignal }} [options]
 * @returns {Promise<any>} parsed JSON response (or null for empty bodies)
 */
export async function ghWithFetch(fetchImpl, method, url, token, body, options = {}) {
	const { userAgent = DEFAULT_USER_AGENT, contentType, signal } = options;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": userAgent,
	};
	if (body !== undefined) headers["Content-Type"] = contentType || "application/json";
	const response = await fetchImpl(url, {
		method,
		headers,
		body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
		signal,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}\n${text}`);
	}
	return text ? JSON.parse(text) : null;
}

/**
 * Exchange a GitHub App JWT for an installation access token for the
 * given owner (account login). The installation is auto-discovered
 * via `GET /app/installations`.
 *
 * @param {string} appId
 * @param {string} privateKeyPem
 * @param {string} owner account login of the installation
 * @param {{ fetchImpl?: typeof fetch, userAgent?: string }} [options]
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function getInstallationAccessToken(appId, privateKeyPem, owner, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
	const now = Math.floor(Date.now() / 1000);
	const jwtToken = jwt.sign({ iat: now, exp: now + 600, iss: appId }, privateKeyPem, {
		algorithm: "RS256",
	});
	const installations = await ghWithFetch(
		fetchImpl,
		"GET",
		`${GITHUB_API_ROOT}/app/installations`,
		jwtToken,
		undefined,
		{ userAgent },
	);
	const inst = Array.isArray(installations)
		? installations.find((i) => i && i.account && i.account.login === owner)
		: undefined;
	if (!inst) {
		throw new Error(`No GitHub App installation found for account ${owner}`);
	}
	const access = await ghWithFetch(
		fetchImpl,
		"POST",
		`${GITHUB_API_ROOT}/app/installations/${inst.id}/access_tokens`,
		jwtToken,
		undefined,
		{ userAgent },
	);
	if (!access || !access.token) {
		throw new Error("GitHub installation access token response did not include a token");
	}
	return { token: access.token, expiresAt: access.expires_at };
}
