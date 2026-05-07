import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import { responseJson, sendWebResponse } from "../dist/web/http.js";

async function withServer(handler, run) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	try {
		return await run(`http://${address.address}:${address.port}`);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
}

function rawGet(url, headers = {}) {
	return new Promise((resolve, reject) => {
		const clientRequest = httpRequest(new URL(url), { headers }, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
			response.on("end", () => resolve({ response, body: Buffer.concat(chunks) }));
		});
		clientRequest.on("error", reject);
		clientRequest.end();
	});
}

test("sendWebResponse compresses large JSON responses with gzip", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(2048) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], "gzip");
		assert.match(response.headers.vary ?? "", /accept-encoding/i);
		assert.deepEqual(JSON.parse(gunzipSync(body).toString("utf8")), { payload: "x".repeat(2048) });
	});
});

test("sendWebResponse does not use encodings with q=0", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(2048) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip;q=0" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], undefined);
		assert.deepEqual(JSON.parse(body.toString("utf8")), { payload: "x".repeat(2048) });
	});
});

test("sendWebResponse leaves small JSON responses uncompressed", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ ok: true }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], undefined);
		assert.deepEqual(JSON.parse(body.toString("utf8")), { ok: true });
	});
});
