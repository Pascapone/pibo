import { existsSync } from 'node:fs';
import { type ToolGuide, BROWSER_USE_GUIDE, REMOTE_BROWSER_GUIDE } from './guides.js';
import {
  type ToolPythonRuntimeSpec,
  getToolPythonRuntimePaths,
  installToolPythonRuntime,
  printToolPythonRuntimeDoctor,
  removeToolPythonRuntime,
} from './python-runtime.js';

export interface CliToolEntry {
  name: string;
  description: string;
  runtime: ToolPythonRuntimeSpec;
  guides: readonly ToolGuide[];
  notes: readonly string[];
}

export interface CliToolStatus {
  entry: CliToolEntry;
  installed: boolean;
  executablePath: string;
  rootDir: string;
  homeDir: string;
}

const REGISTRY: CliToolEntry[] = [
  {
    name: 'browser-use',
    description: 'Browser automation CLI for web interaction, screenshots, and extraction.',
    runtime: {
      packageName: 'browser-use[cli]',
      executableName: 'browser-use',
      pythonVersion: '3.12',
      homeEnvVar: 'BROWSER_USE_HOME',
    },
    guides: [BROWSER_USE_GUIDE, REMOTE_BROWSER_GUIDE],
    notes: [
      'Installed on demand into an isolated Python virtual environment.',
      'The tool uses BROWSER_USE_HOME under the pibo tool runtime directory.',
      'Guides are available through pibo tools guide and are not loaded into pibo profiles automatically.',
    ],
  },
];

export function listCliToolEntries(): readonly CliToolEntry[] {
  return REGISTRY;
}

export function findCliToolEntry(name: string): CliToolEntry | undefined {
  return REGISTRY.find((entry) => entry.name === name);
}

export function getCliToolStatus(entry: CliToolEntry): CliToolStatus {
  const paths = getToolPythonRuntimePaths(entry.name, entry.runtime);
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

export async function installCliTool(entry: CliToolEntry, runSetup: boolean): Promise<void> {
  if (runSetup) {
    await installToolPythonRuntime(entry.name, entry.runtime);
  }
  const status = getCliToolStatus(entry);
  console.log(`${runSetup ? 'Installed' : 'Install target'} ${entry.name}`);
  console.log(`  executable: ${status.executablePath}`);
  console.log(`  home: ${status.homeDir}`);
}

export async function removeCliTool(entry: CliToolEntry): Promise<void> {
  await removeToolPythonRuntime(entry.name, entry.runtime);
}

export async function doctorCliTool(entry: CliToolEntry): Promise<void> {
  await printToolPythonRuntimeDoctor(entry.name, entry.runtime);
}
