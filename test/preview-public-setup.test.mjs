import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewProductionSetupPlan, inspectPreviewPublicRoute } from "../dist/previews/public-setup.js";

test("preview production plan preserves custom HTTPS ports and emits IPv6 DNS records", () => {
	const plan = createPreviewProductionSetupPlan({
		baseURL: "https://preview.example.test:8443",
		gatewayPort: 5510,
		publicIp: "2001:db8::10",
	});
	assert.equal(plan.wildcardHostname, "*.preview.example.test");
	assert.deepEqual(plan.dnsRecord, {
		type: "AAAA",
		name: "*.preview.example.test",
		value: "2001:db8::10",
	});
	assert.match(plan.caddy.siteBlock, /^\*\.preview\.example\.test:8443 \{/);
	assert.match(plan.caddy.globalOptions, /127\.0\.0\.1:5510\/api\/previews\/tls-authorize/);
	assert.match(plan.commands.configure, /https:\/\/preview\.example\.test:8443/);
});

test("public Preview inspection accepts only the anonymous Preview gateway response", async () => {
	const success = await inspectPreviewPublicRoute("https://preview.example.test", "pv-ready", {
		resolveHostname: async () => ["192.0.2.10"],
		request: async () => ({ status: 401 }),
	});
	assert.equal(success.dns.status, "ok");
	assert.equal(success.tlsAndRouting.status, "ok");
	assert.equal(success.tlsAndRouting.httpStatus, 401);

	const redirect = await inspectPreviewPublicRoute("https://preview.example.test", "pv-ready", {
		resolveHostname: async () => ["192.0.2.10"],
		request: async () => ({ status: 302, location: "https://pibo.example.test/" }),
	});
	assert.equal(redirect.tlsAndRouting.status, "fail");
	assert.equal(redirect.tlsAndRouting.httpStatus, 302);
	assert.equal(redirect.tlsAndRouting.location, "https://pibo.example.test/");
});

test("public Preview inspection reports DNS and TLS failures without hiding their stage", async () => {
	const checks = await inspectPreviewPublicRoute("https://preview.example.test", "pv-failed", {
		resolveHostname: async () => { throw new Error("ENOTFOUND"); },
		request: async () => { throw new Error("certificate verify failed"); },
	});
	assert.equal(checks.dns.status, "fail");
	assert.match(checks.dns.detail, /DNS lookup failed: ENOTFOUND/);
	assert.equal(checks.tlsAndRouting.status, "fail");
	assert.match(checks.tlsAndRouting.detail, /HTTPS request failed: certificate verify failed/);
});
