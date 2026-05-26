import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorCode, formatCliError } from '../cli-errors.js';
import type { CliToolStatus } from './registry.js';

const REGISTRY_VERSION = 1;
const DEFAULT_APP = 'pibo-chat';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

type LeaseStatus = 'active' | 'released';

type AgentBrowserLease = {
  id: string;
  app: string;
  owner: string;
  slot: string;
  sessionName: string;
  profileDir: string;
  status: LeaseStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type LeaseRegistry = {
  version: number;
  leases: AgentBrowserLease[];
};

export type AgentBrowserLeaseAcquireOptions = {
  app?: string;
  owner?: string;
  ttlMs?: number;
  maxSlots?: number;
  json?: boolean;
};

export type AgentBrowserLeaseReleaseOptions = {
  deleteProfile?: boolean;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function registryPath(status: CliToolStatus): string {
  return join(status.homeDir, 'pibo-agent-browser-leases.json');
}

function lockDir(status: CliToolStatus): string {
  return join(status.homeDir, '.pibo-agent-browser-leases.lock');
}

function templateDir(status: CliToolStatus, app: string): string {
  return join(status.homeDir, 'profiles', 'auth-template', sanitize(app));
}

function leaseProfileDir(status: CliToolStatus, app: string, slot: string): string {
  return join(status.homeDir, 'profiles', 'leases', sanitize(app), slot);
}

function readRegistry(status: CliToolStatus): LeaseRegistry {
  const path = registryPath(status);
  if (!existsSync(path)) return { version: REGISTRY_VERSION, leases: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { leases?: unknown }).leases)) {
    throw new Error(`Invalid agent-browser lease registry: ${path}`);
  }
  return { version: REGISTRY_VERSION, leases: (parsed as LeaseRegistry).leases };
}

async function writeRegistry(status: CliToolStatus, registry: LeaseRegistry): Promise<void> {
  await mkdir(status.homeDir, { recursive: true });
  await writeFile(registryPath(status), `${JSON.stringify({ ...registry, version: REGISTRY_VERSION }, null, 2)}\n`);
}

async function withRegistryLock<T>(status: CliToolStatus, action: () => Promise<T>): Promise<T> {
  const lock = lockDir(status);
  await mkdir(status.homeDir, { recursive: true });
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
  if (!acquired) throw new Error('Timed out waiting for agent-browser lease registry lock');
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function isExpired(lease: AgentBrowserLease, now = new Date()): boolean {
  return new Date(lease.expiresAt).getTime() <= now.getTime();
}

function copyFilter(source: string): boolean {
  const base = source.split(/[\\/]/).pop() || '';
  return ![
    'SingletonCookie',
    'SingletonLock',
    'SingletonSocket',
    'DevToolsActivePort',
    'Crashpad',
    'ShaderCache',
    'GrShaderCache',
  ].includes(base);
}

function leaseEnv(status: CliToolStatus, lease: AgentBrowserLease): Record<string, string> {
  return {
    AGENT_BROWSER_HOME: status.homeDir,
    PIBO_AGENT_BROWSER_LEASE_ID: lease.id,
    AGENT_BROWSER_SESSION: lease.sessionName,
    AGENT_BROWSER_PROFILE: lease.profileDir,
    AGENT_BROWSER_SESSION_NAME: lease.sessionName,
  };
}

function printExports(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) console.log(`export ${key}=${shellQuote(value)}`);
}

export function printAgentBrowserAuthTemplatePath(status: CliToolStatus, app = DEFAULT_APP): void {
  console.log(templateDir(status, app));
}

export async function printAgentBrowserAuthTemplateEnv(status: CliToolStatus, app = DEFAULT_APP): Promise<void> {
  const dir = templateDir(status, app);
  await mkdir(dir, { recursive: true });
  printExports({
    AGENT_BROWSER_HOME: status.homeDir,
    AGENT_BROWSER_PROFILE: dir,
    AGENT_BROWSER_SESSION: `pibo-auth-template-${sanitize(app)}`,
    AGENT_BROWSER_SESSION_NAME: `pibo-auth-template-${sanitize(app)}`,
  });
  console.log(`# Open Chat Web, sign in, then close the browser before acquiring leases.`);
}

export async function acquireAgentBrowserLease(status: CliToolStatus, options: AgentBrowserLeaseAcquireOptions): Promise<void> {
  const app = sanitize(options.app || DEFAULT_APP);
  const owner = options.owner || process.env.USER || 'unknown';
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxSlots = options.maxSlots ?? 4;

  const result = await withRegistryLock(status, async () => {
    const registry = readRegistry(status);
    const now = new Date();
    for (const lease of registry.leases) {
      if (lease.status === 'active' && isExpired(lease, now)) {
        lease.status = 'released';
        lease.updatedAt = nowIso();
      }
    }
    const active = registry.leases.filter((lease) => lease.app === app && lease.status === 'active' && !isExpired(lease, now));
    if (active.length >= maxSlots) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'AGENT_BROWSER_AUTH_POOL_EXHAUSTED',
          message: `No agent-browser auth slots are available for ${app}`,
          details: `Active slots: ${active.length}; max slots: ${maxSlots}`,
          suggestion: 'Release a lease or rerun with a higher --max-slots value.',
        }),
      );
    }

    const used = new Set(active.map((lease) => lease.slot));
    let slotNumber = 1;
    while (used.has(`slot-${String(slotNumber).padStart(3, '0')}`)) slotNumber += 1;
    const slot = `slot-${String(slotNumber).padStart(3, '0')}`;
    const sessionName = `pibo-auth-${app}-${slot}`;
    const profileDir = leaseProfileDir(status, app, slot);
    const lease: AgentBrowserLease = {
      id: `${app}-${slot}`,
      app,
      owner,
      slot,
      sessionName,
      profileDir,
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };

    await rm(profileDir, { recursive: true, force: true });
    const sourceTemplate = templateDir(status, app);
    if (existsSync(sourceTemplate)) {
      await cp(sourceTemplate, profileDir, { recursive: true, force: true, filter: copyFilter });
    } else {
      await mkdir(profileDir, { recursive: true });
    }
    registry.leases.push(lease);
    await writeRegistry(status, registry);
    return lease;
  });

  const env = leaseEnv(status, result);
  if (options.json) {
    console.log(JSON.stringify({ lease: result, env }, null, 2));
    return;
  }
  printExports(env);
}

export async function listAgentBrowserLeases(status: CliToolStatus, json = false): Promise<void> {
  const registry = readRegistry(status);
  if (json) {
    console.log(JSON.stringify(registry, null, 2));
    return;
  }
  if (registry.leases.length === 0) {
    console.log('No agent-browser leases.');
    return;
  }
  console.log('id\tapp\tstatus\towner\tsession\texpires\tprofile');
  for (const lease of registry.leases) {
    console.log(`${lease.id}\t${lease.app}\t${lease.status}\t${lease.owner}\t${lease.sessionName}\t${lease.expiresAt}\t${lease.profileDir}`);
  }
}

export async function releaseAgentBrowserLease(status: CliToolStatus, id: string, options: AgentBrowserLeaseReleaseOptions): Promise<void> {
  await withRegistryLock(status, async () => {
    const registry = readRegistry(status);
    const lease = registry.leases.find((item) => item.id === id);
    if (!lease) throw new Error(`Agent Browser lease not found: ${id}`);
    lease.status = 'released';
    lease.updatedAt = nowIso();
    await writeRegistry(status, registry);
    if (options.deleteProfile) await rm(lease.profileDir, { recursive: true, force: true });
  });
  console.log(`Released agent-browser lease ${id}`);
}

export async function reapStaleAgentBrowserLeases(status: CliToolStatus, json = false): Promise<void> {
  let released = 0;
  await withRegistryLock(status, async () => {
    const registry = readRegistry(status);
    const now = new Date();
    for (const lease of registry.leases) {
      if (lease.status === 'active' && isExpired(lease, now)) {
        lease.status = 'released';
        lease.updatedAt = nowIso();
        released += 1;
      }
    }
    await writeRegistry(status, registry);
  });
  if (json) console.log(JSON.stringify({ released }, null, 2));
  else console.log(`Reaped ${released} expired agent-browser lease(s).`);
}
