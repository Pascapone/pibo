import type { PiboJsonObject } from "../../core/events.js";
import { normalizeForCanonicalJson, type WorkflowDraftDiagnostic } from "./workflow-persistence.js";

export function validateWorkflowEdgeAdapterOutputCompatibilityLike(
	edgeId: string,
	adapterOutput: unknown,
	edge: PiboJsonObject,
	nodes: PiboJsonObject,
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const targetPort = readEdgeTargetInputPort(edge, nodes);
	if (targetPort && isJsonObject(adapterOutput) && !areWorkflowPortsDirectlyCompatible(adapterOutput, targetPort)) {
		diagnostics.push({
			code: "WorkflowGraphError.incompatibleEdgeAdapterOutput",
			message: `Workflow edge '${edgeId}' adapter output is incompatible with the target input port.`,
			severity: "error",
			path: `$.edges.${edgeId}.adapter.output`,
			edgeId,
			hint: "Set the registered adapter output port to the target input contract; do not use hidden LLM coercion.",
		});
	}
}

export function validateWorkflowEdgeDirectCompatibilityLike(edgeId: string, edge: PiboJsonObject, nodes: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	const sourcePort = readEdgeSourceOutputPort(edge, nodes);
	const targetPort = readEdgeTargetInputPort(edge, nodes);
	if (!sourcePort || !targetPort || areWorkflowPortsDirectlyCompatible(sourcePort, targetPort)) return;
	diagnostics.push({
		code: "WorkflowGraphError.incompatibleEdgePorts",
		message: `Workflow edge '${edgeId}' connects incompatible source output and target input ports without a registered adapter.`,
		severity: "error",
		path: `$.edges.${edgeId}`,
		edgeId,
		hint: "Add a visible registered edge adapter or adapter node. Hidden LLM coercion is not allowed in V2.",
	});
}

function readEdgeSourceOutputPort(edge: PiboJsonObject, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const node = readWorkflowEdgeNode(edge.from, nodes);
	return node && isJsonObject(node.output) ? node.output : undefined;
}

function readEdgeTargetInputPort(edge: PiboJsonObject, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const node = readWorkflowEdgeNode(edge.to, nodes);
	return node && isJsonObject(node.input) ? node.input : undefined;
}

function readWorkflowEdgeNode(endpoint: unknown, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const nodeId = isJsonObject(endpoint) && typeof endpoint.nodeId === "string" ? endpoint.nodeId.trim() : undefined;
	const node = nodeId ? nodes[nodeId] : undefined;
	return isJsonObject(node) ? node : undefined;
}

function areWorkflowPortsDirectlyCompatible(left: PiboJsonObject, right: PiboJsonObject): boolean {
	if (left.kind === "text" && right.kind === "text") return true;
	if (left.kind !== "json" || right.kind !== "json") return false;
	return JSON.stringify(normalizeForCanonicalJson(left.schema)) === JSON.stringify(normalizeForCanonicalJson(right.schema));
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
