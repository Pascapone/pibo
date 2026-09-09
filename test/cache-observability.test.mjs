import assert from "node:assert/strict";
import test from "node:test";
import { cacheUsageWarningText, observeCacheUsage } from "../dist/shared/cache-observability.js";

function inference(id, inputTokens, cacheReadTokens, extra = {}) {
	return {
		id,
		completedAt: id === "before" ? "2026-09-09T04:00:00.000Z" : "2026-09-09T04:01:00.000Z",
		metrics: {
			inputTokens,
			outputTokens: 100,
			cacheReadTokens,
			totalTokens: inputTokens + 100,
			...extra,
		},
	};
}

test("cache observations classify provider-reported reads without treating writes as hits", () => {
	const observation = observeCacheUsage(inference("current", 20_000, 16_000, { cacheWriteTokens: 1_000 }));
	assert.equal(observation.source, "provider-reported-usage");
	assert.equal(observation.cacheState, "warm");
	assert.equal(observation.inputTokens, 20_000);
	assert.equal(observation.cacheReadTokens, 16_000);
	assert.equal(observation.cacheWriteTokens, 1_000);
	assert.equal(observation.uncachedInputTokens, 4_000);
	assert.equal(observation.cacheReadRatio, 0.8);
	assert.equal(observation.warning, "none");
});

test("cache observations flag only a large warm-to-cold provider read drop", () => {
	const before = inference("before", 154_255, 150_272);
	const current = inference("current", 154_255, 3_712);
	const observation = observeCacheUsage(current, before);
	assert.equal(observation.cacheState, "cold");
	assert.equal(observation.warning, "possible-cache-read-drop");
	assert.equal(observation.explanation, "cache-read-ratio-dropped");
	assert.equal(observation.uncachedInputTokens, 150_543);
	assert.equal(observation.previousInferenceId, "before");
	assert.equal(observation.elapsedMs, 60_000);
	assert.match(cacheUsageWarningText(observation), /provider-reported cached input fell/);
	assert.match(cacheUsageWarningText(observation), /do not identify the cause/);
});

test("cache observations suppress drop warnings across a visible compaction boundary", () => {
	const observation = observeCacheUsage(
		inference("current", 154_255, 3_712),
		inference("before", 154_255, 150_272),
		{ compactionBetween: true },
	);
	assert.equal(observation.warning, "none");
	assert.equal(observation.explanation, "compaction-between-inferences");
});

test("cache observations remain unknown when the runtime does not report cache reads", () => {
	const current = inference("current", 20_000, undefined);
	delete current.metrics.cacheReadTokens;
	const observation = observeCacheUsage(current);
	assert.equal(observation.cacheState, "unknown");
	assert.equal(observation.warning, "none");
	assert.equal(observation.explanation, "insufficient-data");
	assert.equal(observation.uncachedInputTokens, undefined);
	assert.equal(cacheUsageWarningText(observation), undefined);
});
