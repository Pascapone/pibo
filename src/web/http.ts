import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

export const MAX_WEB_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MIN_COMPRESS_RESPONSE_BYTES = 1024;
const MAX_SYNC_GZIP_RESPONSE_BYTES = 64 * 1024;
const INTERNAL_SOCKET_PEER_HEADER = "x-pibo-socket-peer";

export class PiboWebHttpError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message);
		this.name = "PiboWebHttpError";
	}
}

export type SendWebResponseOptions = {
	signal?: AbortSignal;
};

export function responseJson(payload: unknown, init: ResponseInit = {}): Response {
	const startedAt = performance.now();
	const body = JSON.stringify(payload);
	const serializeMs = performance.now() - startedAt;
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("x-pibo-response-bytes", String(Buffer.byteLength(body, "utf8")));
	headers.set("server-timing", appendServerTiming(headers.get("server-timing"), `json_serialize;dur=${serializeMs.toFixed(1)}`));
	return new Response(body, {
		...init,
		headers,
	});
}

export function responseHtml(html: string, init: ResponseInit = {}): Response {
	return new Response(html, {
		...init,
		headers: {
			"content-type": "text/html; charset=utf-8",
			...init.headers,
		},
	});
}

export async function readJsonBody<T extends object>(request: Request): Promise<T> {
	try {
		const body = await request.json();
		if (!body || typeof body !== "object") throw new PiboWebHttpError("Invalid JSON body", 400);
		return body as T;
	} catch {
		throw new PiboWebHttpError("Invalid JSON body", 400);
	}
}

export async function nodeRequestToWebRequest(request: IncomingMessage, baseURL: string, signal?: AbortSignal): Promise<Request> {
	const url = new URL(request.url ?? "/", baseURL);
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (Array.isArray(value)) {
			for (const entry of value) headers.append(key, entry);
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}

	let body: Buffer | undefined;
	if (request.method !== "GET" && request.method !== "HEAD") {
		const chunks: Buffer[] = [];
		let receivedBytes = 0;
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			receivedBytes += buffer.length;
			if (receivedBytes > MAX_WEB_REQUEST_BODY_BYTES) {
				throw new PiboWebHttpError("Request body too large", 413);
			}
			chunks.push(buffer);
		}
		body = Buffer.concat(chunks);
	}

	return new Request(url, {
		method: request.method,
		headers,
		body,
		signal,
	});
}

export async function sendWebResponse(
	response: ServerResponse,
	webResponse: Response,
	options: SendWebResponseOptions = {},
): Promise<void> {
	assertResponseCanStart(response);
	const headers = responseHeaders(webResponse);
	const compressEncoding = preferredResponseEncoding(response.req?.headers["accept-encoding"], webResponse);
	let reader = webResponse.body?.getReader();
	let wroteHeaders = false;
	let clientClosed = false;
	const cancelReader = () => {
		if (reader) void reader.cancel().catch(() => undefined);
	};
	const close = () => {
		clientClosed = true;
		cancelReader();
	};
	const abort = () => {
		cancelReader();
		try {
			if (!response.destroyed && !response.writableEnded) response.end();
		} catch {
			tryDestroyResponse(response);
		}
		try {
			response.socket?.end();
		} catch {
			tryDestroyResponse(response);
		}
	};

	if (reader) {
		response.once("close", close);
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
	}

	try {
		if (compressEncoding && reader) {
			const body = await readResponseBody(reader);
			if (clientClosed || options.signal?.aborted || response.destroyed || response.writableEnded || response.writableFinished) return;
			assertResponseCanStart(response);
			if (body.length >= MIN_COMPRESS_RESPONSE_BYTES && body.length <= MAX_SYNC_GZIP_RESPONSE_BYTES) {
				const compressionStartedAt = performance.now();
				const compressed = gzipSync(body, { level: 1 });
				appendServerTimingHeader(headers, `response_compress;dur=${(performance.now() - compressionStartedAt).toFixed(1)}`);
				headers["content-encoding"] = compressEncoding;
				headers["content-length"] = String(compressed.length);
				headers.vary = appendVary(headers.vary, "accept-encoding");
				response.writeHead(webResponse.status, headers);
				wroteHeaders = true;
				response.end(compressed);
				return;
			}
			if (body.length > MAX_SYNC_GZIP_RESPONSE_BYTES) {
				headers["x-pibo-compression-skipped"] = "sync-gzip-size-limit";
			}
			response.writeHead(webResponse.status, headers);
			wroteHeaders = true;
			response.end(body);
			return;
		}

		response.writeHead(webResponse.status, headers);
		wroteHeaders = true;
		if (!reader) {
			response.end();
			return;
		}

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
			for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
				if (response.destroyed || response.writableEnded || response.writableFinished) {
					cancelReader();
					return;
				}
				if (!response.write(bytes.subarray(offset, offset + 64 * 1024))) {
					const drained = await waitForResponseDrain(
						response,
						(webResponse.headers.get("content-type") ?? "").startsWith("text/event-stream") ? 5000 : undefined,
						options.signal,
					);
					if (!drained) {
						cancelReader();
						tryDestroyResponse(response);
						return;
					}
				}
			}
		}
		if (!response.destroyed && !response.writableEnded && !response.writableFinished) response.end();
	} catch (error) {
		cancelReader();
		if (clientClosed || response.destroyed || response.writableEnded || response.writableFinished) return;
		if (wroteHeaders || response.headersSent) tryDestroyResponse(response, error);
		throw error;
	} finally {
		response.off("close", close);
		options.signal?.removeEventListener("abort", abort);
		if (reader) {
			try {
				reader.releaseLock();
			} catch {
				// Cancellation/read settlement owns the lock until the pending read resolves.
			}
		}
	}
}

function assertResponseCanStart(response: ServerResponse): void {
	if (response.destroyed) throw new Error("HTTP response is destroyed");
	if (response.writableEnded) throw new Error("HTTP response has ended");
	if (response.writableFinished) throw new Error("HTTP response has finished");
	if (response.headersSent) throw new Error("HTTP response headers were already sent");
}

function tryDestroyResponse(response: ServerResponse, error?: unknown): void {
	if (response.destroyed) return;
	try {
		response.destroy(error instanceof Error ? error : undefined);
	} catch {
		// The request boundary is best-effort once the response implementation itself fails.
	}
}

function appendServerTimingHeader(headers: Record<string, string | string[]>, value: string): void {
	const existing = headers["server-timing"];
	headers["server-timing"] = appendServerTiming(
		Array.isArray(existing) ? existing.join(", ") : existing ?? null,
		value,
	);
}

function responseHeaders(webResponse: Response): Record<string, string | string[]> {
	const headers: Record<string, string | string[]> = {};
	const setCookie = (webResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
	webResponse.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie") return;
		if (key.toLowerCase() === INTERNAL_SOCKET_PEER_HEADER) return;
		headers[key] = value;
	});
	if (setCookie?.length) {
		headers["set-cookie"] = setCookie;
	} else {
		const setCookieHeader = webResponse.headers.get("set-cookie");
		if (setCookieHeader) headers["set-cookie"] = setCookieHeader;
	}
	return headers;
}

function preferredResponseEncoding(
	acceptEncoding: string | string[] | undefined,
	webResponse: Response,
): "gzip" | undefined {
	if (!responseCanBeCompressed(webResponse)) return undefined;
	return acceptsEncoding(acceptEncoding, "gzip") ? "gzip" : undefined;
}

function acceptsEncoding(acceptEncoding: string | string[] | undefined, encoding: "gzip"): boolean {
	const accepted = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : acceptEncoding ?? "";
	return accepted.split(",").some((entry) => {
		const [name, ...parameters] = entry.trim().split(";").map((part) => part.trim());
		if (name !== encoding && name !== "*") return false;
		const q = parameters.find((parameter) => parameter.toLowerCase().startsWith("q="));
		if (!q) return true;
		const weight = Number(q.slice(2));
		return Number.isFinite(weight) && weight > 0;
	});
}

function responseCanBeCompressed(webResponse: Response): boolean {
	if (webResponse.status === 204 || webResponse.status === 304) return false;
	if (webResponse.headers.has("content-encoding")) return false;
	const contentType = webResponse.headers.get("content-type") ?? "";
	return /^application\/json\b/.test(contentType);
}

async function readResponseBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

function appendVary(existing: string | string[] | undefined, value: string): string {
	const values = Array.isArray(existing) ? existing.flatMap((item) => item.split(",")) : (existing ?? "").split(",");
	const normalized = values.map((item) => item.trim()).filter(Boolean);
	if (!normalized.some((item) => item.toLowerCase() === value.toLowerCase())) normalized.push(value);
	return normalized.join(", ");
}

function appendServerTiming(existing: string | null, value: string): string {
	return existing ? `${existing}, ${value}` : value;
}

/** Honor socket pressure before pulling another application frame. */
function waitForResponseDrain(response:ServerResponse,maximumAgeMs?:number,signal?:AbortSignal):Promise<boolean>{
 if(response.destroyed||response.writableEnded||signal?.aborted)return Promise.resolve(false);
 return new Promise(resolve=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(ready:boolean)=>{if(timer)clearTimeout(timer);response.off("drain",drain);response.off("close",close);response.off("error",close);signal?.removeEventListener("abort",close);resolve(ready);};
  const drain=()=>finish(true);const close=()=>finish(false);
  response.once("drain",drain);response.once("close",close);response.once("error",close);signal?.addEventListener("abort",close,{once:true});
  if(maximumAgeMs!==undefined){timer=setTimeout(close,maximumAgeMs);timer.unref();}
 });
}
