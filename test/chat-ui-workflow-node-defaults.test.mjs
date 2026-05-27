import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowNodeDefaultsScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			DEFAULT_AGENT_PROMPT_TEMPLATE,
			addWorkflowGraphAdapterNode,
			addWorkflowGraphAgentNode,
			addWorkflowGraphHumanNode,
			addWorkflowGraphWorkflowNode,
			createDefaultAdapterNodeDefinition,
			createDefaultAgentNodeDefinition,
			createDefaultHumanNodeDefinition,
			createDefaultWorkflowNodeDefinition,
		} from "./src/apps/chat-ui/src/workflows/workflow-node-defaults.ts";

		assert.equal(DEFAULT_AGENT_PROMPT_TEMPLATE, "Use the workflow input to produce a concise answer.\\n\\n{{input}}");
		assert.deepEqual(createDefaultAgentNodeDefinition("agent_1", ""), {
			kind: "agent",
			runtime: "pibo",
			label: "Agent agent_1",
			profile: { kind: "fixed", id: "base" },
			promptTemplate: DEFAULT_AGENT_PROMPT_TEMPLATE,
			metadata: { sessionOverrides: { prompt: true } },
		});
		assert.deepEqual(createDefaultAgentNodeDefinition("agent_2", "custom-profile").profile, { kind: "fixed", id: "custom-profile" });

		const workflowOption = { id: "workflow_child", version: "3" };
		assert.deepEqual(createDefaultWorkflowNodeDefinition("workflow_1", workflowOption), {
			kind: "workflow",
			label: "Workflow workflow_1",
			workflowId: "workflow_child",
			workflowVersion: "3",
		});

		const inputPort = { kind: "json", schema: { type: "object", properties: { value: { type: "string" } } } };
		const outputPort = { kind: "text", description: "adapted" };
		const adapterNode = createDefaultAdapterNodeDefinition("adapter_1", "formatText", inputPort, outputPort);
		assert.deepEqual(adapterNode, {
			kind: "adapter",
			label: "Adapter adapter_1",
			mode: "deterministic",
			handler: { kind: "adapter", language: "typescript", id: "formatText" },
			input: inputPort,
			output: outputPort,
		});
		assert.notEqual(adapterNode.input, inputPort);
		assert.notEqual(adapterNode.output, outputPort);
		inputPort.schema.properties.value.type = "number";
		assert.equal(adapterNode.input.schema.properties.value.type, "string");
		assert.deepEqual(createDefaultAdapterNodeDefinition("adapter_2", "plainText").input, { kind: "text" });

		const humanNode = createDefaultHumanNodeDefinition("human_1", { id: "approve", kind: "approval" });
		assert.equal(humanNode.kind, "human");
		assert.equal(humanNode.label, "Human human_1");
		assert.deepEqual(humanNode.input, { kind: "text", description: "Context for human review." });
		assert.equal(humanNode.output.kind, "json");
		assert.equal(humanNode.output.description, "Human action result.");
		const defaultJsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };
		assert.deepEqual(humanNode.output.schema, defaultJsonSchema);
		assert.deepEqual(humanNode.schema, defaultJsonSchema);
		assert.deepEqual(humanNode.actions, [{ id: "approve", kind: "approval" }]);
		assert.deepEqual(humanNode.timeout, { kind: "minutes", value: 60 });

		const baseDefinition = { nodes: {}, ui: { existing: true } };
		const withAgent = addWorkflowGraphAgentNode(baseDefinition, "agent_1", { x: 10, y: 20 }, "profile-a");
		assert.deepEqual(withAgent.nodes.agent_1, createDefaultAgentNodeDefinition("agent_1", "profile-a"));
		assert.equal(withAgent.initial, "agent_1");
		assert.deepEqual(withAgent.ui.positions.agent_1, { x: 10, y: 20 });

		const withWorkflow = addWorkflowGraphWorkflowNode(withAgent, "workflow_1", { x: 30, y: 40 }, workflowOption);
		const withAdapter = addWorkflowGraphAdapterNode(withWorkflow, "adapter_1", { x: 50, y: 60 }, "formatText");
		const withHuman = addWorkflowGraphHumanNode(withAdapter, "human_1", { x: 70, y: 80 }, { id: "approve" });
		assert.deepEqual(Object.keys(withHuman.nodes), ["agent_1", "workflow_1", "adapter_1", "human_1"]);
		assert.equal(withHuman.initial, "agent_1");
		assert.deepEqual(withHuman.nodes.workflow_1, createDefaultWorkflowNodeDefinition("workflow_1", workflowOption));
		assert.deepEqual(withHuman.nodes.adapter_1, createDefaultAdapterNodeDefinition("adapter_1", "formatText"));
		assert.deepEqual(withHuman.nodes.human_1.actions, [{ id: "approve" }]);
		assert.deepEqual(withHuman.ui.positions, {
			agent_1: { x: 10, y: 20 },
			workflow_1: { x: 30, y: 40 },
			adapter_1: { x: 50, y: 60 },
			human_1: { x: 70, y: 80 },
		});
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow node defaults create inserted graph node definitions", async () => {
	const { stdout, stderr } = await runWorkflowNodeDefaultsScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
