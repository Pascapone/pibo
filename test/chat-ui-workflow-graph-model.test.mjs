import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowGraphModelScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			addWorkflowGraphEdge,
			addWorkflowGraphNodeDefinition,
			createWorkflowGraphProjection,
			deleteWorkflowGraphEdge,
			deleteWorkflowGraphNode,
			nextGraphNodePosition,
			nextWorkflowEdgeId,
			nextWorkflowNodeId,
			projectionHasElement,
			readEdgeEndpointNodeId,
			readWorkflowEdgeDefinitions,
			readWorkflowEdgeRoutes,
			readWorkflowNodeDefinitions,
			readWorkflowPositions,
			workflowInitialNodeIds,
			workflowNodeKind,
			workflowNodeLabel,
			writeWorkflowGraphLayout,
			writeWorkflowGraphPositions,
		} from "./src/apps/chat-ui/src/workflows/workflow-graph-model.ts";

		const definition = {
			initial: ["agent_1", 42, "adapter_1"],
			nodes: {
				agent_1: { kind: "agent", label: "  Agent Start  " },
				adapter_1: { kind: "adapter", ui: { position: { x: 310, y: 90 } } },
				human_1: { kind: "human" },
				ignored: "not an object",
			},
			edges: {
				edge_valid: { from: { nodeId: "agent_1" }, to: { nodeId: "adapter_1" }, kind: "control" },
				edge_default_kind: { from: { nodeId: "adapter_1" }, to: { nodeId: "human_1" } },
				edge_missing_target: { from: { nodeId: "human_1" }, to: { nodeId: "missing" } },
				ignored: null,
			},
			ui: {
				positions: {
					agent_1: { x: 100, y: 200 },
					invalid: { x: "bad", y: 0 },
				},
				edgeRoutes: {
					edge_valid: { centerX: 222 },
					edge_default_kind: { centerY: 333 },
					invalid: { centerX: "bad" },
				},
			},
		};
		const diagnostics = [
			{ code: "direct", message: "direct", severity: "error", nodeId: "agent_1" },
			{ code: "path", message: "path", severity: "warning", path: "$.nodes.agent_1.input" },
			{ code: "other", message: "other", severity: "warning", path: "$.nodes.adapter_1" },
		];

		const projection = createWorkflowGraphProjection(definition, diagnostics);
		assert.deepEqual(projection.nodes.map((node) => node.id), ["agent_1", "adapter_1", "human_1"]);
		assert.equal(projection.usedAutoLayout, true);
		assert.equal(projection.missingPositionCount, 1);
		assert.deepEqual(projection.nodes[0].position, { x: 100, y: 200 });
		assert.deepEqual(projection.nodes[1].position, { x: 310, y: 90 });
		assert.deepEqual(projection.nodes[2].position, { x: 80, y: 230 });
		assert.equal(projection.nodes[0].data.label, "Agent Start");
		assert.equal(projection.nodes[2].data.label, "Human human_1");
		assert.equal(projection.nodes[0].data.validationCount, 2);
		assert.equal(projection.nodes[1].data.validationCount, 1);
		assert.equal(projection.nodes[0].data.isInitial, true);
		assert.equal(projection.nodes[2].data.isInitial, false);

		assert.deepEqual(projection.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label, edge.type]), [
			["edge_valid", "agent_1", "adapter_1", "control", "workflowEdge"],
			["edge_default_kind", "adapter_1", "human_1", "data", "workflowEdge"],
		]);
		assert.deepEqual(projection.edges[0].data.route, { centerX: 222 });
		assert.deepEqual(projection.edges[1].data.route, { centerY: 333 });
		assert.equal(projectionHasElement(projection, { type: "node", id: "human_1" }), true);
		assert.equal(projectionHasElement(projection, { type: "edge", id: "edge_missing_target" }), false);

		assert.deepEqual(Object.keys(readWorkflowNodeDefinitions(definition)), ["agent_1", "adapter_1", "human_1"]);
		assert.deepEqual(Object.keys(readWorkflowEdgeDefinitions(definition)), ["edge_valid", "edge_default_kind", "edge_missing_target"]);
		assert.deepEqual(readWorkflowPositions(definition), { agent_1: { x: 100, y: 200 } });
		assert.deepEqual(readWorkflowEdgeRoutes(definition), { edge_valid: { centerX: 222 }, edge_default_kind: { centerY: 333 } });
		assert.deepEqual(workflowInitialNodeIds(definition), ["agent_1", "adapter_1"]);
		assert.equal(workflowNodeKind({}), "node");
		assert.equal(workflowNodeLabel("fallback", {}), "Node fallback");
		assert.equal(readEdgeEndpointNodeId({ nodeId: "  human_1  " }), "human_1");
		assert.deepEqual(nextGraphNodePosition(projection.nodes), { x: 80, y: 230 });

		assert.equal(nextWorkflowNodeId({ nodes: { agent: {}, agent_2: {} } }, "agent"), "agent_3");
		assert.equal(nextWorkflowNodeId({ nodes: { agent_2: {} } }, "agent"), "agent");
		assert.equal(nextWorkflowEdgeId({ edges: {} }, "source.one", "target/two"), "edge_source-one_to_target-two");
		assert.equal(nextWorkflowEdgeId({ edges: { "edge_a_to_b": {}, "edge_a_to_b_2": {} } }, "a", "b"), "edge_a_to_b_3");

		const addedFirstNode = addWorkflowGraphNodeDefinition(
			{ nodes: null, edges: "invalid", ui: { theme: "dark" } },
			"agent",
			{ x: 20, y: 30 },
			{ kind: "agent", label: "Agent" },
		);
		assert.deepEqual(addedFirstNode.nodes, { agent: { kind: "agent", label: "Agent" } });
		assert.deepEqual(addedFirstNode.edges, {});
		assert.equal(addedFirstNode.initial, "agent");
		assert.deepEqual(addedFirstNode.ui, { theme: "dark", layout: "manual", positions: { agent: { x: 20, y: 30 } } });

		const addedSecondNode = addWorkflowGraphNodeDefinition(
			addedFirstNode,
			"human",
			{ x: 40, y: 50 },
			{ kind: "human" },
		);
		assert.equal(addedSecondNode.initial, "agent");
		assert.deepEqual(readWorkflowPositions(addedSecondNode), { agent: { x: 20, y: 30 }, human: { x: 40, y: 50 } });

		const withEdge = addWorkflowGraphEdge(addedSecondNode, "edge_agent_to_human", "agent", "human");
		assert.deepEqual(withEdge.edges.edge_agent_to_human, {
			id: "edge_agent_to_human",
			from: { nodeId: "agent" },
			to: { nodeId: "human" },
			kind: "data",
		});
		const routedEdge = writeWorkflowGraphLayout(withEdge, readWorkflowPositions(withEdge), { edge_agent_to_human: { centerX: 180 } });
		const deletedEdge = deleteWorkflowGraphEdge(routedEdge, "edge_agent_to_human");
		assert.deepEqual(deletedEdge.edges, {});
		assert.deepEqual(readWorkflowEdgeRoutes(deletedEdge), {});

		const multiInitialDefinition = {
			initial: ["agent", "adapter", "missing"],
			nodes: {
				agent: { kind: "agent" },
				adapter: { kind: "adapter" },
				human: { kind: "human" },
			},
			edges: {
				kept: { from: { nodeId: "adapter" }, to: { nodeId: "human" } },
				removed_from: { from: { nodeId: "agent" }, to: { nodeId: "adapter" } },
				removed_to: { from: { nodeId: "human" }, to: { nodeId: "agent" } },
			},
			ui: {
				positions: { agent: { x: 1, y: 2 }, adapter: { x: 3, y: 4 }, human: { x: 5, y: 6 } },
				edgeRoutes: { kept: { centerX: 44 }, removed_from: { centerX: 55 }, removed_to: { centerX: 66 } },
			},
		};
		const deletedAgent = deleteWorkflowGraphNode(multiInitialDefinition, "agent");
		assert.deepEqual(Object.keys(deletedAgent.nodes), ["adapter", "human"]);
		assert.deepEqual(Object.keys(deletedAgent.edges), ["kept"]);
		assert.deepEqual(deletedAgent.initial, ["adapter", "missing"]);
		assert.deepEqual(readWorkflowPositions(deletedAgent), { adapter: { x: 3, y: 4 }, human: { x: 5, y: 6 } });
		assert.deepEqual(readWorkflowEdgeRoutes(deletedAgent), { kept: { centerX: 44 } });
		assert.equal(deleteWorkflowGraphNode({ initial: "only", nodes: { only: {} }, edges: {}, ui: { positions: { only: { x: 1, y: 1 } } } }, "only").initial, undefined);

		assert.deepEqual(writeWorkflowGraphPositions({ ui: { color: "blue", layout: "auto" } }, { node: { x: 7, y: 8 } }).ui, {
			color: "blue",
			layout: "manual",
			positions: { node: { x: 7, y: 8 } },
		});
		assert.deepEqual(writeWorkflowGraphLayout({ ui: { color: "blue", layout: "auto" } }, { node: { x: 7, y: 8 } }, { edge: { centerX: 99 } }).ui, {
			color: "blue",
			layout: "manual",
			positions: { node: { x: 7, y: 8 } },
			edgeRoutes: { edge: { centerX: 99 } },
		});
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow graph model projects nodes, edges, positions, and diagnostics", async () => {
	const { stdout, stderr } = await runWorkflowGraphModelScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
