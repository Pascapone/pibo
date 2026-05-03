import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	clearFallbackPidFile,
	readFallbackPidFile,
} from "./pidfile.js";

export const FALLBACK_GATEWAY_PORT = 4790;
export const FALLBACK_WEB_PORT = 4791;
const BACKUP_DIR = join(homedir(), ".pibo", "stable");

function isPortReachable(host: string, port: number, timeout = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(port, host);
		const onError = () => {
			socket.destroy();
			resolve(false);
		};
		socket.setTimeout(timeout);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", onError);
		socket.once("timeout", onError);
	});
}

function waitForFallbackUp(maxRetries = 30, intervalMs = 1000): Promise<boolean> {
	return new Promise((resolve) => {
		const check = async () => {
			for (let i = 0; i < maxRetries; i++) {
				if (await isPortReachable("127.0.0.1", FALLBACK_GATEWAY_PORT, 2000)) {
					try {
						const res = await fetch(`http://127.0.0.1:${FALLBACK_WEB_PORT}/health`, {
							signal: AbortSignal.timeout(2000),
						});
						if (res.ok) {
							resolve(true);
							return;
						}
					} catch {}
				}
				await new Promise((r) => setTimeout(r, intervalMs));
			}
			resolve(false);
		};
		void check();
	});
}

function waitForFallbackDown(maxRetries = 20, intervalMs = 500): Promise<boolean> {
	return new Promise((resolve) => {
		const check = async () => {
			for (let i = 0; i < maxRetries; i++) {
				if (!(await isPortReachable("127.0.0.1", FALLBACK_GATEWAY_PORT, 1000))) {
					resolve(true);
					return;
				}
				await new Promise((r) => setTimeout(r, intervalMs));
			}
			resolve(false);
		};
		void check();
	});
}

export function getFallbackStatus(): { running: boolean; pid?: number } {
	const pid = readFallbackPidFile();
	return { running: pid !== undefined, pid: pid ?? undefined };
}

export async function startFallback(): Promise<void> {
	if (!existsSync(BACKUP_DIR)) {
		throw new Error(
			`No backup found at ${BACKUP_DIR}. Run "pibo gateway backup install" first.`,
		);
	}

	const status = getFallbackStatus();
	if (status.running) {
		console.log(`Fallback is already running (PID ${status.pid})`);
		return;
	}

	if (await isPortReachable("127.0.0.1", FALLBACK_GATEWAY_PORT, 1000)) {
		throw new Error(`Port ${FALLBACK_GATEWAY_PORT} is already in use`);
	}
	if (await isPortReachable("127.0.0.1", FALLBACK_WEB_PORT, 1000)) {
		throw new Error(`Port ${FALLBACK_WEB_PORT} is already in use`);
	}

	const child = spawn(
		process.execPath,
		[
			"-e",
			`import('${BACKUP_DIR}/dist/gateway/web.js').then(m => m.runWebGatewayServer({
				host: '0.0.0.0',
				port: ${FALLBACK_GATEWAY_PORT},
				web: { host: '0.0.0.0', port: ${FALLBACK_WEB_PORT} }
			}))`,
		],
		{
			detached: true,
			stdio: "ignore",
			cwd: BACKUP_DIR,
			env: { ...process.env, PIBO_FALLBACK_MODE: "1" },
		},
	);
	child.unref();

	console.error("Waiting for fallback gateway to come online...");
	const up = await waitForFallbackUp(30, 1000);
	if (!up) {
		throw new Error("Fallback gateway did not come online in time");
	}

	console.log("Fallback gateway started");
	console.log(`  Gateway: 0.0.0.0:${FALLBACK_GATEWAY_PORT}`);
	console.log(`  Web App: http://0.0.0.0:${FALLBACK_WEB_PORT}/apps/chat`);
}

export async function stopFallback(force = false): Promise<void> {
	const pid = readFallbackPidFile();
	const reachable = await isPortReachable("127.0.0.1", FALLBACK_GATEWAY_PORT);

	if (!reachable && !pid) {
		console.log("Fallback is not running.");
		clearFallbackPidFile();
		return;
	}

	if (pid) {
		console.error(`Stopping fallback (PID ${pid})...`);
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	}

	console.error("Waiting for fallback to shut down...");
	const down = await waitForFallbackDown(20, 500);
	if (!down && force && pid) {
		console.error("Force-killing fallback...");
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
		const killed = await waitForFallbackDown(10, 500);
		if (!killed) {
			console.error("Fallback did not shut down even with SIGKILL.");
			process.exitCode = 1;
			return;
		}
	} else if (!down) {
		console.error("Fallback did not shut down gracefully. Use --force to kill.");
		process.exitCode = 1;
		return;
	}

	clearFallbackPidFile();
	console.log("Fallback stopped.");
}
