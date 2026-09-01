import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ASSET_MAX_BYTES, createRelease, preflightReleaseAsset } from "../scripts/create-github-release.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/create-github-release.mjs");
const fetchMockPath = resolve("test/fixtures/create-github-release-fetch-mock.mjs");

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		statusText: status >= 400 ? "Synthetic Failure" : "OK",
		headers: { "content-type": "application/json" },
	});
}

function createFetchMock({ existing = false, uploadStatus = 201 } = {}) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		const href = String(url);
		const method = init.method ?? "GET";
		calls.push({ href, method });
		if (href === "https://api.github.com/app/installations" && method === "GET") {
			return jsonResponse([{ id: 42, account: { login: "synthetic" } }]);
		}
		if (href === "https://api.github.com/app/installations/42/access_tokens" && method === "POST") {
			return jsonResponse({ token: "synthetic-token", expires_at: "2099-01-01T00:00:00Z" }, 201);
		}
		if (href.includes("/releases/tags/") && method === "GET") {
			if (!existing) return jsonResponse({ message: "Not Found" }, 404);
			return jsonResponse({
				id: 7,
				html_url: "https://github.test/releases/tag/v9.9.9",
				upload_url: "https://uploads.github.test/releases/7/assets{?name,label}",
				assets: [{ name: "fixture.vsix", size: 7, browser_download_url: "https://downloads.github.test/fixture.vsix" }],
			});
		}
		if (href.endsWith("/releases") && method === "POST") {
			return jsonResponse({
				id: 7,
				html_url: "https://github.test/releases/tag/v9.9.9",
				upload_url: "https://uploads.github.test/releases/7/assets{?name,label}",
				assets: [],
			}, 201);
		}
		if (href.startsWith("https://uploads.github.test/") && method === "POST") {
			if (uploadStatus !== 201) return jsonResponse({ message: "synthetic upload failure" }, uploadStatus);
			return jsonResponse({
				name: "fixture.vsix",
				size: Number(init.headers["Content-Length"]),
				browser_download_url: "https://downloads.github.test/fixture.vsix",
			}, 201);
		}
		throw new Error(`Unexpected synthetic GitHub request: ${method} ${href}`);
	};
	return { calls, fetchImpl };
}

async function makeFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-create-release-test-"));
	await chmod(root, 0o755);
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const appKeyPath = join(root, "synthetic-private-key.pem");
	const appEnvPath = join(root, "synthetic.env");
	await writeFile(appKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o644 });
	await writeFile(appEnvPath, "", { mode: 0o644 });
	t.after(() => rm(root, { recursive: true, force: true }));
	return { root, appKeyPath, appEnvPath };
}

function releaseOptions(fixture, assetPath, fetchImpl) {
	return {
		owner: "synthetic",
		repo: "release-fixture",
		tag: "v9.9.9",
		assetPath,
		assetName: "fixture.vsix",
		appId: "123",
		appKeyPath: fixture.appKeyPath,
		fetchImpl,
	};
}

function releasePosts(calls) {
	return calls.filter(({ href, method }) => href.endsWith("/releases") && method === "POST");
}

test("uploads a valid asset after creating a new release", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "fixture.vsix");
	await writeFile(assetPath, "fixture");
	const mock = createFetchMock();
	const result = await createRelease(releaseOptions(fixture, assetPath, mock.fetchImpl));

	assert.equal(result.alreadyExisted, false);
	assert.equal(result.asset.name, "fixture.vsix");
	assert.deepEqual(mock.calls.map(({ method }) => method), ["GET", "POST", "GET", "POST", "POST"]);
});

for (const invalidCase of [
	{
		name: "a missing asset",
		prepare: async (fixture) => join(fixture.root, "missing.vsix"),
		message: /cannot be read|ENOENT/,
	},
	{
		name: "a directory asset",
		prepare: async (fixture) => {
			const path = join(fixture.root, "directory.vsix");
			await mkdir(path);
			return path;
		},
		message: /regular file|EISDIR/,
	},
	{
		name: "an oversized asset",
		prepare: async (fixture) => {
			const path = join(fixture.root, "oversized.vsix");
			await writeFile(path, "");
			await truncate(path, ASSET_MAX_BYTES + 1);
			return path;
		},
		message: /exceeding limit/,
	},
]) {
	test(`rejects ${invalidCase.name} before any GitHub request`, async (t) => {
		const fixture = await makeFixture(t);
		const assetPath = await invalidCase.prepare(fixture);
		const mock = createFetchMock();
		await assert.rejects(createRelease(releaseOptions(fixture, assetPath, mock.fetchImpl)), invalidCase.message);
		assert.deepEqual(mock.calls, []);
		assert.equal(releasePosts(mock.calls).length, 0);
	});
}

test("accepts an asset exactly at the size limit during preflight", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "boundary.vsix");
	await writeFile(assetPath, "");
	await truncate(assetPath, ASSET_MAX_BYTES);
	const asset = preflightReleaseAsset(assetPath);
	assert.equal(asset.size, ASSET_MAX_BYTES);
});

test("keeps an existing release unchanged", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "fixture.vsix");
	await writeFile(assetPath, "fixture");
	const mock = createFetchMock({ existing: true });
	const result = await createRelease(releaseOptions(fixture, assetPath, mock.fetchImpl));

	assert.equal(result.alreadyExisted, true);
	assert.equal(result.asset.name, "fixture.vsix");
	assert.equal(releasePosts(mock.calls).length, 0);
	assert.equal(mock.calls.some(({ href }) => href.startsWith("https://uploads.github.test/")), false);
});

test("reports a synthetic upload failure after valid local preflight", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "fixture.vsix");
	await writeFile(assetPath, "fixture");
	const mock = createFetchMock({ uploadStatus: 500 });

	await assert.rejects(createRelease(releaseOptions(fixture, assetPath, mock.fetchImpl)), /asset upload failed: 500/);
	assert.equal(releasePosts(mock.calls).length, 1);
	assert.equal(mock.calls.at(-1).href.startsWith("https://uploads.github.test/"), true);
});

async function runCli(fixture, assetPath, options = {}) {
	const logPath = join(fixture.root, `requests-${basename(assetPath)}.json`);
	await writeFile(logPath, "[]", { mode: 0o666 });
	await chmod(logPath, 0o666);
	const args = [
		"--import",
		fetchMockPath,
		scriptPath,
		"--tag",
		"v9.9.9",
		"--owner",
		"synthetic",
		"--repo",
		"release-fixture",
		"--asset",
		assetPath,
		"--asset-name",
		"fixture.vsix",
		"--app-id",
		"123",
		"--app-key",
		fixture.appKeyPath,
		"--app-env",
		fixture.appEnvPath,
	];
	try {
		const result = await execFileAsync(process.execPath, args, {
			cwd: options.cwd ?? fixture.root,
			env: {
				...process.env,
				PIBO_RELEASE_MOCK_LOG: logPath,
				PIBO_RELEASE_MOCK_EXISTING: options.existing ? "1" : "0",
				PIBO_RELEASE_MOCK_UPLOAD_STATUS: String(options.uploadStatus ?? 201),
			},
			uid: options.uid,
			gid: options.gid,
		});
		return { ...result, code: 0, calls: JSON.parse(await readFile(logPath, "utf8")) };
	} catch (error) {
		return {
			stdout: error.stdout,
			stderr: error.stderr,
			code: error.code,
			calls: JSON.parse(await readFile(logPath, "utf8")),
		};
	}
}

test("CLI rejects an unreadable asset without remote mutation", { skip: process.platform === "win32" }, async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "unreadable.vsix");
	await writeFile(assetPath, "fixture", { mode: 0o000 });
	const childIdentity = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
	const result = await runCli(fixture, assetPath, childIdentity);

	assert.equal(result.code, 1);
	assert.match(result.stderr, /^\[create-release\] error: .+\n$/);
	assert.match(result.stderr, /cannot be read|EACCES/);
	assert.doesNotMatch(result.stderr, /\n\s+at /);
	assert.deepEqual(result.calls, []);
});

test("CLI prints controlled output for a missing asset and never contacts GitHub", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "missing-cli.vsix");
	const result = await runCli(fixture, assetPath);

	assert.equal(result.code, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /^\[create-release\] error: .+\n$/);
	assert.match(result.stderr, /missing-cli\.vsix/);
	assert.doesNotMatch(result.stderr, /\n\s+at /);
	assert.deepEqual(result.calls, []);
});

test("CLI uploads a valid asset through synthetic GitHub endpoints", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "fixture.vsix");
	await writeFile(assetPath, "fixture");
	const result = await runCli(fixture, assetPath);

	assert.equal(result.code, 0);
	assert.match(result.stdout, /^\[create-release\] release created: https:\/\/github\.test\//m);
	assert.match(result.stdout, /^\[create-release\] asset: https:\/\/downloads\.github\.test\/fixture\.vsix \(7 bytes\)$/m);
	assert.equal(result.stderr, "");
	assert.deepEqual(result.calls.map(({ method }) => method), ["GET", "POST", "GET", "POST", "POST"]);
});

test("CLI preserves controlled error output for a synthetic upload failure", async (t) => {
	const fixture = await makeFixture(t);
	const assetPath = join(fixture.root, "upload-failure.vsix");
	await writeFile(assetPath, "fixture");
	const result = await runCli(fixture, assetPath, { uploadStatus: 500 });

	assert.equal(result.code, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /^\[create-release\] error: asset upload failed: 500$/m);
	assert.match(result.stderr, /synthetic upload failure/);
	assert.doesNotMatch(result.stderr, /synthetic-token|\n\s+at /);
	assert.equal(releasePosts(result.calls).length, 1);
	assert.equal(result.calls.at(-1).href.startsWith("https://uploads.github.test/"), true);
});
