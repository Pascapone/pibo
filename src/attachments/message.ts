import { canonicalJson } from "../shared/deterministic-digest.js";
import { AttachmentDraftError } from "./errors.js";
import { assertJsonValue, cloneJson, invalidJson, isPlainJsonObject } from "./json.js";
import { createProviderRegistryClient, requireSynchronousProviderResult } from "./providers.js";
import type { AttachmentProviderLookup, AttachmentProviderPin, K07FrozenAttachment, K07MessagePart } from "./types.js";

export const ATTACHMENT_MESSAGE_VERSION = 1;
export type AttachmentMessageMedia = { draftResourceId: string; mimeType: string; bytes: number };
export type AttachmentMessageRecord = Omit<K07FrozenAttachment, "media"> & { media?: readonly AttachmentMessageMedia[] };
export type AttachmentResourceBinding = { draftResourceId: string; preparedUploadId: string };
export type AttachmentMessage = { attachments: AttachmentMessageRecord[]; pins: AttachmentProviderPin[]; resources: AttachmentResourceBinding[] };
/** Only a Core resource authority may produce this; plugin JSON is never a path authority. */
export type ResolvedAttachmentResource = { resourceId: string; draftResourceId: string; mimeType: string; bytes: number; name: string; path: string };
export type AttachmentResourceResolver = (binding: AttachmentResourceBinding, media: AttachmentMessageMedia) => ResolvedAttachmentResource;
export type AttachmentHistorySnapshot = { formatVersion: 1; attachments: AttachmentMessageRecord[]; providerPins: AttachmentProviderPin[]; resources: Omit<ResolvedAttachmentResource, "path">[] };

export function attachmentJson(value: unknown): string {
	try { return canonicalJson(value); } catch { throw invalidJson("Attachment content could not be canonically serialized."); }
}

function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function integer(value: unknown, minimum: number): value is number { return Number.isSafeInteger(value) && (value as number) >= minimum; }
function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidJson(`Unexpected ${label} field.`);
}

/** Explicit versioning leaves legacy plugin extension inputs uninterpreted. */
export function readAttachmentMessage(body: Record<string, unknown>): AttachmentMessage | undefined {
	if (body.attachmentVersion === undefined) return undefined;
	if (body.attachmentVersion !== ATTACHMENT_MESSAGE_VERSION || body.admissionVersion !== 2 || body.contentBindingVersion !== 1) throw invalidJson("Attachments require version 1 with content-bound durable admission.");
	if (body.fileAttachmentPaths !== undefined && (!Array.isArray(body.fileAttachmentPaths) || body.fileAttachmentPaths.length)) throw invalidJson("Typed attachments require resource bindings, not legacy file paths.");
	if (!Array.isArray(body.attachments) || !Array.isArray(body.attachmentProviderPins) || !Array.isArray(body.attachmentResources)) throw invalidJson("Attachments, provider pins and resource bindings must be arrays.");
	assertJsonValue(body.attachments, "Attachments");
	assertJsonValue(body.attachmentProviderPins, "Attachment provider pins");
	assertJsonValue(body.attachmentResources, "Attachment resources");
	const ids = new Set<string>();
	const attachments = body.attachments.map((value): AttachmentMessageRecord => {
		if (!isPlainJsonObject(value)) throw invalidJson("Attachment must be an object.");
		fields(value, ["id", "revision", "type", "schemaVersion", "payload", "media"], "attachment envelope");
		if (!nonempty(value.id) || ids.has(value.id) || !nonempty(value.type) || !integer(value.revision, 1) || !integer(value.schemaVersion, 1) || !Object.hasOwn(value, "payload")) throw invalidJson("Invalid or duplicate attachment identity.");
		ids.add(value.id);
		let media: AttachmentMessageMedia[] | undefined;
		if (value.media !== undefined) {
			if (!Array.isArray(value.media)) throw invalidJson("Attachment media must be an array.");
			const mediaIds = new Set<string>();
			media = value.media.map((item) => {
				if (!isPlainJsonObject(item)) throw invalidJson("Attachment media must be an object.");
				fields(item, ["draftResourceId", "mimeType", "bytes"], "attachment media");
				if (!nonempty(item.draftResourceId) || mediaIds.has(item.draftResourceId) || !nonempty(item.mimeType) || !integer(item.bytes, 0)) throw invalidJson("Invalid or duplicate attachment media identity.");
				mediaIds.add(item.draftResourceId);
				return { draftResourceId: item.draftResourceId, mimeType: item.mimeType, bytes: item.bytes };
			});
		}
		return { id: value.id, revision: value.revision, type: value.type, schemaVersion: value.schemaVersion, payload: cloneJson(value.payload), ...(media ? { media } : {}) };
	});
	const pins = body.attachmentProviderPins.map((value): AttachmentProviderPin => {
		if (!isPlainJsonObject(value)) throw invalidJson("Attachment provider pin must be an object.");
		fields(value, ["type", "pluginId", "contributionId", "revision", "contentHash"], "attachment provider pin");
		if (!nonempty(value.type) || !nonempty(value.pluginId) || !nonempty(value.contributionId) || !nonempty(value.revision) || !nonempty(value.contentHash)) throw invalidJson("Invalid attachment provider pin.");
		return { type: value.type, pluginId: value.pluginId, contributionId: value.contributionId, revision: value.revision, contentHash: value.contentHash };
	});
	const resourceIds = new Set<string>();
	const resources = body.attachmentResources.map((value): AttachmentResourceBinding => {
		if (!isPlainJsonObject(value)) throw invalidJson("Attachment resource binding must be an object.");
		fields(value, ["draftResourceId", "preparedUploadId"], "attachment resource binding");
		if (!nonempty(value.draftResourceId) || resourceIds.has(value.draftResourceId) || !nonempty(value.preparedUploadId)) throw invalidJson("Invalid or duplicate attachment resource binding.");
		resourceIds.add(value.draftResourceId);
		return { draftResourceId: value.draftResourceId, preparedUploadId: value.preparedUploadId };
	});
	const usedResources = new Set(attachments.flatMap((attachment) => (attachment.media ?? []).map((media) => media.draftResourceId)));
	if (usedResources.size !== resourceIds.size || [...usedResources].some((id) => !resourceIds.has(id))) throw invalidJson("Every attachment media reference requires exactly one resource binding.");
	return { attachments, pins, resources };
}

/** Plain user content only: no provider result can select roles, tools or sessions. */
export function materializeAttachmentMessage(input: {
	message: AttachmentMessage;
	sessionId: string;
	lookup: AttachmentProviderLookup;
	resolveResource?: AttachmentResourceResolver;
}) {
	const registry = createProviderRegistryClient(input.lookup, { sessionId: input.sessionId });
	const resources = new Map<string, ResolvedAttachmentResource>();
	const parts: K07MessagePart[] = [];
	for (const attachment of input.message.attachments) {
		// Validators/serializers receive detached values, never the captured wire body.
		registry.validatePayload(attachment.type, attachment.schemaVersion, cloneJson(attachment.payload));
		const media = (attachment.media ?? []).map((item) => {
			const binding = input.message.resources.find((candidate) => candidate.draftResourceId === item.draftResourceId)!;
			const resolved = resources.get(item.draftResourceId) ?? input.resolveResource?.(binding, item);
			if (!resolved) throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Attachment bytes have no authorized resource binding.", retryable: false });
			if (resolved.draftResourceId !== item.draftResourceId || resolved.mimeType !== item.mimeType || resolved.bytes !== item.bytes) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Attachment resource metadata does not match its frozen media.", retryable: false });
			resources.set(item.draftResourceId, resolved);
			// Filesystem paths are Core-only. Providers get only verified opaque refs.
			return { resourceId: resolved.resourceId, draftResourceId: resolved.draftResourceId, mimeType: resolved.mimeType, bytes: resolved.bytes, name: resolved.name };
		});
		const frozen = cloneJson({ ...attachment, ...(attachment.media !== undefined ? { media } : {}) });
		const part = requireSynchronousProviderResult(registry.require(attachment.type).serializeForMessage(frozen), "serialization");
		assertJsonValue(part, "Serialized attachment");
		if (!isPlainJsonObject(part)) throw invalidJson("Serialized attachment must be an object.");
		if (part.kind === "json" && part.type === attachment.type && Object.hasOwn(part, "json")) {
			fields(part, ["kind", "type", "json"], "serialized attachment");
			parts.push({ kind: "json", type: attachment.type, json: cloneJson(part.json) });
		} else if (part.kind === "resource-ref" && nonempty(part.resourceId) && media.some((item) => item.resourceId === part.resourceId)) {
			fields(part, ["kind", "resourceId"], "serialized attachment");
			parts.push({ kind: "resource-ref", resourceId: part.resourceId });
		} else {
			throw new AttachmentDraftError({ code: "ATT_MATERIALIZE_FAILED", message: "Provider returned an invalid attachment contribution or an unowned resource reference.", retryable: false });
		}
	}
	const resolvedResources = [...resources.values()];
	const content = parts.length ? `[attached_content]\n${attachmentJson(parts)}\n[/attached_content]` : "";
	// Preserve the exact JSON-only materialization. Only Core-resolved media adds
	// this user-content block; providers never receive or nominate these paths.
	const resourceContext = resolvedResources.length ? `\n[attached_resources]\n${attachmentJson(resolvedResources)}\n[/attached_resources]` : "";
	return { parts, resources: resolvedResources, modelContext: `${content}${resourceContext}` };
}
