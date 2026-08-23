import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	loadPiboGatewaySettings,
	resolvePiboGatewaySettings,
	sanitizeConcurrentYieldedRuns,
	updatePiboGatewaySettings,
} from "../dist/core/gateway-settings.js";

test("gateway settings resolve requested defaults and environment overrides", () => {
	assert.deepEqual(resolvePiboGatewaySettings({}), {
		maxConcurrentYieldedRuns: 50,
		sessionConcurrentYieldedRuns: 10,
	});
	assert.deepEqual(resolvePiboGatewaySettings({
		PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS: "75",
		PIBO_SESSION_CONCURRENT_YIELDED_RUNS: "15",
	}), {
		maxConcurrentYieldedRuns: 75,
		sessionConcurrentYieldedRuns: 15,
	});
	assert.equal(sanitizeConcurrentYieldedRuns(0), undefined);
	assert.equal(sanitizeConcurrentYieldedRuns("1.5"), undefined);
	assert.equal(sanitizeConcurrentYieldedRuns("20"), 20);
});

test("gateway settings persist Web overrides above environment fallbacks", () => {
	const originalPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-gateway-settings-"));
	process.env.PIBO_HOME = dir;
	try {
		const env = {
			PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS: "60",
			PIBO_SESSION_CONCURRENT_YIELDED_RUNS: "12",
		};
		assert.deepEqual(loadPiboGatewaySettings(env), {
			maxConcurrentYieldedRuns: 60,
			sessionConcurrentYieldedRuns: 12,
		});
		assert.deepEqual(updatePiboGatewaySettings({
			maxConcurrentYieldedRuns: 80,
			sessionConcurrentYieldedRuns: 16,
		}, env), {
			maxConcurrentYieldedRuns: 80,
			sessionConcurrentYieldedRuns: 16,
		});
		assert.deepEqual(loadPiboGatewaySettings({
			PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS: "2",
			PIBO_SESSION_CONCURRENT_YIELDED_RUNS: "1",
		}), {
			maxConcurrentYieldedRuns: 80,
			sessionConcurrentYieldedRuns: 16,
		});
		const persisted = JSON.parse(readFileSync(join(dir, "gateway-settings.json"), "utf8"));
		assert.deepEqual(persisted.settings, {
			maxConcurrentYieldedRuns: 80,
			sessionConcurrentYieldedRuns: 16,
		});
	} finally {
		if (originalPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = originalPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});
