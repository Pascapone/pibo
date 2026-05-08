import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import type { PiboJsonValue } from "../core/events.js";

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

		const compressed = gzipSync(bytes);
		const relativePath = buildRelativePayloadPath(sha256, contentType);
		const absolutePath = this.rootDir === ":memory:" ? relativePath : join(this.rootDir, relativePath);
		writeCompressedPayloadFile(absolutePath, compressed);
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
			"gzip",
			bytes.byteLength,
			compressed.byteLength,
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
		return gunzipSync(bytes);
	}

	readPayloadText(id: string): string {
		return Buffer.from(this.readPayloadBytes(id)).toString("utf8");
	}

	readPayloadJson(id: string): PiboJsonValue {
		return JSON.parse(this.readPayloadText(id)) as PiboJsonValue;
	}

	findBySha256(sha256: string): StoredPayload | undefined {
		const row = this.db.prepare("SELECT * FROM payloads WHERE sha256 = ?").get(sha256) as PayloadRow | undefined;
		return row ? payloadFromRow(row) : undefined;
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

function buildRelativePayloadPath(sha256: string, contentType: string): string {
	const extension = extensionForContentType(contentType);
	return join("sha256", sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${extension}.gz`);
}

function extensionForContentType(contentType: string): string {
	if (contentType.includes("json")) return "json";
	if (contentType.startsWith("text/")) return "txt";
	return "bin";
}

function writeCompressedPayloadFile(path: string, compressed: Uint8Array): void {
	if (existsSync(path)) return;
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp-${randomUUID()}${extname(path)}`;
	try {
		writeFileSync(tempPath, compressed);
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
