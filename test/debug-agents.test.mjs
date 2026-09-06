import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { inspectDebugAgentList, inspectDebugAgentObservations, runDebugAgentsCli } from "../dist/debug/agents.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-debug-agents-"));
	const path = join(root, "pibo.sqlite");
	const dataStore = new PiboDataStore(path, { payloadRootDir: join(root, "payloads") });
	const sessions = new PiboDataSessionStore(dataStore);
	const parent = sessions.create({ id: "ps_parent", channel: "test", kind: "chat", profile: "parent" });
	const explorer = sessions.create({
		id: "ps_explorer",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "explorer-profile",
		parentId: parent.id,
		metadata: { subagentName: "explorer", threadKey: "research", subagentToolName: "pibo_agents_send_message" },
	});
	const worker = sessions.create({
		id: "ps_worker",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "worker-profile",
		parentId: parent.id,
		metadata: { subagentName: "worker", threadKey: "implementation", subagentToolName: "pibo_agents_send_message", agentStatus: "killed" },
	});
	const ingest = new ChatDataIngestService(dataStore);
	ingest.ingestOutputEvent({
		session: explorer,
		roomId: "room_test",
		createdAt: "2026-08-23T12:00:00.000Z",
		event: { type: "assistant_message", piboSessionId: explorer.id, eventId: "event_explorer", text: "Found the routing boundary" },
	});
	ingest.ingestOutputEvent({
		session: explorer,
		roomId: "room_test",
		createdAt: "2026-08-23T12:00:01.000Z",
		event: { type: "message_finished", piboSessionId: explorer.id, eventId: "event_explorer" },
	});
	ingest.ingestOutputEvent({
		session: worker,
		roomId: "room_test",
		createdAt: "2026-08-23T12:01:00.000Z",
		event: { type: "tool_call", piboSessionId: worker.id, eventId: "event_worker", toolCallId: "tool_worker", toolName: "bash", args: { command: "npm test" }, argsComplete: true },
	});
	ingest.ingestOutputEvent({
		session: worker,
		roomId: "room_test",
		createdAt: "2026-08-23T12:01:01.000Z",
		event: { type: "tool_execution_started", piboSessionId: worker.id, eventId: "event_worker", toolCallId: "tool_worker", toolName: "bash", args: { command: "npm test" } },
	});
	ingest.ingestOutputEvent({
		session: worker,
		roomId: "room_test",
		createdAt: "2026-08-23T12:01:02.000Z",
		event: { type: "tool_execution_updated", piboSessionId: worker.id, eventId: "event_worker", toolCallId: "tool_worker", toolName: "bash", partialResult: { delta: "tests running" } },
	});
	ingest.ingestOutputEvent({
		session: worker,
		roomId: "room_test",
		createdAt: "2026-08-23T12:01:03.000Z",
		event: { type: "tool_execution_finished", piboSessionId: worker.id, eventId: "event_worker", toolCallId: "tool_worker", toolName: "bash", result: { status: "completed", command: "npm test", output: "x".repeat(5_000) }, isError: false },
	});
	ingest.ingestOutputEvent({
		session: explorer,
		roomId: "room_test",
		createdAt: "2026-08-23T12:01:30.000Z",
		event: { type: "assistant_message", piboSessionId: explorer.id, eventId: "event_explorer_second", text: "Confirmed the shared query boundary" },
	});
	ingest.ingestOutputEvent({
		session: explorer,
		roomId: "room_test",
		createdAt: "2026-08-23T12:02:00.000Z",
		event: { type: "assistant_delta", piboSessionId: explorer.id, eventId: "event_delta", text: `large-prefix-${"é".repeat(20_000)}` },
	});
	return {
		root,
		dataStore,
		store: { name: "pibo-data", path, exists: true, description: "test" },
	};
}

test("debug delegated-agent inspection lists owned children and applies exact observation filters", () => {
	const fixture = createFixture();
	try {
		const agents = inspectDebugAgentList("ps_parent", fixture.store);
		assert.deepEqual(agents.map((agent) => [agent.agentId, agent.name, agent.status]).sort(), [
			["ps_explorer", "explorer", "idle"],
			["ps_worker", "worker", "killed"],
		]);
		assert.deepEqual(inspectDebugAgentList("ps_parent", fixture.store, { status: "killed" }).map((agent) => agent.agentId), ["ps_worker"]);

		const defaults = inspectDebugAgentObservations("ps_parent", fixture.store);
		assert.deepEqual(defaults.observations.map((observation) => observation.eventType), ["assistant_message", "assistant_message"]);
		assert.deepEqual(defaults.observations.map((observation) => observation.text), [
			"Confirmed the shared query boundary",
			"Found the routing boundary",
		]);
		assert.deepEqual(defaults.filters.eventTypes, ["assistant_message"]);
		assert.equal(defaults.filters.cursorMode, "history");
		assert.equal(defaults.filters.order, "desc");
		assert.equal(defaults.filters.limit, 20);
		assert.equal(defaults.filters.includeTools, false);
		assert.equal(defaults.filters.toolDetail, "summary");

		const withTools = inspectDebugAgentObservations("ps_parent", fixture.store, { includeTools: true, order: "asc", limit: 50 });
		assert.deepEqual(withTools.observations.map((observation) => observation.eventType), [
			"assistant_message",
			"tool_call",
			"tool_execution_finished",
			"assistant_message",
		]);
		const summarizedTool = withTools.observations.find((observation) => observation.eventType === "tool_execution_finished");
		assert.match(summarizedTool.text, /"outputBytes":5000/);
		assert.equal(Buffer.byteLength(summarizedTool.text, "utf8") <= 768, true);
		assert.deepEqual(
			inspectDebugAgentObservations("ps_parent", fixture.store, { toolCallIds: ["tool_worker"], order: "asc" })
				.observations.map((observation) => observation.eventType),
			["tool_call", "tool_execution_finished"],
		);
		assert.deepEqual(
			inspectDebugAgentObservations("ps_parent", fixture.store, { kinds: ["tool"], roles: ["tool"], order: "asc", limit: 50 })
				.observations.map((observation) => observation.eventType),
			["tool_call", "tool_execution_started", "tool_execution_updated", "tool_execution_finished"],
		);

		const result = inspectDebugAgentObservations("ps_parent", fixture.store, {
			agentIds: ["ps_worker"],
			names: ["worker"],
			threadKeys: ["implementation"],
			eventTypes: ["tool_call"],
			kinds: ["tool"],
			since: "2026-08-23T12:00:30.000Z",
			until: "2026-08-23T12:01:30.000Z",
			textContains: "NPM TEST",
			order: "asc",
			limit: 10,
			includeDetails: true,
		});
		assert.equal(result.observations.length, 1);
		assert.equal(result.observations[0].agentId, "ps_worker");
		assert.equal(result.observations[0].toolName, "bash");
		assert.equal(result.observations[0].details.toolCallId, "tool_worker");
		assert.equal(result.nextAfterSequence, result.observations[0].streamId);
		assert.equal(inspectDebugAgentObservations("ps_parent", fixture.store, { afterSequence: result.nextAfterSequence }).observations.length, 1);
		assert.equal(inspectDebugAgentObservations("ps_parent", fixture.store, {
			textRegex: "^Confirmed the [a-z]+ query boundary$",
		}).observations.length, 1);
		assert.equal(inspectDebugAgentObservations("ps_parent", fixture.store, {
			textContains: "SHARED",
			textRegex: "^Confirmed",
		}).observations.length, 1);
		assert.throws(
			() => inspectDebugAgentObservations("ps_parent", fixture.store, { textRegex: "(" }),
			/Agent observation textRegex is invalid: unclosed group\./,
		);

		const firstPage = inspectDebugAgentObservations("ps_parent", fixture.store, { afterSequence: 0, order: "desc", limit: 1 });
		const secondPage = inspectDebugAgentObservations("ps_parent", fixture.store, { afterSequence: firstPage.nextAfterSequence, order: "desc", limit: 1 });
		assert.equal(firstPage.observations[0].streamId < secondPage.observations[0].streamId, true);
		assert.equal(firstPage.observations[0].kind, "message");
		assert.equal(firstPage.truncated, true);

		const large = inspectDebugAgentObservations("ps_parent", fixture.store, {
			eventTypes: ["assistant_delta"],
			textContains: "LARGE-PREFIX",
			includeDetails: true,
			limit: 1,
		});
		assert.equal(large.observations[0].kind, "message");
		assert.equal(Buffer.byteLength(large.observations[0].text, "utf8") <= 4 * 1024, true);
		assert.equal(large.observations[0].text.endsWith("…"), true);
		assert.equal(large.observations[0].details.truncated, true);
		assert.throws(() => inspectDebugAgentObservations("ps_parent", fixture.store, { limit: 0 }), /limit must be an integer from 1 to 200/);
		assert.throws(() => inspectDebugAgentObservations("ps_parent", fixture.store, { since: "2026-08-23" }), /valid ISO-8601 timestamp/);
		assert.throws(
			() => inspectDebugAgentObservations("ps_parent", fixture.store, { agentIds: ["ps_foreign"] }),
			/is not owned/,
		);
	} finally {
		fixture.dataStore.close();
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("debug delegated-agent CLI exposes and executes the shared observation filters", async () => {
	const fixture = createFixture();
	const output = [];
	const originalLog = console.log;
	const originalPiboHome = process.env.PIBO_HOME;
	console.log = (...args) => output.push(args.join(" "));
	process.env.PIBO_HOME = fixture.root;
	try {
		await runDebugAgentsCli(["ps_parent", "observe", "--help"]);
		const help = output.join("\n");
		assert.match(help, /Default: the newest 20 completed assistant messages/);
		assert.match(help, /CLI is stateless history inspection/);
		assert.match(help, /include-tools only for stalls, errors, or targeted diagnosis/);
		assert.match(help, /pages always consume the oldest unseen rows/);
		assert.match(help, /--tool-call-id/);
		assert.match(help, /--include-tools/);
		assert.match(help, /--tool-detail summary\|full/);
		assert.match(help, /--role role/);
		assert.match(help, /--regex pattern/);
		assert.match(help, /case-sensitive bundled rg\/Rust-regex syntax/);
		assert.match(help, /rejects NUL text and literal or escaped NUL patterns/);
		assert.match(help, /requires the optional rg platform binary/);

		output.length = 0;
		await runDebugAgentsCli([
			"ps_parent",
			"observe",
			"--tool-call-id",
			"tool_worker",
			"--role",
			"tool",
			"--regex",
			"(?i)npm [a-z]+",
			"--tool-detail",
			"full",
			"--order",
			"asc",
			"--json",
		]);
		const result = JSON.parse(output.join("\n"));
		assert.deepEqual(result.observations.map((observation) => observation.eventType), ["tool_call", "tool_execution_finished"]);
		assert.equal(result.filters.cursorMode, "history");
		assert.equal(result.filters.includeTools, true);
		assert.equal(result.filters.toolDetail, "full");
		await assert.rejects(
			runDebugAgentsCli(["ps_parent", "list", "--limit", "1"]),
			/Unsupported option for pibo debug agents list/,
		);
	} finally {
		console.log = originalLog;
		if (originalPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = originalPiboHome;
		fixture.dataStore.close();
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
