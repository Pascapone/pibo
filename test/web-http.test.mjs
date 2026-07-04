import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createServer, request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import {
	MAX_WEB_REQUEST_BODY_BYTES,
	nodeRequestToWebRequest,
	PiboWebHttpError,
	readJsonBody,
	responseJson,
	sendWebResponse,
} from "../dist/web/http.js";

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

test("sendWebResponse skips sync gzip for over-budget JSON responses", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(700 * 1024) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], undefined);
		assert.equal(response.headers["x-pibo-compression-skipped"], "sync-gzip-size-limit");
		assert.deepEqual(JSON.parse(body.toString("utf8")), { payload: "x".repeat(700 * 1024) });
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

test("sendWebResponse does not brotli-compress dynamic JSON responses", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(2048) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "br" });
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

test("sendWebResponse does not compress 204 responses", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, new Response(null, {
			status: 204,
			headers: { "content-type": "application/json; charset=utf-8" },
		}));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 204);
		assert.equal(response.headers["content-encoding"], undefined);
		assert.equal(body.length, 0);
	});
});

test("sendWebResponse preserves existing content-encoding", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson(
			{ payload: "x".repeat(2048) },
			{ headers: { "content-encoding": "identity" } },
		));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], "identity");
		assert.deepEqual(JSON.parse(body.toString("utf8")), { payload: "x".repeat(2048) });
	});
});

test("sendWebResponse appends accept-encoding to Vary only once", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson(
			{ payload: "x".repeat(2048) },
			{ headers: { vary: "Origin, Accept-Encoding" } },
		));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], "gzip");
		assert.equal(response.headers.vary, "Origin, Accept-Encoding");
		assert.deepEqual(JSON.parse(gunzipSync(body).toString("utf8")), { payload: "x".repeat(2048) });
	});
});

test("sendWebResponse honors wildcard encodings and rejects invalid q values", async () => {
	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(2048) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "*;q=1" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], "gzip");
		assert.deepEqual(JSON.parse(gunzipSync(body).toString("utf8")), { payload: "x".repeat(2048) });
	});

	await withServer((request, response) => {
		void sendWebResponse(response, responseJson({ payload: "x".repeat(2048) }));
	}, async (baseURL) => {
		const { response, body } = await rawGet(baseURL, { "accept-encoding": "gzip;q=abc" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.headers["content-encoding"], undefined);
		assert.deepEqual(JSON.parse(body.toString("utf8")), { payload: "x".repeat(2048) });
	});
});


test("readJsonBody returns valid JSON objects", async () => {
	const body = await readJsonBody(new Request("http://example.test", {
		method: "POST",
		body: JSON.stringify({ ok: true }),
	}));

	assert.deepEqual(body, { ok: true });
});

test("readJsonBody rejects empty, invalid, and primitive JSON bodies", async () => {
	for (const body of ["", "not-json", "null", "true", "42", '"value"']) {
		await assert.rejects(
			() => readJsonBody(new Request("http://example.test", { method: "POST", body })),
			(error) => error instanceof PiboWebHttpError && error.statusCode === 400,
		);
	}
});

test("nodeRequestToWebRequest preserves GET method, URL, and repeated headers without a body", async () => {
	const incoming = Readable.from([]);
	Object.assign(incoming, {
		method: "GET",
		url: "/api/items?limit=1",
		headers: {
			"x-single": "value",
			"x-repeat": ["one", "two"],
		},
	});

	const request = await nodeRequestToWebRequest(incoming, "http://example.test/base");

	assert.equal(request.method, "GET");
	assert.equal(request.url, "http://example.test/api/items?limit=1");
	assert.equal(request.headers.get("x-single"), "value");
	assert.equal(request.headers.get("x-repeat"), "one, two");
	assert.equal(await request.text(), "");
});

test("nodeRequestToWebRequest preserves POST JSON bodies", async () => {
	const incoming = Readable.from([Buffer.from('{"ok":true}')]);
	Object.assign(incoming, {
		method: "POST",
		url: "/submit",
		headers: { "content-type": "application/json" },
	});

	const request = await nodeRequestToWebRequest(incoming, "http://example.test");

	assert.equal(request.method, "POST");
	assert.equal(request.url, "http://example.test/submit");
	assert.equal(request.headers.get("content-type"), "application/json");
	assert.equal(await request.text(), '{"ok":true}');
});

test("nodeRequestToWebRequest rejects oversized request bodies", async () => {
	const incoming = Readable.from([Buffer.alloc(MAX_WEB_REQUEST_BODY_BYTES + 1)]);
	Object.assign(incoming, {
		method: "POST",
		url: "/too-large",
		headers: {},
	});

	await assert.rejects(
		() => nodeRequestToWebRequest(incoming, "http://example.test"),
		(error) => error instanceof PiboWebHttpError && error.statusCode === 413,
	);
});
