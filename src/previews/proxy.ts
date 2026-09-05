import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import type { PreviewExposure } from "./types.js";

export const PREVIEW_SESSION_COOKIE = "__Host-pibo_preview_session";
export const PREVIEW_INSECURE_SESSION_COOKIE = "pibo_preview_session";
export const DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS = 128;
export const DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW = 32;
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export class PreviewProxyLimiter {
	private total = 0;
	private readonly perPreview = new Map<string, number>();

	constructor(
		readonly maxTotal = DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS,
		readonly maxPerPreview = DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW,
	) {
		if (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 10_000) {
			throw new Error("Preview proxy total connection limit must be between 1 and 10000");
		}
		if (!Number.isInteger(maxPerPreview) || maxPerPreview < 1 || maxPerPreview > maxTotal) {
			throw new Error("Preview proxy per-preview connection limit must be positive and no greater than the total limit");
		}
	}

	tryAcquire(previewId: string): (() => void) | undefined {
		const current = this.perPreview.get(previewId) ?? 0;
		if (this.total >= this.maxTotal || current >= this.maxPerPreview) return undefined;
		this.total += 1;
		this.perPreview.set(previewId, current + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.total -= 1;
			const next = (this.perPreview.get(previewId) ?? 1) - 1;
			if (next > 0) this.perPreview.set(previewId, next);
			else this.perPreview.delete(previewId);
		};
	}

	snapshot(): { total: number; previews: number } {
		return { total: this.total, previews: this.perPreview.size };
	}
}

export function previewSessionCookieName(protocol: string): string {
	return protocol === "https:" ? PREVIEW_SESSION_COOKIE : PREVIEW_INSECURE_SESSION_COOKIE;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
	for (const item of header?.split(";") ?? []) {
		const separator = item.indexOf("=");
		if (separator < 0) continue;
		if (item.slice(0, separator).trim() !== name) continue;
		try {
			return decodeURIComponent(item.slice(separator + 1).trim());
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function isPiboCredentialCookie(name: string): boolean {
	const normalized = name.toLowerCase();
	return normalized.startsWith("pibo_") ||
		normalized.startsWith("__host-pibo_") ||
		normalized.startsWith("__secure-pibo_") ||
		normalized.includes("better-auth");
}

function withoutPiboCredentialCookies(header: string | undefined): string | undefined {
	const cookies = (header?.split(";") ?? [])
		.map((item) => item.trim())
		.filter((item) => {
			const separator = item.indexOf("=");
			if (!item || separator < 0) return false;
			return !isPiboCredentialCookie(item.slice(0, separator).trim());
		});
	return cookies.length ? cookies.join("; ") : undefined;
}

function isCredentialOrProxyMetadataHeader(name: string): boolean {
	return name === "authorization" ||
		name === "forwarded" ||
		name === "proxy-authorization" ||
		name === "remote-user" ||
		name === "x-real-ip" ||
		name.startsWith("x-pibo-") ||
		name.startsWith("x-forwarded-") ||
		name.startsWith("x-auth-") ||
		name.startsWith("x-original-") ||
		name.startsWith("x-goog-authenticated-user-") ||
		name.startsWith("cf-access-");
}

function upstreamOrigin(exposure: PreviewExposure): string {
	const host = exposure.targetHost === "::1" ? `[::1]` : exposure.targetHost;
	return `http://${host}:${exposure.targetPort}`;
}

function rewriteOriginHeader(value: string | undefined, exposure: PreviewExposure): string | undefined {
	if (!value) return undefined;
	if (value === "null") return value;
	try {
		const parsed = new URL(value);
		const upstream = new URL(upstreamOrigin(exposure));
		parsed.protocol = upstream.protocol;
		parsed.hostname = upstream.hostname;
		parsed.port = upstream.port;
		return parsed.toString();
	} catch {
		return undefined;
	}
}

function requestHeaders(
	incoming: IncomingHttpHeaders,
	exposure: PreviewExposure,
	requestURL: URL,
	websocket: boolean,
): IncomingHttpHeaders {
	const headers: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(incoming)) {
		const normalized = name.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(normalized) || normalized === "host" || isCredentialOrProxyMetadataHeader(normalized)) continue;
		if (normalized === "cookie") {
			const cookie = withoutPiboCredentialCookies(firstHeader(value));
			if (cookie) headers.cookie = cookie;
			continue;
		}
		if (normalized === "origin") {
			const origin = rewriteOriginHeader(firstHeader(value), exposure);
			if (origin) headers.origin = origin;
			continue;
		}
		if (normalized === "referer") {
			const referer = rewriteOriginHeader(firstHeader(value), exposure);
			if (referer) headers.referer = referer;
			continue;
		}
		headers[normalized] = value;
	}
	const targetHost = exposure.targetHost === "::1" ? `[::1]` : exposure.targetHost;
	headers.host = `${targetHost}:${exposure.targetPort}`;
	if (exposure.proxyMode !== "pibo-compute-dev-auth") {
		headers["x-forwarded-host"] = requestURL.host;
		headers["x-forwarded-proto"] = requestURL.protocol.slice(0, -1);
	}
	if (websocket) {
		headers.connection = "Upgrade";
		headers.upgrade = incoming.upgrade ?? "websocket";
	}
	return headers;
}

function isForbiddenLocalRedirectHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
	const family = isIP(normalized);
	if (family === 4) {
		const [a, b] = normalized.split(".").map(Number);
		return a === 0 || a === 10 || a === 127 || a >= 224 ||
			a === 169 && b === 254 ||
			a === 172 && b! >= 16 && b! <= 31 ||
			a === 192 && b === 168 ||
			a === 100 && b! >= 64 && b! <= 127;
	}
	if (family === 6) {
		return normalized === "::" || normalized === "::1" ||
			normalized.startsWith("fc") || normalized.startsWith("fd") ||
			normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
			normalized.startsWith("fea") || normalized.startsWith("feb") ||
			normalized.startsWith("::ffff:");
	}
	return false;
}

export function sanitizePreviewRedirectLocation(value: string, exposure: PreviewExposure, previewOrigin: string): string | undefined {
	if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
	try {
		const location = new URL(value, previewOrigin);
		const upstream = new URL(upstreamOrigin(exposure));
		if (location.origin === upstream.origin) {
			const preview = new URL(previewOrigin);
			location.protocol = preview.protocol;
			location.hostname = preview.hostname;
			location.port = preview.port;
		}
		if (location.protocol !== "http:" && location.protocol !== "https:") return undefined;
		if (location.origin !== previewOrigin && isForbiddenLocalRedirectHost(location.hostname)) return undefined;
		return location.toString();
	} catch {
		return undefined;
	}
}

export function sanitizePreviewSetCookie(value: string): string | undefined {
	if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
	const [nameValue, ...attributes] = value.split(";");
	const separator = nameValue?.indexOf("=") ?? -1;
	if (!nameValue || separator <= 0 || isPiboCredentialCookie(nameValue.slice(0, separator).trim())) return undefined;
	const rewritten = [nameValue, ...attributes.filter((attribute) => !/^\s*domain\s*=/i.test(attribute))];
	return rewritten.filter(Boolean).join(";");
}

function rewriteFrameAncestors(value: string | undefined, piboOrigin: string | undefined): string | undefined {
	if (!piboOrigin) return value;
	const directives = (value ?? "")
		.split(";")
		.map((item) => item.trim())
		.filter((item) => item && !item.toLowerCase().startsWith("frame-ancestors"));
	directives.push(`frame-ancestors ${piboOrigin}`);
	return directives.join("; ");
}

function responseHeaders(
	incoming: IncomingHttpHeaders,
	exposure: PreviewExposure,
	previewOrigin: string,
	piboOrigin?: string,
): IncomingHttpHeaders {
	const headers: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(incoming)) {
		const normalized = name.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(normalized) || normalized === "x-frame-options" || normalized.startsWith("x-pibo-")) continue;
		if (normalized === "set-cookie") {
			const values = (Array.isArray(value) ? value : value ? [value] : [])
				.map(sanitizePreviewSetCookie)
				.filter((item): item is string => Boolean(item));
			if (values.length) headers[normalized] = values;
			continue;
		}
		if (normalized === "location") {
			const location = sanitizePreviewRedirectLocation(firstHeader(value) ?? "", exposure, previewOrigin);
			if (location) headers.location = location;
			continue;
		}
		if (normalized === "content-security-policy") {
			headers[normalized] = rewriteFrameAncestors(firstHeader(value), piboOrigin);
			continue;
		}
		if (normalized === "access-control-allow-origin" && typeof value === "string") {
			headers[normalized] = value === upstreamOrigin(exposure) ? previewOrigin : value;
			continue;
		}
		headers[normalized] = value;
	}
	if (!headers["content-security-policy"] && piboOrigin) {
		headers["content-security-policy"] = `frame-ancestors ${piboOrigin}`;
	}
	headers["referrer-policy"] = "no-referrer";
	return headers;
}

function targetOptions(exposure: PreviewExposure, path: string, headers: IncomingHttpHeaders, method: string | undefined): RequestOptions {
	return {
		host: exposure.targetHost,
		port: exposure.targetPort,
		method: method ?? "GET",
		path,
		headers,
	};
}

function upstreamRequestPath(requestURL: URL): string {
	return `${requestURL.pathname}${requestURL.search}`;
}

export function proxyPreviewHttp(input: {
	request: IncomingMessage;
	response: ServerResponse;
	requestURL: URL;
	exposure: PreviewExposure;
	piboOrigin?: string;
}): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false;
		let upstreamRequest: ReturnType<typeof httpRequest> | undefined;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		input.response.once("finish", finish);
		const headers = requestHeaders(input.request.headers, input.exposure, input.requestURL, false);
		const upstream = httpRequest(
			targetOptions(input.exposure, upstreamRequestPath(input.requestURL), headers, input.request.method),
			(upstreamResponse) => {
				upstream.setTimeout(0);
				input.response.writeHead(
					upstreamResponse.statusCode ?? 502,
					upstreamResponse.statusMessage,
					responseHeaders(upstreamResponse.headers, input.exposure, input.requestURL.origin, input.piboOrigin),
				);
				upstreamResponse.pipe(input.response);
				upstreamResponse.once("error", () => {
					if (!input.response.writableEnded) input.response.destroy();
				});
			},
		);
		upstreamRequest = upstream;
		upstream.setTimeout(5_000, () => upstream.destroy(new Error("Preview upstream connection timed out")));
		upstream.once("error", (error) => {
			if (!input.response.headersSent) {
				input.response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
				input.response.end(JSON.stringify({ error: "Preview upstream unavailable" }));
			} else if (!input.response.writableEnded) input.response.destroy(error);
		});
		input.request.once("aborted", () => upstream.destroy());
		input.response.once("close", () => {
			upstreamRequest?.destroy();
			finish();
		});
		input.request.pipe(upstream);
	});
}

function writeUpgradeResponse(
	socket: Duplex,
	response: IncomingMessage,
	exposure: PreviewExposure,
	previewOrigin: string,
): void {
	const lines = ["HTTP/1.1 101 Switching Protocols", "Connection: Upgrade", "Upgrade: websocket"];
	const headers = responseHeaders(response.headers, exposure, previewOrigin);
	for (const [name, rawValue] of Object.entries(headers)) {
		if (name === "connection" || name === "upgrade" || name === "content-length") continue;
		for (const value of Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue]) {
			lines.push(`${name}: ${value}`);
		}
	}
	socket.write(`${lines.join("\r\n")}\r\n\r\n`);
}

export function proxyPreviewWebSocket(input: {
	request: IncomingMessage;
	socket: Duplex;
	head: Buffer;
	requestURL: URL;
	exposure: PreviewExposure;
}): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false;
		let upstreamSocket: Duplex | undefined;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const headers = requestHeaders(input.request.headers, input.exposure, input.requestURL, true);
		const upstreamRequest = httpRequest(targetOptions(input.exposure, upstreamRequestPath(input.requestURL), headers, "GET"));
		let upgraded = false;
		const closeFromClient = () => {
			upstreamRequest.destroy();
			upstreamSocket?.destroy();
			finish();
		};
		input.socket.once("end", closeFromClient);
		input.socket.once("close", closeFromClient);
		input.socket.once("error", closeFromClient);
		upstreamRequest.setTimeout(5_000, () => upstreamRequest.destroy(new Error("Preview WebSocket connection timed out")));
		upstreamRequest.once("upgrade", (response, socket, upstreamHead) => {
			upgraded = true;
			upstreamSocket = socket;
			upstreamRequest.setTimeout(0);
			writeUpgradeResponse(input.socket, response, input.exposure, input.requestURL.origin);
			if (input.head.length) socket.write(input.head);
			if (upstreamHead.length) input.socket.write(upstreamHead);
			socket.pipe(input.socket);
			input.socket.pipe(socket);
			const closeBoth = () => {
				socket.destroy();
				input.socket.destroy();
				finish();
			};
			socket.once("error", closeBoth);
			input.socket.once("error", closeBoth);
			socket.once("close", () => {
				input.socket.destroy();
				finish();
			});
		});
		upstreamRequest.once("response", (response) => {
			if (upgraded) return;
			response.resume();
			input.socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
			finish();
		});
		upstreamRequest.once("error", () => {
			if (!input.socket.destroyed) input.socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
			finish();
		});
		upstreamRequest.end();
	});
}
