/**
 * K07 v1 receipt→acceptance mapping (D1-G1, productive vertical).
 *
 * Binds frozen send transactions to REAL message receipts. Binding rule: the
 * transaction must be open in this store with the identical send value, and a
 * receipt must exist with matching sessionId + eventId==clientTxnId and no
 * conflict. Accepted-but-turn-failed still consumes (acceptance happened; the
 * model outcome never gates consumption). Unknown/rejected/missing receipts
 * and transport failures → ATT_ACCEPTANCE_UNKNOWN with idempotent retry.
 * Duplicate application never notifies twice: notifyAccepted runs only for
 * freshly consumed revisions with their receiptId.
 *
 * Acceptance identity has two strengths. Strong: the admission POST echoed a
 * fingerprint that the receipt carries back (server change, proposal §6/§7);
 * consumption requires equality. Weak (transition until that change lands):
 * sessionId + eventId==clientTxnId match only, honestly labeled
 * `weakBinding: true` in the result. The weak path is safe in practice
 * because the draft store itself refuses same-txn-different-content freezes,
 * but only the fingerprint closes a lost-409 race absolutely.
 *
 * The receipt query seam is injectable: production passes a fetcher over
 * `GET /api/chat/message-receipts?piboSessionId=…` (existing endpoint);
 * tests pass scripted queries. No new server tracking in v1.
 */

import { AttachmentDraftError } from "../../../../attachments/errors.js";
import type {
	AttachmentProviderLookup,
	AttachmentProviderScope,
} from "../../../../attachments/types.js";
import type {
	AttachmentAcceptanceResult,
	AttachmentId,
	AttachmentSendSnapshot,
	CoreAttachmentDraftStore,
} from "./core-attachment-draft";

export type ReceiptView = {
	id: string;
	sessionId: string;
	eventId: string;
	streamId: number;
	state: string;
	error?: string;
	fingerprint?: string;
};

export type ReceiptQuery = {
	findByClientTxnId(clientTxnId: string): Promise<ReceiptView | undefined>;
};

export type ReceiptTransportError = Error & { readonly receiptTransportFailed: true };

export function isReceiptTransportError(error: unknown): error is ReceiptTransportError {
	return error instanceof Error && (error as Partial<ReceiptTransportError>).receiptTransportFailed === true;
}

export function receiptTransportFailed(message: string): ReceiptTransportError {
	const error = new Error(message) as ReceiptTransportError;
	(error as { receiptTransportFailed: boolean }).receiptTransportFailed = true;
	return error;
}

export type ReconciledAcceptance = AttachmentAcceptanceResult & {
	receiptId?: string;
	notified: string[];
	weakBinding: boolean;
};

function acceptanceUnknown(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message, retryable: true });
}

/**
 * Reconciles one frozen transaction against real receipts and consumes on
 * proof of acceptance. Pure orchestration over the store + query + provider
 * seams; every rejection leaves drafts, snapshots, and blobs untouched.
 */
export async function reconcileAcceptance(input: {
	store: CoreAttachmentDraftStore;
	snapshot: AttachmentSendSnapshot;
	query: ReceiptQuery;
	providerScope: AttachmentProviderScope;
	providerLookup?: AttachmentProviderLookup;
	expectedFingerprint?: string;
}): Promise<ReconciledAcceptance> {
	const { store, snapshot, query } = input;
	if (snapshot.sessionId !== store.boundSessionId) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Send snapshots belong to exactly one session.", retryable: false });
	}
	let receipt: ReceiptView | undefined;
	try {
		receipt = await query.findByClientTxnId(snapshot.clientTxnId);
	} catch (error) {
		if (isReceiptTransportError(error)) throw acceptanceUnknown(`Receipt lookup failed: ${error.message}. Retry unchanged.`);
		throw error;
	}
	if (!receipt) {
		throw acceptanceUnknown("No receipt found for this transaction. Retry unchanged once the send is submitted.");
	}
	if (receipt.sessionId !== snapshot.sessionId || receipt.eventId !== snapshot.clientTxnId) {
		throw acceptanceUnknown("Receipt does not match this transaction and session.");
	}
	const weakBinding = input.expectedFingerprint === undefined;
	if (!weakBinding && receipt.fingerprint !== input.expectedFingerprint) {
		throw acceptanceUnknown("Receipt fingerprint does not match this send. Retry unchanged.");
	}
	const applied = store.applyAcceptance(snapshot, { clientTxnId: snapshot.clientTxnId, accepted: true });
	if (applied.duplicate || applied.consumed.length === 0) {
		return { ...applied, receiptId: receipt.id, notified: [], weakBinding };
	}
	const notified: string[] = [];
	if (input.providerLookup) {
		const byId = new Map(snapshot.attachments.map((entry) => [entry.id, entry]));
		for (const id of applied.consumed) {
			const frozen = byId.get(id);
			const provider = frozen ? input.providerLookup(frozen.type, input.providerScope) : undefined;
			if (frozen && provider?.notifyAccepted) {
				provider.notifyAccepted({ type: frozen.type, id: frozen.id as string, receiptId: receipt.id });
				notified.push(id as string);
			}
		}
	}
	return { ...applied, receiptId: receipt.id, notified, weakBinding };
}

/**
 * Production query over the existing message-receipts endpoint. Matches the
 * client-sent rule (eventId==clientTxnId) within the session; transport and
 * server errors become ReceiptTransportError (unknown, retryable).
 */
export function createMessageReceiptsQuery(input: {
	sessionId: string;
	fetchJson: (path: string) => Promise<{ receipts: ReceiptView[] }>;
}): ReceiptQuery {
	return {
		async findByClientTxnId(clientTxnId: string): Promise<ReceiptView | undefined> {
			let payload: { receipts: ReceiptView[] };
			try {
				payload = await input.fetchJson(`/api/chat/message-receipts?piboSessionId=${encodeURIComponent(input.sessionId)}`);
			} catch (error) {
				throw receiptTransportFailed(error instanceof Error ? error.message : "Receipt endpoint unreachable.");
			}
			if (!payload || !Array.isArray(payload.receipts)) {
				throw receiptTransportFailed("Receipt endpoint returned an unexpected shape.");
			}
			const matches = payload.receipts.filter((receipt) => receipt.sessionId === input.sessionId && receipt.eventId === clientTxnId);
			matches.sort((a, b) => b.streamId - a.streamId);
			return matches[0];
		},
	};
}

export type { AttachmentId };
