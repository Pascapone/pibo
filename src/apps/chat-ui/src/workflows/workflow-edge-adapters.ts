import type { WorkflowDraftDefinition } from "../api-workflows";
import {
	createWorkflowGraphProjection,
	isWorkflowJsonObject,
	nextGraphNodePosition,
	nextWorkflowNodeId,
	readEdgeEndpointNodeId,
	readWorkflowEdgeDefinitions,
	readWorkflowNodeDefinitions,
	readWorkflowPositions,
	writeWorkflowGraphPositions,
	type GraphPosition,
	type WorkflowJsonObject,
} from "./workflow-graph-model";

export type WorkflowEdgePortDetails = {
	sourceNodeId?: string;
	targetNodeId?: string;
	sourcePort?: WorkflowJsonObject;
	targetPort?: WorkflowJsonObject;
	directlyCompatible: boolean;
};

export function createWorkflowEdgePortDetails(definition: WorkflowDraftDefinition, edge: WorkflowJsonObject): WorkflowEdgePortDetails {
	const sourceNodeId = readEdgeEndpointNodeId(edge.from);
	const targetNodeId = readEdgeEndpointNodeId(edge.to);
	const sourcePort = readEdgeSourceOutputPort(definition, edge);
	const targetPort = readEdgeTargetInputPort(definition, edge);
	return {
		...(sourceNodeId ? { sourceNodeId } : {}),
		...(targetNodeId ? { targetNodeId } : {}),
		...(sourcePort ? { sourcePort } : {}),
		...(targetPort ? { targetPort } : {}),
		directlyCompatible: Boolean(sourcePort && targetPort && areWorkflowPortsDirectlyCompatible(sourcePort, targetPort)),
	};
}

export function readWorkflowEdgeAdapterRef(edge: WorkflowJsonObject): string {
	const adapter = isWorkflowJsonObject(edge.adapter) ? edge.adapter : undefined;
	const transform = adapter && isWorkflowJsonObject(adapter.transform) ? adapter.transform : undefined;
	return readAdapterRefId(transform);
}

export function applyWorkflowEdgeAdapterChoice(definition: WorkflowDraftDefinition, edgeId: string, adapterRef: string): WorkflowDraftDefinition {
	const edges = readWorkflowEdgeDefinitions(definition);
	const currentEdge = edges[edgeId];
	if (!currentEdge) return definition;
	const targetPort = readEdgeTargetInputPort(definition, currentEdge) ?? createDefaultTextWorkflowPort();
	return {
		...definition,
		edges: {
			...edges,
			[edgeId]: {
				...currentEdge,
				id: edgeId,
				adapter: {
					kind: "edgeAdapter",
					transform: createRegisteredAdapterRef(adapterRef),
					output: cloneWorkflowJsonObject(targetPort),
				},
			},
		},
	};
}

export function insertWorkflowAdapterNodeForEdge(definition: WorkflowDraftDefinition, edgeId: string, adapterRef: string): WorkflowDraftDefinition {
	const edges = readWorkflowEdgeDefinitions(definition);
	const currentEdge = edges[edgeId];
	if (!currentEdge) return definition;
	const sourceNodeId = readEdgeEndpointNodeId(currentEdge.from);
	const targetNodeId = readEdgeEndpointNodeId(currentEdge.to);
	if (!sourceNodeId || !targetNodeId) return definition;
	const nodes = readWorkflowNodeDefinitions(definition);
	const nodeId = nextWorkflowNodeId(definition, "adapter");
	const sourcePort = readEdgeSourceOutputPort(definition, currentEdge) ?? createDefaultTextWorkflowPort();
	const targetPort = readEdgeTargetInputPort(definition, currentEdge) ?? createDefaultTextWorkflowPort();
	const positions = readWorkflowPositions(definition);
	const position = midpointGraphPosition(positions[sourceNodeId], positions[targetNodeId]) ?? nextGraphNodePosition(createWorkflowGraphProjection(definition, []).nodes);
	const remainingEdges = { ...edges };
	delete remainingEdges[edgeId];
	const firstEdgeId = uniqueWorkflowEdgeId(remainingEdges, `${edgeId}_to_${nodeId}`);
	const secondEdgeId = uniqueWorkflowEdgeId({ ...remainingEdges, [firstEdgeId]: {} }, `${nodeId}_to_${targetNodeId}`);
	const firstEdge: WorkflowJsonObject = {
		id: firstEdgeId,
		from: cloneWorkflowJsonObject(isWorkflowJsonObject(currentEdge.from) ? currentEdge.from : { nodeId: sourceNodeId }),
		to: { nodeId },
		kind: typeof currentEdge.kind === "string" ? currentEdge.kind : "data",
	};
	if (isWorkflowJsonObject(currentEdge.guard)) firstEdge.guard = cloneWorkflowJsonObject(currentEdge.guard);
	const secondEdge: WorkflowJsonObject = {
		id: secondEdgeId,
		from: { nodeId },
		to: cloneWorkflowJsonObject(isWorkflowJsonObject(currentEdge.to) ? currentEdge.to : { nodeId: targetNodeId }),
		kind: typeof currentEdge.kind === "string" ? currentEdge.kind : "data",
	};
	const nextDefinition: WorkflowDraftDefinition = {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: createDefaultAdapterNodeDefinition(nodeId, adapterRef, sourcePort, targetPort),
		},
		edges: {
			...remainingEdges,
			[firstEdgeId]: firstEdge,
			[secondEdgeId]: secondEdge,
		},
	};
	return writeWorkflowGraphPositions(nextDefinition, { ...positions, [nodeId]: position });
}

export function areWorkflowPortsDirectlyCompatible(left: WorkflowJsonObject, right: WorkflowJsonObject): boolean {
	if (left.kind === "text" && right.kind === "text") return true;
	if (left.kind !== "json" || right.kind !== "json") return false;
	return JSON.stringify(left.schema ?? null) === JSON.stringify(right.schema ?? null);
}

function readEdgeSourceOutputPort(definition: WorkflowDraftDefinition, edge: WorkflowJsonObject): WorkflowJsonObject | undefined {
	const node = readEdgeEndpointNode(definition, edge.from);
	return node && isWorkflowJsonObject(node.output) ? node.output : undefined;
}

function readEdgeTargetInputPort(definition: WorkflowDraftDefinition, edge: WorkflowJsonObject): WorkflowJsonObject | undefined {
	const node = readEdgeEndpointNode(definition, edge.to);
	return node && isWorkflowJsonObject(node.input) ? node.input : undefined;
}

function readEdgeEndpointNode(definition: WorkflowDraftDefinition, endpoint: unknown): WorkflowJsonObject | undefined {
	const nodeId = readEdgeEndpointNodeId(endpoint);
	return nodeId ? readWorkflowNodeDefinitions(definition)[nodeId] : undefined;
}

function createDefaultAdapterNodeDefinition(nodeId: string, adapterRef: string, input: WorkflowJsonObject, output: WorkflowJsonObject): WorkflowJsonObject {
	return {
		kind: "adapter",
		label: `Adapter ${nodeId}`,
		mode: "deterministic",
		handler: createRegisteredAdapterRef(adapterRef),
		input: cloneWorkflowJsonObject(input),
		output: cloneWorkflowJsonObject(output),
	};
}

function createDefaultTextWorkflowPort(): WorkflowJsonObject {
	return { kind: "text" };
}

function createRegisteredAdapterRef(adapterRef: string): WorkflowJsonObject {
	return { kind: "adapter", language: "typescript", id: adapterRef };
}

function readAdapterRefId(value: unknown): string {
	return isWorkflowJsonObject(value) && value.kind === "adapter" && value.language === "typescript" && typeof value.id === "string" ? value.id : "";
}

function midpointGraphPosition(left: GraphPosition | undefined, right: GraphPosition | undefined): GraphPosition | undefined {
	return left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : undefined;
}

function uniqueWorkflowEdgeId(edges: Record<string, WorkflowJsonObject>, base: string): string {
	const sanitizedBase = base.replace(/[^a-zA-Z0-9_-]/g, "-");
	if (!Object.hasOwn(edges, sanitizedBase)) return sanitizedBase;
	let index = 2;
	while (Object.hasOwn(edges, `${sanitizedBase}_${index}`)) index += 1;
	return `${sanitizedBase}_${index}`;
}

function cloneWorkflowJsonObject(value: WorkflowJsonObject): WorkflowJsonObject {
	return JSON.parse(JSON.stringify(value)) as WorkflowJsonObject;
}
