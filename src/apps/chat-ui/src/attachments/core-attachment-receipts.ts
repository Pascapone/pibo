/**
 * K07 receipt→acceptance orchestration seam (Composer wiring remains separate).
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
 * Consumption requires the server-derived receipt contentBinding to equal
 * the locally prepared/persisted submission binding. Neither an ID-only
 * receipt nor a POST-echoed fingerprint proves the frozen request after a
 * lost409, reload, or another writer reusing a transaction. Old receipts stay
 * readable but cannot consume through this seam. A local already-consumed
 * duplicate is harmless and marked weak when no fresh proof is retained.
 *
 * The receipt query seam is injectable: production passes a fetcher over
 * `GET /api/chat/message-receipts?piboSessionId=…` (existing endpoint);
 * tests pass scripted queries. No new server tracking in v1.
 */

import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { requireSynchronousProviderResult } from "../../../../attachments/providers.js";
import { sameMessageContentBinding, type MessageContentBinding } from "../../../../shared/message-content-binding.js";
import type {
	AttachmentProviderLookup,
	AttachmentProviderScope,
} from "../../../../attachments/types.js";
import type {
	AttachmentAcceptanceResult,
	AttachmentId,
	AttachmentPreparedSubmission,
	AttachmentSendSnapshot,
	CoreAttachmentDraftStore,
} from "./core-attachment-draft";
import type { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft";

export type ReceiptView = {
	id: string;
	sessionId: string;
	eventId: string;
	streamId: number;
	state: string;
	error?: string;
	fingerprint?: string;
	contentBinding?: MessageContentBinding;
};

const ADMITTED_RECEIPT_STATES = new Set(["accepted", "waiting_slot", "initializing", "session_queue", "running", "completed", "failed", "interrupted"]);

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
	/** Best-effort provider notice failures occur AFTER durable admission; they
	 * cannot turn an accepted receipt into an unknown or a second send. */
	notificationErrors?: Array<{ id: string; message: string }>;
};

function acceptanceUnknown(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message, retryable: true });
}

/**
 * Reconciles one frozen transaction against real receipts and consumes on
 * proof of acceptance. Pure orchestration over the store + query + provider
 * seams; every rejection leaves drafts, snapshots, and blobs untouched.
 */
async function requireMatchedReceipt(snapshot: AttachmentSendSnapshot, prepared: AttachmentPreparedSubmission, query: ReceiptQuery): Promise<ReceiptView> {
	let receipt: ReceiptView | undefined;
	try {
		receipt = await query.findByClientTxnId(snapshot.clientTxnId);
	} catch (error) {
		if (isReceiptTransportError(error)) throw acceptanceUnknown(`Receipt lookup failed: ${error.message}. Retry unchanged.`);
		throw error;
	}
	if (!receipt) throw acceptanceUnknown("No receipt found for this transaction. Retry unchanged once the send is submitted.");
	if (receipt.sessionId !== snapshot.sessionId || receipt.eventId !== snapshot.clientTxnId
		|| typeof receipt.id !== "string" || !receipt.id || !Number.isSafeInteger(receipt.streamId) || receipt.streamId < 1
		|| !ADMITTED_RECEIPT_STATES.has(receipt.state)) {
		throw acceptanceUnknown("Receipt does not match this transaction/session or a supported admitted-row shape.");
	}
	if (!sameMessageContentBinding(prepared.contentBinding, receipt.contentBinding)) {
		throw acceptanceUnknown("Receipt has no matching content proof for the locally frozen submission. Keep the draft and retry only its original body.");
	}
	return receipt;
}

function notifyConsumed(snapshot: AttachmentSendSnapshot, ids: AttachmentId[], receiptId: string,
	providerScope: AttachmentProviderScope, providerLookup?: AttachmentProviderLookup): { notified: string[]; errors: Array<{ id: string; message: string }> } {
	const notified: string[] = [];
	const errors: Array<{ id: string; message: string }> = [];
	if (!providerLookup) return { notified, errors };
	const byId = new Map(snapshot.attachments.map((entry) => [entry.id, entry]));
	for (const id of ids) {
		try {
			const frozen = byId.get(id);
			const provider = frozen ? providerLookup(frozen.type, providerScope) : undefined;
			if (frozen && provider?.notifyAccepted) {
				requireSynchronousProviderResult(provider.notifyAccepted({ type: frozen.type, id: frozen.id as string, receiptId }), "acceptance notice");
				notified.push(id as string);
			}
		} catch (error) {
			errors.push({ id: id as string, message: error instanceof Error ? error.message : "Provider notice failed." });
		}
	}
	return { notified, errors };
}

export async function reconcileAcceptance(input: {
	store: CoreAttachmentDraftStore;
	snapshot: AttachmentSendSnapshot;
	query: ReceiptQuery;
	providerScope: AttachmentProviderScope;
	providerLookup?: AttachmentProviderLookup;
	/** Retained only for source compatibility; a POST echo never authorizes consumption. */
	expectedFingerprint?: string;
}): Promise<ReconciledAcceptance> {
	const { store, snapshot, query } = input;
	if (snapshot.sessionId !== store.boundSessionId) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Send snapshots belong to exactly one session.", retryable: false });
	}
	const prepared = store.getPreparedSubmission(snapshot.clientTxnId);
	if (!prepared) {
		if (store.wasAccepted(snapshot.clientTxnId)) return { consumed: [], duplicate: true, notified: [], weakBinding: true };
		throw acceptanceUnknown("No locally prepared submission proof exists. An old receipt or POST echo cannot prove this frozen content.");
	}
	const receipt = await requireMatchedReceipt(snapshot, prepared, query);
	// All durable row states prove admission, including failed/cancelled work
	// and an interrupted execution lease. Outcome must not trigger a new send.
	const applied = store.applyAcceptance(snapshot, { clientTxnId: snapshot.clientTxnId, accepted: true });
	const notice = applied.duplicate ? { notified: [], errors: [] } : notifyConsumed(snapshot, applied.consumed, receipt.id, input.providerScope, input.providerLookup);
	return { ...applied, receiptId: receipt.id, notified: notice.notified,
		...(notice.errors.length ? { notificationErrors: notice.errors } : {}), weakBinding: false };
}

/** Native-IDB counterpart: receipt fetch finishes BEFORE CAS acceptance. A
 * concurrent tab edit/accept surfaces ATT_STALE_REVISION; reload and check
 * the same receipt, never consume from a POST echo or overwrite a draft. */
export async function reconcileIndexedAcceptance(input: {
	draft: Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
	snapshot: AttachmentSendSnapshot;
	query: ReceiptQuery;
	providerScope: AttachmentProviderScope;
	providerLookup?: AttachmentProviderLookup;
}): Promise<ReconciledAcceptance> {
	const { draft, snapshot } = input;
	if (snapshot.sessionId !== draft.sessionId || input.providerScope.sessionId !== draft.sessionId) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Receipt and browser draft belong to different Pibo Sessions.", retryable: false });
	}
	const loaded = await draft.load();
	const prepared = Object.hasOwn(loaded.view.preparedSubmissions, snapshot.clientTxnId)
		? loaded.view.preparedSubmissions[snapshot.clientTxnId] : undefined;
	if (!prepared) {
		if (loaded.view.acceptedTransactions.includes(snapshot.clientTxnId)) return { consumed: [], duplicate: true, notified: [], weakBinding: true };
		throw acceptanceUnknown("No locally prepared submission proof exists. An old receipt or POST echo cannot prove this frozen content.");
	}
	const receipt = await requireMatchedReceipt(snapshot, prepared, input.query);
	const committed = await draft.execute(loaded.revision, { kind: "accept", snapshot, receipt: { clientTxnId: snapshot.clientTxnId, accepted: true } });
	const applied = committed.result;
	const notice = applied.duplicate ? { notified: [], errors: [] } : notifyConsumed(snapshot, applied.consumed, receipt.id, input.providerScope, input.providerLookup);
	return { ...applied, receiptId: receipt.id, notified: notice.notified,
		...(notice.errors.length ? { notificationErrors: notice.errors } : {}), weakBinding: false };
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
