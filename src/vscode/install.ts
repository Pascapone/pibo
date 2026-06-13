/**
 * `pibo vscode install` — install the Pibo VS Code extension.
 *
 * Resolution order for the VSIX artifact:
 *  1. `--vsix <path>`     → use the local file directly
 *  2. `--from-url <url>`  → download from the given URL
 *  3. default             → fetch the latest GitHub Release for the repo and
 *                            use its `.vsix` asset (optionally pinned by
 *                            `--version <tag>`)
 *
 * The resolved VSIX is cached under `~/.pibo/vscode/cache/<tagName>/` so
 * repeated installs do not re-download.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { detectCodeBinary, listInstalledExtensions, runCodeCommand } from "./code-cli.js";
import { downloadVsixAsset, fetchLatestVsix, isVsixAsset } from "./vsix-fetcher.js";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	PIBO_VSCODE_CACHE_DIR,
	PIBO_VSCODE_EXTENSION_ID,
	type FetchLike,
	type InstallResult,
	type SpawnLike,
} from "./types.js";
import { findVsixAsset, fetchRelease } from "./vsix-fetcher.js";

export type InstallCommandOptions = {
	vsixPath?: string;
	fromUrl?: string;
	version?: string;
	owner?: string;
	repo?: string;
	fetchImpl?: FetchLike;
	spawnImpl?: SpawnLike;
	env?: NodeJS.ProcessEnv;
	cacheDir?: string;
	skipCache?: boolean;
	log?: (message: string) => void;
	error?: (message: string) => void;
};

const DEFAULT_LOG = (message: string): void => {
	console.log(message);
};
const DEFAULT_ERROR = (message: string): void => {
	process.stderr.write(`${message}\n`);
};

function getCacheDir(options: { cacheDir?: string; env?: NodeJS.ProcessEnv }): string {
	if (options.cacheDir) return options.cacheDir;
	const base = options.env?.PIBO_HOME ?? join(homedir(), ".pibo");
	return join(base, PIBO_VSCODE_CACHE_DIR, "cache");
}

function cacheKeyForVersion(tagName: string): string {
	return tagName.replace(/[^A-Za-z0-9._-]/g, "_");
}

function readCachedVsix(cacheDir: string, tagName: string): string | undefined {
	const dir = join(cacheDir, cacheKeyForVersion(tagName));
	const path = join(dir, "pibo.vsix");
	return existsSync(path) ? path : undefined;
}

function writeCachedVsix(cacheDir: string, tagName: string, bytes: Buffer): string {
	const dir = join(cacheDir, cacheKeyForVersion(tagName));
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "pibo.vsix");
	writeFileSync(path, bytes);
	return path;
}

function cachedTagManifestPath(cacheDir: string): string {
	return join(cacheDir, "last-installed.json");
}

function readCachedTagManifest(cacheDir: string): { tagName?: string; vsixPath?: string } | undefined {
	const path = cachedTagManifestPath(cacheDir);
	if (!existsSync(path)) return undefined;
	try {
		const json = JSON.parse(readFileSync(path, "utf8")) as { tagName?: string; vsixPath?: string };
		return json;
	} catch {
		return undefined;
	}
}

function writeCachedTagManifest(cacheDir: string, tagName: string, vsixPath: string): void {
	const path = cachedTagManifestPath(cacheDir);
	mkdirSync(cacheDir, { recursive: true });
	writeFileSync(path, JSON.stringify({ tagName, vsixPath, installedAt: new Date().toISOString() }, null, 2));
}

export async function resolveVsixArtifact(options: {
	vsixPath?: string;
	fromUrl?: string;
	version?: string;
	owner: string;
	repo: string;
	fetchImpl?: FetchLike;
	cacheDir: string;
	skipCache?: boolean;
}): Promise<{ tagName: string; vsixPath: string; bytes?: Buffer }> {
	if (options.vsixPath) {
		const absolute = resolve(options.vsixPath);
		if (!existsSync(absolute)) {
			throw new Error(`VSIX file not found at ${absolute}`);
		}
		return { tagName: "local", vsixPath: absolute };
	}

	if (!options.skipCache && !options.version) {
		const cachedTag = readCachedTagManifest(options.cacheDir);
		if (cachedTag?.tagName && cachedTag.vsixPath && existsSync(cachedTag.vsixPath)) {
			return { tagName: cachedTag.tagName, vsixPath: cachedTag.vsixPath };
		}
	}

	if (options.fromUrl) {
		const release = await fetchRelease({ owner: options.owner, repo: options.repo, fetchImpl: options.fetchImpl });
		const asset = findVsixAsset(release) ?? { name: "remote.vsix", browserDownloadUrl: options.fromUrl, size: 0, contentType: "application/octet-stream" };
		const bytes = await downloadVsixAsset({ url: options.fromUrl, fetchImpl: options.fetchImpl });
		const cachedPath = writeCachedVsix(options.cacheDir, release.tagName, bytes);
		return { tagName: release.tagName, vsixPath: cachedPath, bytes };
	}

	const result = await fetchLatestVsix({
		owner: options.owner,
		repo: options.repo,
		tagName: options.version,
		fetchImpl: options.fetchImpl,
	});

	if (!options.skipCache) {
		const cached = readCachedVsix(options.cacheDir, result.tagName);
		if (cached) return { tagName: result.tagName, vsixPath: cached };
	}

	const cachedPath = writeCachedVsix(options.cacheDir, result.tagName, result.bytes);
	return { tagName: result.tagName, vsixPath: cachedPath, bytes: result.bytes };
}

export async function runInstall(options: InstallCommandOptions): Promise<InstallResult> {
	const log = options.log ?? DEFAULT_LOG;
	const errorLog = options.error ?? DEFAULT_ERROR;
	const owner = options.owner ?? DEFAULT_GITHUB_OWNER;
	const repo = options.repo ?? DEFAULT_GITHUB_REPO;
	const cacheDir = getCacheDir(options);
	const detected = detectCodeBinary({ env: options.env });
	if (!detected) {
		const message = `No VS Code CLI found on PATH. Install VS Code (https://code.visualstudio.com/) and run 'Shell Command: Install code command in PATH' from the VS Code command palette.`;
		errorLog(message);
		return { status: "failed", reason: "no-code-cli" };
	}

	let artifact: { tagName: string; vsixPath: string; bytes?: Buffer };
	try {
		artifact = await resolveVsixArtifact({
			vsixPath: options.vsixPath,
			fromUrl: options.fromUrl,
			version: options.version,
			owner,
			repo,
			fetchImpl: options.fetchImpl,
			cacheDir,
			skipCache: options.skipCache,
		});
	} catch (fetchError) {
		const reason = fetchError instanceof Error ? fetchError.message : String(fetchError);
		errorLog(`Failed to obtain VSIX: ${reason}`);
		return { status: "failed", reason };
	}

	log(`Installing pibo VS Code extension ${artifact.tagName} from ${artifact.vsixPath} via ${detected.path}…`);

	let installResult;
	try {
		installResult = await runCodeCommand({
			binary: detected.path,
			args: ["--install-extension", artifact.vsixPath, "--force"],
			spawnImpl: options.spawnImpl,
			env: options.env,
			timeoutMs: 120_000,
		});
	} catch (spawnError) {
		const reason = spawnError instanceof Error ? spawnError.message : String(spawnError);
		errorLog(`Failed to invoke ${detected.binary}: ${reason}`);
		return { status: "failed", reason, codeBinary: detected.path, tagName: artifact.tagName };
	}

	if (installResult.exitCode !== 0) {
		const reason = `code --install-extension exited with code ${installResult.exitCode}: ${installResult.stderr || installResult.stdout}`;
		errorLog(reason);
		return { status: "failed", reason, codeBinary: detected.path, tagName: artifact.tagName };
	}

	writeCachedTagManifest(cacheDir, artifact.tagName, artifact.vsixPath);

	try {
		const installed = await listInstalledExtensions({
			binary: detected.path,
			spawnImpl: options.spawnImpl,
			env: options.env,
		});
		const ours = installed.find((entry) => entry.id === PIBO_VSCODE_EXTENSION_ID);
		if (ours) {
			log(`Installed ${ours.id}@${ours.version ?? "?"} via ${detected.path}`);
		} else {
			log(`code --install-extension reported success but ${PIBO_VSCODE_EXTENSION_ID} is not in the installed list.`);
		}
	} catch (listError) {
		// Listing the installed extensions is a best-effort check; do not fail the install on a listing error.
		const reason = listError instanceof Error ? listError.message : String(listError);
		log(`Install completed; failed to verify via --list-extensions: ${reason}`);
	}

	return { status: "installed", tagName: artifact.tagName, vsixPath: artifact.vsixPath, codeBinary: detected.path };
}

// Re-export for symmetry with code-cli.ts consumers.
export { isVsixAsset };
