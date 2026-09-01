import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { formatDebugTrace } from "../dist/debug/trace.js";

const execFileAsync = promisify(execFile);

async function runScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { resolveDebugTraceSessionStatus, summarizeDebugTraceStatus } = await import("./src/debug/trace-status.ts");

		assert.deepEqual(resolveDebugTraceSessionStatus("idle", ["message_finished", "message_started"]), {
			status: "running",
			source: "event-log",
		});
		assert.deepEqual(resolveDebugTraceSessionStatus("running", ["message_started", "message_finished"]), {
			status: "idle",
			source: "event-log",
		});
		assert.deepEqual(resolveDebugTraceSessionStatus("error", []), {
			status: "error",
			source: "session-store",
		});

		assert.deepEqual(summarizeDebugTraceStatus("idle", ["done", "error", "done"]), {
			status: "done",
			errorNodeCount: 1,
		});
		assert.deepEqual(summarizeDebugTraceStatus("running", ["done", "error"]), {
			status: "running",
			errorNodeCount: 1,
		});
		assert.deepEqual(summarizeDebugTraceStatus("idle", ["done", "running", "error"]), {
			status: "running",
			errorNodeCount: 1,
		});
		assert.deepEqual(summarizeDebugTraceStatus("error", ["done"]), {
			status: "error",
			errorNodeCount: 0,
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("debug trace lifecycle is separate from historical node errors", async () => {
	await assert.doesNotReject(runScenario());
});

test("debug trace text reports incomplete projection integrity", () => {
	const formatted = formatDebugTrace({
		piboSessionId: "ps_incomplete",
		piSessionId: "pi_incomplete",
		historySource: "events",
		integrityStatus: "incomplete",
		title: "Incomplete trace",
		status: "done",
		statusSource: "session-store",
		errorNodeCount: 1,
		nodes: [],
		rawNodeCount: 0,
	});

	assert.match(formatted, /^integrityStatus: incomplete$/m);
});
