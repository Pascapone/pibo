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
