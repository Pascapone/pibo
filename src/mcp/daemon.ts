/**
 * MCP-CLI Daemon - Background worker that maintains persistent MCP connections
 *
 * This is spawned as a detached process and manages a Unix socket on POSIX or
 * a named pipe on Windows. It maintains the MCP server connection and forwards
 * requests from CLI invocations.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
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
}

export interface PidFileContent extends DaemonIdentity {
  serverName?: string;
}

export interface DaemonClaimFileContent {
  ownerPid: number;
  generation: string;
  configHash: string;
  startedAt: string;
  serverName: string;
}

export interface DaemonLeaseFileContent {
  ownerPid: number;
  generation: string;
  daemonGeneration: string;
  configHash: string;
  startedAt: string;
  serverName: string;
}

export type DaemonOwnershipFileContent =
  DaemonClaimFileContent | DaemonLeaseFileContent;

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

/**
 * Remove PID file
 */
export function removePidFile(
  serverName: string,
  expected?: PidFileContent,
): boolean {
  const pidPath = getPidPath(serverName);
  try {
    const current = readPidFilePath(pidPath);
    if (
      !current ||
      (expected &&
        (current.pid !== expected.pid ||
          current.configHash !== expected.configHash ||
          current.generation !== expected.generation))
    ) {
      return false;
    }
    unlinkSync(pidPath);
    return true;
  } catch {
    // Ignore errors during cleanup
    return false;
  }
}

export function writeOwnershipFileExclusive(
  path: string,
  content: DaemonOwnershipFileContent,
): boolean {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    writeFileSync(path, JSON.stringify(content), {
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
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

export function removeOwnershipFile(
  path: string,
  expectedGeneration: string,
): boolean {
  const quarantinePath = `${path}.delete-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
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
    try {
      if (existsSync(quarantinePath) && !existsSync(path)) {
        renameSync(quarantinePath, path);
      }
    } catch {
      // A newer owner may already occupy the canonical path.
    }
    return false;
  }
}

/**
 * Remove socket file
 */
export function removeSocketFile(serverName: string): void {
  if (!usesFilesystemSocket()) {
    return;
  }

  const socketPath = getSocketPath(serverName);
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
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

/**
 * Kill a process by PID
 */
export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
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

    // A daemon may only remove metadata and the endpoint that still belong to
    // its own generation. A delayed loser must never clobber its replacement.
    if (identity && daemonIdentityMatches(readPidFile(serverName), identity)) {
      removeSocketFile(serverName);
      removePidFile(serverName, identity);
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
