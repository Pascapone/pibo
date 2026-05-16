import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { seedStuckToolCallTelemetryFixture } from "./telemetry-stuck-tool-call-fixture.mjs";

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-telemetry-fixture-payloads-")) });
}

test("stuck tool-call telemetry fixture seeds inspectable session, turn, provider, and tool rows", () => {
	const store = createStore();
	try {
		const { ids, clock } = seedStuckToolCallTelemetryFixture(store.telemetry);

		const session = store.telemetry.getSessionTelemetry(ids.piboSessionId);
		assert.ok(session);
		assert.equal(session.activeTurn?.turnId, ids.turnId);
		assert.equal(session.activeTurn?.status, "running");
		assert.equal(session.activePhase?.name, "tool_args");
		assert.equal(session.activePhase?.status, "open");
		assert.equal(session.activePhase?.toolCallId, ids.toolCallId);
		assert.equal(session.nextCommands.includes(`pibo debug telemetry turn ${ids.turnId}`), true);
		assert.equal(session.nextCommands.includes(`pibo debug telemetry provider ${ids.providerRequestId}`), true);
		assert.equal(session.nextCommands.includes(`pibo debug telemetry tool ${ids.toolCallId}`), true);

		const timeline = store.telemetry.getTurnTimeline(ids.turnId);
		assert.ok(timeline);
		assert.equal(timeline.turn.currentPhase, "tool_args");
		assert.equal(timeline.turn.queueDepth, 1);
		assert.equal(timeline.phases.find((phase) => phase.name === "provider_stream")?.status, "open");
		assert.equal(timeline.phases.find((phase) => phase.name === "tool_args")?.status, "open");
		assert.equal(timeline.providerRequests.map((request) => request.providerRequestId).includes(ids.providerRequestId), true);
		assert.equal(timeline.toolCalls.map((tool) => tool.toolCallId).includes(ids.toolCallId), true);

		const provider = store.telemetry.getProviderRequest(ids.providerRequestId);
		assert.ok(provider);
		assert.equal(provider.status, "streaming");
		assert.equal(provider.firstByteAt, clock.firstRawEventAt);
		assert.equal(provider.lastRawEventAt, clock.lastRawEventAt);
		assert.equal(provider.lastNormalizedEventAt, clock.lastRawEventAt);
		assert.equal(provider.upstreamResponseId, ids.upstreamResponseId);
		assert.equal(provider.rawEventCount, 3);
		assert.equal(provider.normalizedEventCount, 2);
		assert.equal(provider.parseErrorCount, 0);
		assert.equal(provider.unknownEventCount, 0);
		assert.deepEqual(provider.eventTypeCounts, {
			"response.created": 1,
			"response.output_item.added": 1,
			"response.function_call_arguments.delta": 1,
		});

		const eventsPage = store.telemetry.listProviderEventsPage(ids.providerRequestId, { limit: 10 });
		assert.equal(eventsPage.storageMode, "per_event");
		assert.equal(eventsPage.rows.length, 3);
		assert.equal(eventsPage.rows[1].toolCallId, ids.toolCallId);
		assert.equal(eventsPage.rows[2].eventType, "response.function_call_arguments.delta");

		const tool = store.telemetry.getToolCall(ids.toolCallId);
		assert.ok(tool);
		assert.equal(tool.status, "args_partial");
		assert.equal(tool.parseStatus, "partial");
		assert.equal(tool.argsBytes > 0, true);
		assert.equal(tool.lastDeltaAt, clock.lastDeltaAt);
		assert.equal(tool.executionStartedAt, undefined);
		assert.equal(tool.executionEndedAt, undefined);

		const stale = store.telemetry.listStaleWork({ now: clock.staleNow, thresholdMs: 5 * 60 * 1000, limit: 10 });
		assert.equal(stale.some((item) => item.turnId === ids.turnId && item.phase === "tool_args" && item.nextCommands.includes(`pibo debug telemetry turn ${ids.turnId}`)), true);
	} finally {
		store.close();
	}
});

test("stuck tool-call telemetry fixture remains metadata-only", () => {
	const store = createStore();
	try {
		const { ids } = seedStuckToolCallTelemetryFixture(store.telemetry, { argsBytes: 4096 });
		const serialized = JSON.stringify({
			turn: store.telemetry.getTurnTimeline(ids.turnId),
			provider: store.telemetry.getProviderRequest(ids.providerRequestId),
			providerEvents: store.telemetry.listProviderEvents(ids.providerRequestId),
			tool: store.telemetry.getToolCall(ids.toolCallId),
		});

		assert.equal(serialized.includes("command"), false);
		assert.equal(serialized.includes("stdout"), false);
		assert.equal(serialized.includes("payload body"), false);
		assert.equal(store.telemetry.getPayloadPreview("any-fixture-preview").status, "disabled");
	} finally {
		store.close();
	}
});
