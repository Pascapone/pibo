#!/usr/bin/env node
// Create a GitHub Release for an existing tag, with optional asset upload,
// using the Pibo GitHub App. This is the `gh`-free equivalent of
// `gh release create <tag> <asset>` and is the path the release script
// takes in environments where the `gh` CLI is not available (for example,
// the pibo compute workers).
//
// Authentication uses a GitHub App installation access token, generated
// at runtime from the App ID and a PEM private key. The script accepts
// the credentials via environment variables, the GitHub App env file
// (KEY=VALUE), and CLI flags, in that order of precedence.
//
// Usage:
//   node scripts/create-github-release.mjs --tag v1.3.0 \
//     --asset dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix
//   node scripts/create-github-release.mjs --tag v1.3.0 \
//     --asset dist/.../pibo-vscode-1.3.0.vsix \
//     --notes-file release-notes.md --prerelease
//
// Library use:
//   import { createRelease } from "./scripts/create-github-release.mjs";
//   await createRelease({ owner, repo, tag, assetPath, fetchImpl });

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const DEFAULT_OWNER = "Pascapone";
const DEFAULT_REPO = "pibo";
const DEFAULT_TARGET = "main";
const DEFAULT_APP_ENV = "/root/.pibo/uploads/github-app.env";
const GITHUB_API_ROOT = "https://api.github.com";
const USER_AGENT = "pibo-create-github-release";
const ASSET_MAX_BYTES = 64 * 1024 * 1024;

function readEnvFile(path) {
	const text = readFileSync(path, "utf8");
	const out = {};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		out[key] = value;
	}
	return out;
}

function resolveAppCredentials(cli) {
	const appId = cli.appId ?? process.env.PIBO_GITHUB_APP_ID;
	let appKeyPath = cli.appKey ?? process.env.PIBO_GITHUB_APP_KEY;
	const envPath = cli.appEnv ?? process.env.PIBO_GITHUB_APP_ENV ?? DEFAULT_APP_ENV;
	const fromFile = readEnvFile(envPath);
	const finalAppId = appId ?? fromFile.GITHUB_APP_ID;
	// The env file's GITHUB_APP_PRIVATE_KEY is sometimes a stale absolute
	// path (e.g. an old server layout). If that path does not exist, fall
	// back to the well-known sibling of the env file itself.
	const siblingKey = resolve(dirname(envPath), "github-app-private-key.pem");
	let finalKeyPath = appKeyPath;
	if (!finalKeyPath) {
		const envFileKey = fromFile.GITHUB_APP_PRIVATE_KEY;
		if (envFileKey && pathExists(envFileKey)) {
			finalKeyPath = envFileKey;
		} else if (pathExists(siblingKey)) {
			finalKeyPath = siblingKey;
		} else if (envFileKey) {
			finalKeyPath = envFileKey; // will error later with a clear path
		} else {
			finalKeyPath = siblingKey;
		}
	}
	if (!finalAppId || !finalKeyPath) {
		throw new Error(
			`GitHub App credentials not found. Provide --app-id and --app-key, set PIBO_GITHUB_APP_ID and PIBO_GITHUB_APP_KEY, or use --app-env to point at a KEY=VALUE file.`,
		);
	}
	return { appId: finalAppId, appKeyPath: finalKeyPath };
}

function pathExists(p) {
	try {
		readFileSync(p, "utf8");
		return true;
	} catch {
		return false;
	}
}

function parseArgs(argv) {
	const parsed = {
		tag: undefined,
		owner: undefined,
		repo: undefined,
		targetCommitish: undefined,
		asset: undefined,
		assetName: undefined,
		name: undefined,
		notes: undefined,
		notesFile: undefined,
		prerelease: false,
		draft: false,
		appId: undefined,
		appKey: undefined,
		appEnv: undefined,
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			parsed.help = true;
		} else if (arg === "--tag") {
			parsed.tag = requireValue(argv, ++i, arg);
		} else if (arg === "--owner") {
			parsed.owner = requireValue(argv, ++i, arg);
		} else if (arg === "--repo") {
			parsed.repo = requireValue(argv, ++i, arg);
		} else if (arg === "--target") {
			parsed.targetCommitish = requireValue(argv, ++i, arg);
		} else if (arg === "--asset") {
			parsed.asset = requireValue(argv, ++i, arg);
		} else if (arg === "--asset-name") {
			parsed.assetName = requireValue(argv, ++i, arg);
		} else if (arg === "--name") {
			parsed.name = requireValue(argv, ++i, arg);
		} else if (arg === "--notes") {
			parsed.notes = requireValue(argv, ++i, arg);
		} else if (arg === "--notes-file") {
			parsed.notesFile = requireValue(argv, ++i, arg);
		} else if (arg === "--prerelease") {
			parsed.prerelease = true;
		} else if (arg === "--draft") {
			parsed.draft = true;
		} else if (arg === "--app-id") {
			parsed.appId = requireValue(argv, ++i, arg);
		} else if (arg === "--app-key") {
			parsed.appKey = requireValue(argv, ++i, arg);
		} else if (arg === "--app-env") {
			parsed.appEnv = requireValue(argv, ++i, arg);
		} else {
			throw new Error(`Unknown option ${arg}`);
		}
	}
	return parsed;
}

function requireValue(args, index, option) {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}

function printHelp() {
	console.log(`Usage: node scripts/create-github-release.mjs --tag <tag> [options]

Create a GitHub Release for an existing tag, with optional asset upload,
via the Pibo GitHub App.

Required:
  --tag <tag>             Release tag (e.g. v1.3.0). Must already exist
                          on the remote (the script does not push tags).

Options:
  --owner <owner>         Repository owner. Default: ${DEFAULT_OWNER}
  --repo <repo>           Repository name. Default: ${DEFAULT_REPO}
  --target <branch>       Target branch for the release. Default: ${DEFAULT_TARGET}
  --asset <path>          Local file to upload as a release asset.
  --asset-name <name>     Override the asset filename (default: basename of --asset).
  --name <name>           Release title (default: "Pibo <tag>").
  --notes <text>          Release notes (inline). Mutually exclusive with --notes-file.
  --notes-file <path>     Release notes from a file. Mutually exclusive with --notes.
  --prerelease            Mark the release as a prerelease.
  --draft                 Create the release as a draft.

Authentication (first match wins):
  --app-id <id> --app-key <pem-path>
  PIBO_GITHUB_APP_ID and PIBO_GITHUB_APP_KEY env vars
  --app-env <path>        Path to a KEY=VALUE env file. Default: ${DEFAULT_APP_ENV}

Other:
  --help, -h              Show this help.

Exit codes:
  0  release created (or already exists for that tag)
  1  any error
`);
}

async function gh(method, url, token, body, contentType) {
	// kept for back-compat; delegates to ghWithFetch
	return ghWithFetch(fetch, method, url, token, body, contentType);
}

/**
 * Exchange a GitHub App JWT for an installation access token.
 * @param {string} appId
 * @param {string} privateKeyPem
 * @param {string} owner account login of the installation
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function getInstallationAccessToken(appId, privateKeyPem, owner, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const now = Math.floor(Date.now() / 1000);
	const jwtToken = jwt.sign({ iat: now, exp: now + 600, iss: appId }, privateKeyPem, {
		algorithm: "RS256",
	});
	const installations = await ghWithFetch(
		fetchImpl,
		"GET",
		`${GITHUB_API_ROOT}/app/installations`,
		jwtToken,
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
	);
	if (!access || !access.token) {
		throw new Error("GitHub installation access token response did not include a token");
	}
	return { token: access.token, expiresAt: access.expires_at };
}

async function ghWithFetch(fetchImpl, method, url, token, body, contentType) {
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": USER_AGENT,
	};
	if (body !== undefined) headers["Content-Type"] = contentType || "application/json";
	const response = await fetchImpl(url, {
		method,
		headers,
		body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}\n${text}`);
	}
	return text ? JSON.parse(text) : null;
}

/**
 * Create a GitHub Release and optionally upload a single asset.
 *
 * @param {{
 *   owner: string;
 *   repo: string;
 *   tag: string;
 *   targetCommitish?: string;
 *   name?: string;
 *   body?: string;
 *   prerelease?: boolean;
 *   draft?: boolean;
 *   assetPath?: string;
 *   assetName?: string;
 *   appId: string;
 *   appKeyPath: string;
 *   fetchImpl?: typeof fetch;
 * }} options
 * @returns {Promise<{ release: object, asset: object | undefined, alreadyExisted: boolean }>}
 */
export async function createRelease(options) {
	if (!options || !options.owner || !options.repo || !options.tag) {
		throw new Error("createRelease: owner, repo, and tag are required");
	}
	if (!options.appId || !options.appKeyPath) {
		throw new Error("createRelease: appId and appKeyPath are required");
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const privateKeyPem = readFileSync(options.appKeyPath, "utf8");
	const { token: accessToken } = await getInstallationAccessToken(
		options.appId,
		privateKeyPem,
		options.owner,
		{ fetchImpl },
	);

	// Idempotency: if a release for this tag already exists, return it.
	let existing = null;
	try {
		existing = await ghWithFetch(
			fetchImpl,
			"GET",
			`${GITHUB_API_ROOT}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/releases/tags/${encodeURIComponent(options.tag)}`,
			accessToken,
		);
	} catch (err) {
		if (!/404/.test(String(err && err.message))) throw err;
	}
	if (existing) {
		let existingAsset;
		if (options.assetPath) {
			const wantName = options.assetName ?? basename(options.assetPath);
			existingAsset = (existing.assets || []).find((a) => a.name === wantName);
		}
		return { release: existing, asset: existingAsset, alreadyExisted: true };
	}

	const releaseName =
		options.name ?? `Pibo ${options.tag.replace(/^v/, "")}`;
	const release = await ghWithFetch(
		fetchImpl,
		"POST",
		`${GITHUB_API_ROOT}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/releases`,
		accessToken,
		{
			tag_name: options.tag,
			target_commitish: options.targetCommitish ?? DEFAULT_TARGET,
			name: releaseName,
			body: options.body ?? "",
			draft: options.draft ?? false,
			prerelease: options.prerelease ?? false,
			generate_release_notes: false,
		},
	);

	let uploadedAsset;
	if (options.assetPath) {
		const assetName = options.assetName ?? basename(options.assetPath);
		const bytes = readFileSync(options.assetPath);
		if (bytes.byteLength > ASSET_MAX_BYTES) {
			throw new Error(
				`Asset ${options.assetPath} is ${bytes.byteLength} bytes, exceeding limit of ${ASSET_MAX_BYTES} bytes`,
			);
		}
		const uploadUrl =
			`${release.upload_url.split("{")[0]}?name=${encodeURIComponent(assetName)}`;
		const response = await fetchImpl(uploadUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/octet-stream",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": USER_AGENT,
				"Content-Length": String(bytes.byteLength),
			},
			body: bytes,
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`asset upload failed: ${response.status}\n${text}`);
		}
		uploadedAsset = await response.json();
	}

	return { release, asset: uploadedAsset, alreadyExisted: false };
}

function basename(path) {
	const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return idx >= 0 ? path.slice(idx + 1) : path;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}
	if (!args.tag) {
		throw new Error("--tag is required (see --help)");
	}
	if (args.notes !== undefined && args.notesFile !== undefined) {
		throw new Error("--notes and --notes-file are mutually exclusive");
	}
	const body = args.notesFile ? readFileSync(args.notesFile, "utf8") : args.notes;
	const creds = resolveAppCredentials(args);

	const result = await createRelease({
		owner: args.owner ?? DEFAULT_OWNER,
		repo: args.repo ?? DEFAULT_REPO,
		tag: args.tag,
		targetCommitish: args.targetCommitish,
		name: args.name,
		body,
		prerelease: args.prerelease,
		draft: args.draft,
		assetPath: args.asset,
		assetName: args.assetName,
		appId: creds.appId,
		appKeyPath: creds.appKeyPath,
	});

	if (result.alreadyExisted) {
		console.log(`[create-release] release for ${args.tag} already exists: ${result.release.html_url}`);
	} else {
		console.log(`[create-release] release created: ${result.release.html_url}`);
	}
	if (result.asset) {
		console.log(`[create-release] asset: ${result.asset.browser_download_url} (${result.asset.size} bytes)`);
	} else if (args.asset) {
		console.log(`[create-release] no asset uploaded (release created without --asset, or asset missing on existing release)`);
	}
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	main().catch((err) => {
		console.error("[create-release] error:", err && err.message ? err.message : err);
		process.exit(1);
	});
}
