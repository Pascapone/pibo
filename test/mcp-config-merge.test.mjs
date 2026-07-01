import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { loadConfig } = await import("../dist/mcp/config.js");

test("MCP config loading merges local and global files with specific entries winning", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-merge-"));
	const project = join(root, "project");
	const home = join(root, "home");
	const configDir = join(home, ".config", "mcp");
	await mkdir(project, { recursive: true });
	await mkdir(configDir, { recursive: true });

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		await writeFile(
			join(project, "mcp_servers.json"),
			JSON.stringify({
				mcpServers: {
					local: { command: "node", args: ["local.js"] },
					shared: { command: "node", args: ["local-shared.js"] },
				},
			}),
		);
		await writeFile(
			join(home, ".mcp_servers.json"),
			JSON.stringify({
				mcpServers: {
					unity: { command: "uvx", args: ["mcp-unity"] },
					shared: { command: "node", args: ["home-shared.js"] },
				},
			}),
		);
		await writeFile(
			join(configDir, "mcp_servers.json"),
			JSON.stringify({
				mcpServers: {
					deep: { url: "https://example.com/mcp" },
					shared: { command: "node", args: ["least-specific.js"] },
				},
			}),
		);

		process.chdir(project);
		process.env.HOME = home;
		delete process.env.MCP_CONFIG_PATH;

		const config = await loadConfig();
		assert.deepEqual(Object.keys(config.mcpServers).sort(), ["deep", "local", "shared", "unity"]);
		assert.deepEqual(config.mcpServers.unity, { command: "uvx", args: ["mcp-unity"] });
		assert.deepEqual(config.mcpServers.shared, { command: "node", args: ["local-shared.js"] });
		assert.deepEqual(config.mcpServers.deep, { url: "https://example.com/mcp" });
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		await rm(root, { recursive: true, force: true });
	}
});
