import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { inspectDebugAgentList, inspectDebugAgentObservations } from "../dist/debug/agents.js";
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
		assert.equal(inspectDebugAgentObservations("ps_parent", fixture.store, { afterSequence: result.nextAfterSequence }).observations.length, 0);
		assert.throws(
			() => inspectDebugAgentObservations("ps_parent", fixture.store, { agentIds: ["ps_foreign"] }),
			/is not owned/,
		);
	} finally {
		fixture.dataStore.close();
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
