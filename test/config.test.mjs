import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
	deletePiboConfigValue,
	getDisplayPiboConfigValue,
	getPiboConfigValue,
	loadPiboConfig,
	redactPiboConfig,
	savePiboConfig,
	setPiboConfigValue,
} from "../dist/config/config.js";

test("pibo config stores and reads supported keys", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-config-"));
	const path = join(dir, "config.json");

	try {
		let config = loadPiboConfig(path);
		config = setPiboConfigValue(config, "auth.baseURL", "http://localhost:4788");
		config = setPiboConfigValue(config, "auth.allowedEmails", "you@example.com,friend@example.com");
		config = setPiboConfigValue(config, "auth.trustedOrigins", "http://4788.192.168.0.204.sslip.io");
		savePiboConfig(config, path);

		const loaded = loadPiboConfig(path);
		assert.equal(getPiboConfigValue(loaded, "auth.baseURL"), "http://localhost:4788");
		assert.deepEqual(getPiboConfigValue(loaded, "auth.allowedEmails"), ["you@example.com", "friend@example.com"]);
		assert.deepEqual(getPiboConfigValue(loaded, "auth.trustedOrigins"), [
			"http://4788.192.168.0.204.sslip.io",
		]);

		const deleted = deletePiboConfigValue(loaded, "auth.baseURL");
		assert.equal(getPiboConfigValue(deleted, "auth.baseURL"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo config validates supported keys and auth secret length", () => {
	assert.throws(() => setPiboConfigValue({}, "unknown.key", "value"), /Unknown config key/);
	assert.throws(() => setPiboConfigValue({}, "auth.secret", "too-short"), /auth.secret must be at least 32 characters/);
});

test("pibo config display masks secret keys", () => {
	const config = setPiboConfigValue({}, "auth.secret", "a".repeat(32));
	const withClientSecret = setPiboConfigValue(config, "auth.googleClientSecret", "google-client-secret-value");

	assert.equal(getPiboConfigValue(withClientSecret, "auth.secret"), "a".repeat(32));
	assert.equal(getDisplayPiboConfigValue(withClientSecret, "auth.secret"), "aaaa...aaaa");
	assert.deepEqual(redactPiboConfig(withClientSecret), {
		auth: {
			secret: "aaaa...aaaa",
			googleClientSecret: "goog...alue",
		},
	});
});
