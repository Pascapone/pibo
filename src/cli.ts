import { readFileSync } from "node:fs";
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
import type { PluginJsonObject } from "./plugins/manifest.js";
import { pluginRuntimeDeliveryModes } from "./agent-runtime/capabilities.js";
import { parsePiboThinkingLevel } from "./core/thinking.js";
import { ensurePrivatePiboHome } from "./core/pibo-home.js";

async function resolveCliProfile(profileName?: string) {
	const { createPiboProfileFromCapabilitiesOrDefault } = await import("./plugins/builtin.js");
	const { profileFromPluginPlan } = await import("./agent-runtime/plugin-plan.js");
	const { startPluginProductRuntime } = await import("./plugins/product-runtime.js");
	const { PiboCapabilityHost } = await import("./core/capability-host.js");
	const registry = PiboCapabilityHost.create();
	const product = await startPluginProductRuntime({
		host: registry.getPluginHost(),
		collectConsumers: async () => [],
		productOptions: { userResources: { contextFilesMode: "catalog", userSkills: {}, customAgents: {} } },
	});
	try {
		const materializePreview = (targetProfile?: string) => {
			const selected = createPiboProfileFromCapabilitiesOrDefault(registry, targetProfile);
			if (!selected.pluginSelection) return selected;
			const adapter = registry.requireAgentRuntimeAdapter(selected.runtimeInstanceId);
			const plan = product.runtime.preview(selected, {
				adapterId: adapter.descriptor.id,
				instanceId: selected.runtimeInstanceId,
				capabilities: adapter.descriptor.capabilities as unknown as PluginJsonObject,
				deliveryModes: pluginRuntimeDeliveryModes(adapter.descriptor.capabilities),
			});
			return profileFromPluginPlan(selected, plan, registry.getPluginHost());
		};
		const profile = materializePreview(profileName);
		return {
			profile,
			resolveSubagentProfile: (targetProfile: string) => materializePreview(targetProfile),
			dispose: async () => {
				await product.dispose();
			},
		};
	} catch (error) {
		await product.dispose();
		throw error;
	}
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

function getPiboVersion(): string {
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: unknown };
	if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
		throw new Error("Unable to read Pibo package version");
	}
	return packageJson.version;
}

function printPiboVersion(): void {
	console.log(getPiboVersion());
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

function parsePiboSessionId(value: string): string {
	const piboSessionId = value.trim();
	if (!piboSessionId) throw new Error("Pibo Session ID must not be empty");
	return piboSessionId;
}

function parseGatewayClientHost(value: string): string {
	const host = value.trim();
	if (!host) throw new Error("Gateway host must not be empty");
	return host;
}

function parsePositiveInteger(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error("Value must be a positive integer");
	}
	return parsed;
}

function defaultGatewayPortForWebPort(webPort: number | undefined): number | undefined {
	if (webPort === undefined) return undefined;
	const gatewayPort = webPort + 1;
	if (gatewayPort > 65535) {
		throw new Error("--web-port 65535 requires an explicit --gateway-port because the derived gateway port would exceed 65535");
	}
	return gatewayPort;
}

function isLoopbackBindForCli(host: string): boolean {
	const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isComputeWorkerRuntimeForCli(): boolean {
	return process.env.PIBO_COMPUTE_WORKER === "1";
}

export async function runPiboCli(argv = process.argv): Promise<void> {
	if (argv[2] === "--help" || argv[2] === "-h") {
		printRootDiscovery();
		return;
	}

	if (argv[2] === "--version" || argv[2] === "-V") {
		printPiboVersion();
		return;
	}

	if (argv.length > 2) ensurePrivatePiboHome();

	if (argv[2] === "auth") {
		const { runAuthCli } = await import("./auth/cli.js");
		await runAuthCli([argv[0] ?? "node", "pibo auth", ...argv.slice(3)]);
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

	if (argv[2] === "resources") {
		const { runResourcesCli } = await import("./resources/cli.js");
		await runResourcesCli([argv[0] ?? "node", "pibo resources", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "preview") {
		const { runPreviewCli } = await import("./previews/cli.js");
		await runPreviewCli([argv[0] ?? "node", "pibo preview", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "setup") {
		const { runSetupCli } = await import("./setup/cli.js");
		await runSetupCli([argv[0] ?? "node", "pibo setup", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "plugins") {
		const { runDefaultPluginCli } = await import("./plugins/cli.js");
		process.exitCode = await runDefaultPluginCli(argv.slice(3));
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

	if (argv[2] === "remote-agent") {
		const { runRemoteAgentCli } = await import("./remote-agent/cli.js");
		await runRemoteAgentCli([argv[0] ?? "node", "pibo remote-agent", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "loop") {
		const { runLoopCli } = await import("./loops/cli.js");
		await runLoopCli([argv[0] ?? "node", "pibo loop", ...argv.slice(3)]);
		return;
	}

	if (argv[2] === "ralph") {
		const { runLoopCli } = await import("./loops/cli.js");
		await runLoopCli([argv[0] ?? "node", "pibo ralph", ...argv.slice(3)], { mode: "ralph", commandName: "pibo ralph" });
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
		.command("resources")
		.description("Inspect and safely reap managed compute and browser resources")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runResourcesCli } = await import("./resources/cli.js");
			await runResourcesCli([argv[0] ?? "node", "pibo resources", ...args]);
		});

	program
		.command("preview")
		.description("Expose session-linked live development previews")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runPreviewCli } = await import("./previews/cli.js");
			await runPreviewCli([argv[0] ?? "node", "pibo preview", ...args]);
		});

	program
		.command("setup")
		.description("Plan and manage supported host installation profiles")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runSetupCli } = await import("./setup/cli.js");
			await runSetupCli([argv[0] ?? "node", "pibo setup", ...args]);
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
		.command("remote-agent")
		.description("Expose rooms to external agents through a room-scoped MCP server")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runRemoteAgentCli } = await import("./remote-agent/cli.js");
			await runRemoteAgentCli([argv[0] ?? "node", "pibo remote-agent", ...args]);
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
		.command("loop")
		.description("Manage continuous agent loops")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runLoopCli } = await import("./loops/cli.js");
			await runLoopCli([argv[0] ?? "node", "pibo loop", ...args]);
		});

	program
		.command("ralph")
		.description("Legacy alias for Ralph-mode loops")
		.helpOption(false)
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.argument("[args...]")
		.action(async (args: string[]) => {
			const { runLoopCli } = await import("./loops/cli.js");
			await runLoopCli([argv[0] ?? "node", "pibo ralph", ...args], { mode: "ralph", commandName: "pibo ralph" });
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
		.helpOption("-h, --help", "Display help for command")
		.argument("[profile]")
		.description("Inspect a pibo profile")
		.addHelpText("after", "\nProfiles include built-in plugin profiles plus active saved Chat custom agents from $PIBO_HOME/chat-agents.sqlite. Archived custom agents are not exposed.\n")
		.action(async (profile?: string) => {
			const { inspectPiboProfile } = await import("./core/runtime.js");
			const resolved = await resolveCliProfile(profile);
			try {
				printJson(await inspectPiboProfile({
					profile: resolved.profile,
					subagentProfileResolver: resolved.resolveSubagentProfile,
				}));
			} finally {
				await resolved.dispose();
			}
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
		.option("--auth <mode>", "Auth service mode: 'better-auth' (default) or 'local' (loopback-only, no Google OAuth)")
		.option("--web-host <host>", "Bind the HTTP web host, for example 0.0.0.0 for LAN access")
		.option("--web-port <port>", "Bind the HTTP web host port", parsePort)
		.option("--gateway-port <port>", "Bind the agent-runtime gateway port", parsePort)
		.action(async (options: { auth?: string; webHost?: string; webPort?: number; gatewayPort?: number }) => {
			warnIfUnsupportedGatewayNodeVersion();
			const { runWebGatewayServer } = await import("./gateway/web.js");
			const authMode = options.auth;
			if (authMode !== undefined && authMode !== "better-auth" && authMode !== "local") {
				throw new Error(`--auth must be 'better-auth' or 'local', got '${authMode}'`);
			}
			if (authMode === "local" && options.webHost !== undefined && !isLoopbackBindForCli(options.webHost) && !isComputeWorkerRuntimeForCli()) {
				throw new Error(
					`--auth=local requires a loopback bind (127.0.0.1, ::1, or localhost). Got --web-host='${options.webHost}'. ` +
						"Either drop --web-host or pick --auth=better-auth for a public bind.",
				);
			}
			await runWebGatewayServer({
				authMode: authMode as "better-auth" | "local" | undefined,
				port: options.gatewayPort ?? defaultGatewayPortForWebPort(options.webPort),
				web: {
					host: options.webHost,
					port: options.webPort,
				},
			});
		});
	program
		.command("client")
		.argument("[piboSessionId]", "Pibo Session ID", parsePiboSessionId, "default")
		.description("Start a console client for one Pibo Session")
		.helpOption("-h, --help", "Display help for command")
		.option("--host <host>", "Gateway host", parseGatewayClientHost)
		.option("--port <port>", "Gateway port", parsePort)
		.addHelpText(
			"after",
			"\nMessages queue by default. Use /steer <message> for the active turn or /queue <message> explicitly. " +
				"Piped EOF waits for acknowledgements and terminal completion while assistant output keeps streaming. Prompts are shown only in a TTY.\n" +
				"Security: raw gateway TCP is unauthenticated and unencrypted; use remote hosts only on trusted networks or through a secure tunnel.\n",
		)
		.action(async (piboSessionId: string, options: { host?: string; port?: number }) => {
			const { isGatewayClientExpectedError, runGatewayClient } = await import("./gateway/client.js");
			try {
				await runGatewayClient({ piboSessionId, host: options.host, port: options.port });
			} catch (error) {
				if (!isGatewayClientExpectedError(error)) throw error;
				console.error(`error: ${error.message}`);
				process.exitCode = 1;
			}
		});

	if (argv.length <= 2) {
		printRootDiscovery();
		return;
	}
	await program.parseAsync(argv);
}

function warnIfUnsupportedGatewayNodeVersion(): void {
	const major = Number(process.versions.node.split(".")[0]);
	if (Number.isFinite(major) && major >= 24) return;
	const message = `Pibo gateway:web requires Node >=24; current runtime is ${process.version}. Upgrade Node before production gateway use.`;
	if (process.env.PIBO_STRICT_NODE_ENGINE === "1") throw new Error(message);
	console.warn(`[pibo] warning: ${message}`);
}

function printRootDiscoveryText(): string {
	return `pibo - agent-oriented CLI

Commands:
  config       Manage local pibo config
  auth         Manage Web authentication and machine identities
  mcp          Discover and call configured MCP servers
  tools        Install and inspect curated external CLI tools
  plugins      Inspect and manage Pibo plugins
  debug        Inspect local Pibo data
  data         Inspect and maintain Pibo data stores
  compute      Manage Pibo Docker compute workers
  resources    Inspect and safely reap managed compute and browser resources
  preview      Expose session-linked live development previews
  setup        Plan and manage supported host installation profiles
  skills       Manage Pibo user skills
  cron         Manage scheduled Pibo jobs
  remote-agent Expose rooms to external agents through a room-scoped MCP server
  loop         Manage continuous agent loops (goal mode by default)
  ralph        Legacy alias for Ralph-mode loops
  profile      Inspect a pibo profile, including active saved Chat custom agents
  client       Send queued or steering messages to one Pibo Session
  gateway      Inspect and restart host gateways through safe CLI commands
  gateway:web  Start a web gateway runtime (use --auth=local for loopback-only local auth)

Options:
  --version    Print the Pibo CLI version

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
