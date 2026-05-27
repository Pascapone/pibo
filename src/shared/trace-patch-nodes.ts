import { sortTraceNodes } from "./trace-nodes.js";
import type { PiboTraceNode } from "./trace-types.js";

export function nestMutableCopiedTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of nodes) byId.set(node.id, node);

	const roots: PiboTraceNode[] = [];
	for (const node of nodes) {
		if (!node.parentId) {
			roots.push(node);
			continue;
		}
		const parent = byId.get(node.parentId);
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return sortTraceNodes(roots);
}

export function shareUnchangedTraceNodes(
	previousById: ReadonlyMap<string, PiboTraceNode>,
	nextNodes: readonly PiboTraceNode[],
	contentDeltaChangedNodeIds?: ReadonlySet<string>,
): PiboTraceNode[] {
	return nextNodes.map((node) => shareUnchangedTraceNode(previousById, node, contentDeltaChangedNodeIds));
}

function shareUnchangedTraceNode(
	previousById: ReadonlyMap<string, PiboTraceNode>,
	nextNode: PiboTraceNode,
	contentDeltaChangedNodeIds?: ReadonlySet<string>,
): PiboTraceNode {
	const previousNode = previousById.get(nextNode.id);
	if (nextNode.children.length === 0) {
		const childrenUnchanged = previousNode !== undefined && previousNode.children.length === 0;
		if (previousNode && childrenUnchanged) {
			if (contentDeltaChangedNodeIds && !contentDeltaChangedNodeIds.has(nextNode.id)) return previousNode;
			if (traceNodeShallowEqual(previousNode, nextNode)) return previousNode;
		}
		return childrenUnchanged ? { ...nextNode, children: previousNode.children } : { ...nextNode, children: [] };
	}

	const sharedChildren = nextNode.children.map((child) => shareUnchangedTraceNode(previousById, child, contentDeltaChangedNodeIds));
	const childrenUnchanged =
		previousNode !== undefined &&
		previousNode.children.length === sharedChildren.length &&
		previousNode.children.every((child, index) => child === sharedChildren[index]);

	if (previousNode && childrenUnchanged) {
		if (contentDeltaChangedNodeIds && !contentDeltaChangedNodeIds.has(nextNode.id)) return previousNode;
		if (traceNodeShallowEqual(previousNode, nextNode)) return previousNode;
	}

	return childrenUnchanged ? { ...nextNode, children: previousNode?.children ?? sharedChildren } : { ...nextNode, children: sharedChildren };
}

function traceNodeShallowEqual(left: PiboTraceNode, right: PiboTraceNode): boolean {
	return (
		left.id === right.id &&
		left.parentId === right.parentId &&
		left.entryId === right.entryId &&
		left.piboSessionId === right.piboSessionId &&
		left.eventId === right.eventId &&
		left.toolCallId === right.toolCallId &&
		left.runId === right.runId &&
		left.type === right.type &&
		left.title === right.title &&
		left.status === right.status &&
		left.startedAt === right.startedAt &&
		left.completedAt === right.completedAt &&
		left.durationMs === right.durationMs &&
		left.summary === right.summary &&
		left.input === right.input &&
		left.output === right.output &&
		left.error === right.error &&
		left.linkedPiboSessionId === right.linkedPiboSessionId &&
		left.source === right.source &&
		left.stableKey === right.stableKey &&
		traceOrderKeyEqual(left.orderKey, right.orderKey)
	);
}

function traceOrderKeyEqual(left: PiboTraceNode["orderKey"], right: PiboTraceNode["orderKey"]): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.sourceRank === right.sourceRank &&
		left.turnSeq === right.turnSeq &&
		left.transcriptIndex === right.transcriptIndex &&
		left.contentPartIndex === right.contentPartIndex &&
		left.eventSequence === right.eventSequence &&
		left.streamId === right.streamId &&
		left.streamFrameIndex === right.streamFrameIndex &&
		left.phaseRank === right.phaseRank
	);
}
