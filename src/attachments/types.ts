// Neutral attachment-provider contract (D/I/C-shared, type-only).
// I-K07-DECISION-01: Variant D, early neutral type commit.
// I-K07-REVIEW-01 F1: neither attachment-provider IDs nor file paths are
// trusted input; both must survive JSON round-trips (see comments).

/**
 * Resource kind under which attachment providers register.
 * Backend `PluginSetupContext.registerResource(kind, type)` accepts this kind
 * (`resource:` + `attachment-provider`); B2 looks the entries up via
 * CapabilityProjection.map("attachment-provider").
 */
export const ATTACHMENT_PROVIDER_RESOURCE_KIND =
	"resource:attachment-provider" as const;

/**
 * Opaque provider identifier inside the attachment-provider resource.
 * NEVER trusted as a path segment, never interpolated into URLs/Queries
 * without validation. Must survive a JSON round-trip.
 */
export type AttachmentProviderId = string;

/**
 * Provider-declared capability to prepare/commit one prepared upload.
 * Provider implementations stay OUTSIDE core: core defines only the
 * function shape, C registers concrete providers (e.g. core-note-providers).
 */
export interface AttachmentProviderPrepare {
	readonly providerId: AttachmentProviderId;
	readonly prepare: (
		input: AttachmentPrepareInput,
	) => Promise<AttachmentPrepareResult>;
}

/** Input for preparing one attachment for a message send. */
export interface AttachmentPrepareInput {
	/** Draft attachment id (client-side, opaque to the provider). */
	readonly draftAttachmentId: string;
	/** Declared mime type from schema negotiation (server-validated). */
	readonly mimeType: string;
	/** Declared byte length from schema negotiation (server-validated). */
	readonly byteLength: number;
}

/** Result of a successful prepare; persisted as admission proof. */
export interface AttachmentPrepareResult {
	/** Server-scope upload handle (opaque, JSON-safe). */
	readonly preparedUploadId: string;
	/** Provider echo of the negotiated mime type. */
	readonly mimeType: string;
	/** Provider echo of the negotiated byte length. */
	readonly byteLength: number;
}

// ---------------------------------------------------------------------------
// Provider seam (single home per I-K07-DECISION-01 §1 "Typen nur in
// src/attachments/types.ts"): implemented by providers OUTSIDE the browser
// core (core providers, C providers), consumed by the chat-ui core through a
// lookup function only. The chat-ui core never imports a provider module.
// ---------------------------------------------------------------------------

export type K07TileSize = "s" | "m" | "l";
export type K07TileKind = "note" | "image" | "file" | "custom";

export type K07MessagePart =
	| { kind: "json"; type: string; json: unknown }
	| { kind: "resource-ref"; resourceId: string };

export type K07AcceptNotice = {
	type: string;
	id: string;
	receiptId: string;
};

/**
 * Implemented schema window. Deliberate subset, no full JSON-Schema-2020-12
 * claim: type/required/properties/items/enum/minLength/maxLength/minimum/
 * maximum/const. Anything outside this window is rejected at declaration
 * time so providers never silently rely on unimplemented checks.
 */
export type K07SchemaNode = {
	type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
	required?: string[];
	properties?: Record<string, K07SchemaNode>;
	items?: K07SchemaNode;
	enum?: unknown[];
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	const?: unknown;
};

/**
 * Minimal frozen shape providers serialize. Structural subset of the draft
 * core's richer FrozenAttachment (which stays in the chat-ui core); providers
 * must not depend on chat-ui internals.
 */
export type K07FrozenAttachment = {
	readonly id: string;
	readonly revision: number;
	readonly type: string;
	readonly schemaVersion: number;
	readonly payload: unknown;
	readonly media?: readonly unknown[];
};

export type K07AttachmentProvider = {
	readonly type: string;
	readonly schemaVersions: readonly number[];
	readonly schemas: Readonly<Record<number, K07SchemaNode>>;
	validate(payload: unknown): void;
	snapshot(source: unknown, opts?: { draftId?: string }): unknown;
	serializeForMessage(frozen: K07FrozenAttachment): K07MessagePart;
	renderTile(payload: unknown): { title: string; kind: K07TileKind };
	fallbackTitle(payload: unknown): string;
	sizeHint(payload: unknown): { tile: K07TileSize };
	notifyAccepted?(info: K07AcceptNotice): void;
};

export type AttachmentProviderScope = {
	sessionId: string;
};

export type AttachmentProviderLookup = (
	type: string,
	scope: AttachmentProviderScope,
) => K07AttachmentProvider | undefined;
