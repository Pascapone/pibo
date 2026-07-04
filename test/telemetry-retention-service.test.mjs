import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { pruneTelemetryOlderThan, maybeRunTelemetryRetentionMaintenance, isPersistentRetentionDue } from "../dist/apps/chat/telemetry-retention-service.js";

function createStore() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-telemetry-retention-"));
	return { dir, store: new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") }) };
}

function seedTelemetry(store) {
	store.telemetry.upsertTurn({
		turnId: "turn_old",
		piboSessionId: "ps_old",
		status: "ok",
		currentPhase: "finish",
		queuedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		retentionClass: "diagnostic",
	});
	store.telemetry.upsertProviderRequest({
		providerRequestId: "pr_old",
		piboSessionId: "ps_old",
		turnId: "turn_old",
		provider: "openai",
		api: "responses",
		model: "gpt-test",
		status: "completed",
		startedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		bytesReceived: 10,
		retentionClass: "diagnostic",
	});
	store.telemetry.appendProviderEventSummary({
		providerRequestId: "pr_old",
		piboSessionId: "ps_old",
		turnId: "turn_old",
		eventType: "old.event",
		byteSize: 5,
		receivedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		retentionClass: "provider_event",
	});
	store.telemetry.upsertTurn({
		turnId: "turn_new",
		piboSessionId: "ps_new",
		status: "running",
		currentPhase: "provider_stream",
		queuedAt: "2026-02-10T00:00:00.000Z",
		updatedAt: "2026-02-10T00:00:00.000Z",
		retentionClass: "diagnostic",
	});
}

test("telemetry retention prunes only telemetry rows older than the cutoff", () => {
	const { dir, store } = createStore();
	try {
		seedTelemetry(store);
		const dryRun = pruneTelemetryOlderThan({ store, dataStore: store, days: 30, now: new Date("2026-02-15T00:00:00.000Z"), apply: false });
		assert.equal(dryRun.applied, false);
		assert.equal(dryRun.rowsDeleted, 0);
		assert.ok(dryRun.results.reduce((sum, result) => sum + result.rowsMatched, 0) >= 3);

		const applied = pruneTelemetryOlderThan({ dataStore: store, days: 30, now: new Date("2026-02-15T00:00:00.000Z"), apply: true });
		assert.equal(applied.applied, true);
		assert.ok(applied.rowsDeleted >= 3);
		assert.equal(store.telemetry.getTurnTimeline("turn_old"), undefined);
		assert.ok(store.telemetry.getTurnTimeline("turn_new"));
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("persistent telemetry retention due check survives gateway restarts", () => {
	const now = new Date("2026-02-15T00:00:00.000Z");
	const day = 24 * 60 * 60 * 1000;
	assert.equal(isPersistentRetentionDue(undefined, now, day), true);
	assert.equal(isPersistentRetentionDue("2026-02-14T12:00:00.000Z", now, day), false);
	assert.equal(isPersistentRetentionDue("2026-02-13T00:00:00.000Z", now, day), true);
});

test("automatic telemetry retention records persistent prune timestamp after success", async () => {
	const { dir, store } = createStore();
	try {
		seedTelemetry(store);
		let lastPrunedAt;
		maybeRunTelemetryRetentionMaintenance({
			state: {},
			dataStore: store,
			settings: { enabled: true, days: 30 },
			now: new Date("2026-02-15T00:00:00.000Z"),
			intervalMs: 0,
			onPruned: (value) => { lastPrunedAt = value; },
			context: { channelContext: { listSessionRuntimeStatuses: () => [] } },
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(lastPrunedAt, "2026-02-15T00:00:00.000Z");
		assert.equal(store.telemetry.getTurnTimeline("turn_old"), undefined);
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("automatic telemetry retention skips while runtime work is active", async () => {
	const { dir, store } = createStore();
	try {
		seedTelemetry(store);
		const state = {};
		maybeRunTelemetryRetentionMaintenance({
			state,
			dataStore: store,
			settings: { enabled: true, days: 30 },
			now: new Date("2026-02-15T00:00:00.000Z"),
			intervalMs: 0,
			context: {
				channelContext: {
					listSessionRuntimeStatuses: () => [{ piboSessionId: "ps_active", processing: true, streaming: false, queuedMessages: 0, activeTools: [], enabledTools: [], cwd: dir, disposed: false }],
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(store.telemetry.getTurnTimeline("turn_old"));
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
