import assert from "node:assert/strict";
import test from "node:test";
import {
	cookieValue,
	PREVIEW_INSECURE_SESSION_COOKIE,
	PREVIEW_SESSION_COOKIE,
	PreviewProxyLimiter,
	previewSessionCookieName,
} from "../dist/previews/proxy.js";

test("preview cookie parsing fails closed and production uses a host-prefixed cookie", () => {
	assert.equal(previewSessionCookieName("https:"), PREVIEW_SESSION_COOKIE);
	assert.match(PREVIEW_SESSION_COOKIE, /^__Host-/);
	assert.equal(previewSessionCookieName("http:"), PREVIEW_INSECURE_SESSION_COOKIE);
	assert.equal(cookieValue("pibo_preview_session=%ZZ", PREVIEW_INSECURE_SESSION_COOKIE), undefined);
	assert.equal(cookieValue("other=ok; pibo_preview_session=token", PREVIEW_INSECURE_SESSION_COOKIE), "token");
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
