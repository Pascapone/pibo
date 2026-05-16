import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { applyPiboDataSchema } from "../dist/data/schema.js";
import { BestEffortTelemetryService, createTelemetryBoundedPreview, telemetrySafeJsonObject, telemetrySafeTopLevelKeys } from "../dist/data/telemetry.js";

function tempStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-telemetry-payloads-")) });
}

test("telemetry schema migration is idempotent and additive", () => {
	const db = new DatabaseSync(":memory:");
	applyPiboDataSchema(db);
	applyPiboDataSchema(db);

	const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
	for (const table of [
		"telemetry_turns",
		"telemetry_phases",
		"telemetry_provider_requests",
		"telemetry_provider_events",
		"telemetry_tool_calls",
	]) {
		assert.equal(tables.has(table), true, `missing table ${table}`);
	}
	for (const index of [
		"idx_telemetry_turns_session_updated",
		"idx_telemetry_phases_turn_started",
		"idx_telemetry_provider_requests_turn",
		"idx_telemetry_provider_events_request_sequence",
		"idx_telemetry_tool_calls_provider_request",
	]) {
		assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?").get(index).count, 1, `missing index ${index}`);
	}
	db.close();
});

test("telemetry store upserts correlated turns and phases", () => {
	const store = tempStore();
	try {
		const turn = store.telemetry.upsertTurn({
			turnId: "turn_test_1",
			piboSessionId: "ps_test_1",
			rootSessionId: "ps_root",
			roomId: "room_test_1",
			inputEventId: "input_1",
			eventId: "evt_1",
			eventStreamId: 10,
			payloadRef: "payload_1",
			runId: "run_1",
			source: "user",
			status: "queued",
			queuedAt: "2026-05-16T00:00:00.000Z",
			queuedBehind: 2,
			queueDepth: 3,
			metadata: { safe: true },
		});
		assert.equal(turn.piboSessionId, "ps_test_1");
		assert.equal(turn.payloadRef, "payload_1");
		assert.deepEqual(turn.metadata, { safe: true });

		const updated = store.telemetry.upsertTurn({
			turnId: "turn_test_1",
			piboSessionId: "ps_test_1",
			status: "running",
			startedAt: "2026-05-16T00:00:01.000Z",
			lastProgressAt: "2026-05-16T00:00:02.000Z",
			currentPhase: "provider_stream",
		});
		assert.equal(updated.status, "running");
		assert.equal(updated.payloadRef, "payload_1");
		assert.deepEqual(updated.metadata, { safe: true });

		const phase = store.telemetry.upsertPhase({
			phaseId: "phase_test_1",
			turnId: "turn_test_1",
			piboSessionId: "ps_test_1",
			name: "provider_stream",
			startedAt: "2026-05-16T00:00:01.000Z",
			providerRequestId: "pr_test_1",
			counters: { rawEvents: 1 },
		});
		assert.equal(phase.status, "open");
		assert.equal(phase.providerRequestId, "pr_test_1");
		assert.deepEqual(phase.counters, { rawEvents: 1 });

		const finished = store.telemetry.finishPhase("phase_test_1", {
			endedAt: "2026-05-16T00:00:03.000Z",
		});
		assert.equal(finished?.status, "ok");
		assert.equal(finished?.durationMs, 2000);
	} finally {
		store.close();
	}
});

test("telemetry store records provider request counters and provider event metadata", () => {
	const store = tempStore();
	try {
		store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_test_1",
			piboSessionId: "ps_test_1",
			roomId: "room_test_1",
			turnId: "turn_test_1",
			phaseId: "phase_test_1",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
			transport: "sse",
			status: "streaming",
			startedAt: "2026-05-16T00:00:00.000Z",
			firstByteAt: "2026-05-16T00:00:01.000Z",
			upstreamResponseId: "resp_test",
		});

		const firstEvent = store.telemetry.appendProviderEventSummary({
			rawEventId: "raw_1",
			providerRequestId: "pr_test_1",
			piboSessionId: "ps_test_1",
			turnId: "turn_test_1",
			sequence: 1,
			receivedAt: "2026-05-16T00:00:02.000Z",
			eventType: "response.output_item.added",
			byteSize: 128,
			parseStatus: "ok",
			normalizedType: "tool_call:start",
			itemId: "item_1",
			toolCallId: "call_1",
			safeFields: { itemType: "function_call" },
		});
		assert.equal(firstEvent.safeFields.itemType, "function_call");

		store.telemetry.appendProviderEventSummary({
			rawEventId: "raw_2",
			providerRequestId: "pr_test_1",
			sequence: 2,
			receivedAt: "2026-05-16T00:00:03.000Z",
			eventType: "response.unknown",
			byteSize: 64,
			parseStatus: "unknown_type",
		});

		store.telemetry.appendProviderEventSummary({
			rawEventId: "raw_3",
			providerRequestId: "pr_test_1",
			sequence: 3,
			receivedAt: "2026-05-16T00:00:04.000Z",
			eventType: "response.malformed",
			byteSize: 32,
			parseStatus: "invalid_json",
			normalizedType: "ignored",
			normalizedEventDelta: 0,
		});

		const provider = store.telemetry.getProviderRequest("pr_test_1");
		assert.equal(provider?.rawEventCount, 3);
		assert.equal(provider?.normalizedEventCount, 1);
		assert.equal(provider?.parseErrorCount, 1);
		assert.equal(provider?.unknownEventCount, 1);
		assert.equal(provider?.bytesReceived, 224);
		assert.deepEqual(provider?.eventTypeCounts, {
			"response.output_item.added": 1,
			"response.unknown": 1,
			"response.malformed": 1,
		});
		assert.deepEqual(store.telemetry.listProviderEvents("pr_test_1", { afterSequence: 1 }).map((event) => event.rawEventId), ["raw_2", "raw_3"]);

		const completed = store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_test_1",
			piboSessionId: "ps_test_1",
			turnId: "turn_test_1",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
			status: "completed",
			completedAt: "2026-05-16T00:00:04.000Z",
		});
		assert.equal(completed.rawEventCount, 3);
		assert.equal(completed.status, "completed");
	} finally {
		store.close();
	}
});

test("telemetry tool-call rows track argument progress without storing argument bodies", () => {
	const store = tempStore();
	try {
		const partial = store.telemetry.upsertToolCall({
			toolCallId: "call_1",
			piboSessionId: "ps_test_1",
			turnId: "turn_test_1",
			providerRequestId: "pr_test_1",
			providerItemId: "item_1",
			outputIndex: 0,
			toolName: "bash",
			status: "args_partial",
			argsStartedAt: "2026-05-16T00:00:01.000Z",
			firstDeltaAt: "2026-05-16T00:00:02.000Z",
			lastDeltaAt: "2026-05-16T00:00:03.000Z",
			argsBytes: 42,
			parseStatus: "partial",
			safeArgKeys: ["command"],
		});
		assert.equal(partial.argsBytes, 42);
		assert.deepEqual(partial.safeArgKeys, ["command"]);
		assert.equal(partial.payloadRef, undefined);

		const executing = store.telemetry.upsertToolCall({
			toolCallId: "call_1",
			piboSessionId: "ps_test_1",
			turnId: "turn_test_1",
			toolName: "bash",
			status: "executing",
			executionStartedAt: "2026-05-16T00:00:04.000Z",
		});
		assert.equal(executing.argsBytes, 42);
		assert.deepEqual(executing.safeArgKeys, ["command"]);
		assert.equal(executing.executionStartedAt, "2026-05-16T00:00:04.000Z");
	} finally {
		store.close();
	}
});

test("best-effort telemetry service swallows unavailable-store write failures", () => {
	const errors = [];
	const service = new BestEffortTelemetryService(undefined, (error) => errors.push(error));
	assert.equal(service.upsertTurn({ turnId: "turn_missing", piboSessionId: "ps_missing" }), undefined);
	assert.equal(errors.length, 0);

	const throwingService = new BestEffortTelemetryService({
		upsertTurn() {
			throw new Error("store unavailable");
		},
	}, (error) => errors.push(error));
	assert.equal(throwingService.upsertTurn({ turnId: "turn_error", piboSessionId: "ps_error" }), undefined);
	assert.equal(errors.length, 1);
});

test("telemetry preview reads are disabled by default", () => {
	const store = tempStore();
	try {
		assert.deepEqual(store.telemetry.getPayloadPreview("preview_1"), {
			status: "disabled",
			reason: "preview_capture_disabled",
			captureMode: "disabled",
			message: "Telemetry payload previews are disabled in V1; summaries store metadata and links only.",
		});
	} finally {
		store.close();
	}
});

test("telemetry read APIs return bounded correlated summaries", () => {
	const store = tempStore();
	try {
		store.telemetry.upsertTurn({
			turnId: "turn_old",
			piboSessionId: "ps_read_1",
			roomId: "room_read",
			status: "ok",
			queuedAt: "2026-05-16T00:00:00.000Z",
			completedAt: "2026-05-16T00:00:03.000Z",
			lastProgressAt: "2026-05-16T00:00:03.000Z",
			updatedAt: "2026-05-16T00:00:03.000Z",
		});
		store.telemetry.upsertTurn({
			turnId: "turn_active",
			piboSessionId: "ps_read_1",
			roomId: "room_read",
			status: "running",
			currentPhase: "tool_args",
			queuedAt: "2026-05-16T00:01:00.000Z",
			startedAt: "2026-05-16T00:01:01.000Z",
			lastProgressAt: "2026-05-16T00:01:02.000Z",
			queueDepth: 2,
			updatedAt: "2026-05-16T00:01:02.000Z",
		});
		store.telemetry.upsertPhase({
			phaseId: "phase_active",
			turnId: "turn_active",
			piboSessionId: "ps_read_1",
			name: "tool_args",
			status: "open",
			startedAt: "2026-05-16T00:01:01.000Z",
			lastProgressAt: "2026-05-16T00:01:02.000Z",
			providerRequestId: "pr_read_1",
			toolCallId: "call_read_1",
		});
		store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_read_1",
			piboSessionId: "ps_read_1",
			turnId: "turn_active",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
			status: "streaming",
			startedAt: "2026-05-16T00:01:01.000Z",
		});
		store.telemetry.upsertToolCall({
			toolCallId: "call_read_1",
			piboSessionId: "ps_read_1",
			turnId: "turn_active",
			providerRequestId: "pr_read_1",
			toolName: "bash",
			status: "args_partial",
			argsBytes: 12,
			parseStatus: "partial",
		});

		const sessions = store.telemetry.listSessions({ now: "2026-05-16T00:06:03.000Z", thresholdMs: 300000 });
		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].piboSessionId, "ps_read_1");
		assert.equal(sessions[0].activeTurnId, "turn_active");
		assert.equal(sessions[0].activePhase?.phaseId, "phase_active");
		assert.equal(sessions[0].isStale, true);
		assert.equal(sessions[0].queueDepth, 2);
		assert.equal(sessions[0].turnCount, 2);
		assert.equal(sessions[0].nextCommands.includes("pibo debug telemetry provider pr_read_1"), true);

		const detail = store.telemetry.getSessionTelemetry("ps_read_1", { limit: 1 });
		assert.equal(detail?.activeTurn?.turnId, "turn_active");
		assert.equal(detail?.recentTurns.length, 1);
		assert.equal(detail?.providerRequests[0]?.providerRequestId, "pr_read_1");
		assert.equal(detail?.toolCalls[0]?.toolCallId, "call_read_1");

		const timeline = store.telemetry.getTurnTimeline("turn_active");
		assert.equal(timeline?.phases[0]?.name, "tool_args");
		assert.equal(timeline?.providerRequests[0]?.providerRequestId, "pr_read_1");
		assert.equal(store.telemetry.getTurnTimeline("missing"), undefined);
	} finally {
		store.close();
	}
});

test("telemetry provider event page enforces limits and cursors", () => {
	const store = tempStore();
	try {
		store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_page",
			piboSessionId: "ps_page",
			turnId: "turn_page",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
		});
		for (let sequence = 1; sequence <= 4; sequence += 1) {
			store.telemetry.appendProviderEventSummary({
				rawEventId: `raw_page_${sequence}`,
				providerRequestId: "pr_page",
				sequence,
				eventType: "response.delta",
				byteSize: sequence,
			});
		}

		const page = store.telemetry.listProviderEventsPage("pr_page", { afterSequence: 1, limit: 2 });
		assert.deepEqual(page.rows.map((row) => row.sequence), [2, 3]);
		assert.equal(page.hasMore, true);
		assert.equal(page.truncated, true);
		assert.equal(page.nextAfterSequence, 3);
		assert.equal(page.storageMode, "per_event");
		assert.deepEqual(store.telemetry.listProviderEvents("pr_page", { afterSequence: 3 }).map((row) => row.sequence), [4]);
	} finally {
		store.close();
	}
});

test("telemetry volume-control helpers bound payload-like values", () => {
	const large = { command: "echo ok", secret: "x".repeat(200), nested: { ignored: true }, count: 2 };
	const preview = createTelemetryBoundedPreview({ value: large, valueKind: "tool_args", maxBytes: 48 });
	assert.equal(preview.truncated, true);
	assert.equal(preview.maxBytes, 48);
	assert.equal(preview.volumeControlled, true);
	assert.equal(Buffer.byteLength(preview.text, "utf8") <= 48, true);
	assert.deepEqual(telemetrySafeJsonObject(large, ["command", "count", "nested"]), { command: "echo ok", count: 2 });
	assert.deepEqual(telemetrySafeTopLevelKeys(large), ["command", "secret", "nested", "count"]);

	const headers = createTelemetryBoundedPreview({ value: { authorization: "Bearer secret", status: 200 }, valueKind: "headers", maxBytes: 20 });
	assert.equal(headers.truncated, true);
	assert.equal(headers.valueKind, "headers");
});

test("telemetry stale, stats, and prune are read-oriented by default", () => {
	const store = tempStore();
	try {
		store.telemetry.upsertTurn({
			turnId: "turn_stale",
			piboSessionId: "ps_stale",
			status: "running",
			queuedAt: "2026-05-16T00:00:00.000Z",
			lastProgressAt: "2026-05-16T00:00:00.000Z",
			retentionClass: "diagnostic",
			updatedAt: "2026-05-16T00:00:00.000Z",
		});
		store.telemetry.upsertPhase({
			phaseId: "phase_stale",
			turnId: "turn_stale",
			piboSessionId: "ps_stale",
			name: "provider_stream",
			status: "open",
			startedAt: "2026-05-16T00:00:00.000Z",
			lastProgressAt: "2026-05-16T00:00:00.000Z",
			retentionClass: "diagnostic",
			updatedAt: "2026-05-16T00:00:00.000Z",
		});
		store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_keep",
			piboSessionId: "ps_keep",
			turnId: "turn_keep",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
			retentionClass: "incident",
			updatedAt: "2026-05-16T00:00:00.000Z",
		});
		store.telemetry.upsertProviderRequest({
			providerRequestId: "pr_delete",
			piboSessionId: "ps_stale",
			turnId: "turn_stale",
			provider: "openai",
			api: "responses",
			model: "gpt-test",
			bytesReceived: 10,
			retentionClass: "diagnostic",
			updatedAt: "2026-05-16T00:00:00.000Z",
		});
		store.telemetry.appendProviderEventSummary({
			rawEventId: "raw_delete",
			providerRequestId: "pr_delete",
			receivedAt: "2026-05-16T00:00:00.000Z",
			eventType: "response.delta",
			byteSize: 9,
			retentionClass: "diagnostic",
		});

		const stale = store.telemetry.listStaleWork({ now: "2026-05-16T00:10:00.000Z", thresholdMs: 300000 });
		assert.equal(stale.length, 1);
		assert.equal(stale[0].turnId, "turn_stale");
		assert.equal(stale[0].phase, "provider_stream");
		assert.equal(stale[0].nextCommands.includes("pibo debug telemetry turn turn_stale"), true);

		const stats = store.telemetry.getStats();
		assert.equal(stats.rows.some((row) => row.retentionClass === "diagnostic" && row.table === "provider_events" && row.byteCount === 9), true);
		assert.equal(stats.totalRows >= 5, true);

		const dryRun = store.telemetry.prune({ retentionClass: "diagnostic", before: "2026-05-17T00:00:00.000Z" });
		assert.equal(dryRun.applied, false);
		assert.equal(dryRun.rowsDeleted, 0);
		assert.equal(store.telemetry.getProviderRequest("pr_delete")?.providerRequestId, "pr_delete");

		const applied = store.telemetry.prune({ retentionClass: "diagnostic", before: "2026-05-17T00:00:00.000Z", apply: true });
		assert.equal(applied.applied, true);
		assert.equal(applied.rowsDeleted, dryRun.rowsMatched);
		assert.equal(store.telemetry.getProviderRequest("pr_delete"), undefined);
		assert.equal(store.telemetry.getProviderRequest("pr_keep")?.providerRequestId, "pr_keep");
	} finally {
		store.close();
	}
});
