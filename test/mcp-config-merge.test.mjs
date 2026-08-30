import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

const { getConfigSearchPaths, getServerConfig, loadConfig, resolveMcpServerConfigSource } = await import("../dist/mcp/config.js");

test("MCP config source resolution follows merged precedence", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-source-"));
	const project = join(root, "project");
	const home = join(root, "home");
	await mkdir(project, { recursive: true });
	await mkdir(home, { recursive: true });
	const projectPath = join(project, "mcp_servers.json");
	const homePath = join(home, "mcp_servers.json");
	await writeFile(projectPath, JSON.stringify({ mcpServers: {
		local: { command: "node", args: ["local.js"] },
		shared: { command: "node", args: ["project.js"] },
	} }));
	await writeFile(homePath, JSON.stringify({ mcpServers: {
		inherited: { command: "node", args: ["home.js"] },
		shared: { command: "node", args: ["home.js"] },
	} }));

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		process.chdir(project);
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		delete process.env.MCP_CONFIG_PATH;

		assert.equal((await resolveMcpServerConfigSource("local")).path, projectPath);
		assert.equal((await resolveMcpServerConfigSource("shared")).path, projectPath);
		assert.equal((await resolveMcpServerConfigSource("inherited")).path, homePath);
		assert.equal((await resolveMcpServerConfigSource("inherited", projectPath)).path, homePath);
		await assert.rejects(resolveMcpServerConfigSource("missing"), /SERVER_NOT_FOUND/);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		await rm(root, { recursive: true, force: true });
	}
});

test("MCP config loading merges local and global files with specific entries winning", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-merge-"));
	const project = join(root, "project");
	const home = join(root, "home");
	const configDir = join(home, ".config", "mcp");
	await mkdir(project, { recursive: true });
	await mkdir(configDir, { recursive: true });

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
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
			join(home, "mcp_servers.json"),
			JSON.stringify({
				mcpServers: {
					homeLocal: { command: "node", args: ["home-local.js"] },
					homePriority: { command: "node", args: ["home-priority.js"] },
					shared: { command: "node", args: ["home-local-shared.js"] },
				},
			}),
		);
		await writeFile(
			join(home, ".mcp_servers.json"),
			JSON.stringify({
				mcpServers: {
					unity: { command: "uvx", args: ["mcp-unity"] },
					homePriority: { command: "node", args: ["dot-home-priority.js"] },
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
		process.env.USERPROFILE = home;
		delete process.env.MCP_CONFIG_PATH;

		const config = await loadConfig();
		assert.deepEqual(Object.keys(config.mcpServers).sort(), ["deep", "homeLocal", "homePriority", "local", "shared", "unity"]);
		assert.deepEqual(config.mcpServers.homeLocal, { command: "node", args: ["home-local.js"] });
		assert.deepEqual(config.mcpServers.homePriority, { command: "node", args: ["home-priority.js"] });
		assert.deepEqual(config.mcpServers.unity, { command: "uvx", args: ["mcp-unity"] });
		assert.deepEqual(config.mcpServers.shared, { command: "node", args: ["local-shared.js"] });
		assert.deepEqual(config.mcpServers.deep, { url: "https://example.com/mcp" });
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		await rm(root, { recursive: true, force: true });
	}
});

test("MCP config treats prototype-shaped names as own server definitions", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-prototype-names-"));
	const project = join(root, "project");
	const home = join(root, "home");
	await mkdir(project, { recursive: true });
	await mkdir(home, { recursive: true });
	const projectPath = join(project, "mcp_servers.json");
	await writeFile(projectPath, JSON.stringify({
		mcpServers: {
			toString: { command: "node", args: ["to-string.js"] },
			constructor: { command: "node", args: ["constructor.js"] },
		},
	}));

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		process.chdir(project);
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		delete process.env.MCP_CONFIG_PATH;

		const config = await loadConfig();
		assert.deepEqual(Object.keys(config.mcpServers).sort(), ["constructor", "toString"]);
		assert.deepEqual(getServerConfig(config, "toString"), { command: "node", args: ["to-string.js"] });
		assert.deepEqual(getServerConfig(config, "constructor"), { command: "node", args: ["constructor.js"] });
		assert.equal((await resolveMcpServerConfigSource("toString")).path, projectPath);
		assert.equal((await resolveMcpServerConfigSource("constructor")).path, projectPath);
		assert.throws(() => getServerConfig({ mcpServers: {} }, "toString"), /SERVER_NOT_FOUND/);
		await assert.rejects(resolveMcpServerConfigSource("valueOf"), /SERVER_NOT_FOUND/);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		await rm(root, { recursive: true, force: true });
	}
});

test("MCP config search paths never synthesize relative home paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-empty-home-"));
	const project = join(root, "project");
	await mkdir(project, { recursive: true });

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		process.chdir(project);
		process.env.HOME = "";
		process.env.USERPROFILE = "";
		delete process.env.MCP_CONFIG_PATH;

		const paths = getConfigSearchPaths();
		assert.equal(paths[0], join(project, "mcp_servers.json"));
		assert.ok(paths.every((path) => isAbsolute(path)), JSON.stringify(paths));
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		await rm(root, { recursive: true, force: true });
	}
});
