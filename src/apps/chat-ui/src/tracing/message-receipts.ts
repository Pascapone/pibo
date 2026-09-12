import type { MessageReceipt } from "../../../../data/message-command-store.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../../../../shared/trace-types.js";

const TERMINAL_MESSAGE_RECEIPT_STATES = new Set(["completed", "failed", "interrupted"]);
const UNKNOWN_RECEIPT_RECONCILIATION_ATTEMPTS = 7;

export type PendingMessageReceiptTransaction = {
	piboSessionId: string;
	clientTxnId: string;
};

export function isTerminalMessageReceipt(receipt: MessageReceipt): boolean {
	return TERMINAL_MESSAGE_RECEIPT_STATES.has(receipt.state);
}

export function messageReceiptPollDelay(attempt: number, jitterKey: string): number {
	const boundedAttempt = Math.max(0, Math.min(4, Math.floor(attempt)));
	const base = Math.min(15_000, 1_000 * (2 ** boundedAttempt));
	let hash = 0;
	for (let index = 0; index < jitterKey.length; index += 1) hash = ((hash * 31) + jitterKey.charCodeAt(index)) >>> 0;
	const jitter = 0.85 + ((hash % 301) / 1_000);
	return Math.round(base * jitter);
}

export function messageReceiptRefetchInterval(
	receipts: readonly MessageReceipt[] | undefined,
	options: {
		pendingTransaction?: PendingMessageReceiptTransaction | null;
		unchangedAttempts?: number;
		jitterKey?: string;
	} = {},
): number | false {
	const pending = options.pendingTransaction;
	const attempts = Math.max(0, options.unchangedAttempts ?? 0);
	if (receipts === undefined) {
		if (!pending || attempts >= UNKNOWN_RECEIPT_RECONCILIATION_ATTEMPTS) return false;
		return messageReceiptPollDelay(attempts, options.jitterKey ?? pending.clientTxnId);
	}
	const matchingPendingReceipt = pending
		? receipts.find((receipt) => receipt.sessionId === pending.piboSessionId && receipt.eventId === pending.clientTxnId)
		: undefined;
	if (pending && !matchingPendingReceipt) {
		if (attempts >= UNKNOWN_RECEIPT_RECONCILIATION_ATTEMPTS) return false;
		return messageReceiptPollDelay(attempts, options.jitterKey ?? pending.clientTxnId);
	}
	if (receipts.some((receipt) => !isTerminalMessageReceipt(receipt))) {
		return messageReceiptPollDelay(attempts, options.jitterKey ?? pending?.clientTxnId ?? "message-receipts");
	}
	return false;
}

export function matchingMessageReceipt(
	receipts: readonly MessageReceipt[],
	transaction: PendingMessageReceiptTransaction | null | undefined,
): MessageReceipt | undefined {
	if (!transaction) return undefined;
	return receipts.find((receipt) => (
		receipt.sessionId === transaction.piboSessionId
		&& receipt.eventId === transaction.clientTxnId
	));
}

export function isAcceptanceUnknownError(value: unknown): boolean {
	return Boolean(value && typeof value === "object" && "acceptanceUnknown" in value && value.acceptanceUnknown === true);
}

export class MessageReceiptReconciliationTracker {
	private readonly trackedEventIds = new Set<string>();
	private readonly refreshedTerminalEventIds = new Set<string>();

	constructor(initialEventId?: string) {
		if (initialEventId) this.trackedEventIds.add(initialEventId);
	}

	track(eventId: string): void {
		this.trackedEventIds.add(eventId);
		this.refreshedTerminalEventIds.delete(eventId);
	}

	abandon(eventId: string): void {
		this.trackedEventIds.delete(eventId);
	}

	observe(
		receipts: readonly MessageReceipt[],
		pendingTransaction?: PendingMessageReceiptTransaction | null,
	): { pendingReceipt?: MessageReceipt; terminalReceipts: MessageReceipt[] } {
		const pendingReceipt = matchingMessageReceipt(receipts, pendingTransaction);
		const terminalReceipts: MessageReceipt[] = [];
		for (const receipt of receipts) {
			if (!this.trackedEventIds.has(receipt.eventId)
				|| !isTerminalMessageReceipt(receipt)
				|| this.refreshedTerminalEventIds.has(receipt.eventId)) continue;
			this.refreshedTerminalEventIds.add(receipt.eventId);
			this.trackedEventIds.delete(receipt.eventId);
			terminalReceipts.push(receipt);
		}
		return { ...(pendingReceipt ? { pendingReceipt } : {}), terminalReceipts };
	}
}

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
