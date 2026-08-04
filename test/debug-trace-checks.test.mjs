import assert from "node:assert/strict";
import test from "node:test";
import { checkTraceView } from "../dist/debug/trace.js";

function node(id, stableKey) {
	return {
		id,
		piboSessionId: "ps_test",
		type: "execution.compaction",
		title: "compact",
		status: "done",
		source: "event-log",
		stableKey,
		orderKey: {
			turnSeq: 0,
			phaseRank: 0,
			sourceRank: 1,
		},
		children: [],
	};
}

test("debug trace check reports duplicate stable keys", () => {
	const result = checkTraceView({
		piboSessionId: "ps_test",
		piSessionId: "pi_test",
		title: "Test",
		version: "1",
		nodes: [node("compaction-1", "compaction:active"), node("compaction-2", "compaction:active")],
		rawEvents: [],
	});

	assert.equal(result.status, "warning");
	assert.deepEqual(result.issues.filter((issue) => issue.code === "duplicate_stable_key"), [{
		severity: "warning",
		code: "duplicate_stable_key",
		nodeId: "compaction-2",
		message: 'Stable key "compaction:active" is already used by node "compaction-1".',
	}]);
});
