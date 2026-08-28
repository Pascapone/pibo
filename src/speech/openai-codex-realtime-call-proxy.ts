import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/";
const CODEX_REALTIME_MODEL = "gpt-live-1-codex";
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_BODY_TIMEOUT_MS = 10_000;
const FORWARD_TIMEOUT_MS = 30_000;
const OMITTED_RESPONSE_HEADERS = new Set([
	"connection",
	"content-encoding",
	"content-length",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export type OpenAiCodexRealtimeCallProxy = {
	baseUrl: string;
	close(): Promise<void>;
};

export type OpenAiCodexRealtimeCallProxyOptions = {
	targetBaseUrl?: string;
	signal?: AbortSignal;
	requestBodyTimeoutMs?: number;
};

class ProxyRequestError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readRequestBody(request: IncomingMessage, signal: AbortSignal, timeoutMs: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	const timeoutController = new AbortController();
	const timer = setTimeout(() => {
		timeoutController.abort(new ProxyRequestError(408, "Realtime call request timed out"));
	}, timeoutMs);
	timer.unref?.();
	const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
	const abortRead = () => request.destroy(combinedSignal.reason instanceof Error ? combinedSignal.reason : undefined);
	if (combinedSignal.aborted) abortRead();
	else combinedSignal.addEventListener("abort", abortRead, { once: true });
	try {
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += buffer.length;
			if (bytes > MAX_REQUEST_BYTES) throw new ProxyRequestError(413, "Realtime call request is too large");
			chunks.push(buffer);
		}
		if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
		if (signal.aborted) throw signal.reason;
		return Buffer.concat(chunks);
	} finally {
		clearTimeout(timer);
		combinedSignal.removeEventListener("abort", abortRead);
	}
}

function requestHeaders(request: IncomingMessage): Headers {
	const authorization = request.headers.authorization;
	if (typeof authorization !== "string" || !authorization) {
		throw new ProxyRequestError(401, "Codex subscription authentication is required");
	}
	const headers = new Headers({
		accept: "application/sdp",
		"accept-encoding": "identity",
		authorization,
		"content-type": "application/json",
		"openai-alpha": "quicksilver=v2",
		originator: "codex_cli_rs",
	});
	for (const name of ["chatgpt-account-id", "session-id", "thread-id", "user-agent", "x-openai-fedramp"]) {
		const value = request.headers[name];
		if (typeof value === "string" && value) headers.set(name, value);
	}
	return headers;
}

function realtimeCallBody(value: unknown): string {
	if (!isRecord(value) || typeof value.sdp !== "string" || !isRecord(value.session)) {
		throw new ProxyRequestError(400, "Codex returned an invalid realtime call request");
	}
	const session: Record<string, unknown> = { ...value.session, model: CODEX_REALTIME_MODEL };
	delete session.id;
	return JSON.stringify({ ...value, session });
}

function writeResponseHeaders(response: Response, outgoing: ServerResponse): void {
	for (const [name, value] of response.headers) {
		if (!OMITTED_RESPONSE_HEADERS.has(name)) outgoing.setHeader(name, value);
	}
}

async function readResponseBody(response: Response): Promise<Buffer> {
	const contentLength = response.headers.get("content-length");
	if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
		await response.body?.cancel().catch(() => {});
		throw new ProxyRequestError(502, "Realtime call response is too large");
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			bytes += chunk.length;
			if (bytes > MAX_RESPONSE_BYTES) {
				await reader.cancel().catch(() => {});
				throw new ProxyRequestError(502, "Realtime call response is too large");
			}
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	} finally {
		reader.releaseLock();
	}
}

async function forwardRealtimeCall(
	request: IncomingMessage,
	response: ServerResponse,
	targetUrl: URL,
	signal: AbortSignal,
	requestBodyTimeoutMs: number,
): Promise<void> {
	const body = await readRequestBody(request, signal, requestBodyTimeoutMs);
	let payload: unknown;
	try {
		payload = JSON.parse(body.toString("utf8"));
	} catch {
		throw new ProxyRequestError(400, "Codex returned malformed realtime call JSON");
	}
	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(new Error("Realtime call forwarding timed out")), FORWARD_TIMEOUT_MS);
	timer.unref?.();
	try {
		const upstream = await fetch(targetUrl, {
			method: "POST",
			headers: requestHeaders(request),
			body: realtimeCallBody(payload),
			redirect: "manual",
			signal: AbortSignal.any([signal, timeoutController.signal]),
		});
		response.statusCode = upstream.status;
		writeResponseHeaders(upstream, response);
		response.end(await readResponseBody(upstream));
	} finally {
		clearTimeout(timer);
	}
}

function sendProxyError(response: ServerResponse, error: unknown): void {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	response.statusCode = error instanceof ProxyRequestError ? error.status : 502;
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify({ error: error instanceof ProxyRequestError ? error.message : "Realtime call forwarding failed" }));
}

export async function startOpenAiCodexRealtimeCallProxy(
	options: OpenAiCodexRealtimeCallProxyOptions = {},
): Promise<OpenAiCodexRealtimeCallProxy> {
	if (options.signal?.aborted) throw options.signal.reason;
	const targetBaseUrl = new URL(options.targetBaseUrl ?? CHATGPT_CODEX_BASE_URL);
	if (targetBaseUrl.protocol !== "https:" && targetBaseUrl.protocol !== "http:") {
		throw new Error("Codex realtime call target must use HTTP or HTTPS");
	}
	if (!targetBaseUrl.pathname.endsWith("/")) targetBaseUrl.pathname += "/";
	const requestBodyTimeoutMs = options.requestBodyTimeoutMs ?? REQUEST_BODY_TIMEOUT_MS;
	if (!Number.isFinite(requestBodyTimeoutMs) || requestBodyTimeoutMs <= 0) {
		throw new Error("Codex realtime call request timeout must be a positive finite number");
	}
	const routePrefix = `/speech-${randomUUID()}/backend-api/codex`;
	const sockets = new Set<Socket>();
	const activeRequests = new Set<AbortController>();
	const server = createServer((request, response) => {
		const requestController = new AbortController();
		activeRequests.add(requestController);
		void (async () => {
			if (request.method !== "POST") throw new ProxyRequestError(405, "Method not allowed");
			const incomingUrl = new URL(request.url ?? "/", "http://127.0.0.1");
			if (incomingUrl.pathname !== `${routePrefix}/realtime/calls`) {
				throw new ProxyRequestError(404, "Not found");
			}
			const targetUrl = new URL("realtime/calls", targetBaseUrl);
			targetUrl.search = incomingUrl.search;
			await forwardRealtimeCall(request, response, targetUrl, requestController.signal, requestBodyTimeoutMs);
		})()
			.catch((error) => sendProxyError(response, error))
			.finally(() => activeRequests.delete(requestController));
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	server.on("clientError", (_error, socket) => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	if (options.signal?.aborted) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw options.signal.reason;
	}
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Codex realtime call proxy did not bind to a TCP port");
	}
	let closePromise: Promise<void> | undefined;
	const close = () => {
		if (!closePromise) {
			options.signal?.removeEventListener("abort", closeOnAbort);
			for (const controller of activeRequests) controller.abort(new Error("Codex realtime call proxy closed"));
			closePromise = new Promise<void>((resolve) => {
				if (!server.listening) {
					for (const socket of sockets) socket.destroy();
					resolve();
					return;
				}
				server.close(() => resolve());
				for (const socket of sockets) socket.destroy();
				server.closeAllConnections();
			});
		}
		return closePromise;
	};
	const closeOnAbort = () => {
		void close();
	};
	options.signal?.addEventListener("abort", closeOnAbort, { once: true });
	return {
		baseUrl: `http://127.0.0.1:${address.port}${routePrefix}`,
		close,
	};
}
