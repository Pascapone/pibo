import { Command } from "commander";
import {
	DEFAULT_PIBO_CONFIG_PATH,
	PIBO_CONFIG_KEYS,
	deletePiboConfigValue,
	getDisplayPiboConfigValue,
	loadPiboConfig,
	redactPiboConfig,
	savePiboConfig,
	setPiboConfigValue,
} from "./config/config.js";

async function createCliProfile(profileName?: string) {
	const { createDefaultPiboPluginRegistry } = await import("./plugins/builtin.js");
	return createDefaultPiboPluginRegistry().createProfile(profileName ?? "pibo-minimal");
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

	if (argv[2] === "config" && (argv[3] === "--help" || argv[3] === "-h" || argv.length === 3)) {
		printConfigDiscovery();
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

	const config = program.command("config").description(`Manage pibo config at ${DEFAULT_PIBO_CONFIG_PATH}`).helpOption(false);
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
		.argument("[profile]")
		.description("Start the local routed Pibo TUI")
		.action(async (profile?: string) => {
			const { runLocalRoutedTui } = await import("./local/tui.js");
			await runLocalRoutedTui({ profile });
		});
	program
		.command("router")
		.argument("[sessionKey]", "Session key", "demo")
		.description("Emit a demo router status event")
		.action(async (sessionKey: string) => {
			const { PiboSessionRouter } = await import("./core/session-router.js");
			const router = new PiboSessionRouter({ persistSession: false });
			const event = await router.emit({
				type: "execution",
				sessionKey,
				action: "status",
			});
			printJson(event);
			await router.disposeAll();
		});
	program
		.command("gateway")
		.description("Start the local pibo gateway daemon")
		.action(async () => {
			const { runGatewayServer } = await import("./gateway/server.js");
			await runGatewayServer();
		});
	program
		.command("gateway:web")
		.description("Start the authenticated web gateway")
		.action(async () => {
			const { runWebGatewayServer } = await import("./gateway/web.js");
			await runWebGatewayServer();
		});
	program
		.command("client")
		.argument("[sessionKey]", "Session key", "default")
		.description("Start a console gateway client")
		.action(async (sessionKey: string) => {
			const { runGatewayClient } = await import("./gateway/client.js");
			await runGatewayClient({ sessionKey });
		});
	program
		.command("remote")
		.argument("[sessionName]", "Remote session name", "default")
		.argument("[profile]")
		.description("Start the Pi-TUI remote controller")
		.action(async (sessionName: string, profile?: string) => {
			const { runRemoteAgentTui } = await import("./remote/examples/tui-controller.js");
			await runRemoteAgentTui({ sessionName, profile });
		});
	program
		.command("remote-line")
		.argument("[sessionName]", "Remote session name", "default")
		.argument("[profile]")
		.description("Start the minimal line-based remote client")
		.action(async (sessionName: string, profile?: string) => {
			const { runRemoteAgentClient } = await import("./remote/client.js");
			await runRemoteAgentClient({ sessionName, profile });
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
  profile      Inspect a pibo profile
  tui          Start the direct Pi TUI
  tui:routed   Start the local routed Pibo TUI
  gateway      Start the local gateway daemon
  gateway:web  Start the authenticated web gateway
  remote       Start the Pi-TUI remote controller

Next:
  pibo <command> --help
`;
}

function printConfigDiscoveryText(): string {
	return `pibo config - local config at ${DEFAULT_PIBO_CONFIG_PATH}

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
