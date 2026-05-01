import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorCode, formatCliError } from '../cli-errors.js';
import { BROWSER_USE_DEFAULT_PROFILE } from './browser-use-wrapper.js';
import type { CliToolStatus } from './registry.js';

const REGISTRY_VERSION = 1;
const DEFAULT_APP = 'pibo-chat';
const DEFAULT_TTL_MINUTES = 8 * 60;
const DEFAULT_TEMPLATE_PROFILE = 'pibo-auth-template';
const AUTH_POOL_DIR = 'auth-pool';

type LeaseStatus = 'active' | 'released';

type BrowserUseLease = {
  id: string;
  app: string;
  owner: string;
  sessionName: string;
  userDataDir: string;
  profileName: string;
  status: LeaseStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type LeaseRegistry = {
  version: number;
  leases: BrowserUseLease[];
};

export type BrowserUseLeaseAcquireOptions = {
  app?: string;
  owner?: string;
  ttlMinutes?: number;
  maxSlots?: number;
  templateDir?: string;
  profileName?: string;
  json?: boolean;
};

export type BrowserUseLeaseReleaseOptions = {
  deleteProfile?: boolean;
};

type LeaseCommandContext = {
  status: CliToolStatus;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

function registryPath(status: CliToolStatus): string {
  return join(status.homeDir, AUTH_POOL_DIR, 'leases.json');
}

function lockDir(status: CliToolStatus): string {
  return join(status.homeDir, AUTH_POOL_DIR, '.leases.lock');
}

function appPoolDir(status: CliToolStatus, app: string): string {
  return join(status.homeDir, AUTH_POOL_DIR, sanitizeIdPart(app));
}

function browserUseHome(status: CliToolStatus): string {
  return status.homeDir;
}

function authTemplateDir(status: CliToolStatus): string {
  if (process.env.PIBO_BROWSER_USE_AUTH_TEMPLATE_DIR) {
    return process.env.PIBO_BROWSER_USE_AUTH_TEMPLATE_DIR;
  }
  return join(status.homeDir, 'chrome-profiles', DEFAULT_TEMPLATE_PROFILE);
}

function defaultTemplateDir(status: CliToolStatus): string {
  const preferred = authTemplateDir(status);
  if (existsSync(preferred)) return preferred;
  return join(status.homeDir, 'chrome-profiles', BROWSER_USE_DEFAULT_PROFILE);
}

function readRegistry(status: CliToolStatus): LeaseRegistry {
  const path = registryPath(status);
  if (!existsSync(path)) return { version: REGISTRY_VERSION, leases: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { leases?: unknown }).leases)) {
    throw new Error(`Invalid browser-use lease registry: ${path}`);
  }
  return {
    version: REGISTRY_VERSION,
    leases: (parsed as LeaseRegistry).leases,
  };
}

async function writeRegistry(status: CliToolStatus, registry: LeaseRegistry): Promise<void> {
  const path = registryPath(status);
  await mkdir(join(status.homeDir, AUTH_POOL_DIR), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...registry, version: REGISTRY_VERSION }, null, 2)}\n`);
}

async function withRegistryLock<T>(status: CliToolStatus, action: () => Promise<T>): Promise<T> {
  const lock = lockDir(status);
  await mkdir(join(status.homeDir, AUTH_POOL_DIR), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  if (!acquired) {
    throw new Error('Timed out waiting for browser-use lease registry lock');
  }

  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function isExpired(lease: BrowserUseLease, now = new Date()): boolean {
  return new Date(lease.expiresAt).getTime() <= now.getTime();
}

function safeSessionName(sessionName: string): string {
  return sessionName.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function cdpPidFile(status: CliToolStatus, sessionName: string): string {
  return join(status.homeDir, 'pibo-cdp', `${safeSessionName(sessionName)}.pid`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(path: string): number | undefined {
  try {
    const value = Number.parseInt(readFileSync(path, 'utf-8'), 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function leaseProcessIsAlive(status: CliToolStatus, lease: BrowserUseLease): boolean {
  const pid = readPid(cdpPidFile(status, lease.sessionName));
  return pid ? processIsAlive(pid) : false;
}

function killLeaseProcess(status: CliToolStatus, lease: BrowserUseLease): void {
  const pid = readPid(cdpPidFile(status, lease.sessionName));
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already exited.
  }
}

async function copyTemplateProfile(templateDir: string, userDataDir: string): Promise<void> {
  if (!existsSync(templateDir)) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'BROWSER_USE_AUTH_TEMPLATE_MISSING',
        message: `Browser-use auth template does not exist: ${templateDir}`,
        suggestion: 'Run `pibo tools browser-use auth-template env`, open the Chat Web App, sign in, then acquire a lease again.',
      }),
    );
  }
  assertTemplateIsNotRunning(templateDir);

  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  await cp(templateDir, userDataDir, {
    recursive: true,
    filter: (source) => {
      const base = source.split(/[\\/]/).pop() ?? '';
      return !base.startsWith('Singleton') && base !== 'DevToolsActivePort';
    },
  });
}

function assertTemplateIsNotRunning(templateDir: string): void {
  for (const fileName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    if (!existsSync(join(templateDir, fileName))) continue;
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'BROWSER_USE_AUTH_TEMPLATE_RUNNING',
        message: `Browser-use auth template appears to be running: ${templateDir}`,
        details: `Found ${fileName}`,
        suggestion: 'Close the template browser before acquiring leases, or pass --template-dir for a closed template profile.',
      }),
    );
  }
}

function nextSlotNumber(leases: BrowserUseLease[], app: string): number {
  const prefix = `${sanitizeIdPart(app)}-slot-`;
  const used = new Set(
    leases
      .filter((lease) => lease.app === app)
      .map((lease) => Number.parseInt(lease.id.slice(prefix.length), 10))
      .filter((value) => Number.isFinite(value)),
  );
  for (let value = 1; value < 10_000; value += 1) {
    if (!used.has(value)) return value;
  }
  throw new Error(`No browser-use slots available for ${app}`);
}

function createLease(
  status: CliToolStatus,
  app: string,
  owner: string,
  ttlMinutes: number,
  profileName: string,
  leases: BrowserUseLease[],
): BrowserUseLease {
  const slot = nextSlotNumber(leases, app);
  const slotName = `slot-${String(slot).padStart(3, '0')}`;
  const appId = sanitizeIdPart(app);
  const id = `${appId}-${slotName}`;
  const createdAt = nowIso();
  return {
    id,
    app,
    owner,
    sessionName: `pibo-auth-${id}`,
    userDataDir: join(appPoolDir(status, app), slotName),
    profileName,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    expiresAt: addMinutes(new Date(createdAt), ttlMinutes).toISOString(),
  };
}

function selectReusableLease(
  status: CliToolStatus,
  leases: BrowserUseLease[],
  app: string,
): BrowserUseLease | undefined {
  return leases.find((lease) =>
    lease.app === app &&
    (lease.status === 'released' || isExpired(lease)) &&
    !leaseProcessIsAlive(status, lease),
  );
}

function printLeaseEnv(status: CliToolStatus, lease: BrowserUseLease): void {
  console.log(`export BROWSER_USE_HOME=${shellQuote(browserUseHome(status))}`);
  console.log(`export PIBO_BROWSER_USE_LEASE_ID=${shellQuote(lease.id)}`);
  console.log(`export PIBO_BROWSER_USE_SESSION=${shellQuote(lease.sessionName)}`);
  console.log(`export PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=${shellQuote(lease.userDataDir)}`);
  console.log(`export PIBO_BROWSER_USE_DEFAULT_PROFILE=${shellQuote(lease.profileName)}`);
  console.log(`# browser-use --session "$PIBO_BROWSER_USE_SESSION" state`);
}

function printLeaseJson(status: CliToolStatus, lease: BrowserUseLease): void {
  console.log(JSON.stringify({
    ...lease,
    browserUseHome: browserUseHome(status),
    exports: {
      BROWSER_USE_HOME: browserUseHome(status),
      PIBO_BROWSER_USE_LEASE_ID: lease.id,
      PIBO_BROWSER_USE_SESSION: lease.sessionName,
      PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: lease.userDataDir,
      PIBO_BROWSER_USE_DEFAULT_PROFILE: lease.profileName,
    },
  }, null, 2));
}

export async function acquireBrowserUseLease(
  context: LeaseCommandContext,
  options: BrowserUseLeaseAcquireOptions = {},
): Promise<void> {
  const app = options.app?.trim() || DEFAULT_APP;
  const owner = options.owner?.trim() || process.env.PIBO_BROWSER_USE_LEASE_OWNER || process.env.USER || 'unknown';
  const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const profileName = options.profileName?.trim() || BROWSER_USE_DEFAULT_PROFILE;
  const templateDir = options.templateDir?.trim() || defaultTemplateDir(context.status);

  await withRegistryLock(context.status, async () => {
    const registry = readRegistry(context.status);
    let lease = selectReusableLease(context.status, registry.leases, app);
    if (lease) {
      await copyTemplateProfile(templateDir, lease.userDataDir);
      lease.owner = owner;
      lease.status = 'active';
      lease.profileName = profileName;
      lease.updatedAt = nowIso();
      lease.expiresAt = addMinutes(new Date(), ttlMinutes).toISOString();
    } else {
      const activeCount = registry.leases.filter((item) =>
        item.app === app &&
        item.status === 'active' &&
        !isExpired(item),
      ).length;
      if (options.maxSlots !== undefined && activeCount >= options.maxSlots) {
        throw new Error(
          formatCliError({
            code: ErrorCode.CLIENT_ERROR,
            type: 'BROWSER_USE_AUTH_POOL_EXHAUSTED',
            message: `No browser-use auth slots available for ${app}`,
            details: `active=${activeCount} max=${options.maxSlots}`,
            suggestion: 'Release a lease or rerun with a higher --max-slots value.',
          }),
        );
      }
      lease = createLease(context.status, app, owner, ttlMinutes, profileName, registry.leases);
      await copyTemplateProfile(templateDir, lease.userDataDir);
      registry.leases.push(lease);
    }
    await writeRegistry(context.status, registry);
    if (options.json) printLeaseJson(context.status, lease);
    else printLeaseEnv(context.status, lease);
  });
}

export async function listBrowserUseLeases(context: LeaseCommandContext, json = false): Promise<void> {
  const registry = readRegistry(context.status);
  const rows = registry.leases.map((lease) => ({
    ...lease,
    expired: isExpired(lease),
    processAlive: leaseProcessIsAlive(context.status, lease),
  }));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('No browser-use auth leases.');
    return;
  }
  for (const row of rows) {
    const state = row.status === 'active' && !row.expired ? 'active' : row.expired ? 'expired' : row.status;
    console.log(`${row.id}\t${state}\t${row.owner}\t${row.sessionName}\t${row.userDataDir}`);
  }
}

export async function releaseBrowserUseLease(
  context: LeaseCommandContext,
  id: string,
  options: BrowserUseLeaseReleaseOptions = {},
): Promise<void> {
  await withRegistryLock(context.status, async () => {
    const registry = readRegistry(context.status);
    const lease = registry.leases.find((candidate) => candidate.id === id);
    if (!lease) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'BROWSER_USE_AUTH_LEASE_NOT_FOUND',
          message: `Browser-use auth lease "${id}" not found`,
          suggestion: 'Run `pibo tools browser-use lease list`.',
        }),
      );
    }
    killLeaseProcess(context.status, lease);
    lease.status = 'released';
    lease.updatedAt = nowIso();
    if (options.deleteProfile) {
      await rm(lease.userDataDir, { recursive: true, force: true });
    }
    await writeRegistry(context.status, registry);
    console.log(`Released ${lease.id}`);
  });
}

export async function reapStaleBrowserUseLeases(context: LeaseCommandContext): Promise<void> {
  await withRegistryLock(context.status, async () => {
    const registry = readRegistry(context.status);
    let count = 0;
    for (const lease of registry.leases) {
      if (lease.status !== 'active' || !isExpired(lease)) continue;
      if (leaseProcessIsAlive(context.status, lease)) killLeaseProcess(context.status, lease);
      lease.status = 'released';
      lease.updatedAt = nowIso();
      count += 1;
    }
    await writeRegistry(context.status, registry);
    console.log(`Reaped ${count} stale browser-use auth lease${count === 1 ? '' : 's'}`);
  });
}

export function printBrowserUseAuthTemplatePath(status: CliToolStatus): void {
  console.log(authTemplateDir(status));
}

export async function printBrowserUseAuthTemplateEnv(status: CliToolStatus): Promise<void> {
  const templateDir = authTemplateDir(status);
  await mkdir(templateDir, { recursive: true });
  console.log(`export BROWSER_USE_HOME=${shellQuote(browserUseHome(status))}`);
  console.log(`export PIBO_BROWSER_USE_SESSION=${shellQuote('pibo-auth-template')}`);
  console.log(`export PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=${shellQuote(templateDir)}`);
  console.log(`export PIBO_BROWSER_USE_DEFAULT_PROFILE=${shellQuote(BROWSER_USE_DEFAULT_PROFILE)}`);
  console.log(`# browser-use --headed --session "$PIBO_BROWSER_USE_SESSION" open <chat-url>`);
}
