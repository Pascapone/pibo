import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { PreviewExposure } from "./types.js";

export const PREVIEW_SESSION_COOKIE = "pibo_preview_session";
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

function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
	for (const item of header?.split(";") ?? []) {
		const separator = item.indexOf("=");
		if (separator < 0) continue;
		if (item.slice(0, separator).trim() !== name) continue;
		return decodeURIComponent(item.slice(separator + 1).trim());
	}
	return undefined;
}

function isPiboCredentialCookie(name: string): boolean {
	const normalized = name.toLowerCase();
	return normalized === PREVIEW_SESSION_COOKIE ||
		normalized === "pibo_machine_session" ||
		normalized === "pibo_dev_session" ||
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

function upstreamOrigin(exposure: PreviewExposure): string {
	const host = exposure.targetHost === "::1" ? `[::1]` : exposure.targetHost;
	return `http://${host}:${exposure.targetPort}`;
}

function rewriteOriginHeader(value: string | undefined, exposure: PreviewExposure): string | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		const upstream = new URL(upstreamOrigin(exposure));
		parsed.protocol = upstream.protocol;
		parsed.hostname = upstream.hostname;
		parsed.port = upstream.port;
		return parsed.toString();
	} catch {
		return value;
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
		if (HOP_BY_HOP_HEADERS.has(normalized) || normalized === "host" || normalized === "authorization" || normalized.startsWith("x-pibo-")) continue;
		if (normalized === "cookie") {
			const cookie = withoutPiboCredentialCookies(firstHeader(value));
			if (cookie) headers.cookie = cookie;
			continue;
		}
		if (normalized === "origin") {
			headers.origin = rewriteOriginHeader(firstHeader(value), exposure);
			continue;
		}
		if (normalized === "referer") {
			headers.referer = rewriteOriginHeader(firstHeader(value), exposure);
			continue;
		}
		headers[normalized] = value;
	}
	const targetHost = exposure.targetHost === "::1" ? `[::1]` : exposure.targetHost;
	headers.host = `${targetHost}:${exposure.targetPort}`;
	headers["x-forwarded-host"] = requestURL.host;
	headers["x-forwarded-proto"] = requestURL.protocol.slice(0, -1);
	if (websocket) {
		headers.connection = "Upgrade";
		headers.upgrade = incoming.upgrade ?? "websocket";
	}
	return headers;
}

function rewriteLocation(value: string, exposure: PreviewExposure, previewOrigin: string): string {
	try {
		const location = new URL(value, previewOrigin);
		const upstream = new URL(upstreamOrigin(exposure));
		if (location.hostname === upstream.hostname && location.port === upstream.port) {
			const preview = new URL(previewOrigin);
			location.protocol = preview.protocol;
			location.hostname = preview.hostname;
			location.port = preview.port;
		}
		return location.toString();
	} catch {
		return value;
	}
}

function rewriteSetCookie(value: string): string | undefined {
	const [nameValue, ...attributes] = value.split(";");
	if (nameValue?.slice(0, nameValue.indexOf("=")).trim() === PREVIEW_SESSION_COOKIE) return undefined;
	const rewritten = [nameValue, ...attributes.filter((attribute) => !/^\s*domain=/i.test(attribute))];
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
				.map(rewriteSetCookie)
				.filter((item): item is string => Boolean(item));
			if (values.length) headers[normalized] = values;
			continue;
		}
		if (normalized === "location" && typeof value === "string") {
			headers.location = rewriteLocation(value, exposure, previewOrigin);
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

export function proxyPreviewHttp(input: {
	request: IncomingMessage;
	response: ServerResponse;
	requestURL: URL;
	exposure: PreviewExposure;
	piboOrigin?: string;
}): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const headers = requestHeaders(input.request.headers, input.exposure, input.requestURL, false);
		const upstream = httpRequest(
			targetOptions(input.exposure, input.request.url ?? "/", headers, input.request.method),
			(upstreamResponse) => {
				upstream.setTimeout(0);
				input.response.writeHead(
					upstreamResponse.statusCode ?? 502,
					upstreamResponse.statusMessage,
					responseHeaders(upstreamResponse.headers, input.exposure, input.requestURL.origin, input.piboOrigin),
				);
				upstreamResponse.pipe(input.response);
				upstreamResponse.once("end", finish);
				upstreamResponse.once("error", () => {
					if (!input.response.writableEnded) input.response.destroy();
					finish();
				});
			},
		);
		upstream.setTimeout(5_000, () => upstream.destroy(new Error("Preview upstream connection timed out")));
		upstream.once("error", (error) => {
			if (!input.response.headersSent) {
				input.response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
				input.response.end(JSON.stringify({ error: `Preview upstream unavailable: ${error.message}` }));
			} else if (!input.response.writableEnded) input.response.destroy(error);
			finish();
		});
		input.request.once("aborted", () => upstream.destroy());
		input.request.pipe(upstream);
	});
}

function writeUpgradeResponse(socket: Duplex, response: IncomingMessage): void {
	const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}`];
	for (let index = 0; index < response.rawHeaders.length; index += 2) {
		const name = response.rawHeaders[index];
		const value = response.rawHeaders[index + 1];
		if (!name || value === undefined || name.toLowerCase().startsWith("x-pibo-")) continue;
		lines.push(`${name}: ${value}`);
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
		const headers = requestHeaders(input.request.headers, input.exposure, input.requestURL, true);
		const upstreamRequest = httpRequest(targetOptions(input.exposure, input.request.url ?? "/", headers, "GET"));
		let upgraded = false;
		upstreamRequest.setTimeout(5_000, () => upstreamRequest.destroy(new Error("Preview WebSocket connection timed out")));
		upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
			upgraded = true;
			upstreamRequest.setTimeout(0);
			writeUpgradeResponse(input.socket, response);
			if (input.head.length) upstreamSocket.write(input.head);
			if (upstreamHead.length) input.socket.write(upstreamHead);
			upstreamSocket.pipe(input.socket);
			input.socket.pipe(upstreamSocket);
			const closeBoth = () => {
				upstreamSocket.destroy();
				input.socket.destroy();
			};
			upstreamSocket.once("error", closeBoth);
			input.socket.once("error", closeBoth);
			input.socket.once("close", () => upstreamSocket.destroy());
			upstreamSocket.once("close", () => {
				input.socket.destroy();
				resolve();
			});
		});
		upstreamRequest.once("response", (response) => {
			if (upgraded) return;
			input.socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
			resolve();
		});
		upstreamRequest.once("error", () => {
			if (!input.socket.destroyed) input.socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
			resolve();
		});
		upstreamRequest.end();
	});
}
