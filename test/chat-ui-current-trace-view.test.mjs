import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runCurrentTraceViewScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { computeCurrentTraceView } = await import("./src/apps/chat-ui/src/tracing/current-trace-view.ts");

		const baseTrace = {
			piboSessionId: "ps-test",
			title: "Test session",
			version: 1,
			latestStreamId: 2,
			eventCount: 0,
			eventLimit: 100,
			hasOlderEvents: false,
			nextBeforeSequence: undefined,
			rawEvents: [],
			nodes: [],
		};
		const assistantDelta = {
			id: "raw-1",
			piboSessionId: "ps-test",
			createdAt: "2026-05-27T10:00:00.000Z",
			eventSequence: 1,
			streamId: 3,
			type: "assistant_delta",
			eventId: "turn-1",
			payload: {
				type: "assistant_delta",
				piboSessionId: "ps-test",
				eventId: "turn-1",
				text: "Hello",
			},
		};

		assert.deepEqual(computeCurrentTraceView({
			selectedPiboSessionId: null,
			reconciledBaseTraceView: baseTrace,
			liveTraceOverlay: null,
			persistedUserMessageIndexForBaseTrace: new Map(),
		}), { traceView: null });

		const withoutOverlay = computeCurrentTraceView({
			selectedPiboSessionId: "ps-test",
			reconciledBaseTraceView: baseTrace,
			liveTraceOverlay: { piboSessionId: "other-session", events: [assistantDelta] },
			persistedUserMessageIndexForBaseTrace: new Map(),
			now: () => { throw new Error("no overlay should not measure"); },
		});
		assert.equal(withoutOverlay.traceView, baseTrace);
		assert.equal(withoutOverlay.liveTraceComputeDurationMs, undefined);

		const times = [10, 17];
		const withOverlay = computeCurrentTraceView({
			selectedPiboSessionId: "ps-test",
			reconciledBaseTraceView: baseTrace,
			liveTraceOverlay: { piboSessionId: "ps-test", events: [assistantDelta] },
			selectedSessionStatus: "running",
			persistedUserMessageIndexForBaseTrace: new Map(),
			now: () => times.shift(),
		});
		assert.notEqual(withOverlay.traceView, baseTrace);
		assert.equal(withOverlay.liveTraceComputeDurationMs, 7);
		assert.equal(withOverlay.traceView.rawEvents.length, 1);
		assert.equal(withOverlay.traceView.rawEvents[0], assistantDelta);
		assert.equal(withOverlay.traceView.latestStreamId, 3);
		const assistantNode = withOverlay.traceView.nodes.find((node) => node.type === "assistant.message");
		assert.equal(assistantNode?.output, "Hello");
		assert.equal(assistantNode?.status, "running");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("current trace view computation applies matching live overlays", async () => {
	await assert.doesNotReject(runCurrentTraceViewScenario());
});
