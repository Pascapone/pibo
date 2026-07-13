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

function createChannelContext() {
	const listeners = new Set();
	return {
		createSession() {
			return { id: "ps_workflow_agent" };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async emit(event) {
			if (event.type === "message") {
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "planning" });
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "final workflow output" });
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
