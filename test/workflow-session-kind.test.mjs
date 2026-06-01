import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionNodes } from "../dist/apps/chat/trace.js";
import {
	PIBO_WORKFLOW_SESSION_KINDS,
	workflowSessionKindFromMetadata,
	withWorkflowSessionKind,
} from "../dist/sessions/workflow-session-kind.js";

function session(id, metadata, parentId) {
	return {
		id,
		piSessionId: `${id}_pi`,
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "default",
		...(parentId ? { parentId } : {}),
		workspace: "/tmp/pibo-workflow-session-kind",
		title: id,
		metadata,
		createdAt: "2026-05-11T10:00:00.000Z",
		updatedAt: "2026-05-11T10:00:00.000Z",
	};
}

test("workflow session kind metadata accepts only the stable V2 enum", () => {
	assert.deepEqual(PIBO_WORKFLOW_SESSION_KINDS, ["main_workflow", "nested_workflow", "agent_node", "subagent"]);
	assert.equal(workflowSessionKindFromMetadata({ workflowSessionKind: "main_workflow" }), "main_workflow");
	assert.equal(workflowSessionKindFromMetadata({ workflowSessionKind: "agent_node" }), "agent_node");
	assert.equal(workflowSessionKindFromMetadata({ workflowSessionKind: "workflow_node" }), undefined);
	assert.deepEqual(withWorkflowSessionKind({ projectId: "prj_1" }, "nested_workflow"), {
		projectId: "prj_1",
		workflowSessionKind: "nested_workflow",
	});
});

test("project sidebar session nodes expose workflow session kind for real Pibo Sessions only", async () => {
	const sessions = [
		session("ps_main", { workflowSessionKind: "main_workflow" }),
		session("ps_nested", { workflowSessionKind: "nested_workflow" }, "ps_main"),
		session("ps_agent", { workflowSessionKind: "agent_node", workflowNodeId: "answer" }, "ps_nested"),
		session("ps_subagent", { workflowSessionKind: "subagent", subagentName: "reviewer" }, "ps_agent"),
	];

	const nodes = await buildSessionNodes(sessions, [], process.cwd(), new Map(), { skipPiMetadataFallback: true });
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0].piboSessionId, "ps_main");
	assert.equal(nodes[0].workflowSessionKind, "main_workflow");
	assert.equal(nodes[0].children[0].workflowSessionKind, "nested_workflow");
	assert.equal(nodes[0].children[0].children[0].workflowSessionKind, "agent_node");
	assert.equal(nodes[0].children[0].children[0].children[0].workflowSessionKind, "subagent");
	assert.deepEqual(flattenSessionIds(nodes), ["ps_main", "ps_nested", "ps_agent", "ps_subagent"]);
});

function flattenSessionIds(nodes) {
	return nodes.flatMap((node) => [node.piboSessionId, ...flattenSessionIds(node.children)]);
}
