import { type ServerConfig } from './config.js';
import { configCommand } from './config-command.js';
import { ErrorCode, formatCliError } from './errors.js';
import {
  type PythonRuntimeSpec,
  getPythonRuntimePaths,
  installPythonRuntime,
  printPythonRuntimeDoctor,
  removePythonRuntime,
} from './python-runtime.js';

export type RegistryAction = 'help' | 'list' | 'show' | 'doctor' | 'install' | 'remove';

export interface RegistryCommandOptions {
  action: RegistryAction;
  name?: string;
  configPath?: string;
  runSetup?: boolean;
}

interface RegistryEntry {
  name: string;
  description: string;
  runtime: PythonRuntimeSpec;
  serverArgs: string[];
  serverEnv?: Record<string, string>;
  notes: string[];
}

const REGISTRY: RegistryEntry[] = [];

function findRegistryEntry(name: string): RegistryEntry | undefined {
  return REGISTRY.find((entry) => entry.name === name);
}

function buildServerConfig(entry: RegistryEntry): ServerConfig {
  const paths = getPythonRuntimePaths(entry.name, entry.runtime);

  return {
    command: paths.executablePath,
    args: entry.serverArgs,
    ...(entry.serverEnv ? { env: entry.serverEnv } : {}),
  };
}

function printRegistryHelp(): void {
  console.log(`
MCP server registry

Commands:
  pibo mcp registry list                         List built-in MCP server presets
  pibo mcp registry show <name>                  Show one preset
  pibo mcp registry doctor <name>                Check runtime prerequisites
  pibo mcp registry install <name>               Install setup deps and add preset to mcp_servers.json
  pibo mcp registry install <name> --no-setup    Only add preset to mcp_servers.json
  pibo mcp registry remove <name>                Remove config and local runtime
  pibo mcp registry help                         Show this help

Examples:
  pibo mcp registry list
  pibo mcp registry show <name>
  pibo mcp registry doctor <name>
  pibo mcp registry install <name>
`);
}

function printEntry(entry: RegistryEntry): void {
  const paths = getPythonRuntimePaths(entry.name, entry.runtime);

  console.log(`${entry.name}`);
  console.log(`  ${entry.description}`);
  console.log('');
  console.log('Runtime:');
  console.log(`  package: ${entry.runtime.packageName}`);
  console.log(`  python: ${entry.runtime.pythonVersion}`);
  console.log(`  path: ${paths.rootDir}`);
  console.log('');
  console.log('Server config:');
  console.log(JSON.stringify(buildServerConfig(entry), null, 2));

  if (entry.notes.length > 0) {
    console.log('');
    console.log('Notes:');
    for (const note of entry.notes) {
      console.log(`  - ${note}`);
    }
  }
}

async function installEntry(
  entry: RegistryEntry,
  options: RegistryCommandOptions,
): Promise<void> {
  if (options.runSetup !== false) {
    await installPythonRuntime(entry.name, entry.runtime);
  }

  await configCommand({
    action: 'add',
    name: entry.name,
    serverJson: JSON.stringify(buildServerConfig(entry)),
    configPath: options.configPath,
  });
}

export async function registryCommand(options: RegistryCommandOptions): Promise<void> {
  if (options.action === 'help') {
    printRegistryHelp();
    return;
  }

  if (options.action === 'list') {
    if (REGISTRY.length === 0) {
      console.log('No registry entries are currently bundled.');
      return;
    }

    for (const entry of REGISTRY) {
      console.log(`${entry.name}\t${entry.description}`);
    }
    return;
  }

  if (!options.name) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MISSING_ARGUMENT',
        message: `registry ${options.action} requires <name>`,
        suggestion: 'Run pibo mcp registry list to see available presets.',
      }),
    );
  }

  const entry = findRegistryEntry(options.name);
  if (!entry) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'MCP_REGISTRY_ENTRY_NOT_FOUND',
        message: `Registry entry "${options.name}" not found`,
        details:
          REGISTRY.length > 0
            ? `Available entries: ${REGISTRY.map((item) => item.name).join(', ')}`
            : 'No registry entries are currently bundled.',
      }),
    );
  }

  if (options.action === 'show') {
    printEntry(entry);
    return;
  }

  if (options.action === 'doctor') {
    await printPythonRuntimeDoctor(entry.name, entry.runtime);
    return;
  }

  if (options.action === 'install') {
    await installEntry(entry, options);
    return;
  }

  await configCommand({
    action: 'remove',
    name: entry.name,
    configPath: options.configPath,
  });
  await removePythonRuntime(entry.name, entry.runtime);
}
