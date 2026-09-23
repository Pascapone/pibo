import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { sameMessageContentBinding } from "../../../../shared/message-content-binding.js";
import type { AttachmentPreparedSubmission } from "./core-attachment-draft.js";
import { prepareTypedIndexedSubmission } from "./core-attachment-prepare-client.js";
import { reconcileIndexedAcceptance, type ReceiptQuery } from "./core-attachment-receipts.js";

/** Browser send orchestration. The POST consumes ONLY a fresh read of the
 * immutable IDB body, and a separate receipt query authorizes local removal.
 * A lost POST response may be reconciled but never by trusting its echo. */
export async function deliverTypedIndexedAttachments(input: Parameters<typeof prepareTypedIndexedSubmission>[0] & {
	postPrepared: (prepared: AttachmentPreparedSubmission) => Promise<unknown>;
	query: ReceiptQuery;
}): Promise<{ receiptId?: string; consumed: string[]; duplicate: boolean; notificationErrors?: Array<{ id: string; message: string }> }> {
	const prepared = await prepareTypedIndexedSubmission(input);
	const current = await input.draft.load();
	const stored = Object.hasOwn(current.view.preparedSubmissions, input.clientTxnId)
		? current.view.preparedSubmissions[input.clientTxnId] : undefined;
	if (!stored || !sameMessageContentBinding(stored.contentBinding, prepared.prepared.contentBinding)) {
		throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Original prepared body changed before POST; reload its frozen transaction.", retryable: false });
	}
	const reconcile = () => reconcileIndexedAcceptance({ draft: input.draft, snapshot: prepared.snapshot,
		query: input.query, providerScope: input.scope, providerLookup: input.lookup });
	try {
		await input.postPrepared(stored);
	} catch (error) {
		const unknown = error && typeof error === "object" && "acceptanceUnknown" in error && error.acceptanceUnknown === true;
		if (unknown) {
			try {
				const accepted = await reconcile();
				return { receiptId: accepted.receiptId, consumed: accepted.consumed.map(String), duplicate: accepted.duplicate,
					...(accepted.notificationErrors ? { notificationErrors: accepted.notificationErrors } : {}) };
			} catch {
				// No independent proof. Retain the exact original body and surface
				// the unknown POST, never turn a failed query into a new txn.
			}
		}
		throw error;
	}
	const accepted = await reconcile();
	return { receiptId: accepted.receiptId, consumed: accepted.consumed.map(String), duplicate: accepted.duplicate,
		...(accepted.notificationErrors ? { notificationErrors: accepted.notificationErrors } : {}) };
}
