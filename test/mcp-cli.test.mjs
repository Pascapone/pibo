import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo without args prints compact discovery", async () => {
	const { stdout } = await execFileAsync("node", [cliPath]);

	assert.match(stdout, /pibo - agent-oriented CLI/);
	assert.match(stdout, /pibo <command> --help/);
	assert.doesNotMatch(stdout, /"profileName"/);
});

test("pibo root help prints compact discovery", async () => {
	const { stdout } = await execFileAsync("node", [cliPath, "--help"]);

	assert.match(stdout, /pibo - agent-oriented CLI/);
	assert.match(stdout, /pibo <command> --help/);
	assert.doesNotMatch(stdout, /Usage:/);
});

test("pibo config and tools help print compact discovery", async () => {
	const config = await execFileAsync("node", [cliPath, "config", "--help"]);
	assert.match(config.stdout, /pibo config - local config/);
	assert.match(config.stdout, /pibo config keys/);
	assert.doesNotMatch(config.stdout, /Usage:/);

	const tools = await execFileAsync("node", [cliPath, "tools", "--help"]);
	assert.match(tools.stdout, /pibo tools - curated CLI tools/);
	assert.match(tools.stdout, /pibo tools list/);
	assert.match(tools.stdout, /ralph/);
	assert.doesNotMatch(tools.stdout, /Usage:/);
});

test("pibo exposes the MCP CLI as a subcommand", async () => {
	const { stdout } = await execFileAsync("node", [cliPath, "mcp", "--version"]);

	assert.match(stdout, /pibo mcp \(mcp-cli v\d+\.\d+\.\d+\)/);
});

test("pibo mcp help stays progressive", async () => {
	const help = await execFileAsync("node", [cliPath, "mcp", "--help"]);
	assert.match(help.stdout, /pibo mcp config help/);
	assert.doesNotMatch(help.stdout, /Server schema:/);
	assert.doesNotMatch(help.stdout, /Full example:/);

	const configHelp = await execFileAsync("node", [cliPath, "mcp", "config", "help"]);
	assert.match(configHelp.stdout, /pibo mcp config schema/);
	assert.doesNotMatch(configHelp.stdout, /Full example:/);

	const schema = await execFileAsync("node", [cliPath, "mcp", "config", "schema"]);
	assert.match(schema.stdout, /Server schema:/);
	assert.match(schema.stdout, /Full example:/);
});

test("pibo mcp parser reports focused errors for invalid command shapes", async () => {
	const cases = [
		{
			args: ["mcp", "--unknown"],
			expected: /Error \[UNKNOWN_OPTION\]: Unknown option: --unknown/,
		},
		{
			args: ["mcp", "call", "demo"],
			expected: /Error \[MISSING_ARGUMENT\]: Missing required argument for call: tool/,
		},
		{
			args: ["mcp", "demo/tool"],
			expected: /Error \[AMBIGUOUS_COMMAND\]: Ambiguous command/,
		},
		{
			args: ["mcp", "grep"],
			expected: /Error \[MISSING_ARGUMENT\]: Missing required argument for grep: pattern/,
		},
	];

	for (const { args, expected } of cases) {
		await assert.rejects(
			execFileAsync("node", [cliPath, ...args]),
			(error) => {
				assert.equal(error.code, 1);
				assert.equal(error.stdout, "");
				assert.match(error.stderr, expected);
				return true;
			},
		);
	}
});

test("pibo mcp config add accepts config option after positional arguments", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-config-trailing-option-"));
	try {
		const configPath = join(cwd, "custom-mcp.json");

		await execFileAsync("node", [
			cliPath,
			"mcp",
			"config",
			"add",
			"demo",
			'{"command":"node"}',
			"-c",
			configPath,
		]);

		const savedConfig = JSON.parse(await readFile(configPath, "utf-8"));
		assert.deepEqual(savedConfig.mcpServers.demo, { command: "node" });
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo mcp config path follows explicit env cwd priority", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-config-paths-"));
	try {
		const explicitPath = join(cwd, "explicit.json");
		const envPath = join(cwd, "env.json");
		const cwdPath = join(cwd, "mcp_servers.json");
		await writeFile(
			explicitPath,
			JSON.stringify({ mcpServers: { explicit: { command: "node" } } }),
		);
		await writeFile(
			envPath,
			JSON.stringify({ mcpServers: { env: { command: "node" } } }),
		);
		await writeFile(
			cwdPath,
			JSON.stringify({ mcpServers: { cwd: { command: "node" } } }),
		);

		const env = { ...process.env, MCP_CONFIG_PATH: envPath };

		const explicit = await execFileAsync(
			"node",
			[cliPath, "mcp", "config", "path", "-c", explicitPath],
			{ cwd, env },
		);
		assert.equal(explicit.stdout.trim(), explicitPath);

		const fromEnv = await execFileAsync(
			"node",
			[cliPath, "mcp", "config", "path"],
			{ cwd, env },
		);
		assert.equal(fromEnv.stdout.trim(), envPath);

		const withoutEnv = { ...process.env };
		delete withoutEnv.MCP_CONFIG_PATH;
		const fromCwd = await execFileAsync(
			"node",
			[cliPath, "mcp", "config", "path"],
			{ cwd, env: withoutEnv },
		);
		assert.equal(fromCwd.stdout.trim(), cwdPath);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo mcp config can create, add, show, and remove servers", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-config-"));
	try {
		const configPath = join(cwd, "mcp_servers.json");

		const init = await execFileAsync("node", [cliPath, "mcp", "config", "init"], { cwd });
		assert.match(init.stdout, /Created MCP config:/);

		const initialConfig = JSON.parse(await readFile(configPath, "utf-8"));
		assert.deepEqual(initialConfig, { mcpServers: {} });

		await execFileAsync(
			"node",
			[
				cliPath,
				"mcp",
				"config",
				"add",
				"demo",
				'{"command":"node","args":["server.js"]}',
			],
			{ cwd },
		);

		const show = await execFileAsync("node", [cliPath, "mcp", "config", "show"], { cwd });
		const shownConfig = JSON.parse(show.stdout);
		assert.deepEqual(shownConfig.mcpServers.demo, {
			command: "node",
			args: ["server.js"],
		});

		await execFileAsync("node", [cliPath, "mcp", "config", "describe", "demo", "Run demo MCP tools."], { cwd });
		const describedConfig = JSON.parse(await readFile(configPath, "utf-8"));
		assert.deepEqual(describedConfig.mcpServers.demo, {
			command: "node",
			args: ["server.js"],
			pibo: {
				description: "Run demo MCP tools.",
				descriptionSource: "user",
			},
		});

		await execFileAsync("node", [cliPath, "mcp", "config", "remove", "demo"], { cwd });
		const finalConfig = JSON.parse(await readFile(configPath, "utf-8"));
		assert.deepEqual(finalConfig, { mcpServers: {} });
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo mcp registry lists bundled presets", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-registry-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };

		const list = await execFileAsync("node", [cliPath, "mcp", "registry", "list"], { cwd, env });
		assert.match(list.stdout, /No registry entries are currently bundled/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo mcp registry reports unknown presets", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-registry-missing-"));
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "mcp", "registry", "show", "missing"], { cwd }),
			(error) => {
				assert.match(error.stderr, /Registry entry "missing" not found/);
				assert.match(error.stderr, /No registry entries are currently bundled/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
