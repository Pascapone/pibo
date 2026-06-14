import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PIBO_CONFIG_KEYS,
	getDisplayPiboConfigValue,
	getPiboConfigValue,
	loadPiboConfig,
	savePiboConfig,
	setPiboConfigValue,
} from "../dist/config/config.js";

function withTempConfigPath() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-auth-mode-"));
	const path = join(dir, "config.json");
	return {
		path,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("auth.mode appears in the supported keys list", () => {
	const definition = PIBO_CONFIG_KEYS.find((candidate) => candidate.key === "auth.mode");
	assert.ok(definition, "auth.mode is registered as a supported key");
	assert.equal(definition.type, "string");
	assert.equal(definition.secret, undefined);
	assert.deepEqual(definition.values, ["better-auth", "local"]);
});

test("setPiboConfigValue persists auth.mode=local", () => {
	const { path, cleanup } = withTempConfigPath();
	try {
		const config = setPiboConfigValue({}, "auth.mode", "local");
		savePiboConfig(config, path);

		const loaded = loadPiboConfig(path);
		assert.equal(getPiboConfigValue(loaded, "auth.mode"), "local");
		assert.equal(getDisplayPiboConfigValue(loaded, "auth.mode"), "local");
	} finally {
		cleanup();
	}
});

test("setPiboConfigValue rejects invalid auth.mode values", () => {
	assert.throws(() => setPiboConfigValue({}, "auth.mode", "bogus"), /auth\.mode must be one of/);
});

test("auth.mode round-trips through a file written by hand", () => {
	const { path, cleanup } = withTempConfigPath();
	try {
		writeFileSync(path, JSON.stringify({ auth: { mode: "local" } }, null, 2));
		const loaded = loadPiboConfig(path);
		assert.equal(getPiboConfigValue(loaded, "auth.mode"), "local");
	} finally {
		cleanup();
	}
});

test("auth.mode=local does not block other auth keys", () => {
	const { path, cleanup } = withTempConfigPath();
	try {
		let config = setPiboConfigValue({}, "auth.mode", "local");
		config = setPiboConfigValue(config, "auth.allowedEmails", "you@example.com");
		savePiboConfig(config, path);

		const loaded = loadPiboConfig(path);
		assert.equal(getPiboConfigValue(loaded, "auth.mode"), "local");
		assert.deepEqual(getPiboConfigValue(loaded, "auth.allowedEmails"), ["you@example.com"]);
	} finally {
		cleanup();
	}
});
