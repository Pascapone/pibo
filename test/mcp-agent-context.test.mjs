import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import {
	ENABLED_MCP_SERVERS_CONTEXT_PATH,
	getMcpAgentContextFile,
	listMcpServerInfos,
	setMcpServerDescription,
} from "../dist/mcp/agent-context.js";

test("MCP descriptions update the winning config source", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-description-source-"));
	const project = join(root, "project");
	const home = join(root, "home");
	const projectConfigPath = join(project, "mcp_servers.json");
	const homeConfigPath = join(home, "mcp_servers.json");
	await mkdir(project, { recursive: true });
	await mkdir(home, { recursive: true });
	await writeFile(projectConfigPath, `${JSON.stringify({
		mcpServers: {
			local: { command: "node", args: ["local.js"] },
			shared: { command: "node", args: ["project-shared.js"] },
		},
	}, null, 2)}\n`);
	await writeFile(homeConfigPath, `${JSON.stringify({
		mcpServers: {
			inherited: { command: "node", args: ["home.js"], env: { FIXTURE: "preserved" } },
			shared: { command: "node", args: ["home-shared.js"] },
			explicit: { command: "node", args: ["explicit.js"] },
		},
	}, null, 2)}\n`);

	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		process.chdir(project);
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		delete process.env.MCP_CONFIG_PATH;

		await setMcpServerDescription("inherited", "Home server description.");
		await setMcpServerDescription("shared", "Winning project description.");
		await setMcpServerDescription("explicit", "Explicit home description.", homeConfigPath);

		const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf-8"));
		const homeConfig = JSON.parse(await readFile(homeConfigPath, "utf-8"));
		assert.deepEqual(projectConfig.mcpServers.local, { command: "node", args: ["local.js"] });
		assert.equal(projectConfig.mcpServers.shared.pibo.description, "Winning project description.");
		assert.equal(homeConfig.mcpServers.shared.pibo, undefined);
		assert.deepEqual(homeConfig.mcpServers.inherited, {
			command: "node",
			args: ["home.js"],
			env: { FIXTURE: "preserved" },
			pibo: { description: "Home server description.", descriptionSource: "user" },
		});
		assert.equal(homeConfig.mcpServers.explicit.pibo.description, "Explicit home description.");
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

test("MCP description updates do not create a config for an unknown server", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-description-missing-"));
	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	try {
		process.chdir(root);
		process.env.HOME = root;
		process.env.USERPROFILE = root;
		delete process.env.MCP_CONFIG_PATH;

		await assert.rejects(setMcpServerDescription("missing", "Must not create config."), /CONFIG_NOT_FOUND/);
		await assert.rejects(readFile(join(root, "mcp_servers.json"), "utf-8"), { code: "ENOENT" });
		const explicitPath = join(root, "missing", "mcp_servers.json");
		await assert.rejects(
			setMcpServerDescription("missing", "Must not create explicit config.", explicitPath),
			/CONFIG_NOT_FOUND/,
		);
		await assert.rejects(readFile(explicitPath, "utf-8"), { code: "ENOENT" });
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

test("MCP description updates preserve registry-owned read-only metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-mcp-description-readonly-"));
	const configPath = join(root, "mcp_servers.json");
	const config = {
		mcpServers: {
			registry: {
				command: "node",
				args: ["registry.js"],
				pibo: { description: "Registry description.", descriptionSource: "registry" },
			},
		},
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
	try {
		await assert.rejects(
			setMcpServerDescription("registry", "User replacement.", configPath),
			/MCP_DESCRIPTION_READ_ONLY/,
		);
		assert.deepEqual(JSON.parse(await readFile(configPath, "utf-8")), config);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("MCP server catalog reads local config metadata without connecting to servers", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-context-"));
	const configPath = join(cwd, "mcp_servers.json");
	await writeConfig(configPath);
	const previousHome = process.env.HOME;
	process.env.HOME = cwd;

	try {
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
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
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
				env: { MCP_FIXTURE_TOKEN: "${MCP_FIXTURE_TOKEN}" },
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
