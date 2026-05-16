import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import {
	seedTelemetryValidationFixtures,
	telemetryValidationFixtureIds,
	telemetryValidationFixtureSecrets,
} from "./telemetry-fixtures.mjs";

const execFileAsyncRaw = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-telemetry-validation-payloads-")) });
}

function execPibo(cwd, args) {
	return execFileAsyncRaw("node", [cliPath, ...args], {
		cwd,
		env: { ...process.env, PIBO_HOME: join(cwd, ".pibo") },
	});
}

test("telemetry validation fixtures seed normal completed and partial tool-call drill-down records", () => {
	const store = createStore();
	try {
		const { ids, stuck } = seedTelemetryValidationFixtures(store.telemetry);

		const completed = store.telemetry.getSessionTelemetry(ids.completedSessionId);
		assert.ok(completed);
		assert.equal(completed.activeTurn?.turnId, ids.completedTurnId);
		assert.equal(completed.activeTurn?.status, "ok");
		assert.equal(completed.providerRequests[0]?.status, "completed");
		const completedTimeline = store.telemetry.getTurnTimeline(ids.completedTurnId);
		assert.ok(completedTimeline);
		assert.equal(completedTimeline.phases.some((phase) => phase.name === "finish" && phase.status === "ok"), true);

		const stuckDetail = store.telemetry.getSessionTelemetry(stuck.ids.piboSessionId);
		assert.ok(stuckDetail);
		assert.equal(stuckDetail.activeTurn?.turnId, stuck.ids.turnId);
		assert.equal(stuckDetail.activePhase?.name, "tool_args");
		assert.equal(stuckDetail.activePhase?.toolCallId, stuck.ids.toolCallId);
		assert.equal(stuckDetail.nextCommands.includes(`pibo debug telemetry turn ${stuck.ids.turnId}`), true);
		assert.equal(stuckDetail.nextCommands.includes(`pibo debug telemetry provider ${stuck.ids.providerRequestId}`), true);
		assert.equal(stuckDetail.nextCommands.includes(`pibo debug telemetry tool ${stuck.ids.toolCallId}`), true);
	} finally {
		store.close();
	}
});

test("telemetry validation fixtures cover provider parse error, unknown event, stale tool execution, no telemetry, and disabled preview", () => {
	const store = createStore();
	try {
		const { ids, clock } = seedTelemetryValidationFixtures(store.telemetry);

		const malformed = store.telemetry.getProviderRequest(ids.malformedProviderRequestId);
		assert.ok(malformed);
		assert.equal(malformed.status, "error");
		assert.equal(malformed.parseErrorCount, 1);
		assert.equal(malformed.errorCategory, "provider_parse_error");
		const malformedEvents = store.telemetry.listProviderEventsPage(ids.malformedProviderRequestId, { limit: 5 });
		assert.equal(malformedEvents.rows[0]?.parseStatus, "invalid_json");

		const unknown = store.telemetry.getProviderRequest(ids.unknownProviderRequestId);
		assert.ok(unknown);
		assert.equal(unknown.unknownEventCount, 1);
		assert.equal(unknown.eventTypeCounts["provider.experimental.unknown"], 1);

		const staleTool = store.telemetry.getToolCall(ids.staleToolCallId);
		assert.ok(staleTool);
		assert.equal(staleTool.status, "executing");
		assert.equal(staleTool.executionStartedAt, clock.staleToolStartedAt);
		assert.equal(staleTool.executionEndedAt, undefined);
		const staleRows = store.telemetry.listStaleWork({ now: clock.staleNow, thresholdMs: 5 * 60 * 1000, limit: 20 });
		assert.equal(staleRows.some((row) => row.turnId === ids.staleToolTurnId && row.phase === "tool_execution"), true);

		assert.equal(store.telemetry.getSessionTelemetry(ids.noTelemetrySessionId), undefined);
		assert.equal(store.telemetry.getPayloadPreview(ids.missingPreviewRef).status, "disabled");
	} finally {
		store.close();
	}
});

test("telemetry validation fixtures keep storage metadata-only and preview-unavailable by default", () => {
	const store = createStore();
	try {
		const { ids, secrets } = seedTelemetryValidationFixtures(store.telemetry);
		const serializedTelemetryRows = JSON.stringify(readTelemetryTables(store));
		for (const secret of Object.values(secrets)) {
			assert.equal(serializedTelemetryRows.includes(secret), false);
		}
		const timeline = store.telemetry.getTurnTimeline(ids.completedEventId);
		assert.ok(timeline);
		assert.equal(timeline.turn.payloadRef, "payload_fixture_completed_assistant");
		assert.equal(timeline.turn.eventId, ids.completedEventId);
		assert.equal(store.telemetry.getPayloadPreview(ids.missingPreviewRef).reason, "preview_capture_disabled");
	} finally {
		store.close();
	}
});

test("telemetry CLI validates session to turn to provider and tool drill-down with bounded JSON and text output", async () => {
	const cwd = await makeTelemetryFixtureCwd();
	try {
		const sessionId = telemetryValidationFixtureIds.stuck.piboSessionId;
		const session = await execPibo(cwd, ["debug", "telemetry", "session", sessionId, "--json"]);
		const sessionParsed = JSON.parse(session.stdout);
		assert.equal(sessionParsed.available, true);
		const turnId = sessionParsed.detail.activeTurn.turnId;
		const providerRequestId = sessionParsed.detail.providerRequests[0].providerRequestId;
		const toolCallId = sessionParsed.detail.toolCalls[0].toolCallId;
		assert.equal(sessionParsed.nextCommands.includes(`pibo debug telemetry turn ${turnId}`), true);
		assert.equal(sessionParsed.nextCommands.includes(`pibo debug telemetry provider ${providerRequestId}`), true);
		assert.equal(sessionParsed.nextCommands.includes(`pibo debug telemetry tool ${toolCallId}`), true);

		const turn = await execPibo(cwd, ["debug", "telemetry", "turn", turnId]);
		assert.match(turn.stdout, /tool_args\topen/);
		assert.match(turn.stdout, new RegExp(`pibo debug telemetry provider ${providerRequestId}`));
		assert.match(turn.stdout, new RegExp(`pibo debug telemetry tool ${toolCallId}`));

		const provider = await execPibo(cwd, ["debug", "telemetry", "provider", providerRequestId, "--json"]);
		const providerParsed = JSON.parse(provider.stdout);
		assert.equal(providerParsed.available, true);
		assert.equal(providerParsed.request.providerRequestId, providerRequestId);
		assert.equal(providerParsed.request.rawEventCount, 3);
		assert.equal(providerParsed.nextCommands.includes(`pibo debug telemetry provider ${providerRequestId} events --limit 20`), true);

		const tool = await execPibo(cwd, ["debug", "telemetry", "tool", toolCallId, "--json"]);
		const toolParsed = JSON.parse(tool.stdout);
		assert.equal(toolParsed.available, true);
		assert.equal(toolParsed.noExecutionStart, true);
		assert.equal(Object.hasOwn(toolParsed.tool, "args"), false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("telemetry CLI bounded-output validation omits full payloads, full tool args, and reports cursors/unavailable previews", async () => {
	const cwd = await makeTelemetryFixtureCwd();
	try {
		const commands = [
			["debug", "telemetry", "sessions", "--active"],
			["debug", "telemetry", "session", telemetryValidationFixtureIds.stuck.piboSessionId],
			["debug", "telemetry", "turn", telemetryValidationFixtureIds.stuck.turnId, "--events"],
			["debug", "telemetry", "provider", telemetryValidationFixtureIds.stuck.providerRequestId],
			["debug", "telemetry", "provider", telemetryValidationFixtureIds.stuck.providerRequestId, "events", "--limit", "1", "--fields", "toolName,itemId,status"],
			["debug", "telemetry", "tool", telemetryValidationFixtureIds.stuck.toolCallId],
			["debug", "telemetry", "stale", "--limit", "5"],
			["debug", "telemetry", "stats"],
		];
		for (const command of commands) {
			const result = await execPibo(cwd, command);
			assertSafeTelemetryOutput(result.stdout);
		}

		const eventsJson = await execPibo(cwd, ["debug", "telemetry", "provider", telemetryValidationFixtureIds.stuck.providerRequestId, "events", "--limit", "1", "--json"]);
		const eventsParsed = JSON.parse(eventsJson.stdout);
		assert.equal(eventsParsed.available, true);
		assert.equal(eventsParsed.limit, 1);
		assert.equal(eventsParsed.page.truncated, true);
		assert.equal(typeof eventsParsed.page.nextAfterSequence, "number");

		const payload = await execPibo(cwd, ["debug", "telemetry", "provider", telemetryValidationFixtureIds.stuck.providerRequestId, "payload", telemetryValidationFixtureIds.missingPreviewRef, "--json"]);
		const payloadParsed = JSON.parse(payload.stdout);
		assert.equal(payloadParsed.preview.status, "disabled");
		assert.equal(payloadParsed.preview.reason, "preview_capture_disabled");

		const missing = await execPibo(cwd, ["debug", "telemetry", "session", telemetryValidationFixtureIds.noTelemetrySessionId, "--json"]);
		const missingParsed = JSON.parse(missing.stdout);
		assert.equal(missingParsed.available, false);
		assert.equal(missingParsed.reason, "not_found");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

async function makeTelemetryFixtureCwd() {
	const cwd = join(tmpdir(), `pibo-telemetry-validation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(join(cwd, ".pibo"), { recursive: true });
	const data = new PiboDataStore(join(cwd, ".pibo", "pibo.sqlite"));
	try {
		seedTelemetryValidationFixtures(data.telemetry);
	} finally {
		data.close();
	}
	return cwd;
}

function readTelemetryTables(store) {
	return {
		turns: store.db.prepare("SELECT * FROM telemetry_turns").all(),
		phases: store.db.prepare("SELECT * FROM telemetry_phases").all(),
		providerRequests: store.db.prepare("SELECT * FROM telemetry_provider_requests").all(),
		providerEvents: store.db.prepare("SELECT * FROM telemetry_provider_events").all(),
		toolCalls: store.db.prepare("SELECT * FROM telemetry_tool_calls").all(),
	};
}

function assertSafeTelemetryOutput(output) {
	assert.equal(output.includes(telemetryValidationFixtureSecrets.providerBody), false);
	assert.equal(output.includes(telemetryValidationFixtureSecrets.toolArguments), false);
	assert.equal(output.includes(telemetryValidationFixtureSecrets.normalizedPayload), false);
	assert.doesNotMatch(output, /FAKE_PROVIDER_BODY_DO_NOT_STORE/);
	assert.doesNotMatch(output, /FAKE_TOOL_ARGUMENTS_DO_NOT_STORE/);
	assert.doesNotMatch(output, /FAKE_NORMALIZED_EVENT_PAYLOAD_DO_NOT_STORE/);
}
