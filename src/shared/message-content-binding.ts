import { deterministicDigest } from "./deterministic-digest.js";

/** Identity of an accepted JSON submission, NOT provider/resource authorization. */
export type MessageContentBinding = { version: 1; sha256: string };
export const MESSAGE_CONTENT_BINDING_VERSION = 1;
export type MessageRequestBody = Record<string, unknown>;

function invalidBinding(): Error {
	return Object.assign(new Error("Content-bound admission requires an unchanged JSON request, an explicit session and transaction, and durable admission version 2."), { code: "command_invalid_content_binding" });
}

/** Capture JSON wire values before any asynchronous plugin augmentation. */
export function captureMessageRequestBody(value: unknown): MessageRequestBody {
	try {
		const body: unknown = JSON.parse(JSON.stringify(value));
		if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidBinding();
		return body as MessageRequestBody;
	} catch {
		throw invalidBinding();
	}
}

/** Shared browser/worker encoder. The worker derives this from the captured
 * request, never from a digest supplied by the HTTP client. All extension
 * inputs participate without a Core allowlist of particular feature plugins.
 * Existing transport/command byte budgets remain in force.
 */
export function createMessageContentBinding(input: {
	sessionId: string;
	delivery: "queue" | "steer";
	body: unknown;
}): MessageContentBinding {
	try {
		const body = captureMessageRequestBody(input.body);
		if (body.admissionVersion !== 2 || body.contentBindingVersion !== MESSAGE_CONTENT_BINDING_VERSION
			|| typeof input.sessionId !== "string" || !input.sessionId || body.piboSessionId !== input.sessionId
			|| typeof body.clientTxnId !== "string" || !body.clientTxnId.trim()
			|| typeof body.text !== "string"
			|| (input.delivery !== "queue" && input.delivery !== "steer")
			|| (body.delivery === undefined ? "queue" : body.delivery) !== input.delivery) throw invalidBinding();
		return {
			version: MESSAGE_CONTENT_BINDING_VERSION,
			sha256: deterministicDigest({ domain: "pibo.message-content.v1", sessionId: input.sessionId, delivery: input.delivery, body }),
		};
	} catch {
		throw invalidBinding();
	}
}

export function isMessageContentBinding(value: unknown): value is MessageContentBinding {
	if (!value || typeof value !== "object") return false;
	const binding = value as Partial<MessageContentBinding>;
	return binding.version === MESSAGE_CONTENT_BINDING_VERSION && typeof binding.sha256 === "string"
		&& binding.sha256.length === 64 && /^[0-9a-f]+$/.test(binding.sha256);
}

export function sameMessageContentBinding(left: unknown, right: unknown): boolean {
	return isMessageContentBinding(left) && isMessageContentBinding(right) && left.sha256 === right.sha256;
}
