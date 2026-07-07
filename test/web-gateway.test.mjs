import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveFallbackWebGatewayServerOptions } from "../dist/gateway/fallback.js";
import { isLoopbackHost, resolveWebGatewayAuthMode, resolveWebGatewayServerOptions } from "../dist/gateway/web.js";

test("web gateway binds publicly when auth base URL is not loopback", () => {
	const options = resolveWebGatewayServerOptions({
		auth: { baseURL: "http://192.168.1.10:4788" },
	});

	assert.equal(options.web.host, "0.0.0.0");
});

test("web gateway keeps loopback bind for local auth base URL", () => {
	const options = resolveWebGatewayServerOptions({
		auth: { baseURL: "http://localhost:4788" },
	});

	assert.equal(options.web.host, "127.0.0.1");
});

test("web gateway respects explicit web host", () => {
	const options = resolveWebGatewayServerOptions({
		auth: { baseURL: "http://192.168.1.10:4788" },
		web: { host: "192.168.1.10" },
	});

	assert.equal(options.web.host, "192.168.1.10");
});

test("web gateway rebases loopback auth base URL when explicit web port is supplied", () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const piboHome = mkdtempSync(join(tmpdir(), "pibo-web-gateway-config-"));
	try {
		process.env.PIBO_HOME = piboHome;
		writeFileSync(join(piboHome, "config.json"), JSON.stringify({ auth: { baseURL: "http://127.0.0.1:4788" } }));

		const options = resolveWebGatewayServerOptions({ web: { port: 3000 } });

		assert.equal(options.auth.baseURL, "http://127.0.0.1:3000");
		assert.equal(options.web.port, 3000);
	} finally {
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(piboHome, { recursive: true, force: true });
	}
});

test("web gateway keeps public auth base URL when explicit bind port is supplied", () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const piboHome = mkdtempSync(join(tmpdir(), "pibo-web-gateway-config-"));
	try {
		process.env.PIBO_HOME = piboHome;
		writeFileSync(join(piboHome, "config.json"), JSON.stringify({ auth: { baseURL: "https://pibo.example.com" } }));

		const options = resolveWebGatewayServerOptions({ web: { host: "127.0.0.1", port: 3000 } });

		assert.equal(options.auth.baseURL, "https://pibo.example.com");
		assert.equal(options.web.host, "127.0.0.1");
		assert.equal(options.web.port, 3000);
	} finally {
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(piboHome, { recursive: true, force: true });
	}
});

test("fallback gateway uses dedicated public ports", () => {
	const options = resolveFallbackWebGatewayServerOptions();

	assert.equal(options.host, "0.0.0.0");
	assert.equal(options.port, 4790);
	assert.deepEqual(options.web, { host: "0.0.0.0", port: 4791 });
});

test("gateway web fails closed when legacy dev auth env is set", () => {
	const previous = process.env.PIBO_DEV_AUTH;
	process.env.PIBO_DEV_AUTH = "1";
	try {
		assert.throws(
			() => resolveWebGatewayAuthMode({}),
			/PIBO_DEV_AUTH is deprecated.*--auth=local/s,
		);
	} finally {
		if (previous === undefined) delete process.env.PIBO_DEV_AUTH;
		else process.env.PIBO_DEV_AUTH = previous;
	}
});

test("gateway web does not enable dev auth by default", () => {
	assert.equal(resolveWebGatewayAuthMode({}), "better-auth");
});

test("gateway web selects dev auth when authMode=local and bind is loopback", () => {
	assert.equal(
		resolveWebGatewayAuthMode({ authMode: "local", web: { host: "127.0.0.1" } }),
		"dev-auth",
	);
});

test("gateway web rejects authMode=local on a non-loopback host bind", () => {
	assert.throws(
		() => resolveWebGatewayAuthMode({ authMode: "local", web: { host: "0.0.0.0" } }),
		/Local auth requires a loopback bind/,
	);
});

test("gateway web accepts authMode=local on the default loopback bind", () => {
	assert.equal(resolveWebGatewayAuthMode({ authMode: "local" }), "dev-auth");
});

test("gateway web accepts the legacy devAuth alias with loopback bind", () => {
	assert.equal(
		resolveWebGatewayAuthMode({ devAuth: true, web: { host: "127.0.0.1" } }),
		"dev-auth",
	);
});

test("gateway web rejects the legacy devAuth alias on a non-loopback bind", () => {
	assert.throws(
		() => resolveWebGatewayAuthMode({ devAuth: true, web: { host: "0.0.0.0" } }),
		/Local auth requires a loopback bind/,
	);
});

test("isLoopbackHost detects 127.0.0.1, ::1, and localhost", () => {
	assert.equal(isLoopbackHost("127.0.0.1"), true);
	assert.equal(isLoopbackHost("::1"), true);
	assert.equal(isLoopbackHost("localhost"), true);
	assert.equal(isLoopbackHost("0.0.0.0"), false);
	assert.equal(isLoopbackHost("192.168.1.10"), false);
	assert.equal(isLoopbackHost(undefined), false);
});
