import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowEdgeAdapterScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			applyWorkflowEdgeAdapterChoice,
			areWorkflowPortsDirectlyCompatible,
			createWorkflowEdgePortDetails,
			insertWorkflowAdapterNodeForEdge,
			readWorkflowEdgeAdapterRef,
		} from "./src/apps/chat-ui/src/workflows/workflow-edge-adapters.ts";

		const jsonSchema = { type: "object", properties: { value: { type: "string" } } };
		const sourcePort = { kind: "json", description: "source", schema: jsonSchema };
		const targetPort = { kind: "json", description: "target", schema: { type: "object", properties: { value: { type: "number" } } } };
		const definition = {
			nodes: {
				source: { kind: "agent", output: sourcePort },
				target: { kind: "human", input: targetPort },
			},
			edges: {
				bridge: {
					from: { nodeId: "source", portId: "out" },
					to: { nodeId: "target", portId: "in" },
					kind: "control",
					guard: { handler: "allow", params: { mode: "safe" } },
				},
			},
			ui: { positions: { source: { x: 10, y: 20 }, target: { x: 110, y: 220 } } },
		};

		const details = createWorkflowEdgePortDetails(definition, definition.edges.bridge);
		assert.deepEqual(details, {
			sourceNodeId: "source",
			targetNodeId: "target",
			sourcePort,
			targetPort,
			directlyCompatible: false,
		});
		assert.equal(areWorkflowPortsDirectlyCompatible({ kind: "text" }, { kind: "text" }), true);
		assert.equal(areWorkflowPortsDirectlyCompatible({ kind: "json", schema: jsonSchema }, { kind: "json", schema: jsonSchema }), true);
		assert.equal(areWorkflowPortsDirectlyCompatible({ kind: "json", schema: jsonSchema }, targetPort), false);

		const withEdgeAdapter = applyWorkflowEdgeAdapterChoice(definition, "bridge", "json-to-human");
		assert.equal(readWorkflowEdgeAdapterRef(withEdgeAdapter.edges.bridge), "json-to-human");
		assert.deepEqual(withEdgeAdapter.edges.bridge.adapter, {
			kind: "edgeAdapter",
			transform: { kind: "adapter", language: "typescript", id: "json-to-human" },
			output: targetPort,
		});
		assert.notEqual(withEdgeAdapter.edges.bridge.adapter.output, targetPort);
		assert.equal(applyWorkflowEdgeAdapterChoice(definition, "missing", "noop"), definition);

		const withVisibleAdapter = insertWorkflowAdapterNodeForEdge(definition, "bridge", "json-to-human");
		assert.deepEqual(withVisibleAdapter.nodes.adapter, {
			kind: "adapter",
			label: "Adapter adapter",
			mode: "deterministic",
			handler: { kind: "adapter", language: "typescript", id: "json-to-human" },
			input: sourcePort,
			output: targetPort,
		});
		assert.notEqual(withVisibleAdapter.nodes.adapter.input, sourcePort);
		assert.notEqual(withVisibleAdapter.nodes.adapter.output, targetPort);
		assert.equal(withVisibleAdapter.edges.bridge, undefined);
		assert.deepEqual(withVisibleAdapter.edges.bridge_to_adapter, {
			id: "bridge_to_adapter",
			from: { nodeId: "source", portId: "out" },
			to: { nodeId: "adapter" },
			kind: "control",
			guard: { handler: "allow", params: { mode: "safe" } },
		});
		assert.deepEqual(withVisibleAdapter.edges.adapter_to_target, {
			id: "adapter_to_target",
			from: { nodeId: "adapter" },
			to: { nodeId: "target", portId: "in" },
			kind: "control",
		});
		assert.deepEqual(withVisibleAdapter.ui.positions.adapter, { x: 60, y: 120 });

		const colliding = {
			nodes: { source: {}, target: {}, adapter: {}, adapter_2: {} },
			edges: {
				bridge: { from: { nodeId: "source" }, to: { nodeId: "target" } },
				bridge_to_adapter_3: {},
				adapter_3_to_target: {},
			},
		};
		const collisionResult = insertWorkflowAdapterNodeForEdge(colliding, "bridge", "fallback-adapter");
		assert.deepEqual(collisionResult.nodes.adapter_3.input, { kind: "text" });
		assert.deepEqual(collisionResult.nodes.adapter_3.output, { kind: "text" });
		assert.equal(collisionResult.edges.bridge_to_adapter_3.id, undefined);
		assert.equal(collisionResult.edges.adapter_3_to_target.id, undefined);
		assert.equal(collisionResult.edges.bridge_to_adapter_3_2.id, "bridge_to_adapter_3_2");
		assert.equal(collisionResult.edges.adapter_3_to_target_2.id, "adapter_3_to_target_2");
		assert.deepEqual(collisionResult.ui.positions.adapter_3, { x: 340, y: 230 });
		assert.equal(insertWorkflowAdapterNodeForEdge(definition, "missing", "noop"), definition);
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow edge adapter helpers apply edge adapters and visible adapter nodes", async () => {
	const { stdout, stderr } = await runWorkflowEdgeAdapterScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
