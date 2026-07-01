/**
 * Info command - Show server or tool details
 */

import { type McpConnection, getConnection, safeClose } from '../client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  formatConfigSourceSummaries,
  getConfigSourceSummaries,
  loadConfig,
} from '../config.js';
import {
  ErrorCode,
  formatCliError,
  serverConnectionError,
  toolNotFoundError,
} from '../errors.js';
import { formatServerDetails, formatToolSchema } from '../output.js';

export interface InfoOptions {
  target: string; // "server" or "server/tool"
  withDescriptions: boolean;
  configPath?: string;
}

/**
 * Parse target into server and optional tool name
 */
function parseTarget(target: string): { server: string; tool?: string } {
  const parts = target.split('/');
  if (parts.length === 1) {
    return { server: parts[0] };
  }
  return { server: parts[0], tool: parts.slice(1).join('/') };
}

/**
 * Execute the info command
 */
export async function infoCommand(options: InfoOptions): Promise<void> {
  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configPath);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const { server: serverName, tool: toolName } = parseTarget(options.target);

  const serverConfig = config.mcpServers[serverName] as ServerConfig | undefined;
  if (!serverConfig) {
    const available = Object.keys(config.mcpServers);
    const serverList = available.length > 0 ? available.join(', ') : '(none)';
    const summaries = await getConfigSourceSummaries(options.configPath);
    console.error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'SERVER_NOT_FOUND',
        message: `Server "${serverName}" not found in config`,
        details: [
          `Merged available servers: ${serverList}`,
          'Config search paths:',
          formatConfigSourceSummaries(summaries),
        ].join('\n'),
        suggestion:
          available.length > 0
            ? `Use one of: ${available.map((s) => `pibo mcp info ${s}`).join(', ')}`
            : `Add server to mcp_servers.json: { "mcpServers": { "${serverName}": { ... } } }`,
      }),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let connection: McpConnection;

  try {
    connection = await getConnection(serverName, serverConfig);
  } catch (error) {
    console.error(
      formatCliError(
        serverConnectionError(serverName, (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  try {
    if (toolName) {
      // Show specific tool schema
      const tools = await connection.listTools();
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        const availableTools = tools.map((t) => t.name);
        console.error(
          formatCliError(
            toolNotFoundError(toolName, serverName, availableTools),
          ),
        );
        process.exit(ErrorCode.CLIENT_ERROR);
      }

      // Human-readable output
      console.log(formatToolSchema(serverName, tool));
    } else {
      // Show server details
      const tools = await connection.listTools();
      const instructions = await connection.getInstructions();

      // Human-readable output
      console.log(
        formatServerDetails(
          serverName,
          serverConfig,
          tools,
          options.withDescriptions,
          instructions,
        ),
      );
    }
  } finally {
    await safeClose(connection.close);
  }
}
