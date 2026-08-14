/**
 * MCP-CLI Daemon Client - IPC client for communicating with daemon workers
 *
 * Handles spawning daemons, detecting stale connections, and forwarding requests.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ServerConfig,
  debug,
  getConfigHash,
  getDaemonRequestTimeoutMs,
  getSocketDir,
  getSocketPath,
  usesFilesystemSocket,
} from './config.js';
import {
  type DaemonRequest,
  type DaemonResponse,
  isProcessRunning,
  killProcess,
  readPidFile,
  readPidFilePath,
  removePidFile,
  removeSocketFile,
} from './daemon.js';

// ============================================================================
// Daemon Connection
// ============================================================================

/**
 * Represents a daemon connection for a specific server
 */
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

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Send a request to the daemon and wait for response
 */
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
      socket.write(JSON.stringify(request));
    });

    socket.on('data', (data) => {
      responseText += data.toString();
      if (responseText.includes('\n')) {
        settle(() => {
          try {
            resolve(JSON.parse(responseText.trim()));
          } catch {
            reject(new Error('Invalid response from daemon'));
          } finally {
            socket.end();
          }
        });
      }
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

async function stopDaemon(serverName: string, pid: number): Promise<void> {
  const socketPath = getSocketPath(serverName);

  if (!usesFilesystemSocket() || existsSync(socketPath)) {
    try {
      await sendRequest(
        socketPath,
        { id: generateRequestId(), type: 'close' },
        1000,
      );
    } catch {
      // The daemon may not have opened its IPC endpoint yet.
    }
  }

  const gracefulDeadline = Date.now() + 2000;
  while (Date.now() < gracefulDeadline && isProcessRunning(pid)) {
    await sleep(50);
  }
  if (isProcessRunning(pid)) {
    killProcess(pid);
  }

  removePidFile(serverName);
  removeSocketFile(serverName);
}

/**
 * Check if daemon is running and has matching config.
 */
async function isDaemonValid(
  serverName: string,
  config: ServerConfig,
): Promise<boolean> {
  const pidInfo = readPidFile(serverName);

  // No PID file = no daemon
  if (!pidInfo) {
    debug(`[daemon-client] No PID file for ${serverName}`);
    return false;
  }

  // Check if process is actually running
  if (!isProcessRunning(pidInfo.pid)) {
    debug(`[daemon-client] Process ${pidInfo.pid} not running, cleaning up`);
    removePidFile(serverName);
    removeSocketFile(serverName);
    return false;
  }

  // Check if config matches
  const currentHash = getConfigHash(config);
  if (pidInfo.configHash !== currentHash) {
    debug(
      `[daemon-client] Config hash mismatch for ${serverName}, stopping old daemon`,
    );
    await stopDaemon(serverName, pidInfo.pid);
    return false;
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDaemonReady(
  socketPath: string,
  timeoutMs: number,
  isAlive: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && isAlive()) {
    if (!usesFilesystemSocket() || existsSync(socketPath)) {
      try {
        const remainingMs = deadline - Date.now();
        const response = await sendRequest(
          socketPath,
          { id: generateRequestId(), type: 'ping' },
          Math.max(1, Math.min(500, remainingMs)),
        );
        if (response.success) {
          return true;
        }
      } catch {
        // The daemon may still be starting or waiting for user authorization.
      }
    }
    await sleep(50);
  }

  return false;
}

/**
 * Spawn a new daemon process for a server.
 */
async function spawnDaemon(
  serverName: string,
  config: ServerConfig,
): Promise<boolean> {
  debug(`[daemon-client] Spawning daemon for ${serverName}`);

  // Find the daemon script next to this module. This is .ts under tsx and .js after build.
  const modulePath = fileURLToPath(import.meta.url);
  const daemonScript = join(dirname(modulePath), `daemon${extname(modulePath)}`);
  const socketPath = getSocketPath(serverName);
  const configJson = JSON.stringify(config);

  // Ignore stdio so the daemon remains independent after the invoking CLI exits.
  // Readiness is detected through its actual IPC endpoint instead of a pipe that
  // would be closed with the parent process.
  const proc = spawn(
    process.execPath,
    [
      ...process.execArgv,
      daemonScript,
      '--daemon',
      serverName,
      configJson,
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    },
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

  const ready = await waitForDaemonReady(
    socketPath,
    getDaemonRequestTimeoutMs(),
    () => !spawnError && !exited,
  );
  if (ready) {
    return true;
  }

  if (spawnError) {
    debug(
      `[daemon-client] Failed to spawn daemon for ${serverName}: ${spawnError.message}`,
    );
  } else if (exited) {
    debug(`[daemon-client] Daemon exited before readiness for ${serverName}`);
  } else {
    debug(`[daemon-client] Daemon spawn timeout for ${serverName}`);
    if (proc.pid !== undefined) {
      await stopDaemon(serverName, proc.pid);
    }
  }
  removePidFile(serverName);
  removeSocketFile(serverName);
  return false;
}

/**
 * Get or create a daemon connection for a server
 * Returns null if daemon mode fails (caller should fallback to direct connection)
 */
export async function getDaemonConnection(
  serverName: string,
  config: ServerConfig,
): Promise<DaemonConnection | null> {
  const socketPath = getSocketPath(serverName);

  // Check if a matching daemon exists; otherwise start one.
  let ready = false;
  if (!(await isDaemonValid(serverName, config))) {
    ready = await spawnDaemon(serverName, config);
    if (!ready) {
      debug(`[daemon-client] Failed to spawn daemon for ${serverName}`);
      return null;
    }
  } else {
    const pidInfo = readPidFile(serverName);
    ready = await waitForDaemonReady(
      socketPath,
      getDaemonRequestTimeoutMs(),
      () => Boolean(pidInfo && isProcessRunning(pidInfo.pid)),
    );
  }

  if (!ready) {
    debug(`[daemon-client] Daemon did not become ready for ${serverName}`);
    const pidInfo = readPidFile(serverName);
    if (pidInfo) {
      await stopDaemon(serverName, pidInfo.pid);
    } else {
      removeSocketFile(serverName);
    }
    return null;
  }

  debug(`[daemon-client] Connected to daemon for ${serverName}`);

  // Return connection interface
  return {
    serverName,

    async listTools(): Promise<unknown> {
      const response = await sendRequest(socketPath, {
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
      const response = await sendRequest(socketPath, {
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
      const response = await sendRequest(socketPath, {
        id: generateRequestId(),
        type: 'getInstructions',
      });

      if (!response.success) {
        throw new Error(response.error?.message ?? 'getInstructions failed');
      }

      return response.data as string | undefined;
    },

    async close(): Promise<void> {
      // Just disconnect, don't tell daemon to close (let it idle timeout)
      debug(`[daemon-client] Disconnecting from ${serverName} daemon`);
    },
  };
}

/**
 * Clean up any orphaned daemon processes and sockets
 * Call this on CLI startup
 */
export async function cleanupOrphanedDaemons(): Promise<void> {
  const socketDir = getSocketDir();

  if (!existsSync(socketDir)) {
    return;
  }

  try {
    const files = (await readdir(socketDir)).filter((file) =>
      file.endsWith('.pid'),
    );

    for (const file of files) {
      const pidInfo = readPidFilePath(join(socketDir, file));
      let serverName = pidInfo?.serverName;
      if (!serverName) {
        try {
          serverName = decodeURIComponent(file.slice(0, -'.pid'.length));
        } catch {
          continue;
        }
      }

      if (pidInfo && !isProcessRunning(pidInfo.pid)) {
        debug(`[daemon-client] Cleaning up orphaned daemon: ${serverName}`);
        removePidFile(serverName);
        removeSocketFile(serverName);
      }
    }
  } catch {
    // Ignore errors during cleanup scan
  }
}
