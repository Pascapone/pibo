import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CustomAgentStore } from '../apps/chat/agent-store.js';
import { piboHomePath } from '../core/pibo-home.js';
import {
  type McpServersConfig,
  type ServerConfig,
  ensureConfigExists,
  findConfigPath,
  getConfigSearchPaths,
  getPreferredConfigPath,
} from './config.js';
import { ErrorCode, formatCliError } from './errors.js';
import { setMcpServerDescription } from './agent-context.js';

export type ConfigAction = 'help' | 'schema' | 'paths' | 'init' | 'path' | 'show' | 'add' | 'remove' | 'describe';

export interface ConfigCommandOptions {
  action: ConfigAction;
  name?: string;
  serverJson?: string;
  description?: string;
  configPath?: string;
}

const EXAMPLE_CONFIG: McpServersConfig = {
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
    deepwiki: {
      url: 'https://mcp.deepwiki.com/mcp',
    },
  },
};

export function printConfigHelp(): void {
  console.log(`
MCP server configuration

Commands:
  pibo mcp config init                         Create mcp_servers.json if missing
  pibo mcp config path                         Print the config path that will be used
  pibo mcp config paths                        Show config path lookup order
  pibo mcp config show                         Print the current config JSON
  pibo mcp config add <name> <json>            Add or replace one server
  pibo mcp config describe <name> "<text>"     Add or update an agent-facing description
  pibo mcp config remove <name>                Remove one server
  pibo mcp config schema                       Show server JSON schema and examples
  pibo mcp config help                         Show this help
`);
}

export function printConfigPaths(): void {
  console.log(`
MCP config lookup order:
  1. -c/--config <path>
  2. MCP_CONFIG_PATH
  3. ./mcp_servers.json
  4. ~/mcp_servers.json
  5. ~/.mcp_servers.json
  6. ~/.config/mcp/mcp_servers.json
`);
}

export function printConfigSchema(): void {
  console.log(`
Server schema:
  Stdio server:
    {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": { "TOKEN": "\${TOKEN}" },
      "cwd": ".",
      "allowedTools": ["read_*"],
      "disabledTools": ["write_*"],
      "pibo": {
        "description": "Access project files through the configured filesystem MCP server.",
        "descriptionSource": "user"
      }
    }

  HTTP server:
    {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer \${TOKEN}" },
      "allowedTools": ["search_*"],
      "disabledTools": ["dangerous_*"]
    }

Full example:
${JSON.stringify(EXAMPLE_CONFIG, null, 2)}

Examples:
  pibo mcp config init
  pibo mcp config add filesystem '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}'
  pibo mcp config add deepwiki '{"url":"https://mcp.deepwiki.com/mcp"}'
  pibo mcp config describe filesystem "Access project files through the configured filesystem MCP server."
  pibo mcp config remove filesystem
`);
}

async function readRawConfig(path: string): Promise<McpServersConfig> {
  const content = await readFile(path, 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('mcpServers' in parsed) ||
    typeof (parsed as { mcpServers?: unknown }).mcpServers !== 'object'
  ) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_MISSING_FIELD',
        message: 'Config file missing required "mcpServers" object',
        details: `File: ${path}`,
        suggestion: 'Run pibo mcp config help to see the expected JSON shape',
      }),
    );
  }

  return parsed as McpServersConfig;
}

async function writeRawConfig(
  path: string,
  config: McpServersConfig,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

async function mergedConfigRetainsServer(
  name: string,
  updatedPath: string,
  updatedConfig: McpServersConfig,
  explicitPath?: string,
): Promise<boolean> {
  const resolvedUpdatedPath = resolve(updatedPath);
  for (const sourcePath of getConfigSearchPaths(explicitPath)) {
    if (!existsSync(sourcePath)) continue;
    const sourceConfig = resolve(sourcePath) === resolvedUpdatedPath
      ? updatedConfig
      : await readRawConfig(sourcePath);
    if (Object.hasOwn(sourceConfig.mcpServers, name)) return true;
  }
  return false;
}

function customAgentsSelectingMcpServer(name: string): string[] {
  const storePath = piboHomePath('chat-agents.sqlite');
  if (!existsSync(storePath)) return [];
  const store = new CustomAgentStore(storePath);
  try {
    return store
      .list({ includeArchived: true })
      .filter((agent) => agent.mcpServers.includes(name))
      .map((agent) => agent.profileName)
      .sort((left, right) => left.localeCompare(right));
  } finally {
    store.close();
  }
}

function parseServerConfig(input: string): ServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_INVALID_SERVER_JSON',
        message: 'Server config must be valid JSON',
        details: (error as Error).message,
        suggestion:
          'Example: pibo mcp config add filesystem \'{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}\'',
      }),
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_INVALID_SERVER',
        message: 'Server config must be a JSON object',
      }),
    );
  }

  const config = parsed as Partial<ServerConfig> & Record<string, unknown>;
  const hasCommand = typeof config.command === 'string';
  const hasUrl = typeof config.url === 'string';

  if (!hasCommand && !hasUrl) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_INVALID_SERVER',
        message: 'Server config must include either "command" or "url"',
        suggestion:
          'Use {"command":"..."} for stdio servers or {"url":"https://..."} for HTTP servers',
      }),
    );
  }

  if (hasCommand && hasUrl) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CONFIG_INVALID_SERVER',
        message: 'Server config cannot include both "command" and "url"',
        suggestion: 'Remove one of the two fields',
      }),
    );
  }

  return config as ServerConfig;
}

export async function configCommand(
  options: ConfigCommandOptions,
): Promise<void> {
  if (options.action === 'help') {
    printConfigHelp();
    return;
  }

  if (options.action === 'schema') {
    printConfigSchema();
    return;
  }

  if (options.action === 'paths') {
    printConfigPaths();
    return;
  }

  if (options.action === 'path') {
    console.log(findConfigPath(options.configPath) ?? getPreferredConfigPath(options.configPath));
    return;
  }

  if (options.action === 'init') {
    const preferredPath = getPreferredConfigPath(options.configPath);
    const alreadyExists = existsSync(preferredPath);
    const path = await ensureConfigExists(preferredPath);
    console.log(alreadyExists ? `MCP config ready: ${path}` : `Created MCP config: ${path}`);
    return;
  }

  if (options.action === 'describe') {
    if (!options.name || !options.description) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'MISSING_ARGUMENT',
          message: 'config describe requires <name> and <description>',
          suggestion: 'Example: pibo mcp config describe filesystem "Access project files through MCP."',
        }),
      );
    }

    await setMcpServerDescription(options.name, options.description, options.configPath);
    console.log(`Updated MCP server "${options.name}" description`);
    return;
  }

  const path = await ensureConfigExists(options.configPath);
  const config = await readRawConfig(path);

  if (options.action === 'show') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (options.action === 'add') {
    if (!options.name || !options.serverJson) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'MISSING_ARGUMENT',
          message: 'config add requires <name> and <json>',
          suggestion:
            'Example: pibo mcp config add filesystem \'{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}\'',
        }),
      );
    }

    config.mcpServers[options.name] = parseServerConfig(options.serverJson);
    await writeRawConfig(path, config);
    console.log(`Added MCP server "${options.name}" to ${path}`);
    return;
  }

  if (options.action === 'remove') {
    if (!options.name) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'MISSING_ARGUMENT',
          message: 'config remove requires <name>',
          suggestion: 'Example: pibo mcp config remove filesystem',
        }),
      );
    }

    if (!Object.hasOwn(config.mcpServers, options.name)) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'SERVER_NOT_FOUND',
          message: `Server "${options.name}" not found in config`,
          details: `Available servers: ${Object.keys(config.mcpServers).join(', ') || '(none)'}`,
        }),
      );
    }

    delete config.mcpServers[options.name];
    if (!(await mergedConfigRetainsServer(options.name, path, config, options.configPath))) {
      const affectedAgents = customAgentsSelectingMcpServer(options.name);
      if (affectedAgents.length > 0) {
        throw new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'MCP_SERVER_IN_USE',
            message: `MCP server "${options.name}" is selected by custom agents`,
            details: `Custom agents: ${affectedAgents.join(', ')}`,
            suggestion: 'Update those agents to stop selecting this MCP server, then retry the removal.',
          }),
        );
      }
    }
    await writeRawConfig(path, config);
    console.log(`Removed MCP server "${options.name}" from ${path}`);
  }
}
