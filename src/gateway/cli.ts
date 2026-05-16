import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT } from "./protocol.js";
import { clearPidFile, readFallbackPidFile, readPidFile } from "./pidfile.js";

const execFileAsync = promisify(execFile);
export const RESTART_CONFIRMATION_TOKEN = "restart-active-agents";

type GatewayMode = "dev" | "prod" | "fallback" | "unknown";
type GatewayTarget = "web" | "dev";

type RuntimeTelemetryHint = {
	source?: string;
	activeTurnId?: string;
	activePhase?: string;
	lastProgressAt?: string;
	staleForMs?: number;
	isStale?: boolean;
	queueDepth?: number;
	thresholdMs?: number;
};

type RuntimeStatus = {
	piboSessionId?: string;
	queuedMessages?: number;
	processing?: boolean;
	streaming?: boolean;
	activeTelemetry?: RuntimeTelemetryHint;
};

type ActiveRunSummary = {
	runId?: string;
	status?: string;
	toolName?: string;
	piboSessionId?: string;
};

export type GatewaySafetyStatus = {
	reachable: boolean;
	mode: GatewayMode;
	health?: unknown;
	runtimeStatuses: RuntimeStatus[];
	activeRuns: ActiveRunSummary[];
	ambiguous?: boolean;
	error?: string;
};

export type ActiveWorkCheck = { unsafe: boolean; reasons: string[] };

function isPortReachable(host: string, port: number, timeout = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(port, host);
		const onError = () => { socket.destroy(); resolve(false); };
		socket.setTimeout(timeout);
		socket.once("connect", () => { socket.destroy(); resolve(true); });
		socket.once("error", onError);
		socket.once("timeout", onError);
	});
}

async function waitForGatewayUp(maxRetries = 30, intervalMs = 1000): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		if (await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, 2000)) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

async function waitForGatewayDown(maxRetries = 20, intervalMs = 500): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		if (!(await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, 1000))) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

function resolveGatewayCommand(argv: string[]): { command: string; args: string[] } {
	if (argv[1] && (argv[1].endsWith(".js") || argv[1].endsWith(".ts") || argv[1].endsWith(".mjs"))) {
		return { command: argv[0] ?? process.execPath, args: [argv[1], "gateway"] };
	}
	return { command: process.execPath, args: [argv[1] ?? "", "gateway"] };
}

function targetPort(target: GatewayTarget): number {
	const fromEnv = target === "web" ? process.env.PIBO_GATEWAY_WEB_PORT : process.env.PIBO_GATEWAY_DEV_PORT;
	const parsed = fromEnv ? Number(fromEnv) : NaN;
	if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
	return target === "web" ? 4788 : 4808;
}

function expectedMode(target: GatewayTarget): GatewayMode {
	return target === "web" ? "prod" : "dev";
}

function gatewayServiceName(target: GatewayTarget): string {
	const fromEnv = target === "web" ? process.env.PIBO_GATEWAY_WEB_SERVICE : process.env.PIBO_GATEWAY_DEV_SERVICE;
	return fromEnv || (target === "web" ? "pibo-web" : "pibo-web-dev");
}

function gatewayManagerCommand(): string {
	return process.env.PIBO_GATEWAY_MANAGER_COMMAND || "systemctl";
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function booleanValue(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function runtimeTelemetryHint(value: unknown): RuntimeTelemetryHint | undefined {
	const obj = objectValue(value);
	if (!obj) return undefined;
	return {
		source: stringValue(obj.source),
		activeTurnId: stringValue(obj.activeTurnId),
		activePhase: stringValue(obj.activePhase),
		lastProgressAt: stringValue(obj.lastProgressAt),
		staleForMs: numberValue(obj.staleForMs),
		isStale: booleanValue(obj.isStale),
		queueDepth: numberValue(obj.queueDepth),
		thresholdMs: numberValue(obj.thresholdMs),
	};
}

function runtimeStatus(value: unknown): RuntimeStatus | undefined {
	const obj = objectValue(value);
	if (!obj) return undefined;
	return {
		piboSessionId: stringValue(obj.piboSessionId),
		queuedMessages: numberValue(obj.queuedMessages),
		processing: booleanValue(obj.processing),
		streaming: booleanValue(obj.streaming),
		activeTelemetry: runtimeTelemetryHint(obj.activeTelemetry),
	};
}

function activeRun(value: unknown): ActiveRunSummary | undefined {
	const obj = objectValue(value);
	if (!obj) return undefined;
	return {
		runId: stringValue(obj.runId),
		status: stringValue(obj.status),
		toolName: stringValue(obj.toolName),
		piboSessionId: stringValue(obj.piboSessionId),
	};
}

function parseGatewaySafetyPayload(payload: unknown, reachable: boolean): GatewaySafetyStatus {
	const obj = objectValue(payload);
	const mode = obj && (obj.mode === "dev" || obj.mode === "prod" || obj.mode === "fallback") ? obj.mode : "unknown";
	const runtimeStatuses = Array.isArray(obj?.runtimeStatuses) ? obj.runtimeStatuses.map(runtimeStatus).filter((item): item is RuntimeStatus => Boolean(item)) : [];
	const activeRuns = Array.isArray(obj?.activeRuns) ? obj.activeRuns.map(activeRun).filter((item): item is ActiveRunSummary => Boolean(item)) : [];
	return { reachable, mode, health: obj?.health, runtimeStatuses, activeRuns, ambiguous: booleanValue(obj?.ambiguous) };
}

export function checkActiveWork(status: GatewaySafetyStatus, target: GatewayTarget = "web"): ActiveWorkCheck {
	const reasons: string[] = [];
	if (!status.reachable) reasons.push("gateway is not reachable");
	if (status.error) reasons.push(`status unavailable: ${status.error}`);
	if (status.mode !== expectedMode(target)) reasons.push(`gateway mode is ${status.mode}`);
	if (status.ambiguous) reasons.push("gateway state is ambiguous");
	for (const session of status.runtimeStatuses) {
		const id = session.piboSessionId ?? "unknown session";
		if (session.processing === true) reasons.push(`${id} is processing`);
		if (session.streaming === true) reasons.push(`${id} is streaming`);
		if ((session.queuedMessages ?? 0) > 0) reasons.push(`${id} has queued messages`);
		if (session.activeTelemetry?.isStale === true) {
			const phase = session.activeTelemetry.activePhase ? ` in ${session.activeTelemetry.activePhase}` : "";
			reasons.push(`${id} has stale telemetry${phase}`);
		}
	}
	for (const run of status.activeRuns) reasons.push(`${run.runId ?? "yielded run"} is ${run.status ?? "active"}`);
	return { unsafe: reasons.length > 0, reasons };
}

async function readGatewaySafetyStatus(target: GatewayTarget): Promise<GatewaySafetyStatus> {
	const port = targetPort(target);
	const reachable = await isPortReachable("127.0.0.1", port, 1500);
	if (!reachable) return { reachable: false, mode: "unknown", runtimeStatuses: [], activeRuns: [] };
	try {
		return parseGatewaySafetyPayload(await fetchJson(`http://127.0.0.1:${port}/gateway/status`), true);
	} catch (error) {
		return { reachable: true, mode: "unknown", runtimeStatuses: [], activeRuns: [], error: error instanceof Error ? error.message : String(error) };
	}
}

function printSafetyStatus(target: GatewayTarget, status: GatewaySafetyStatus): void {
	console.log(`${target === "web" ? "Production" : "Dev"} gateway status`);
	console.log(`  reachable: ${status.reachable ? "yes" : "no"}`);
	console.log(`  mode: ${status.mode}`);
	if (status.error) console.log(`  status error: ${status.error}`);
	console.log(`  runtime sessions: ${status.runtimeStatuses.length}`);
	for (const session of status.runtimeStatuses) {
		console.log(`    ${session.piboSessionId ?? "unknown"}: processing=${session.processing === true} streaming=${session.streaming === true} queued=${session.queuedMessages ?? 0}`);
		if (session.activeTelemetry) {
			const parts = [
				session.activeTelemetry.activePhase ? `phase=${session.activeTelemetry.activePhase}` : undefined,
				session.activeTelemetry.activeTurnId ? `turn=${session.activeTelemetry.activeTurnId}` : undefined,
				typeof session.activeTelemetry.staleForMs === "number" ? `staleForMs=${session.activeTelemetry.staleForMs}` : undefined,
				session.activeTelemetry.lastProgressAt ? `lastProgress=${session.activeTelemetry.lastProgressAt}` : undefined,
				typeof session.activeTelemetry.thresholdMs === "number" ? `thresholdMs=${session.activeTelemetry.thresholdMs}` : undefined,
				session.activeTelemetry.source ? `source=${session.activeTelemetry.source}` : undefined,
			].filter(Boolean).join(" ");
			console.log(`      telemetry: stale=${session.activeTelemetry.isStale === true}${parts ? ` ${parts}` : ""}`);
		}
	}
	console.log(`  active yielded runs: ${status.activeRuns.length}`);
	for (const run of status.activeRuns) console.log(`    ${run.runId ?? "unknown"}: ${run.status ?? "active"}${run.toolName ? ` (${run.toolName})` : ""}`);
}

async function runGatewayManager(action: "start" | "restart", target: GatewayTarget): Promise<void> {
	await execFileAsync(gatewayManagerCommand(), [action, gatewayServiceName(target)], { timeout: 60000 });
}

async function waitForManagedGatewayHealth(target: GatewayTarget): Promise<GatewaySafetyStatus | undefined> {
	const retries = Number(process.env.PIBO_GATEWAY_HEALTH_RETRIES ?? 30);
	const intervalMs = Number(process.env.PIBO_GATEWAY_HEALTH_INTERVAL_MS ?? 1000);
	for (let i = 0; i < retries; i++) {
		const status = await readGatewaySafetyStatus(target);
		if (status.reachable && status.mode === expectedMode(target) && !status.error) return status;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return undefined;
}

async function runManagedGatewayCommand(target: GatewayTarget, command: string | undefined, args: string[]): Promise<boolean> {
	if (command === "status" || command === "doctor") {
		const status = await readGatewaySafetyStatus(target);
		printSafetyStatus(target, status);
		if (target === "web") {
			const active = checkActiveWork(status, target);
			if (active.unsafe) {
				console.log("  restart safety: blocked");
				for (const reason of active.reasons) console.log(`    - ${reason}`);
			} else console.log("  restart safety: idle");
		}
		if (command === "doctor") process.exitCode = status.reachable && !status.error && status.mode === expectedMode(target) ? 0 : 1;
		return true;
	}

	if (command === "start") {
		const current = await readGatewaySafetyStatus(target);
		if (current.reachable && current.mode === expectedMode(target) && !current.error) {
			printSafetyStatus(target, current);
			console.log("Gateway is already running.");
			return true;
		}
		if (current.reachable) {
			console.error("Start blocked: gateway state is ambiguous.");
			printSafetyStatus(target, current);
			process.exitCode = 1;
			return true;
		}
		console.error(`Starting ${target === "web" ? "production" : "dev"} gateway...`);
		try { await runGatewayManager("start", target); }
		catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; return true; }
		const status = await waitForManagedGatewayHealth(target);
		if (!status) { console.error("Gateway did not become healthy in time."); process.exitCode = 1; return true; }
		printSafetyStatus(target, status);
		console.log("Gateway started successfully.");
		return true;
	}

	if (command === "restart") {
		const force = args.includes("--force");
		const confirmIndex = args.indexOf("--confirm");
		const confirmation = confirmIndex >= 0 ? args[confirmIndex + 1] : undefined;
		if (force && confirmation !== RESTART_CONFIRMATION_TOKEN) {
			console.error(`Force restart requires: --confirm ${RESTART_CONFIRMATION_TOKEN}`);
			process.exitCode = 1;
			return true;
		}
		if (target === "web" && !force) {
			const active = checkActiveWork(await readGatewaySafetyStatus(target), target);
			if (active.unsafe) {
				console.error("Restart blocked: active agent work is running.");
				console.error("Do not restart the gateway now.");
				console.error("Ask the user before interrupting active sessions.");
				for (const reason of active.reasons) console.error(`- ${reason}`);
				process.exitCode = 1;
				return true;
			}
		}
		console.error(`Restarting ${target === "web" ? "production" : "dev"} gateway...`);
		try { await runGatewayManager("restart", target); }
		catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; return true; }
		const status = await waitForManagedGatewayHealth(target);
		if (!status) { console.error("Gateway did not become healthy in time."); process.exitCode = 1; return true; }
		printSafetyStatus(target, status);
		console.log("Gateway restarted successfully.");
		return true;
	}
	return false;
}

export async function runGatewayCli(argv = process.argv): Promise<void> {
	const args = argv.slice(2);
	const subcommand = args[1];
	const hasForceFlag = args.includes("--force");

	if (subcommand === "web" || subcommand === "dev") {
		const handled = await runManagedGatewayCommand(subcommand, args[2], args.slice(3));
		if (!handled) { console.error(`Unknown gateway ${subcommand} subcommand: ${args[2] ?? ""}`); printGatewayHelp(); process.exitCode = 1; }
		return;
	}

	if (subcommand === "status") {
		const reachable = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
		const pid = readPidFile();
		if (reachable) console.log(`Gateway is running${pid ? ` (PID ${pid})` : ""} on ${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`);
		else { console.log(`Gateway is not running on ${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`); process.exitCode = 1; }
		return;
	}

	if (subcommand === "stop") {
		const pid = readPidFile();
		const reachable = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
		if (!reachable && !pid) { console.log("Gateway is not running."); return; }
		if (pid) { console.error(`Stopping gateway (PID ${pid})...`); try { process.kill(pid, "SIGTERM"); } catch (err) { console.error(`Warning: failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`); } }
		console.error("Waiting for gateway to shut down...");
		const down = await waitForGatewayDown(20, 500);
		if (!down && hasForceFlag && pid) {
			console.error("Force-killing gateway...");
			try { process.kill(pid, "SIGKILL"); } catch {}
			const killed = await waitForGatewayDown(10, 500);
			if (!killed) { console.error("Gateway did not shut down even with SIGKILL."); process.exitCode = 1; return; }
		} else if (!down) { console.error("Gateway did not shut down gracefully. Use --force to kill."); process.exitCode = 1; return; }
		clearPidFile(); console.log("Gateway stopped."); return;
	}

	if (subcommand === "restart") {
		console.error("Checking gateway status...");
		const wasRunning = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
		const pid = readPidFile();
		if (wasRunning) {
			if (pid) { console.error(`Stopping gateway (PID ${pid})...`); try { process.kill(pid, "SIGTERM"); } catch (err) { console.error(`Warning: failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`); } }
			else console.error("Gateway is running but PID file not found. Waiting for port to become free...");
			console.error("Waiting for gateway to shut down...");
			const down = await waitForGatewayDown(20, 500);
			if (!down && hasForceFlag && pid) {
				console.error("Force-killing gateway..."); try { process.kill(pid, "SIGKILL"); } catch {}
				const killed = await waitForGatewayDown(10, 500);
				if (!killed) { console.error("Gateway did not shut down even with SIGKILL. Aborting restart."); process.exitCode = 1; return; }
			} else if (!down) { console.error("Gateway did not shut down gracefully. Use --force to kill. Aborting restart."); process.exitCode = 1; return; }
		} else console.error("Gateway was not running.");
		clearPidFile();
		console.error("Starting gateway...");
		const { command, args: spawnArgs } = resolveGatewayCommand(argv);
		const child = spawn(command, spawnArgs, { detached: true, stdio: "ignore" }); child.unref();
		console.error("Waiting for gateway to come back online...");
		const backOnline = await waitForGatewayUp(30, 1000);
		if (backOnline) { const newPid = readPidFile(); console.log(`Gateway restarted successfully${newPid ? ` (PID ${newPid})` : ""}`); }
		else { console.error("Gateway did not come back online in time"); process.exitCode = 1; }
		return;
	}

	if (subcommand === "backup") {
		const backupCommand = args[2];
		const { installBackup, updateBackup, getBackupStatus, removeBackup } = await import("./backup.js");
		if (backupCommand === "install") { installBackup(args[3]); return; }
		if (backupCommand === "update") { updateBackup(); return; }
		if (backupCommand === "status") { const status = getBackupStatus(); if (status) { console.log("Backup installed at ~/.pibo/stable"); console.log(`  Source: ${status.sourcePath}`); console.log(`  Commit: ${status.commit ?? "unknown"}`); console.log(`  Installed: ${status.installedAt}`); } else { console.log("No backup installed."); process.exitCode = 1; } return; }
		if (backupCommand === "remove") { removeBackup(); return; }
		console.error(`Unknown backup subcommand: ${backupCommand}`); printGatewayHelp(); process.exitCode = 1; return;
	}

	if (subcommand === "fallback") {
		const fallbackCommand = args[2];
		const { FALLBACK_GATEWAY_PORT, FALLBACK_WEB_PORT } = await import("./fallback.js");
		if (fallbackCommand === "start" || !fallbackCommand) { const { startFallback } = await import("./fallback.js"); await startFallback(); return; }
		if (fallbackCommand === "stop") { const { stopFallback } = await import("./fallback.js"); await stopFallback(hasForceFlag); return; }
		if (fallbackCommand === "status") { const pid = readFallbackPidFile(); if (pid) console.log(`Fallback is running (PID ${pid}) on 127.0.0.1:${FALLBACK_GATEWAY_PORT} / http://127.0.0.1:${FALLBACK_WEB_PORT}`); else { console.log("Fallback is not running."); process.exitCode = 1; } return; }
		if (fallbackCommand === "restart") { const { stopFallback, startFallback } = await import("./fallback.js"); await stopFallback(hasForceFlag); await startFallback(); return; }
		if (fallbackCommand === "run") { const { runFallbackGatewayServer } = await import("./fallback.js"); await runFallbackGatewayServer(); return; }
		console.error(`Unknown fallback subcommand: ${fallbackCommand}`); printGatewayHelp(); process.exitCode = 1; return;
	}

	if (subcommand === "--help" || subcommand === "-h") { printGatewayHelp(); return; }
	if (subcommand === "start" || !subcommand || subcommand.startsWith("-")) { const { runGatewayServer } = await import("./server.js"); await runGatewayServer(); return; }
	console.error(`Unknown gateway subcommand: ${subcommand}`); printGatewayHelp(); process.exitCode = 1;
}

function printGatewayHelp(): void {
	console.log(`pibo gateway - Gateway management

Commands:
  web status       Inspect the production gateway
  web start        Start the production gateway
  web restart      Safely restart the production gateway
  web doctor       Check production gateway health
  dev status       Inspect the dev gateway
  dev start        Start the dev gateway
  dev restart      Restart the dev gateway
  dev doctor       Check dev gateway health

Options:
  --force --confirm ${RESTART_CONFIRMATION_TOKEN}
                 Force a production restart after explicit confirmation

Next:
  pibo gateway web status
  pibo gateway dev status
`);
}
