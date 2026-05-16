import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_TELEMETRY_STALE_THRESHOLD_MS,
	TelemetryStaleDetector,
	resolveTelemetryStaleThreshold,
	sanitizeTelemetryStaleThresholdSettings,
} from "../dist/core/telemetry-staleness.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-telemetry-staleness-payloads-")) });
}

function seedActiveTurn(store, overrides = {}) {
	const piboSessionId = overrides.piboSessionId ?? "ps_stale_detector";
	const turnId = overrides.turnId ?? "turn_stale_detector";
	const phaseId = overrides.phaseId ?? `${turnId}:provider_stream`;
	store.telemetry.upsertTurn({
		turnId,
		piboSessionId,
		status: overrides.status ?? "running",
		currentPhase: overrides.phase ?? "provider_stream",
		queuedAt: overrides.queuedAt ?? "2026-05-16T00:00:00.000Z",
		startedAt: overrides.startedAt ?? "2026-05-16T00:00:01.000Z",
		lastProgressAt: overrides.lastProgressAt,
		queueDepth: overrides.queueDepth ?? 1,
		metadata: { profile: overrides.profile ?? "test-profile" },
	});
	store.telemetry.upsertPhase({
		phaseId,
		turnId,
		piboSessionId,
		name: overrides.phase ?? "provider_stream",
		status: overrides.phaseStatus ?? "open",
		startedAt: overrides.phaseStartedAt ?? "2026-05-16T00:00:01.000Z",
		lastProgressAt: overrides.phaseLastProgressAt,
		providerRequestId: overrides.providerRequestId ?? "pr_stale_detector",
	});
	if (overrides.providerRequest !== false) {
		store.telemetry.upsertProviderRequest({
			providerRequestId: overrides.providerRequestId ?? "pr_stale_detector",
			piboSessionId,
			turnId,
			phaseId,
			provider: overrides.provider ?? "openai",
			api: "responses",
			model: overrides.model ?? "gpt-test",
			status: "streaming",
			startedAt: overrides.phaseStartedAt ?? "2026-05-16T00:00:01.000Z",
		});
	}
	return { piboSessionId, turnId, phaseId };
}

test("telemetry stale threshold settings sanitize invalid values and resolve overrides", () => {
	const settings = sanitizeTelemetryStaleThresholdSettings({
		defaultThresholdMs: 120000,
		providers: { OpenAI: 180000, bad: -1, huge: 99_999_999_999 },
		profiles: { "agent-profile": 240000, empty: 0 },
	});
	assert.deepEqual(settings, {
		defaultThresholdMs: 120000,
		providers: { openai: 180000 },
		profiles: { "agent-profile": 240000 },
	});
	assert.deepEqual(resolveTelemetryStaleThreshold({ provider: "openai", settings }), { thresholdMs: 180000, source: "provider", key: "openai" });
	assert.deepEqual(resolveTelemetryStaleThreshold({ provider: "openai", profile: "agent-profile", settings }), { thresholdMs: 240000, source: "profile", key: "agent-profile" });
	assert.deepEqual(resolveTelemetryStaleThreshold({ provider: "openai", settings, overrideThresholdMs: 30000 }), { thresholdMs: 30000, source: "override" });
	assert.deepEqual(resolveTelemetryStaleThreshold({ settings: {} }), { thresholdMs: DEFAULT_TELEMETRY_STALE_THRESHOLD_MS, source: "default" });
});

test("telemetry stale detector reports provider/profile-aware stale active work without mutating sessions", () => {
	const store = createStore();
	try {
		seedActiveTurn(store, { phaseLastProgressAt: "2026-05-16T00:00:00.000Z", provider: "openai", profile: "slow-profile" });
		const detector = new TelemetryStaleDetector(store.telemetry, {
			providers: { openai: 10 * 60 * 1000 },
			profiles: { "slow-profile": 20 * 60 * 1000 },
		});

		assert.equal(detector.listStaleWork({ now: "2026-05-16T00:09:00.000Z" }).length, 0, "provider/profile threshold should suppress below-threshold work");
		const stale = detector.listStaleWork({ now: "2026-05-16T00:21:00.000Z" });
		assert.equal(stale.length, 1);
		assert.equal(stale[0].piboSessionId, "ps_stale_detector");
		assert.equal(stale[0].turnId, "turn_stale_detector");
		assert.equal(stale[0].activePhase, "provider_stream");
		assert.equal(stale[0].staleForMs, 21 * 60 * 1000);
		assert.equal(stale[0].appliedThresholdMs, 20 * 60 * 1000);
		assert.equal(stale[0].thresholdSource, "profile");
		assert.equal(stale[0].thresholdKey, "slow-profile");
		assert.equal(stale[0].provider, "openai");
		assert.equal(stale[0].profile, "slow-profile");
		assert.equal(stale[0].queueDepth, 1);
		assert.equal(stale[0].nextCommands.includes("pibo debug telemetry turn turn_stale_detector"), true);
		assert.equal(store.telemetry.getTurnTimeline("turn_stale_detector").turn.status, "running");
	} finally {
		store.close();
	}
});

test("telemetry stale detector handles missing progress times and ignores completed turns", () => {
	const store = createStore();
	try {
		seedActiveTurn(store, {
			piboSessionId: "ps_missing_progress",
			turnId: "turn_missing_progress",
			phaseId: "phase_missing_progress",
			providerRequestId: "pr_missing_progress",
			phaseStartedAt: "2026-05-16T00:00:00.000Z",
			phaseLastProgressAt: undefined,
			provider: "anthropic",
			profile: "default-profile",
		});
		seedActiveTurn(store, {
			piboSessionId: "ps_completed",
			turnId: "turn_completed",
			phaseId: "phase_completed_open",
			providerRequestId: "pr_completed",
			status: "ok",
			phaseStartedAt: "2026-05-16T00:00:00.000Z",
			provider: "openai",
		});

		const detector = new TelemetryStaleDetector(store.telemetry, { providers: { anthropic: 120000 } });
		const stale = detector.listStaleWork({ now: "2026-05-16T00:03:00.000Z" });
		assert.deepEqual(stale.map((row) => row.turnId), ["turn_missing_progress"]);
		assert.equal(stale[0].lastProgressAt, "2026-05-16T00:00:00.000Z");
		assert.equal(stale[0].thresholdSource, "provider");
		assert.equal(stale[0].thresholdKey, "anthropic");
	} finally {
		store.close();
	}
});
