import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test, { after } from "node:test";

// The MCP server binds loopback; never route the test client through a proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PiboRemoteAgentAuth } from "../dist/remote-agent/auth.js";
import { PiboRemoteAgentMcpServer } from "../dist/remote-agent/mcp-server.js";
import { PiboRemoteAgentOAuth } from "../dist/remote-agent/oauth.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";

const closers = [];
after(async () => {
	for (const close of closers.splice(0)) await close();
});

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
	return { verifier, challenge };
}

async function startOAuthServer(rooms = [{ id: "room-a", modules: ["sessions", "observe", "files", "bash"] }]) {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	for (const room of rooms) {
		store.upsertRoomConfig(room.id, {
			enabled: true,
			modules: Object.fromEntries(["sessions", "observe", "files", "bash"].map((name) => [name, room.modules.includes(name)])),
		}, { sandboxPath: "/tmp/remote-oauth-test-sandbox" });
	}
	const auth = new PiboRemoteAgentAuth({ store });
	let issuer = "";
	const oauth = new PiboRemoteAgentOAuth({
		resolveIssuer: () => issuer,
		port: {
			listEnabledRoomIds: () => store.listEnabledRoomIds(),
			getRoomConfig: (roomId) => store.getRoomConfig(roomId),
			isRoomActive: (roomId) => store.getRoomConfig(roomId)?.enabled === true,
			claimDeviceCode: (code, roomId) => ({ label: auth.claimDeviceCode(code, roomId).label ?? "oauth-test" }),
			issueToken: (roomId, label, modules) => {
				const issued = auth.issueToken(roomId, label, modules);
				return { token: issued.token, expiresAt: issued.info.expiresAt };
			},
		},
	});
	const server = new PiboRemoteAgentMcpServer({
		oauth,
		authenticate: (token) => auth.authenticate(token),
		isRoomActive: (roomId) => store.getRoomConfig(roomId)?.enabled === true,
		resolveTools: () => [],
		resolveContext: (scope, toolCallId) => ({ roomId: scope.roomId, tokenId: scope.tokenId, label: scope.label, mode: "sandbox", sandboxRoot: "/tmp/remote-oauth-test-sandbox", cwd: "/tmp/remote-oauth-test-sandbox", toolCallId }),
	});
	const address = await server.start();
	issuer = address.url.replace(/\/mcp$/, "");
	closers.push(async () => { await server.stop(); store.close(); });
	return { store, auth, server, base: issuer, mcpUrl: address.url };
}

function authorizeUrl(base, { clientId, redirectUri, challenge, scope = "sessions observe files bash", state = "st_1", resource } = {}) {
	const url = new URL(`${base}/oauth/authorize`);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", scope);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	if (resource !== undefined) url.searchParams.set("resource", resource);
	return url.toString();
}

async function postDecision(base, { clientId, redirectUri, scope, state, challenge, roomId, modules, deviceCode, decision = "allow" }) {
	const params = new URLSearchParams();
	params.set("client_id", clientId);
	params.set("redirect_uri", redirectUri);
	params.set("scope", scope);
	params.set("state", state);
	params.set("code_challenge", challenge);
	for (const module of modules) params.append("modules", module);
	params.set("room_id", roomId);
	params.set("device_code", deviceCode);
	params.set("decision", decision);
	return fetch(`${base}/oauth/authorize`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: params.toString(),
		redirect: "manual",
	});
}

async function postToken(base, { code, redirectUri, clientId, verifier }) {
	const params = new URLSearchParams();
	params.set("grant_type", "authorization_code");
	params.set("code", code);
	params.set("redirect_uri", redirectUri);
	if (clientId !== undefined) params.set("client_id", clientId);
	params.set("code_verifier", verifier);
	const response = await fetch(`${base}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: params.toString(),
	});
	return { status: response.status, body: await response.json() };
}

async function connectMcp(url, token) {
	const transport = new StreamableHTTPClientTransport(url, {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
	});
	const client = new Client({ name: "remote-agent-oauth-test", version: "1" });
	closers.push(async () => { await transport.close().catch(() => {}); await client.close().catch(() => {}); });
	await client.connect(transport);
	return client;
}

test("OAuth discovery documents describe the MCP authorization endpoints", async () => {
	const { base } = await startOAuthServer();
	const protectedResource = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
	assert.equal(protectedResource.resource, base);
	assert.deepEqual(protectedResource.authorization_servers, [base]);
	assert.deepEqual(protectedResource.scopes_supported, ["sessions", "observe", "files", "bash"]);
	const serverMetadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
	assert.equal(serverMetadata.issuer, base);
	assert.equal(serverMetadata.authorization_endpoint, `${base}/oauth/authorize`);
	assert.equal(serverMetadata.token_endpoint, `${base}/oauth/token`);
	assert.equal(serverMetadata.registration_endpoint, `${base}/oauth/register`);
	assert.deepEqual(serverMetadata.code_challenge_methods_supported, ["S256"]);
	assert.deepEqual(serverMetadata.response_types_supported, ["code"]);
	const openIdAlias = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
	assert.equal(openIdAlias.issuer, base);
});

test("Dynamic client registration issues a public client", async () => {
	const { base } = await startOAuthServer();
	const response = await fetch(`${base}/oauth/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chat.openai.com/aip/g-1/oauth/callback", "http://evil.example/cb"] }),
	});
	assert.equal(response.status, 201);
	const body = await response.json();
	assert.match(body.client_id, /^rpoc_/);
	assert.equal(body.token_endpoint_auth_method, "none");
	assert.deepEqual(body.redirect_uris, ["https://chat.openai.com/aip/g-1/oauth/callback"]);
});

test("Authorize page renders rooms, modules, and the device code field", async () => {
	const { base } = await startOAuthServer();
	const { challenge } = pkce();
	const page = await fetch(authorizeUrl(base, { clientId: "chatgpt-dev", redirectUri: "https://chat.openai.com/aip/cb", challenge }));
	assert.equal(page.status, 200);
	const html = await page.text();
	assert.match(html, /room-a/);
	assert.match(html, /name="device_code"/);
	assert.match(html, /name="modules" value="sessions"/);
	assert.match(html, /name="modules" value="bash"/);
});

test("Authorize page shows chat display names when the port resolves them", async () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	store.upsertRoomConfig("room-a", { enabled: true }, { sandboxPath: "/tmp/remote-oauth-test-sandbox" });
	const oauth = new PiboRemoteAgentOAuth({
		resolveIssuer: () => "https://auth.example.com",
		port: {
			listEnabledRoomIds: () => ["room-a", "synthetic-cli-room"],
			roomDisplayName: (roomId) => roomId === "room-a" ? "Shared Chat" : undefined,
			getRoomConfig: (roomId) => store.getRoomConfig(roomId) ?? { roomId, enabled: true, mode: "sandbox", runtime: "muse", sandboxPath: "/tmp/x", modules: { sessions: true, observe: true, files: true, bash: true }, updatedAt: new Date().toISOString() },
			isRoomActive: () => true,
			claimDeviceCode: () => ({ label: "x" }),
			issueToken: () => { throw new Error("not used"); },
		},
	});
	const html = oauth.renderAuthorizePage({ clientId: "c", redirectUri: "https://chat.openai.com/cb", scope: "", requestedModules: [], codeChallenge: "x" });
	assert.match(html, /Shared Chat \(room-a\)/);
	assert.match(html, /value="synthetic-cli-room">synthetic-cli-room</);
	store.close();
});

test("Authorize without PKCE redirects an error to the client", async () => {
	const { base } = await startOAuthServer();
	const url = new URL(`${base}/oauth/authorize`);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", "chatgpt-dev");
	url.searchParams.set("redirect_uri", "https://chat.openai.com/aip/cb");
	url.searchParams.set("state", "st_9");
	const response = await fetch(url.toString(), { redirect: "manual" });
	assert.equal(response.status, 302);
	const location = new URL(response.headers.get("location"));
	assert.equal(`${location.origin}${location.pathname}`, "https://chat.openai.com/aip/cb");
	assert.equal(location.searchParams.get("error"), "invalid_request");
	assert.equal(location.searchParams.get("state"), "st_9");
});

test("Authorize with an unsafe redirect URI shows an error page instead of redirecting", async () => {
	const { base } = await startOAuthServer();
	const { challenge } = pkce();
	const response = await fetch(authorizeUrl(base, { clientId: "chatgpt-dev", redirectUri: "http://evil.example/cb", challenge }), { redirect: "manual" });
	assert.equal(response.status, 400);
	assert.match(await response.text(), /redirect_uri/);
});

test("Denying consent redirects access_denied", async () => {
	const { base } = await startOAuthServer();
	const { challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const response = await postDecision(base, { clientId: "chatgpt-dev", redirectUri, scope: "sessions", state: "st_d", challenge, roomId: "room-a", modules: ["sessions"], deviceCode: "XXXX-XXXX", decision: "deny" });
	assert.equal(response.status, 302);
	const location = new URL(response.headers.get("location"));
	assert.equal(location.searchParams.get("error"), "access_denied");
	assert.equal(location.searchParams.get("state"), "st_d");
});

test("Full ChatGPT-style flow issues a token that can ping over MCP", async () => {
	const { base, mcpUrl, auth, store } = await startOAuthServer();
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/g-1/oauth/callback";
	const registered = await (await fetch(`${base}/oauth/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ redirect_uris: [redirectUri] }),
	})).json();
	const deviceCode = auth.createDeviceCode("room-a", "chatgpt").code;
	const decision = await postDecision(base, { clientId: registered.client_id, redirectUri, scope: "sessions observe", state: "st_flow", challenge, roomId: "room-a", modules: ["sessions", "observe", "files", "bash"], deviceCode });
	assert.equal(decision.status, 302);
	const callback = new URL(decision.headers.get("location"));
	const code = callback.searchParams.get("code");
	assert.ok(code?.startsWith("rac_"));
	assert.equal(callback.searchParams.get("state"), "st_flow");
	const token = await postToken(base, { code, redirectUri, clientId: registered.client_id, verifier });
	assert.equal(token.status, 200);
	assert.equal(token.body.token_type, "Bearer");
	assert.ok(token.body.access_token.startsWith("pibo_remote_"));
	assert.ok(token.body.expires_in > 0);
	assert.equal(token.body.scope, "sessions observe");
	const stored = store.listTokens("room-a");
	assert.equal(stored.length, 1);
	assert.deepEqual(stored[0].modules, ["sessions", "observe"]);
	const client = await connectMcp(mcpUrl, token.body.access_token);
	const tools = await client.listTools();
	assert.ok(tools.tools.some((tool) => tool.name === "remote_ping"));
	const ping = await client.callTool({ name: "remote_ping", arguments: {} });
	assert.match(ping.content[0].text, /pong.*room-a/);
});

test("Token exchange rejects a wrong PKCE verifier and burns the code", async () => {
	const { base, auth } = await startOAuthServer();
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const deviceCode = auth.createDeviceCode("room-a").code;
	const decision = await postDecision(base, { clientId: "c1", redirectUri, scope: "sessions", state: "s", challenge, roomId: "room-a", modules: ["sessions"], deviceCode });
	const code = new URL(decision.headers.get("location")).searchParams.get("code");
	const wrong = await postToken(base, { code, redirectUri, clientId: "c1", verifier: `${verifier}x` });
	assert.equal(wrong.status, 400);
	assert.equal(wrong.body.error, "invalid_grant");
	const retry = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(retry.status, 400);
	assert.equal(retry.body.error, "invalid_grant");
});

test("Token exchange rejects a mismatched redirect URI and stays single-use", async () => {
	const { base, auth } = await startOAuthServer();
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const deviceCode = auth.createDeviceCode("room-a").code;
	const decision = await postDecision(base, { clientId: "c1", redirectUri, scope: "sessions", state: "s", challenge, roomId: "room-a", modules: ["sessions"], deviceCode });
	const code = new URL(decision.headers.get("location")).searchParams.get("code");
	const mismatch = await postToken(base, { code, redirectUri: "https://chat.openai.com/aip/other", clientId: "c1", verifier });
	assert.equal(mismatch.status, 400);
	assert.equal(mismatch.body.error, "invalid_grant");
	const ok = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(ok.status, 200);
	const replay = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(replay.status, 400);
});

test("A device code for another room is rejected without burning the code", async () => {
	const { base, auth } = await startOAuthServer([
		{ id: "room-a", modules: ["sessions"] },
		{ id: "room-b", modules: ["sessions"] },
	]);
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const deviceCode = auth.createDeviceCode("room-b").code;
	const wrongRoom = await postDecision(base, { clientId: "c1", redirectUri, scope: "sessions", state: "s", challenge, roomId: "room-a", modules: ["sessions"], deviceCode });
	assert.equal(wrongRoom.status, 200);
	assert.match(await wrongRoom.text(), /room-b/);
	const retry = await postDecision(base, { clientId: "c1", redirectUri, scope: "sessions", state: "s", challenge, roomId: "room-b", modules: ["sessions"], deviceCode });
	assert.equal(retry.status, 302);
	const code = new URL(retry.headers.get("location")).searchParams.get("code");
	const token = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(token.status, 200);
});

test("Granted modules stay within the room config", async () => {
	const { base, auth } = await startOAuthServer([{ id: "room-a", modules: ["sessions"] }]);
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const deviceCode = auth.createDeviceCode("room-a").code;
	const decision = await postDecision(base, { clientId: "c1", redirectUri, scope: "", state: "s", challenge, roomId: "room-a", modules: ["sessions", "bash"], deviceCode });
	assert.equal(decision.status, 302);
	const code = new URL(decision.headers.get("location")).searchParams.get("code");
	const token = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(token.status, 200);
	assert.equal(token.body.scope, "sessions");
});

test("Disabling the room between authorize and token fails the exchange", async () => {
	const { base, auth, store } = await startOAuthServer();
	const { verifier, challenge } = pkce();
	const redirectUri = "https://chat.openai.com/aip/cb";
	const deviceCode = auth.createDeviceCode("room-a").code;
	const decision = await postDecision(base, { clientId: "c1", redirectUri, scope: "sessions", state: "s", challenge, roomId: "room-a", modules: ["sessions"], deviceCode });
	const code = new URL(decision.headers.get("location")).searchParams.get("code");
	store.upsertRoomConfig("room-a", { enabled: false }, { sandboxPath: "/tmp/remote-oauth-test-sandbox" });
	const token = await postToken(base, { code, redirectUri, clientId: "c1", verifier });
	assert.equal(token.status, 400);
	assert.equal(token.body.error, "invalid_grant");
});

test("Unauthenticated MCP calls advertise the OAuth metadata URL", async () => {
	const { base, mcpUrl } = await startOAuthServer();
	const response = await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
	assert.equal(response.status, 401);
	const challenge = response.headers.get("www-authenticate");
	assert.ok(challenge?.startsWith("Bearer "));
	assert.ok(challenge?.includes(`${base}/.well-known/oauth-protected-resource`));
});
