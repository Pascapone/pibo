import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { ensurePrivatePiboHomeForPath, piboHomePath } from "../core/pibo-home.js";
import { protectPrivateFileSync } from "../core/private-path.js";
import type { PiboAuthIdentity, PiboAuthSession } from "./types.js";

export const PIBO_MACHINE_KEY_HEADER = "x-pibo-machine-key";
export const MACHINE_KEY_STORE_VERSION = 1 as const;

const MACHINE_KEY_ID_PATTERN = /^[a-f0-9]{16}$/;
const MACHINE_KEY_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MACHINE_KEY_TOKEN_PATTERN = /^pibo_mk_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;
const MACHINE_KEY_LABEL_MAX_LENGTH = 120;

export type MachineKeyRecord = {
	id: string;
	label: string;
	hash: string;
	identity: PiboAuthIdentity;
	createdAt: string;
	expiresAt?: string;
	revokedAt?: string;
};

export type MachineKeyStoreFile = {
	version: typeof MACHINE_KEY_STORE_VERSION;
	keys: MachineKeyRecord[];
};

export type MachineKeyGeneration = {
	token: string;
	record: MachineKeyRecord;
};

export type MachineKeyListItem = Omit<MachineKeyRecord, "hash"> & {
	status: "active" | "expired" | "revoked";
};

export type MachineKeyAuthentication = {
	id: string;
	session: PiboAuthSession;
};

export type MachineKeyAuthenticator = {
	authenticate(headers: Headers): MachineKeyAuthentication | undefined;
	getSession(headers: Headers): PiboAuthSession | undefined;
	getSessionById(id: string): PiboAuthSession | undefined;
};

export function getDefaultMachineKeyStorePath(): string {
	return piboHomePath("machine-keys.json");
}

function hashMachineKeyToken(token: string): Buffer {
	return createHash("sha256").update(token, "utf8").digest();
}

function parseIsoTimestamp(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
		throw new Error(`${field} must be an ISO timestamp`);
	}
	return new Date(value).toISOString();
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function parseIdentity(value: unknown): PiboAuthIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("identity must be an object");
	}
	const input = value as Record<string, unknown>;
	const allowedKeys = new Set(["userId", "email", "name", "image", "provider"]);
	for (const key of Object.keys(input)) {
		if (!allowedKeys.has(key)) throw new Error(`identity contains unsupported field "${key}"`);
	}
	if (typeof input.userId !== "string" || input.userId.length === 0) {
		throw new Error("identity.userId must be a non-empty string");
	}
	if (input.provider !== "machine-key") {
		throw new Error('identity.provider must be "machine-key"');
	}
	const email = optionalString(input.email, "identity.email");
	if (!email) throw new Error("identity.email must be a non-empty string");
	return {
		userId: input.userId,
		email,
		name: optionalString(input.name, "identity.name"),
		image: optionalString(input.image, "identity.image"),
		provider: "machine-key",
	};
}

export function parseMachineKeyRecord(value: unknown): MachineKeyRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Machine-key record must be an object");
	}
	const input = value as Record<string, unknown>;
	const allowedKeys = new Set(["id", "label", "hash", "identity", "createdAt", "expiresAt", "revokedAt"]);
	for (const key of Object.keys(input)) {
		if (!allowedKeys.has(key)) throw new Error(`Machine-key record contains unsupported field "${key}"`);
	}
	if (typeof input.id !== "string" || !MACHINE_KEY_ID_PATTERN.test(input.id)) {
		throw new Error("Machine-key record id must be 16 lowercase hexadecimal characters");
	}
	if (
		typeof input.label !== "string" ||
		input.label.trim().length === 0 ||
		input.label.trim().length > MACHINE_KEY_LABEL_MAX_LENGTH
	) {
		throw new Error(`Machine-key record label must contain 1-${MACHINE_KEY_LABEL_MAX_LENGTH} characters`);
	}
	if (typeof input.hash !== "string" || !MACHINE_KEY_HASH_PATTERN.test(input.hash)) {
		throw new Error("Machine-key record hash must be 64 lowercase hexadecimal characters");
	}
	const createdAt = parseIsoTimestamp(input.createdAt, "createdAt");
	const expiresAt = input.expiresAt === undefined ? undefined : parseIsoTimestamp(input.expiresAt, "expiresAt");
	const revokedAt = input.revokedAt === undefined ? undefined : parseIsoTimestamp(input.revokedAt, "revokedAt");
	return {
		id: input.id,
		label: input.label.trim(),
		hash: input.hash,
		identity: parseIdentity(input.identity),
		createdAt,
		...(expiresAt ? { expiresAt } : {}),
		...(revokedAt ? { revokedAt } : {}),
	};
}

function parseMachineKeyStore(value: unknown): MachineKeyStoreFile {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Machine-key store must be an object");
	}
	const input = value as Record<string, unknown>;
	if (input.version !== MACHINE_KEY_STORE_VERSION) {
		throw new Error(`Machine-key store version must be ${MACHINE_KEY_STORE_VERSION}`);
	}
	if (!Array.isArray(input.keys)) throw new Error("Machine-key store keys must be an array");
	const keys = input.keys.map(parseMachineKeyRecord);
	const ids = new Set<string>();
	for (const key of keys) {
		if (ids.has(key.id)) throw new Error(`Duplicate machine-key id "${key.id}"`);
		ids.add(key.id);
	}
	return { version: MACHINE_KEY_STORE_VERSION, keys };
}

function assertPrivateStoreFile(path: string): void {
	if (process.platform === "win32") {
		protectPrivateFileSync(path);
		return;
	}
	const stat = statSync(path);
	if ((stat.mode & 0o077) !== 0) {
		throw new Error(`Machine-key store must not be accessible by group or other users: ${path}`);
	}
	const currentUid = process.getuid?.();
	if (currentUid !== undefined && stat.uid !== currentUid) {
		throw new Error(`Machine-key store must be owned by the current user: ${path}`);
	}
}

export function readMachineKeyStore(path = getDefaultMachineKeyStorePath()): MachineKeyStoreFile {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) return { version: MACHINE_KEY_STORE_VERSION, keys: [] };
	assertPrivateStoreFile(resolvedPath);
	return parseMachineKeyStore(JSON.parse(readFileSync(resolvedPath, "utf8")) as unknown);
}

function writeMachineKeyStore(store: MachineKeyStoreFile, path: string): void {
	const resolvedPath = resolve(path);
	ensurePrivatePiboHomeForPath(resolvedPath);
	mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temporaryPath, resolvedPath);
		protectPrivateFileSync(resolvedPath, { force: true });
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
}

export function generateMachineKey(options: {
	label: string;
	identity: Omit<PiboAuthIdentity, "provider">;
	expiresAt?: Date | string;
	now?: Date;
}): MachineKeyGeneration {
	const id = randomBytes(8).toString("hex");
	const secret = randomBytes(32).toString("base64url");
	const token = `pibo_mk_${id}_${secret}`;
	const now = options.now ?? new Date();
	const expiresAt =
		options.expiresAt === undefined
			? undefined
			: typeof options.expiresAt === "string"
				? parseIsoTimestamp(options.expiresAt, "expiresAt")
				: options.expiresAt.toISOString();
	const record = parseMachineKeyRecord({
		id,
		label: options.label,
		hash: hashMachineKeyToken(token).toString("hex"),
		identity: { ...options.identity, provider: "machine-key" },
		createdAt: now.toISOString(),
		...(expiresAt ? { expiresAt } : {}),
	});
	return { token, record };
}

export function importMachineKeyRecord(
	recordValue: unknown,
	path = getDefaultMachineKeyStorePath(),
): MachineKeyRecord {
	const record = parseMachineKeyRecord(recordValue);
	const store = readMachineKeyStore(path);
	if (store.keys.some((candidate) => candidate.id === record.id)) {
		throw new Error(`Machine-key id "${record.id}" already exists`);
	}
	store.keys.push(record);
	writeMachineKeyStore(store, path);
	return record;
}

function machineKeyStatus(record: MachineKeyRecord, now: Date): MachineKeyListItem["status"] {
	if (record.revokedAt) return "revoked";
	if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return "expired";
	return "active";
}

export function listMachineKeys(
	path = getDefaultMachineKeyStorePath(),
	now = new Date(),
): MachineKeyListItem[] {
	return readMachineKeyStore(path).keys.map((record) => {
		const { hash: _hash, ...listed } = record;
		return { ...listed, status: machineKeyStatus(record, now) };
	});
}

export function revokeMachineKey(
	id: string,
	path = getDefaultMachineKeyStorePath(),
	now = new Date(),
): MachineKeyRecord {
	if (!MACHINE_KEY_ID_PATTERN.test(id)) throw new Error("Machine-key id must be 16 lowercase hexadecimal characters");
	const store = readMachineKeyStore(path);
	const index = store.keys.findIndex((candidate) => candidate.id === id);
	if (index < 0) throw new Error(`Unknown machine-key id "${id}"`);
	const current = store.keys[index]!;
	const revoked = { ...current, revokedAt: current.revokedAt ?? now.toISOString() };
	store.keys[index] = revoked;
	writeMachineKeyStore(store, path);
	return revoked;
}

function storeSignature(path: string): string {
	try {
		const stat = statSync(path);
		return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

export function createMachineKeyAuthenticator(
	path = getDefaultMachineKeyStorePath(),
): MachineKeyAuthenticator {
	const resolvedPath = resolve(path);
	let cachedSignature: string | undefined;
	let keysById = new Map<string, MachineKeyRecord>();

	const refresh = (): void => {
		const signature = storeSignature(resolvedPath);
		if (signature === cachedSignature) return;
		const store = readMachineKeyStore(resolvedPath);
		keysById = new Map(store.keys.map((record) => [record.id, record]));
		cachedSignature = signature;
	};

	const sessionForRecord = (record: MachineKeyRecord): PiboAuthSession => ({
		identity: { ...record.identity },
		sessionId: `machine-key:${record.id}`,
		...(record.expiresAt ? { expiresAt: new Date(record.expiresAt) } : {}),
	});
	const getSessionById = (id: string): PiboAuthSession | undefined => {
		refresh();
		const record = keysById.get(id);
		if (!record || machineKeyStatus(record, new Date()) !== "active") return undefined;
		return sessionForRecord(record);
	};
	const authenticate = (headers: Headers): MachineKeyAuthentication | undefined => {
		const token = headers.get(PIBO_MACHINE_KEY_HEADER)?.trim();
		if (!token) return undefined;
		const match = MACHINE_KEY_TOKEN_PATTERN.exec(token);
		if (!match) return undefined;
		refresh();
		const record = keysById.get(match[1]!);
		if (!record || machineKeyStatus(record, new Date()) !== "active") return undefined;
		const expected = Buffer.from(record.hash, "hex");
		const actual = hashMachineKeyToken(token);
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
		return { id: record.id, session: sessionForRecord(record) };
	};

	return {
		authenticate,
		getSession(headers) {
			return authenticate(headers)?.session;
		},
		getSessionById,
	};
}
