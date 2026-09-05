import { loadPiboConfig } from "../config/config.js";
import { sanitizePreviewServerSettings, type PreviewServerSettings } from "../core/preview-server-settings.js";
import { loadPiboUserSettings } from "../core/user-settings.js";
import { parsePreviewBaseURL } from "./base-url.js";

export const DEFAULT_PREVIEW_TTL_MINUTES = 8 * 60;
export const DEFAULT_PREVIEW_TICKET_TTL_SECONDS = 60;
export const DEFAULT_PREVIEW_SESSION_TTL_MINUTES = 8 * 60;
export const PREVIEW_TLS_AUTHORIZATION_PATH = "/api/previews/tls-authorize";

export type PreviewConfig = {
	baseURL?: string;
	databasePath?: string;
	maxRunningServers?: number;
	autoStopMinutes?: number;
	maxProxyConnections?: number;
	maxProxyConnectionsPerPreview?: number;
};

export function loadPreviewConfig(): PreviewConfig {
	return loadPiboConfig().preview ?? {};
}

export function loadEffectivePreviewServerSettings(): PreviewServerSettings {
	const config = loadPreviewConfig();
	const userSettings = loadPiboUserSettings().previewServers;
	return sanitizePreviewServerSettings({
		maxRunningServers: config.maxRunningServers ?? userSettings.maxRunningServers,
		autoStopMinutes: config.autoStopMinutes ?? userSettings.autoStopMinutes,
	});
}

export function requirePreviewBaseURL(value = loadPreviewConfig().baseURL): URL {
	if (!value) throw new Error("preview.baseURL is required. Run `pibo preview setup --base-url https://preview.example.com` for DNS, TLS, proxy, and restart instructions.");
	return parsePreviewBaseURL(value);
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
