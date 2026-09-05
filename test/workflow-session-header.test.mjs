import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const model = await tsImport("../src/apps/chat-ui/src/workflows/workflow-session-model.tsx", import.meta.url);

test("Workflow headers report canonical run state independently of ordinary Session activity", () => {
	for (const state of ["configured", "pending", "waiting", "completed", "failed", "cancelled"]) {
		const link = { workflowId: "workflow.header", workflowRunId: "wfr_header", state };
		assert.equal(model.createWorkflowHeaderSummary(link, "running").state, state);
		assert.equal(model.createWorkflowHeaderSummary(link, "error").state, state);
	}
});

test("root, nested and agent-node Sessions expose Workflow inspection without inventing linkage for other Sessions", () => {
	for (const workflowSessionKind of ["main_workflow", "nested_workflow", "agent_node"]) {
		assert.equal(model.isWorkflowLinkedSession({ workflowSessionKind }), true);
		assert.equal(model.isWorkflowLinkedSession(undefined, { metadata: { workflowSessionKind } }), true);
	}
	assert.equal(model.isWorkflowLinkedSession({ workflowSessionKind: "subagent" }), false);
	assert.equal(model.isWorkflowLinkedSession(undefined, { metadata: {} }), false);
});
