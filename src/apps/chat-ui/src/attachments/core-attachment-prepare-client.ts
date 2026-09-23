/** Private persisted-first typed preparation. No Composer caller yet. Provider
 * selection, byte staging and network complete outside IDB; freeze/prepare
 * are separate CAS commands. A lost POST response retries stored wire bytes. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { invalidJson } from "../../../../attachments/json.js";
import type { AttachmentProviderLookup, AttachmentProviderPin, AttachmentProviderScope } from "../../../../attachments/types.js";
import type { AttachmentResourceDescriptor } from "../../../../attachments/resources.js";
import type { AttachmentPreparedSubmission, AttachmentSendSnapshot } from "./core-attachment-draft.js";
import { normalizeDraftClientTxnId } from "./core-attachment-draft.js";
import type { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft.js";
import { freezeWithProviderPins, preflightFrozenProviderPins } from "./core-attachment-provider-commands.js";
import { MAX_WEB_REQUEST_BODY_BYTES } from "../../../../shared/web-body-limit.js";
import { stageFrozenAttachmentResources } from "./core-attachment-resource-client.js";
import { buildTypedAttachmentRequest } from "./core-attachment-typed-request.js";

type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
type PinLookup = (type: string, scope: AttachmentProviderScope) => AttachmentProviderPin | undefined;
export type IndexedPreparedAttachmentSubmission = { snapshot: AttachmentSendSnapshot; prepared: AttachmentPreparedSubmission; revision: number; reused: boolean };

/** A conservative margin includes multipart field names, headers, scope and
 * boundary overhead (IDs/MIME are separately bounded). It never widens the
 * server's 4 MiB whole-request ceiling; the exact Request is checked again
 * at staging. Chunk transport remains absent. */
function stageableBeforeFreeze(attachments: readonly { media?: readonly { bytes: number; mimeType: string }[] }[]): void {
	for (const record of attachments) for (const item of record.media ?? []) {
		if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes >= MAX_WEB_REQUEST_BODY_BYTES - 16 * 1024) {
			throw new AttachmentDraftError({ code: "ATT_LIMIT_EXCEEDED", message: "This attachment needs chunk transport before it can be frozen for HTTP upload.", retryable: false });
		}
		// File.type lowercases MIME and its parameters. The server snapshots
		// file.type, so noncanonical stored MIME could never match frozen media.
		if (typeof item.mimeType !== "string" || new File([], "attachment", { type: item.mimeType }).type !== item.mimeType) {
			throw invalidJson("Frozen media MIME must survive multipart File.type unchanged.");
		}
	}
}

export async function prepareTypedIndexedSubmission(input: {
	draft: Draft;
	expectedRevision: number;
	lookup: AttachmentProviderLookup;
	getPin: PinLookup;
	scope: AttachmentProviderScope;
	clientTxnId: string;
	text: string;
	delivery: "queue" | "steer";
	roomId?: string;
	webAnnotationIds?: readonly string[];
	fileAttachmentPaths?: readonly string[];
	/** Fake stage is a module-test seam; production always uses scoped HTTP. */
	stageResources?: (draft: Draft, snapshot: AttachmentSendSnapshot) => Promise<AttachmentResourceDescriptor[]>;
}): Promise<IndexedPreparedAttachmentSubmission> {
	if (input.scope.sessionId !== input.draft.sessionId) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Provider scope differs from browser Pibo Session.", retryable: false });
	const txn = normalizeDraftClientTxnId(input.clientTxnId);
	if (txn !== input.clientTxnId || typeof input.text !== "string") throw invalidJson("Prepared transaction must have normalized identity and text.");
	if (input.delivery !== "queue" && input.delivery !== "steer") throw invalidJson("Typed delivery must be queue or steer.");
	if (input.roomId !== undefined && (typeof input.roomId !== "string" || !input.roomId)) throw invalidJson("Room identity must be a nonempty string.");
	if (input.webAnnotationIds !== undefined && (!Array.isArray(input.webAnnotationIds) || input.webAnnotationIds.some((id) => typeof id !== "string" || !id))) throw invalidJson("Annotation identities must be nonempty strings.");
	if (input.fileAttachmentPaths !== undefined && (!Array.isArray(input.fileAttachmentPaths) || input.fileAttachmentPaths.length)) throw invalidJson("Legacy upload paths cannot enter typed preparation.");
	const loaded = await input.draft.load();
	const prior = Object.hasOwn(loaded.view.preparedSubmissions, txn) ? loaded.view.preparedSubmissions[txn] : undefined;
	if (prior) {
		const snapshot = loaded.view.openSnapshots.find((entry) => entry.clientTxnId === txn);
		const body = prior.body;
		const oldAnnotations = Array.isArray(body.webAnnotationIds) ? body.webAnnotationIds : [];
		if (!snapshot || snapshot.sessionId !== input.draft.sessionId || snapshot.text !== input.text || body.delivery !== input.delivery
			|| (body.roomId ?? undefined) !== (input.roomId || undefined)
			|| JSON.stringify(oldAnnotations) !== JSON.stringify(input.webAnnotationIds ?? [])) {
			throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Transaction already has a different prepared request; retry its original frozen body.", retryable: false });
		}
		return { snapshot, prepared: prior, revision: loaded.revision, reused: true };
	}
	if (loaded.revision !== input.expectedRevision) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Attachment draft changed; reload before preparing.", retryable: false });
	const bound = loaded.view.openSnapshots.find((entry) => entry.clientTxnId === txn);
	let snapshot: AttachmentSendSnapshot;
	let revision: number;
	if (bound) {
		if (bound.text !== input.text) throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "This transaction is bound to different original text.", retryable: false });
		// A concurrent live edit does not rewrite the already bound original.
		// Validate its FROZEN value, not the now-different live record set.
		snapshot = bound;
		revision = loaded.revision;
	} else {
		if (!loaded.view.records.length) throw invalidJson("Typed preparation requires at least one live attachment.");
		stageableBeforeFreeze(loaded.view.records);
		const frozen = await freezeWithProviderPins({ draft: input.draft, expectedRevision: loaded.revision, lookup: input.lookup,
			scope: input.scope, getPin: input.getPin, clientTxnId: txn, text: input.text });
		snapshot = frozen.snapshot;
		revision = frozen.revision;
	}
	stageableBeforeFreeze(snapshot.attachments);
	const authority = preflightFrozenProviderPins({ snapshot, lookup: input.lookup, scope: input.scope, getPin: input.getPin });
	const resources = await (input.stageResources ?? ((draft, original) => stageFrozenAttachmentResources({ draft, snapshot: original })))(input.draft, snapshot);
	authority.assertCurrent();
	const body = buildTypedAttachmentRequest({ snapshot, pins: authority.pins, resources, delivery: input.delivery,
		roomId: input.roomId, webAnnotationIds: input.webAnnotationIds, fileAttachmentPaths: input.fileAttachmentPaths });
	const stored = await input.draft.execute(revision, { kind: "prepare", snapshot, body });
	return { snapshot, prepared: stored.result, revision: stored.current.revision, reused: false };
}
