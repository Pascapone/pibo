import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PiboRemoteAgentStore } from "./store.js";
import {
	REMOTE_AGENT_CODE_ALPHABET,
	REMOTE_AGENT_CODE_LENGTH,
	REMOTE_AGENT_CODE_TTL_MS,
	REMOTE_AGENT_TOKEN_LABEL_MAX_LENGTH,
	REMOTE_AGENT_TOKEN_PREFIX,
	REMOTE_AGENT_TOKEN_TTL_MS,
	RemoteAgentError,
	type RemoteAgentModuleName,
	type RemoteDeviceCode,
	type RemoteTokenInfo,
	type RemoteTokenScope,
} from "./types.js";

export type PiboRemoteAgentAuthOptions = {
	store: PiboRemoteAgentStore;
	now?: () => number;
	codeTtlMs?: number;
	tokenTtlMs?: number;
};

export type IssuedDeviceCode = {
	code: string;
	roomId: string;
	label?: string;
	expiresAt: string;
};

export type IssuedRemoteToken = {
	token: string;
	info: RemoteTokenInfo;
};

function randomCode(): string {
	const bytes = randomBytes(REMOTE_AGENT_CODE_LENGTH);
	let code = "";
	for (const byte of bytes) code += REMOTE_AGENT_CODE_ALPHABET[byte % REMOTE_AGENT_CODE_ALPHABET.length]!;
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashRemoteToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeLabel(label: string | undefined): string {
	const normalized = (label ?? "").trim().slice(0, REMOTE_AGENT_TOKEN_LABEL_MAX_LENGTH);
	return normalized || "Remote agent";
}

export class PiboRemoteAgentAuth {
	private readonly store: PiboRemoteAgentStore;
	private readonly now: () => number;
	private readonly codeTtlMs: number;
	private readonly tokenTtlMs: number;

	constructor(options: PiboRemoteAgentAuthOptions) {
		this.store = options.store;
		this.now = options.now ?? Date.now;
		this.codeTtlMs = options.codeTtlMs ?? REMOTE_AGENT_CODE_TTL_MS;
		this.tokenTtlMs = options.tokenTtlMs ?? REMOTE_AGENT_TOKEN_TTL_MS;
	}

	createDeviceCode(roomId: string, label?: string): IssuedDeviceCode {
		const trimmedRoom = roomId.trim();
		if (!trimmedRoom) throw new RemoteAgentError("room_invalid", "roomId is required.");
		const nowMs = this.now();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const code = randomCode();
			if (this.store.getDeviceCode(code)) continue;
			const record: RemoteDeviceCode = {
				code,
				roomId: trimmedRoom,
				...(label?.trim() ? { label: label.trim().slice(0, REMOTE_AGENT_TOKEN_LABEL_MAX_LENGTH) } : {}),
				expiresAt: new Date(nowMs + this.codeTtlMs).toISOString(),
				used: false,
				createdAt: new Date(nowMs).toISOString(),
			};
			this.store.insertDeviceCode(record);
			return { code, roomId: trimmedRoom, ...(record.label ? { label: record.label } : {}), expiresAt: record.expiresAt };
		}
		throw new RemoteAgentError("code_unavailable", "Could not generate a unique device code.");
	}

	redeemDeviceCode(code: string, modules: readonly RemoteAgentModuleName[]): IssuedRemoteToken {
		const normalized = code.trim().toUpperCase();
		const record = this.store.getDeviceCode(normalized);
		const nowMs = this.now();
		if (!record || record.used || Date.parse(record.expiresAt) <= nowMs) {
			throw new RemoteAgentError("code_invalid", "Device code is unknown, already used, or expired.");
		}
		if (modules.length === 0) throw new RemoteAgentError("modules_empty", "At least one module must be enabled to issue a token.");
		const claimed = this.store.markDeviceCodeUsed(normalized, new Date(nowMs).toISOString());
		if (!claimed) throw new RemoteAgentError("code_invalid", "Device code is unknown, already used, or expired.");
		return this.issueToken(record.roomId, record.label, modules);
	}

	/**
	 * Validate a device code for an expected room and burn it, without issuing a
	 * token. Used by the OAuth consent page (the token is issued at /token time).
	 * A room mismatch never burns the code so the user can retry.
	 */
	claimDeviceCode(code: string, expectedRoomId: string): RemoteDeviceCode {
		const normalized = code.trim().toUpperCase();
		const record = this.store.getDeviceCode(normalized);
		const nowMs = this.now();
		if (!record || record.used || Date.parse(record.expiresAt) <= nowMs) {
			throw new RemoteAgentError("code_invalid", "Device code is unknown, already used, or expired.");
		}
		if (record.roomId !== expectedRoomId.trim()) {
			throw new RemoteAgentError("code_room_mismatch", `This device code belongs to room "${record.roomId}".`);
		}
		const claimed = this.store.markDeviceCodeUsed(normalized, new Date(nowMs).toISOString());
		if (!claimed) throw new RemoteAgentError("code_invalid", "Device code is unknown, already used, or expired.");
		return { ...record, used: true };
	}

	/** Issue a token directly (tab "new token" button, GPT paste flow). Show the token once. */
	issueToken(roomId: string, label: string | undefined, modules: readonly RemoteAgentModuleName[]): IssuedRemoteToken {
		if (modules.length === 0) throw new RemoteAgentError("modules_empty", "At least one module must be enabled to issue a token.");
		const nowMs = this.now();
		const token = `${REMOTE_AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
		const info = this.store.insertToken({
			id: `rt_${randomUUID()}`,
			tokenHash: hashRemoteToken(token),
			label: normalizeLabel(label),
			roomId,
			modules: [...modules],
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + this.tokenTtlMs).toISOString(),
		});
		return { token, info };
	}

	authenticate(token: string): RemoteTokenScope {
		if (!token.startsWith(REMOTE_AGENT_TOKEN_PREFIX)) {
			throw new RemoteAgentError("token_invalid", "Bearer [REDACTED] is invalid.");
		}
		const record = this.store.findTokenByHash(hashRemoteToken(token));
		if (!record || !timingSafeEqual(Buffer.from(record.tokenHash, "utf8"), Buffer.from(hashRemoteToken(token), "utf8"))) {
			throw new RemoteAgentError("token_invalid", "Bearer [REDACTED] is invalid.");
		}
		if (record.revoked) throw new RemoteAgentError("token_revoked", "This connection was revoked. Reconnect with a fresh device code.");
		if (Date.parse(record.expiresAt) <= this.now()) {
			throw new RemoteAgentError("token_expired", "This connection has expired. Reconnect with a fresh device code.");
		}
		return { tokenId: record.id, label: record.label, roomId: record.roomId, modules: record.modules, expiresAt: record.expiresAt };
	}

	listTokens(roomId?: string): RemoteTokenInfo[] {
		return this.store.listTokens(roomId);
	}

	revokeToken(id: string): boolean {
		return this.store.revokeToken(id, new Date(this.now()).toISOString());
	}

	revokeRoomTokens(roomId: string): number {
		return this.store.revokeRoomTokens(roomId, new Date(this.now()).toISOString());
	}

	pruneExpired(): { codes: number; tokens: number } {
		const now = new Date(this.now()).toISOString();
		return { codes: this.store.pruneDeviceCodes(now), tokens: this.store.pruneTokens(now) };
	}
}
