/**
 * `pibo vscode status` — report whether the Pibo VS Code extension is
 * installed, the local VS Code CLI binary, and the cached VSIX artifacts.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { detectCodeBinary, listInstalledExtensions } from "./code-cli.js";
import { fetchRelease } from "./vsix-fetcher.js";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	PIBO_VSCODE_CACHE_DIR,
	PIBO_VSCODE_EXTENSION_ID,
	type ExtensionStatus,
	type FetchLike,
	type SpawnLike,
} from "./types.js";

export type StatusCommandOptions = {
	owner?: string;
	repo?: string;
	fetchImpl?: FetchLike;
	spawnImpl?: SpawnLike;
	env?: NodeJS.ProcessEnv;
	cacheDir?: string;
	limit?: number;
};

function getCacheDir(options: { cacheDir?: string; env?: NodeJS.ProcessEnv }): string {
	if (options.cacheDir) return options.cacheDir;
	const base = options.env?.PIBO_HOME ?? join(homedir(), ".pibo");
	return join(base, PIBO_VSCODE_CACHE_DIR, "cache");
}

function listCachedReleases(cacheDir: string, limit: number): string[] {
	if (!existsSync(cacheDir)) return [];
	const entries = readdirSync(cacheDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
		.map((entry) => ({ name: entry.name, mtimeMs: statSync(join(cacheDir, entry.name)).mtimeMs }))
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, limit)
		.map((entry) => entry.name);
	return entries;
}

export async function runStatus(options: StatusCommandOptions = {}): Promise<ExtensionStatus> {
	const owner = options.owner ?? DEFAULT_GITHUB_OWNER;
	const repo = options.repo ?? DEFAULT_GITHUB_REPO;
	const cacheDir = getCacheDir(options);
	const limit = options.limit ?? 5;

	const detected = detectCodeBinary({ env: options.env });
	let installed = false;
	let version: string | undefined;
	if (detected) {
		try {
			const installedExtensions = await listInstalledExtensions({
				binary: detected.path,
				spawnImpl: options.spawnImpl,
				env: options.env,
			});
			const ours = installedExtensions.find((entry) => entry.id === PIBO_VSCODE_EXTENSION_ID);
			if (ours) {
				installed = true;
				version = ours.version;
			}
		} catch {
			// Listing failed; treat as not-installed for status purposes.
			installed = false;
		}
	}

	const cachedReleases = listCachedReleases(cacheDir, limit);

	let availableReleases: string[] = [];
	try {
		const release = await fetchRelease({ owner, repo, fetchImpl: options.fetchImpl });
		availableReleases = [release.tagName];
	} catch {
		// Network failure is non-fatal for status.
	}

	return {
		installed,
		version,
		codeBinary: detected?.path,
		vsixCacheDir: cacheDir,
		availableReleases,
	};
}

export function formatStatusText(status: ExtensionStatus): string {
	const lines: string[] = [];
	lines.push(`extension: ${status.installed ? `${PIBO_VSCODE_EXTENSION_ID}@${status.version ?? "?"}` : "not installed"}`);
	lines.push(`code binary: ${status.codeBinary ?? "(not on PATH)"}`);
	lines.push(`vsix cache: ${status.vsixCacheDir}`);
	if (status.availableReleases.length > 0) {
		lines.push(`latest release: ${status.availableReleases[0]}`);
	}
	return lines.join("\n");
}
