import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { definePiboTool } from "../dist/tools/contract.js";
import { PiboPortableToolService } from "../dist/tools/session-service.js";

function toolByName(tools, name) {
	const tool = tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `missing tool ${name}`);
	return tool;
}


test("portable tool sessions share one frozen tool selection across direct and MCP delivery", async (t) => {
	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			return {
				content: [{ type: "text", text: `${context.piboSessionId}:${input.value}` }],
			};
		},
	});
	const nativeBash = definePiboTool({
		name: "bash",
		title: "Bash",
		description: "Adapter-private native fixture",
		inputSchema: Type.Object({ command: Type.String() }),
		portable: false,
		async execute() {
			return { content: [{ type: "text", text: "native" }] };
		},
	});
	const profile = new InitialSessionContextBuilder("portable-profile")
		.withAgentRuntime("codex-native")
		.addTool({ name: "alpha", definition: alpha })
		.withToolPackages({ runControl: true, goalControl: false })
		.createSession();
	const service = new PiboPortableToolService();
	t.after(async () => service.dispose());
	const session = service.createSession({
		piboSessionId: "ps_portable",
		piboRoomId: "room_portable",
		runtimeInstanceId: "codex-native",
		adapterId: "codex",
		profile,
		cwd: "/tmp/portable",
	});

	const nativeYieldableTools = [nativeBash];
	const portable = session.createDefinitions({ nativeYieldableTools });
	assert.deepEqual(portable.map((tool) => tool.name).sort(), ["alpha", "bash"]);

	const directWithNative = session.createDefinitions({ nativeYieldableTools });
	assert.ok(directWithNative.some((tool) => tool.name === "bash"));

	await assert.rejects(
		() => session.issueMcpAccess({ allowedToolNames: ["bash"] }),
		/Portable MCP tools are unavailable/,
	);
	const access = await session.issueMcpAccess({ allowedToolNames: ["alpha"] });
	assert.deepEqual(access.allowedToolNames, ["alpha"]);
	const transport = new StreamableHTTPClientTransport(new URL(access.url), {
		requestInit: { headers: { Authorization: `Bearer ${access.token}` } },
	});
	t.after(async () => transport.close());
	const client = new Client({ name: "portable-session-test", version: "1" });
	await client.connect(transport);
	const listed = await client.listTools();
	assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["alpha"]);
	const result = await client.callTool({ name: "alpha", arguments: { value: "hello" } });
	assert.equal(result.content[0].text, "ps_portable:hello");

	const renewed = session.renewMcpAccess(access.token, 60_000);
	assert.equal(renewed.credentialId, access.credentialId);
	session.dispose();
	assert.throws(() => session.createDefinitions(), /disposed/);
	const rejected = await fetch(access.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${access.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
	});
	assert.equal(rejected.status, 401);
});
