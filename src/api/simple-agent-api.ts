import { randomUUID, timingSafeEqual } from "node:crypto";
import type { PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../web/http.js";

const DEFAULT_SEND_MESSAGE_TIMEOUT_MS = 10 * 60 * 1000;

export type SimpleAgentApiOptions = {
	apiKey?: string;
	timeoutMs?: number;
};

type SendMessageBody = {
	sessionId?: unknown;
	message?: unknown;
};

type AwaitedAgentMessage = {
	message: string;
	eventId: string;
	sessionId: string;
};

function configuredApiKey(options: SimpleAgentApiOptions): string | undefined {
	return options.apiKey ?? process.env.PIBO_SIMPLE_API_KEY;
}

function safeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) return false;
	return timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBasicAuthCredential(value: string): string[] {
	const match = value.match(/^Basic\s+(.+)$/i);
	if (!match) return [];
	try {
		const decoded = Buffer.from(match[1] ?? "", "base64").toString("utf8");
		return decoded.split(":").map((part) => part.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

function requestApiKeyCandidates(request: Request): string[] {
	const candidates: string[] = [];
	const add = (value: string | undefined | null) => {
		let trimmed = value?.trim();
		if (!trimmed) return;
		candidates.push(trimmed);
		while (/^(Bearer|Token)\s+/i.test(trimmed)) {
			trimmed = trimmed.replace(/^(Bearer|Token)\s+/i, "").trim();
			if (trimmed) candidates.push(trimmed);
		}
	};

	add(request.headers.get("x-api-key"));
	add(request.headers.get("api-key"));

	const authorization = request.headers.get("authorization")?.trim();
	add(authorization);
	for (const credential of decodeBasicAuthCredential(authorization ?? "")) add(credential);

	return candidates;
}

function requireApiKey(request: Request, options: SimpleAgentApiOptions): void {
	const expected = configuredApiKey(options);
	if (!expected) throw new PiboWebHttpError("Simple agent API key is not configured", 503);

	const candidates = requestApiKeyCandidates(request);
	if (!candidates.some((candidate) => safeEqual(candidate, expected))) {
		throw new PiboWebHttpError("Invalid API key", 401);
	}
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError(`${name} is required`, 400);
	}
	return value;
}

function parseSendMessageBody(body: SendMessageBody): { sessionId: string; message: string } {
	return {
		sessionId: requireString(body.sessionId, "sessionId"),
		message: requireString(body.message, "message"),
	};
}

function awaitAgentMessage(
	context: PiboChannelContext,
	input: { sessionId: string; eventId: string; timeoutMs: number },
): Promise<AwaitedAgentMessage> {
	return new Promise((resolve, reject) => {
		let lastAssistantMessage = "";
		let settled = false;
		let unsubscribe: (() => void) | undefined;

		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			unsubscribe?.();
			callback();
		};

		const timeout = setTimeout(() => {
			finish(() => reject(new PiboWebHttpError("Timed out waiting for agent response", 504)));
		}, input.timeoutMs);

		unsubscribe = context.subscribe((event: PiboOutputEvent) => {
			if (event.piboSessionId !== input.sessionId || !("eventId" in event) || event.eventId !== input.eventId) return;
			if (event.type === "assistant_message") {
				lastAssistantMessage = event.text;
				return;
			}
			if (event.type === "session_error") {
				finish(() => reject(new PiboWebHttpError(event.error, 500)));
				return;
			}
			if (event.type === "message_finished") {
				finish(() => resolve({ eventId: input.eventId, sessionId: input.sessionId, message: lastAssistantMessage }));
			}
		});
	});
}

async function handleSendMessage(
	request: Request,
	context: PiboChannelContext,
	options: SimpleAgentApiOptions,
): Promise<Response> {
	requireApiKey(request, options);
	const input = parseSendMessageBody(await readJsonBody<SendMessageBody>(request));
	if (!context.getSession(input.sessionId)) {
		throw new PiboWebHttpError("Unknown sessionId", 404);
	}

	const eventId = randomUUID();
	const responsePromise = awaitAgentMessage(context, {
		sessionId: input.sessionId,
		eventId,
		timeoutMs: options.timeoutMs ?? DEFAULT_SEND_MESSAGE_TIMEOUT_MS,
	});
	await context.emit({
		type: "message",
		piboSessionId: input.sessionId,
		id: eventId,
		text: input.message,
		source: "service",
	});

	return responseJson(await responsePromise);
}

export async function handleSimpleAgentApiRequest(
	request: Request,
	context: PiboChannelContext,
	options: SimpleAgentApiOptions = {},
): Promise<Response | undefined> {
	const url = new URL(request.url);
	if (url.pathname === "/api/health") {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return responseJson({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, HEAD" } });
		}
		return responseJson({ status: "ok" });
	}

	if (url.pathname !== "/api/send-message") return undefined;

	if (request.method !== "POST") {
		return responseJson({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } });
	}

	return handleSendMessage(request, context, options);
}
