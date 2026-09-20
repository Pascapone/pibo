import assert from "node:assert/strict";
import test, { after } from "node:test";

// The MCP server binds loopback; never route the test client through a proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PiboRemoteAgentAuth } from "../dist/remote-agent/auth.js";
import { PiboRemoteAgentMcpServer } from "../dist/remote-agent/mcp-server.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { buildSessionModuleTools } from "../dist/remote-agent/modules/sessions.js";

const closers = [];
after(async () => {
	for (const close of closers.splice(0)) await close();
});

async function startServer({ modules, roomId = "room-a" }) {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	store.upsertRoomConfig(roomId, { enabled: true, modules: Object.fromEntries(modules.map((name) => [name, true])) }, { sandboxPath: "/tmp/remote-test-sandbox" });
	const auth = new PiboRemoteAgentAuth({ store });
	const sessions = [{ id: "ps_a1", title: "Alpha", profile: "default", channel: "pibo.chat-web", kind: "chat", createdAt: "2026-09-19T10:00:00.000Z", updatedAt: "2026-09-19T11:00:00.000Z" }];
	const server = new PiboRemoteAgentMcpServer({
		authenticate: (token) => auth.authenticate(token),
		isRoomActive: (id) => store.getRoomConfig(id)?.enabled === true,
		resolveTools: () => buildSessionModuleTools({
			listRoomSessions: () => sessions,
			getRoomSession: (room, sessionId) => room === roomId ? sessions.find((session) => session.id === sessionId) : undefined,
			createRoomSession: (room, input) => ({ id: "ps_new", profile: input.profile ?? "default", channel: "pibo.chat-web", kind: "chat", createdAt: "2026-09-19T12:00:00.000Z", updatedAt: "2026-09-19T12:00:00.000Z", ...(input.title ? { title: input.title } : {}) }),
			sendSessionMessage: async () => ({ eventId: "ev_1" }),
		}),
		resolveContext: (scope, toolCallId) => ({ roomId: scope.roomId, tokenId: scope.tokenId, label: scope.label, mode: "sandbox", sandboxRoot: "/tmp/remote-test-sandbox", cwd: "/tmp/remote-test-sandbox", toolCallId }),
	});
	const address = await server.start();
	closers.push(async () => { await server.stop(); store.close(); });
	return { store, auth, address };
}

async function connect(url, token) {
	const transport = new StreamableHTTPClientTransport(url, {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
	});
	const client = new Client({ name: "remote-agent-test", version: "1" });
	closers.push(async () => { await transport.close().catch(() => {}); await client.close().catch(() => {}); });
	await client.connect(transport);
	return client;
}

test("MCP server rejects missing and invalid credentials", async () => {
	const { address } = await startServer({ modules: ["sessions"] });
	const anonymous = await fetch(address.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
	assert.equal(anonymous.status, 401);
	const bogus = await fetch(address.url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer pibo_remote_nope" }, body: "{}" });
	assert.equal(bogus.status, 401);
});

test("MCP client lists and calls only its room modules", async () => {
	const { auth, address } = await startServer({ modules: ["sessions"] });
	const { token } = auth.redeemDeviceCode(auth.createDeviceCode("room-a").code, ["sessions"]);
	const client = await connect(address.url, token);
	const listed = await client.listTools();
	const names = listed.tools.map((tool) => tool.name).sort();
	assert.deepEqual(names, ["remote_ping", "remote_session_agents", "remote_session_create", "remote_session_list", "remote_session_send"]);
	const ping = await client.callTool({ name: "remote_ping", arguments: {} });
	assert.match(ping.content[0].text, /pong/);
	const sessions = await client.callTool({ name: "remote_session_list", arguments: {} });
	assert.match(sessions.content[0].text, /ps_a1/);
	// Unknown / non-enabled tools fail as tool errors, not protocol errors.
	const missing = await client.callTool({ name: "remote_bash_run", arguments: { command: "id" } });
	assert.equal(missing.isError, true);
	assert.match(missing.content[0].text, /not enabled/);
});

test("MCP sessions stay bound to their own token", async () => {
	const { auth, address } = await startServer({ modules: ["sessions"] });
	const first = auth.redeemDeviceCode(auth.createDeviceCode("room-a").code, ["sessions"]);
	const second = auth.redeemDeviceCode(auth.createDeviceCode("room-a").code, ["sessions"]);
	const client = await connect(address.url, first.token);
	await client.listTools();
	// Revoking the token closes its sessions: the next call must fail auth.
	assert.equal(auth.revokeToken(first.info.id), true);
	await assert.rejects(client.callTool({ name: "remote_ping", arguments: {} }));
	const other = await connect(address.url, second.token);
	const ping = await other.callTool({ name: "remote_ping", arguments: {} });
	assert.match(ping.content[0].text, /pong/);
});

test("disabled rooms are rejected even with a valid token", async () => {
	const { store, auth, address } = await startServer({ modules: ["sessions"] });
	const { token } = auth.redeemDeviceCode(auth.createDeviceCode("room-a").code, ["sessions"]);
	store.upsertRoomConfig("room-a", { enabled: false }, { sandboxPath: "/tmp/remote-test-sandbox" });
	await assert.rejects(connect(address.url, token));
});
