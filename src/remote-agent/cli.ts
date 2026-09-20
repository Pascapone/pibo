import { Command } from "commander";
import {
	createDefaultPiboRemoteAgentService,
	readRemoteAgentAddressFile,
} from "./service.js";
import { effectiveRemoteInternetAccess, effectiveRemoteMode, isRemoteAgentModuleName, REMOTE_AGENT_MODULES, type RemoteAgentModuleName } from "./types.js";

function printDiscovery(): void {
	console.log(`pibo remote-agent

Expose rooms to external agents through a room-scoped MCP server.

Commands:
  status              Show MCP server status, enabled rooms, and connections
  config <roomId>     Show the remote config of a room
  enable <roomId>     Enable remote access for a room
  disable <roomId>    Disable remote access for a room (revokes its tokens)
  code <roomId>       Create a single-use device code for a room
  redeem <code>       Redeem a device code into a 30-day token (testing)
  tokens [roomId]     List connections (tokens)
  revoke <tokenId>    Revoke one connection immediately
  prune               Delete expired codes and tokens

Next: pibo remote-agent enable --help
      pibo remote-agent code --help`);
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parseModules(value: string | undefined): Partial<Record<RemoteAgentModuleName, boolean>> | undefined {
	if (value === undefined) return undefined;
	const names = value.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	for (const name of names) {
		if (!isRemoteAgentModuleName(name)) throw new Error(`Unknown module: ${name}. Known modules: ${REMOTE_AGENT_MODULES.join(", ")}.`);
	}
	const selection: Partial<Record<RemoteAgentModuleName, boolean>> = {};
	for (const module of REMOTE_AGENT_MODULES) selection[module] = names.includes(module);
	return selection;
}

export async function runRemoteAgentCli(argv: string[]): Promise<void> {
	const program = new Command("pibo remote-agent");
	program.helpOption(false);
	program.allowUnknownOption(false);

	if (argv.length <= 2) {
		printDiscovery();
		return;
	}

	program
		.command("status")
		.description("Show MCP server status, enabled rooms, and connections")
		.action(() => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				const status = service.status();
				const addressFile = readRemoteAgentAddressFile();
				printJson({
					server: addressFile ? { running: true, url: addressFile.url, pid: addressFile.pid } : { running: status.running, ...(status.url ? { url: status.url } : {}) },
					enabledRooms: status.enabledRooms,
					connections: status.connections,
				});
			} finally {
				service.close();
			}
		});

	program
		.command("config")
		.description("Show the remote config of a room")
		.argument("<roomId>")
		.action((roomId: string) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				const config = service.getRoomConfig(roomId);
				printJson({ ...config, effectiveMode: effectiveRemoteMode(config), effectiveInternet: effectiveRemoteInternetAccess(config) });
			} finally {
				service.close();
			}
		});

	program
		.command("enable")
		.description("Enable remote access for a room")
		.argument("<roomId>")
		.option("--mode <mode>", "sandbox or yolo (default sandbox)")
		.option("--runtime <runtime>", "muse or pi (default muse; pi is always yolo)")
		.option("--sandbox-path <path>", "Absolute sandbox path (default: room workspace)")
		.option("--modules <list>", "Comma-separated modules for new tokens (default sessions,observe,files)")
		.option("--default-profile <name>", "Default session agent (default muse-native for muse, base for pi)")
		.option("--allowed-profiles <list>", "Comma-separated agents the remote client may select")
		.option("--allow-internet", "Allow outgoing network for sandboxed Muse sessions (default off; YOLO is always on)")
		.action((roomId: string, options: { mode?: string; runtime?: string; sandboxPath?: string; modules?: string; defaultProfile?: string; allowedProfiles?: string; allowInternet?: boolean }) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				const config = service.setRoomConfig(roomId, {
					enabled: true,
					...(options.mode ? { mode: options.mode as "sandbox" | "yolo" } : {}),
					...(options.runtime ? { runtime: options.runtime as "muse" | "pi" } : {}),
					...(options.sandboxPath !== undefined ? { sandboxPath: options.sandboxPath } : {}),
					...(options.modules ? { modules: parseModules(options.modules) } : {}),
					...(options.defaultProfile ? { defaultProfile: options.defaultProfile } : {}),
					...(options.allowedProfiles ? { allowedProfiles: options.allowedProfiles.split(",").map((name) => name.trim()).filter(Boolean) } : {}),
					...(options.allowInternet ? { allowInternet: true } : {}),
				});
				printJson({ ...config, effectiveMode: effectiveRemoteMode(config), effectiveInternet: effectiveRemoteInternetAccess(config) });
			} finally {
				service.close();
			}
		});

	program
		.command("disable")
		.description("Disable remote access for a room (revokes its tokens)")
		.argument("<roomId>")
		.action((roomId: string) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				printJson(service.setRoomConfig(roomId, { enabled: false }));
			} finally {
				service.close();
			}
		});

	program
		.command("code")
		.description("Create a single-use device code for a room")
		.argument("<roomId>")
		.option("--label <label>", "Connection label shown in the tab")
		.action((roomId: string, options: { label?: string }) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				printJson(service.createDeviceCode(roomId, options.label));
			} finally {
				service.close();
			}
		});

	program
		.command("redeem")
		.description("Redeem a device code into a 30-day token (testing)")
		.argument("<code>")
		.action((code: string) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				const issued = service.redeemDeviceCode(code);
				const addressFile = readRemoteAgentAddressFile();
				printJson({ ...issued, ...(addressFile ? { mcpUrl: addressFile.url } : {}) });
			} finally {
				service.close();
			}
		});

	program
		.command("tokens")
		.description("List connections (tokens)")
		.argument("[roomId]")
		.action((roomId: string | undefined) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				printJson({ tokens: service.listTokens(roomId) });
			} finally {
				service.close();
			}
		});

	program
		.command("revoke")
		.description("Revoke one connection immediately")
		.argument("<tokenId>")
		.action((tokenId: string) => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				const revoked = service.revokeToken(tokenId);
				if (!revoked) throw new Error(`Token not found or already revoked: ${tokenId}`);
				printJson({ revoked: tokenId });
			} finally {
				service.close();
			}
		});

	program
		.command("prune")
		.description("Delete expired codes and tokens")
		.action(() => {
			const service = createDefaultPiboRemoteAgentService();
			try {
				printJson(service.pruneExpired());
			} finally {
				service.close();
			}
		});

	await program.parseAsync(argv);
}
