import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "pibo_tool_";
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_LIFETIME_MS = 30 * 60_000;

export type PiboToolCredentialScope = {
	piboSessionId: string;
	piboRoomId?: string;
	profileName?: string;
	runtimeInstanceId: string;
	adapterId: string;
	sessionGeneration: string;
	cwd: string;
	allowedToolNames: readonly string[];
};

export type PiboToolCredentialInfo = PiboToolCredentialScope & {
	credentialId: string;
	issuedAt: string;
	expiresAt: string;
	lastAliveAt?: string;
	revokedAt?: string;
};

export type IssuedPiboToolCredential = {
	token: string;
	info: PiboToolCredentialInfo;
};

type CredentialRecord = {
	credentialId: string;
	tokenHash: Buffer;
	scope: PiboToolCredentialScope;
	issuedAtMs: number;
	expiresAtMs: number;
	lastAliveAtMs?: number;
	revokedAtMs?: number;
};

export type PiboToolCredentialRegistryOptions = {
	defaultTtlMs?: number;
	maxLifetimeMs?: number;
	now?: () => number;
};

export type PiboToolCredentialErrorCode =
	| "credential_invalid"
	| "credential_expired"
	| "credential_revoked"
	| "credential_scope_invalid";

export class PiboToolCredentialError extends Error {
	readonly code: PiboToolCredentialErrorCode;

	constructor(code: PiboToolCredentialErrorCode, message: string) {
		super(message);
		this.name = "PiboToolCredentialError";
		this.code = code;
	}
}

function positiveDuration(value: number | undefined, fallback: number, label: string): number {
	const resolved = value ?? fallback;
	if (!Number.isFinite(resolved) || resolved <= 0) throw new Error(`${label} must be a positive finite duration`);
	return Math.floor(resolved);
}

function normalizeScope(scope: PiboToolCredentialScope): PiboToolCredentialScope {
	const piboSessionId = scope.piboSessionId.trim();
	const runtimeInstanceId = scope.runtimeInstanceId.trim();
	const adapterId = scope.adapterId.trim();
	const sessionGeneration = scope.sessionGeneration.trim();
	const cwd = scope.cwd.trim();
	if (!piboSessionId || !runtimeInstanceId || !adapterId || !sessionGeneration || !cwd) {
		throw new PiboToolCredentialError(
			"credential_scope_invalid",
			"Tool credentials require a Pibo Session, runtime instance, adapter, session generation, and working directory.",
		);
	}
	const allowedToolNames = [...new Set(scope.allowedToolNames.map((name) => name.trim()).filter(Boolean))].sort();
	if (allowedToolNames.length === 0) {
		throw new PiboToolCredentialError("credential_scope_invalid", "Tool credentials require at least one allowed tool.");
	}
	return {
		piboSessionId,
		...(scope.piboRoomId?.trim() ? { piboRoomId: scope.piboRoomId.trim() } : {}),
		...(scope.profileName?.trim() ? { profileName: scope.profileName.trim() } : {}),
		runtimeInstanceId,
		adapterId,
		sessionGeneration,
		cwd,
		allowedToolNames,
	};
}

function tokenHash(secret: string): Buffer {
	return createHash("sha256").update(secret, "utf8").digest();
}

function parseToken(token: string): { credentialId: string; secret: string } | undefined {
	if (!token.startsWith(TOKEN_PREFIX)) return undefined;
	const separator = token.indexOf(".", TOKEN_PREFIX.length);
	if (separator < 0) return undefined;
	const credentialId = token.slice(TOKEN_PREFIX.length, separator);
	const secret = token.slice(separator + 1);
	if (!credentialId || !secret) return undefined;
	return { credentialId, secret };
}

function iso(value: number | undefined): string | undefined {
	return value === undefined ? undefined : new Date(value).toISOString();
}

function infoFor(record: CredentialRecord): PiboToolCredentialInfo {
	return {
		credentialId: record.credentialId,
		...record.scope,
		allowedToolNames: [...record.scope.allowedToolNames],
		issuedAt: new Date(record.issuedAtMs).toISOString(),
		expiresAt: new Date(record.expiresAtMs).toISOString(),
		...(iso(record.lastAliveAtMs) ? { lastAliveAt: iso(record.lastAliveAtMs) } : {}),
		...(iso(record.revokedAtMs) ? { revokedAt: iso(record.revokedAtMs) } : {}),
	};
}

export class PiboToolCredentialRegistry {
	private readonly records = new Map<string, CredentialRecord>();
	private readonly defaultTtlMs: number;
	private readonly maxLifetimeMs: number;
	private readonly now: () => number;

	constructor(options: PiboToolCredentialRegistryOptions = {}) {
		this.defaultTtlMs = positiveDuration(options.defaultTtlMs, DEFAULT_TTL_MS, "defaultTtlMs");
		this.maxLifetimeMs = positiveDuration(options.maxLifetimeMs, DEFAULT_MAX_LIFETIME_MS, "maxLifetimeMs");
		if (this.defaultTtlMs > this.maxLifetimeMs) {
			throw new Error("defaultTtlMs must not exceed maxLifetimeMs");
		}
		this.now = options.now ?? Date.now;
	}

	issue(scope: PiboToolCredentialScope, ttlMs = this.defaultTtlMs): IssuedPiboToolCredential {
		const normalizedScope = normalizeScope(scope);
		const lifetime = Math.min(positiveDuration(ttlMs, this.defaultTtlMs, "ttlMs"), this.maxLifetimeMs);
		const now = this.now();
		const credentialId = randomBytes(16).toString("base64url");
		const secret = randomBytes(32).toString("base64url");
		const record: CredentialRecord = {
			credentialId,
			tokenHash: tokenHash(secret),
			scope: normalizedScope,
			issuedAtMs: now,
			expiresAtMs: now + lifetime,
		};
		this.records.set(credentialId, record);
		return {
			token: `${TOKEN_PREFIX}${credentialId}.${secret}`,
			info: infoFor(record),
		};
	}

	authenticate(token: string, options: { touch?: boolean } = {}): PiboToolCredentialInfo {
		const parsed = parseToken(token);
		const record = parsed ? this.records.get(parsed.credentialId) : undefined;
		if (!parsed || !record) {
			throw new PiboToolCredentialError("credential_invalid", "Invalid Pibo tool credential.");
		}
		const presentedHash = tokenHash(parsed.secret);
		if (presentedHash.length !== record.tokenHash.length || !timingSafeEqual(presentedHash, record.tokenHash)) {
			throw new PiboToolCredentialError("credential_invalid", "Invalid Pibo tool credential.");
		}
		if (record.revokedAtMs !== undefined) {
			throw new PiboToolCredentialError("credential_revoked", "Pibo tool credential has been revoked.");
		}
		const now = this.now();
		if (record.expiresAtMs <= now) {
			throw new PiboToolCredentialError("credential_expired", "Pibo tool credential has expired.");
		}
		if (options.touch !== false) record.lastAliveAtMs = now;
		return infoFor(record);
	}

	renew(token: string, ttlMs = this.defaultTtlMs): PiboToolCredentialInfo {
		const parsed = parseToken(token);
		this.authenticate(token, { touch: false });
		const record = parsed ? this.records.get(parsed.credentialId) : undefined;
		if (!record) throw new PiboToolCredentialError("credential_invalid", "Invalid Pibo tool credential.");
		const now = this.now();
		const requested = positiveDuration(ttlMs, this.defaultTtlMs, "ttlMs");
		const maximumExpiry = record.issuedAtMs + this.maxLifetimeMs;
		record.expiresAtMs = Math.min(now + requested, maximumExpiry);
		if (record.expiresAtMs <= now) {
			record.revokedAtMs = now;
			throw new PiboToolCredentialError("credential_expired", "Pibo tool credential reached its maximum lifetime.");
		}
		record.lastAliveAtMs = now;
		return infoFor(record);
	}

	revoke(token: string): boolean {
		const parsed = parseToken(token);
		if (!parsed) return false;
		return this.revokeCredentialId(parsed.credentialId);
	}

	revokeCredentialId(credentialId: string): boolean {
		const record = this.records.get(credentialId);
		if (!record || record.revokedAtMs !== undefined) return false;
		record.revokedAtMs = this.now();
		return true;
	}

	revokeSessionGeneration(piboSessionId: string, sessionGeneration: string): number {
		let revoked = 0;
		for (const record of this.records.values()) {
			if (
				record.scope.piboSessionId === piboSessionId
				&& record.scope.sessionGeneration === sessionGeneration
				&& record.revokedAtMs === undefined
			) {
				record.revokedAtMs = this.now();
				revoked += 1;
			}
		}
		return revoked;
	}

	getInfo(credentialId: string): PiboToolCredentialInfo | undefined {
		const record = this.records.get(credentialId);
		return record ? infoFor(record) : undefined;
	}

	cleanupExpired(): number {
		const now = this.now();
		let removed = 0;
		for (const [credentialId, record] of this.records.entries()) {
			if (record.expiresAtMs <= now || record.revokedAtMs !== undefined) {
				this.records.delete(credentialId);
				removed += 1;
			}
		}
		return removed;
	}
}
