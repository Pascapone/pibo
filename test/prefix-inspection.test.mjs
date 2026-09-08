import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectSessionPrefix } from "../dist/sessions/prefix-inspection.js";
import { PREFIX_RESOURCES_CODEC } from "../dist/sessions/prefix-resources.js";

const capsule = { format: 1, adapterId: "pi", codec: "pi-fixture/v1", digest: "a".repeat(64), bytes: 10 };
const prefix = { format: 1, status: "sealed", epoch: 1, capsule, reason: "initial", nativeSessionId: "native", evidence: "adapter-inputs" };
const input = { adapterId: "pi", nativeSessionId: "native", state: "bound" };
const pending = { format: 1, id: "11111111-1111-4111-8111-111111111111", reason: "compaction", fromEpoch: 1,
	nativeSessionId: "native", sourceHead: "head", state: "pending" };

test("prefix inventory distinguishes unknown legacy, resource preparation and stored prefix evidence", () => {
	assert.equal(inspectSessionPrefix(input).status, "legacy-unverified");
	assert.equal(inspectSessionPrefix({ ...input, state: "unbound" }).status, "uninitialized");
	assert.equal(inspectSessionPrefix({ ...input, metadata: { piboSessionPrefixResources: { ...capsule, codec: PREFIX_RESOURCES_CODEC } } }).status, "preparing");
	const result = inspectSessionPrefix({ ...input, metadata: { piboSessionPrefix: prefix, apiKey: "must-not-leak" } });
	assert.equal(result.status, "sealed");
	assert.equal(result.verification, "metadata-only", "stored metadata is not native or provider equality proof");
	assert.equal(result.digest, capsule.digest);
	assert.ok(!JSON.stringify(result).includes("must-not-leak"));
});

test("corrupt or contradictory prefix metadata never appears as legacy", () => {
	for (const metadata of [null, [], "bad-json", { piboSessionPrefix: null }, { piboSessionPrefix: { ...prefix, capsule: { ...capsule, digest: "private-invalid-digest" } } },
		{ piboSessionPrefix: { ...prefix, nativeSessionId: "different" } }, { piboSessionPrefix: { ...prefix, capsule: { ...capsule, adapterId: "orp" } } },
		{ piboSessionPrefixTransition: pending }, { piboSessionPrefix: prefix, piboSessionPrefixTransition: { ...pending, fromEpoch: 2 } },
		{ piboSessionPrefix: prefix, piboSessionPrefixResources: null }]) {
		const result = inspectSessionPrefix({ ...input, metadata });
		assert.deepEqual(result, { status: "recovery-required", verification: "metadata-only", reason: "invalid-prefix-metadata" });
	}
});

test("prefix inventory exposes pending native transitions and permits older resolved audit receipts", () => {
	assert.equal(inspectSessionPrefix({ ...input, metadata: { piboSessionPrefix: prefix, piboSessionPrefixTransition: pending } }).status, "transition-pending");
	assert.equal(inspectSessionPrefix({ ...input, metadata: { piboSessionPrefix: { ...prefix, epoch: 3, reason: "model-change" },
		piboSessionPrefixTransition: { ...pending, state: "completed" } } }).status, "sealed");
});
