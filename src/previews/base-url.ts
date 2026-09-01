import { isIP } from "node:net";

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

export function parsePreviewBaseURL(value: string): URL {
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
