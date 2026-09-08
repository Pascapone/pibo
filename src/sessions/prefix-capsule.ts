import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, link, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { piboHomePath } from "../core/pibo-home.js";
import type { PiboJsonObject } from "../core/events.js";

export const SESSION_PREFIX_METADATA_KEY = "piboSessionPrefix";
export const SESSION_PREFIX_RESOURCES_KEY = "piboSessionPrefixResources";
export const SESSION_PREFIX_TRANSITION_KEY = "piboSessionPrefixTransition";
export const PREFIX_CAPSULE_FORMAT = 1;
export const MAX_PREFIX_CAPSULE_BYTES = 128 * 1024 * 1024;

export type PrefixCapsuleReference = {
	format: 1;
	digest: string;
	bytes: number;
	adapterId: string;
	codec: string;
};

export type SessionPrefixBinding = {
	format: 1;
	epoch: number;
	status: "sealed";
	capsule: PrefixCapsuleReference;
	reason: "initial" | "compaction" | "model-change" | "runtime-change" | "explicit-refresh" | "fork";
	nativeSessionId: string;
	/** A claim about captured inputs, never about a provider cache hit. */
	evidence: "adapter-inputs" | "provider-request";
};

export class PrefixRecoveryRequiredError extends Error {
	constructor(message: string) {
		super(`Session prefix recovery required: ${message}`);
		this.name = "PrefixRecoveryRequiredError";
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validatePrefixReference(value: unknown): asserts value is PrefixCapsuleReference {
	if (!record(value) || value.format !== 1
		|| typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)
		|| !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > MAX_PREFIX_CAPSULE_BYTES
		|| typeof value.adapterId !== "string" || !value.adapterId.trim() || value.adapterId.length > 256
		|| typeof value.codec !== "string" || !value.codec.trim() || value.codec.length > 256) {
		throw new PrefixRecoveryRequiredError("invalid or unsupported capsule reference");
	}
}

/** Absence is legacy/uninitialized; malformed protected state must never become absence. */
export function readSessionPrefixBinding(metadata: PiboJsonObject | undefined): SessionPrefixBinding | undefined {
	if (!metadata || !Object.hasOwn(metadata, SESSION_PREFIX_METADATA_KEY)) return undefined;
	const value = metadata[SESSION_PREFIX_METADATA_KEY];
	if (!record(value) || value.format !== 1 || value.status !== "sealed"
		|| !Number.isSafeInteger(value.epoch) || Number(value.epoch) < 1
		|| typeof value.nativeSessionId !== "string" || !value.nativeSessionId || value.nativeSessionId.length > 1024
		|| !["adapter-inputs", "provider-request"].includes(String(value.evidence))
		|| !["initial", "compaction", "model-change", "runtime-change", "explicit-refresh", "fork"].includes(String(value.reason))) {
		throw new PrefixRecoveryRequiredError("invalid or unsupported session prefix binding");
	}
	validatePrefixReference(value.capsule);
	// Binding comparison must not depend on property order introduced by a store.
	const capsule = value.capsule;
	return {
		format: 1, epoch: Number(value.epoch), status: "sealed",
		capsule: { format: 1, digest: capsule.digest, bytes: capsule.bytes, adapterId: capsule.adapterId, codec: capsule.codec },
		reason: value.reason as SessionPrefixBinding["reason"], nativeSessionId: value.nativeSessionId,
		evidence: value.evidence as SessionPrefixBinding["evidence"],
	};
}

export function readSessionPrefixResourceReference(metadata: PiboJsonObject | undefined): PrefixCapsuleReference | undefined {
	if (!metadata || !Object.hasOwn(metadata, SESSION_PREFIX_RESOURCES_KEY)) return undefined;
	const value = metadata[SESSION_PREFIX_RESOURCES_KEY];
	validatePrefixReference(value);
	return { format: 1, digest: value.digest, bytes: value.bytes, adapterId: value.adapterId, codec: value.codec };
}

/** A reader without a complete restore path must never fall back to rebuilding. */
export function rejectUnsupportedPrefixRestore(metadata: PiboJsonObject | undefined): void {
	if (readSessionPrefixBinding(metadata) || readSessionPrefixResourceReference(metadata)
		|| metadata && Object.hasOwn(metadata, SESSION_PREFIX_TRANSITION_KEY)) {
		throw new PrefixRecoveryRequiredError("this runtime open path does not yet support the sealed prefix; use a compatible reader");
	}
}

async function syncDirectory(path: string): Promise<void> {
	const directory = await open(path, "r");
	try { await directory.sync(); } finally { await directory.close(); }
}

export async function ensureDurableDirectory(path: string): Promise<void> {
	const absolute = resolve(path);
	await mkdir(absolute, { recursive: true, mode: 0o700 });
	// Persist every newly created ancestor, including its entry in the existing
	// parent. Also cover directories concurrently created by another publisher:
	// mkdir's return value cannot prove that publisher has synced its parents.
	let current = absolute;
	while (true) {
		await syncDirectory(current);
		const parent = dirname(current);
		if (current === parent) break;
		current = parent;
	}
}

/**
 * Durable opaque artifacts. Publication never overwrites an existing digest.
 * References belong in the existing revisioned session binding, committed only
 * after put resolves. Unreferenced artifacts are safe crash leftovers; this
 * store deliberately does not guess whether a fork/backup still references one.
 */
export class PrefixCapsuleStore {
	constructor(readonly root = piboHomePath("session-prefixes")) {}

	async put(adapterId: string, codec: string, payload: string): Promise<PrefixCapsuleReference> {
		const bytes = Buffer.byteLength(payload, "utf8");
		if (bytes < 1 || bytes > MAX_PREFIX_CAPSULE_BYTES) throw new PrefixRecoveryRequiredError("capsule size exceeds supported bounds");
		const body = Buffer.from(payload, "utf8");
		const digest = createHash("sha256").update(body).digest("hex");
		const reference: PrefixCapsuleReference = { format: 1, digest, bytes: body.length, adapterId, codec };
		validatePrefixReference(reference);
		await ensureDurableDirectory(this.root);
		const temporary = join(this.root, `.preparing-${randomUUID()}`);
		try {
			const file = await open(temporary, "wx", 0o600);
			try {
				await file.writeFile(body);
				await file.sync();
			} finally { await file.close(); }
			try {
				await link(temporary, this.path(reference));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				await this.read(reference, { adapterId, codec });
			}
			// Persist the directory entry before the caller commits its reference.
			// Unsupported directory fsync is fatal, never a false durability claim.
			await syncDirectory(this.root);
			return reference;
		} finally {
			await unlink(temporary).catch(() => {});
		}
	}

	async read(reference: PrefixCapsuleReference, expected: { adapterId: string; codec: string }): Promise<string> {
		validatePrefixReference(reference);
		if (reference.adapterId !== expected.adapterId || reference.codec !== expected.codec) {
			throw new PrefixRecoveryRequiredError("incompatible adapter or capsule codec");
		}
		try {
			const file = await open(this.path(reference), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			try {
				const stat = await file.stat();
				if (!stat.isFile() || stat.size !== reference.bytes) throw new Error("capsule length mismatch");
				// Bound the read even if another process corrupts/grows the artifact.
				const bytes = Buffer.alloc(reference.bytes + 1);
				let offset = 0;
				while (offset < bytes.length) {
					const result = await file.read(bytes, offset, bytes.length - offset, offset);
					if (!result.bytesRead) break;
					offset += result.bytesRead;
				}
				const body = bytes.subarray(0, offset);
				if (offset !== reference.bytes || createHash("sha256").update(body).digest("hex") !== reference.digest) {
					throw new Error("capsule integrity mismatch");
				}
				return new TextDecoder("utf-8", { fatal: true }).decode(body);
			} finally { await file.close(); }
		} catch (error) {
			throw new PrefixRecoveryRequiredError(`capsule ${reference.digest} is unavailable or corrupt (${error instanceof Error ? error.name : "Error"})`);
		}
	}

	private path(reference: PrefixCapsuleReference): string {
		return join(this.root, `${reference.digest}.capsule`);
	}
}
