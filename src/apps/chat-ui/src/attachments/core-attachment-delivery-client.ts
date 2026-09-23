import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { sameMessageContentBinding } from "../../../../shared/message-content-binding.js";
import { canonicalJson } from "../../../../shared/deterministic-digest.js";
import { preflightFrozenProviderPins } from "./core-attachment-provider-commands.js";
import type { AttachmentPreparedSubmission } from "./core-attachment-draft.js";
import { prepareTypedIndexedSubmission } from "./core-attachment-prepare-client.js";
import { reconcileIndexedAcceptance, receiptTransportFailed, type ReceiptQuery } from "./core-attachment-receipts.js";

/** Browser send orchestration. The POST consumes ONLY a fresh read of the
 * immutable IDB body, and a separate receipt query authorizes local removal.
 * A lost POST response may be reconciled but never by trusting its echo. */
export async function deliverTypedIndexedAttachments(input: Parameters<typeof prepareTypedIndexedSubmission>[0] & {
	postPrepared: (prepared: AttachmentPreparedSubmission) => Promise<unknown>;
	query: ReceiptQuery;
	/** Live UI ownership gate, checked immediately before any network POST. */
	beforePost?: () => void;
}): Promise<{ receiptId?: string; consumed: string[]; duplicate: boolean; notificationErrors?: Array<{ id: string; message: string }> }> {
	const prepared = await prepareTypedIndexedSubmission(input);
	const current = await input.draft.load();
	const stored = Object.hasOwn(current.view.preparedSubmissions, input.clientTxnId)
		? current.view.preparedSubmissions[input.clientTxnId] : undefined;
	if (!stored || !sameMessageContentBinding(stored.contentBinding, prepared.prepared.contentBinding)) {
		throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Original prepared body changed before POST; reload its frozen transaction.", retryable: false });
	}
	const reconcile = (query: ReceiptQuery = input.query) => reconcileIndexedAcceptance({ draft: input.draft, snapshot: prepared.snapshot,
		query, providerScope: input.scope, providerLookup: input.lookup });
	const result = (accepted: Awaited<ReturnType<typeof reconcile>>) => ({
		receiptId: accepted.receiptId, consumed: accepted.consumed.map(String), duplicate: accepted.duplicate,
		...(accepted.notificationErrors ? { notificationErrors: accepted.notificationErrors } : {}),
	});
	if (prepared.reused) {
		// An earlier POST may have succeeded even if its response was lost.
		// First query independent durable admission, before considering whether
		// current provider selection still permits a duplicate POST.
		let existing;
		try { existing = await input.query.findByClientTxnId(input.clientTxnId); }
		catch (error) { throw receiptTransportFailed(error instanceof Error ? error.message : "Receipt query unavailable on unchanged retry."); }
		if (existing) return result(await reconcile({ findByClientTxnId: async () => existing }));
	}
	try {
		input.beforePost?.();
		const authority = preflightFrozenProviderPins({ snapshot: prepared.snapshot,
			lookup: input.lookup, scope: input.scope, getPin: input.getPin });
		if (canonicalJson(authority.pins) !== canonicalJson(stored.body.attachmentProviderPins ?? [])) {
			throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Provider selection changed since the original prepared body; do not repin it.", retryable: false });
		}
		authority.assertCurrent();
		await input.postPrepared(stored);
	} catch (error) {
		const unknown = error && typeof error === "object" && "acceptanceUnknown" in error && error.acceptanceUnknown === true;
		if (unknown) {
			try {
				return result(await reconcile());
			} catch {
				// No independent proof. Retain the exact original body and surface
				// the unknown POST, never turn a failed query into a new txn.
			}
		}
		throw error;
	}
	return result(await reconcile());
}
