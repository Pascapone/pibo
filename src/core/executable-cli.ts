import { readFileSync } from "node:fs";
import { ensurePrivatePiboHome } from "./pibo-home.js";
import { PiboCapabilityHost } from "./capability-host.js";
import { createRuntimeUnassignedProfile, PIBO_MINIMAL_CORE_PROFILE_NAME } from "./runtime-unassigned.js";
import { runWebGatewayServer, type WebGatewayAuthMode } from "../gateway/web.js";
import type { Pibo4CutoverArtifactBinding } from "../plugins/cutover-contract.js";
import type { PluginSourceInput } from "../plugins/sources.js";

export type PiboExecutableComposition = {
	productName?: string;
	gatewayDescription?: string;
	defaultProfile?: string;
	registerRuntimeUnassignedProfile?: boolean;
	bootstrapPluginSources?: readonly PluginSourceInput[];
	cutoverArtifactBindings?: readonly Pibo4CutoverArtifactBinding[];
	verifyCutoverSourceArtifact?: boolean;
};

function packageVersion(): string {
	const value = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
	if (typeof value.version !== "string" || !value.version) throw new Error("Unable to read Pibo package version");
	return value.version;
}

function rootHelp(composition: PiboExecutableComposition): string {
	return [
		composition.productName ?? "Pibo Minimal Core",
		"",
		"Usage: pibo <command>",
		"",
		"Commands:",
		`  gateway:web  ${composition.gatewayDescription ?? "Start the plugin-free Web Gateway and Chat app"}`,
		"",
		"Options:",
		"  -h, --help     Show this discovery help",
		"  -V, --version  Show the package version",
		"",
		composition.bootstrapPluginSources?.length
			? `Run \`pibo gateway:web --help\` for gateway options. This composition activates ${composition.bootstrapPluginSources.length} packaged plugins on first startup.`
			: "Run `pibo gateway:web --help` for gateway options. Feature tools, runtime adapters, and feature views are delivered by separate plugin packages.",
	].join("\n");
}

function gatewayHelp(composition: PiboExecutableComposition): string {
	return [
		"Usage: pibo gateway:web [options]",
		"",
		`${composition.gatewayDescription ?? "Start the plugin-free Web Gateway and Chat app"}.`,
		"",
		"Options:",
		"  --auth <mode>          better-auth (default) or local",
		"  --web-host <host>      HTTP bind host",
		"  --web-port <port>      HTTP bind port",
		"  --gateway-port <port>  Agent gateway bind port",
		"  --cutover-plan <path>  Apply an exact prepared Pibo 4 cutover before startup",
		"  -h, --help             Show this help",
	].join("\n");
}

function optionValue(args: string[], index: number, name: string): { value: string; nextIndex: number } | undefined {
	const current = args[index]!;
	if (current.startsWith(`${name}=`)) return { value: current.slice(name.length + 1), nextIndex: index };
	if (current !== name) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return { value, nextIndex: index + 1 };
}

function parsePort(value: string, name: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be an integer between 1 and 65535`);
	return port;
}

function gatewayOptions(args: string[]) {
	let authMode: WebGatewayAuthMode | undefined;
	let webHost: string | undefined;
	let webPort: number | undefined;
	let gatewayPort: number | undefined;
	let cutoverPlanPath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--help" || arg === "-h") return { help: true as const };
		const auth = optionValue(args, index, "--auth");
		if (auth) {
			if (auth.value !== "better-auth" && auth.value !== "local") throw new Error(`--auth must be 'better-auth' or 'local', got '${auth.value}'`);
			authMode = auth.value;
			index = auth.nextIndex;
			continue;
		}
		const host = optionValue(args, index, "--web-host");
		if (host) {
			webHost = host.value;
			index = host.nextIndex;
			continue;
		}
		const web = optionValue(args, index, "--web-port");
		if (web) {
			webPort = parsePort(web.value, "--web-port");
			index = web.nextIndex;
			continue;
		}
		const gateway = optionValue(args, index, "--gateway-port");
		if (gateway) {
			gatewayPort = parsePort(gateway.value, "--gateway-port");
			index = gateway.nextIndex;
			continue;
		}
		const cutover = optionValue(args, index, "--cutover-plan");
		if (cutover) {
			cutoverPlanPath = cutover.value;
			index = cutover.nextIndex;
			continue;
		}
		throw new Error(`Unknown gateway:web option '${arg}'`);
	}
	if (gatewayPort === undefined && webPort !== undefined) {
		if (webPort === 65535) throw new Error("--web-port 65535 requires an explicit --gateway-port");
		gatewayPort = webPort + 1;
	}
	return { help: false as const, authMode, webHost, webPort, gatewayPort, cutoverPlanPath };
}

export async function runPiboCoreCli(argv = process.argv, composition: PiboExecutableComposition = {}): Promise<void> {
	const command = argv[2];
	if (command === undefined || command === "--help" || command === "-h") {
		console.log(rootHelp(composition));
		return;
	}
	if (command === "--version" || command === "-V") {
		console.log(packageVersion());
		return;
	}
	if (command !== "gateway:web") {
		throw new Error(`Command '${command}' is not part of ${composition.productName ?? "Pibo Minimal Core"}. Install the required plugin package or run \`pibo --help\`.`);
	}
	const options = gatewayOptions(argv.slice(3));
	if (options.help) {
		console.log(gatewayHelp(composition));
		return;
	}
	ensurePrivatePiboHome();
	const capabilityHost = PiboCapabilityHost.create();
	const defaultProfile = composition.defaultProfile ?? PIBO_MINIMAL_CORE_PROFILE_NAME;
	if (composition.registerRuntimeUnassignedProfile ?? defaultProfile === PIBO_MINIMAL_CORE_PROFILE_NAME) {
		capabilityHost.registerProfile({
			name: PIBO_MINIMAL_CORE_PROFILE_NAME,
			description: "Runtime-free profile for a plugin-free Pibo Minimal Core installation",
			create: () => createRuntimeUnassignedProfile(),
		});
	}
	await runWebGatewayServer({
		authMode: options.authMode,
		port: options.gatewayPort,
		web: { host: options.webHost, port: options.webPort },
		chat: { defaultProfile },
		capabilityHost,
		installDefaultPlugins: false,
		bootstrapPluginSources: composition.bootstrapPluginSources,
		requirePreparedCutover: options.cutoverPlanPath !== undefined,
		cutoverPlanPath: options.cutoverPlanPath,
		cutoverArtifactBindings: composition.cutoverArtifactBindings,
		verifyCutoverSourceArtifact: composition.verifyCutoverSourceArtifact,
		currentCoreVersion: packageVersion(),
		resourceReaper: false,
	});
}
