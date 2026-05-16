import { Command } from "commander";
import {
	PIBO_CONFIG_KEYS,
	getDefaultPiboConfigPath,
	deletePiboConfigValue,
	getDisplayPiboConfigValue,
	loadPiboConfig,
	redactPiboConfig,
	savePiboConfig,
	setPiboConfigValue,
} from "./config/config.js";
import type { PiboRuntimeOptions } from "./core/runtime.js";
import { parsePiboThinkingLevel } from "./core/thinking.js";

async function createCliProfile(profileName?: string) {
	const { createDefaultPiboPluginRegistry, createGatewayProducerPiboProfile } = await import("./plugins/builtin.js");
	if (profileName === "gateway-producer" || profileName === "pibo-gateway-producer") {
		return createGatewayProducerPiboProfile();
	}
	return createDefaultPiboPluginRegistry().createProfile(profileName ?? "codex-compat-openai-web");
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function printConfigKeys(): void {
	for (const definition of PIBO_CONFIG_KEYS) {
		const visibility = definition.secret === true ? "secret" : "public";
		console.log(`${definition.key}\t${definition.type}\t${visibility}\t${definition.description}`);
	}
}

function printRootDiscovery(): void {
	console.log(printRootDiscoveryText());
}

function printConfigDiscovery(): void {
	console.log(printConfigDiscoveryText());
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("Port must be an integer between 1 and 65535");
	}
	return port;
}

function parsePositiveInteger(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error("Value must be a positive integer");
	}
	return parsed;
}

export async function runPiboCli(argv = process.argv): Promise<void> {
	if (argv[2] === "--help" || argv[2] === "-h") {
		printRootDiscovery();
		return;
	}

	if (argv[2] === "mcp") {
		const { runMcpCli } = await import("./mcp/index.js");
		await runMcpCli([argv[0] ?? "node", "pibo mcp", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "tools") {
		const { runToolsCli } = await import("./tools/index.js");
		await runToolsCli([argv[0] ?? "node", "pibo tools", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "pi-packages") {
		const { runPiPackagesCli } = await import("./pi-packages/cli.js");
		await runPiPackagesCli([argv[0] ?? "node", "pibo pi-packages", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "debug") {
		const { runDebugCli } = await import("./debug/index.js");
		await runDebugCli([argv[0] ?? "node", "pibo debug", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "data") {
		const { runDataCli } = await import("./data/cli.js");
		await runDataCli([argv[0] ?? "node", "pibo data", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "gateway") {
		const { runGatewayCli } = await import("./gateway/cli.js");
		await runGatewayCli(argv);
		return;
	}

	if (argv[2] === "compute") {
		const { runComputeCli } = await import("./compute/cli.js");
		await runComputeCli([argv[0] ?? "node", "pibo compute", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "skills") {
		const { runSkillsCli } = await import("./skills/cli.js");
		await runSkillsCli([argv[0] ?? "node", "pibo skills", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "cron") {
		const { runCronCli } = await import("./cron/cli.js");
		await runCronCli([argv[0] ?? "node", "pibo cron", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "ralph") {
		const { runRalphCli } = await import("./ralph/cli.js");
		await runRalphCli([argv[0] ?? "node", "pibo ralph", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "config" && (argv[3] === "--help" || argv[3] === "-h" || argv.length === 3)) {
		printConfigDiscovery();
		return;
	}

	if (argv[2] === "tui:sessions" && (argv[3] === "--help" || argv[3] === "-h")) {
		const { cliSessionsHelpText } = await import("./apps/cli-ui/index.js");
		console.log(cliSessionsHelpText());
		return;
	}

	const program = new Command();
	program.name("pibo").description("Agent-oriented CLI for Pibo").helpOption(false).showHelpAfterError();

	program
		.command("mcp")
		.description("Interact with configured MCP servers")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runMcpCli } = await import("./mcp/index.js");
			await runMcpCli([argv[0] ?? "node", "pibo mcp", ...args]);
		});

	program
		.command("tools")
		.description("Install and inspect curated external CLI tools")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runToolsCli } = await import("./tools/index.js");
			await runToolsCli([argv[0] ?? "node", "pibo tools", ...args]);
		});

	program
		.command("pi-packages")
		.description("Register Pi Coding Agent packages")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runPiPackagesCli } = await import("./pi-packages/cli.js");
			await runPiPackagesCli([argv[0] ?? "node", "pibo pi-packages", ...args]);
		});

	program
		.command("debug")
		.description("Inspect local Pibo data")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runDebugCli } = await import("./debug/index.js");
			await runDebugCli([argv[0] ?? "node", "pibo debug", ...args]);
		});

	program
		.command("data")
		.description("Inspect and maintain Pibo data stores")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runDataCli } = await import("./data/cli.js");
			await runDataCli([argv[0] ?? "node", "pibo data", ...args]);
		});

	program
		.command("compute")
		.description("Manage Pibo Docker compute workers")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runComputeCli } = await import("./compute/cli.js");
			await runComputeCli([argv[0] ?? "node", "pibo compute", ...args]);
		});

	program
		.command("skills")
		.description("Manage Pibo user skills")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runSkillsCli } = await import("./skills/cli.js");
			await runSkillsCli([argv[0] ?? "node", "pibo skills", ...args]);
		});

	program
		.command("cron")
		.description("Manage scheduled Pibo jobs")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runCronCli } = await import("./cron/cli.js");
			await runCronCli([argv[0] ?? "node", "pibo cron", ...args]);
		});

	program
		.command("ralph")
		.description("Manage continuous Ralph jobs")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runRalphCli } = await import("./ralph/cli.js");
			await runRalphCli([argv[0] ?? "node", "pibo ralph", ...args]);
		});

	const config = program.command("config").description(`Manage pibo config at ${getDefaultPiboConfigPath()}`).helpOption(false);
	config.action(() => {
		printConfigDiscovery();
	});
	config
		.command("set")
		.argument("<key>")
		.argument("<value>")
		.description("Set a config value")
		.action((key: string, value: string) => {
			const nextConfig = setPiboConfigValue(loadPiboConfig(), key, value);
			savePiboConfig(nextConfig);
			console.log(`Set ${key}`);
		});
	config
		.command("get")
		.argument("<key>")
		.description("Print a config value")
		.action((key: string) => {
			const value = getDisplayPiboConfigValue(loadPiboConfig(), key);
			if (value === undefined) {
				process.exitCode = 1;
				return;
			}
			if (typeof value === "string") console.log(value);
			else printJson(value);
		});
	config
		.command("del")
		.argument("<key>")
		.description("Delete a config value")
		.action((key: string) => {
			savePiboConfig(deletePiboConfigValue(loadPiboConfig(), key));
			console.log(`Deleted ${key}`);
		});
	config.command("keys").description("List supported config keys").action(printConfigKeys);
	config
		.command("show")
		.description("Print the complete config")
		.action(() => {
			printJson(redactPiboConfig(loadPiboConfig()));
		});

	program
		.command("profile")
		.argument("[profile]")
		.description("Inspect a pibo profile")
		.action(async (profile?: string) => {
			const { inspectPiboProfile } = await import("./core/runtime.js");
			printJson(await inspectPiboProfile({ profile: await createCliProfile(profile) }));
		});
	program
		.command("tui")
		.argument("[profile]")
		.description("Start the Pi TUI through pibo")
		.action(async (profile?: string) => {
			const { runPiboTui } = await import("./core/runtime.js");
			await runPiboTui({ profile: await createCliProfile(profile) });
		});
	program
		.command("tui:routed")
		.option("--show-thinking", "Show routed thinking deltas in the local TUI")
		.option("--thinking <level>", "Set routed thinking level: off, minimal, low, medium, high, xhigh", parsePiboThinkingLevel)
		.argument("[profile]")
		.description("Start the local routed Pibo TUI")
		.action(
			async (
				profile: string | undefined,
				options: { showThinking?: boolean; thinking?: PiboRuntimeOptions["thinkingLevel"] },
			) => {
				const { runLocalRoutedTui } = await import("./local/tui.js");
				await runLocalRoutedTui({
					profile,
					showThinking: options.showThinking === true,
					thinkingLevel: options.thinking,
				});
			},
		);
	program
		.command("tui:sessions")
		.description("Start the reduced Web Chat-derived session UI")
		.option("--session <id>", "Open a specific Pibo session id")
		.option("--owner-scope <id>", "Limit local/direct discovery to one owner scope")
		.option("--max-rows <count>", "Limit rendered transcript rows", parsePositiveInteger)
		.option("--demo", "Use deterministic fake session data for smoke testing")
		.action(async (options: { session?: string; ownerScope?: string; maxRows?: number; demo?: boolean }) => {
			const { runCliSessionsUi } = await import("./apps/cli-ui/index.js");
			await runCliSessionsUi({
				initialSessionId: options.session,
				ownerScope: options.ownerScope,
				maxRows: options.maxRows,
				useFakeSource: options.demo === true,
			});
		});
	program
		.command("router")
		.argument("[piboSessionId]", "Pibo session id", "demo")
		.description("Emit a demo router status event")
		.action(async (piboSessionId: string) => {
			const { PiboSessionRouter } = await import("./core/session-router.js");
			const router = new PiboSessionRouter({ persistSession: false });
			const event = await router.emit({
				type: "execution",
				piboSessionId,
				action: "status",
			});
			printJson(event);
			await router.disposeAll();
		});
	program
		.command("gateway:web")
		.description("Start the authenticated web gateway")
		.option("--web-host <host>", "Bind the HTTP web host, for example 0.0.0.0 for LAN access")
		.option("--web-port <port>", "Bind the HTTP web host port", parsePort)
		.action(async (options: { webHost?: string; webPort?: number }) => {
			const { runWebGatewayServer } = await import("./gateway/web.js");
			await runWebGatewayServer({
				web: {
					host: options.webHost,
					port: options.webPort,
				},
			});
		});
	program
		.command("client")
		.argument("[piboSessionId]", "Pibo session id", "default")
		.description("Start a console gateway client")
		.action(async (piboSessionId: string) => {
			const { runGatewayClient } = await import("./gateway/client.js");
			await runGatewayClient({ piboSessionId });
		});

	if (argv.length <= 2) {
		printRootDiscovery();
		return;
	}
	await program.parseAsync(argv);
}

function printRootDiscoveryText(): string {
	return `pibo - agent-oriented CLI

Commands:
  config       Manage local pibo config
  mcp          Discover and call configured MCP servers
  tools        Install and inspect curated external CLI tools
  pi-packages  Register Pi Coding Agent packages
  debug        Inspect local Pibo data
  data         Inspect and maintain Pibo data stores
  compute      Manage Pibo Docker compute workers
  skills       Manage Pibo user skills
  cron         Manage scheduled Pibo jobs
  ralph        Manage continuous Ralph jobs
  profile      Inspect a pibo profile
  tui          Start the direct Pi TUI
  tui:routed   Start the local routed Pibo TUI
  tui:sessions  Start the reduced Web Chat-derived session UI
  gateway      Inspect and restart host gateways through safe CLI commands
  gateway:web  Start a web gateway runtime

Next:
  pibo <command> --help
`;
}

function printConfigDiscoveryText(): string {
	return `pibo config - local config at ${getDefaultPiboConfigPath()}

Commands:
  keys               List supported config keys
  show               Print redacted config JSON
  get <key>          Print one redacted config value
  set <key> <value>  Set one config value
  del <key>          Delete one config value

Next:
  pibo config keys
`;
}
