import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = join(import.meta.dirname, "..", "..");

describe("vscode/install", () => {
	const script = `
		import assert from "node:assert/strict";
		import { EventEmitter } from "node:events";
		import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { runInstall, resolveVsixArtifact } from "./src/vscode/install.ts";
		import { PIBO_VSCODE_EXTENSION_ID } from "./src/vscode/types.ts";

		function fakeChild(stdoutText, stderrText, exitCode) {
			const child = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = () => {};
			queueMicrotask(() => {
				if (stdoutText) child.stdout.emit("data", Buffer.from(stdoutText));
				child.stdout.emit("end");
				if (stderrText) child.stderr.emit("data", Buffer.from(stderrText));
				child.stderr.emit("end");
				child.emit("close", exitCode);
			});
			return child;
		}

		// ---------- resolveVsixArtifact ----------

		// --vsix <path>: uses local file, tagName "local".
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const local = join(dir, "pibo.vsix");
			writeFileSync(local, "fake-vsix-bytes");
			const result = await resolveVsixArtifact({
				vsixPath: local,
				owner: "Pascapone",
				repo: "pibo",
				cacheDir: join(dir, "cache"),
			});
			assert.equal(result.tagName, "local");
			assert.equal(result.vsixPath, local);
		}

		// Default: fetch latest release, download .vsix, write to cache.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const cacheDir = join(dir, "cache");
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
			const result = await resolveVsixArtifact({
				owner: "Pascapone",
				repo: "pibo",
				cacheDir,
				fetchImpl,
			});
			assert.equal(result.tagName, "v1.3.0");
			assert.ok(existsSync(result.vsixPath), "cached VSIX should exist on disk");
			const bytes = readFileSync(result.vsixPath);
			assert.deepEqual([...bytes], [1, 2, 3, 4]);
		}

		// Cache hit: when the manifest points to an existing file, skip the network.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const cacheDir = join(dir, "cache");
			const cachedVsix = join(cacheDir, "v1.2.1", "pibo.vsix");
			// mkdirSync equivalent via cache layout
			const { mkdirSync } = await import("node:fs");
			mkdirSync(join(cacheDir, "v1.2.1"), { recursive: true });
			writeFileSync(cachedVsix, "old-but-valid");
			writeFileSync(join(cacheDir, "last-installed.json"), JSON.stringify({ tagName: "v1.2.1", vsixPath: cachedVsix }));
			let fetched = false;
			const fetchImpl = async () => { fetched = true; return new Response("{}", { status: 200 }); };
			const result = await resolveVsixArtifact({
				owner: "Pascapone",
				repo: "pibo",
				cacheDir,
				fetchImpl,
			});
			assert.equal(result.tagName, "v1.2.1");
			assert.equal(result.vsixPath, cachedVsix);
			assert.equal(fetched, false, "should not have called fetch when cache is valid");
		}

		// --version <tag>: pin to a specific release.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const cacheDir = join(dir, "cache");
			const fetchImpl = async (url) => {
				if (url.endsWith("/releases/tags/v1.2.0")) {
					return new Response(JSON.stringify({
						tag_name: "v1.2.0",
						name: "v1.2.0",
						published_at: "2026-05-01T00:00:00Z",
						html_url: "https://example.com",
						assets: [
							{ name: "pibo-1.2.0.vsix", browser_download_url: "https://cdn.example.com/pibo-1.2.0.vsix", size: 4, content_type: "application/octet-stream" },
						],
					}), { status: 200, headers: { "content-type": "application/json" } });
				}
				return new Response(new Uint8Array([9, 9, 9, 9]), { status: 200 });
			};
			const result = await resolveVsixArtifact({
				owner: "Pascapone",
				repo: "pibo",
				version: "v1.2.0",
				cacheDir,
				fetchImpl,
				skipCache: true,
			});
			assert.equal(result.tagName, "v1.2.0");
		}

		// ---------- runInstall ----------

		// No VS Code CLI on PATH → "failed" with no-code-cli reason.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const cacheDir = join(dir, "cache");
			const result = await runInstall({
				owner: "Pascapone",
				repo: "pibo",
				env: { PATH: dir },
				cacheDir,
				fetchImpl: async () => new Response("{}", { status: 200 }),
			});
			assert.equal(result.status, "failed");
			assert.equal(result.reason, "no-code-cli");
		}

		// Happy path: download → install → list → success.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 0\\n");
			const cacheDir = join(dir, "cache");
			const fetchImpl = async (url) => {
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
				return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
			};
			const installCalls = [];
			const listCalls = [];
			const spawnImpl = (bin, args) => {
				if (args[0] === "--install-extension") {
					installCalls.push({ bin, args });
					return fakeChild("Extension 'pibo.pibo-vscode' v1.3.0 was successfully installed.\\n", "", 0);
				}
				if (args[0] === "--list-extensions") {
					listCalls.push({ bin, args });
					return fakeChild("pibo.pibo-vscode@1.3.0\\n", "", 0);
				}
				return fakeChild("", "", 1);
			};
			const result = await runInstall({
				owner: "Pascapone",
				repo: "pibo",
				env: { PATH: codeDir },
				cacheDir,
				fetchImpl,
				spawnImpl,
			});
			assert.equal(result.status, "installed");
			assert.equal(result.tagName, "v1.3.0");
			assert.equal(installCalls.length, 1);
			assert.equal(installCalls[0].args[0], "--install-extension");
			assert.equal(listCalls.length, 1);
			// manifest written
			const manifestPath = join(cacheDir, "last-installed.json");
			assert.ok(existsSync(manifestPath));
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			assert.equal(manifest.tagName, "v1.3.0");
		}

		// --vsix <path>: skips network, runs code --install-extension on the local file.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 0\\n");
			const localVsix = join(dir, "pibo.vsix");
			writeFileSync(localVsix, "local-vsix");
			const installCalls = [];
			const spawnImpl = (bin, args) => {
				if (args[0] === "--install-extension") {
					installCalls.push({ bin, args });
					return fakeChild("ok\\n", "", 0);
				}
				if (args[0] === "--list-extensions") {
					return fakeChild("pibo.pibo-vscode@1.3.0\\n", "", 0);
				}
				return fakeChild("", "", 1);
			};
			const result = await runInstall({
				owner: "Pascapone",
				repo: "pibo",
				env: { PATH: codeDir },
				vsixPath: localVsix,
				fetchImpl: async () => { throw new Error("should not fetch when --vsix is set"); },
				spawnImpl,
			});
			assert.equal(result.status, "installed");
			assert.equal(result.tagName, "local");
			assert.equal(installCalls[0].args[1], localVsix);
		}

		// code --install-extension failure → "failed" with non-empty reason.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-install-"));
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 1\\n");
			const localVsix = join(dir, "pibo.vsix");
			writeFileSync(localVsix, "local-vsix");
			const spawnImpl = (bin, args) => {
				if (args[0] === "--install-extension") {
					return fakeChild("", "extension not compatible\\n", 1);
				}
				return fakeChild("", "", 1);
			};
			const result = await runInstall({
				owner: "Pascapone",
				repo: "pibo",
				env: { PATH: codeDir },
				vsixPath: localVsix,
				spawnImpl,
			});
			assert.equal(result.status, "failed");
			assert.match(result.reason, /extension not compatible/);
		}
	`;

	test("resolves and installs the Pibo VS Code extension", async () => {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: root });
	});
});

void execFile;
