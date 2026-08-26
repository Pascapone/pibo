/**
 * MCP-CLI Daemon - Background worker that maintains persistent MCP connections
 *
 * This is spawned as a detached process and manages a Unix socket on POSIX or
 * a named pipe on Windows. It maintains the MCP server connection and forwards
 * requests from CLI invocations.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  futimesSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import {
  type ConnectedClient,
  callTool,
  connectToServer,
  listTools,
} from './client.js';
import {
  type ServerConfig,
  debug,
  getConfigHash,
  getDaemonClaimPath,
  getDaemonTimeoutMs,
  getPidPath,
  getSocketDir,
  getSocketPath,
  usesFilesystemSocket,
} from './config.js';

// ============================================================================
// Types
// ============================================================================

export interface DaemonRequest {
  id: string;
  type: 'listTools' | 'callTool' | 'ping' | 'close' | 'getInstructions';
  generation?: string;
  toolName?: string;
  args?: Record<string, unknown>;
}

export interface DaemonResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface DaemonIdentity {
  pid: number;
  configHash: string;
  generation: string;
  startedAt: string;
  processIdentity?: ProcessIdentity;
}

export interface ProcessIdentity {
  platform: NodeJS.Platform;
  startToken: string;
  executable: string;
  commandHash: string;
}

export interface PidFileContent extends DaemonIdentity {
  serverName?: string;
}

export interface DaemonClaimFileContent {
  ownerPid: number;
  ownerProcessIdentity?: ProcessIdentity;
  ownerNonce?: string;
  generation: string;
  configHash: string;
  startedAt: string;
  serverName: string;
}

export interface DaemonLeaseFileContent {
  ownerPid: number;
  ownerProcessIdentity?: ProcessIdentity;
  ownerNonce?: string;
  generation: string;
  daemonGeneration: string;
  configHash: string;
  startedAt: string;
  serverName: string;
}

export type DaemonOwnershipFileContent =
  DaemonClaimFileContent | DaemonLeaseFileContent;

export interface DaemonStateOwnership {
  path: string;
  generation: string;
}

interface FileIdentity {
  device: number;
  inode: number;
  size: number;
  modifiedAt: number;
}

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Read an OS process creation identity that changes when a PID is reused.
 * Linux exposes the kernel start tick, executable, and argv through procfs.
 * Other platforms fail closed: callers may request graceful endpoint shutdown,
 * but they must not authorize a PID signal from unverifiable metadata.
 */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(') ');
    if (commandEnd === -1) return null;
    const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const startToken = fieldsAfterCommand[19];
    if (!startToken) return null;
    return {
      platform: 'linux',
      startToken,
      executable: readlinkSync(`/proc/${pid}/exe`),
      commandHash: hashBuffer(readFileSync(`/proc/${pid}/cmdline`)),
    };
  } catch {
    return null;
  }
}

export function processIdentityMatches(
  actual: ProcessIdentity | null | undefined,
  expected: ProcessIdentity | null | undefined,
): boolean {
  return Boolean(
    actual &&
    expected &&
    actual.platform === expected.platform &&
    actual.startToken === expected.startToken &&
    actual.executable === expected.executable &&
    actual.commandHash === expected.commandHash,
  );
}

export function daemonProcessIdentityMatches(
  expected: DaemonIdentity,
): boolean {
  return processIdentityMatches(
    readProcessIdentity(expected.pid),
    expected.processIdentity,
  );
}

function getFileIdentity(path: string): FileIdentity | null {
  try {
    const stat = statSync(path);
    return {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function fileIdentityMatches(
  actual: FileIdentity | null,
  expected: FileIdentity | null,
): boolean {
  return Boolean(
    actual &&
    expected &&
    actual.device === expected.device &&
    actual.inode === expected.inode &&
    actual.size === expected.size &&
    actual.modifiedAt === expected.modifiedAt,
  );
}

function getQuarantinePath(path: string): string {
  return `${path}.delete-${process.pid}-${Date.now()}-${randomUUID()}`;
}

function restoreQuarantinedFile(path: string, quarantinePath: string): void {
  try {
    if (existsSync(quarantinePath) && !existsSync(path)) {
      renameSync(quarantinePath, path);
    }
  } catch {
    // A newer owner may already occupy the canonical path.
  }
}

// ============================================================================
// PID File Management
// ============================================================================

/**
 * Write PID file with config hash for stale detection
 */
export function writePidFile(
  serverName: string,
  configHash: string,
  generation: string,
): PidFileContent {
  const pidPath = getPidPath(serverName);
  const dir = dirname(pidPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const content: PidFileContent = {
    pid: process.pid,
    configHash,
    generation,
    startedAt: new Date().toISOString(),
    serverName,
    processIdentity: readProcessIdentity(process.pid) ?? undefined,
  };

  writeFileSync(pidPath, JSON.stringify(content), {
    flag: 'wx',
    mode: 0o600,
  });
  return content;
}

/**
 * Read PID file content
 */
export function readPidFilePath(pidPath: string): PidFileContent | null {
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const content = readFileSync(pidPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function readPidFile(serverName: string): PidFileContent | null {
  return readPidFilePath(getPidPath(serverName));
}

export function daemonIdentityMatches(
  actual: DaemonIdentity | null | undefined,
  expected: DaemonIdentity | null | undefined,
): boolean {
  return Boolean(
    actual &&
    expected &&
    actual.pid === expected.pid &&
    actual.configHash === expected.configHash &&
    actual.generation === expected.generation,
  );
}

export function pidFileIdentityMatches(
  actual: PidFileContent | null | undefined,
  expected: PidFileContent | null | undefined,
): boolean {
  return Boolean(
    daemonIdentityMatches(actual, expected) &&
    actual?.startedAt === expected?.startedAt &&
    actual?.serverName === expected?.serverName &&
    ((actual?.processIdentity === undefined &&
      expected?.processIdentity === undefined) ||
      processIdentityMatches(
        actual?.processIdentity,
        expected?.processIdentity,
      )),
  );
}

function quarantinePidFilePath(
  pidPath: string,
  expected?: PidFileContent,
): string | null {
  const quarantinePath = getQuarantinePath(pidPath);
  try {
    const current = readPidFilePath(pidPath);
    if (!current || (expected && !pidFileIdentityMatches(current, expected))) {
      return null;
    }
    renameSync(pidPath, quarantinePath);
    const moved = readPidFilePath(quarantinePath);
    if (moved && (!expected || pidFileIdentityMatches(moved, expected))) {
      return quarantinePath;
    }
    restoreQuarantinedFile(pidPath, quarantinePath);
    return null;
  } catch {
    restoreQuarantinedFile(pidPath, quarantinePath);
    return null;
  }
}

export function removePidFilePath(
  pidPath: string,
  expected?: PidFileContent,
): boolean {
  const quarantinePath = quarantinePidFilePath(pidPath, expected);
  if (!quarantinePath) return false;
  try {
    unlinkSync(quarantinePath);
    return true;
  } catch {
    restoreQuarantinedFile(pidPath, quarantinePath);
    return false;
  }
}

/**
 * Remove PID file
 */
export function removePidFile(
  serverName: string,
  expected?: PidFileContent,
): boolean {
  return removePidFilePath(getPidPath(serverName), expected);
}

export function writeOwnershipFileExclusive(
  path: string,
  content: DaemonOwnershipFileContent,
): boolean {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const publicationPath = `${path}.publish-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(publicationPath, JSON.stringify(content), {
      flag: 'wx',
      mode: 0o600,
    });
    linkSync(publicationPath, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  } finally {
    try {
      unlinkSync(publicationPath);
    } catch {
      // The temporary publication name may never have been created.
    }
  }
}

export function readOwnershipFilePath(
  path: string,
): DaemonOwnershipFileContent | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function getOwnershipFileAgeMs(path: string): number | null {
  try {
    return Math.max(0, Date.now() - statSync(path).mtimeMs);
  } catch {
    return null;
  }
}

/**
 * Refresh one ownership generation through an opened inode. A concurrent path
 * replacement is never refreshed because the descriptor remains bound to the
 * original file and the canonical inode is checked before reporting success.
 */
export function refreshOwnershipFile(
  path: string,
  expectedGeneration: string,
  expectedOwnerNonce?: string,
): boolean {
  let handle: number | undefined;
  try {
    handle = openSync(path, 'r');
    const opened = fstatSync(handle);
    const current = JSON.parse(
      readFileSync(handle, { encoding: 'utf8' }),
    ) as DaemonOwnershipFileContent;
    if (
      current.generation !== expectedGeneration ||
      (expectedOwnerNonce !== undefined &&
        current.ownerNonce !== expectedOwnerNonce)
    ) {
      return false;
    }

    const now = new Date();
    futimesSync(handle, now, now);
    const canonical = statSync(path);
    return canonical.dev === opened.dev && canonical.ino === opened.ino;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        // A failed close cannot make the ownership refresh authoritative.
      }
    }
  }
}

export function removeOwnershipFile(
  path: string,
  expectedGeneration: string,
): boolean {
  const quarantinePath = getQuarantinePath(path);
  try {
    const current = readOwnershipFilePath(path);
    if (!current || current.generation !== expectedGeneration) {
      return false;
    }
    // Rename is the atomic compare-and-delete boundary. If another process
    // replaced the path after our first read, inspect the moved file and put it
    // back instead of unlinking that process's ownership record.
    renameSync(path, quarantinePath);
    const moved = readOwnershipFilePath(quarantinePath);
    if (moved?.generation === expectedGeneration) {
      unlinkSync(quarantinePath);
      return true;
    }
    if (!existsSync(path)) renameSync(quarantinePath, path);
    return false;
  } catch {
    restoreQuarantinedFile(path, quarantinePath);
    return false;
  }
}

/** Remove an old malformed ownership file without racing a replacement. */
export function removeMalformedOwnershipFile(
  path: string,
  minimumAgeMs: number,
): boolean {
  const expectedFileIdentity = getFileIdentity(path);
  const ageMs = getOwnershipFileAgeMs(path);
  if (
    !expectedFileIdentity ||
    ageMs === null ||
    ageMs < minimumAgeMs ||
    readOwnershipFilePath(path) !== null
  ) {
    return false;
  }

  const quarantinePath = getQuarantinePath(path);
  try {
    renameSync(path, quarantinePath);
    if (
      readOwnershipFilePath(quarantinePath) === null &&
      fileIdentityMatches(getFileIdentity(quarantinePath), expectedFileIdentity)
    ) {
      unlinkSync(quarantinePath);
      return true;
    }
    restoreQuarantinedFile(path, quarantinePath);
    return false;
  } catch {
    restoreQuarantinedFile(path, quarantinePath);
    return false;
  }
}

/**
 * Remove socket file
 */
export function removeSocketFile(serverName: string): boolean {
  if (!usesFilesystemSocket()) {
    return true;
  }

  const socketPath = getSocketPath(serverName);
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
    return true;
  } catch {
    return false;
  }
}

export function daemonStateOwnershipMatches(
  ownership: DaemonStateOwnership,
): boolean {
  return (
    readOwnershipFilePath(ownership.path)?.generation === ownership.generation
  );
}

/**
 * Atomically acquire one matching PID generation before deleting its endpoint.
 * The caller must hold the per-server ownership claim for the whole operation.
 */
export function removeDaemonState(
  serverName: string,
  expected: PidFileContent,
  ownership: DaemonStateOwnership,
): boolean {
  if (!daemonStateOwnershipMatches(ownership)) return false;
  const pidPath = getPidPath(serverName);
  const quarantinePath = quarantinePidFilePath(pidPath, expected);
  if (!quarantinePath) return false;

  if (!daemonStateOwnershipMatches(ownership) || existsSync(pidPath)) {
    if (existsSync(pidPath)) {
      try {
        unlinkSync(quarantinePath);
      } catch {
        // A later cleanup can remove the quarantined old generation.
      }
    } else {
      restoreQuarantinedFile(pidPath, quarantinePath);
    }
    return false;
  }

  if (!removeSocketFile(serverName)) {
    restoreQuarantinedFile(pidPath, quarantinePath);
    return false;
  }

  try {
    unlinkSync(quarantinePath);
    return true;
  } catch {
    // The endpoint is already gone. Keep the old PID generation unavailable
    // rather than republishing metadata for a stopped daemon.
    return false;
  }
}

export function removeUntrackedEndpoint(
  serverName: string,
  ownership: DaemonStateOwnership,
): boolean {
  if (
    !daemonStateOwnershipMatches(ownership) ||
    existsSync(getPidPath(serverName))
  ) {
    return false;
  }
  return removeSocketFile(serverName);
}

/**
 * Check if a process is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signal only the process creation identity recorded by the daemon itself. */
export function terminateDaemonProcess(expected: DaemonIdentity): boolean {
  if (!daemonProcessIdentityMatches(expected)) return false;
  try {
    process.kill(expected.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Daemon Worker
// ============================================================================

/**
 * Main daemon entry point - run as detached background process
 */
export async function runDaemon(
  serverName: string,
  config: ServerConfig,
  generation: string,
): Promise<void> {
  const socketPath = getSocketPath(serverName);
  const configHash = getConfigHash(config);
  const timeoutMs = getDaemonTimeoutMs();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let mcpClient: ConnectedClient | null = null;
  let server: Server | null = null;
  const activeConnections = new Set<Socket>();
  let identity: PidFileContent | null = null;
  let cleanupPromise: Promise<void> | null = null;

  // Cleanup function
  const performCleanup = async () => {
    debug(`[daemon:${serverName}] Shutting down...`);

    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    // Close all active socket connections
    for (const conn of activeConnections) {
      try {
        conn.end();
      } catch {
        // Ignore
      }
    }
    activeConnections.clear();

    // Close MCP connection
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch {
        // Ignore
      }
      mcpClient = null;
    }

    // Close socket server
    if (server) {
      try {
        server.close();
      } catch {
        // Ignore
      }
      server = null;
    }

    // Self-cleanup uses the same per-server ownership boundary as elected
    // clients. If another owner is replacing this daemon, leave cleanup to it.
    if (identity) {
      const claimPath = getDaemonClaimPath(serverName);
      const cleanupClaim: DaemonClaimFileContent = {
        ownerPid: process.pid,
        generation: randomUUID(),
        configHash: identity.configHash,
        startedAt: new Date().toISOString(),
        serverName,
      };
      if (writeOwnershipFileExclusive(claimPath, cleanupClaim)) {
        try {
          removeDaemonState(serverName, identity, {
            path: claimPath,
            generation: cleanupClaim.generation,
          });
        } finally {
          removeOwnershipFile(claimPath, cleanupClaim.generation);
        }
      }
    }

    debug(`[daemon:${serverName}] Cleanup complete`);
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= performCleanup();
    return cleanupPromise;
  };

  // Reset idle timer
  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(async () => {
      debug(`[daemon:${serverName}] Idle timeout reached, shutting down`);
      await cleanup();
      process.exit(0);
    }, timeoutMs);
  };

  // Handle signals
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  // Ensure socket dir exists
  const socketDir = getSocketDir();
  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  }

  // The spawning client owns the startup claim and removes stale state before
  // launch. Exclusive PID creation makes an ownership bug fail closed.
  identity = writePidFile(serverName, configHash, generation);

  // Connect to MCP server
  try {
    debug(`[daemon:${serverName}] Connecting to MCP server...`);
    mcpClient = await connectToServer(serverName, config);
    debug(`[daemon:${serverName}] Connected to MCP server`);
  } catch (error) {
    console.error(
      `[daemon:${serverName}] Failed to connect:`,
      (error as Error).message,
    );
    await cleanup();
    process.exit(1);
  }

  // Handle incoming request
  const handleRequest = async (data: Buffer): Promise<DaemonResponse> => {
    resetIdleTimer();

    let request: DaemonRequest;
    try {
      request = JSON.parse(data.toString());
    } catch {
      return {
        id: 'unknown',
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid JSON' },
      };
    }

    debug(`[daemon:${serverName}] Request: ${request.type} (${request.id})`);

    if (
      request.type !== 'ping' &&
      request.generation !== identity?.generation
    ) {
      return {
        id: request.id,
        success: false,
        error: {
          code: 'STALE_DAEMON_GENERATION',
          message: 'Daemon generation changed; reconnect before retrying',
        },
      };
    }

    if (!mcpClient) {
      return {
        id: request.id,
        success: false,
        error: { code: 'NOT_CONNECTED', message: 'MCP client not connected' },
      };
    }

    try {
      switch (request.type) {
        case 'ping':
          return { id: request.id, success: true, data: identity };

        case 'listTools': {
          const tools = await listTools(mcpClient.client);
          return { id: request.id, success: true, data: tools };
        }

        case 'callTool': {
          if (!request.toolName) {
            return {
              id: request.id,
              success: false,
              error: { code: 'MISSING_TOOL', message: 'toolName required' },
            };
          }
          const result = await callTool(
            mcpClient.client,
            request.toolName,
            request.args ?? {},
          );
          return { id: request.id, success: true, data: result };
        }

        case 'getInstructions': {
          const instructions = mcpClient.client.getInstructions();
          return { id: request.id, success: true, data: instructions };
        }

        case 'close':
          // Graceful shutdown requested
          setTimeout(async () => {
            await cleanup();
            process.exit(0);
          }, 100);
          return { id: request.id, success: true, data: 'closing' };

        default:
          return {
            id: request.id,
            success: false,
            error: {
              code: 'UNKNOWN_TYPE',
              message: `Unknown request type: ${request.type}`,
            },
          };
      }
    } catch (error) {
      const err = error as Error;
      return {
        id: request.id,
        success: false,
        error: { code: 'EXECUTION_ERROR', message: err.message },
      };
    }
  };

  // Start the Unix domain socket or Windows named-pipe server
  try {
    server = createServer((socket) => {
      activeConnections.add(socket);
      debug(`[daemon:${serverName}] Client connected`);

      let requestBuffer = '';
      socket.setEncoding('utf8');
      socket.on('data', async (data) => {
        requestBuffer += data;
        if (requestBuffer.length > 1024 * 1024) {
          socket.destroy(new Error('Daemon request exceeds 1 MiB'));
          return;
        }
        while (requestBuffer.includes('\n')) {
          const newlineIndex = requestBuffer.indexOf('\n');
          const requestText = requestBuffer.slice(0, newlineIndex);
          requestBuffer = requestBuffer.slice(newlineIndex + 1);
          if (!requestText.trim()) continue;
          const response = await handleRequest(Buffer.from(requestText));
          socket.write(`${JSON.stringify(response)}\n`);
        }
      });

      socket.on('close', () => {
        activeConnections.delete(socket);
        debug(`[daemon:${serverName}] Client disconnected`);
      });

      socket.on('error', (error) => {
        debug(`[daemon:${serverName}] Socket error: ${error.message}`);
        activeConnections.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(socketPath, () => {
        server?.off('error', reject);
        resolve();
      });
    });

    debug(`[daemon:${serverName}] Listening on ${socketPath}`);

    // Start idle timer
    resetIdleTimer();

    // The client detects readiness by pinging the IPC endpoint.
  } catch (error) {
    console.error(
      `[daemon:${serverName}] Failed to start socket server:`,
      (error as Error).message,
    );
    await cleanup();
    process.exit(1);
  }
}

// ============================================================================
// Entry point when run directly
// ============================================================================

// Check if running as daemon process
if (process.argv[2] === '--daemon') {
  const serverName = process.argv[3];
  const configJson = process.argv[4];
  const generation = process.argv[5];

  if (!serverName || !configJson || !generation) {
    console.error(
      'Usage: daemon.ts --daemon <serverName> <configJson> <generation>',
    );
    process.exit(1);
  }

  let config: ServerConfig;
  try {
    config = JSON.parse(configJson);
  } catch {
    console.error('Invalid config JSON');
    process.exit(1);
  }

  runDaemon(serverName, config, generation).catch((error) => {
    console.error('Daemon failed:', error);
    process.exit(1);
  });
}
