import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
	cookieValue,
	PREVIEW_INSECURE_SESSION_COOKIE,
	PREVIEW_SESSION_COOKIE,
	PreviewProxyLimiter,
	previewSessionCookieName,
	proxyPreviewHttp,
	sanitizePreviewRedirectLocation,
	sanitizePreviewSetCookie,
} from "../dist/previews/proxy.js";

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve(server.address().port);
		});
	});
}

function close(server) {
	return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("preview cookie parsing fails closed and production uses a host-prefixed cookie", () => {
	assert.equal(previewSessionCookieName("https:"), PREVIEW_SESSION_COOKIE);
	assert.match(PREVIEW_SESSION_COOKIE, /^__Host-/);
	assert.equal(previewSessionCookieName("http:"), PREVIEW_INSECURE_SESSION_COOKIE);
	assert.equal(cookieValue("pibo_preview_session=%ZZ", PREVIEW_INSECURE_SESSION_COOKIE), undefined);
	assert.equal(cookieValue("other=ok; pibo_preview_session=token", PREVIEW_INSECURE_SESSION_COOKIE), "token");
});

test("compute-worker dev-auth mode preserves credential stripping but omits public forwarding metadata", async (t) => {
	const observed = [];
	const upstream = createServer((request, response) => {
		observed.push(request.headers);
		response.end("ok");
	});
	const targetPort = await listen(upstream);
	t.after(() => close(upstream));

	async function proxy(proxyMode) {
		const request = Readable.from([]);
		request.headers = {
			authorization: "Bearer should-not-escape",
			cookie: "app_session=ok; pibo_dev_session=should-not-escape",
			origin: "https://pv-worker.preview.example",
			"x-forwarded-host": "attacker.example",
		};
		request.method = "GET";
		const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
		response.headersSent = false;
		response.writeHead = () => {
			response.headersSent = true;
			return response;
		};
		await proxyPreviewHttp({
			request,
			response,
			requestURL: new URL("https://pv-worker.preview.example/api/auth/session"),
			exposure: { targetHost: "127.0.0.1", targetPort, proxyMode },
		});
	}

	await proxy("standard");
	await proxy("pibo-compute-dev-auth");
	assert.equal(observed.length, 2);
	assert.equal(observed[0]["x-forwarded-host"], "pv-worker.preview.example");
	assert.equal(observed[0]["x-forwarded-proto"], "https");
	assert.equal(observed[1]["x-forwarded-host"], undefined);
	assert.equal(observed[1]["x-forwarded-proto"], undefined);
	for (const headers of observed) {
		assert.equal(headers.host, `127.0.0.1:${targetPort}`);
		assert.equal(headers.origin, `http://127.0.0.1:${targetPort}/`);
		assert.equal(headers.authorization, undefined);
		assert.equal(headers.cookie, "app_session=ok");
	}
});

test("preview proxy connection admission is bounded per preview and globally", () => {
	const limiter = new PreviewProxyLimiter(3, 2);
	const releaseA1 = limiter.tryAcquire("pv-a");
	const releaseA2 = limiter.tryAcquire("pv-a");
	assert.ok(releaseA1);
	assert.ok(releaseA2);
	assert.equal(limiter.tryAcquire("pv-a"), undefined);
	const releaseB = limiter.tryAcquire("pv-b");
	assert.ok(releaseB);
	assert.equal(limiter.tryAcquire("pv-c"), undefined);
	assert.deepEqual(limiter.snapshot(), { total: 3, previews: 2 });

	releaseA1();
	releaseA1();
	const releaseC = limiter.tryAcquire("pv-c");
	assert.ok(releaseC);
	releaseA2();
	releaseB();
	releaseC();
	assert.deepEqual(limiter.snapshot(), { total: 0, previews: 0 });
});

test("preview proxy connection limits reject invalid configuration", () => {
	assert.throws(() => new PreviewProxyLimiter(0, 1), /total connection limit/);
	assert.throws(() => new PreviewProxyLimiter(2, 3), /per-preview connection limit/);
});

test("HTTP proxy admission remains held until the downstream response finishes", async (t) => {
	const upstreamCompleted = Promise.withResolvers();
	const upstream = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "application/octet-stream" });
		response.end(Buffer.alloc(512 * 1024, 1), () => upstreamCompleted.resolve());
	});
	const targetPort = await listen(upstream);
	t.after(() => close(upstream));

	let blockedWrite;
	let writesReleased = false;
	const downstream = new Writable({
		highWaterMark: 1024 * 1024,
		write(_chunk, _encoding, callback) {
			if (writesReleased) callback();
			else blockedWrite = callback;
		},
	});
	downstream.headersSent = false;
	downstream.writeHead = () => {
		downstream.headersSent = true;
		return downstream;
	};
	const request = Readable.from([]);
	request.headers = {};
	request.method = "GET";
	const proxied = proxyPreviewHttp({
		request,
		response: downstream,
		requestURL: new URL("http://pv-slow.preview.localhost/large"),
		exposure: { targetHost: "127.0.0.1", targetPort },
	});

	await upstreamCompleted.promise;
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.ok(blockedWrite, "fixture must retain an unfinished downstream write");
	assert.equal(await Promise.race([
		proxied.then(() => "released"),
		new Promise((resolve) => setTimeout(() => resolve("held"), 25)),
	]), "held");

	writesReleased = true;
	blockedWrite();
	await proxied;
});

test("preview redirect and cookie sanitizers reject response splitting and alternate loopback targets", () => {
	const exposure = { targetHost: "127.0.0.1", targetPort: 5173 };
	const previewOrigin = "https://pv-safe.preview.example";
	assert.equal(
		sanitizePreviewRedirectLocation("http://127.0.0.1:5173/next", exposure, previewOrigin),
		"https://pv-safe.preview.example/next",
	);
	for (const location of [
		"http://127.0.0.1:9/private",
		"http://localhost/private",
		"http://[::1]/private",
		"https://example.test/\r\nx-injected: yes",
	]) {
		assert.equal(sanitizePreviewRedirectLocation(location, exposure, previewOrigin), undefined);
	}
	assert.equal(sanitizePreviewSetCookie("app_session=ok; Domain=127.0.0.1; Path=/"), "app_session=ok; Path=/");
	assert.equal(sanitizePreviewSetCookie("pibo_machine_session=secret; Path=/"), undefined);
	assert.equal(sanitizePreviewSetCookie("app_session=ok\r\nX-Injected: yes; Path=/"), undefined);
});
