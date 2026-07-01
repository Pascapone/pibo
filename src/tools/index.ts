import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { ErrorCode, formatCliError } from '../cli-errors.js';
import {
  acquireAgentBrowserLease,
  listAgentBrowserLeases,
  printAgentBrowserAuthTemplateEnv,
  printAgentBrowserAuthTemplatePath,
  reapStaleAgentBrowserLeases,
  releaseAgentBrowserLease,
} from './agent-browser-leases.js';
import { ensureAgentBrowserWrapper } from './agent-browser-wrapper.js';
import {
  acquireBrowserUseLease,
  isExpired,
  listBrowserUseLeases,
  printBrowserUseAuthTemplateEnv,
  printBrowserUseAuthTemplatePath,
  readRegistry,
  reapStaleBrowserUseLeases,
  releaseBrowserUseLease,
} from './browser-use-leases.js';
import {
  formatBrowserUseTargets,
  listBrowserUseCdpTargets,
  normalizeCdpUrlSync,
  printAttachChatExports,
  selectBestChatTarget,
} from './browser-use-cdp.js';
import { ensureBrowserUseWrapper } from './browser-use-wrapper.js';
import {
  browserPoolPaths,
  createEmptyBrowserPoolState,
  loadBrowserPoolState,
  reapIdleBrowserPool,
  type BrowserPoolIdentity,
  type BrowserPoolReapResult,
  type BrowserPoolState,
} from './browser-pool.js';
import { detectDesktopEnv, hasDesktopDisplay } from './desktop-env.js';
import {
  doctorCliTool,
  findCliToolEntry,
  findToolGuide,
  getCliToolStatus,
  installCliTool,
  listCliToolEntries,
  removeCliTool,
  type CliToolStatus,
} from './registry.js';

function requireEntry(name: string) {
  const entry = findCliToolEntry(name);
  if (!entry) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_NOT_FOUND',
        message: `Tool "${name}" not found`,
        details: `Available tools: ${listCliToolEntries().map((item) => item.name).join(', ')}`,
        suggestion: 'Run pibo tools list to see curated tools.',
      }),
    );
  }
  return entry;
}

function printList(installedOnly: boolean): void {
  const rows = listCliToolEntries()
    .map((entry) => getCliToolStatus(entry))
    .filter((status) => !installedOnly || status.installed)
    .map((status) => ({
      name: status.entry.name,
      status: status.installed ? 'installed' : 'available',
      executable: status.installed ? status.executablePath : '',
      description: status.entry.description,
    }));

  if (rows.length === 0) {
    console.log(installedOnly ? 'No cli tools are installed.' : 'No cli tools are currently bundled.');
    return;
  }

  for (const row of rows) {
    const executable = row.executable ? `\t${row.executable}` : '';
    console.log(`${row.name}\t${row.status}\t${row.description}${executable}`);
  }
}

function printShow(name: string): void {
  const entry = requireEntry(name);
  const status = getCliToolStatus(entry);
  console.log(`${entry.name}`);
  console.log(`  ${entry.description}`);
  console.log(`  kind: ${entry.kind === 'internal' ? 'built-in' : 'external'}`);
  if (entry.runtime) console.log(`  package: ${entry.runtime.packageName}`);
  console.log(`  status: ${status.installed ? 'installed' : 'available'}`);
  if (status.rootDir) console.log(`  runtime: ${status.rootDir}`);
  if (status.homeDir) console.log(`  home: ${status.homeDir}`);
  if (entry.name === 'browser-use') {
    const wrapperPath = ensureBrowserUseWrapper(status);
    console.log(`  wrapper: ${wrapperPath ?? 'not generated'}`);
    console.log(`  executable: ${status.executablePath}`);
    console.log('');
    console.log('  IMPORTANT: Always use the wrapper path above, not the raw executable.');
    console.log('  The wrapper manages persistent Chrome profiles and CDP automatically.');
  } else if (entry.name === 'agent-browser') {
    const wrapperPath = ensureAgentBrowserWrapper(status);
    console.log(`  wrapper: ${wrapperPath ?? 'not generated'}`);
    console.log(`  executable: ${status.executablePath}`);
    console.log('');
    console.log('  IMPORTANT: Always use the wrapper path above, not the raw executable.');
    console.log('  The wrapper keeps Agent Browser state under the Pibo tool home.');
  } else {
    console.log(`  executable: ${status.executablePath}`);
  }
  console.log('');
  console.log('Guides:');
  for (const guide of entry.guides) {
    console.log(`  ${guide.name}\t${guide.description}`);
  }
  if (entry.notes.length > 0) {
    console.log('');
    console.log('Notes:');
    for (const note of entry.notes) console.log(`  - ${note}`);
  }
  console.log('');
  console.log('Next:');
  if (entry.kind !== 'internal') console.log(`  pibo tools env ${entry.name}`);
  console.log(`  pibo tools guide ${entry.name} ${entry.guides[0]?.name ?? ''}`.trimEnd());
  if (entry.name === 'browser-use') {
    console.log('  pibo tools browser-use');
  }
  if (entry.name === 'agent-browser') {
    console.log('  pibo tools agent-browser');
  }
  if (entry.name === 'ralph') {
    console.log('  pibo tools ralph');
    console.log('  pibo ralph templates');
  }
}

function printGuides(name: string): void {
  const entry = requireEntry(name);
  for (const guide of entry.guides) {
    console.log(`${guide.name}\t${guide.description}`);
  }
}

function printGuide(name: string, guideName?: string): void {
  const entry = requireEntry(name);
  const selectedGuideName = guideName ?? entry.guides[0]?.name;
  if (!selectedGuideName) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_GUIDE_NOT_FOUND',
        message: `Tool "${name}" has no guides`,
      }),
    );
  }

  const guide = findToolGuide(entry, selectedGuideName);
  if (!guide) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_GUIDE_NOT_FOUND',
        message: `Guide "${selectedGuideName}" not found for tool "${name}"`,
        details: `Available guides: ${entry.guides.map((item) => item.name).join(', ')}`,
      }),
    );
  }
  console.log(guide.content);
}

function printPath(name: string): void {
  const entry = requireEntry(name);
  const status = getCliToolStatus(entry);
  if (entry.name === 'browser-use') {
    const wrapperPath = ensureBrowserUseWrapper(status);
    if (wrapperPath) {
      console.log(wrapperPath);
      return;
    }
  }
  if (entry.name === 'agent-browser') {
    const wrapperPath = ensureAgentBrowserWrapper(status);
    if (wrapperPath) {
      console.log(wrapperPath);
      return;
    }
  }
  console.log(status.executablePath);
}

function printEnv(name: string): void {
  const entry = requireEntry(name);
  const status = getCliToolStatus(entry);
  const desktop = detectDesktopEnv();

  if (entry.kind === 'internal') {
    console.log(`# ${entry.name} is built into pibo; no extra environment is required.`);
    console.log(`# Run: pibo ${entry.name} --help`);
    return;
  }
  if (!entry.runtime) throw new Error(`CLI tool "${entry.name}" is missing runtime`);

  if (process.platform === 'win32') {
    console.log(`$env:PATH = "${status.executablePath.replace(/\\[^\\]+$/, '')};$env:PATH"`);
    if (entry.runtime.homeEnvVar) console.log(`$env:${entry.runtime.homeEnvVar} = "${status.homeDir}"`);
    return;
  }

  const binDir = status.executablePath.replace(/\/[^/]+$/, '');
  const wrapperPath = entry.name === 'browser-use'
    ? ensureBrowserUseWrapper(status)
    : entry.name === 'agent-browser'
      ? ensureAgentBrowserWrapper(status)
      : undefined;
  const envBinDirs = wrapperPath ? `${wrapperPath.replace(/\/[^/]+$/, '')}:${binDir}` : binDir;
  console.log(`export PATH="${envBinDirs}:$PATH"`);
  if (entry.runtime.homeEnvVar) console.log(`export ${entry.runtime.homeEnvVar}="${status.homeDir}"`);
  if (desktop.display) console.log(`export DISPLAY="${desktop.display}"`);
  if (desktop.waylandDisplay) console.log(`export WAYLAND_DISPLAY="${desktop.waylandDisplay}"`);
  if (desktop.xauthority) console.log(`export XAUTHORITY="${desktop.xauthority}"`);
  if (desktop.xdgRuntimeDir) console.log(`export XDG_RUNTIME_DIR="${desktop.xdgRuntimeDir}"`);
  if (desktop.dbusSessionBusAddress) {
    console.log(`export DBUS_SESSION_BUS_ADDRESS="${desktop.dbusSessionBusAddress}"`);
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function printBrowserUseDiscovery(): void {
  console.log(`pibo tools browser-use - browser-use helpers

Start:
  eval "$(pibo tools env browser-use)"

Commands:
  targets                    List Chrome CDP targets with Chat auth hints
  attach-chat                Export the best existing authenticated Chat target
  auth-template path          Print the default authenticated template profile path
  auth-template env           Print shell exports for preparing the auth template profile
  lease acquire               Acquire an isolated authenticated browser slot
  lease list                  List authenticated browser slots
  lease release <id>          Release one browser slot
  lease reap-stale            Release expired or dead browser slots
  pool status                 Show read-only managed browser-pool status
  pool reap                   Reap an idle managed browser pool
  health                      Check browser-use health and report issues

Next:
  pibo tools show browser-use
  pibo tools guide browser-use browser-use
  pibo tools browser-use targets
  pibo tools browser-use auth-template env
  pibo tools browser-use lease acquire
  pibo tools browser-use pool status
  pibo tools browser-use pool reap --json`);
}

interface BrowserPoolStatusOptions {
  workerId?: string;
  poolId?: string;
  root?: string;
  json?: boolean;
}

interface BrowserPoolReapOptions extends BrowserPoolStatusOptions {
  idleTimeoutMs?: number;
}

interface BrowserPoolStatusResult extends BrowserPoolState {
  rootDir: string;
  statePath: string;
  lockPath: string;
  stateFileExists: boolean;
  readOnly: true;
  staleReason?: string;
  dirtyReason?: string;
  nextCommands: string[];
}

function getBrowserPoolStatusIdentity(options: BrowserPoolStatusOptions): BrowserPoolIdentity {
  return {
    workerId: options.workerId || process.env.PIBO_BROWSER_POOL_WORKER_ID || process.env.PIBO_COMPUTE_WORKER_ID || process.env.HOSTNAME || 'local',
    poolId: options.poolId || process.env.PIBO_BROWSER_POOL_ID || 'default',
    maxBrowserProcesses: parsePositiveInteger(process.env.PIBO_BROWSER_POOL_MAX_PROCESSES || '1'),
  };
}

function getBrowserPoolRoot(status: CliToolStatus, options: BrowserPoolStatusOptions): string {
  return options.root || process.env.PIBO_BROWSER_POOL_ROOT || join(process.env.BROWSER_USE_HOME || status.homeDir, 'pibo-browser-pool');
}

function browserPoolStatusNextCommands(state: BrowserPoolState): string[] {
  if (state.state === 'stale' || state.state === 'dirty') {
    return [
      'pibo tools browser-use pool status --json',
      'pibo tools browser-use pool reap --json',
      'pibo tools browser-use health',
      'eval "$(pibo tools env browser-use)" && browser-use --pibo-ensure-chrome',
    ];
  }
  if (state.state === 'empty') {
    return ['eval "$(pibo tools env browser-use)" && browser-use --pibo-ensure-chrome'];
  }
  return ['pibo tools browser-use pool status --json'];
}

async function getBrowserPoolStatus(status: CliToolStatus, options: BrowserPoolStatusOptions): Promise<BrowserPoolStatusResult> {
  const identity = getBrowserPoolStatusIdentity(options);
  const rootDir = getBrowserPoolRoot(status, options);
  const paths = browserPoolPaths(rootDir, identity);
  const stateFileExists = existsSync(paths.statePath);
  let state = await loadBrowserPoolState(paths.statePath, { ...identity, onMissing: 'empty', onMalformed: 'empty' });
  if (!stateFileExists && state.state === 'empty') state = createEmptyBrowserPoolState(identity);
  const staleReason = state.state === 'stale' ? state.lastError || 'Recorded browser is stale' : undefined;
  const dirtyReason = state.state === 'dirty' ? state.lastError || 'Browser pool state is dirty' : undefined;
  return {
    ...state,
    rootDir,
    statePath: paths.statePath,
    lockPath: paths.lockPath,
    stateFileExists,
    readOnly: true,
    staleReason,
    dirtyReason,
    nextCommands: browserPoolStatusNextCommands(state),
  };
}

function printBrowserPoolStatusText(result: BrowserPoolStatusResult): void {
  const stateLabel = result.state === 'ready' ? 'ready (idle)' : result.state;
  console.log(`browser pool status: ${stateLabel}`);
  console.log(`  worker id: ${result.workerId}`);
  console.log(`  pool id: ${result.poolId}`);
  console.log(`  max browser processes: ${result.maxBrowserProcesses}`);
  console.log(`  pid: ${result.pid ?? '-'}`);
  console.log(`  process group id: ${result.processGroupId ?? '-'}`);
  console.log(`  CDP URL: ${result.cdpUrl ?? '-'}`);
  console.log(`  CDP port: ${result.cdpPort ?? '-'}`);
  console.log(`  user-data dir: ${result.userDataDir ?? '-'}`);
  console.log(`  active lease id: ${result.activeLeaseId ?? '-'}`);
  console.log(`  holder: ${result.holder ?? '-'}`);
  console.log(`  last used at: ${result.lastUsedAt ?? '-'}`);
  console.log(`  idle expiry: ${result.idleExpiresAt ?? '-'}`);
  console.log(`  root: ${result.rootDir}`);
  console.log(`  state file: ${result.stateFileExists ? result.statePath : `${result.statePath} (missing)`}`);
  if (result.staleReason || result.dirtyReason || result.lastError) {
    console.log(`  stale/dirty reason: ${result.staleReason || result.dirtyReason || result.lastError}`);
  }
  if (result.state === 'stale' || result.state === 'dirty') {
    console.log('');
    console.log('Next:');
    for (const command of result.nextCommands) console.log(`  ${command}`);
  }
}

async function printBrowserPoolStatus(status: CliToolStatus, options: BrowserPoolStatusOptions): Promise<void> {
  const result = await getBrowserPoolStatus(status, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printBrowserPoolStatusText(result);
}

function browserPoolReapNextCommands(result: BrowserPoolReapResult): string[] {
  if (result.cleanupStatus === 'failed' || result.state.state === 'dirty') {
    return [
      'pibo tools browser-use pool status --json',
      'pibo tools browser-use health',
      'pibo tools browser-use pool reap --json',
    ];
  }
  return ['pibo tools browser-use pool status --json'];
}

async function getBrowserPoolReap(status: CliToolStatus, options: BrowserPoolReapOptions) {
  const identity = getBrowserPoolStatusIdentity(options);
  const rootDir = getBrowserPoolRoot(status, options);
  const paths = browserPoolPaths(rootDir, identity);
  const missingState = !existsSync(paths.statePath);
  const result = missingState
    ? {
      reaped: false,
      eligible: false,
      reason: 'Browser pool has no recorded browser to reap',
      affectedLeases: 0,
      affectedBrowserPools: 0,
      terminatedProcessTrees: 0,
      staleStateFiles: 0,
      cleanupStatus: 'skipped' as const,
      lastError: 'Browser pool has no recorded browser to reap',
      state: createEmptyBrowserPoolState(identity),
    }
    : await reapIdleBrowserPool(paths, identity, { idleTimeoutMs: options.idleTimeoutMs });
  return {
    rootDir,
    statePath: paths.statePath,
    lockPath: paths.lockPath,
    counts: {
      affectedLeases: result.affectedLeases,
      affectedBrowserPools: result.affectedBrowserPools,
      terminatedProcessTrees: result.terminatedProcessTrees,
      staleStateFiles: result.staleStateFiles,
    },
    pools: [{
      workerId: result.state.workerId,
      poolId: result.state.poolId,
      reaped: result.reaped,
      eligible: result.eligible,
      reason: result.reason,
      cleanupStatus: result.cleanupStatus,
      lastError: result.lastError,
      state: result.state,
      terminatedProcessTrees: result.terminatedProcessTrees,
      staleStateFiles: result.staleStateFiles,
      affectedLeases: result.affectedLeases,
    }],
    nextCommands: browserPoolReapNextCommands(result),
  };
}

function printBrowserPoolReapText(result: Awaited<ReturnType<typeof getBrowserPoolReap>>): void {
  const pool = result.pools[0];
  const label = pool.cleanupStatus === 'failed' ? 'failed' : pool.reaped ? 'success' : 'no-op';
  console.log(`browser pool reap: ${label}`);
  console.log(`  worker id: ${pool.workerId}`);
  console.log(`  pool id: ${pool.poolId}`);
  console.log(`  reason: ${pool.reason ?? '-'}`);
  console.log(`  cleanup status: ${pool.cleanupStatus}`);
  console.log(`  affected leases: ${result.counts.affectedLeases}`);
  console.log(`  affected browser pools: ${result.counts.affectedBrowserPools}`);
  console.log(`  terminated process trees: ${result.counts.terminatedProcessTrees}`);
  console.log(`  stale state files: ${result.counts.staleStateFiles}`);
  console.log(`  state file: ${result.statePath}`);
  if (pool.lastError) console.log(`  error: ${pool.lastError}`);
  if (pool.cleanupStatus === 'failed' || pool.state.state === 'dirty') {
    console.log('');
    console.log('Next:');
    for (const command of result.nextCommands) console.log(`  ${command}`);
  }
}

async function printBrowserPoolReap(status: CliToolStatus, options: BrowserPoolReapOptions): Promise<void> {
  const result = await getBrowserPoolReap(status, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printBrowserPoolReapText(result);
}

function findChromeBinary(): string | undefined {
  if (process.env.AGENT_BROWSER_EXECUTABLE_PATH && existsSync(process.env.AGENT_BROWSER_EXECUTABLE_PATH)) {
    return process.env.AGENT_BROWSER_EXECUTABLE_PATH;
  }
  if (process.env.PIBO_BROWSER_USE_CHROME && existsSync(process.env.PIBO_BROWSER_USE_CHROME)) {
    return process.env.PIBO_BROWSER_USE_CHROME;
  }
  const candidates = ['google-chrome', 'chromium', 'chromium-browser', 'chrome'];
  for (const name of candidates) {
    const result = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return undefined;
}

function checkStaleCdpState(homeDir: string): { stalePids: number; stalePorts: number; details: string[] } {
  const stateDir = join(homeDir, 'pibo-cdp');
  if (!existsSync(stateDir)) return { stalePids: 0, stalePorts: 0, details: [] };

  let stalePids = 0;
  let stalePorts = 0;
  const details: string[] = [];

  for (const file of readdirSync(stateDir)) {
    if (file.endsWith('.pid')) {
      const pidPath = join(stateDir, file);
      const text = readFileSync(pidPath, 'utf-8').trim();
      const pid = Number.parseInt(text, 10);
      let isDead = false;
      if (!Number.isFinite(pid) || pid <= 0) {
        isDead = true;
      } else {
        try {
          process.kill(pid, 0);
        } catch {
          isDead = true;
        }
      }
      if (isDead) {
        stalePids += 1;
        details.push(`stale pid file: ${file}`);
      }
    } else if (file.endsWith('.port')) {
      const base = file.slice(0, -5);
      const pidPath = join(stateDir, `${base}.pid`);
      if (!existsSync(pidPath)) {
        stalePorts += 1;
        details.push(`orphan port file: ${file}`);
      }
    }
  }

  return { stalePids, stalePorts, details };
}

async function printAgentBrowserHealth(status: CliToolStatus, json = false): Promise<void> {
  const wrapperPath = join(status.homeDir, 'bin', 'agent-browser');
  const wrapperExists = existsSync(wrapperPath);
  const npmExecutableExists = existsSync(status.executablePath);
  const chromePath = findChromeBinary();
  const desktop = detectDesktopEnv();
  const hasDisplay = hasDesktopDisplay(desktop);
  const nodeVersion = spawnSync('node', ['--version'], { encoding: 'utf-8' });
  const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf-8' });
  const packageJsonPath = join(status.rootDir, 'node', 'node_modules', 'agent-browser', 'package.json');
  let packageVersion: string | undefined;
  try {
    packageVersion = JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version;
  } catch {
    packageVersion = undefined;
  }
  const staleState = checkStaleCdpState(status.homeDir);
  const overall = !wrapperExists || !npmExecutableExists ? 'critical' : staleState.stalePids > 0 || staleState.stalePorts > 0 ? 'degraded' : 'ok';
  const result = {
    overall,
    wrapper: { exists: wrapperExists, path: wrapperPath },
    npmRuntime: { executable: npmExecutableExists, path: status.executablePath, packageVersion },
    node: { ok: nodeVersion.status === 0, version: nodeVersion.stdout.trim() },
    npm: { ok: npmVersion.status === 0, version: npmVersion.stdout.trim() },
    chrome: { found: Boolean(chromePath), path: chromePath },
    display: { available: hasDisplay, display: desktop.display, waylandDisplay: desktop.waylandDisplay },
    staleState: { pidFiles: staleState.stalePids, portFiles: staleState.stalePorts, details: staleState.details },
    nextCommands: ['pibo tools install agent-browser', 'eval "$(pibo tools env agent-browser)"', 'agent-browser doctor --offline --quick'],
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`agent-browser health: ${overall}`);
  console.log(`  wrapper: ${wrapperExists ? 'ok' : 'MISSING'} (${wrapperPath})`);
  console.log(`  executable: ${npmExecutableExists ? 'ok' : 'MISSING'} (${status.executablePath})`);
  console.log(`  package version: ${packageVersion ?? 'unknown'}`);
  console.log(`  node: ${nodeVersion.status === 0 ? nodeVersion.stdout.trim() : 'missing'}`);
  console.log(`  npm: ${npmVersion.status === 0 ? npmVersion.stdout.trim() : 'missing'}`);
  console.log(`  chrome: ${chromePath ? `ok (${chromePath})` : 'not found; upstream install may be needed'}`);
  console.log(`  display: ${hasDisplay ? 'available' : 'none'} (${desktop.display || 'no DISPLAY'})`);
  console.log(`  stale state: ${staleState.stalePids} stale pid files, ${staleState.stalePorts} orphan port files`);
  if (overall !== 'ok') {
    console.log('');
    console.log('Suggestions:');
    if (!wrapperExists || !npmExecutableExists) console.log('  Run: pibo tools install agent-browser');
    if (!chromePath) console.log('  Install Chrome/Chromium or run: agent-browser install');
    if (staleState.stalePids > 0 || staleState.stalePorts > 0) console.log('  Inspect and release stale sessions before deleting state.');
  }
}

async function printAgentBrowserSessions(status: CliToolStatus, json = false): Promise<void> {
  const wrapperPath = ensureAgentBrowserWrapper(status) || status.executablePath;
  if (!existsSync(status.executablePath)) {
    const result = { sessions: [], installed: false, nextCommands: ['pibo tools install agent-browser'] };
    console.log(json ? JSON.stringify(result, null, 2) : 'agent-browser is not installed. Run: pibo tools install agent-browser');
    return;
  }
  const result = spawnSync(wrapperPath, ['session', 'list'], {
    encoding: 'utf-8',
    env: { ...process.env, AGENT_BROWSER_HOME: status.homeDir },
  });
  if (json) {
    console.log(JSON.stringify({ installed: true, ok: result.status === 0, stdout: result.stdout, stderr: result.stderr }, null, 2));
    return;
  }
  if (result.stdout.trim()) console.log(result.stdout.trimEnd());
  if (result.status !== 0 && result.stderr.trim()) console.error(result.stderr.trimEnd());
}

async function printBrowserUseHealth(status: CliToolStatus, json = false): Promise<void> {
  const wrapperPath = join(status.homeDir, 'bin', 'browser-use');
  const wrapperExists = existsSync(wrapperPath);
  const chromePath = findChromeBinary();
  const desktop = detectDesktopEnv();
  const hasDisplay = hasDesktopDisplay(desktop);
  const staleState = checkStaleCdpState(status.homeDir);

  let expiredLeases = 0;
  try {
    const registry = readRegistry(status);
    for (const lease of registry.leases) {
      if (lease.status === 'active' && isExpired(lease)) expiredLeases++;
    }
  } catch {
    // ignore registry read errors
  }

  const overall = !wrapperExists || !chromePath ? 'critical' : staleState.stalePids > 0 || staleState.stalePorts > 0 || expiredLeases > 0 ? 'degraded' : 'ok';

  const result = {
    overall,
    wrapper: { exists: wrapperExists, path: wrapperPath },
    chrome: { found: Boolean(chromePath), path: chromePath },
    display: { available: hasDisplay, display: desktop.display, waylandDisplay: desktop.waylandDisplay },
    staleState: { pidFiles: staleState.stalePids, portFiles: staleState.stalePorts, details: staleState.details },
    leases: { expired: expiredLeases },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`browser-use health: ${overall}`);
  console.log(`  wrapper: ${wrapperExists ? 'ok' : 'MISSING'} (${wrapperPath})`);
  console.log(`  chrome: ${chromePath ? `ok (${chromePath})` : 'NOT FOUND'}`);
  console.log(`  display: ${hasDisplay ? 'available' : 'none'} (${desktop.display || 'no DISPLAY'})`);
  console.log(`  stale state: ${staleState.stalePids} stale pid files, ${staleState.stalePorts} orphan port files`);
  console.log(`  leases: ${expiredLeases} expired`);

  if (overall !== 'ok') {
    console.log('');
    console.log('Suggestions:');
    if (!wrapperExists) console.log('  Run: pibo tools install browser-use');
    if (!chromePath) console.log('  Install Chrome/Chromium (e.g. apt install chromium)');
    if (staleState.stalePids > 0 || staleState.stalePorts > 0) {
      console.log('  Clean stale state: pibo tools browser-use lease reap-stale');
    }
    if (expiredLeases > 0) console.log('  Reap expired leases: pibo tools browser-use lease reap-stale');
  }
}

function printAgentBrowserDiscovery(): void {
  console.log(`pibo tools agent-browser - Agent Browser helpers

Start:
  eval "$(pibo tools env agent-browser)"

Commands:
  health                      Check Agent Browser health and report issues
  sessions                    List upstream Agent Browser sessions
  targets                     List Chrome CDP targets with Chat auth hints
  attach-chat                 Export the best existing authenticated Chat target
  auth-template path          Print the default authenticated template profile path
  auth-template env           Print shell exports for preparing the auth template profile
  lease acquire               Acquire an isolated authenticated browser slot
  lease list                  List authenticated browser slots
  lease release <id>          Release one browser slot
  lease reap-stale            Release expired browser slots

Next:
  pibo tools show agent-browser
  pibo tools guide agent-browser agent-browser
  pibo tools agent-browser health
  pibo tools agent-browser lease acquire`);
}

function printRalphDiscovery(): void {
  console.log(`pibo tools ralph - Ralph job helpers

Commands:
  pibo ralph templates --json
  pibo ralph add --template <id> --room <room-id> --start --json
  pibo ralph list --all --json
  pibo ralph runs --job <job-id> --json
  pibo ralph stop <job-id>
  pibo ralph cancel <job-id>

Next:
  pibo tools guide ralph ralph
  pibo ralph templates`);
}

function printToolsDiscovery(): void {
  console.log(`pibo tools - curated CLI tools

Commands:
  list                      List curated tools
  installed                 List installed tools
  show <name>               Show one tool
  install <name>            Install one tool
  doctor <name>             Check one tool
  guides <name>             List tool guides
  guide <name> [guide]      Print one guide
  path <name>               Print executable path
  env <name>                Print shell exports
  browser-use               Browser-use auth slots and helper commands
  agent-browser             Agent Browser sessions, targets, and auth slots
  ralph                     Ralph job helper commands

Next:
  pibo tools list`);
}

export async function runToolsCli(argv = process.argv): Promise<void> {
  if (argv[2] === '--help' || argv[2] === '-h') {
    printToolsDiscovery();
    return;
  }

  const program = new Command();
  program
    .name('pibo tools')
    .description('Install and inspect curated external CLI tools')
    .helpOption(false)
    .showHelpAfterError();

  program
    .command('list')
    .description('List curated CLI tools')
    .action(() => printList(false));

  program
    .command('installed')
    .description('List installed CLI tools')
    .action(() => printList(true));

  program
    .command('show')
    .argument('<name>')
    .description('Show one CLI tool preset')
    .action(printShow);

  program
    .command('install')
    .argument('<name>')
    .option('--no-setup', 'Only print install target without installing runtime')
    .description('Install a CLI tool')
    .action(async (name: string, options: { setup?: boolean }) => {
      await installCliTool(requireEntry(name), options.setup !== false);
    });

  program
    .command('remove')
    .argument('<name>')
    .description('Remove an installed CLI tool runtime')
    .action(async (name: string) => {
      await removeCliTool(requireEntry(name));
    });

  program
    .command('doctor')
    .argument('<name>')
    .description('Check tool prerequisites and runtime state')
    .action(async (name: string) => {
      await doctorCliTool(requireEntry(name));
    });

  program
    .command('guides')
    .argument('<name>')
    .description('List guides for a CLI tool')
    .action(printGuides);

  program
    .command('guide')
    .argument('<name>')
    .argument('[guide]')
    .description('Print a CLI tool guide')
    .action(printGuide);

  program
    .command('path')
    .argument('<name>')
    .description('Print the installed tool executable path')
    .action(printPath);

  program
    .command('env')
    .argument('<name>')
    .description('Print shell exports for using the tool directly')
    .action(printEnv);

  program
    .command('ralph')
    .description('Ralph job helper commands')
    .action(printRalphDiscovery);

  const agentBrowser = program
    .command('agent-browser')
    .description('Agent Browser sessions, targets, and auth slots')
    .action(printAgentBrowserDiscovery);

  agentBrowser
    .command('health')
    .description('Check Agent Browser health and report issues')
    .option('--json', 'Print machine-readable health data')
    .action(async (options: { json?: boolean }) => {
      await printAgentBrowserHealth(getCliToolStatus(requireEntry('agent-browser')), Boolean(options.json));
    });

  agentBrowser
    .command('sessions')
    .description('List upstream Agent Browser sessions')
    .option('--json', 'Print machine-readable session output')
    .action(async (options: { json?: boolean }) => {
      await printAgentBrowserSessions(getCliToolStatus(requireEntry('agent-browser')), Boolean(options.json));
    });

  agentBrowser
    .command('targets')
    .description('List Chrome CDP targets with Chat auth hints')
    .option('--cdp-url <url>', 'Chrome DevTools HTTP URL')
    .option('--no-probe', 'Only read /json/list without page DOM probes')
    .option('--json', 'Print machine-readable target data')
    .action(async (options: { cdpUrl?: string; probe?: boolean; json?: boolean }) => {
      const status = getCliToolStatus(requireEntry('agent-browser'));
      const previousHome = process.env.BROWSER_USE_HOME;
      process.env.BROWSER_USE_HOME = status.homeDir;
      try {
        const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: options.probe });
        if (options.json) {
          console.log(JSON.stringify({ targets }, null, 2));
          return;
        }
        console.log(formatBrowserUseTargets(targets));
        if (targets.length === 0) console.log('\nNext: eval "$(pibo tools env agent-browser)"');
      } finally {
        if (previousHome === undefined) delete process.env.BROWSER_USE_HOME;
        else process.env.BROWSER_USE_HOME = previousHome;
      }
    });

  agentBrowser
    .command('attach-chat')
    .description('Export the best existing authenticated Chat target')
    .option('--cdp-url <url>', 'Chrome DevTools HTTP URL')
    .option('--json', 'Print machine-readable target data')
    .action(async (options: { cdpUrl?: string; json?: boolean }) => {
      const status = getCliToolStatus(requireEntry('agent-browser'));
      const previousHome = process.env.BROWSER_USE_HOME;
      process.env.BROWSER_USE_HOME = status.homeDir;
      try {
        const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl });
        const target = selectBestChatTarget(targets);
        if (!target) {
          throw new Error(
            formatCliError({
              code: ErrorCode.CLIENT_ERROR,
              type: 'AGENT_BROWSER_CHAT_TARGET_NOT_FOUND',
              message: 'No authenticated Chat Web target with a composer textarea was found',
              suggestion: 'Run `pibo tools agent-browser targets`, reuse an authenticated tab, or acquire a slot with `pibo tools agent-browser lease acquire`.',
            }),
          );
        }
        if (options.json) {
          console.log(JSON.stringify({ target }, null, 2));
          return;
        }
        const cdpUrl = options.cdpUrl ? normalizeCdpUrlSync(options.cdpUrl) : 'http://127.0.0.1:56663';
        console.log(`export PIBO_AGENT_BROWSER_CDP_URL='${cdpUrl.replaceAll("'", "'\\''")}'`);
        printAttachChatExports(target, cdpUrl);
      } finally {
        if (previousHome === undefined) delete process.env.BROWSER_USE_HOME;
        else process.env.BROWSER_USE_HOME = previousHome;
      }
    });

  const agentAuthTemplate = agentBrowser
    .command('auth-template')
    .description('Manage the Agent Browser authenticated template profile')
    .action(() => {
      console.log(`pibo tools agent-browser auth-template

Commands:
  path    Print the default authenticated template profile path
  env     Print shell exports for preparing the auth template profile`);
    });

  agentAuthTemplate
    .command('path')
    .option('--app <name>', 'Auth pool app name', 'pibo-chat')
    .description('Print the default authenticated template profile path')
    .action((options: { app?: string }) => {
      printAgentBrowserAuthTemplatePath(getCliToolStatus(requireEntry('agent-browser')), options.app);
    });

  agentAuthTemplate
    .command('env')
    .option('--app <name>', 'Auth pool app name', 'pibo-chat')
    .description('Print shell exports for preparing the auth template profile')
    .action(async (options: { app?: string }) => {
      await printAgentBrowserAuthTemplateEnv(getCliToolStatus(requireEntry('agent-browser')), options.app);
    });

  const agentLease = agentBrowser
    .command('lease')
    .description('Acquire and manage isolated Agent Browser slots')
    .action(() => {
      console.log(`pibo tools agent-browser lease

Commands:
  acquire       Acquire an isolated authenticated browser slot
  list          List authenticated browser slots
  release <id>  Release one browser slot
  reap-stale    Release expired browser slots`);
    });

  agentLease
    .command('acquire')
    .description('Acquire an isolated authenticated browser slot')
    .option('--app <name>', 'Auth pool app name', 'pibo-chat')
    .option('--holder <holder>', 'Lease holder label')
    .option('--ttl-ms <ms>', 'Lease time-to-live in milliseconds', parsePositiveInteger)
    .option('--max-slots <count>', 'Maximum active slots for the app', parsePositiveInteger)
    .option('--json', 'Print machine-readable lease data')
    .action(async (options: { app?: string; holder?: string; ttlMs?: number; maxSlots?: number; json?: boolean }) => {
      await acquireAgentBrowserLease(getCliToolStatus(requireEntry('agent-browser')), options);
    });

  agentLease
    .command('list')
    .description('List authenticated browser slots')
    .option('--json', 'Print machine-readable lease data')
    .action(async (options: { json?: boolean }) => {
      await listAgentBrowserLeases(getCliToolStatus(requireEntry('agent-browser')), Boolean(options.json));
    });

  agentLease
    .command('release')
    .argument('<id>')
    .option('--delete-profile', 'Delete the slot browser profile')
    .description('Release one browser slot')
    .action(async (id: string, options: { deleteProfile?: boolean }) => {
      await releaseAgentBrowserLease(getCliToolStatus(requireEntry('agent-browser')), id, options);
    });

  agentLease
    .command('reap-stale')
    .description('Release expired browser slots')
    .option('--json', 'Print machine-readable reap result')
    .action(async (options: { json?: boolean }) => {
      await reapStaleAgentBrowserLeases(getCliToolStatus(requireEntry('agent-browser')), Boolean(options.json));
    });

  const browserUse = program
    .command('browser-use')
    .description('Browser-use auth slots and helper commands')
    .action(printBrowserUseDiscovery);

  browserUse
    .command('targets')
    .description('List Chrome CDP targets with Chat auth hints')
    .option('--cdp-url <url>', 'Chrome DevTools HTTP URL')
    .option('--no-probe', 'Only read /json/list without page DOM probes')
    .option('--json', 'Print machine-readable target data')
    .action(async (options: { cdpUrl?: string; probe?: boolean; json?: boolean }) => {
      const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: options.probe });
      if (options.json) {
        console.log(JSON.stringify({ targets }, null, 2));
        return;
      }
      console.log(formatBrowserUseTargets(targets));
      if (targets.length === 0) {
        console.log('');
        console.log('Next: eval "$(pibo tools env browser-use)"');
      }
    });

  browserUse
    .command('attach-chat')
    .description('Export the best existing authenticated Chat target')
    .option('--cdp-url <url>', 'Chrome DevTools HTTP URL')
    .option('--json', 'Print machine-readable target data')
    .action(async (options: { cdpUrl?: string; json?: boolean }) => {
      const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl });
      const target = selectBestChatTarget(targets);
      if (!target) {
        throw new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'BROWSER_USE_CHAT_TARGET_NOT_FOUND',
            message: 'No authenticated Chat Web target with a composer textarea was found',
            suggestion:
              'Run `pibo tools browser-use targets`, reuse an authenticated tab if present, or acquire a slot with `pibo tools browser-use lease acquire`.',
          }),
        );
      }
      if (options.json) {
        console.log(JSON.stringify({ target }, null, 2));
        return;
      }
      const cdpUrl = options.cdpUrl ? normalizeCdpUrlSync(options.cdpUrl) : undefined;
      printAttachChatExports(target, cdpUrl);
    });

  browserUse
    .command('health')
    .description('Check browser-use health and report issues')
    .option('--json', 'Print machine-readable health data')
    .action(async (options: { json?: boolean }) => {
      await printBrowserUseHealth(getCliToolStatus(requireEntry('browser-use')), Boolean(options.json));
    });

  const pool = browserUse
    .command('pool')
    .description('Inspect and reap the managed browser pool')
    .action(() => {
      console.log(`pibo tools browser-use pool

Commands:
  status    Show read-only managed browser-pool status
  reap      Reap an idle managed browser pool`);
    });

  pool
    .command('status')
    .description('Show read-only managed browser-pool status')
    .option('--worker-id <id>', 'Worker id to inspect')
    .option('--pool-id <id>', 'Browser pool id to inspect')
    .option('--root <path>', 'Browser pool root directory')
    .option('--json', 'Print machine-readable pool status')
    .action(async (options: BrowserPoolStatusOptions) => {
      await printBrowserPoolStatus(getCliToolStatus(requireEntry('browser-use')), options);
    });

  pool
    .command('reap')
    .description('Reap an idle managed browser pool')
    .option('--worker-id <id>', 'Worker id to inspect')
    .option('--pool-id <id>', 'Browser pool id to inspect')
    .option('--root <path>', 'Browser pool root directory')
    .option('--idle-timeout-ms <ms>', 'Idle timeout in milliseconds (0 means immediately eligible)', parseNonNegativeInteger)
    .option('--json', 'Print machine-readable reap result')
    .action(async (options: BrowserPoolReapOptions) => {
      await printBrowserPoolReap(getCliToolStatus(requireEntry('browser-use')), options);
    });

  const authTemplate = browserUse
    .command('auth-template')
    .description('Manage the browser-use authenticated template profile')
    .action(() => {
      console.log(`pibo tools browser-use auth-template

Commands:
  path    Print the default authenticated template profile path
  env     Print shell exports for preparing the auth template profile`);
    });

  authTemplate
    .command('path')
    .description('Print the default authenticated template profile path')
    .action(() => {
      printBrowserUseAuthTemplatePath(getCliToolStatus(requireEntry('browser-use')));
    });

  authTemplate
    .command('env')
    .description('Print shell exports for preparing the auth template profile')
    .action(async () => {
      await printBrowserUseAuthTemplateEnv(getCliToolStatus(requireEntry('browser-use')));
    });

  const lease = browserUse
    .command('lease')
    .description('Acquire and manage isolated authenticated browser-use slots')
    .action(() => {
      console.log(`pibo tools browser-use lease

Commands:
  acquire       Acquire an isolated authenticated browser slot
  list          List authenticated browser slots
  release <id>  Release one browser slot
  reap-stale    Release expired or dead browser slots`);
    });

  lease
    .command('acquire')
    .description('Acquire an isolated authenticated browser slot')
    .option('--app <name>', 'Auth pool app name', 'pibo-chat')
    .option('--holder <holder>', 'Lease holder label')
    .option('--ttl-minutes <minutes>', 'Lease time-to-live in minutes', parsePositiveInteger)
    .option('--max-slots <count>', 'Maximum active slots for the app', parsePositiveInteger)
    .option('--template-dir <path>', 'Authenticated Chrome user-data-dir template to clone')
    .option('--profile-name <name>', 'Chrome profile name inside each slot')
    .option('--json', 'Print machine-readable lease data')
    .action(async (options: {
      app?: string;
      holder?: string;
      ttlMinutes?: number;
      maxSlots?: number;
      templateDir?: string;
      profileName?: string;
      json?: boolean;
    }) => {
      await acquireBrowserUseLease({ status: getCliToolStatus(requireEntry('browser-use')) }, options);
    });

  lease
    .command('list')
    .description('List authenticated browser slots')
    .option('--json', 'Print machine-readable lease data')
    .action(async (options: { json?: boolean }) => {
      await listBrowserUseLeases({ status: getCliToolStatus(requireEntry('browser-use')) }, Boolean(options.json));
    });

  lease
    .command('release')
    .argument('<id>')
    .option('--delete-profile', 'Delete the slot Chrome user-data-dir')
    .description('Release one browser slot')
    .action(async (id: string, options: { deleteProfile?: boolean }) => {
      await releaseBrowserUseLease({ status: getCliToolStatus(requireEntry('browser-use')) }, id, options);
    });

  lease
    .command('reap-stale')
    .description('Release expired or dead browser slots')
    .action(async () => {
      await reapStaleBrowserUseLeases({ status: getCliToolStatus(requireEntry('browser-use')) });
    });

  if (argv.length <= 2) {
    printList(false);
    return;
  }

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = ErrorCode.CLIENT_ERROR;
  }
}
