import assert from "node:assert/strict";
import test, { after } from "node:test";

// The MCP server binds loopback; never route the test client through a proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleChatRemoteAgentApiRequest } from "../dist/apps/chat/remote-agent-api.js";
import { PiboRemoteAgentAuth } from "../dist/remote-agent/auth.js";
import { PiboRemoteAgentMcpServer } from "../dist/remote-agent/mcp-server.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { buildSessionModuleTools } from "../dist/remote-agent/modules/sessions.js";

const closers = [];
after(async () => {
	for (const close of closers.splice(0)) await close();
});

function baseRecord(overrides = {}) {
	return {
		toolCallId: "tc_1",
		roomId: "room-a",
		tokenId: "rt_1",
		label: "Chat",
		transport: "mcp",
		toolName: "remote_ping",
		argsJson: "{}",
		ok: true,
		startedAt: "2026-09-19T12:00:00.000Z",
		finishedAt: "2026-09-19T12:00:00.010Z",
		durationMs: 10,
		...overrides,
	};
}

test("history store lists newest first with limit", () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	closers.push(async () => store.close());
	store.insertToolCall(baseRecord({ toolName: "remote_ping" }));
	store.insertToolCall(baseRecord({ toolName: "remote_session_list", ok: false, error: "nope" }));
	store.insertToolCall(baseRecord({ roomId: "room-b", toolName: "remote_ping" }));
	const listed = store.listToolCalls("room-a", 10);
	assert.equal(listed.length, 2);
	assert.equal(listed[0].toolName, "remote_session_list");
	assert.equal(listed[0].ok, false);
	assert.equal(listed[0].error, "nope");
	assert.equal(listed[1].toolName, "remote_ping");
	assert.equal(store.listToolCalls("room-a", 1).length, 1);
	assert.equal(store.listToolCalls("room-b", 10)[0].roomId, "room-b");
});

test("history store retains only the newest records per room", () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	closers.push(async () => store.close());
	for (let index = 0; index < 5; index += 1) {
		store.insertToolCall(baseRecord({ toolCallId: `tc_${index}`, toolName: `tool_${index}` }), 3);
	}
	const listed = store.listToolCalls("room-a", 10);
	assert.deepEqual(listed.map((record) => record.toolName), ["tool_4", "tool_3", "tool_2"]);
});

test("MCP and REST tool calls are recorded with outcome", async () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	store.upsertRoomConfig("room-a", { enabled: true }, { sandboxPath: "/tmp/remote-history-sandbox" });
	const auth = new PiboRemoteAgentAuth({ store });
	const server = new PiboRemoteAgentMcpServer({
		authenticate: (token) => auth.authenticate(token),
		isRoomActive: (id) => store.getRoomConfig(id)?.enabled === true,
		resolveTools: () => buildSessionModuleTools({
			listRoomSessions: () => [],
			getRoomSession: () => undefined,
			createRoomSession: () => { throw new Error("not used"); },
			sendSessionMessage: async () => ({ eventId: "ev_1" }),
		}),
		resolveContext: (scope, toolCallId) => ({ roomId: scope.roomId, tokenId: scope.tokenId, label: scope.label, mode: "sandbox", sandboxRoot: "/tmp/remote-history-sandbox", cwd: "/tmp/remote-history-sandbox", toolCallId }),
		recordToolCall: (record) => store.insertToolCall(record),
	});
	const address = await server.start();
	closers.push(async () => { await server.stop(); store.close(); });
	const { token, info } = auth.redeemDeviceCode(auth.createDeviceCode("room-a", "GPT").code, ["sessions"]);

	const transport = new StreamableHTTPClientTransport(address.url, {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
	});
	const client = new Client({ name: "history-test", version: "1" });
	closers.push(async () => { await transport.close().catch(() => {}); await client.close().catch(() => {}); });
	await client.connect(transport);
	await client.callTool({ name: "remote_ping", arguments: {} });
	await client.callTool({ name: "remote_bash_run", arguments: { command: "id" } });

	const restBase = address.url.replace(/\/mcp$/, "");
	const restOk = await fetch(`${restBase}/api/remote/ping`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: "{}",
	});
	assert.equal(restOk.status, 200);
	assert.equal((await restOk.json()).ok, true);

	const listed = store.listToolCalls("room-a", 10);
	assert.equal(listed.length, 3);
	assert.ok(listed.every((record) => record.tokenId === info.id && record.label === "GPT"));
	const byName = Object.fromEntries(listed.map((record) => [`${record.transport}:${record.toolName}`, record]));
	assert.equal(byName["mcp:remote_ping"].ok, true);
	assert.match(byName["mcp:remote_ping"].resultText ?? "", /pong/i);
	assert.equal(byName["mcp:remote_bash_run"].ok, false);
	assert.match(byName["mcp:remote_bash_run"].error ?? "", /not enabled|unknown/i);
	assert.equal(byName["rest:remote_ping"].ok, true);
	assert.ok(byName["rest:remote_ping"].durationMs >= 0);
});

test("history API lists room tool calls and 404s unknown rooms", async () => {
	const records = [baseRecord({ id: 1 })];
	const service = {
		listToolCalls: (roomId, limit) => {
			assert.equal(roomId, "room-a");
			assert.equal(limit, 5);
			return records;
		},
	};
	const roomService = {
		requireRoom: (roomId) => {
			if (roomId !== "room-a") throw new Error("no such room");
			return { id: "room-a", metadata: {} };
		},
	};
	const response = await handleChatRemoteAgentApiRequest({
		request: new Request("http://127.0.0.1:5798/api/chat/remote-agent/rooms/room-a/tool-calls?limit=5"),
		service,
		roomService,
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { toolCalls: records });

	const missing = await handleChatRemoteAgentApiRequest({
		request: new Request("http://127.0.0.1:5798/api/chat/remote-agent/rooms/room-x/tool-calls"),
		service,
		roomService,
	}).catch((error) => error);
	assert.match(String(missing?.message ?? missing), /Room not found/);
});
