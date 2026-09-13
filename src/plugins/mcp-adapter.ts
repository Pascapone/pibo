import { isHttpServer, loadConfigUnresolved, type McpServersConfig, type ServerConfig } from "../mcp/config.js";
import { getMcpAgentContextFileFromConfig } from "../mcp/agent-context.js";
import { scopePiboMcpServerConfig, type ScopedPiboMcpServerConfig } from "../mcp/runtime-session.js";

export type PiboMcpAdapter = {
	id: string;
	loadConfig(path?: string): Promise<McpServersConfig>;
	isHttpServer(config: ServerConfig): boolean;
	scopeServer(name: string, config: ServerConfig, environment: NodeJS.ProcessEnv): ScopedPiboMcpServerConfig;
	createAgentContext(selected: readonly string[], config: McpServersConfig): { path: string; content: string } | undefined;
};

export const MCP_CLI_ADAPTER: PiboMcpAdapter = {
	id: "mcp-cli",
	loadConfig: loadConfigUnresolved,
	isHttpServer,
	scopeServer: scopePiboMcpServerConfig,
	createAgentContext(selected, config) {
		return getMcpAgentContextFileFromConfig(selected, {
			mcpServers: Object.fromEntries(selected.flatMap((name) => config.mcpServers[name] ? [[name, config.mcpServers[name]] as const] : [])),
		});
	},
};
