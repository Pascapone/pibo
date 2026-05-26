import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, formatCliError } from '../cli-errors.js';
import {
  detectDesktopEnv,
  getDesktopProcessEnv,
  hasDesktopDisplay,
  printDesktopEnvStatus,
  printLinuxVirtualDisplayHint,
} from './desktop-env.js';

export interface ToolNpmRuntimeSpec {
  type: 'npm';
  packageName: string;
  executableName: string;
  homeEnvVar?: string;
  postInstallArgs?: string[];
}

export interface ToolNpmRuntimePaths {
  rootDir: string;
  homeDir: string;
  nodeDir: string;
  binDir: string;
  executablePath: string;
}

interface CommandResult {
  ok: boolean;
  output: string;
}

function getPiboHome(): string {
  return process.env.PIBO_HOME || join(homedir(), '.pibo');
}

export function getToolNpmRuntimePaths(name: string, spec: ToolNpmRuntimeSpec): ToolNpmRuntimePaths {
  const rootDir = join(getPiboHome(), 'tools', name);
  const homeDir = join(rootDir, 'home');
  const nodeDir = join(rootDir, 'node');
  const binDir = join(nodeDir, 'node_modules', '.bin');
  const executable = process.platform === 'win32' ? `${spec.executableName}.cmd` : spec.executableName;
  return {
    rootDir,
    homeDir,
    nodeDir,
    binDir,
    executablePath: join(binDir, executable),
  };
}

export function getToolNpmRuntimeEnv(paths: ToolNpmRuntimePaths, spec: ToolNpmRuntimeSpec): NodeJS.ProcessEnv {
  const env = { ...process.env, ...getDesktopProcessEnv() };
  env.PATH = `${join(paths.homeDir, 'bin')}:${paths.binDir}:${env.PATH ?? ''}`;
  if (spec.homeEnvVar) env[spec.homeEnvVar] = paths.homeDir;
  return env;
}

function runBuffered(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => resolve({ ok: false, output: error.message }));
    child.on('close', (code) => {
      resolve({ ok: code === 0, output: Buffer.concat(chunks).toString('utf-8').trim() });
    });
  });
}

function runInheritedNpmCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', (error) => {
      reject(
        new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'CLI_TOOL_COMMAND_FAILED',
            message: `Failed to run command: ${command}`,
            details: error.message,
            suggestion: 'Install Node.js and npm first, then rerun the command.',
          }),
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'CLI_TOOL_COMMAND_FAILED',
            message: `Command failed with exit code ${code ?? 'unknown'}`,
            details: `${command} ${args.join(' ')}`,
            suggestion: 'Fix the npm setup error above, then rerun the install command.',
          }),
        ),
      );
    });
  });
}

async function ensureNodeAndNpm(): Promise<void> {
  const node = await runBuffered('node', ['--version']);
  const npm = await runBuffered('npm', ['--version']);
  if (!node.ok || !npm.ok) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_NPM_MISSING',
        message: 'node or npm was not found on PATH',
        details: `node: ${node.output || 'missing'}; npm: ${npm.output || 'missing'}`,
        suggestion: 'Install Node.js and npm, then rerun the install command.',
      }),
    );
  }
}

export async function installToolNpmRuntime(name: string, spec: ToolNpmRuntimeSpec): Promise<ToolNpmRuntimePaths> {
  await ensureNodeAndNpm();
  const paths = getToolNpmRuntimePaths(name, spec);
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.homeDir, { recursive: true });
  await mkdir(paths.nodeDir, { recursive: true });
  const packageJsonPath = join(paths.nodeDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    await writeFile(packageJsonPath, `${JSON.stringify({ private: true, name: `pibo-tool-${name}` }, null, 2)}\n`);
  }
  await runInheritedNpmCommand('npm', ['install', '--prefix', paths.nodeDir, spec.packageName]);
  if (spec.postInstallArgs?.length) {
    await runInheritedNpmCommand(paths.executablePath, spec.postInstallArgs, getToolNpmRuntimeEnv(paths, spec));
  }
  return paths;
}

export async function removeToolNpmRuntime(name: string, spec: ToolNpmRuntimeSpec): Promise<void> {
  const paths = getToolNpmRuntimePaths(name, spec);
  await rm(paths.rootDir, { recursive: true, force: true });
  console.log(`Removed runtime: ${paths.rootDir}`);
}

export async function printToolNpmRuntimeDoctor(name: string, spec: ToolNpmRuntimeSpec): Promise<void> {
  const paths = getToolNpmRuntimePaths(name, spec);
  const node = await runBuffered('node', ['--version']);
  const npm = await runBuffered('npm', ['--version']);

  console.log(`${name}`);
  console.log(`  node: ${node.ok ? node.output || 'ok' : `missing (${node.output})`}`);
  console.log(`  npm: ${npm.ok ? npm.output || 'ok' : `missing (${npm.output})`}`);
  console.log(`  package: ${spec.packageName}`);
  console.log(`  runtime: ${paths.rootDir}`);
  console.log(`  home: ${paths.homeDir}`);
  console.log(`  node modules: ${existsSync(join(paths.nodeDir, 'node_modules')) ? 'present' : 'missing'}`);
  console.log(`  executable: ${existsSync(paths.executablePath) ? paths.executablePath : 'missing'}`);
  printDesktopEnvStatus('  ');
  if (name === 'agent-browser' && process.platform === 'linux' && !hasDesktopDisplay(detectDesktopEnv())) {
    printLinuxVirtualDisplayHint('  ');
  }

  if (existsSync(paths.executablePath)) {
    const doctorExecutablePath = name === 'agent-browser' && existsSync(join(paths.homeDir, 'bin', 'agent-browser'))
      ? join(paths.homeDir, 'bin', 'agent-browser')
      : paths.executablePath;
    const doctor = await runBuffered(doctorExecutablePath, ['doctor', '--offline', '--quick'], getToolNpmRuntimeEnv(paths, spec));
    console.log(`  tool doctor: ${doctor.ok ? 'ok' : 'failed'}`);
    if (doctor.output) console.log(doctor.output.split('\n').map((line) => `    ${line}`).join('\n'));
  }

  if (!node.ok || !npm.ok) {
    console.log('');
    console.log('Install Node.js and npm first, then rerun:');
    console.log(`  pibo tools doctor ${name}`);
  }
}
