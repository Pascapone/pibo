import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the canonical test runner cannot read from or write to the invoking Pibo home", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-test-runner-regression-"));
	const callerHome = join(root, "operator-home");
	const callerPiboHome = join(callerHome, ".pibo");
	const callerTemp = join(root, "operator-temp");
	const sentinelPath = join(callerPiboHome, "operator-sentinel.txt");
	const probePath = join(root, "probe.json");
	mkdirSync(callerPiboHome, { recursive: true });
	mkdirSync(callerTemp, { recursive: true });
	writeFileSync(sentinelPath, "operator-state-must-not-change\n", "utf8");

	try {
		const result = spawnSync(process.execPath, [
			"scripts/run-test-suite.mjs",
			"test/fixtures/test-suite-home-probe.test.mjs",
		], {
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				HOME: callerHome,
				USERPROFILE: callerHome,
				PIBO_HOME: callerPiboHome,
				TEMP: callerTemp,
				TMP: callerTemp,
				PIBO_TEST_PROBE_PATH: probePath,
			},
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.equal(readFileSync(sentinelPath, "utf8"), "operator-state-must-not-change\n");
		assert.equal(existsSync(join(callerPiboHome, "worker-write.txt")), false);
		assert.equal(existsSync(probePath), true, result.stderr || result.stdout);

		const probe = JSON.parse(readFileSync(probePath, "utf8"));
		assert.notEqual(resolve(probe.home), resolve(callerHome));
		assert.notEqual(resolve(probe.userProfile), resolve(callerHome));
		assert.equal(resolve(probe.homedir), resolve(probe.userProfile));
		if (process.platform === "win32") assert.notEqual(resolve(probe.tmpdir), resolve(callerTemp));
		assert.notEqual(resolve(probe.piboHome), resolve(callerPiboHome));
		assert.equal(probe.nodeEnv, "test");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
