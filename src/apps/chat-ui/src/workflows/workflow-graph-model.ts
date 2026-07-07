import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { WorkflowDraftDefinition, WorkflowDraftDiagnostic } from "../api-workflows";

const DEFAULT_GRAPH_POSITION = { x: 80, y: 80 };
const GRAPH_COLUMN_GAP = 260;
const GRAPH_ROW_GAP = 150;

export type WorkflowJsonObject = Record<string, unknown>;
export type GraphPosition = { x: number; y: number };
export type WorkflowEdgeRoute = { centerX?: number; centerY?: number };
export type WorkflowGraphNodeData = Record<string, unknown> & {
	nodeId: string;
	label: string;
	kind: string;
	validationCount: number;
	isInitial: boolean;
	onManualTriggerRun?: (nodeId: string) => void;
	readOnly?: boolean;
	runVisualState?: "running" | "recent";
};
export type WorkflowGraphFlowNode = Node<WorkflowGraphNodeData, "workflowNode">;
export type WorkflowGraphEdgeData = Record<string, unknown> & {
	edgeId: string;
	kind: string;
	route?: WorkflowEdgeRoute;
	onRouteChange?: (edgeId: string, route: WorkflowEdgeRoute) => void;
	onSelect?: (edgeId: string) => void;
	onContextMenu?: (edgeId: string, event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }) => void;
	readOnly?: boolean;
	recentTransition?: boolean;
};
export type WorkflowGraphFlowEdge = Edge<WorkflowGraphEdgeData, "workflowEdge">;
export type SelectedGraphElement = { type: "node" | "edge"; id: string } | undefined;
export type WorkflowGraphProjection = {
	nodes: WorkflowGraphFlowNode[];
	edges: WorkflowGraphFlowEdge[];
	usedAutoLayout: boolean;
	missingPositionCount: number;
};

export function createWorkflowGraphProjection(definition: WorkflowDraftDefinition, diagnostics: WorkflowDraftDiagnostic[]): WorkflowGraphProjection {
	const nodeDefinitions = readWorkflowNodeDefinitions(definition);
	const nodeEntries = Object.entries(nodeDefinitions);
	const workflowPositions = readWorkflowPositions(definition);
	const workflowEdgeRoutes = readWorkflowEdgeRoutes(definition);
	const nodeIds = new Set(nodeEntries.map(([nodeId]) => nodeId));
	let missingPositionCount = 0;
	const nodes: WorkflowGraphFlowNode[] = nodeEntries.map(([nodeId, nodeDefinition], index) => {
		const savedPosition = workflowPositions[nodeId] ?? readNodeUiPosition(nodeDefinition);
		const position = savedPosition ?? autoLayoutPosition(index, nodeEntries.length);
		if (!savedPosition) missingPositionCount += 1;
		return {
			id: nodeId,
			type: "workflowNode",
			position,
			data: {
				nodeId,
				label: workflowNodeLabel(nodeId, nodeDefinition),
				kind: workflowNodeKind(nodeDefinition),
				validationCount: countNodeDiagnostics(diagnostics, nodeId),
				isInitial: workflowInitialNodeIds(definition).includes(nodeId),
			},
		};
	});

	const edges: WorkflowGraphFlowEdge[] = Object.entries(readWorkflowEdgeDefinitions(definition)).flatMap(([edgeId, edgeDefinition]) => {
		const source = readEdgeEndpointNodeId(edgeDefinition.from);
		const target = readEdgeEndpointNodeId(edgeDefinition.to);
		if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
		const kind = typeof edgeDefinition.kind === "string" ? edgeDefinition.kind : "data";
		return [{
			id: edgeId,
			source,
			target,
			type: "workflowEdge",
			label: kind,
			data: { edgeId, kind, route: workflowEdgeRoutes[edgeId] },
			markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
			style: { stroke: "#38bdf8", strokeWidth: 1.5 },
		}];
	});

	return {
		nodes,
		edges,
		usedAutoLayout: missingPositionCount > 0,
		missingPositionCount,
	};
}

export function projectionHasElement(projection: WorkflowGraphProjection, selected: Exclude<SelectedGraphElement, undefined>): boolean {
	return selected.type === "node"
		? projection.nodes.some((node) => node.id === selected.id)
		: projection.edges.some((edge) => edge.id === selected.id);
}

export function isWorkflowJsonObject(value: unknown): value is WorkflowJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readWorkflowNodeDefinitions(definition: WorkflowDraftDefinition): Record<string, WorkflowJsonObject> {
	return readWorkflowObjectMap(definition.nodes);
}

export function readWorkflowEdgeDefinitions(definition: WorkflowDraftDefinition): Record<string, WorkflowJsonObject> {
	return readWorkflowObjectMap(definition.edges);
}

function readWorkflowObjectMap(value: unknown): Record<string, WorkflowJsonObject> {
	if (!isWorkflowJsonObject(value)) return {};
	const result: Record<string, WorkflowJsonObject> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (isWorkflowJsonObject(entry)) result[key] = entry;
	}
	return result;
}

export function workflowNodeKind(nodeDefinition: WorkflowJsonObject): string {
	return typeof nodeDefinition.kind === "string" ? nodeDefinition.kind : "node";
}

export function workflowNodeLabel(nodeId: string, nodeDefinition: WorkflowJsonObject): string {
	return typeof nodeDefinition.label === "string" && nodeDefinition.label.trim()
		? nodeDefinition.label.trim()
		: `${capitalizeWorkflowLabel(workflowNodeKind(nodeDefinition))} ${nodeId}`;
}

function capitalizeWorkflowLabel(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function readWorkflowPositions(definition: WorkflowDraftDefinition): Record<string, GraphPosition> {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : undefined;
	const rawPositions = ui && isWorkflowJsonObject(ui.positions) ? ui.positions : undefined;
	if (!rawPositions) return {};
	const positions: Record<string, GraphPosition> = {};
	for (const [nodeId, value] of Object.entries(rawPositions)) {
		const position = readPosition(value);
		if (position) positions[nodeId] = position;
	}
	return positions;
}

export function readWorkflowEdgeRoutes(definition: WorkflowDraftDefinition): Record<string, WorkflowEdgeRoute> {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : undefined;
	const rawRoutes = ui && isWorkflowJsonObject(ui.edgeRoutes) ? ui.edgeRoutes : undefined;
	if (!rawRoutes) return {};
	const routes: Record<string, WorkflowEdgeRoute> = {};
	for (const [edgeId, value] of Object.entries(rawRoutes)) {
		const route = readEdgeRoute(value);
		if (route) routes[edgeId] = route;
	}
	return routes;
}

function readNodeUiPosition(nodeDefinition: WorkflowJsonObject): GraphPosition | undefined {
	const ui = isWorkflowJsonObject(nodeDefinition.ui) ? nodeDefinition.ui : undefined;
	return ui ? readPosition(ui.position) : undefined;
}

function readPosition(value: unknown): GraphPosition | undefined {
	if (!isWorkflowJsonObject(value)) return undefined;
	const { x, y } = value;
	return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : undefined;
}

function readEdgeRoute(value: unknown): WorkflowEdgeRoute | undefined {
	if (!isWorkflowJsonObject(value)) return undefined;
	const route: WorkflowEdgeRoute = {};
	if (typeof value.centerX === "number" && Number.isFinite(value.centerX)) route.centerX = value.centerX;
	if (typeof value.centerY === "number" && Number.isFinite(value.centerY)) route.centerY = value.centerY;
	return Object.keys(route).length ? route : undefined;
}

function autoLayoutPosition(index: number, total: number): GraphPosition {
	if (total <= 0) return DEFAULT_GRAPH_POSITION;
	const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
	return {
		x: DEFAULT_GRAPH_POSITION.x + (index % columns) * GRAPH_COLUMN_GAP,
		y: DEFAULT_GRAPH_POSITION.y + Math.floor(index / columns) * GRAPH_ROW_GAP,
	};
}

export function nextGraphNodePosition(nodes: WorkflowGraphFlowNode[]): GraphPosition {
	if (!nodes.length) return DEFAULT_GRAPH_POSITION;
	return {
		x: DEFAULT_GRAPH_POSITION.x + (nodes.length % 3) * GRAPH_COLUMN_GAP,
		y: DEFAULT_GRAPH_POSITION.y + Math.floor(nodes.length / 3) * GRAPH_ROW_GAP,
	};
}

export function nextWorkflowNodeId(definition: WorkflowDraftDefinition, prefix: string): string {
	const nodes = readWorkflowNodeDefinitions(definition);
	if (!Object.hasOwn(nodes, prefix)) return prefix;
	let index = 2;
	while (Object.hasOwn(nodes, `${prefix}_${index}`)) index += 1;
	return `${prefix}_${index}`;
}

export function nextWorkflowEdgeId(definition: WorkflowDraftDefinition, sourceId: string, targetId: string): string {
	const edges = readWorkflowEdgeDefinitions(definition);
	const base = `edge_${sourceId}_to_${targetId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
	if (!Object.hasOwn(edges, base)) return base;
	let index = 2;
	while (Object.hasOwn(edges, `${base}_${index}`)) index += 1;
	return `${base}_${index}`;
}

export function addWorkflowGraphNodeDefinition(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, nodeDefinition: WorkflowJsonObject): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	const nextDefinition: WorkflowDraftDefinition = {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: nodeDefinition,
		},
		edges: isWorkflowJsonObject(definition.edges) ? definition.edges : {},
	};
	if (!workflowInitialNodeIds(nextDefinition).length) nextDefinition.initial = nodeId;
	return writeWorkflowGraphPositions(nextDefinition, { ...readWorkflowPositions(definition), [nodeId]: position });
}

export function addWorkflowGraphEdge(definition: WorkflowDraftDefinition, edgeId: string, sourceId: string, targetId: string): WorkflowDraftDefinition {
	return {
		...definition,
		edges: {
			...readWorkflowEdgeDefinitions(definition),
			[edgeId]: {
				id: edgeId,
				from: { nodeId: sourceId },
				to: { nodeId: targetId },
				kind: "data",
			},
		},
	};
}

export function deleteWorkflowGraphNode(definition: WorkflowDraftDefinition, nodeId: string): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	delete nodes[nodeId];
	const edges = Object.fromEntries(Object.entries(readWorkflowEdgeDefinitions(definition)).filter(([, edgeDefinition]) => {
		return readEdgeEndpointNodeId(edgeDefinition.from) !== nodeId && readEdgeEndpointNodeId(edgeDefinition.to) !== nodeId;
	}));
	const positions = readWorkflowPositions(definition);
	delete positions[nodeId];
	const edgeRoutes = readWorkflowEdgeRoutes(definition);
	for (const edgeId of Object.keys(edgeRoutes)) {
		if (!Object.hasOwn(edges, edgeId)) delete edgeRoutes[edgeId];
	}
	return normalizeInitialAfterDelete(writeWorkflowGraphLayout({ ...definition, nodes, edges }, positions, edgeRoutes), nodeId, Object.keys(nodes));
}

export function deleteWorkflowGraphEdge(definition: WorkflowDraftDefinition, edgeId: string): WorkflowDraftDefinition {
	const edges = readWorkflowEdgeDefinitions(definition);
	delete edges[edgeId];
	const edgeRoutes = readWorkflowEdgeRoutes(definition);
	delete edgeRoutes[edgeId];
	return writeWorkflowGraphEdgeRoutes({ ...definition, edges }, edgeRoutes);
}

function normalizeInitialAfterDelete(definition: WorkflowDraftDefinition, deletedNodeId: string, remainingNodeIds: string[]): WorkflowDraftDefinition {
	const nextDefinition: WorkflowDraftDefinition = { ...definition };
	if (typeof nextDefinition.initial === "string") {
		if (nextDefinition.initial === deletedNodeId) {
			if (remainingNodeIds[0]) nextDefinition.initial = remainingNodeIds[0];
			else delete nextDefinition.initial;
		}
		return nextDefinition;
	}
	if (Array.isArray(nextDefinition.initial)) {
		const nextInitial = nextDefinition.initial.filter((entry) => entry !== deletedNodeId);
		if (nextInitial.length) nextDefinition.initial = nextInitial;
		else if (remainingNodeIds[0]) nextDefinition.initial = remainingNodeIds[0];
		else delete nextDefinition.initial;
	}
	return nextDefinition;
}

export function writeWorkflowGraphPositions(definition: WorkflowDraftDefinition, positions: Record<string, GraphPosition>): WorkflowDraftDefinition {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : {};
	return {
		...definition,
		ui: {
			...ui,
			layout: "manual",
			positions,
		},
	};
}

export function writeWorkflowGraphEdgeRoutes(definition: WorkflowDraftDefinition, edgeRoutes: Record<string, WorkflowEdgeRoute>): WorkflowDraftDefinition {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : {};
	return {
		...definition,
		ui: {
			...ui,
			edgeRoutes,
		},
	};
}

export function writeWorkflowGraphLayout(definition: WorkflowDraftDefinition, positions: Record<string, GraphPosition>, edgeRoutes: Record<string, WorkflowEdgeRoute>): WorkflowDraftDefinition {
	return writeWorkflowGraphEdgeRoutes(writeWorkflowGraphPositions(definition, positions), edgeRoutes);
}

export function workflowInitialNodeIds(definition: WorkflowDraftDefinition): string[] {
	if (typeof definition.initial === "string") return [definition.initial];
	return Array.isArray(definition.initial) ? definition.initial.filter((entry): entry is string => typeof entry === "string") : [];
}

function countNodeDiagnostics(diagnostics: WorkflowDraftDiagnostic[], nodeId: string): number {
	return diagnostics.filter((diagnostic) => diagnostic.nodeId === nodeId || diagnostic.path?.startsWith(`$.nodes.${nodeId}`)).length;
}

export function readEdgeEndpointNodeId(value: unknown): string | undefined {
	return isWorkflowJsonObject(value) && typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId.trim() : undefined;
}
