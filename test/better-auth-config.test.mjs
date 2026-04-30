import assert from "node:assert/strict";
import test from "node:test";
import { createBetterAuthService, createTrustedOrigins } from "../dist/auth/better-auth.js";

const validOptions = {
	baseURL: "http://localhost:4788",
	secret: "x".repeat(32),
	googleClientId: "google-client-id",
	googleClientSecret: "google-client-secret",
	allowedEmails: ["you@example.com"],
};

test("better auth requires an allowed email allowlist", () => {
	assert.throws(
		() =>
			createBetterAuthService({
				...validOptions,
				allowedEmails: [],
			}),
			/auth.allowedEmails must contain at least one email/,
	);
});

test("better auth requires a strong secret", () => {
	assert.throws(
		() =>
			createBetterAuthService({
				...validOptions,
				secret: "too-short",
			}),
		/auth.secret must be at least 32 characters/,
	);
});

test("better auth trusts loopback aliases for the configured base URL", () => {
	assert.deepEqual(createTrustedOrigins("http://localhost:4788").sort(), [
		"http://127.0.0.1:4788",
		"http://[::1]:4788",
		"http://localhost:4788",
	]);
	assert.deepEqual(createTrustedOrigins("http://127.0.0.1:4788").sort(), [
		"http://127.0.0.1:4788",
		"http://[::1]:4788",
		"http://localhost:4788",
	]);
});

test("better auth keeps configured trusted origins", () => {
	assert.deepEqual(createTrustedOrigins("http://localhost:4788", ["http://4788.192.168.0.204.sslip.io"]).sort(), [
		"http://127.0.0.1:4788",
		"http://4788.192.168.0.204.sslip.io",
		"http://[::1]:4788",
		"http://localhost:4788",
	]);
});
