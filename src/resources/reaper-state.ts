import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { piboHomePath } from "../core/pibo-home.js";

export interface ResourceReaperState {
	status: "running" | "stopped";
	pid: number;
	startedAt: string;
	intervalMs: number;
	lastRunAt?: string;
	nextRunAt?: string;
	lastResult?: {
		browserPools: number;
		unmanagedBrowsers: number;
		staleFiles: number;
		computeWorkers: number;
	};
	lastError?: string;
}

export interface ResourceReaperTimerStatus {
	status: "configured" | "missing" | "unknown";
	details?: string;
	lastRunAt?: string;
	nextRunAt?: string;
	lastResult?: ResourceReaperState["lastResult"];
	lastError?: string;
	nextCommands: string[];
}

export function defaultResourceReaperStatePath(): string {
	return process.env.PIBO_RESOURCE_REAPER_STATE_PATH || piboHomePath("resource-reaper-state.json");
}

export interface WriteResourceReaperStateOptions {
	rename?: typeof rename;
	wait?: (delayMs: number) => Promise<void>;
	retryDelaysMs?: number[];
}

const DEFAULT_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200];
const TRANSIENT_RENAME_ERROR_CODES = new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]);

export async function writeResourceReaperState(
	path: string,
	state: ResourceReaperState,
	options: WriteResourceReaperStateOptions = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const renameFile = options.rename ?? rename;
	const wait = options.wait ?? defaultWait;
	const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RENAME_RETRY_DELAYS_MS;
	await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	try {
		for (let attempt = 0; ; attempt += 1) {
			try {
				await renameFile(temporaryPath, path);
				return;
			} catch (error) {
				if (!isTransientRenameError(error) || attempt >= retryDelaysMs.length) throw error;
				await wait(retryDelaysMs[attempt]);
			}
		}
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}

function isTransientRenameError(error: unknown): boolean {
	return error instanceof Error && "code" in error && TRANSIENT_RENAME_ERROR_CODES.has(String((error as NodeJS.ErrnoException).code));
}

async function defaultWait(delayMs: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function claimResourceReaperOwnership(
	lockPath: string,
	pid = process.pid,
	isPidAlive: (candidate: number) => boolean = defaultIsPidAlive,
): Promise<boolean> {
	await mkdir(dirname(lockPath), { recursive: true });
	try {
		const handle = await open(lockPath, "wx", 0o600);
		await handle.writeFile(`${pid}\n`);
		await handle.close();
		return true;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) throw error;
	}
	const owner = Number.parseInt((await readFile(lockPath, "utf8").catch(() => "")).trim(), 10);
	if (Number.isInteger(owner) && owner > 0 && isPidAlive(owner)) return false;
	await rm(lockPath, { force: true });
	try {
		const handle = await open(lockPath, "wx", 0o600);
		await handle.writeFile(`${pid}\n`);
		await handle.close();
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

export async function releaseResourceReaperOwnership(lockPath: string, pid = process.pid): Promise<void> {
	const owner = Number.parseInt((await readFile(lockPath, "utf8").catch(() => "")).trim(), 10);
	if (owner === pid) await rm(lockPath, { force: true });
}

export function readResourceReaperTimerStatus(
	path = defaultResourceReaperStatePath(),
	isPidAlive: (pid: number) => boolean = defaultIsPidAlive,
): ResourceReaperTimerStatus {
	if (!existsSync(path)) {
		return {
			status: "missing",
			details: "No automatic resource reaper state was found.",
			nextCommands: ["pibo resources status --json", "pibo resources reap --dry-run --json"],
		};
	}
	try {
		const state = JSON.parse(readFileSync(path, "utf8")) as ResourceReaperState;
		if (state.status !== "running" || !Number.isInteger(state.pid) || state.pid <= 0 || !isPidAlive(state.pid)) {
			return {
				status: "unknown",
				details: `Resource reaper state exists but its owner is not running (${path}).`,
				lastRunAt: state.lastRunAt,
				nextRunAt: state.nextRunAt,
				lastResult: state.lastResult,
				lastError: state.lastError,
				nextCommands: ["pibo resources status --json", "pibo resources reap --dry-run --json"],
			};
		}
		return {
			status: "configured",
			details: `Automatic resource reaper is running every ${state.intervalMs} ms (pid ${state.pid}).`,
			lastRunAt: state.lastRunAt,
			nextRunAt: state.nextRunAt,
			lastResult: state.lastResult,
			lastError: state.lastError,
			nextCommands: ["pibo resources status --json", "pibo resources reap --dry-run --json"],
		};
	} catch (error) {
		return {
			status: "unknown",
			details: `Resource reaper state could not be read: ${error instanceof Error ? error.message : String(error)}`,
			nextCommands: ["pibo resources status --json", "pibo resources reap --dry-run --json"],
		};
	}
}

function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
