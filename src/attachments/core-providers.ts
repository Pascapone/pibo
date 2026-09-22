/**
 * K07 v1 core attachment providers (D1-G1, productive vertical).
 *
 * Lives OUTSIDE the browser core per I-K07-DECISION-01 §1 (the chat-ui core
 * never imports this module; providers reach it only through the lookup
 * seam). The three core types every host supports without plugins: note
 * (JSON-only), image and file (JSON payload plus a blob reference; bytes
 * live in the blob store, never inline). Providers validate domain payloads,
 * capture DOM-free JSON snapshots, serialize the frozen message
 * contribution, and describe tiles/fallbacks. The core builds the message;
 * providers never touch storage, network, or the draft core.
 */

import { AttachmentDraftError } from "./errors.js";
import type {
	K07AttachmentProvider,
	K07FrozenAttachment,
	K07MessagePart,
	K07SchemaNode,
} from "./types.js";

export const CORE_NOTE_TYPE = "pibo.core/note";
export const CORE_IMAGE_TYPE = "pibo.core/image";
export const CORE_FILE_TYPE = "pibo.core/file";
export const CORE_PROVIDER_TYPES = [CORE_NOTE_TYPE, CORE_IMAGE_TYPE, CORE_FILE_TYPE] as const;

const NOTE_SCHEMA_V1: K07SchemaNode = {
	type: "object",
	required: ["text"],
	properties: {
		title: { type: "string", maxLength: 200 },
		text: { type: "string", minLength: 1, maxLength: 2000 },
	},
};

const IMAGE_SCHEMA_V1: K07SchemaNode = {
	type: "object",
	required: ["alt"],
	properties: {
		title: { type: "string", maxLength: 200 },
		alt: { type: "string", minLength: 1, maxLength: 1000 },
	},
};

const FILE_SCHEMA_V1: K07SchemaNode = {
	type: "object",
	required: ["name"],
	properties: {
		name: { type: "string", minLength: 1, maxLength: 255 },
		mimeType: { type: "string", maxLength: 160 },
		bytes: { type: "integer", minimum: 0 },
	},
};

function notePayloadText(payload: { title?: unknown; text?: unknown }): string {
	return typeof payload.text === "string" ? payload.text : "";
}

function snapshotNote(source: unknown): unknown {
	if (typeof source !== "object" || source === null || Array.isArray(source)) {
		throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Note source must be an object.", retryable: false });
	}
	const record = source as Record<string, unknown>;
	return {
		...(typeof record.title === "string" ? { title: record.title } : {}),
		text: typeof record.text === "string" ? record.text : "",
	};
}

function snapshotMediaFields(source: unknown, label: string): { title?: string } {
	if (typeof source !== "object" || source === null || Array.isArray(source)) {
		throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: `${label} source must be an object.`, retryable: false });
	}
	const record = source as Record<string, unknown>;
	return typeof record.title === "string" ? { title: record.title } : {};
}

function jsonPart(frozen: K07FrozenAttachment): K07MessagePart {
	return {
		kind: "json",
		type: frozen.type,
		json: {
			id: frozen.id,
			revision: frozen.revision,
			schemaVersion: frozen.schemaVersion,
			payload: frozen.payload,
			...(frozen.media !== undefined ? { media: frozen.media } : {}),
		},
	};
}

function noteTileTitle(payload: unknown): string {
	const record = (typeof payload === "object" && payload !== null ? payload : {}) as { title?: unknown; text?: unknown };
	return typeof record.title === "string" && record.title ? record.title : notePayloadText(record).slice(0, 80);
}

function imageTileTitle(payload: unknown): string {
	const record = (typeof payload === "object" && payload !== null ? payload : {}) as { title?: unknown; alt?: unknown };
	const title = typeof record.title === "string" && record.title ? record.title : typeof record.alt === "string" ? record.alt : "";
	return title.slice(0, 80) || "image";
}

function fileTileTitle(payload: unknown): string {
	const record = (typeof payload === "object" && payload !== null ? payload : {}) as { title?: unknown; name?: unknown };
	const title = typeof record.title === "string" && record.title ? record.title : typeof record.name === "string" ? record.name : "";
	return title.slice(0, 80) || "file";
}

export const coreNoteProvider: K07AttachmentProvider = {
	type: CORE_NOTE_TYPE,
	schemaVersions: [1],
	schemas: { 1: NOTE_SCHEMA_V1 },
	validate(payload: unknown): void {
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Note payload must be an object.", retryable: false });
		}
		if (notePayloadText(payload as { title?: unknown; text?: unknown }).trim().length === 0) {
			throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Note payload needs non-blank text.", retryable: false });
		}
	},
	snapshot(source: unknown): unknown {
		return snapshotNote(source);
	},
	serializeForMessage(frozen: K07FrozenAttachment): K07MessagePart {
		return jsonPart(frozen);
	},
	renderTile(payload: unknown): { title: string; kind: "note" } {
		return { title: noteTileTitle(payload), kind: "note" };
	},
	fallbackTitle(payload: unknown): string {
		return `Note: ${noteTileTitle(payload) || "untitled"}`;
	},
	sizeHint(): { tile: "s" } {
		return { tile: "s" };
	},
};

export const coreImageProvider: K07AttachmentProvider = {
	type: CORE_IMAGE_TYPE,
	schemaVersions: [1],
	schemas: { 1: IMAGE_SCHEMA_V1 },
	validate(payload: unknown): void {
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Image payload must be an object.", retryable: false });
		}
	},
	snapshot(source: unknown): unknown {
		const fields = snapshotMediaFields(source, "Image");
		const record = source as Record<string, unknown>;
		return { ...fields, alt: typeof record.alt === "string" ? record.alt : "" };
	},
	serializeForMessage(frozen: K07FrozenAttachment): K07MessagePart {
		return jsonPart(frozen);
	},
	renderTile(payload: unknown): { title: string; kind: "image" } {
		return { title: imageTileTitle(payload), kind: "image" };
	},
	fallbackTitle(payload: unknown): string {
		return `Image: ${imageTileTitle(payload)}`;
	},
	sizeHint(): { tile: "m" } {
		return { tile: "m" };
	},
};

export const coreFileProvider: K07AttachmentProvider = {
	type: CORE_FILE_TYPE,
	schemaVersions: [1],
	schemas: { 1: FILE_SCHEMA_V1 },
	validate(payload: unknown): void {
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "File payload must be an object.", retryable: false });
		}
	},
	snapshot(source: unknown): unknown {
		const fields = snapshotMediaFields(source, "File");
		const record = source as Record<string, unknown>;
		return {
			...fields,
			name: typeof record.name === "string" ? record.name : "",
			...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
			...(typeof record.bytes === "number" ? { bytes: record.bytes } : {}),
		};
	},
	serializeForMessage(frozen: K07FrozenAttachment): K07MessagePart {
		return jsonPart(frozen);
	},
	renderTile(payload: unknown): { title: string; kind: "file" } {
		return { title: fileTileTitle(payload), kind: "file" };
	},
	fallbackTitle(payload: unknown): string {
		return `File: ${fileTileTitle(payload)}`;
	},
	sizeHint(): { tile: "m" } {
		return { tile: "m" };
	},
};

export const CORE_PROVIDERS: K07AttachmentProvider[] = [coreNoteProvider, coreImageProvider, coreFileProvider];
