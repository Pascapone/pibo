/** Browser-safe typed wire body. It consumes only a frozen draft snapshot,
 * session-selected provider pins and server-issued resource descriptors. The
 * descriptor lacks Session/transaction fields; the caller stages under the
 * same snapshot scope and the server rechecks it. Store this body BEFORE POST. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { invalidJson } from "../../../../attachments/json.js";
import { readAttachmentMessage } from "../../../../attachments/message.js";
import type { AttachmentProviderPin } from "../../../../attachments/types.js";
import type { AttachmentResourceDescriptor } from "../../../../attachments/resources.js";
import { captureMessageRequestBody, type MessageRequestBody } from "../../../../shared/message-content-binding.js";
import { normalizeDraftClientTxnId, type AttachmentSendSnapshot } from "./core-attachment-draft.js";

export function buildTypedAttachmentRequest(input: {
	snapshot: AttachmentSendSnapshot;
	pins: readonly AttachmentProviderPin[];
	resources: readonly AttachmentResourceDescriptor[];
	delivery: "queue" | "steer";
	roomId?: string;
	webAnnotationIds?: readonly string[];
	/** The existing upload-path picker cannot authorize typed media. */
	fileAttachmentPaths?: readonly string[];
}): MessageRequestBody {
	if (!input.snapshot || !Array.isArray(input.snapshot.attachments) || !input.snapshot.attachments.length
		|| typeof input.snapshot.sessionId !== "string" || !input.snapshot.sessionId
		|| typeof input.snapshot.clientTxnId !== "string" || !input.snapshot.clientTxnId
		|| typeof input.snapshot.text !== "string" || (input.delivery !== "queue" && input.delivery !== "steer")) {
		throw invalidJson("Typed attachment submission requires a frozen Session, transaction, text and records.");
	}
	if (normalizeDraftClientTxnId(input.snapshot.clientTxnId) !== input.snapshot.clientTxnId) throw invalidJson("Frozen transaction ID must already be normalized.");
	if (input.roomId !== undefined && (typeof input.roomId !== "string" || !input.roomId)) throw invalidJson("Room identity must be a nonempty string.");
	if (input.fileAttachmentPaths !== undefined && (!Array.isArray(input.fileAttachmentPaths) || input.fileAttachmentPaths.length)) throw invalidJson("Legacy upload paths cannot be sent with typed attachments.");
	if (!Array.isArray(input.pins) || !Array.isArray(input.resources)
		|| (input.webAnnotationIds !== undefined && (!Array.isArray(input.webAnnotationIds) || input.webAnnotationIds.some((id) => typeof id !== "string" || !id)))) {
		throw invalidJson("Typed provider pins, resources and annotation ids must be arrays.");
	}
	const pluginTypes = new Set(input.snapshot.attachments.map((record) => record.type).filter((type) => !type.startsWith("pibo.core/")));
	if (input.pins.length !== pluginTypes.size || input.pins.some((pin) => !pin || !pluginTypes.delete(pin.type)) || pluginTypes.size) {
		throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Typed records require exactly the selected provider pins.", retryable: false });
	}
	const media = new Map(input.snapshot.attachments.flatMap((record) => (record.media ?? []).map((entry) => [entry.draftResourceId, entry] as const)));
	if (media.size !== input.snapshot.attachments.reduce((sum, record) => sum + (record.media?.length ?? 0), 0)
		|| input.resources.length !== media.size) throw invalidJson("Every frozen media identity requires exactly one server resource.");
	const used = new Set<string>();
	const bindings = input.resources.map((resource) => {
		const expected = resource && media.get(resource.draftResourceId);
		if (!expected || used.has(resource.draftResourceId) || resource.draftResourceId.length > 4096
			|| resource.mimeType !== expected.mimeType || resource.bytes !== expected.bytes
			|| resource.state !== "prepared" || typeof resource.preparedUploadId !== "string" || !/^attres_[a-f0-9-]+$/.test(resource.preparedUploadId)) {
			throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Prepared resource does not match the frozen scoped media.", retryable: false });
		}
		used.add(resource.draftResourceId);
		return { draftResourceId: resource.draftResourceId, preparedUploadId: resource.preparedUploadId };
	});
	const body = captureMessageRequestBody({
		admissionVersion: 2, contentBindingVersion: 1, attachmentVersion: 1,
		piboSessionId: input.snapshot.sessionId, clientTxnId: input.snapshot.clientTxnId,
		text: input.snapshot.text, delivery: input.delivery,
		...(input.roomId ? { roomId: input.roomId } : {}),
		...(input.webAnnotationIds?.length ? { webAnnotationIds: input.webAnnotationIds } : {}),
		attachments: input.snapshot.attachments, attachmentProviderPins: input.pins, attachmentResources: bindings,
	});
	// Shared strict version/media shape, browser safe. Server independently
	// checks effective pins and exact byte grants before durable admission.
	if (!readAttachmentMessage(body)) throw invalidJson("Typed attachment envelope was not captured.");
	return body;
}
