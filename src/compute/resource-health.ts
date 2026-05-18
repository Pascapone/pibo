import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createEmptyBrowserPoolState, normalizeBrowserPoolState, type BrowserPoolState } from "../tools/browser-pool.js";
import { getComputeDiskDiagnostics, listWorkers, type ComputeDiskDiagnostics, type WorkerInfo } from "./docker.js";

const execFileAsync = promisify(execFile);
const DOCKER_DISK_PRESSURE_BYTES = 5_000_000_000;

export type ResourceHealthSeverity = "ok" | "warning" | "critical";

export interface ResourceHealthCheck {
	id: string;
	severity: ResourceHealthSeverity;
	message: string;
	nextCommands: string[];
}

export interface ResourceHealthProcessInfo {
	pid: number;
	ppid: number;
	pgid: number;
	commandName: string;
	args: string;
	isChromium: boolean;
	isMainProcess: boolean;
}

export interface ResourceHealthUnassignedBrowserProcessInfo {
	pid: number;
	ppid: number;
	pgid: number;
	commandName: string;
	workerName?: string;
	userDataDir?: string;
	cdpPort?: number;
	argsPreview: string;
	nextCommands: string[];
}

export interface ResourceHealthBrowserPoolInfo {
	workerId: string;
	poolId: string;
	state: BrowserPoolState["state"];
	pid?: number;
	processGroupId?: number;
	cdpUrl?: string;
	userDataDir?: string;
	activeLeaseId?: string;
	activeLeaseCount: number;
	maxBrowserProcesses: number;
	recordedPidAlive: boolean;
	browserMainProcessCount: number;
	severity: ResourceHealthSeverity;
	statePath?: string;
	lastError?: string;
}

export interface ResourceHealthStaleCdpFiles {
	pidFiles: number;
	portFiles: number;
	details: string[];
}

export interface ResourceHealthTimerStatus {
	status: "configured" | "missing" | "unknown";
	details?: string;
	nextCommands: string[];
}

export interface ComputeResourceHealth {
	generatedAt: string;
	readOnly: true;
	severity: ResourceHealthSeverity;
	checks: ResourceHealthCheck[];
	browserProcesses: {
		processListAvailable: boolean;
		processListError?: string;
		totalChromiumProcesses: number;
		totalChromiumMainProcesses: number;
		unassignedChromiumMainProcesses: number;
		unassignedMainProcessDetails: ResourceHealthUnassignedBrowserProcessInfo[];
		perWorker: ResourceHealthBrowserPoolInfo[];
	};
	browserLeases: {
		active: number;
		activePoolIds: string[];
		staleCdpFiles: ResourceHealthStaleCdpFiles;
	};
	computeWorkers: {
		dockerAvailable: boolean;
		dockerError?: string;
		total: number;
		dirty: number;
		oomKilled: number;
		cleanupEligible: number;
		dirtyWorkers: string[];
		oomKilledWorkers: string[];
	};
	dockerDisk: {
		dockerAvailable: boolean;
		dockerError?: string;
		sizeBytes?: number;
		reclaimableBytes?: number;
		buildCacheBytes?: number;
		pressure: boolean;
	};
	reaperTimers: ResourceHealthTimerStatus;
	nextCommands: string[];
}

export interface BuildComputeResourceHealthOptions {
	now?: Date;
	workers?: WorkerInfo[];
	workerListError?: string;
	disk?: ComputeDiskDiagnostics;
	processes?: ResourceHealthProcessInfo[];
	processListError?: string;
	browserPools?: Array<{ state: BrowserPoolState; statePath?: string }>;
	staleCdpFiles?: ResourceHealthStaleCdpFiles;
	reaperTimers?: ResourceHealthTimerStatus;
}

export interface GetComputeResourceHealthOptions {
	now?: Date;
	browserPoolRoot?: string;
	browserUseHome?: string;
}

export function parseProcessList(output: string): ResourceHealthProcessInfo[] {
	const processes: ResourceHealthProcessInfo[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
		if (!match) continue;
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const pgid = Number(match[3]);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) continue;
		const commandName = match[4] ?? "";
		const args = match[5] ?? "";
		const isChromium = isChromiumCommand(commandName, args);
		processes.push({ pid, ppid, pgid, commandName, args, isChromium, isMainProcess: isChromium && !/\s--type=/.test(` ${args}`) });
	}
	return processes;
}

export function buildComputeResourceHealth(options: BuildComputeResourceHealthOptions = {}): ComputeResourceHealth {
	const now = options.now ?? new Date();
	const workers = options.workers ?? [];
	const processes = options.processes ?? [];
	const processListAvailable = !options.processListError;
	const browserPools = options.browserPools ?? [];
	const staleCdpFiles = options.staleCdpFiles ?? { pidFiles: 0, portFiles: 0, details: [] };
	const reaperTimers = options.reaperTimers ?? { status: "missing", details: "No automatic resource reaper timer status was found.", nextCommands: ["pibo compute health --json", "pibo tools browser-use pool reap --json", "pibo compute reap --dry-run --json"] };
	const disk = options.disk;
	const checks: ResourceHealthCheck[] = [];
	const mainProcesses = processes.filter((process) => process.isChromium && process.isMainProcess);

	const perWorker = browserPools.map(({ state, statePath }): ResourceHealthBrowserPoolInfo => {
		const activeLeaseCount = state.activeLeaseId ? Math.max(1, state.activeLeaseCount ?? 1) : state.activeLeaseCount ?? 0;
		const matched = mainProcesses.filter((process) => browserProcessMatchesPool(process, state));
		const recordedPidAlive = state.pid ? processes.some((process) => process.pid === state.pid) : false;
		const leaked = matched.length > state.maxBrowserProcesses;
		const severity: ResourceHealthSeverity = state.state === "dirty" || leaked ? "warning" : "ok";
		return {
			workerId: state.workerId,
			poolId: state.poolId,
			state: state.state,
			pid: state.pid,
			processGroupId: state.processGroupId,
			cdpUrl: state.cdpUrl,
			userDataDir: state.userDataDir,
			activeLeaseId: state.activeLeaseId,
			activeLeaseCount,
			maxBrowserProcesses: state.maxBrowserProcesses,
			recordedPidAlive,
			browserMainProcessCount: matched.length,
			severity,
			statePath,
			lastError: state.lastError,
		};
	});

	const assignedMainPids = new Set<number>();
	for (const pool of browserPools) {
		for (const process of mainProcesses) if (browserProcessMatchesPool(process, pool.state)) assignedMainPids.add(process.pid);
	}
	const unassignedMainProcessDetails = mainProcesses
		.filter((process) => !assignedMainPids.has(process.pid))
		.map((process) => describeUnassignedBrowserProcess(process, workers));
	const unassignedChromiumMainProcesses = unassignedMainProcessDetails.length;
	const activePoolIds = perWorker.filter((pool) => pool.activeLeaseCount > 0).map((pool) => `${pool.workerId}/${pool.poolId}`);
	const dirtyWorkers = workers.filter((worker) => worker.cleanupState === "dirty" || Boolean(worker.dirtyReason)).map((worker) => worker.name);
	const oomKilledWorkers = workers.filter((worker) => worker.oomKilled === true).map((worker) => worker.name);
	const cleanupEligible = workers.filter((worker) => worker.cleanupEligibility.eligible).length;
	const diskPressure = Boolean(disk?.dockerAvailable && ((disk.totals.reclaimableBytes ?? 0) >= DOCKER_DISK_PRESSURE_BYTES || (disk.usage.buildCache?.sizeBytes ?? 0) >= DOCKER_DISK_PRESSURE_BYTES));

	if (!processListAvailable) checks.push({ id: "process-list", severity: "warning", message: `Process list unavailable: ${options.processListError}`, nextCommands: ["ps -eo pid,ppid,pgid,comm,args"] });
	if (perWorker.some((pool) => pool.browserMainProcessCount > pool.maxBrowserProcesses) || unassignedChromiumMainProcesses > 0) checks.push({ id: "browser-leak", severity: "warning", message: browserLeakMessage(unassignedChromiumMainProcesses), nextCommands: ["pibo compute health --json", "pibo tools browser-use pool status --json", "pibo tools browser-use pool reap --json", "pibo compute reap --dry-run --include-dev"] });
	else checks.push({ id: "browser-processes", severity: "ok", message: "Browser process counts are within managed pool expectations.", nextCommands: ["pibo tools browser-use pool status --json"] });
	if (activePoolIds.length > 0) checks.push({ id: "browser-leases", severity: "warning", message: `${activePoolIds.length} active browser pool lease(s) found.`, nextCommands: ["pibo ralph runs --json", "pibo tools browser-use pool status --json"] });
	if (staleCdpFiles.pidFiles > 0 || staleCdpFiles.portFiles > 0) checks.push({ id: "stale-cdp-files", severity: "warning", message: `${staleCdpFiles.pidFiles} stale pid file(s), ${staleCdpFiles.portFiles} orphan port file(s).`, nextCommands: ["pibo tools browser-use lease reap-stale", "pibo tools browser-use pool reap --json"] });
	if (dirtyWorkers.length > 0) checks.push({ id: "dirty-workers", severity: "warning", message: `${dirtyWorkers.length} dirty compute worker(s): ${dirtyWorkers.join(", ")}`, nextCommands: ["pibo compute list --all --json", "pibo compute reap --dry-run --include-dev"] });
	if (oomKilledWorkers.length > 0) checks.push({ id: "oom-containers", severity: "critical", message: `${oomKilledWorkers.length} OOM-killed compute container(s): ${oomKilledWorkers.join(", ")}`, nextCommands: ["pibo compute list --all --json", "pibo compute reap --dry-run --include-dev"] });
	if (options.workerListError) checks.push({ id: "compute-list", severity: "warning", message: `Docker worker list unavailable: ${options.workerListError}`, nextCommands: ["pibo compute list --all --json"] });
	if (diskPressure) checks.push({ id: "docker-disk-pressure", severity: "warning", message: "Docker reclaimable or BuildKit cache bytes exceed the resource-health warning threshold.", nextCommands: ["pibo compute diagnostics --json", "docker builder du", "docker builder prune"] });
	if (disk && !disk.dockerAvailable) checks.push({ id: "docker-disk", severity: "warning", message: `Docker disk diagnostics unavailable: ${disk.dockerError ?? "unknown error"}`, nextCommands: ["pibo compute diagnostics --json"] });
	if (reaperTimers.status !== "configured") checks.push({ id: "reaper-timer", severity: "warning", message: reaperTimers.details ?? "Automatic reaper timer status is not configured.", nextCommands: reaperTimers.nextCommands });

	const severity = maxSeverity(checks.map((check) => check.severity));
	const nextCommands = uniqueStrings(checks.flatMap((check) => check.nextCommands).concat(["pibo compute health --json", "pibo compute reap --dry-run --json", "pibo compute diagnostics --json"]));
	return {
		generatedAt: now.toISOString(),
		readOnly: true,
		severity,
		checks,
		browserProcesses: {
			processListAvailable,
			processListError: options.processListError,
			totalChromiumProcesses: processes.filter((process) => process.isChromium).length,
			totalChromiumMainProcesses: mainProcesses.length,
			unassignedChromiumMainProcesses,
			unassignedMainProcessDetails,
			perWorker,
		},
		browserLeases: { active: activePoolIds.length, activePoolIds, staleCdpFiles },
		computeWorkers: {
			dockerAvailable: !options.workerListError,
			dockerError: options.workerListError,
			total: workers.length,
			dirty: dirtyWorkers.length,
			oomKilled: oomKilledWorkers.length,
			cleanupEligible,
			dirtyWorkers,
			oomKilledWorkers,
		},
		dockerDisk: {
			dockerAvailable: disk?.dockerAvailable ?? false,
			dockerError: disk?.dockerError,
			sizeBytes: disk?.totals.sizeBytes,
			reclaimableBytes: disk?.totals.reclaimableBytes,
			buildCacheBytes: disk?.usage.buildCache?.sizeBytes,
			pressure: diskPressure,
		},
		reaperTimers,
		nextCommands,
	};
}

function browserLeakMessage(unassignedCount: number): string {
	if (unassignedCount > 0) return `${unassignedCount} unmanaged Chromium main process(es) are not associated with a managed browser pool.`;
	return "Chromium main-process count exceeds managed pool expectations.";
}

function describeUnassignedBrowserProcess(process: ResourceHealthProcessInfo, workers: WorkerInfo[]): ResourceHealthUnassignedBrowserProcessInfo {
	const worker = workers.find((candidate) => candidate.hostPid !== undefined && candidate.hostPid > 0 && candidate.hostPid === process.ppid);
	const userDataDir = readChromeArg(process.args, "user-data-dir");
	const cdpPortValue = readChromeArg(process.args, "remote-debugging-port");
	const cdpPort = cdpPortValue && /^\d+$/.test(cdpPortValue) ? Number(cdpPortValue) : undefined;
	const nextCommands = worker
		? [`docker top ${worker.name} -eo pid,ppid,pgid,comm,args`, `pibo compute list --all --json`]
		: ["ps -eo pid,ppid,pgid,comm,args | grep -Ei 'chrome|chromium'", "pibo compute list --all --json"];
	return {
		pid: process.pid,
		ppid: process.ppid,
		pgid: process.pgid,
		commandName: process.commandName,
		workerName: worker?.name,
		userDataDir,
		cdpPort,
		argsPreview: sanitizeArgsPreview(process.args),
		nextCommands,
	};
}

function readChromeArg(args: string, name: string): string | undefined {
	const pattern = new RegExp(`(?:^|\\s)--${name}=([^\\s]+)`);
	return args.match(pattern)?.[1];
}

function sanitizeArgsPreview(args: string): string {
	const redacted = args
		.replace(/(token|access_token|refresh_token|password|passwd|cookie|secret)=([^\s]+)/gi, "$1=<redacted>")
		.replace(/(--(?:token|password|cookie|secret))\s+([^\s]+)/gi, "$1 <redacted>");
	return redacted.length > 220 ? `${redacted.slice(0, 217)}...` : redacted;
}

export async function getComputeResourceHealth(options: GetComputeResourceHealthOptions = {}): Promise<ComputeResourceHealth> {
	const browserPoolRoot = options.browserPoolRoot ?? defaultBrowserPoolRoot();
	const browserUseHome = options.browserUseHome ?? defaultBrowserUseHome();
	const [workerResult, disk, processResult, browserPools, staleCdpFiles] = await Promise.all([
		collectWorkers(),
		getComputeDiskDiagnostics({ now: options.now }),
		collectProcesses(),
		collectBrowserPoolStates(browserPoolRoot),
		collectStaleCdpFiles(browserUseHome),
	]);
	return buildComputeResourceHealth({
		now: options.now,
		workers: workerResult.workers,
		workerListError: workerResult.error,
		disk,
		processes: processResult.processes,
		processListError: processResult.error,
		browserPools,
		staleCdpFiles,
		reaperTimers: detectReaperTimerStatus(),
	});
}

export function defaultBrowserUseHome(): string {
	return process.env.BROWSER_USE_HOME || join(homedir(), ".pibo", "tools", "browser-use", "home");
}

export function defaultBrowserPoolRoot(): string {
	return process.env.PIBO_BROWSER_POOL_ROOT || join(defaultBrowserUseHome(), "pibo-browser-pool");
}

export async function collectStaleCdpFiles(browserUseHome: string): Promise<ResourceHealthStaleCdpFiles> {
	const stateDir = join(browserUseHome, "pibo-cdp");
	const result: ResourceHealthStaleCdpFiles = { pidFiles: 0, portFiles: 0, details: [] };
	let files: string[];
	try {
		files = await readdir(stateDir);
	} catch {
		return result;
	}
	for (const file of files) {
		if (file.endsWith(".pid")) {
			const pidPath = join(stateDir, file);
			const text = await readFile(pidPath, "utf8").catch(() => "");
			const pid = Number.parseInt(text.trim(), 10);
			if (!Number.isFinite(pid) || pid <= 0 || !isPidAlive(pid)) {
				result.pidFiles += 1;
				result.details.push(`stale pid file: ${file}`);
			}
		} else if (file.endsWith(".port")) {
			const pidPath = join(stateDir, `${file.slice(0, -5)}.pid`);
			if (!existsSync(pidPath)) {
				result.portFiles += 1;
				result.details.push(`orphan port file: ${file}`);
			}
		}
	}
	return result;
}

async function collectWorkers(): Promise<{ workers: WorkerInfo[]; error?: string }> {
	try {
		return { workers: await listWorkers({ all: true }) };
	} catch (error) {
		return { workers: [], error: error instanceof Error ? error.message : String(error) };
	}
}

async function collectProcesses(): Promise<{ processes: ResourceHealthProcessInfo[]; error?: string }> {
	try {
		const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,pgid=,comm=,args="], { maxBuffer: 10 * 1024 * 1024 });
		return { processes: parseProcessList(stdout) };
	} catch (error) {
		return { processes: [], error: error instanceof Error ? error.message : String(error) };
	}
}

async function collectBrowserPoolStates(rootDir: string): Promise<Array<{ state: BrowserPoolState; statePath?: string }>> {
	const statePaths = await findStateJsonFiles(rootDir);
	const states: Array<{ state: BrowserPoolState; statePath?: string }> = [];
	for (const statePath of statePaths) {
		try {
			const raw = await readFile(statePath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const identity = parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? { workerId: String((parsed as Record<string, unknown>).workerId ?? "unknown"), poolId: String((parsed as Record<string, unknown>).poolId ?? "default"), maxBrowserProcesses: 1 }
				: { workerId: "unknown", poolId: "default", maxBrowserProcesses: 1 };
			states.push({ state: normalizeBrowserPoolState(parsed, identity), statePath });
		} catch {
			states.push({ state: { ...createEmptyBrowserPoolState({ workerId: "unknown", poolId: "default" }), state: "dirty", lastError: `Could not read browser pool state ${statePath}` }, statePath });
		}
	}
	return states;
}

async function findStateJsonFiles(rootDir: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) await walk(fullPath);
			else if (entry.isFile() && entry.name === "state.json") found.push(fullPath);
		}
	}
	await walk(rootDir);
	return found;
}

function detectReaperTimerStatus(): ResourceHealthTimerStatus {
	if (process.env.PIBO_RESOURCE_REAPER_TIMER_STATUS === "configured") {
		return { status: "configured", details: "Resource reaper timer is marked configured by PIBO_RESOURCE_REAPER_TIMER_STATUS.", nextCommands: ["pibo compute health --json"] };
	}
	return {
		status: "missing",
		details: "No automatic resource reaper timer status was found; keep using read-only diagnostics and dry-run cleanup until timers are explicitly enabled.",
		nextCommands: ["pibo compute health --json", "pibo tools browser-use pool reap --json", "pibo compute reap --dry-run --json"],
	};
}

function browserProcessMatchesPool(process: ResourceHealthProcessInfo, state: BrowserPoolState): boolean {
	if (state.pid && process.pid === state.pid) return true;
	if (state.processGroupId && process.pgid === state.processGroupId) return true;
	if (state.userDataDir && process.args.includes(`--user-data-dir=${state.userDataDir}`)) return true;
	return false;
}

function isChromiumCommand(commandName: string, args: string): boolean {
	const commandBase = basename(commandName).toLowerCase();
	const firstArg = basename(args.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
	return [commandBase, firstArg].some((value) => value === "chrome" || value === "google-chrome" || value === "chromium" || value === "chromium-browser");
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function maxSeverity(values: ResourceHealthSeverity[]): ResourceHealthSeverity {
	if (values.includes("critical")) return "critical";
	if (values.includes("warning")) return "warning";
	return "ok";
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}
