import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { assertPrivateWindowsAcl, grantBuiltinUsersModify } from "./fixtures/windows-acl.mjs";

test("pibo config stores and reads supported keys", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-config-"));
	const path = join(dir, "config.json");

	try {
		let config = loadPiboConfig(path);
		config = setPiboConfigValue(config, "auth.baseURL", "http://localhost:4788");
		config = setPiboConfigValue(config, "auth.allowedEmails", "you@example.com,friend@example.com");
		config = setPiboConfigValue(config, "auth.trustedOrigins", "http://4788.192.168.0.204.sslip.io");
		config = setPiboConfigValue(config, "auth.databasePath", "/tmp/pibo-auth.sqlite");
		savePiboConfig(config, path);

		const loaded = loadPiboConfig(path);
		assert.equal(getPiboConfigValue(loaded, "auth.baseURL"), "http://localhost:4788");
		assert.deepEqual(getPiboConfigValue(loaded, "auth.allowedEmails"), ["you@example.com", "friend@example.com"]);
		assert.deepEqual(getPiboConfigValue(loaded, "auth.trustedOrigins"), [
			"http://4788.192.168.0.204.sslip.io",
		]);
		assert.equal(getPiboConfigValue(loaded, "auth.databasePath"), "/tmp/pibo-auth.sqlite");

		const withoutBaseURL = deletePiboConfigValue(loaded, "auth.baseURL");
		assert.equal(getPiboConfigValue(withoutBaseURL, "auth.baseURL"), undefined);
		const withoutDatabasePath = deletePiboConfigValue(loaded, "auth.databasePath");
		assert.equal(getPiboConfigValue(withoutDatabasePath, "auth.databasePath"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo config files remain private when rewritten", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-config-mode-"));
	const path = join(dir, "config.json");

	try {
		savePiboConfig({ auth: { secret: "a".repeat(32) } }, path);
		if (process.platform === "win32") {
			assertPrivateWindowsAcl(path, "file");
			grantBuiltinUsersModify(path);
		} else {
			assert.equal(statSync(path).mode & 0o777, 0o600);
			chmodSync(path, 0o644);
		}
		savePiboConfig({ auth: { secret: "b".repeat(32) } }, path);
		if (process.platform === "win32") assertPrivateWindowsAcl(path, "file");
		else assert.equal(statSync(path).mode & 0o777, 0o600);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo config accepts a leading UTF-8 BOM from Windows PowerShell 5.1", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-config-bom-"));
	const path = join(dir, "config.json");
	try {
		writeFileSync(path, Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from(`${JSON.stringify({ auth: { baseURL: "http://localhost:4788" } })}\r\n`, "utf8"),
		]));
		assert.equal(loadPiboConfig(path).auth?.baseURL, "http://localhost:4788");
		if (process.platform === "win32") assertPrivateWindowsAcl(path, "file");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pibo config validates supported keys and auth secret length", () => {
	assert.throws(() => setPiboConfigValue({}, "unknown.key", "value"), /Unknown config key/);
	assert.throws(() => setPiboConfigValue({}, "auth.secret", "too-short"), /auth.secret must be at least 32 characters/);
});

test("pibo config parses JSON string arrays and rejects invalid array values", () => {
	let config = setPiboConfigValue({}, "auth.allowedEmails", '["you@example.com", " friend@example.com "]');
	config = setPiboConfigValue(config, "auth.trustedOrigins", '["http://localhost:4788", ""]');

	assert.deepEqual(getPiboConfigValue(config, "auth.allowedEmails"), ["you@example.com", "friend@example.com"]);
	assert.deepEqual(getPiboConfigValue(config, "auth.trustedOrigins"), ["http://localhost:4788"]);
	assert.throws(
		() => setPiboConfigValue({}, "auth.allowedEmails", '["you@example.com", 123]'),
		/Expected a JSON string array/,
	);
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
