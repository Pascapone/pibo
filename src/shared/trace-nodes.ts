import { compareTraceOrder } from "./trace-order.js";
import type { PiboTraceNode } from "./trace-types.js";

export function sortTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	let hasSortedChildren = false;
	const nodesWithSortedChildren = nodes.map((node) => {
		if (!node.children.length) return node;
		hasSortedChildren = true;
		return { ...node, children: sortTraceNodes(node.children) };
	});
	if (areTraceNodesSorted(nodesWithSortedChildren)) return hasSortedChildren ? nodesWithSortedChildren : [...nodes];
	return [...nodesWithSortedChildren].sort(compareTraceNodes);
}

function areTraceNodesSorted(nodes: readonly PiboTraceNode[]): boolean {
	for (let index = 1; index < nodes.length; index += 1) {
		if (compareTraceNodes(nodes[index - 1], nodes[index]) > 0) return false;
	}
	return true;
}

export function compareTraceNodes(left: PiboTraceNode, right: PiboTraceNode): number {
	const byStartTime = compareOptionalIsoTime(left.startedAt, right.startedAt);
	if (byStartTime !== 0) return byStartTime;
	const byOrder = compareTraceOrder(left.orderKey, right.orderKey);
	if (byOrder !== 0) return byOrder;
	return left.id.localeCompare(right.id);
}

function compareOptionalIsoTime(left?: string, right?: string): number {
	if (!left && !right) return 0;
	if (!left) return 1;
	if (!right) return -1;
	return left.localeCompare(right);
}

export function flattenTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const stack = [...nodes].reverse();
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		flattened.push(node);
		for (let index = node.children.length - 1; index >= 0; index -= 1) {
			stack.push(node.children[index]);
		}
	}
	return flattened;
}

export function nestTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of nodes) {
		byId.set(node.id, { ...node, children: [...node.children] });
	}

	const nestedChildIds = new Set<string>();
	for (const node of byId.values()) {
		if (!node.parentId) continue;
		const parent = byId.get(node.parentId);
		if (!parent) continue;
		parent.children.push(node);
		nestedChildIds.add(node.id);
	}

	const roots = [...byId.values()].filter((node) => !nestedChildIds.has(node.id));
	return sortTraceNodes(roots);
}

export function mapTraceNodesById(nodes: PiboTraceNode[]): Map<string, PiboTraceNode> {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of flattenTraceNodes(nodes)) byId.set(node.id, node);
	return byId;
}
