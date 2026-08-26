/**
 * MCP daemon client and cross-process lifecycle coordination.
 */

import {
  spawn,
  type SpawnOptions,
  type ChildProcess,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ServerConfig,
  debug,
  getConfigHash,
  getDaemonClaimPath,
  getDaemonLeasePrefix,
  getDaemonRequestTimeoutMs,
  getPidPath,
  getSocketDir,
  getSocketPath,
  usesFilesystemSocket,
} from './config.js';
import {
  type DaemonClaimFileContent,
  type DaemonIdentity,
  type DaemonLeaseFileContent,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonStateOwnership,
  type PidFileContent,
  daemonProcessIdentityMatches,
  daemonIdentityMatches,
  getOwnershipFileAgeMs,
  isProcessRunning,
  pidFileIdentityMatches,
  readOwnershipFilePath,
  readPidFile,
  readPidFilePath,
  readProcessIdentity,
  removeDaemonState,
  removeMalformedOwnershipFile,
  removeOwnershipFile,
  removePidFilePath,
  removeUntrackedEndpoint,
  terminateDaemonProcess,
  writeOwnershipFileExclusive,
} from './daemon.js';

const OWNERSHIP_POLL_MS = 25;
const DEAD_OWNER_GRACE_MS = 100;
const MAX_DAEMON_MESSAGE_BYTES = 1024 * 1024;

export interface DaemonConnection {
  serverName: string;
  listTools: () => Promise<unknown>;
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  getInstructions: () => Promise<string | undefined>;
  close: () => Promise<void>;
}

function generateRequestId(): string {
  return `${Date.now()}-${randomUUID()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDaemonIdentity(value: unknown): value is DaemonIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DaemonIdentity>;
  return (
    Number.isInteger(candidate.pid) &&
    (candidate.pid ?? 0) > 0 &&
    typeof candidate.configHash === 'string' &&
    typeof candidate.generation === 'string' &&
    candidate.generation.length > 0 &&
    typeof candidate.startedAt === 'string'
  );
}

function isCompletePidInfo(value: PidFileContent): value is PidFileContent {
  return isDaemonIdentity(value);
}

async function sendRequest(
  socketPath: string,
  request: DaemonRequest,
  timeoutMs: number = getDaemonRequestTimeoutMs(),
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseText = '';

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn();
    };

    const socket = createConnection(socketPath, () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (data) => {
      responseText += data.toString();
      if (responseText.length > MAX_DAEMON_MESSAGE_BYTES) {
        socket.destroy();
        settle(() => reject(new Error('Daemon response exceeds 1 MiB')));
        return;
      }
      const newlineIndex = responseText.indexOf('\n');
      if (newlineIndex === -1) return;
      const responseLine = responseText.slice(0, newlineIndex);
      settle(() => {
        try {
          resolve(JSON.parse(responseLine));
        } catch {
          reject(new Error('Invalid response from daemon'));
        } finally {
          socket.end();
        }
      });
    });

    socket.on('end', () => {
      if (settled) return;
      settle(() => {
        try {
          resolve(JSON.parse(responseText.trim()));
        } catch {
          reject(new Error('Invalid response from daemon'));
        }
      });
    });

    socket.on('error', (error) => {
      settle(() => reject(error));
    });

    const timeoutId = setTimeout(() => {
      socket.destroy();
      settle(() => reject(new Error('Daemon request timeout')));
    }, timeoutMs);
  });
}

async function pingDaemon(
  serverName: string,
  timeoutMs: number,
): Promise<DaemonIdentity | null> {
  const socketPath = getSocketPath(serverName);
  if (usesFilesystemSocket() && !existsSync(socketPath)) return null;
  try {
    const response = await sendRequest(
      socketPath,
      { id: generateRequestId(), type: 'ping' },
      timeoutMs,
    );
    return response.success && isDaemonIdentity(response.data)
      ? response.data
      : null;
  } catch {
    return null;
  }
}

async function waitForDaemonReady(
  serverName: string,
  expected: DaemonIdentity,
  timeoutMs: number,
  isAlive: () => boolean,
): Promise<DaemonIdentity | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive()) {
    const remainingMs = deadline - Date.now();
    const identity = await pingDaemon(
      serverName,
      Math.max(1, Math.min(500, remainingMs)),
    );
    if (daemonIdentityMatches(identity, expected)) return identity;
    await sleep(OWNERSHIP_POLL_MS);
  }
  return null;
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isProcessRunning(pid)) {
    await sleep(50);
  }
  return !isProcessRunning(pid);
}

async function waitForDaemonExit(
  expected: DaemonIdentity,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const isExpectedProcessRunning = () =>
    expected.processIdentity
      ? daemonProcessIdentityMatches(expected)
      : isProcessRunning(expected.pid);
  while (Date.now() < deadline && isExpectedProcessRunning()) {
    await sleep(50);
  }
  return !isExpectedProcessRunning();
}

async function stopDaemon(
  serverName: string,
  expected: PidFileContent,
  ownership: DaemonStateOwnership,
): Promise<boolean> {
  try {
    await sendRequest(
      getSocketPath(serverName),
      {
        id: generateRequestId(),
        type: 'close',
        generation: expected.generation,
      },
      1000,
    );
  } catch {
    // The daemon may still be starting or may already have crashed.
  }

  let exited = await waitForDaemonExit(expected, 2000);
  if (!exited) {
    const current = readPidFile(serverName);
    if (!pidFileIdentityMatches(current, expected)) return false;
    if (!terminateDaemonProcess(expected)) return false;
    exited = await waitForDaemonExit(expected, 1000);
  }

  return exited && removeDaemonState(serverName, expected, ownership);
}

async function stopLegacyDaemon(
  serverName: string,
  pidInfo: PidFileContent,
  ownership: DaemonStateOwnership,
): Promise<boolean> {
  try {
    await sendRequest(
      getSocketPath(serverName),
      { id: generateRequestId(), type: 'close' },
      1000,
    );
  } catch {
    // Continue to the bounded process check.
  }
  const exited = await waitForProcessExit(pidInfo.pid, 2000);
  return exited && removeDaemonState(serverName, pidInfo, ownership);
}

async function stopUntrackedEndpoint(
  serverName: string,
  ownership: DaemonStateOwnership,
): Promise<boolean> {
  const identity = await pingDaemon(serverName, 500);
  if (!identity) {
    return removeUntrackedEndpoint(serverName, ownership);
  }
  try {
    await sendRequest(
      getSocketPath(serverName),
      {
        id: generateRequestId(),
        type: 'close',
        generation: identity.generation,
      },
      1000,
    );
  } catch {
    return false;
  }
  const exited = await waitForDaemonExit(identity, 2000);
  return exited && removeUntrackedEndpoint(serverName, ownership);
}

export function getDaemonSpawnOptions(): SpawnOptions {
  return {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  };
}

export function getDaemonSpawnArguments(
  daemonScript: string,
  serverName: string,
  config: ServerConfig,
  generation: string,
): string[] {
  return [
    ...process.execArgv,
    daemonScript,
    '--daemon',
    serverName,
    JSON.stringify(config),
    generation,
  ];
}

async function spawnDaemon(
  serverName: string,
  config: ServerConfig,
  configHash: string,
  generation: string,
  timeoutMs: number,
  ownership: DaemonStateOwnership,
): Promise<DaemonIdentity | null> {
  debug(`[daemon-client] Spawning daemon for ${serverName}`);
  const modulePath = fileURLToPath(import.meta.url);
  const daemonScript = join(
    dirname(modulePath),
    `daemon${extname(modulePath)}`,
  );
  const proc: ChildProcess = spawn(
    process.execPath,
    getDaemonSpawnArguments(daemonScript, serverName, config, generation),
    getDaemonSpawnOptions(),
  );

  let spawnError: Error | undefined;
  let exited = false;
  proc.once('error', (error) => {
    spawnError = error;
  });
  proc.once('exit', () => {
    exited = true;
  });
  proc.unref();

  if (proc.pid === undefined) return null;
  const expected: DaemonIdentity = {
    pid: proc.pid,
    configHash,
    generation,
    startedAt: '',
    processIdentity: readProcessIdentity(proc.pid) ?? undefined,
  };
  const ready = await waitForDaemonReady(
    serverName,
    expected,
    timeoutMs,
    () => !spawnError && !exited,
  );
  if (ready) return ready;

  if (spawnError) {
    debug(
      `[daemon-client] Spawn failed for ${serverName}: ${spawnError.message}`,
    );
  } else if (exited) {
    debug(`[daemon-client] Daemon exited before readiness for ${serverName}`);
  } else {
    debug(`[daemon-client] Daemon startup timed out for ${serverName}`);
  }

  const pidInfo = readPidFile(serverName);
  if (pidInfo && daemonIdentityMatches(pidInfo, expected)) {
    await stopDaemon(serverName, pidInfo, ownership);
  } else if (!exited && isProcessRunning(proc.pid)) {
    terminateDaemonProcess(expected);
    await waitForDaemonExit(expected, 1000);
  }
  return null;
}

function acquireClaim(
  serverName: string,
  configHash: string,
): DaemonClaimFileContent | null {
  const claim: DaemonClaimFileContent = {
    ownerPid: process.pid,
    generation: randomUUID(),
    configHash,
    startedAt: new Date().toISOString(),
    serverName,
  };
  return writeOwnershipFileExclusive(getDaemonClaimPath(serverName), claim)
    ? claim
    : null;
}

function removeStaleOwnershipFile(path: string): boolean {
  const ownership = readOwnershipFilePath(path);
  const ageMs = getOwnershipFileAgeMs(path);
  if (ageMs === null) return false;
  if (!ownership) {
    return removeMalformedOwnershipFile(path, DEAD_OWNER_GRACE_MS);
  }
  if (isProcessRunning(ownership.ownerPid) || ageMs < DEAD_OWNER_GRACE_MS) {
    return false;
  }
  return removeOwnershipFile(path, ownership.generation);
}

function claimIsOwned(path: string, claim: DaemonClaimFileContent): boolean {
  return readOwnershipFilePath(path)?.generation === claim.generation;
}

async function listActiveLeases(
  serverName: string,
): Promise<DaemonLeaseFileContent[]> {
  const prefix = getDaemonLeasePrefix(serverName);
  const directory = dirname(prefix);
  const filePrefix = basename(prefix);
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) =>
      file.startsWith(filePrefix),
    );
  } catch {
    return [];
  }

  const active: DaemonLeaseFileContent[] = [];
  for (const file of files) {
    const path = join(directory, file);
    const ownership = readOwnershipFilePath(path);
    if (!ownership || !('daemonGeneration' in ownership)) {
      removeStaleOwnershipFile(path);
      continue;
    }
    if (!isProcessRunning(ownership.ownerPid)) {
      removeStaleOwnershipFile(path);
      continue;
    }
    active.push(ownership);
  }
  return active;
}

function createLease(
  serverName: string,
  identity: DaemonIdentity,
): { path: string; lease: DaemonLeaseFileContent } {
  for (;;) {
    const lease: DaemonLeaseFileContent = {
      ownerPid: process.pid,
      generation: randomUUID(),
      daemonGeneration: identity.generation,
      configHash: identity.configHash,
      startedAt: new Date().toISOString(),
      serverName,
    };
    const path = `${getDaemonLeasePrefix(serverName)}${lease.generation}`;
    if (writeOwnershipFileExclusive(path, lease)) return { path, lease };
  }
}

async function ensureDaemonAsOwner(
  serverName: string,
  config: ServerConfig,
  configHash: string,
  claim: DaemonClaimFileContent,
  deadline: number,
): Promise<DaemonIdentity | null> {
  const remaining = () => Math.max(0, deadline - Date.now());
  const claimPath = getDaemonClaimPath(serverName);
  const ownership: DaemonStateOwnership = {
    path: claimPath,
    generation: claim.generation,
  };
  if (!claimIsOwned(claimPath, claim)) return null;
  let pidInfo = readPidFile(serverName);

  if (
    pidInfo &&
    (!isProcessRunning(pidInfo.pid) ||
      (pidInfo.processIdentity && !daemonProcessIdentityMatches(pidInfo)))
  ) {
    const removed = removeDaemonState(serverName, pidInfo, ownership);
    if (!removed) return null;
    pidInfo = null;
  }

  if (pidInfo && isProcessRunning(pidInfo.pid)) {
    if (isCompletePidInfo(pidInfo) && pidInfo.configHash === configHash) {
      const ready = await waitForDaemonReady(
        serverName,
        pidInfo,
        remaining(),
        () => isProcessRunning(pidInfo?.pid ?? 0),
      );
      if (ready) return ready;
    }

    while ((await listActiveLeases(serverName)).length > 0) {
      if (remaining() <= 0 || !claimIsOwned(claimPath, claim)) return null;
      await sleep(OWNERSHIP_POLL_MS);
    }

    if (!claimIsOwned(claimPath, claim)) return null;
    const stopped = isCompletePidInfo(pidInfo)
      ? await stopDaemon(serverName, pidInfo, ownership)
      : await stopLegacyDaemon(serverName, pidInfo, ownership);
    if (!stopped) return null;
  } else if (!(await stopUntrackedEndpoint(serverName, ownership))) {
    return null;
  }

  if (remaining() <= 0 || !claimIsOwned(claimPath, claim)) return null;
  const generation = randomUUID();
  return spawnDaemon(
    serverName,
    config,
    configHash,
    generation,
    remaining(),
    ownership,
  );
}

function createDaemonConnection(
  serverName: string,
  identity: DaemonIdentity,
  leasePath: string,
  lease: DaemonLeaseFileContent,
): DaemonConnection {
  const socketPath = getSocketPath(serverName);
  let closed = false;
  const request = async (
    requestValue: DaemonRequest,
  ): Promise<DaemonResponse> => {
    if (closed) throw new Error('Daemon connection is closed');
    return sendRequest(socketPath, {
      ...requestValue,
      generation: identity.generation,
    });
  };

  return {
    serverName,
    async listTools(): Promise<unknown> {
      const response = await request({
        id: generateRequestId(),
        type: 'listTools',
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'listTools failed');
      }
      return response.data;
    },
    async callTool(
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<unknown> {
      const response = await request({
        id: generateRequestId(),
        type: 'callTool',
        toolName,
        args,
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'callTool failed');
      }
      return response.data;
    },
    async getInstructions(): Promise<string | undefined> {
      const response = await request({
        id: generateRequestId(),
        type: 'getInstructions',
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'getInstructions failed');
      }
      return response.data as string | undefined;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      removeOwnershipFile(leasePath, lease.generation);
      debug(`[daemon-client] Released ${serverName} daemon lease`);
    },
  };
}

/**
 * Converge independent callers on one matching daemon, or return null so the
 * caller can use its existing direct-connection fallback.
 */
export async function getDaemonConnection(
  serverName: string,
  config: ServerConfig,
): Promise<DaemonConnection | null> {
  const configHash = getConfigHash(config);
  const deadline = Date.now() + getDaemonRequestTimeoutMs();
  const claimPath = getDaemonClaimPath(serverName);

  while (Date.now() < deadline) {
    const claim = acquireClaim(serverName, configHash);
    if (!claim) {
      removeStaleOwnershipFile(claimPath);
      await sleep(OWNERSHIP_POLL_MS);
      continue;
    }

    try {
      const identity = await ensureDaemonAsOwner(
        serverName,
        config,
        configHash,
        claim,
        deadline,
      );
      if (!identity) {
        if (Date.now() < deadline) continue;
        return null;
      }
      if (!claimIsOwned(claimPath, claim)) continue;
      const { path, lease } = createLease(serverName, identity);
      debug(
        `[daemon-client] Connected to ${serverName} generation ${identity.generation}`,
      );
      return createDaemonConnection(serverName, identity, path, lease);
    } finally {
      removeOwnershipFile(claimPath, claim.generation);
    }
  }

  debug(
    `[daemon-client] Timed out waiting for daemon ownership: ${serverName}`,
  );
  return null;
}

/** Clean dead daemon metadata and abandoned ownership files on CLI startup. */
export async function cleanupOrphanedDaemons(): Promise<void> {
  const socketDir = getSocketDir();
  if (!existsSync(socketDir)) return;

  try {
    const files = await readdir(socketDir);
    for (const file of files) {
      const path = join(socketDir, file);
      if (
        file.endsWith('.lock') ||
        file.includes('.lease-') ||
        file.includes('.delete-') ||
        file.includes('.publish-')
      ) {
        removeStaleOwnershipFile(path);
        continue;
      }
      if (!file.endsWith('.pid')) continue;

      const pidInfo = readPidFilePath(path);
      if (
        !pidInfo ||
        (isProcessRunning(pidInfo.pid) &&
          (!pidInfo.processIdentity || daemonProcessIdentityMatches(pidInfo)))
      ) {
        continue;
      }
      const serverName = pidInfo.serverName;
      if (serverName) {
        const claim = acquireClaim(serverName, pidInfo.configHash);
        if (!claim) continue;
        const ownership: DaemonStateOwnership = {
          path: getDaemonClaimPath(serverName),
          generation: claim.generation,
        };
        try {
          const current = readPidFilePath(path);
          if (!pidFileIdentityMatches(current, pidInfo)) continue;
          if (path === getPidPath(serverName)) {
            removeDaemonState(serverName, pidInfo, ownership);
          } else {
            // Legacy endpoint names cannot be bound to a modern generation.
            // Remove only their atomically acquired dead PID metadata.
            removePidFilePath(path, pidInfo);
          }
        } finally {
          removeOwnershipFile(ownership.path, ownership.generation);
        }
      }
    }
  } catch {
    // Cleanup is opportunistic; connection setup performs exact recovery.
  }
}
