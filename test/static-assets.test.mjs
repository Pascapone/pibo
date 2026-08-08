import assert from "node:assert/strict";
import test from "node:test";
import {
	brotliCompressSync,
	brotliDecompressSync,
	constants as zlibConstants,
	gunzipSync,
	gzipSync,
} from "node:zlib";
import {
	CHAT_VSCODE_MOUNT_PATH,
	CHAT_WEB_MOUNT_PATH,
	STATIC_ASSET_BROTLI_QUALITY,
	responseBuiltChatAsset,
	responseBuiltChatIndex,
	responseBuiltVscodeAsset,
	responseVscodeAppShell,
} from "../dist/apps/chat/static-assets.js";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

async function builtMainAssetPath(shellResponse, mountPath) {
	const html = await shellResponse.text();
	const escapedMountPath = mountPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const assetPath = html.match(new RegExp(`${escapedMountPath}/assets/[^"]+\\.js`))?.[0];
	assert.ok(assetPath, `missing built JavaScript asset in ${mountPath} shell`);
	return assetPath;
}

function assetRequest(pathname, acceptEncoding) {
	return new Request(`http://pibo.test${pathname}`, {
		headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : undefined,
	});
}

async function responseBytes(response) {
	assert.ok(response);
	return Buffer.from(await response.arrayBuffer());
}

async function assertBuiltAssetCompression({ pathname, respond }) {
	const identityResponse = respond(assetRequest(pathname, "identity"), pathname);
	assert.ok(identityResponse);
	assert.match(identityResponse.headers.get("content-type") ?? "", /^text\/javascript/);
	assert.equal(identityResponse.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
	assert.equal(identityResponse.headers.get("content-encoding"), null);
	assert.equal(identityResponse.headers.get("vary"), null);
	const identity = await responseBytes(identityResponse);

	const brotliResponse = respond(assetRequest(pathname, "gzip, br"), pathname);
	assert.ok(brotliResponse);
	assert.equal(brotliResponse.headers.get("content-encoding"), "br");
	assert.equal(brotliResponse.headers.get("vary"), "accept-encoding");
	assert.equal(brotliResponse.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
	const brotli = await responseBytes(brotliResponse);
	const expectedBrotli = brotliCompressSync(identity, {
		params: { [zlibConstants.BROTLI_PARAM_QUALITY]: STATIC_ASSET_BROTLI_QUALITY },
	});
	assert.deepEqual(brotli, expectedBrotli);
	assert.deepEqual(brotliDecompressSync(brotli), identity);

	const gzipResponse = respond(assetRequest(pathname, "gzip"), pathname);
	assert.ok(gzipResponse);
	assert.equal(gzipResponse.headers.get("content-encoding"), "gzip");
	assert.equal(gzipResponse.headers.get("vary"), "accept-encoding");
	assert.equal(gzipResponse.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
	const gzip = await responseBytes(gzipResponse);
	assert.deepEqual(gzip, gzipSync(identity));
	assert.deepEqual(gunzipSync(gzip), identity);

	const repeatedBrotli = await responseBytes(respond(assetRequest(pathname, "br"), pathname));
	const repeatedGzip = await responseBytes(respond(assetRequest(pathname, "gzip"), pathname));
	assert.deepEqual(repeatedBrotli, brotli);
	assert.deepEqual(repeatedGzip, gzip);
}

test("built Chat and VS Code assets use explicit deterministic compression with stable caching", async () => {
	assert.equal(STATIC_ASSET_BROTLI_QUALITY, 5);

	const chatIndex = responseBuiltChatIndex();
	assert.ok(chatIndex);
	await assertBuiltAssetCompression({
		pathname: await builtMainAssetPath(chatIndex, CHAT_WEB_MOUNT_PATH),
		respond: responseBuiltChatAsset,
	});

	await assertBuiltAssetCompression({
		pathname: await builtMainAssetPath(responseVscodeAppShell(), CHAT_VSCODE_MOUNT_PATH),
		respond: responseBuiltVscodeAsset,
	});
});
