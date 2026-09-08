import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { diagnoseCacheInference } from "../dist/shared/cache-diagnostics.js";

function inference(id, input, read, extra = {}) {
	return { evidence: { id, atMs: id === "before" ? 1000 : 2000, epoch: "1", prefixDigest: "same", historyContinuity: "verified", ...extra }, metrics: { inputTokens: input, cacheReadTokens: read, outputTokens: 259, totalTokens: input + 259 } };
}
const warm = inference("before", 154255, 150272);

test("reported 150543 uncached collapse and following 1953 uncached are distinct inferences", () => {
	const cold = inference("cold", 154255, 3712);
	const result = diagnoseCacheInference(cold, warm);
	assert.equal(result.uncachedTokens, 150543);
	assert.equal(result.warning, "cache-collapse");
	assert.deepEqual(result.causes, ["unchanged-observed-input/unknown"]);
	const recovery = diagnoseCacheInference(inference("recovery", 155937, 153984), cold);
	assert.equal(recovery.uncachedTokens, 1953);
	assert.equal(recovery.warning, "none");
});

test("missing cache usage is unknown; writes are not cache hits", () => {
	const missing = inference("missing", 20000, undefined);
	missing.metrics.cacheWriteTokens = 20000;
	assert.equal(diagnoseCacheInference(missing, warm).uncachedTokens, undefined);
	assert.equal(diagnoseCacheInference(missing, warm).warning, "none");
	missing.metrics.cacheReadTokens = 0;
	assert.equal(diagnoseCacheInference(missing, warm).uncachedTokens, 20000);
});

test("initial, duplicate, out of order, compaction and model changes never raise collapse alarms", () => {
	const cold = inference("cold", 20000, 0);
	for (const [current, previous] of [[cold, undefined], [warm, warm], [{ ...cold, evidence: { ...cold.evidence, atMs: 0 } }, warm], [inference("new", 20000, 0, { boundary: "compaction" }), warm], [inference("new", 20000, 0, { epoch: "2" }), warm]]) {
		assert.equal(diagnoseCacheInference(current, previous).warning, "none");
	}
});

test("thresholds are inclusive and first large input is excluded", () => {
	assert.equal(diagnoseCacheInference(inference("cold", 20000, 2000), inference("before", 20000, 16000)).warning, "cache-collapse");
	assert.equal(diagnoseCacheInference(inference("large-append", 200000, 18000), inference("before", 20000, 18000)).warning, "none", "a larger new message with unchanged cached input is not cache loss");
	for (const [input, read, beforeInput, beforeRead] of [[16383, 0, 20000, 16000], [20000, 2001, 20000, 16000], [20000, 0, 20000, 15999], [20000, 0, 1000, 1000]]) {
		assert.equal(diagnoseCacheInference(inference("cold", input, read), inference("before", beforeInput, beforeRead)).warning, "none");
	}
});

test("restart and idle time remain correlation; missing history proof lowers confidence", () => {
	const result = diagnoseCacheInference(inference("cold", 20000, 0, { historyContinuity: "unknown", runtimeGeneration: "new", atMs: 3600000 }), { ...warm, evidence: { ...warm.evidence, runtimeGeneration: "old" } });
	assert.equal(result.warning, "possible-cache-collapse");
	assert.equal(result.runtimeRestarted, true);
	assert.deepEqual(result.causes, ["insufficient-evidence"]);
	assert.equal(result.elapsedMs, 3599000);
});

test("observed changes report separate causes without guessing provider eviction", () => {
	const before = inference("before", 20000, 18000, { configurationDigest: "old", cacheKeyDigest: "old" });
	const result = diagnoseCacheInference(inference("cold", 20000, 0, { prefixDigest: "new", configurationDigest: "new", cacheKeyDigest: "new" }), before);
	assert.deepEqual(result.causes, ["local-prefix-changed", "cache-key-changed", "configuration-changed"]);
	assert.ok(Buffer.byteLength(JSON.stringify(result)) < 2048);
});

test("metadata-only diagnosis stays below 1ms p95 without accessing message history", () => {
	const cold = inference("cold", 200000, 0);
	Object.defineProperty(cold, "messages", { get() { throw new Error("history must not be read"); } });
	const samples = [];
	for (let i = 0; i < 10000; i++) {
		const start = performance.now();
		diagnoseCacheInference(cold, warm);
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	assert.ok(samples[9500] < 1, `p95=${samples[9500]}ms`);
});
