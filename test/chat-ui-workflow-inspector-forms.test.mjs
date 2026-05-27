import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowInspectorFormScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			applyWorkflowEdgeInspectorForm,
			applyWorkflowNodeInspectorForm,
			createWorkflowEdgeInspectorFormState,
			createWorkflowNodeInspectorFormState,
			readWorkflowGlobalStatePaths,
			sanitizeWorkflowStatePathInput,
			workflowNodeStateAccessChanged,
			workflowStatePathOptions,
		} from "./src/apps/chat-ui/src/workflows/workflow-inspector-forms.ts";

		const definition = {
			state: {
				global: {
					projectGoal: { schema: { type: "string" } },
					reviewScore: { schema: { type: "number" } },
				},
			},
			nodes: {
				agent: {
					kind: "agent",
					label: "Agent",
					description: "Draft agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "old-profile" },
					promptTemplate: "Old prompt",
					promptBuilder: { kind: "promptBuilder", id: "asset" },
					input: { kind: "text", description: "Input" },
					output: { kind: "json", description: "Output", schema: { type: "object" } },
					state: { reads: ["global.projectGoal"], writes: ["local.draft"] },
				},
				human: {
					kind: "human",
					prompt: "Review",
					schema: { type: "object", properties: { approved: { type: "boolean" } } },
					actions: [{ id: "approve", kind: "primary" }],
					timeout: { kind: "minutes", value: 15 },
				},
			},
			edges: {
				bridge: {
					from: { nodeId: "agent", portId: "out" },
					to: { nodeId: "human", portId: "in" },
					kind: "control",
					guard: { handler: "allow", priority: 3, params: { mode: "safe" } },
					adapter: {
						kind: "edgeAdapter",
						output: { kind: "json", schema: { type: "object" } },
						transform: { kind: "adapter", language: "typescript", id: "json-to-human", params: { compact: true } },
					},
					state: { reads: ["edge.payload"], writes: ["global.reviewScore"] },
				},
			},
		};

		assert.deepEqual(readWorkflowGlobalStatePaths(definition), ["projectGoal", "reviewScore"]);
		assert.equal(sanitizeWorkflowStatePathInput(" ..project goal..notes.. "), "projectgoal.notes");
		assert.deepEqual(workflowStatePathOptions(definition, "global", ["global.custom", "local.draft"]), ["custom", "projectGoal", "reviewScore"]);

		const agentForm = createWorkflowNodeInspectorFormState(definition.nodes.agent);
		assert.equal(agentForm.inputKind, "text");
		assert.equal(agentForm.outputKind, "json");
		assert.deepEqual(agentForm.stateAccess.reads, ["global.projectGoal"]);
		assert.equal(agentForm.profileId, "old-profile");

		const updatedAgentForm = {
			...agentForm,
			label: "  Updated agent  ",
			description: "",
			inputKind: "none",
			outputKind: "json",
			outputDescription: "Structured answer",
			outputSchemaText: '{"type":"object","properties":{"answer":{"type":"string"}}}',
			stateAccess: { ...agentForm.stateAccess, reads: ["global.projectGoal"], writes: ["global.reviewScore"] },
			profileId: " new-profile ",
			promptTemplate: "New prompt",
		};
		assert.equal(workflowNodeStateAccessChanged(definition.nodes.agent, updatedAgentForm), true);
		const withAgent = applyWorkflowNodeInspectorForm(definition, "agent", updatedAgentForm);
		assert.equal(withAgent.nodes.agent.label, "Updated agent");
		assert.equal(withAgent.nodes.agent.description, undefined);
		assert.equal(withAgent.nodes.agent.input, undefined);
		assert.deepEqual(withAgent.nodes.agent.output, {
			kind: "json",
			description: "Structured answer",
			schema: { type: "object", properties: { answer: { type: "string" } } },
		});
		assert.deepEqual(withAgent.nodes.agent.profile, { kind: "fixed", id: "new-profile" });
		assert.equal(withAgent.nodes.agent.promptTemplate, "New prompt");
		assert.equal(withAgent.nodes.agent.promptBuilder, undefined);
		assert.deepEqual(withAgent.nodes.agent.state, { reads: ["global.projectGoal"], writes: ["global.reviewScore"] });
		assert.equal(applyWorkflowNodeInspectorForm(definition, "missing", updatedAgentForm), definition);

		const humanForm = createWorkflowNodeInspectorFormState(definition.nodes.human);
		assert.deepEqual(humanForm.humanActionRefs, [{ id: "approve", kind: "primary" }]);
		const withHuman = applyWorkflowNodeInspectorForm(definition, "human", {
			...humanForm,
			humanPrompt: "",
			humanSchemaText: "",
			humanActionRefs: [],
			humanTimeoutKind: "seconds",
			humanTimeoutValue: "30",
		});
		assert.equal(withHuman.nodes.human.prompt, undefined);
		assert.equal(withHuman.nodes.human.schema, undefined);
		assert.equal(withHuman.nodes.human.actions, undefined);
		assert.deepEqual(withHuman.nodes.human.timeout, { kind: "seconds", value: 30 });

		const edgeForm = createWorkflowEdgeInspectorFormState(definition.edges.bridge, ["agent", "human"]);
		assert.deepEqual(edgeForm, {
			sourceNodeId: "agent",
			sourcePortId: "out",
			targetNodeId: "human",
			targetPortId: "in",
			kind: "control",
			guardHandler: "allow",
			guardPriority: "3",
			guardParamsText: JSON.stringify({ mode: "safe" }, null, 2),
			adapterRef: "json-to-human",
			adapterParamsText: JSON.stringify({ compact: true }, null, 2),
			stateAccess: { reads: ["edge.payload"], writes: ["global.reviewScore"], readScope: "edge", readPath: "payload", writeScope: "global", writePath: "reviewScore" },
		});

		const withEdge = applyWorkflowEdgeInspectorForm(definition, "bridge", {
			...edgeForm,
			sourcePortId: "",
			targetPortId: "result",
			kind: "data",
			guardHandler: "",
			adapterRef: "text-to-json",
			adapterParamsText: '{"strict":true}',
			stateAccess: { ...edgeForm.stateAccess, reads: [], writes: [] },
		});
		assert.deepEqual(withEdge.edges.bridge.from, { nodeId: "agent" });
		assert.deepEqual(withEdge.edges.bridge.to, { nodeId: "human", portId: "result" });
		assert.equal(withEdge.edges.bridge.kind, "data");
		assert.equal(withEdge.edges.bridge.guard, undefined);
		assert.equal(withEdge.edges.bridge.state, undefined);
		assert.deepEqual(withEdge.edges.bridge.adapter.transform, { kind: "adapter", language: "typescript", id: "text-to-json", params: { strict: true } });
		assert.deepEqual(withEdge.edges.bridge.adapter.output, definition.edges.bridge.adapter.output);
		assert.equal(applyWorkflowEdgeInspectorForm(definition, "missing", edgeForm), definition);
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow inspector form helpers round-trip node and edge edits", async () => {
	const { stdout, stderr } = await runWorkflowInspectorFormScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
