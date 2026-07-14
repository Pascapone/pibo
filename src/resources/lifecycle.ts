import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
	applyComputeWorkerReapPlan,
	buildComputeWorkerReapPlan,
	planReapWorkers,
	type ComputeWorkerReapPlan,
} from "../compute/docker.js";
import {
	defaultBrowserPoolRoot,
	defaultBrowserUseHome,
	getComputeResourceHealth,
	parseProcessList,
	type ResourceHealthUnassignedBrowserProcessInfo,
} from "../compute/resource-health.js";
import {
	loadBrowserPoolState,
	reapIdleBrowserPool,
	type BrowserPoolIdentity,
	type BrowserPoolReapResult,
	type BrowserPoolState,
} from "../tools/browser-pool.js";

const execFileAsync = promisify(execFile);

export interface ManagedBrowserPoolRecord {
	statePath: string;
	lockPath: string;
	state: BrowserPoolState;
}

export interface ResourceLease {
	leaseId: string;
	holder?: string;
	workerId: string;
	poolId: string;
	expiresAt?: string;
	state: BrowserPoolState["state"];
}

export interface ResourceBrowserReapPlanItem {
	workerId: string;
	poolId: string;
	statePath: string;
	lockPath: string;
	action: "reap" | "skip";
	reason: string;
	preservesWorktree: true;
}

export interface ResourceStaleFilePlanItem {
	path: string;
	kind: "pid" | "port";
	action: "remove";
	reason: string;
}

export interface ResourceUnmanagedBrowserPlanItem {
	pid: number;
	ppid: number;
	processGroupId: number;
	commandName: string;
	userDataDir?: string;
	elapsedSeconds?: number;
	action: "terminate" | "skip";
	reason: string;
	processGroup: true;
}

export interface ResourceReapPlan {
	createdAt: string;
	dryRun: true;
	options: {
		includeDev: boolean;
		maxAgeMinutes: number;
		idleTimeoutMinutes: number;
		unmanagedBrowserGraceMinutes: number;
		browserPoolRoot: string;
		browserUseHome: string;
		exemptBrowserPids: number[];
	};
	browserPools: {
		items: ResourceBrowserReapPlanItem[];
		selected: number;
		skipped: number;
	};
	staleFiles: {
		items: ResourceStaleFilePlanItem[];
		selected: number;
	};
	unmanagedBrowsers: {
		items: ResourceUnmanagedBrowserPlanItem[];
		selected: number;
		skipped: number;
	};
	compute: ComputeWorkerReapPlan;
	worktreesPreserved: true;
}

export interface ResourceReapApplyResult {
	applied: true;
	plan: ResourceReapPlan;
	browserResults: BrowserPoolReapResult[];
	terminatedUnmanagedBrowsers: number[];
	removedStaleFiles: string[];
	removedComputeWorkers: string[];
	worktreesPreserved: true;
}

export interface PlanResourceReapOptions {
	includeDev?: boolean;
	maxAgeMinutes?: number;
	idleTimeoutMinutes?: number;
	unmanagedBrowserGraceMinutes?: number;
	browserPoolRoot?: string;
	browserUseHome?: string;
	exemptBrowserPids?: number[];
	now?: Date;
}

interface ApplyResourceReapDependencies {
	plan?: (options: PlanResourceReapOptions) => Promise<ResourceReapPlan>;
	reapBrowserPool?: typeof reapIdleBrowserPool;
	applyCompute?: typeof applyComputeWorkerReapPlan;
	terminateUnmanagedBrowser?: (item: ResourceUnmanagedBrowserPlanItem) => Promise<boolean>;
	isPidAlive?: (pid: number) => boolean;
}

export async function collectManagedBrowserPools(rootDir: string): Promise<ManagedBrowserPoolRecord[]> {
	const records: ManagedBrowserPoolRecord[] = [];
	for (const statePath of await findStateFiles(rootDir)) {
		const raw = await readFile(statePath, "utf8").catch(() => undefined);
		if (!raw) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		const candidate = parsed as Record<string, unknown>;
		if (typeof candidate.workerId !== "string" || typeof candidate.poolId !== "string") continue;
		const identity: BrowserPoolIdentity = {
			workerId: candidate.workerId,
			poolId: candidate.poolId,
			maxBrowserProcesses: typeof candidate.maxBrowserProcesses === "number" ? candidate.maxBrowserProcesses : 1,
		};
		const state = await loadBrowserPoolState(statePath, { ...identity, onMalformed: "throw" }).catch(() => undefined);
		if (!state) continue;
		records.push({ statePath, lockPath: join(dirname(statePath), "state.lock"), state });
	}
	return records;
}

export function listActiveResourceLeases(records: ManagedBrowserPoolRecord[]): ResourceLease[] {
	return records
		.filter(({ state }) => Boolean(state.activeLeaseId))
		.map(({ state }) => ({
			leaseId: state.activeLeaseId!,
			holder: state.holder,
			workerId: state.workerId,
			poolId: state.poolId,
			expiresAt: state.idleExpiresAt,
			state: state.state,
		}))
		.sort((a, b) => a.leaseId.localeCompare(b.leaseId));
}

export async function getActiveResourceLeases(browserPoolRoot = defaultBrowserPoolRoot()): Promise<ResourceLease[]> {
	return listActiveResourceLeases(await collectManagedBrowserPools(browserPoolRoot));
}

export async function planResourceReap(options: PlanResourceReapOptions = {}): Promise<ResourceReapPlan> {
	const now = options.now ?? new Date();
	const resolved = resolveReapOptions(options);
	const [records, staleFiles, compute, health] = await Promise.all([
		collectManagedBrowserPools(resolved.browserPoolRoot),
		planStaleCdpFiles(resolved.browserUseHome),
		planComputeReapSafely({ includeDev: resolved.includeDev, maxAgeMinutes: resolved.maxAgeMinutes, now }),
		getComputeResourceHealth({ now, browserPoolRoot: resolved.browserPoolRoot, browserUseHome: resolved.browserUseHome }),
	]);
	const unmanagedBrowsers = buildUnmanagedBrowserPlanItems(
		health.browserProcesses.unassignedMainProcessDetails,
		resolved.unmanagedBrowserGraceMinutes,
		new Set(resolved.exemptBrowserPids),
	);
	return buildResourceReapPlan({ now, options: resolved, records, staleFiles, unmanagedBrowsers, compute });
}

export function buildResourceReapPlan(input: {
	now: Date;
	options: ResourceReapPlan["options"];
	records: ManagedBrowserPoolRecord[];
	staleFiles: ResourceStaleFilePlanItem[];
	unmanagedBrowsers?: ResourceUnmanagedBrowserPlanItem[];
	compute: ComputeWorkerReapPlan;
}): ResourceReapPlan {
	const browserItems = input.records.map((record) => buildBrowserReapPlanItem(record, input.now, input.options.idleTimeoutMinutes));
	const unmanagedBrowsers = input.unmanagedBrowsers ?? [];
	return {
		createdAt: input.now.toISOString(),
		dryRun: true,
		options: input.options,
		browserPools: {
			items: browserItems,
			selected: browserItems.filter((item) => item.action === "reap").length,
			skipped: browserItems.filter((item) => item.action === "skip").length,
		},
		staleFiles: { items: input.staleFiles, selected: input.staleFiles.length },
		unmanagedBrowsers: {
			items: unmanagedBrowsers,
			selected: unmanagedBrowsers.filter((item) => item.action === "terminate").length,
			skipped: unmanagedBrowsers.filter((item) => item.action === "skip").length,
		},
		compute: input.compute,
		worktreesPreserved: true,
	};
}

export async function applyResourceReapPlan(plan: ResourceReapPlan, dependencies: ApplyResourceReapDependencies = {}): Promise<ResourceReapApplyResult> {
	const replan = dependencies.plan ?? planResourceReap;
	const confirmed = await replan({ ...plan.options, now: new Date() });
	const reapBrowserPool = dependencies.reapBrowserPool ?? reapIdleBrowserPool;
	const browserResults: BrowserPoolReapResult[] = [];
	for (const item of confirmed.browserPools.items) {
		if (item.action !== "reap") continue;
		browserResults.push(await reapBrowserPool(
			{ statePath: item.statePath, lockPath: item.lockPath },
			{ workerId: item.workerId, poolId: item.poolId },
			{ idleTimeoutMs: confirmed.options.idleTimeoutMinutes * 60_000 },
		));
	}
	const terminateUnmanagedBrowser = dependencies.terminateUnmanagedBrowser ?? terminateUnmanagedBrowserProcessGroup;
	const terminatedUnmanagedBrowsers: number[] = [];
	for (const item of confirmed.unmanagedBrowsers.items) {
		if (item.action !== "terminate") continue;
		if (await terminateUnmanagedBrowser(item)) terminatedUnmanagedBrowsers.push(item.pid);
	}
	const removedStaleFiles = await applyStaleCdpFilePlan(confirmed.staleFiles.items, dependencies.isPidAlive);
	const removedComputeWorkers = await (dependencies.applyCompute ?? applyComputeWorkerReapPlan)(confirmed.compute);
	return {
		applied: true,
		plan: confirmed,
		browserResults,
		terminatedUnmanagedBrowsers,
		removedStaleFiles,
		removedComputeWorkers,
		worktreesPreserved: true,
	};
}

function resolveReapOptions(options: PlanResourceReapOptions): ResourceReapPlan["options"] {
	return {
		includeDev: options.includeDev === true,
		maxAgeMinutes: options.maxAgeMinutes ?? 60,
		idleTimeoutMinutes: options.idleTimeoutMinutes ?? 10,
		unmanagedBrowserGraceMinutes: options.unmanagedBrowserGraceMinutes ?? 10,
		browserPoolRoot: options.browserPoolRoot ?? defaultBrowserPoolRoot(),
		browserUseHome: options.browserUseHome ?? defaultBrowserUseHome(),
		exemptBrowserPids: options.exemptBrowserPids ?? readExemptBrowserPids(),
	};
}

export function buildUnmanagedBrowserPlanItems(
	processes: ResourceHealthUnassignedBrowserProcessInfo[],
	graceMinutes: number,
	exemptPids = new Set<number>(),
): ResourceUnmanagedBrowserPlanItem[] {
	const graceSeconds = graceMinutes * 60;
	return processes.map((process) => {
		let action: ResourceUnmanagedBrowserPlanItem["action"] = "terminate";
		let reason = "unmanaged Chromium main process has no managed browser-pool lease";
		if (process.pid <= 1 || process.pgid <= 1) {
			action = "skip";
			reason = "unsafe pid or process group";
		} else if (exemptPids.has(process.pid) || exemptPids.has(process.pgid)) {
			action = "skip";
			reason = "explicitly exempted pid or process group";
		} else if (process.elapsedSeconds !== undefined && process.elapsedSeconds < graceSeconds) {
			action = "skip";
			reason = `process age ${process.elapsedSeconds}s is within ${graceSeconds}s grace period`;
		}
		return {
			pid: process.pid,
			ppid: process.ppid,
			processGroupId: process.pgid,
			commandName: process.commandName,
			userDataDir: process.userDataDir,
			elapsedSeconds: process.elapsedSeconds,
			action,
			reason,
			processGroup: true,
		};
	});
}

async function terminateUnmanagedBrowserProcessGroup(item: ResourceUnmanagedBrowserPlanItem): Promise<boolean> {
	if (!defaultIsPidAlive(item.pid)) return false;
	const [processInfo, ownProcessGroupId] = await Promise.all([inspectProcess(item.pid), readProcessGroupId(process.pid)]);
	if (!processInfo || !processInfo.isChromium || !processInfo.isMainProcess || processInfo.pgid !== item.processGroupId) return false;
	if (ownProcessGroupId !== undefined && ownProcessGroupId === item.processGroupId) return false;
	try {
		process.kill(-item.processGroupId, "SIGTERM");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH")) throw error;
		return false;
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
	if (defaultIsPidAlive(item.pid)) {
		try {
			process.kill(-item.processGroupId, "SIGKILL");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH")) throw error;
		}
	}
	return !defaultIsPidAlive(item.pid);
}

async function inspectProcess(pid: number) {
	try {
		const { stdout } = await execFileAsync("ps", ["-o", "pid=,ppid=,pgid=,comm=,args=", "-p", String(pid)]);
		return parseProcessList(stdout).find((item) => item.pid === pid);
	} catch {
		return undefined;
	}
}

async function readProcessGroupId(pid: number): Promise<number | undefined> {
	try {
		const { stdout } = await execFileAsync("ps", ["-o", "pgid=", "-p", String(pid)]);
		const value = Number.parseInt(stdout.trim(), 10);
		return Number.isInteger(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

function readExemptBrowserPids(): number[] {
	return (process.env.PIBO_RESOURCE_REAPER_EXEMPT_BROWSER_PIDS ?? "")
		.split(",")
		.map((value) => Number.parseInt(value.trim(), 10))
		.filter((value) => Number.isInteger(value) && value > 0);
}

function buildBrowserReapPlanItem(record: ManagedBrowserPoolRecord, now: Date, idleTimeoutMinutes: number): ResourceBrowserReapPlanItem {
	const { state } = record;
	let action: ResourceBrowserReapPlanItem["action"] = "skip";
	let reason = "not idle long enough";
	if (state.activeLeaseId || (state.activeLeaseCount ?? 0) > 0 || state.state === "leased") {
		reason = state.activeLeaseId ? `active lease ${state.activeLeaseId}` : "active leases";
	} else if (state.state === "empty" || (!state.pid && !state.cdpUrl && !state.userDataDir)) {
		reason = "no recorded browser";
	} else if (state.state === "stale" || state.state === "dirty") {
		action = "reap";
		reason = `pool state is ${state.state}`;
	} else if (hasExpired(state.idleExpiresAt, now)) {
		action = "reap";
		reason = `idle expiry ${state.idleExpiresAt} has passed`;
	} else if (isOlderThan(state.lastUsedAt, now, idleTimeoutMinutes * 60_000)) {
		action = "reap";
		reason = `last used at ${state.lastUsedAt} exceeds idle timeout`;
	}
	return {
		workerId: state.workerId,
		poolId: state.poolId,
		statePath: record.statePath,
		lockPath: record.lockPath,
		action,
		reason,
		preservesWorktree: true,
	};
}

async function planComputeReapSafely(options: { includeDev: boolean; maxAgeMinutes: number; now: Date }): Promise<ComputeWorkerReapPlan> {
	try {
		return await planReapWorkers(options);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
		const plan = buildComputeWorkerReapPlan([], options);
		plan.nextCommands = ["Docker CLI is unavailable in this runtime; browser and stale-file cleanup remain active."];
		return plan;
	}
}

async function planStaleCdpFiles(browserUseHome: string, isPidAlive = defaultIsPidAlive): Promise<ResourceStaleFilePlanItem[]> {
	const stateDir = join(browserUseHome, "pibo-cdp");
	let files: string[];
	try {
		files = await readdir(stateDir);
	} catch {
		return [];
	}
	const items: ResourceStaleFilePlanItem[] = [];
	for (const file of files) {
		if (file.endsWith(".pid")) {
			const path = join(stateDir, file);
			const pid = await readPid(path);
			if (pid === undefined || !isPidAlive(pid)) items.push({ path, kind: "pid", action: "remove", reason: pid === undefined ? "invalid pid file" : `pid ${pid} is not alive` });
		} else if (file.endsWith(".port")) {
			const pidPath = join(stateDir, `${file.slice(0, -5)}.pid`);
			if (!existsSync(pidPath)) items.push({ path: join(stateDir, file), kind: "port", action: "remove", reason: "matching pid file is missing" });
		}
	}
	return items;
}

async function applyStaleCdpFilePlan(items: ResourceStaleFilePlanItem[], isPidAlive = defaultIsPidAlive): Promise<string[]> {
	const removed: string[] = [];
	for (const item of items) {
		if (item.kind === "pid") {
			const pid = await readPid(item.path);
			if (pid !== undefined && isPidAlive(pid)) continue;
			await rm(item.path, { force: true });
			removed.push(item.path);
			const portPath = `${item.path.slice(0, -4)}.port`;
			if (existsSync(portPath)) {
				await rm(portPath, { force: true });
				removed.push(portPath);
			}
			continue;
		}
		const pidPath = `${item.path.slice(0, -5)}.pid`;
		if (existsSync(pidPath)) continue;
		await rm(item.path, { force: true });
		removed.push(item.path);
	}
	return removed;
}

async function findStateFiles(rootDir: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && entry.name === "state.json") found.push(path);
		}
	}
	await walk(rootDir);
	return found;
}

async function readPid(path: string): Promise<number | undefined> {
	const text = await readFile(path, "utf8").catch(() => "");
	const pid = Number.parseInt(text.trim(), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function hasExpired(value: string | undefined, now: Date): boolean {
	if (!value) return false;
	const timestamp = Date.parse(value);
	return !Number.isNaN(timestamp) && timestamp <= now.getTime();
}

function isOlderThan(value: string | undefined, now: Date, ageMs: number): boolean {
	if (!value) return false;
	const timestamp = Date.parse(value);
	return !Number.isNaN(timestamp) && timestamp + ageMs <= now.getTime();
}

function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
