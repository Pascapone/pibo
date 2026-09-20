import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	isRemoteAgentModuleName,
	REMOTE_AGENT_MODULES,
	RemoteAgentError,
	type RemoteAgentModuleName,
	type RemoteRoomConfig,
} from "./types.js";

/**
 * Minimal OAuth 2.1 authorization server for ChatGPT plugins (MCP authorization profile).
 *
 * Pibo is both authorization server and resource server here: the issued access
 * tokens are the existing room-scoped remote tokens, so revocation, expiry, and
 * the tab connection list keep working unchanged. The device code (created in
 * the Google-authenticated tab) is the login step on the consent page.
 *
 * Deliberately minimal for the first plugin run; harden later:
 * - redirect URIs accept any https URL (dev) — tighten to an allowlist later
 * - any client_id is accepted (public clients) — CIMD signature checks later
 * - no refresh tokens yet — expired connections re-run the authorize flow
 */

export const REMOTE_OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_PREFIX = "rac_";
const CLIENT_ID_PREFIX = "rpoc_";

export const REMOTE_OAUTH_PATHS = {
	protectedResourceMetadata: "/.well-known/oauth-protected-resource",
	authorizationServerMetadata: "/.well-known/oauth-authorization-server",
	openIdConfiguration: "/.well-known/openid-configuration",
	register: "/oauth/register",
	authorize: "/oauth/authorize",
	token: "/oauth/token",
} as const;

export type RemoteOAuthPort = {
	listEnabledRoomIds(): string[];
	/** Chat display name for a room id, if it names a real chat room. */
	roomDisplayName?(roomId: string): string | undefined;
	getRoomConfig(roomId: string): RemoteRoomConfig;
	isRoomActive(roomId: string): boolean;
	/** Validate a device code for a room and burn it. Returns the connection label. */
	claimDeviceCode(code: string, roomId: string): { label: string };
	issueToken(roomId: string, label: string | undefined, modules: readonly RemoteAgentModuleName[]): { token: string; expiresAt: string };
};

export type RemoteOAuthOptions = {
	/** Canonical public base URL, e.g. https://pibo-remote.example.com (no trailing slash). */
	resolveIssuer: () => string;
	port: RemoteOAuthPort;
	now?: () => number;
};

type RegisteredClient = {
	clientId: string;
	name?: string;
	redirectUris: string[];
	createdAt: string;
};

type PendingGrant = {
	code: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	roomId: string;
	modules: RemoteAgentModuleName[];
	label: string;
	expiresAtMs: number;
	used: boolean;
};

export type AuthorizeRequest = {
	clientId: string;
	redirectUri: string;
	scope: string;
	requestedModules: RemoteAgentModuleName[];
	state?: string;
	codeChallenge: string;
	resource?: string;
};

/** Redirect back to the client with an OAuth error. */
export class OAuthRedirectError extends Error {
	readonly redirectUri: string;
	readonly errorCode: string;
	readonly state?: string;

	constructor(redirectUri: string, errorCode: string, message: string, state?: string) {
		super(message);
		this.name = "OAuthRedirectError";
		this.redirectUri = redirectUri;
		this.errorCode = errorCode;
		this.state = state;
	}
}

/** Show an error page: redirecting would be unsafe (bad redirect_uri). */
export class OAuthDisplayError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OAuthDisplayError";
	}
}

function base64urlSha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a, "utf8");
	const bBuffer = Buffer.from(b, "utf8");
	if (aBuffer.length !== bBuffer.length) return false;
	return timingSafeEqual(aBuffer, bBuffer);
}

function isLoopbackUrl(url: URL): boolean {
	return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

/** Dev policy: any https URL, or http only on loopback. Tighten to an allowlist later. */
function isAcceptableRedirectUri(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	return url.protocol === "http:" && isLoopbackUrl(url);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function appendQueryParams(rawUrl: string, params: Record<string, string | undefined>): string {
	const url = new URL(rawUrl);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") url.searchParams.append(key, value);
	}
	return url.toString();
}

export function parseOAuthScope(scope: string | undefined): RemoteAgentModuleName[] {
	if (!scope) return [];
	const modules: RemoteAgentModuleName[] = [];
	for (const part of scope.split(/\s+/)) {
		if (isRemoteAgentModuleName(part) && !modules.includes(part)) modules.push(part);
	}
	return modules;
}

function normalizeIssuer(raw: string): string {
	return raw.trim().replace(/\/+$/, "");
}

export class PiboRemoteAgentOAuth {
	private readonly options: RemoteOAuthOptions;
	private readonly now: () => number;
	private readonly clients = new Map<string, RegisteredClient>();
	private readonly grants = new Map<string, PendingGrant>();

	constructor(options: RemoteOAuthOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	issuer(): string {
		return normalizeIssuer(this.options.resolveIssuer());
	}

	endpoint(path: string): string {
		return `${this.issuer()}${path}`;
	}

	// -- discovery ----------------------------------------------------------

	protectedResourceMetadata(): Record<string, unknown> {
		const issuer = this.issuer();
		return {
			resource: issuer,
			resource_name: "Pibo Remote Agent",
			authorization_servers: [issuer],
			scopes_supported: [...REMOTE_AGENT_MODULES],
			bearer_methods_supported: ["header"],
		};
	}

	authorizationServerMetadata(): Record<string, unknown> {
		const issuer = this.issuer();
		return {
			issuer,
			authorization_endpoint: `${issuer}${REMOTE_OAUTH_PATHS.authorize}`,
			token_endpoint: `${issuer}${REMOTE_OAUTH_PATHS.token}`,
			registration_endpoint: `${issuer}${REMOTE_OAUTH_PATHS.register}`,
			response_types_supported: ["code"],
			response_modes_supported: ["query"],
			grant_types_supported: ["authorization_code"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
			scopes_supported: [...REMOTE_AGENT_MODULES],
			service_documentation: "https://developers.openai.com/plugins/build/auth",
		};
	}

	resourceChallenge(scope?: string): string {
		const metadata = this.endpoint(REMOTE_OAUTH_PATHS.protectedResourceMetadata);
		return scope
			? `Bearer resource_metadata="${metadata}", scope="${scope}"`
			: `Bearer resource_metadata="${metadata}"`;
	}

	// -- dynamic client registration ------------------------------------------

	registerClient(input: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown }): Record<string, unknown> {
		const redirectUris = Array.isArray(input.redirect_uris)
			? input.redirect_uris.filter((uri): uri is string => typeof uri === "string" && isAcceptableRedirectUri(uri))
			: [];
		const clientId = `${CLIENT_ID_PREFIX}${randomBytes(16).toString("base64url")}`;
		const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 120) : undefined;
		this.clients.set(clientId, {
			clientId,
			...(name ? { name } : {}),
			redirectUris,
			createdAt: new Date(this.now()).toISOString(),
		});
		return {
			client_id: clientId,
			...(name ? { client_name: name } : {}),
			redirect_uris: redirectUris,
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code"],
			response_types: ["code"],
		};
	}

	// -- authorize ------------------------------------------------------------

	parseAuthorizeRequest(query: Record<string, string | undefined>): AuthorizeRequest {
		const clientId = query.client_id?.trim() ?? "";
		const redirectUri = query.redirect_uri?.trim() ?? "";
		const state = query.state && query.state !== "" ? query.state : undefined;
		if (!clientId) throw new OAuthDisplayError("Missing client_id.");
		if (!redirectUri || !isAcceptableRedirectUri(redirectUri)) {
			throw new OAuthDisplayError("Missing or invalid redirect_uri. HTTPS (or loopback http) is required.");
		}
		const fail = (errorCode: string, message: string): never => {
			throw new OAuthRedirectError(redirectUri, errorCode, message, state);
		};
		if (query.response_type !== "code") fail("unsupported_response_type", "Only response_type=code is supported.");
		const registered = this.clients.get(clientId);
		if (registered && registered.redirectUris.length > 0 && !registered.redirectUris.includes(redirectUri)) {
			fail("invalid_request", "redirect_uri is not registered for this client.");
		}
		const codeChallenge = query.code_challenge?.trim() ?? "";
		if (!codeChallenge) fail("invalid_request", "code_challenge (PKCE) is required.");
		if (query.code_challenge_method !== "S256") fail("invalid_request", "Only code_challenge_method=S256 is supported.");
		const resource = query.resource?.trim() || undefined;
		if (resource !== undefined && resource !== this.issuer()) {
			fail("invalid_target", "resource does not match this server.");
		}
		const scope = query.scope ?? "";
		return { clientId, redirectUri, scope, requestedModules: parseOAuthScope(scope), ...(state ? { state } : {}), codeChallenge, ...(resource ? { resource } : {}) };
	}

	errorRedirectUrl(error: OAuthRedirectError): string {
		return appendQueryParams(error.redirectUri, { error: error.errorCode, error_description: error.message, state: error.state });
	}

	renderAuthorizePage(request: AuthorizeRequest, input: { error?: string } = {}): string {
		const rooms = this.options.port.listEnabledRoomIds();
		const roomOptions = rooms.map((roomId) => {
			const config = this.options.port.getRoomConfig(roomId);
			const displayName = this.options.port.roomDisplayName?.(roomId)?.trim() || undefined;
			return { roomId, modules: config.modules, label: displayName && displayName !== roomId ? `${displayName} (${roomId})` : roomId };
		});
		const roomData = JSON.stringify(Object.fromEntries(roomOptions.map((room) => [room.roomId, room.modules])));
		const optionsHtml = roomOptions.length === 0
			? `<option value="" disabled selected>No room with remote access enabled</option>`
			: roomOptions.map((room) => `<option value="${escapeHtml(room.roomId)}">${escapeHtml(room.label)}</option>`).join("\n");
		const scopeText = request.requestedModules.length > 0 ? request.requestedModules.join(", ") : "all room modules";
		const errorHtml = input.error ? `<p class="error">${escapeHtml(input.error)}</p>` : "";
		const clientLabel = this.clients.get(request.clientId)?.name ?? request.clientId;
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Pibo Remote Agent</title>
<style>
body { font-family: ui-monospace, monospace; background: #0b0f14; color: #c9d4e0; margin: 0; padding: 2rem 1rem; }
main { max-width: 32rem; margin: 0 auto; border: 1px solid #1f6f8b; border-radius: 8px; padding: 1.5rem; background: #0e141b; }
h1 { font-size: 1.1rem; color: #4fd1c5; margin-top: 0; }
p.hint, label span { color: #8fa3b8; }
.error { color: #f4a7b9; border: 1px solid #f4a7b9; border-radius: 4px; padding: 0.5rem 0.75rem; }
label { display: block; margin: 1rem 0; }
label span { display: block; font-size: 0.8rem; margin-bottom: 0.25rem; }
input[type=text], select { width: 100%; box-sizing: border-box; background: #141c26; color: #e6edf3; border: 1px solid #2b3b4d; border-radius: 4px; padding: 0.5rem; font: inherit; }
.checkboxes label { display: inline-block; margin: 0.25rem 1rem 0.25rem 0; }
.actions { display: flex; gap: 1rem; margin-top: 1.5rem; }
button { font: inherit; border-radius: 4px; padding: 0.5rem 1.25rem; cursor: pointer; }
button.allow { background: #1f6f8b; color: #fff; border: 1px solid #4fd1c5; }
button.deny { background: transparent; color: #8fa3b8; border: 1px solid #2b3b4d; }
code { color: #4fd1c5; }
</style>
</head>
<body>
<main>
<h1>\u{1F4E1} Connect <code>${escapeHtml(clientLabel.length > 48 ? `${clientLabel.slice(0, 48)}…` : clientLabel)}</code> to Pibo</h1>
<p class="hint">The plugin requests access to these modules: <code>${escapeHtml(scopeText)}</code>.<br>
Create a device code in the Pibo Remote Agent tab, pick the room, and allow.</p>
${errorHtml}
<form method="post" action="${REMOTE_OAUTH_PATHS.authorize}">
<input type="hidden" name="client_id" value="${escapeHtml(request.clientId)}">
<input type="hidden" name="redirect_uri" value="${escapeHtml(request.redirectUri)}">
<input type="hidden" name="scope" value="${escapeHtml(request.scope)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(request.codeChallenge)}">
${request.state ? `<input type="hidden" name="state" value="${escapeHtml(request.state)}">` : ""}
${request.resource ? `<input type="hidden" name="resource" value="${escapeHtml(request.resource)}">` : ""}
<label><span>Room</span>
<select name="room_id" id="room">
${optionsHtml}
</select></label>
<label><span>Modules</span></label>
<div class="checkboxes" id="modules">
${REMOTE_AGENT_MODULES.map((module) => `<label><input type="checkbox" name="modules" value="${module}" checked> ${module}</label>`).join("\n")}
</div>
<label><span>Device code (from the Pibo tab, 10 minutes valid)</span>
<input type="text" name="device_code" placeholder="XXXX-XXXX" autocomplete="off" required></label>
<div class="actions">
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
<button class="deny" type="submit" name="decision" value="deny" formnovalidate>Deny</button>
</div>
</form>
<script>
const rooms = ${roomData.replaceAll("<", "\\u003c")};
const select = document.getElementById("room");
const boxes = Array.from(document.querySelectorAll('#modules input[type=checkbox]'));
function sync() {
	const modules = rooms[select.value] || {};
	for (const box of boxes) box.checked = modules[box.value] !== false;
}
select.addEventListener("change", sync);
sync();
</script>
</main>
</body>
</html>`;
	}

	renderErrorPage(message: string): string {
		return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pibo Remote Agent</title></head>
<body style="font-family: ui-monospace, monospace; background: #0b0f14; color: #c9d4e0; padding: 2rem;">
<h1 style="color: #f4a7b9;">Connection failed</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
	}

	submitDecision(form: { values: (name: string) => string[]; single: (name: string) => string | undefined }): { redirectUrl: string } | { rerender: AuthorizeRequest; error: string } {
		let request: AuthorizeRequest;
		try {
			request = this.parseAuthorizeRequest({
				client_id: form.single("client_id"),
				redirect_uri: form.single("redirect_uri"),
				response_type: "code",
				scope: form.single("scope"),
				state: form.single("state"),
				code_challenge: form.single("code_challenge"),
				code_challenge_method: "S256",
				resource: form.single("resource"),
			});
		} catch (error) {
			if (error instanceof OAuthRedirectError) return { redirectUrl: this.errorRedirectUrl(error) };
			throw error;
		}
		if (form.single("decision") === "deny") {
			return { redirectUrl: appendQueryParams(request.redirectUri, { error: "access_denied", state: request.state }) };
		}
		const roomId = form.single("room_id")?.trim() ?? "";
		if (!roomId || !this.options.port.isRoomActive(roomId)) {
			return { rerender: request, error: "Pick a room with remote access enabled." };
		}
		const config = this.options.port.getRoomConfig(roomId);
		const checked = form.values("modules").filter(isRemoteAgentModuleName);
		const roomEnabled = REMOTE_AGENT_MODULES.filter((module) => config.modules[module]);
		const inScope = request.requestedModules.length === 0
			? checked
			: checked.filter((module) => request.requestedModules.includes(module));
		const granted = inScope.filter((module) => roomEnabled.includes(module));
		if (granted.length === 0) {
			return { rerender: request, error: "Select at least one module that is enabled for this room." };
		}
		const deviceCode = form.single("device_code")?.trim() ?? "";
		if (!deviceCode) return { rerender: request, error: "Enter the device code from the Pibo tab." };
		let label: string;
		try {
			label = this.options.port.claimDeviceCode(deviceCode, roomId).label;
		} catch (error) {
			const message = error instanceof RemoteAgentError ? error.message : "Device code is invalid.";
			return { rerender: request, error: message };
		}
		this.pruneGrants();
		const code = `${AUTH_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
		this.grants.set(code, {
			code,
			clientId: request.clientId,
			redirectUri: request.redirectUri,
			codeChallenge: request.codeChallenge,
			roomId,
			modules: granted,
			label,
			expiresAtMs: this.now() + REMOTE_OAUTH_CODE_TTL_MS,
			used: false,
		});
		return { redirectUrl: appendQueryParams(request.redirectUri, { code, state: request.state }) };
	}

	// -- token ------------------------------------------------------------------

	exchangeCode(input: { grantType?: string; code?: string; redirectUri?: string; clientId?: string; codeVerifier?: string }): { status: number; body: Record<string, unknown> } {
		if (input.grantType !== "authorization_code") {
			return { status: 400, body: { error: "unsupported_grant_type" } };
		}
		const invalid = { status: 400, body: { error: "invalid_grant" } };
		const code = input.code?.trim() ?? "";
		if (!code) return invalid;
		const grant = this.grants.get(code);
		if (!grant || grant.used || grant.expiresAtMs <= this.now()) {
			if (grant) this.grants.delete(code);
			return invalid;
		}
		if (input.clientId && input.clientId !== grant.clientId) return invalid;
		if (!input.redirectUri || input.redirectUri !== grant.redirectUri) return invalid;
		const verifier = input.codeVerifier ?? "";
		if (!verifier || !timingSafeStringEqual(base64urlSha256(verifier), grant.codeChallenge)) {
			this.grants.delete(code);
			return invalid;
		}
		this.grants.delete(code);
		if (!this.options.port.isRoomActive(grant.roomId)) {
			return { status: 400, body: { error: "invalid_grant", error_description: "Remote access is disabled for this room." } };
		}
		const config = this.options.port.getRoomConfig(grant.roomId);
		const modules = grant.modules.filter((module) => config.modules[module]);
		if (modules.length === 0) {
			return { status: 400, body: { error: "invalid_grant", error_description: "All granted modules are disabled for this room." } };
		}
		const issued = this.options.port.issueToken(grant.roomId, grant.label, modules);
		const expiresIn = Math.max(Math.floor((Date.parse(issued.expiresAt) - this.now()) / 1000), 1);
		return {
			status: 200,
			body: { access_token: issued.token, token_type: "Bearer", expires_in: expiresIn, scope: modules.join(" ") },
		};
	}

	private pruneGrants(): void {
		const now = this.now();
		for (const [code, grant] of this.grants) {
			if (grant.used || grant.expiresAtMs <= now) this.grants.delete(code);
		}
	}
}
