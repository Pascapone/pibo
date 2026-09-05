import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PREVIEW_TLS_AUTHORIZATION_PATH, previewPublicURL, requirePreviewBaseURL } from "./config.js";

export type PreviewProductionSetupPlan = {
	baseURL: string;
	wildcardHostname: string;
	dnsRecord: {
		type: "A" | "AAAA" | "A or AAAA";
		name: string;
		value: string;
	};
	gateway: {
		host: "127.0.0.1";
		port: number;
		tlsAuthorizationURL: string;
	};
	caddy: {
		globalOptions: string;
		siteBlock: string;
	};
	commands: {
		configure: string;
		restartGateway: string;
		validateCaddy: string;
		verify: string;
	};
	warnings: string[];
};

export type PreviewPublicCheck = {
	status: "ok" | "fail";
	detail: string;
};

export type PreviewPublicRouteChecks = {
	publicURL: string;
	dns: PreviewPublicCheck & { addresses: string[] };
	tlsAndRouting: PreviewPublicCheck & { httpStatus?: number; location?: string };
};

type PublicProbeOptions = {
	resolveHostname?: (hostname: string) => Promise<string[]>;
	request?: (url: URL) => Promise<{ status: number; location?: string }>;
};

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function validateGatewayPort(port: number): number {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Gateway port must be an integer between 1 and 65535");
	return port;
}

function validatePublicIp(value: string | undefined): { type: "A" | "AAAA" | "A or AAAA"; value: string } {
	if (!value) return { type: "A or AAAA", value: "<public-gateway-ip>" };
	const family = isIP(value);
	if (family === 0) throw new Error("Public IP must be a valid IPv4 or IPv6 address");
	return { type: family === 4 ? "A" : "AAAA", value };
}

export function createPreviewProductionSetupPlan(input: {
	baseURL: string;
	gatewayPort?: number;
	publicIp?: string;
}): PreviewProductionSetupPlan {
	const baseURL = requirePreviewBaseURL(input.baseURL);
	const gatewayPort = validateGatewayPort(input.gatewayPort ?? 4788);
	const publicIp = validatePublicIp(input.publicIp);
	const wildcardHostname = `*.${baseURL.hostname}`;
	const caddySiteAddress = baseURL.port ? `${wildcardHostname}:${baseURL.port}` : wildcardHostname;
	const tlsAuthorizationURL = `http://127.0.0.1:${gatewayPort}${PREVIEW_TLS_AUTHORIZATION_PATH}`;
	return {
		baseURL: baseURL.toString(),
		wildcardHostname,
		dnsRecord: {
			type: publicIp.type,
			name: wildcardHostname,
			value: publicIp.value,
		},
		gateway: {
			host: "127.0.0.1",
			port: gatewayPort,
			tlsAuthorizationURL,
		},
		caddy: {
			globalOptions: `on_demand_tls {\n\task ${tlsAuthorizationURL}\n}`,
			siteBlock: `${caddySiteAddress} {\n\ttls {\n\t\ton_demand\n\t}\n\treverse_proxy 127.0.0.1:${gatewayPort}\n}`,
		},
		commands: {
			configure: `pibo config set preview.baseURL ${shellQuote(baseURL.origin)}`,
			restartGateway: "pibo gateway web restart",
			validateCaddy: "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy",
			verify: "pibo preview doctor <preview-id> --public",
		},
		warnings: [
			"Merge the on_demand_tls stanza into an existing Caddy global options block; a Caddyfile may contain only one global options block.",
			"Create the wildcard DNS record before Caddy requests the first Preview certificate.",
			"Restart the Pibo gateway after setting preview.baseURL; the safe restart may wait for active sessions.",
		],
	};
}

async function resolveHostname(hostname: string): Promise<string[]> {
	return (await lookup(hostname, { all: true })).map((entry) => entry.address);
}

async function requestPreview(url: URL): Promise<{ status: number; location?: string }> {
	const response = await fetch(url, {
		method: "GET",
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
	});
	return { status: response.status, location: response.headers.get("location") ?? undefined };
}

function errorDetail(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function inspectPreviewPublicRoute(
	baseURLValue: string | URL,
	previewId: string,
	options: PublicProbeOptions = {},
): Promise<PreviewPublicRouteChecks> {
	const baseURL = requirePreviewBaseURL(baseURLValue instanceof URL ? baseURLValue.toString() : baseURLValue);
	const publicURL = previewPublicURL(previewId, baseURL);
	let addresses: string[] = [];
	let dns: PreviewPublicRouteChecks["dns"];
	try {
		addresses = await (options.resolveHostname ?? resolveHostname)(publicURL.hostname);
		dns = addresses.length > 0
			? { status: "ok", detail: `Resolved ${publicURL.hostname}`, addresses }
			: { status: "fail", detail: `${publicURL.hostname} returned no addresses`, addresses };
	} catch (error) {
		dns = { status: "fail", detail: `DNS lookup failed: ${errorDetail(error)}`, addresses };
	}

	let tlsAndRouting: PreviewPublicRouteChecks["tlsAndRouting"];
	try {
		const response = await (options.request ?? requestPreview)(publicURL);
		if (response.status === 401) {
			tlsAndRouting = {
				status: "ok",
				detail: "HTTPS reached the Preview gateway and anonymous access was rejected",
				httpStatus: response.status,
			};
		} else {
			tlsAndRouting = {
				status: "fail",
				detail: `Expected HTTP 401 from the Preview gateway, received HTTP ${response.status}`,
				httpStatus: response.status,
				...(response.location ? { location: response.location } : {}),
			};
		}
	} catch (error) {
		tlsAndRouting = { status: "fail", detail: `HTTPS request failed: ${errorDetail(error)}` };
	}

	return { publicURL: publicURL.toString(), dns, tlsAndRouting };
}
