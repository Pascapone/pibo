/**
 * MCP-CLI - A lightweight CLI for interacting with MCP servers
 *
 * Commands:
 *   mcp-cli                         List all servers and tools
 *   mcp-cli info <server>            Show server details
 *   mcp-cli info <server> <tool>     Show tool schema
 *   mcp-cli grep <pattern>           Search tools by glob pattern
 *   mcp-cli call <server> <tool>     Call tool (reads JSON from stdin if no args)
 *   mcp-cli call <server> <tool> {}  Call tool with JSON args
 */

import { readFileSync } from 'node:fs';
import { type ConfigAction, configCommand } from './config-command.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_SECONDS,
  ensureConfigExists,
  listServerNames,
  loadConfig,
} from './config.js';
import {
  ErrorCode,
  ambiguousCommandError,
  formatCliError,
  missingArgumentError,
  tooManyArgumentsError,
  unknownOptionError,
  unknownSubcommandError,
} from './errors.js';
import { type RegistryAction, registryCommand } from './registry.js';
import { VERSION } from './version.js';

interface ParsedArgs {
  command:
    | 'list'
    | 'info'
    | 'grep'
    | 'call'
    | 'config'
    | 'registry'
    | 'help'
    | 'version';
  server?: string;
  tool?: string;
  pattern?: string;
  args?: string;
  configAction?: ConfigAction;
  configName?: string;
  configJson?: string;
  registryAction?: RegistryAction;
  registryName?: string;
  registryRunSetup?: boolean;
  withDescriptions: boolean;
  configPath?: string;
}

/**
 * Known subcommands
 */
const SUBCOMMANDS = ['info', 'grep', 'call', 'config', 'registry'] as const;

/**
 * Check if a string looks like a subcommand (not a server name)
 */
function isKnownSubcommand(arg: string): boolean {
  return SUBCOMMANDS.includes(arg as (typeof SUBCOMMANDS)[number]);
}

/**
 * Check if a string looks like it could be an unknown subcommand
 * (common aliases that users might try)
 */
function isPossibleSubcommand(arg: string): boolean {
  const aliases = [
    'run',
    'execute',
    'exec',
    'invoke',
    'list',
    'ls',
    'get',
    'show',
    'describe',
    'search',
    'find',
    'query',
  ];
  return aliases.includes(arg.toLowerCase());
}

/**
 * Parse server/tool from either "server/tool" or "server tool" format
 */
function parseServerTool(args: string[]): { server: string; tool?: string } {
  if (args.length === 0) {
    return { server: '' };
  }

  const first = args[0];

  // Check for slash format: server/tool
  if (first.includes('/')) {
    const slashIndex = first.indexOf('/');
    return {
      server: first.substring(0, slashIndex),
      tool: first.substring(slashIndex + 1) || undefined,
    };
  }

  // Space format: server tool
  return {
    server: first,
    tool: args[1],
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'info',
    withDescriptions: false,
    registryRunSetup: true,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.command = 'help';
        return result;

      case '-v':
      case '--version':
        result.command = 'version';
        return result;

      case '-d':
      case '--with-descriptions':
        result.withDescriptions = true;
        break;

      case '-c':
      case '--config':
        result.configPath = args[++i];
        if (!result.configPath) {
          console.error(
            formatCliError(missingArgumentError('-c/--config', 'path')),
          );
          process.exit(ErrorCode.CLIENT_ERROR);
        }
        break;

      case '--no-setup':
      case '--skip-setup':
        result.registryRunSetup = false;
        break;

      default:
        // Single '-' is allowed (stdin indicator), but other dash-prefixed args are options
        if (arg.startsWith('-') && arg !== '-') {
          console.error(formatCliError(unknownOptionError(arg)));
          process.exit(ErrorCode.CLIENT_ERROR);
        }
        positional.push(arg);
    }
  }

  // No positional args = list all servers
  if (positional.length === 0) {
    result.command = 'list';
    return result;
  }

  const firstArg = positional[0];

  // =========================================================================
  // Explicit subcommand routing
  // =========================================================================

  if (firstArg === 'info') {
    result.command = 'info';
    const remaining = positional.slice(1);
    const { server, tool } = parseServerTool(remaining);

    // info requires a server argument - show available servers in error
    if (!server) {
      // Try to load config synchronously to show available servers
      let availableServers: string[] = [];
      const configPaths = [
        result.configPath,
        process.env.MCP_CONFIG_PATH,
        './mcp_servers.json',
        `${process.env.HOME}/.mcp_servers.json`,
        `${process.env.HOME}/.config/mcp/mcp_servers.json`,
      ].filter(Boolean) as string[];

      for (const cfgPath of configPaths) {
        try {
          const content = readFileSync(cfgPath, 'utf-8');
          const config = JSON.parse(content);
          if (config.mcpServers) {
            availableServers = Object.keys(config.mcpServers);
            break;
          }
        } catch {
          // Try next path
        }
      }

      const serverList =
        availableServers.length > 0
          ? availableServers.join(', ')
          : '(none found)';

      console.error(
        'Error [MISSING_ARGUMENT]: Missing required argument for info: server',
      );
      console.error(`  Available servers: ${serverList}`);
      console.error(
        `  Suggestion: Use 'pibo mcp info <server>' to see server details, or just 'pibo mcp' to list all`,
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    result.server = server;
    result.tool = tool;
    return result;
  }

  if (firstArg === 'config') {
    const action = positional[1] ?? 'help';
    result.command = 'config';

    switch (action) {
      case 'help':
      case 'init':
      case 'path':
      case 'show':
        result.configAction = action;
        return result;

      case 'add':
        result.configAction = 'add';
        result.configName = positional[2];
        result.configJson = positional.slice(3).join(' ') || undefined;
        return result;

      case 'remove':
      case 'rm':
        result.configAction = 'remove';
        result.configName = positional[2];
        return result;

      default:
        console.error(formatCliError(unknownSubcommandError(`config ${action}`)));
        process.exit(ErrorCode.CLIENT_ERROR);
    }
  }

  if (firstArg === 'registry') {
    const action = positional[1] ?? 'help';
    result.command = 'registry';

    switch (action) {
      case 'help':
      case 'list':
        result.registryAction = action;
        return result;

      case 'show':
      case 'install':
      case 'doctor':
      case 'remove':
      case 'rm':
        result.registryAction = action === 'rm' ? 'remove' : action;
        result.registryName = positional[2];
        return result;

      default:
        console.error(formatCliError(unknownSubcommandError(`registry ${action}`)));
        process.exit(ErrorCode.CLIENT_ERROR);
    }
  }

  if (firstArg === 'grep') {
    result.command = 'grep';
    result.pattern = positional[1];
    if (!result.pattern) {
      console.error(formatCliError(missingArgumentError('grep', 'pattern')));
      process.exit(ErrorCode.CLIENT_ERROR);
    }
    if (positional.length > 2) {
      console.error(
        formatCliError(tooManyArgumentsError('grep', positional.length - 1, 1)),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }
    return result;
  }

  if (firstArg === 'call') {
    result.command = 'call';
    const remaining = positional.slice(1);

    if (remaining.length === 0) {
      console.error(
        formatCliError(missingArgumentError('call', 'server and tool')),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    // Parse server/tool from remaining args
    const { server, tool } = parseServerTool(remaining);
    result.server = server;

    if (!tool) {
      // Check if it was slash format without tool
      if (remaining[0].includes('/') && !remaining[0].split('/')[1]) {
        console.error(formatCliError(missingArgumentError('call', 'tool')));
        process.exit(ErrorCode.CLIENT_ERROR);
      }
      // Space format with only server
      if (remaining.length < 2) {
        console.error(formatCliError(missingArgumentError('call', 'tool')));
        process.exit(ErrorCode.CLIENT_ERROR);
      }
    }

    result.tool = tool;

    // Determine where args start
    let argsStartIndex: number;
    if (remaining[0].includes('/')) {
      // slash format: call server/tool '{}' → args at index 1
      argsStartIndex = 1;
    } else {
      // space format: call server tool '{}' → args at index 2
      argsStartIndex = 2;
    }

    // Collect remaining args as JSON (support '-' for stdin)
    const jsonArgs = remaining.slice(argsStartIndex);
    if (jsonArgs.length > 0) {
      const argsValue = jsonArgs.join(' ');
      result.args = argsValue === '-' ? undefined : argsValue;
    }

    return result;
  }

  // =========================================================================
  // Check for unknown subcommand (common aliases)
  // =========================================================================

  if (isPossibleSubcommand(firstArg)) {
    console.error(formatCliError(unknownSubcommandError(firstArg)));
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  // =========================================================================
  // Slash format without subcommand → error (require explicit subcommand)
  // =========================================================================

  if (firstArg.includes('/')) {
    const parts = firstArg.split('/');
    const serverName = parts[0];
    const toolName = parts[1] || '';
    const hasArgs = positional.length > 1;
    console.error(
      formatCliError(ambiguousCommandError(serverName, toolName, hasArgs)),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  // =========================================================================
  // Ambiguous command detection: server tool without subcommand
  // =========================================================================

  if (positional.length >= 2) {
    const serverName = positional[0];
    const possibleTool = positional[1];

    // Check if second arg looks like a tool name (not JSON)
    const looksLikeJson =
      possibleTool.startsWith('{') || possibleTool.startsWith('[');
    const looksLikeToolName = /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(possibleTool);

    if (!looksLikeJson && looksLikeToolName) {
      const hasArgs = positional.length > 2;
      console.error(
        formatCliError(
          ambiguousCommandError(serverName, possibleTool, hasArgs),
        ),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }
  }

  // =========================================================================
  // Default: single server name → info
  // =========================================================================

  result.command = 'info';
  result.server = firstArg;
  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
pibo mcp (mcp-cli v${VERSION}) - A lightweight CLI for MCP servers

Usage:
  pibo mcp [options]                              List all servers and tools
  pibo mcp [options] info <server>                Show server details
  pibo mcp [options] info <server> <tool>         Show tool schema
  pibo mcp [options] grep <pattern>               Search tools by glob pattern
  pibo mcp [options] call <server> <tool>         Call tool (reads JSON from stdin if no args)
  pibo mcp [options] call <server> <tool> <json>  Call tool with JSON arguments
  pibo mcp [options] config <action>              Manage MCP server config
  pibo mcp [options] registry <action>            Install built-in MCP server presets

Formats (both work):
  pibo mcp info server tool                       Space-separated
  pibo mcp info server/tool                       Slash-separated
  pibo mcp call server tool '{}'                  Space-separated
  pibo mcp call server/tool '{}'                  Slash-separated

Config:
  pibo mcp config init                            Create mcp_servers.json if missing
  pibo mcp config help                            Show config schema and examples
  pibo mcp config add <name> <json>               Add or replace a server
  pibo mcp config remove <name>                   Remove a server
  pibo mcp registry list                          List built-in presets
  pibo mcp registry show <name>                   Show preset details
  pibo mcp registry doctor <name>                 Check runtime prerequisites
  pibo mcp registry install <name>                Install setup deps and add preset
  pibo mcp registry remove <name>                 Remove preset config and runtime

Options:
  -h, --help               Show this help message
  -v, --version            Show version number
  -d, --with-descriptions  Include tool descriptions
  -c, --config <path>      Path to mcp_servers.json config file
  --no-setup               Skip registry setup commands during install

Output:
  pibo mcp/info/grep       Human-readable text to stdout
  call                     Raw JSON to stdout (for piping)
  Errors                   Always to stderr

Examples:
  pibo mcp                                      # List all servers
  pibo mcp -d                                   # List with descriptions
  pibo mcp grep "*file*"                        # Search for file tools
  pibo mcp info filesystem                      # Show server tools
  pibo mcp info filesystem read_file            # Show tool schema
  pibo mcp call filesystem read_file '{}'       # Call tool
  cat input.json | pibo mcp call server tool    # Read from stdin (no '-' needed)
  pibo mcp config help                          # Show config file schema
  pibo mcp registry list                        # List bundled MCP presets

Environment Variables:
  MCP_NO_DAEMON=1        Disable connection caching (force fresh connections)
  MCP_DAEMON_TIMEOUT=N   Set daemon idle timeout in seconds (default: 60)

Config File:
  The CLI looks for mcp_servers.json in:
    1. Path specified by MCP_CONFIG_PATH or -c/--config
    2. ./mcp_servers.json (current directory)
    3. ~/.mcp_servers.json
    4. ~/.config/mcp/mcp_servers.json
`);
}

/**
 * Build target string from server and tool
 */
function buildTarget(server?: string, tool?: string): string {
  if (!server) return '';
  if (!tool) return server;
  return `${server}/${tool}`;
}

/**
 * Main entry point
 */
export async function runMcpCli(argv = process.argv): Promise<void> {
  try {
    const args = parseArgs(argv.slice(2));

    switch (args.command) {
      case 'help':
        printHelp();
        break;

      case 'version':
        console.log(`pibo mcp (mcp-cli v${VERSION})`);
        break;

      case 'list':
        await ensureConfigExists(args.configPath);
        {
          const { listCommand } = await import('./commands/list.js');
          await listCommand({
            withDescriptions: args.withDescriptions,
            configPath: args.configPath,
          });
        }
        break;

      case 'info':
        await ensureConfigExists(args.configPath);
        {
          const { infoCommand } = await import('./commands/info.js');
          // info always has a server (validated in parseArgs)
          await infoCommand({
            target: buildTarget(args.server, args.tool),
            withDescriptions: args.withDescriptions,
            configPath: args.configPath,
          });
        }
        break;

      case 'grep':
        await ensureConfigExists(args.configPath);
        {
          const { grepCommand } = await import('./commands/grep.js');
          await grepCommand({
            pattern: args.pattern ?? '',
            withDescriptions: args.withDescriptions,
            configPath: args.configPath,
          });
        }
        break;

      case 'call':
        await ensureConfigExists(args.configPath);
        {
          const { callCommand } = await import('./commands/call.js');
          await callCommand({
            target: buildTarget(args.server, args.tool),
            args: args.args,
            configPath: args.configPath,
          });
        }
        break;

      case 'config':
        await configCommand({
          action: args.configAction ?? 'help',
          name: args.configName,
          serverJson: args.configJson,
          configPath: args.configPath,
        });
        break;

      case 'registry':
        await registryCommand({
          action: args.registryAction ?? 'help',
          name: args.registryName,
          configPath: args.configPath,
          runSetup: args.registryRunSetup,
        });
        break;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = ErrorCode.CLIENT_ERROR;
  }
}

export { VERSION as MCP_CLI_VERSION } from './version.js';
