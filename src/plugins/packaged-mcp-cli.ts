import type { PluginSetupContext } from "./host.js";
import { MCP_CLI_ADAPTER } from "./mcp-adapter.js";

export function setupMcpCli(context: PluginSetupContext): void {
	context.register("adapter", MCP_CLI_ADAPTER);
	context.register("settings", {});
}
