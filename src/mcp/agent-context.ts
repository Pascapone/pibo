import { stat, writeFile } from 'node:fs/promises';
import {
  type McpDescriptionSource,
  type McpServerMetadata,
  type McpServersConfig,
  type ServerConfig,
  isHttpServer,
  loadConfigUnresolved,
  resolveMcpServerConfigSource,
} from './config.js';
import { ErrorCode, formatCliError } from './errors.js';

export const MCP_SERVER_DESCRIPTION_MAX_LENGTH = 480;
export const ENABLED_MCP_SERVERS_CONTEXT_PATH = '.pibo/context/enabled-mcp-servers.md';

export type PiboMcpServerInfo = {
  name: string;
  transport: 'stdio' | 'http';
  description?: string;
  descriptionSource?: McpDescriptionSource;
  hasDescription: boolean;
  editable: boolean;
};

export function normalizeMcpServerDescription(value: string): string {
  const description = value.replace(/\s+/g, ' ').trim();
  if (!description) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MCP_DESCRIPTION_REQUIRED',
        message: 'MCP server description is required',
      }),
    );
  }
  if (description.length > MCP_SERVER_DESCRIPTION_MAX_LENGTH) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MCP_DESCRIPTION_TOO_LONG',
        message: `MCP server description must be ${MCP_SERVER_DESCRIPTION_MAX_LENGTH} characters or fewer`,
      }),
    );
  }
  return description;
}

export async function listMcpServerInfos(configPath?: string): Promise<PiboMcpServerInfo[]> {
  try {
    const config = await loadConfigUnresolved(configPath);
    return Object.entries(config.mcpServers).map(([name, server]) => mcpServerInfoFromConfig(name, server));
  } catch (error) {
    if ((error as Error).message.includes('CONFIG_NOT_FOUND')) return [];
    throw error;
  }
}

export async function setMcpServerDescription(
  serverName: string,
  descriptionInput: string,
  configPath?: string,
): Promise<PiboMcpServerInfo> {
  const description = normalizeMcpServerDescription(descriptionInput);
  const { path, config, server } = await resolveMcpServerConfigSource(
    serverName,
    configPath,
  );
  if (server.pibo?.descriptionSource === 'registry') {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MCP_DESCRIPTION_READ_ONLY',
        message: `Server "${serverName}" description is read-only`,
      }),
    );
  }
  if (process.platform !== 'win32' && ((await stat(path)).mode & 0o222) === 0) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MCP_CONFIG_READ_ONLY',
        message: `Server "${serverName}" config is read-only`,
      }),
    );
  }

  server.pibo = {
    ...(server.pibo ?? {}),
    description,
    descriptionSource: 'user',
  };
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return mcpServerInfoFromConfig(serverName, server);
}

export async function getMcpAgentContextFile(
  selectedServerNames: readonly string[],
  configPath?: string,
): Promise<{ path: string; content: string } | undefined> {
  if (selectedServerNames.length === 0) return undefined;
  try {
    return getMcpAgentContextFileFromConfig(selectedServerNames, await loadConfigUnresolved(configPath));
  } catch (error) {
    if ((error as Error).message.includes('CONFIG_NOT_FOUND')) return undefined;
    throw error;
  }
}

export function getMcpAgentContextFileFromConfig(
  selectedServerNames: readonly string[],
  config: McpServersConfig,
): { path: string; content: string } | undefined {
  const infosByName = new Map(
    Object.entries(config.mcpServers).map(([name, server]) => [name, mcpServerInfoFromConfig(name, server)]),
  );
  const selected = selectedServerNames
    .map((name) => infosByName.get(name))
    .filter((info): info is PiboMcpServerInfo => Boolean(info?.description));

  if (selected.length === 0) return undefined;

  const sections = selected.flatMap((server) => [
    `## ${server.name}`,
    server.description ?? '',
    '',
    `Discover: \`npm run dev -- mcp info ${server.name}\``,
    `Call: \`npm run dev -- mcp call ${server.name} <tool> '<json>'\``,
    '',
  ]);

  return {
    path: ENABLED_MCP_SERVERS_CONTEXT_PATH,
    content: [
      '# Enabled MCP Servers',
      '',
      'These MCP servers are enabled for this agent. Use the MCP CLI for discovery and calls.',
      '',
      ...sections,
    ].join('\n').trimEnd(),
  };
}

function mcpServerInfoFromConfig(name: string, server: ServerConfig): PiboMcpServerInfo {
  const metadata = normalizeMetadata(server.pibo);
  const description = metadata.description;
  return {
    name,
    transport: isHttpServer(server) ? 'http' : 'stdio',
    ...(description ? { description } : {}),
    ...(metadata.descriptionSource ? { descriptionSource: metadata.descriptionSource } : {}),
    hasDescription: Boolean(description),
    editable: metadata.descriptionSource !== 'registry',
  };
}

function normalizeMetadata(metadata: McpServerMetadata | undefined): McpServerMetadata {
  if (!metadata || typeof metadata !== 'object') return {};
  const description = typeof metadata.description === 'string' && metadata.description.trim()
    ? metadata.description.trim()
    : undefined;
  const descriptionSource = metadata.descriptionSource === 'registry' || metadata.descriptionSource === 'user'
    ? metadata.descriptionSource
    : undefined;
  return {
    ...(description ? { description } : {}),
    ...(descriptionSource ? { descriptionSource } : {}),
  };
}
