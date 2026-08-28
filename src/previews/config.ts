import { isIP } from "node:net";
import { loadPiboConfig } from "../config/config.js";

export const DEFAULT_PREVIEW_TTL_MINUTES = 8 * 60;
export const DEFAULT_PREVIEW_TICKET_TTL_SECONDS = 60;
export const DEFAULT_PREVIEW_SESSION_TTL_MINUTES = 8 * 60;

export type PreviewConfig = {
	baseURL?: string;
	databasePath?: string;
	maxRunningServers?: number;
	autoStopMinutes?: number;
	maxProxyConnections?: number;
	maxProxyConnectionsPerPreview?: number;
};

function isLocalPreviewHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isValidDnsHostname(hostname: string): boolean {
	return isIP(hostname) === 0 &&
		hostname.length <= 253 &&
		!hostname.endsWith(".") &&
		hostname.split(".").every((label) =>
			label.length >= 1 &&
			label.length <= 63 &&
			/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
		);
}

export function loadPreviewConfig(): PreviewConfig {
	return loadPiboConfig().preview ?? {};
}

export function requirePreviewBaseURL(value = loadPreviewConfig().baseURL): URL {
	if (!value) throw new Error("preview.baseURL is required. Set it with `pibo config set preview.baseURL https://preview.example.com`.");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("preview.baseURL must be an absolute HTTP or HTTPS URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("preview.baseURL must use http or https");
	}
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("preview.baseURL must contain only scheme, hostname, and optional port");
	}
	if (!isValidDnsHostname(url.hostname)) {
		throw new Error("preview.baseURL hostname must be a DNS hostname without wildcards, IP literals, or a trailing dot");
	}
	if (url.protocol === "http:" && !isLocalPreviewHostname(url.hostname)) {
		throw new Error("preview.baseURL must use https except for localhost development");
	}
	return url;
}

export function previewPublicURL(previewId: string, baseURL = requirePreviewBaseURL()): URL {
	if (previewId.length > 63 || !/^pv-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(previewId)) {
		throw new Error(`Invalid preview id "${previewId}"`);
	}
	const url = new URL(baseURL.toString());
	url.hostname = `${previewId}.${baseURL.hostname}`;
	return url;
}

export function previewIdFromHostname(hostname: string, baseURL = requirePreviewBaseURL()): string | undefined {
	const normalized = hostname.toLowerCase();
	const suffix = `.${baseURL.hostname.toLowerCase()}`;
	if (!normalized.endsWith(suffix)) return undefined;
	const id = normalized.slice(0, -suffix.length);
	if (id.length > 63 || id.includes(".") || !/^pv-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) return undefined;
	return id;
}
