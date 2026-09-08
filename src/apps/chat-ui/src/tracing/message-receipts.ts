import type { MessageReceipt } from "../../../../data/message-command-store.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../../../../shared/trace-types.js";

export function withMessageReceipts<T extends PiboSessionTraceView | null | undefined>(view: T, receipts: readonly MessageReceipt[]): T {
	if (!view || receipts.length === 0) return view;
	const byEvent = new Map(receipts.filter(r => r.sessionId === view.piboSessionId).map(r => [r.eventId,r]));
	const visit = (nodes: PiboTraceNode[]): PiboTraceNode[] => {
		let changed = false;
		const next = nodes.map(node => {
		const eventId = node.eventId ?? node.id.replace(/^event:message_(?:queued|steered):/, "");
		const receipt = node.type === "user.message" ? byEvent.get(eventId) ?? byEvent.get(node.id.replace(/^event:message_(?:queued|steered):/, "")) : undefined;
		const children = visit(node.children);
		if (children === node.children && (!receipt || receipt.state === node.messageDeliveryState)) return node;
		changed = true;
		return { ...node, ...(receipt ? { messageDeliveryState: receipt.state } : {}), children };
		});
		return changed ? next : nodes;
	};
	const nodes = visit(view.nodes);
	return nodes === view.nodes ? view : { ...view, nodes } as T;
}
