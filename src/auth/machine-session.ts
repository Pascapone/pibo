import { createHmac, timingSafeEqual } from "node:crypto";
import type { MachineKeyAuthentication, MachineKeyAuthenticator } from "./machine-keys.js";
import type { PiboAuthSession } from "./types.js";

export const PIBO_MACHINE_SESSION_COOKIE = "pibo_machine_session";
export const DEFAULT_MACHINE_SESSION_TTL_SECONDS = 8 * 60 * 60;

const MACHINE_SESSION_VERSION = 1 as const;
const MAX_COOKIE_VALUE_LENGTH = 1024;

type MachineSessionPayload = {
	v: typeof MACHINE_SESSION_VERSION;
	keyId: string;
	expiresAt: number;
};

export type CreatedMachineSessionCookie = {
	header: string;
	expiresAt: Date;
	session: PiboAuthSession;
};

export type MachineSessionManager = {
	create(authentication: MachineKeyAuthentication): CreatedMachineSessionCookie;
	getSession(headers: Headers): PiboAuthSession | undefined;
	clearHeader(): string;
};

function signPayload(secret: string, encodedPayload: string): Buffer {
	return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

function encodePayload(secret: string, payload: MachineSessionPayload): string {
	const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	const signature = signPayload(secret, encodedPayload).toString("base64url");
	return `${encodedPayload}.${signature}`;
}

function decodePayload(secret: string, value: string): MachineSessionPayload | undefined {
	if (value.length === 0 || value.length > MAX_COOKIE_VALUE_LENGTH) return undefined;
	const parts = value.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
	let providedSignature: Buffer;
	try {
		providedSignature = Buffer.from(parts[1], "base64url");
	} catch {
		return undefined;
	}
	const expectedSignature = signPayload(secret, parts[0]);
	if (
		providedSignature.length !== expectedSignature.length ||
		!timingSafeEqual(providedSignature, expectedSignature)
	) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const payload = parsed as Record<string, unknown>;
		if (
			payload.v !== MACHINE_SESSION_VERSION ||
			typeof payload.keyId !== "string" ||
			!/^[a-f0-9]{16}$/.test(payload.keyId) ||
			typeof payload.expiresAt !== "number" ||
			!Number.isSafeInteger(payload.expiresAt)
		) {
			return undefined;
		}
		return { v: MACHINE_SESSION_VERSION, keyId: payload.keyId, expiresAt: payload.expiresAt };
	} catch {
		return undefined;
	}
}

function cookieValue(headers: Headers): string | undefined {
	const cookieHeader = headers.get("cookie");
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		const name = part.slice(0, separator).trim();
		if (name !== PIBO_MACHINE_SESSION_COOKIE) continue;
		return part.slice(separator + 1).trim();
	}
	return undefined;
}

function sessionCookieHeader(value: string, expiresAt: Date, maxAgeSeconds: number): string {
	return [
		`${PIBO_MACHINE_SESSION_COOKIE}=${value}`,
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=Strict",
		`Max-Age=${maxAgeSeconds}`,
		`Expires=${expiresAt.toUTCString()}`,
	].join("; ");
}

export function createMachineSessionManager(options: {
	secret: string;
	machineKeys: MachineKeyAuthenticator;
	ttlSeconds?: number;
	now?: () => Date;
}): MachineSessionManager {
	const ttlSeconds = options.ttlSeconds ?? DEFAULT_MACHINE_SESSION_TTL_SECONDS;
	if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
		throw new Error("Machine session TTL must be a positive integer");
	}
	const now = options.now ?? (() => new Date());

	return {
		create(authentication) {
			const createdAt = now();
			const ttlExpiry = createdAt.getTime() + ttlSeconds * 1000;
			const keyExpiry = authentication.session.expiresAt?.getTime();
			const expiryMs = keyExpiry === undefined ? ttlExpiry : Math.min(ttlExpiry, keyExpiry);
			if (expiryMs <= createdAt.getTime()) throw new Error("Machine key is expired");
			const expiresAt = new Date(expiryMs);
			const value = encodePayload(options.secret, {
				v: MACHINE_SESSION_VERSION,
				keyId: authentication.id,
				expiresAt: expiryMs,
			});
			return {
				header: sessionCookieHeader(value, expiresAt, Math.max(1, Math.floor((expiryMs - createdAt.getTime()) / 1000))),
				expiresAt,
				session: { ...authentication.session, expiresAt },
			};
		},
		getSession(headers) {
			const value = cookieValue(headers);
			if (!value) return undefined;
			const payload = decodePayload(options.secret, value);
			const currentTime = now().getTime();
			if (!payload || payload.expiresAt <= currentTime) return undefined;
			const keySession = options.machineKeys.getSessionById(payload.keyId);
			if (!keySession) return undefined;
			const keyExpiry = keySession.expiresAt?.getTime();
			const effectiveExpiry = keyExpiry === undefined ? payload.expiresAt : Math.min(payload.expiresAt, keyExpiry);
			if (effectiveExpiry <= currentTime) return undefined;
			return { ...keySession, expiresAt: new Date(effectiveExpiry) };
		},
		clearHeader() {
			return sessionCookieHeader("", new Date(0), 0);
		},
	};
}
