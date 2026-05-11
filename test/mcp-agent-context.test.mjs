import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import {
	ENABLED_MCP_SERVERS_CONTEXT_PATH,
	getMcpAgentContextFile,
	listMcpServerInfos,
} from "../dist/mcp/agent-context.js";

test("MCP server catalog reads local config metadata without connecting to servers", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-context-"));
	const configPath = join(cwd, "mcp_servers.json");
	await writeConfig(configPath);

	const servers = await listMcpServerInfos(configPath);
	assert.deepEqual(servers, [
		{
			name: "filesystem",
			transport: "stdio",
			description: "Access project files through MCP.",
			descriptionSource: "user",
			hasDescription: true,
			editable: true,
		},
		{
			name: "registry-demo",
			transport: "http",
			description: "Search registry-backed records.",
			descriptionSource: "registry",
			hasDescription: true,
			editable: false,
		},
		{
			name: "missing-description",
			transport: "stdio",
			hasDescription: false,
			editable: true,
		},
	]);
});

test("MCP agent context is generated only for selected described servers", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-context-"));
	const configPath = join(cwd, "mcp_servers.json");
	await writeConfig(configPath);

	const contextFile = await getMcpAgentContextFile(["missing-description", "filesystem"], configPath);
	assert.equal(contextFile.path, ENABLED_MCP_SERVERS_CONTEXT_PATH);
	assert.match(contextFile.content, /## filesystem/);
	assert.match(contextFile.content, /npm run dev -- mcp info filesystem/);
	assert.doesNotMatch(contextFile.content, /missing-description/);

	const mixedContextFile = await getMcpAgentContextFile(["unknown", "filesystem"], configPath);
	assert.match(mixedContextFile.content, /## filesystem/);
	assert.doesNotMatch(mixedContextFile.content, /unknown/);

	assert.equal(await getMcpAgentContextFile([], configPath), undefined);
	assert.equal(await getMcpAgentContextFile(["missing-description"], configPath), undefined);
	assert.equal(await getMcpAgentContextFile(["unknown"], configPath), undefined);
});

test("runtime profile inspection includes selected MCP context", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-runtime-"));
	const configPath = join(cwd, "mcp_servers.json");
	await writeConfig(configPath);

	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	process.env.MCP_CONFIG_PATH = configPath;
	try {
		const withMcp = new InitialSessionContextBuilder("mcp-agent")
			.withAutoContextFiles(false)
			.withMcpServers(["filesystem"])
			.createSession();
		const inspection = await inspectPiboProfile({ cwd, profile: withMcp, persistSession: false });
		assert.ok(inspection.contextFiles.some((file) => file.path === ENABLED_MCP_SERVERS_CONTEXT_PATH));

		const withoutMcp = new InitialSessionContextBuilder("mcp-agent")
			.withAutoContextFiles(false)
			.createSession();
		const emptyInspection = await inspectPiboProfile({ cwd, profile: withoutMcp, persistSession: false });
		assert.equal(emptyInspection.contextFiles.some((file) => file.path === ENABLED_MCP_SERVERS_CONTEXT_PATH), false);
	} finally {
		if (previousConfigPath === undefined) {
			delete process.env.MCP_CONFIG_PATH;
		} else {
			process.env.MCP_CONFIG_PATH = previousConfigPath;
		}
	}
});

async function writeConfig(configPath) {
	await writeFile(configPath, `${JSON.stringify({
		mcpServers: {
			filesystem: {
				command: "node",
				args: ["server.js"],
				pibo: {
					description: "Access project files through MCP.",
					descriptionSource: "user",
				},
			},
			"registry-demo": {
				url: "https://example.com/mcp",
				pibo: {
					description: "Search registry-backed records.",
					descriptionSource: "registry",
				},
			},
			"missing-description": {
				command: "node",
				args: ["missing.js"],
			},
		},
	}, null, 2)}\n`);
}
