import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import type { PiboJsonValue } from "../core/events.js";

const MAX_SYNC_PAYLOAD_GZIP_BYTES = 512 * 1024;

export type PayloadWriteInput = {
	value: PiboJsonValue | string | Uint8Array;
	contentType?: string;
	retentionClass: string;
	id?: string;
	createdAt?: string;
};

export type StoredPayload = {
	id: string;
	sha256: string;
	storageKind: string;
	storagePath?: string;
	contentType: string;
	encoding: string;
	byteSize: number;
	compressedByteSize?: number;
	previewText?: string;
	retentionClass: string;
	refCount: number;
	status: string;
	createdAt: string;
	lastVerifiedAt?: string;
};

type PayloadRow = {
	id: string;
	sha256: string;
	storage_kind: string;
	storage_path: string | null;
	content_type: string;
	encoding: string;
	byte_size: number;
	compressed_byte_size: number | null;
	preview_text: string | null;
	retention_class: string;
	ref_count: number;
	status: string;
	created_at: string;
	last_verified_at: string | null;
};

export class PayloadStore {
	private readonly db: DatabaseSync;
	private readonly rootDir: string;

	constructor(db: DatabaseSync, rootDir = piboHomePath("payloads")) {
		this.db = db;
		this.rootDir = rootDir === ":memory:" ? rootDir : resolve(rootDir);
		if (this.rootDir !== ":memory:") mkdirSync(this.rootDir, { recursive: true });
	}

	writePayload(input: PayloadWriteInput): StoredPayload {
		const contentType = input.contentType ?? defaultContentType(input.value);
		const createdAt = input.createdAt ?? new Date().toISOString();
		const bytes = payloadToBytes(input.value, contentType);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const existing = this.findBySha256(sha256);
		if (existing) {
			this.db.prepare("UPDATE payloads SET ref_count = ref_count + 1 WHERE id = ?").run(existing.id);
			return this.getPayload(existing.id) ?? existing;
		}

		const shouldCompress = bytes.byteLength <= MAX_SYNC_PAYLOAD_GZIP_BYTES;
		const encoding = shouldCompress ? "gzip" : "identity";
		const bytesToStore = shouldCompress ? gzipSync(bytes) : bytes;
		const compressedByteSize = shouldCompress ? bytesToStore.byteLength : null;
		const relativePath = buildRelativePayloadPath(sha256, contentType, encoding);
		const absolutePath = this.rootDir === ":memory:" ? relativePath : join(this.rootDir, relativePath);
		writePayloadFile(absolutePath, bytesToStore);
		const id = input.id ?? `payload_${randomUUID()}`;
		this.db.prepare(`
			INSERT INTO payloads (
				id,
				sha256,
				storage_kind,
				storage_path,
				content_type,
				encoding,
				byte_size,
				compressed_byte_size,
				preview_text,
				retention_class,
				ref_count,
				status,
				created_at,
				last_verified_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			id,
			sha256,
			"file",
			relativePath,
			contentType,
			encoding,
			bytes.byteLength,
			compressedByteSize,
			previewTextFromValue(input.value) ?? null,
			input.retentionClass,
			1,
			"committed",
			createdAt,
			createdAt,
		);
		const stored = this.getPayload(id);
		if (!stored) throw new Error(`Failed to persist payload \"${id}\"`);
		return stored;
	}

	getPayload(id: string): StoredPayload | undefined {
		const row = this.db.prepare("SELECT * FROM payloads WHERE id = ?").get(id) as PayloadRow | undefined;
		return row ? payloadFromRow(row) : undefined;
	}

	readPayloadBytes(id: string): Uint8Array {
		const payload = this.getPayload(id);
		if (!payload) throw new Error(`Unknown payload \"${id}\"`);
		if (!payload.storagePath) throw new Error(`Payload \"${id}\" has no storage path`);
		const absolutePath = this.rootDir === ":memory:" ? payload.storagePath : join(this.rootDir, payload.storagePath);
		const bytes = readFileSync(absolutePath);
		if (payload.encoding === "gzip") return gunzipSync(bytes);
		if (payload.encoding === "identity") return bytes;
		throw new Error(`Unsupported payload encoding \"${payload.encoding}\"`);
	}

	readPayloadText(id: string): string {
		return Buffer.from(this.readPayloadBytes(id)).toString("utf8");
	}

	readPayloadJson(id: string): PiboJsonValue {
		return JSON.parse(this.readPayloadText(id)) as PiboJsonValue;
	}

	readPayloadBytesBounded(id: string, maxBytes: number): Uint8Array {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive safe integer");
		const payload = this.getPayload(id);
		if (!payload) throw new Error(`Unknown payload \"${id}\"`);
		if (!payload.storagePath) throw new Error(`Payload \"${id}\" has no storage path`);
		if (payload.byteSize > maxBytes) throw new RangeError(`Payload \"${id}\" exceeds the ${maxBytes}-byte read limit`);
		const absolutePath = this.rootDir === ":memory:" ? payload.storagePath : join(this.rootDir, payload.storagePath);
		const storedBytes = readFileBounded(absolutePath, maxBytes + 64 * 1024);
		let bytes: Uint8Array;
		if (payload.encoding === "gzip") bytes = gunzipSync(storedBytes, { maxOutputLength: maxBytes });
		else if (payload.encoding === "identity") bytes = storedBytes;
		else throw new Error(`Unsupported payload encoding \"${payload.encoding}\"`);
		if (bytes.byteLength !== payload.byteSize) throw new Error(`Payload \"${id}\" byte length does not match its metadata`);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		if (sha256 !== payload.sha256) throw new Error(`Payload \"${id}\" checksum does not match its metadata`);
		return bytes;
	}

	readPayloadJsonBounded(id: string, maxBytes: number): PiboJsonValue {
		return JSON.parse(Buffer.from(this.readPayloadBytesBounded(id, maxBytes)).toString("utf8")) as PiboJsonValue;
	}

	findBySha256(sha256: string): StoredPayload | undefined {
		const row = this.db.prepare("SELECT * FROM payloads WHERE sha256 = ?").get(sha256) as PayloadRow | undefined;
		return row ? payloadFromRow(row) : undefined;
	}

	releaseReferences(id: string, count = 1): StoredPayload | undefined {
		if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("count must be a positive safe integer");
		const row = this.db.prepare("SELECT * FROM payloads WHERE id = ?").get(id) as PayloadRow | undefined;
		if (!row) return undefined;
		if (row.ref_count > count) {
			this.db.prepare("UPDATE payloads SET ref_count = ref_count - ? WHERE id = ?").run(count, id);
			return undefined;
		}
		this.db.prepare("DELETE FROM payloads WHERE id = ?").run(id);
		return payloadFromRow(row);
	}

	removeReleasedFile(payload: StoredPayload): void {
		if (payload.storageKind !== "file" || !payload.storagePath) return;
		const absolutePath = this.rootDir === ":memory:" ? payload.storagePath : join(this.rootDir, payload.storagePath);
		rmSync(absolutePath, { force: true });
	}
}

function readFileBounded(path: string, maxBytes: number): Buffer {
	const descriptor = openSync(path, "r");
	try {
		const stats = fstatSync(descriptor);
		if (!stats.isFile()) throw new Error(`Payload path is not a file: ${path}`);
		if (stats.size > maxBytes) throw new RangeError(`Stored payload exceeds the ${maxBytes}-byte read limit`);
		const bytes = Buffer.alloc(stats.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
			if (read === 0) break;
			offset += read;
		}
		if (offset !== bytes.byteLength) throw new Error(`Stored payload changed while it was being read: ${path}`);
		const extra = Buffer.alloc(1);
		if (readSync(descriptor, extra, 0, 1, offset) !== 0) throw new RangeError(`Stored payload exceeds the ${maxBytes}-byte read limit`);
		return bytes;
	} finally {
		closeSync(descriptor);
	}
}

function defaultContentType(value: PayloadWriteInput["value"]): string {
	if (typeof value === "string") return "text/plain; charset=utf-8";
	if (value instanceof Uint8Array) return "application/octet-stream";
	return "application/json";
}

function payloadToBytes(value: PayloadWriteInput["value"], contentType: string): Uint8Array {
	if (typeof value === "string") return Buffer.from(value, "utf8");
	if (value instanceof Uint8Array) return value;
	if (contentType.includes("json")) return Buffer.from(JSON.stringify(value), "utf8");
	return Buffer.from(String(value), "utf8");
}

function previewTextFromValue(value: PayloadWriteInput["value"]): string | undefined {
	if (value instanceof Uint8Array) return undefined;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 1024) : undefined;
}

function buildRelativePayloadPath(sha256: string, contentType: string, encoding: string): string {
	const extension = extensionForContentType(contentType);
	const suffix = encoding === "gzip" ? `${extension}.gz` : extension;
	return join("sha256", sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${suffix}`);
}

function extensionForContentType(contentType: string): string {
	if (contentType.includes("json")) return "json";
	if (contentType.startsWith("text/")) return "txt";
	return "bin";
}

function writePayloadFile(path: string, bytes: Uint8Array): void {
	if (existsSync(path)) return;
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp-${randomUUID()}${extname(path)}`;
	try {
		writeFileSync(tempPath, bytes);
		if (!existsSync(path)) renameSync(tempPath, path);
	} finally {
		if (existsSync(tempPath)) rmSync(tempPath, { force: true });
	}
}

function payloadFromRow(row: PayloadRow): StoredPayload {
	return {
		id: row.id,
		sha256: row.sha256,
		storageKind: row.storage_kind,
		storagePath: row.storage_path ?? undefined,
		contentType: row.content_type,
		encoding: row.encoding,
		byteSize: row.byte_size,
		compressedByteSize: row.compressed_byte_size ?? undefined,
		previewText: row.preview_text ?? undefined,
		retentionClass: row.retention_class,
		refCount: row.ref_count,
		status: row.status,
		createdAt: row.created_at,
		lastVerifiedAt: row.last_verified_at ?? undefined,
	};
}
