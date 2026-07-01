import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
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

export interface ToolPythonRuntimeSpec {
  packageName: string;
  executableName: string;
  pythonVersion: string;
  homeEnvVar?: string;
  postInstallArgs?: string[];
  doctorArgs?: string[];
}

export interface ToolPythonRuntimePaths {
  rootDir: string;
  homeDir: string;
  venvDir: string;
  binDir: string;
  pythonPath: string;
  executablePath: string;
}

interface CommandResult {
  ok: boolean;
  output: string;
}

function getPiboHome(): string {
  return process.env.PIBO_HOME || join(homedir(), '.pibo');
}

export function getToolPythonRuntimePaths(
  name: string,
  spec: ToolPythonRuntimeSpec,
): ToolPythonRuntimePaths {
  const rootDir = join(getPiboHome(), 'tools', name);
  const homeDir = join(rootDir, 'home');
  const venvDir = join(rootDir, '.venv');
  const binDir = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin');
  const executable =
    process.platform === 'win32'
      ? `${spec.executableName}.exe`
      : spec.executableName;

  return {
    rootDir,
    homeDir,
    venvDir,
    binDir,
    pythonPath: join(binDir, process.platform === 'win32' ? 'python.exe' : 'python'),
    executablePath: join(binDir, executable),
  };
}

export function getToolPythonRuntimeEnv(
  paths: ToolPythonRuntimePaths,
  spec: ToolPythonRuntimeSpec,
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...getDesktopProcessEnv() };
  env.PATH = `${paths.binDir}:${join(paths.homeDir, 'bin')}:${env.PATH ?? ''}`;
  if (spec.homeEnvVar) env[spec.homeEnvVar] = paths.homeDir;
  return env;
}

function runBuffered(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      resolve({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        output: Buffer.concat(chunks).toString('utf-8').trim(),
      });
    });
  });
}

function isRootUser(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

async function resolveUvCommand(): Promise<string | undefined> {
  const uv = await runBuffered('uv', ['--version']);
  if (uv.ok) return 'uv';

  const localUv = join(homedir(), '.local', 'bin', 'uv');
  if (existsSync(localUv)) {
    const local = await runBuffered(localUv, ['--version']);
    if (local.ok) return localUv;
  }

  if (process.platform === 'linux' && isRootUser()) {
    console.log('uv was not found on PATH. Installing uv automatically.');
    await runInheritedCommand('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
    const installed = await runBuffered(localUv, ['--version'], {
      ...process.env,
      PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}`,
    });
    if (installed.ok) return localUv;
  }

  return undefined;
}

export function runInheritedCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
    });

    child.on('error', (error) => {
      reject(
        new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'CLI_TOOL_COMMAND_FAILED',
            message: `Failed to run command: ${command}`,
            details: error.message,
            suggestion: 'Install uv first, then rerun the command.',
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
            suggestion: 'Fix the setup error above, then rerun the install command.',
          }),
        ),
      );
    });
  });
}

export async function printToolPythonRuntimeDoctor(
  name: string,
  spec: ToolPythonRuntimeSpec,
): Promise<void> {
  const paths = getToolPythonRuntimePaths(name, spec);
  const uvCommand = await resolveUvCommand();
  const uv = uvCommand ? await runBuffered(uvCommand, ['--version']) : { ok: false, output: 'missing' };
  const python = uv.ok
    ? await runBuffered(uvCommand!, ['python', 'find', spec.pythonVersion])
    : { ok: false, output: 'skipped because uv is missing' };

  console.log(`${name}`);
  console.log(`  uv: ${uv.ok ? uv.output || 'ok' : `missing (${uv.output})`}`);
  console.log(
    `  python ${spec.pythonVersion}: ${python.ok ? python.output || 'ok' : `missing (${python.output})`}`,
  );
  console.log(`  runtime: ${paths.rootDir}`);
  console.log(`  home: ${paths.homeDir}`);
  console.log(`  venv: ${existsSync(paths.venvDir) ? 'present' : 'missing'}`);
  console.log(`  executable: ${existsSync(paths.executablePath) ? paths.executablePath : 'missing'}`);
  printDesktopEnvStatus('  ');
  if (name === 'browser-use' && process.platform === 'linux' && !hasDesktopDisplay(detectDesktopEnv())) {
    printLinuxVirtualDisplayHint('  ');
  }

  if (existsSync(paths.executablePath) && spec.doctorArgs?.length) {
    const doctor = await runBuffered(paths.executablePath, spec.doctorArgs, getToolPythonRuntimeEnv(paths, spec));
    console.log(`  tool doctor: ${doctor.ok ? 'ok' : 'failed'}`);
    if (doctor.output) {
      console.log(doctor.output.split('\n').map((line) => `    ${line}`).join('\n'));
    }
  }

  if (!uv.ok) {
    console.log('');
    console.log('Install uv first:');
    console.log('  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh');
    console.log('  Windows PowerShell: irm https://astral.sh/uv/install.ps1 | iex');
  }

  if (uv.ok && !python.ok) {
    console.log('');
    console.log(`Install Python ${spec.pythonVersion}+ first:`);
    console.log('  Ubuntu/Debian: sudo apt update && sudo apt install -y python3 python3-venv');
    console.log('  macOS: brew install python');
    console.log('  Windows PowerShell: winget install Python.Python.3.12');
    console.log('');
    console.log('Then rerun:');
    console.log(`  pibo tools doctor ${name}`);
  }
}

export async function installToolPythonRuntime(
  name: string,
  spec: ToolPythonRuntimeSpec,
): Promise<ToolPythonRuntimePaths> {
  const uvCommand = await resolveUvCommand();
  if (!uvCommand) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_UV_MISSING',
        message: 'uv was not found on PATH',
        details: 'spawn uv ENOENT',
        suggestion:
          'Install uv first. macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh. Windows PowerShell: irm https://astral.sh/uv/install.ps1 | iex.',
      }),
    );
  }

  const paths = getToolPythonRuntimePaths(name, spec);
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.homeDir, { recursive: true });

  if (!existsSync(paths.venvDir)) {
    await runInheritedCommand(uvCommand, ['venv', paths.venvDir, '--python', spec.pythonVersion]);
  }
  await runInheritedCommand(uvCommand, [
    'pip',
    'install',
    '--python',
    paths.pythonPath,
    spec.packageName,
  ]);

  if (spec.postInstallArgs?.length) {
    await runInheritedCommand(paths.executablePath, spec.postInstallArgs, getToolPythonRuntimeEnv(paths, spec));
  }

  return paths;
}

export async function removeToolPythonRuntime(
  name: string,
  spec: ToolPythonRuntimeSpec,
): Promise<void> {
  const paths = getToolPythonRuntimePaths(name, spec);
  await rm(paths.rootDir, { recursive: true, force: true });
  console.log(`Removed runtime: ${paths.rootDir}`);
}
