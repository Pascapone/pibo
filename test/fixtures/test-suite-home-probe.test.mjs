import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

test("normal test workers receive only the isolated suite home", () => {
	assert.ok(process.env.HOME);
	assert.ok(process.env.PIBO_HOME);
	assert.ok(process.env.PIBO_TEST_PROBE_PATH);
	mkdirSync(process.env.PIBO_HOME, { recursive: true });
	writeFileSync(join(process.env.PIBO_HOME, "worker-write.txt"), "isolated\n", "utf8");
	mkdirSync(dirname(process.env.PIBO_TEST_PROBE_PATH), { recursive: true });
	writeFileSync(process.env.PIBO_TEST_PROBE_PATH, JSON.stringify({
		home: process.env.HOME,
		userProfile: process.env.USERPROFILE,
		homedir: homedir(),
		piboHome: process.env.PIBO_HOME,
		nodeEnv: process.env.NODE_ENV,
	}), "utf8");
});
