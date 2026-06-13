/**
 * GitHub Releases interaction for the Pibo VS Code extension.
 *
 * `pibo vscode install` defaults to fetching the latest VSIX asset from a
 * GitHub Release. The fetch path is pure-functional so the install command
 * can inject a mocked fetch and a mocked spawn in tests.
 */

import type { FetchLike, GitHubRelease, GitHubReleaseAsset, VsixFetchResult } from "./types.js";

export class VsixFetchError extends Error {
	readonly cause?: unknown;
	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "VsixFetchError";
		if (options?.cause !== undefined) this.cause = options.cause;
	}
}

const VSIX_ASSET_PATTERN = /\.vsix$/i;

export function isVsixAsset(asset: GitHubReleaseAsset): boolean {
	return VSIX_ASSET_PATTERN.test(asset.name);
}

export function findVsixAsset(release: GitHubRelease): GitHubReleaseAsset | undefined {
	return release.assets.find(isVsixAsset);
}

const GITHUB_API_ROOT = "https://api.github.com";

function buildReleaseUrl(owner: string, repo: string, tagName?: string): string {
	const base = `${GITHUB_API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
	if (tagName) return `${base}/tags/${encodeURIComponent(tagName)}`;
	return `${base}/latest`;
}

function parseRelease(payload: unknown): GitHubRelease {
	if (typeof payload !== "object" || payload === null) {
		throw new VsixFetchError("GitHub Releases payload is not an object");
	}
	const record = payload as Record<string, unknown>;
	const tagName = record.tag_name;
	const name = record.name;
	const publishedAt = record.published_at;
	const htmlUrl = record.html_url;
	const rawAssets = record.assets;
	if (typeof tagName !== "string" || typeof name !== "string" || typeof publishedAt !== "string" || typeof htmlUrl !== "string") {
		throw new VsixFetchError("GitHub Releases payload is missing required string fields");
	}
	if (!Array.isArray(rawAssets)) {
		throw new VsixFetchError("GitHub Releases payload is missing assets array");
	}
	const assets: GitHubReleaseAsset[] = [];
	for (const raw of rawAssets) {
		if (typeof raw !== "object" || raw === null) continue;
		const r = raw as Record<string, unknown>;
		if (
			typeof r.name === "string" &&
			typeof r.browser_download_url === "string" &&
			typeof r.size === "number" &&
			typeof r.content_type === "string"
		) {
			assets.push({
				name: r.name,
				browserDownloadUrl: r.browser_download_url,
				size: r.size,
				contentType: r.content_type,
			});
		}
	}
	return { tagName, name, publishedAt, htmlUrl, assets };
}

export async function fetchRelease(options: {
	owner: string;
	repo: string;
	tagName?: string;
	fetchImpl?: FetchLike;
}): Promise<GitHubRelease> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = buildReleaseUrl(options.owner, options.repo, options.tagName);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { accept: "application/vnd.github+json", "user-agent": "pibo-cli" },
		});
	} catch (error) {
		throw new VsixFetchError(`Failed to call GitHub Releases API at ${url}`, { cause: error });
	}
	if (response.status === 404) {
		throw new VsixFetchError(
			options.tagName
				? `GitHub release ${options.owner}/${options.repo}@${options.tagName} not found`
				: `GitHub repository ${options.owner}/${options.repo} has no published releases`,
		);
	}
	if (!response.ok) {
		throw new VsixFetchError(`GitHub Releases API returned HTTP ${response.status}`);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new VsixFetchError("GitHub Releases response was not valid JSON", { cause: error });
	}
	return parseRelease(payload);
}

export async function downloadVsixAsset(options: {
	url: string;
	maxBytes?: number;
	fetchImpl?: FetchLike;
}): Promise<Buffer> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const maxBytes = options.maxBytes ?? 64 * 1024 * 1024; // 64 MiB
	let response: Response;
	try {
		response = await fetchImpl(options.url, { headers: { "user-agent": "pibo-cli" } });
	} catch (error) {
		throw new VsixFetchError(`Failed to download VSIX from ${options.url}`, { cause: error });
	}
	if (!response.ok) {
		throw new VsixFetchError(`VSIX download returned HTTP ${response.status}`);
	}
	const arrayBuffer = await response.arrayBuffer();
	if (arrayBuffer.byteLength > maxBytes) {
		throw new VsixFetchError(
			`VSIX download is ${arrayBuffer.byteLength} bytes, exceeding limit of ${maxBytes} bytes`,
		);
	}
	return Buffer.from(arrayBuffer);
}

export async function fetchLatestVsix(options: {
	owner: string;
	repo: string;
	tagName?: string;
	fetchImpl?: FetchLike;
	maxBytes?: number;
}): Promise<VsixFetchResult> {
	const release = await fetchRelease({
		owner: options.owner,
		repo: options.repo,
		tagName: options.tagName,
		fetchImpl: options.fetchImpl,
	});
	const asset = findVsixAsset(release);
	if (!asset) {
		throw new VsixFetchError(`Release ${release.tagName} has no .vsix asset`);
	}
	const bytes = await downloadVsixAsset({
		url: asset.browserDownloadUrl,
		maxBytes: options.maxBytes,
		fetchImpl: options.fetchImpl,
	});
	return { tagName: release.tagName, asset, bytes };
}
