import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..", "..");

describe("vscode/vsix-fetcher", () => {
	const script = `
		import assert from "node:assert/strict";
		import {
			findVsixAsset,
			fetchRelease,
			fetchLatestVsix,
			isVsixAsset,
		} from "./src/vscode/vsix-fetcher.ts";

		// isVsixAsset: case-insensitive suffix match.
		assert.equal(isVsixAsset({ name: "pibo-1.3.0.vsix", browserDownloadUrl: "x", size: 1, contentType: "x" }), true);
		assert.equal(isVsixAsset({ name: "Pibo-1.3.0.VSIX", browserDownloadUrl: "x", size: 1, contentType: "x" }), true);
		assert.equal(isVsixAsset({ name: "pibo-1.3.0.zip", browserDownloadUrl: "x", size: 1, contentType: "x" }), false);
		assert.equal(isVsixAsset({ name: "vsix.txt", browserDownloadUrl: "x", size: 1, contentType: "x" }), false);

		// findVsixAsset: returns the first .vsix asset in the release.
		{
			const release = {
				tagName: "v1.3.0",
				name: "v1.3.0",
				publishedAt: "2026-06-09T00:00:00Z",
				htmlUrl: "https://example.com/release",
				assets: [
					{ name: "source.zip", browserDownloadUrl: "https://example.com/source.zip", size: 1, contentType: "application/zip" },
					{ name: "pibo-1.3.0.vsix", browserDownloadUrl: "https://example.com/pibo.vsix", size: 2, contentType: "application/octet-stream" },
				],
			};
			const asset = findVsixAsset(release);
			assert.ok(asset, "should find the vsix asset");
			assert.equal(asset.name, "pibo-1.3.0.vsix");
		}

		// findVsixAsset: returns undefined when no .vsix is present.
		{
			const release = {
				tagName: "v0.0.1",
				name: "v0.0.1",
				publishedAt: "2026-01-01T00:00:00Z",
				htmlUrl: "https://example.com/release",
				assets: [
					{ name: "source.zip", browserDownloadUrl: "https://example.com/source.zip", size: 1, contentType: "application/zip" },
				],
			};
			assert.equal(findVsixAsset(release), undefined);
		}

		// fetchRelease: decodes a GitHub API JSON payload.
		{
			const seen = [];
			const fetchImpl = async (url, init) => {
				seen.push({ url, init });
				return new Response(JSON.stringify({
					tag_name: "v1.3.0",
					name: "Pibo 1.3.0",
					published_at: "2026-06-09T00:00:00Z",
					html_url: "https://github.com/Pascapone/pibo/releases/tag/v1.3.0",
					assets: [
						{ name: "pibo-1.3.0.vsix", browser_download_url: "https://github.com/Pascapone/pibo/releases/download/v1.3.0/pibo-1.3.0.vsix", size: 1234, content_type: "application/octet-stream" },
					],
				}), { status: 200, headers: { "content-type": "application/json" } });
			};
			const release = await fetchRelease({ owner: "Pascapone", repo: "pibo", fetchImpl });
			assert.equal(release.tagName, "v1.3.0");
			assert.equal(release.assets.length, 1);
			assert.equal(release.assets[0].name, "pibo-1.3.0.vsix");
			assert.equal(seen[0].url, "https://api.github.com/repos/Pascapone/pibo/releases/latest");
		}

		// fetchRelease: 404 for a specific tag → clear error message.
		{
			const fetchImpl = async () => new Response("not found", { status: 404 });
			await assert.rejects(
				() => fetchRelease({ owner: "x", repo: "y", tagName: "v9.9.9", fetchImpl }),
				/v9\.9\.9 not found/,
			);
		}

		// fetchRelease: 404 with no tag → "no published releases" message.
		{
			const fetchImpl = async () => new Response("not found", { status: 404 });
			await assert.rejects(
				() => fetchRelease({ owner: "x", repo: "y", fetchImpl }),
				/no published releases/,
			);
		}

		// fetchLatestVsix: full flow, downloads bytes for the .vsix asset.
		{
			const calls = [];
			const fetchImpl = async (url) => {
				calls.push(url);
				if (url.includes("/releases/")) {
					return new Response(JSON.stringify({
						tag_name: "v1.3.0",
						name: "v1.3.0",
						published_at: "2026-06-09T00:00:00Z",
						html_url: "https://example.com",
						assets: [
							{ name: "pibo-1.3.0.vsix", browser_download_url: "https://cdn.example.com/pibo.vsix", size: 4, content_type: "application/octet-stream" },
						],
					}), { status: 200, headers: { "content-type": "application/json" } });
				}
				return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "application/octet-stream" } });
			};
			const result = await fetchLatestVsix({ owner: "Pascapone", repo: "pibo", fetchImpl });
			assert.equal(result.tagName, "v1.3.0");
			assert.equal(result.asset.name, "pibo-1.3.0.vsix");
			assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
		}

		// fetchLatestVsix: release with no .vsix asset → error.
		{
			const fetchImpl = async () => new Response(JSON.stringify({
				tag_name: "v0.0.1",
				name: "v0.0.1",
				published_at: "2026-01-01T00:00:00Z",
				html_url: "https://example.com",
				assets: [],
			}), { status: 200, headers: { "content-type": "application/json" } });
			await assert.rejects(
				() => fetchLatestVsix({ owner: "x", repo: "y", fetchImpl }),
				/no \.vsix asset/,
			);
		}
	`;

	test("parses GitHub release payloads and fetches VSIX assets", async () => {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: root });
	});
});
