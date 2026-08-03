import assert from "node:assert/strict";
import test from "node:test";
import { runWorkflowManualTextTrigger } from "../dist/apps/chat/workflow-manual-trigger-runtime.js";

const definition = {
	id: "manual-recovery",
	version: "1.0.0",
	nodes: {
		trigger: { kind: "trigger", trigger: { kind: "manual" }, output: { kind: "text" } },
		agent: {
			kind: "agent",
			profile: { kind: "fixed", id: "base" },
			input: { kind: "text" },
			output: { kind: "text" },
			promptTemplate: "Handle {{input}}",
		},
	},
	edges: {
		toAgent: { from: { nodeId: "trigger" }, to: { nodeId: "agent" } },
	},
};

function createChannelContext(outputs = {}) {
	const listeners = new Set();
	const sessionNodes = new Map();
	return {
		createSession(input) {
			const nodeId = input.metadata.workflowNodeId;
			const session = { id: `ps_workflow_${nodeId}` };
			sessionNodes.set(session.id, nodeId);
			return session;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async emit(event) {
			if (event.type === "message") {
				const nodeId = sessionNodes.get(event.piboSessionId);
				const messages = outputs[nodeId] ?? ["planning", "final workflow output"];
				queueMicrotask(() => {
					for (const listener of listeners) {
						for (const text of messages) listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "message_queued", piboSessionId: event.piboSessionId };
		},
	};
}

test("manual workflow agent nodes wait for message_finished and use the final assistant message", async () => {
	const result = await runWorkflowManualTextTrigger({
		definition,
		triggerNodeId: "trigger",
		input: "input",
		channelContext: createChannelContext(),
		channel: "chat-web",
		defaultWorkspace: process.cwd(),
		resolveProfile: (profileId) => profileId === "base" ? "base" : undefined,
	});

	assert.equal(result.ok, true);
	assert.equal(result.output, "final workflow output");
	assert.equal(result.nodeAttempts.at(-1).output, "final workflow output");
});

test("manual workflow LangGraph preserves deterministic fan-out execution and results", async () => {
	const fanOutDefinition = {
		...definition,
		nodes: {
			...definition.nodes,
			left: { ...definition.nodes.agent },
			right: { ...definition.nodes.agent },
		},
		edges: {
			left: { from: { nodeId: "trigger" }, to: { nodeId: "left" } },
			right: { from: { nodeId: "trigger" }, to: { nodeId: "right" } },
		},
	};
	const result = await runWorkflowManualTextTrigger({
		definition: fanOutDefinition,
		triggerNodeId: "trigger",
		input: "input",
		channelContext: createChannelContext({ left: ["left output"], right: ["right output"] }),
		channel: "chat-web",
		defaultWorkspace: process.cwd(),
		resolveProfile: (profileId) => profileId === "base" ? "base" : undefined,
	});

	assert.equal(result.ok, true);
	assert.deepEqual(result.nodeAttempts.map((attempt) => attempt.nodeId), ["trigger", "left", "right"]);
	assert.equal(result.output, "right output");
	assert.deepEqual(result.edgeTransfers.map((transfer) => transfer.edgeId), ["left", "right"]);
});

test("manual workflow LangGraph keeps the existing unsupported-join failure", async () => {
	const joinDefinition = {
		...definition,
		nodes: {
			...definition.nodes,
			left: { ...definition.nodes.agent },
			right: { ...definition.nodes.agent },
			join: { ...definition.nodes.agent },
		},
		edges: {
			triggerLeft: { from: { nodeId: "trigger" }, to: { nodeId: "left" } },
			triggerRight: { from: { nodeId: "trigger" }, to: { nodeId: "right" } },
			leftJoin: { from: { nodeId: "left" }, to: { nodeId: "join" } },
			rightJoin: { from: { nodeId: "right" }, to: { nodeId: "join" } },
		},
	};
	const result = await runWorkflowManualTextTrigger({
		definition: joinDefinition,
		triggerNodeId: "trigger",
		input: "input",
		channelContext: createChannelContext({ left: ["left output"], right: ["right output"], join: ["join output"] }),
		channel: "chat-web",
		defaultWorkspace: process.cwd(),
		resolveProfile: (profileId) => profileId === "base" ? "base" : undefined,
	});

	assert.equal(result.ok, false);
	assert.equal(result.error.code, "WorkflowRuntimeError.joinUnsupported");
	assert.deepEqual(result.nodeAttempts.map((attempt) => attempt.nodeId), ["trigger", "left", "right", "join"]);
});
