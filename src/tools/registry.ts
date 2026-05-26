import { existsSync } from 'node:fs';
import { ensureAgentBrowserWrapper } from './agent-browser-wrapper.js';
import { detectDesktopEnv, hasDesktopDisplay, printDesktopEnvStatus, printLinuxVirtualDisplayHint } from './desktop-env.js';
import { type ToolGuide, AGENT_BROWSER_GUIDE, BROWSER_USE_GUIDE, RALPH_GUIDE, REMOTE_BROWSER_GUIDE } from './guides.js';
import { ensureLinuxVirtualDisplay } from './linux-virtual-display.js';
import {
  type ToolNpmRuntimeSpec,
  getToolNpmRuntimePaths,
  installToolNpmRuntime,
  printToolNpmRuntimeDoctor,
  removeToolNpmRuntime,
} from './npm-runtime.js';
import {
  type ToolPythonRuntimeSpec,
  getToolPythonRuntimePaths,
  installToolPythonRuntime,
  runInheritedCommand,
  printToolPythonRuntimeDoctor,
  removeToolPythonRuntime,
} from './python-runtime.js';

export type CliToolRuntimeSpec = (ToolPythonRuntimeSpec & { type?: 'python' }) | ToolNpmRuntimeSpec;

export interface CliToolEntry {
  name: string;
  description: string;
  kind?: 'python' | 'npm' | 'internal';
  runtime?: CliToolRuntimeSpec;
  guides: readonly ToolGuide[];
  notes: readonly string[];
  agentContextSnippet: string;
}

export interface CliToolStatus {
  entry: CliToolEntry;
  installed: boolean;
  executablePath: string;
  rootDir: string;
  homeDir: string;
}

export interface InstalledCliToolAgentContext {
  name: string;
  description: string;
  snippet: string;
}

const MAX_AGENT_CONTEXT_SNIPPET_LENGTH = 480;
const INSTALLED_TOOLS_CONTEXT_PATH = '.pibo/context/installed-pibo-tools.md';

const REGISTRY: CliToolEntry[] = [
  {
    name: 'browser-use',
    description: 'Browser automation CLI for web interaction, screenshots, and extraction.',
    runtime: {
      packageName: 'browser-use[cli]==0.12.6',
      executableName: 'browser-use',
      pythonVersion: '3.12',
      homeEnvVar: 'BROWSER_USE_HOME',
    },
    guides: [BROWSER_USE_GUIDE, REMOTE_BROWSER_GUIDE],
    notes: [
      'Installed on demand into an isolated Python virtual environment.',
      'Pinned to browser-use 0.12.6 so the CLI surface matches the bundled guides.',
      'The tool uses BROWSER_USE_HOME under the pibo tool runtime directory.',
      'The pibo tool environment wraps browser-use so new browser sessions default to Pibo-managed persistent PIBo Chrome via CDP; pass --fresh-profile for a temporary profile.',
      'Use pibo tools browser-use lease acquire for isolated authenticated browser slots when multiple agents need Chat Web App access.',
      'Guides are available through pibo tools guide and are not loaded into pibo profiles automatically.',
    ],
    agentContextSnippet: [
      'Browser automation CLI for frontend development and web testing.',
      'Start in one persistent shell with `eval "$(npm run --silent dev -- tools env browser-use)"`.',
      'For authenticated Pibo Chat Web App testing, prefer `eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"`.',
      'Discover details with `npm run dev -- tools show browser-use` and `npm run dev -- tools guide browser-use browser-use`.',
    ].join('\n'),
  },
  {
    name: 'agent-browser',
    description: 'Fast native browser automation CLI for AI agents.',
    kind: 'npm',
    runtime: {
      type: 'npm',
      packageName: 'agent-browser@0.27.0',
      executableName: 'agent-browser',
      homeEnvVar: 'AGENT_BROWSER_HOME',
    },
    guides: [AGENT_BROWSER_GUIDE],
    notes: [
      'Installed on demand into an isolated npm runtime.',
      'Pinned to agent-browser 0.27.0 so the CLI surface matches the bundled guide.',
      'The Pibo wrapper redirects HOME to AGENT_BROWSER_HOME by default so Agent Browser state stays in the tool home.',
      'The wrapper uses home/profiles/PIBo as the default browser profile for launch commands; pass --fresh-profile or explicit upstream flags to opt out.',
      'Use pibo tools agent-browser lease acquire for isolated authenticated browser slots when multiple agents need Chat Web App access.',
      'Guides are available through pibo tools guide and are not loaded into pibo profiles automatically.',
    ],
    agentContextSnippet: [
      'Browser automation CLI for frontend development and web testing.',
      'Start in one persistent shell with `eval "$(npm run --silent dev -- tools env agent-browser)"`.',
      'For authenticated Pibo Chat Web App testing, prefer `eval "$(npm run --silent dev -- tools agent-browser lease acquire --app pibo-chat --owner "$USER")"`.',
      'Discover details with `npm run dev -- tools show agent-browser` and `npm run dev -- tools guide agent-browser agent-browser`.',
    ].join('\n'),
  },
  {
    name: 'ralph',
    description: 'Pibo-native continuous agent job runner for implementation and debugging loops.',
    kind: 'internal',
    guides: [RALPH_GUIDE],
    notes: [
      'Ralph is built into the pibo CLI; no external runtime installation is required.',
      'Use the current Pibo owner scope and target room/personal context when creating jobs.',
      'Prefer templates for repeatable jobs, and use --json for automation-safe inspection.',
    ],
    agentContextSnippet: [
      'Continuous Pibo agent job runner for implementation/debug loops.',
      'Use `pibo ralph templates`, then create with `pibo ralph add --template <id> --owner-scope <scope> --room <room-id> --start`.',
      'Inspect/control with `pibo ralph list --json`, `runs --job <id> --json`, `stop <id>`, `cancel <id>`.',
      'Guide: `pibo tools guide ralph ralph`.',
    ].join('\n'),
  },
];

for (const entry of REGISTRY) {
  const snippet = entry.agentContextSnippet.trim();
  if (snippet.length === 0) {
    throw new Error(`CLI tool "${entry.name}" is missing agentContextSnippet`);
  }
  if (snippet.length > MAX_AGENT_CONTEXT_SNIPPET_LENGTH) {
    throw new Error(
      `CLI tool "${entry.name}" agentContextSnippet exceeds ${MAX_AGENT_CONTEXT_SNIPPET_LENGTH} characters`,
    );
  }
}

export function listCliToolEntries(): readonly CliToolEntry[] {
  return REGISTRY;
}

export function findCliToolEntry(name: string): CliToolEntry | undefined {
  return REGISTRY.find((entry) => entry.name === name);
}

export function getCliToolStatus(entry: CliToolEntry): CliToolStatus {
  if (entry.kind === 'internal') {
    return {
      entry,
      installed: true,
      executablePath: `pibo ${entry.name}`,
      rootDir: '',
      homeDir: '',
    };
  }
  if (!entry.runtime) throw new Error(`CLI tool "${entry.name}" is missing runtime`);
  const paths = entry.runtime.type === 'npm'
    ? getToolNpmRuntimePaths(entry.name, entry.runtime)
    : getToolPythonRuntimePaths(entry.name, entry.runtime);
  return {
    entry,
    installed: existsSync(paths.executablePath),
    executablePath: paths.executablePath,
    rootDir: paths.rootDir,
    homeDir: paths.homeDir,
  };
}

export function findToolGuide(entry: CliToolEntry, guideName: string): ToolGuide | undefined {
  return entry.guides.find((guide) => guide.name === guideName);
}

export function listInstalledCliToolAgentContexts(): InstalledCliToolAgentContext[] {
  return REGISTRY
    .filter((entry) => getCliToolStatus(entry).installed)
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
      snippet: entry.agentContextSnippet,
    }));
}

export function getInstalledCliToolContextFile(): { path: string; content: string } | undefined {
  const installedEntries = listInstalledCliToolAgentContexts();
  if (installedEntries.length === 0) return undefined;

  const sections = installedEntries.flatMap((entry) => [
    `## ${entry.name}`,
    entry.snippet,
    '',
  ]);

  return {
    path: INSTALLED_TOOLS_CONTEXT_PATH,
    content: [
      '# Installed Pibo Tools',
      '',
      'These curated CLI tools are installed in this environment. The CLI remains the source of truth; use the referenced commands to discover each workflow step by step.',
      '',
      ...sections,
    ].join('\n').trimEnd(),
  };
}

export async function installCliTool(entry: CliToolEntry, runSetup: boolean): Promise<void> {
  if (entry.kind === 'internal') {
    const status = getCliToolStatus(entry);
    console.log(`Built-in ${entry.name}`);
    console.log(`  executable: ${status.executablePath}`);
    console.log(`  env: no extra environment required`);
    return;
  }
  if (!entry.runtime) throw new Error(`CLI tool "${entry.name}" is missing runtime`);
  if (runSetup) {
    if (entry.name === 'browser-use' || entry.name === 'agent-browser') {
      await ensureLinuxVirtualDisplay({ runInherited: runInheritedCommand });
    }
    if (entry.runtime.type === 'npm') {
      await installToolNpmRuntime(entry.name, entry.runtime);
    } else {
      await installToolPythonRuntime(entry.name, entry.runtime);
    }
  }
  const status = getCliToolStatus(entry);
  if (entry.name === 'agent-browser') ensureAgentBrowserWrapper(status);
  console.log(`${runSetup ? 'Installed' : 'Install target'} ${entry.name}`);
  console.log(`  executable: ${status.executablePath}`);
  console.log(`  home: ${status.homeDir}`);
  printDesktopEnvStatus('  ');
  if ((entry.name === 'browser-use' || entry.name === 'agent-browser') && process.platform === 'linux' && !hasDesktopDisplay(detectDesktopEnv())) {
    printLinuxVirtualDisplayHint('  ');
  }
  console.log(`  env: pibo tools env ${entry.name}`);
}

export async function removeCliTool(entry: CliToolEntry): Promise<void> {
  if (entry.kind === 'internal') {
    console.log(`${entry.name} is built into pibo and cannot be removed separately.`);
    return;
  }
  if (!entry.runtime) throw new Error(`CLI tool "${entry.name}" is missing runtime`);
  if (entry.runtime.type === 'npm') {
    await removeToolNpmRuntime(entry.name, entry.runtime);
  } else {
    await removeToolPythonRuntime(entry.name, entry.runtime);
  }
}

export async function doctorCliTool(entry: CliToolEntry): Promise<void> {
  if (entry.kind === 'internal') {
    console.log(`${entry.name}: ok`);
    console.log(`  executable: pibo ${entry.name}`);
    return;
  }
  if (!entry.runtime) throw new Error(`CLI tool "${entry.name}" is missing runtime`);
  if (entry.name === 'agent-browser') ensureAgentBrowserWrapper(getCliToolStatus(entry));
  if (entry.runtime.type === 'npm') {
    await printToolNpmRuntimeDoctor(entry.name, entry.runtime);
  } else {
    await printToolPythonRuntimeDoctor(entry.name, entry.runtime);
  }
}
