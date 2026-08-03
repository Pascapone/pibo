import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { applyPiboRuntimeRetryDefaults } from "../dist/core/runtime.js";
import {
	RALPH_RUNTIME_RETRY_DEFAULTS,
	resolvePiboSessionRetryDefaults,
} from "../dist/core/session-router.js";

async function createSettingsFixture({ globalSettings, projectSettings } = {}) {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-retry-defaults-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });
	if (globalSettings) await writeFile(join(agentDir, "settings.json"), JSON.stringify(globalSettings), "utf-8");
	if (projectSettings) {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify(projectSettings), "utf-8");
	}
	return {
		settingsManager: SettingsManager.create(cwd, agentDir),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

test("Ralph runtime retry defaults fill missing Pi settings without enabling provider retries", async () => {
	const fixture = await createSettingsFixture();
	try {
		applyPiboRuntimeRetryDefaults(fixture.settingsManager, RALPH_RUNTIME_RETRY_DEFAULTS);

		assert.deepEqual(fixture.settingsManager.getRetrySettings(), {
			enabled: true,
			maxRetries: 7,
			baseDelayMs: 2_000,
		});
		assert.equal(fixture.settingsManager.getProviderRetrySettings().maxRetries, undefined);
		assert.deepEqual(fixture.settingsManager.getGlobalSettings(), {});
		assert.deepEqual(fixture.settingsManager.getProjectSettings(), {});
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph runtime retry defaults preserve explicit global and project values", async () => {
	const fixture = await createSettingsFixture({
		globalSettings: {
			retry: {
				enabled: false,
				maxRetries: 0,
				baseDelayMs: 1_000,
				provider: { maxRetries: 0, maxRetryDelayMs: 30_000 },
			},
		},
		projectSettings: {
			retry: { baseDelayMs: 3_000 },
		},
	});
	try {
		applyPiboRuntimeRetryDefaults(fixture.settingsManager, RALPH_RUNTIME_RETRY_DEFAULTS);

		assert.deepEqual(fixture.settingsManager.getRetrySettings(), {
			enabled: false,
			maxRetries: 0,
			baseDelayMs: 3_000,
		});
		assert.equal(fixture.settingsManager.getProviderRetrySettings().maxRetries, 0);
		assert.equal(fixture.settingsManager.getProviderRetrySettings().maxRetryDelayMs, 30_000);
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph runtime retry defaults fill only missing sibling fields", async () => {
	const fixture = await createSettingsFixture({
		globalSettings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
		projectSettings: { retry: { baseDelayMs: 3_000 } },
	});
	try {
		applyPiboRuntimeRetryDefaults(fixture.settingsManager, RALPH_RUNTIME_RETRY_DEFAULTS);

		assert.deepEqual(fixture.settingsManager.getRetrySettings(), {
			enabled: false,
			maxRetries: 7,
			baseDelayMs: 3_000,
		});
		assert.equal(fixture.settingsManager.getProviderRetrySettings().maxRetries, 0);
	} finally {
		await fixture.cleanup();
	}
});

test("session routing selects durable retry defaults only for Ralph sessions", () => {
	assert.strictEqual(resolvePiboSessionRetryDefaults("loop"), RALPH_RUNTIME_RETRY_DEFAULTS);
	assert.strictEqual(resolvePiboSessionRetryDefaults("ralph"), RALPH_RUNTIME_RETRY_DEFAULTS);
	assert.equal(resolvePiboSessionRetryDefaults("chat"), undefined);
	assert.equal(resolvePiboSessionRetryDefaults("subagent"), undefined);

	const configured = { maxRetries: 1 };
	assert.strictEqual(resolvePiboSessionRetryDefaults("ralph", configured), configured);
	assert.strictEqual(resolvePiboSessionRetryDefaults("chat", configured), configured);
});
