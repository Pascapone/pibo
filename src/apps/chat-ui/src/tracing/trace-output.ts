import type { PiboSessionTraceView, PiboTraceNode } from "../types";

function forEachPiboTraceNode(nodes: readonly PiboTraceNode[], visitNode: (node: PiboTraceNode) => void): void {
	for (const node of nodes) {
		visitNode(node);
		forEachPiboTraceNode(node.children, visitNode);
	}
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}

export function traceAssistantOutputLength(trace: PiboSessionTraceView | null | undefined): number | undefined {
	if (!trace) return undefined;
	let length = 0;
	forEachPiboTraceNode(trace.nodes, (node) => {
		if (node.type === "assistant.message") length += traceNodeText(node).length;
	});
	return length;
}
