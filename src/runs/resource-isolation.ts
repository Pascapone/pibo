import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type YieldedRunIsolationMode = "off" | "systemd";

export type YieldedRunResourcePolicy = {
	mode: YieldedRunIsolationMode;
	memoryHighBytes: number;
	memoryMaxBytes: number;
	tasksMax: number;
	cpuQuotaPercent: number;
	ioWeight: number;
	monitorIntervalMs: number;
	minHostAvailableBytes: number;
	maxMemoryFullPsiAvg10: number;
	maxIoFullPsiAvg10: number;
};

export type LinuxPressureSnapshot = {
	someAvg10?: number;
	fullAvg10?: number;
};

export type YieldedRunHostResourceSnapshot = {
	capturedAt: string;
	memoryFreeBytes: number;
	memoryAvailableBytes: number;
	memoryPressure: LinuxPressureSnapshot;
	ioPressure: LinuxPressureSnapshot;
};

export type YieldedRunCgroupSnapshot = {
	unitName: string;
	controlGroup?: string;
	activeState?: string;
	subState?: string;
	result?: string;
	execMainStatus?: number;
	oomKilled?: boolean;
	memoryCurrentBytes?: number;
	memoryPeakBytes?: number;
	memoryHighBytes?: number;
	memoryMaxBytes?: number;
	memorySwapPeakBytes?: number;
	memorySwapMaxBytes?: number;
	cpuUsageNs?: number;
	tasksCurrent?: number;
	tasksPeak?: number;
	ioReadBytes?: number;
	ioWriteBytes?: number;
};

export type PiboRunResourceUsage = {
	isolationMode: YieldedRunIsolationMode;
	unitName?: string;
	policy: YieldedRunResourcePolicy;
	admission?: YieldedRunHostResourceSnapshot;
	startedAt?: string;
	completedAt?: string;
	minimumHostAvailableBytes?: number;
	peakMemoryFullPsiAvg10?: number;
	peakIoFullPsiAvg10?: number;
	cgroup?: YieldedRunCgroupSnapshot;
	limitReason?: string;
};

export type PreparedYieldedRunExecution = {
	params: unknown;
	resources: PiboRunResourceUsage;
	execute<T>(operation: () => Promise<T>): Promise<T>;
	cancel(): Promise<void>;
};

export class PiboRunResourceLimitError extends Error {
	constructor(message: string, readonly resources: PiboRunResourceUsage) {
		super(message);
		this.name = "PiboRunResourceLimitError";
	}
}

const DEFAULT_POLICY: YieldedRunResourcePolicy = Object.freeze({
	mode: "systemd",
	memoryHighBytes: 1280 * 1024 * 1024,
	memoryMaxBytes: 1792 * 1024 * 1024,
	tasksMax: 128,
	cpuQuotaPercent: 200,
	ioWeight: 100,
	monitorIntervalMs: 500,
	minHostAvailableBytes: 1024 * 1024 * 1024,
	maxMemoryFullPsiAvg10: 5,
	maxIoFullPsiAvg10: 10,
});

export function resolveYieldedRunResourcePolicy(env: NodeJS.ProcessEnv = process.env): YieldedRunResourcePolicy {
	return {
		mode: parseIsolationMode(env.PIBO_YIELDED_RUN_ISOLATION, DEFAULT_POLICY.mode),
		memoryHighBytes: parseNonNegativeInteger(env.PIBO_YIELDED_RUN_MEMORY_HIGH_BYTES, DEFAULT_POLICY.memoryHighBytes),
		memoryMaxBytes: parseNonNegativeInteger(env.PIBO_YIELDED_RUN_MEMORY_MAX_BYTES, DEFAULT_POLICY.memoryMaxBytes),
		tasksMax: parsePositiveInteger(env.PIBO_YIELDED_RUN_TASKS_MAX, DEFAULT_POLICY.tasksMax),
		cpuQuotaPercent: parsePositiveNumber(env.PIBO_YIELDED_RUN_CPU_QUOTA_PERCENT, DEFAULT_POLICY.cpuQuotaPercent),
		ioWeight: Math.min(10_000, parsePositiveInteger(env.PIBO_YIELDED_RUN_IO_WEIGHT, DEFAULT_POLICY.ioWeight)),
		monitorIntervalMs: Math.max(100, parsePositiveInteger(env.PIBO_YIELDED_RUN_MONITOR_INTERVAL_MS, DEFAULT_POLICY.monitorIntervalMs)),
		minHostAvailableBytes: parseNonNegativeInteger(env.PIBO_YIELDED_RUN_MIN_HOST_AVAILABLE_BYTES, DEFAULT_POLICY.minHostAvailableBytes),
		maxMemoryFullPsiAvg10: parseNonNegativeNumber(env.PIBO_YIELDED_RUN_MAX_MEMORY_FULL_PSI_AVG10, DEFAULT_POLICY.maxMemoryFullPsiAvg10),
		maxIoFullPsiAvg10: parseNonNegativeNumber(env.PIBO_YIELDED_RUN_MAX_IO_FULL_PSI_AVG10, DEFAULT_POLICY.maxIoFullPsiAvg10),
	};
}

export function collectYieldedRunHostResourceSnapshot(
	options: { now?: Date; meminfo?: string; memoryPressure?: string; ioPressure?: string } = {},
): YieldedRunHostResourceSnapshot {
	const memory = parseLinuxMeminfo(options.meminfo ?? readOptionalFile("/proc/meminfo"));
	return {
		capturedAt: (options.now ?? new Date()).toISOString(),
		memoryFreeBytes: memory.freeBytes,
		memoryAvailableBytes: memory.availableBytes,
		memoryPressure: parseLinuxPressure(options.memoryPressure ?? readOptionalFile("/proc/pressure/memory")),
		ioPressure: parseLinuxPressure(options.ioPressure ?? readOptionalFile("/proc/pressure/io")),
	};
}

export function parseLinuxMeminfo(input: string): { freeBytes: number; availableBytes: number } {
	const values = new Map<string, number>();
	for (const line of input.split("\n")) {
		const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
		if (match) values.set(match[1]!, Number(match[2]) * 1024);
	}
	const freeBytes = values.get("MemFree") ?? 0;
	return { freeBytes, availableBytes: values.get("MemAvailable") ?? freeBytes };
}

export function parseLinuxPressure(input: string): LinuxPressureSnapshot {
	const output: LinuxPressureSnapshot = {};
	for (const line of input.split("\n")) {
		const match = line.match(/^(some|full)\s+.*\bavg10=([0-9.]+)/);
		if (!match) continue;
		const value = Number(match[2]);
		if (!Number.isFinite(value)) continue;
		if (match[1] === "some") output.someAvg10 = value;
		else output.fullAvg10 = value;
	}
	return output;
}

export function prepareYieldedRunExecution(
	toolName: string,
	params: unknown,
	options: { env?: NodeJS.ProcessEnv; unitName?: string; now?: Date } = {},
): PreparedYieldedRunExecution {
	const policy = resolveYieldedRunResourcePolicy(options.env);
	const command = bashCommand(params);
	const shouldIsolate = policy.mode === "systemd" && toolName === "bash" && command !== undefined;
	const unitName = shouldIsolate ? options.unitName ?? yieldedRunUnitName() : undefined;
	const metricsPath = unitName ? `/tmp/${unitName}.metrics` : undefined;
	const resources: PiboRunResourceUsage = {
		isolationMode: shouldIsolate ? "systemd" : "off",
		...(unitName ? { unitName } : {}),
		policy,
		admission: collectYieldedRunHostResourceSnapshot({ now: options.now }),
	};
	const preparedParams = shouldIsolate
		? { ...(params as Record<string, unknown>), command: systemdRunCommand(command, unitName!, policy, metricsPath) }
		: params;

	return {
		params: preparedParams,
		resources,
		async cancel(): Promise<void> {
			if (shouldIsolate && unitName) await terminateSystemdUnit(unitName);
		},
		async execute<T>(operation: () => Promise<T>): Promise<T> {
			if (!shouldIsolate || !unitName) return await operation();
			if (process.platform !== "linux" || !existsSync("/run/systemd/system")) {
				resources.limitReason = "systemd isolation is unavailable on this host";
				throw new PiboRunResourceLimitError("resource_limited: systemd isolation is unavailable for yielded Bash execution", resources);
			}
			resources.startedAt = new Date().toISOString();
			const monitor = monitorYieldedRunResources(unitName, policy, resources, metricsPath);
			try {
				const value = await operation();
				await monitor.finish();
				if (resources.limitReason) throw new PiboRunResourceLimitError(`resource_limited: ${resources.limitReason}`, resources);
				return value;
			} catch (error) {
				if (!(error instanceof PiboRunResourceLimitError)) await terminateSystemdUnit(unitName);
				await monitor.finish();
				if (error instanceof PiboRunResourceLimitError) throw error;
				if (resources.limitReason || cgroupReachedResourceLimit(resources.cgroup)) {
					resources.limitReason ??= cgroupLimitReason(resources.cgroup) ?? "the yielded-run cgroup reached a configured resource limit";
					throw new PiboRunResourceLimitError(`resource_limited: ${resources.limitReason}`, resources);
				}
				throw error;
			}
		},
	};
}

export function systemdRunCommand(command: string, unitName: string, policy: YieldedRunResourcePolicy, metricsPath = `/tmp/${unitName}.metrics`): string {
	const captureScript = [
		'/bin/bash -c "$1"',
		"status=$?",
		"cgroup_path=$(awk -F: '$1 == \"0\" { print $3 }' /proc/self/cgroup)",
		'cgroup_root="/sys/fs/cgroup${cgroup_path}"',
		'{',
		'printf "ControlGroup=%s\\n" "$cgroup_path"',
		'printf "CgroupRoot=%s\\n" "$cgroup_root"',
		'for file in memory.current memory.peak memory.high memory.max memory.swap.peak memory.swap.max pids.current pids.peak; do value=$(cat "$cgroup_root/$file" 2>/dev/null || true); printf "%s=%s\\n" "$file" "$value"; done',
		'cat "$cgroup_root/memory.events" 2>/dev/null | awk \'{ print "memory.events." $1 "=" $2 }\' || true',
		'cat "$cgroup_root/cpu.stat" 2>/dev/null | awk \'{ print "cpu.stat." $1 "=" $2 }\' || true',
		'cat "$cgroup_root/io.stat" 2>/dev/null | sed "s/^/io.stat./" || true',
		'} > "$2"',
		"exit $status",
	].join("\n");
	const args = [
		"systemd-run",
		"--quiet",
		"--wait",
		"--pipe",
		"--expand-environment=no",
		`--unit=${unitName}`,
		"--service-type=exec",
		"--working-directory=$PWD",
		"--slice=pibo-yielded.slice",
		"--property=KillMode=control-group",
		"--property=OOMPolicy=stop",
		`--property=MemoryHigh=${policy.memoryHighBytes}`,
		`--property=MemoryMax=${policy.memoryMaxBytes}`,
		"--property=MemorySwapMax=0",
		"--property=MemoryZSwapMax=0",
		`--property=TasksMax=${policy.tasksMax}`,
		`--property=CPUQuota=${policy.cpuQuotaPercent}%`,
		`--property=IOWeight=${policy.ioWeight}`,
		"--",
		"/bin/bash",
		"-c",
		captureScript,
		"pibo-yielded",
		command,
		metricsPath,
	];
	return args.map((value) => value === "--working-directory=$PWD" ? value : shellQuote(value)).join(" ");
}

function monitorYieldedRunResources(
	unitName: string,
	policy: YieldedRunResourcePolicy,
	resources: PiboRunResourceUsage,
	metricsPath?: string,
): { finish(): Promise<void> } {
	let finished = false;
	let pollInProgress = false;
	let killRequested = false;
	let unitObserved = false;
	const poll = async () => {
		if (finished || pollInProgress) return;
		pollInProgress = true;
		try {
			if (!unitObserved) {
				unitObserved = await systemdUnitExists(unitName);
				if (!unitObserved) return;
			}
			const host = collectYieldedRunHostResourceSnapshot();
			resources.minimumHostAvailableBytes = Math.min(resources.minimumHostAvailableBytes ?? host.memoryAvailableBytes, host.memoryAvailableBytes);
			resources.peakMemoryFullPsiAvg10 = Math.max(resources.peakMemoryFullPsiAvg10 ?? 0, host.memoryPressure.fullAvg10 ?? 0);
			resources.peakIoFullPsiAvg10 = Math.max(resources.peakIoFullPsiAvg10 ?? 0, host.ioPressure.fullAvg10 ?? 0);
			const reason = hostLimitReason(host, policy);
			if (reason) {
				resources.limitReason ??= reason;
				if (!killRequested) killRequested = await stopSystemdUnit(unitName);
			}
		} finally {
			pollInProgress = false;
		}
	};
	const timer = setInterval(() => { void poll(); }, policy.monitorIntervalMs);
	timer.unref?.();
	void poll();
	return {
		async finish() {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			while (pollInProgress) await new Promise((resolve) => setTimeout(resolve, 10));
			resources.cgroup = await collectSystemdUnitResources(unitName, metricsPath);
			resources.completedAt = new Date().toISOString();
			if (!resources.limitReason) resources.limitReason = cgroupLimitReason(resources.cgroup);
			await resetSystemdUnit(unitName);
		},
	};
}

function hostLimitReason(snapshot: YieldedRunHostResourceSnapshot, policy: YieldedRunResourcePolicy): string | undefined {
	if (snapshot.memoryAvailableBytes < policy.minHostAvailableBytes) {
		return `host MemAvailable ${snapshot.memoryAvailableBytes} fell below ${policy.minHostAvailableBytes}`;
	}
	if ((snapshot.memoryPressure.fullAvg10 ?? 0) >= policy.maxMemoryFullPsiAvg10) {
		return `host memory full PSI avg10 ${snapshot.memoryPressure.fullAvg10} reached ${policy.maxMemoryFullPsiAvg10}`;
	}
	if ((snapshot.ioPressure.fullAvg10 ?? 0) >= policy.maxIoFullPsiAvg10) {
		return `host I/O full PSI avg10 ${snapshot.ioPressure.fullAvg10} reached ${policy.maxIoFullPsiAvg10}`;
	}
	return undefined;
}

async function collectSystemdUnitResources(unitName: string, metricsPath?: string): Promise<YieldedRunCgroupSnapshot> {
	const fileSnapshot = metricsPath ? readCgroupMetrics(metricsPath, unitName) : { unitName };
	const properties = [
		"ControlGroup",
		"ActiveState",
		"SubState",
		"Result",
		"ExecMainStatus",
		"OOMKilled",
		"MemoryCurrent",
		"MemoryPeak",
		"MemoryHigh",
		"MemoryMax",
		"MemorySwapPeak",
		"MemorySwapMax",
		"CPUUsageNSec",
		"TasksCurrent",
		"TasksPeak",
		"IOReadBytes",
		"IOWriteBytes",
	];
	try {
		const { stdout } = await execFileAsync("systemctl", ["show", unitName, ...properties.map((property) => `--property=${property}`)], { timeout: 5_000 });
		const values = new Map(stdout.split("\n").flatMap((line) => {
			const index = line.indexOf("=");
			return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
		}));
		const output: YieldedRunCgroupSnapshot = { ...fileSnapshot, unitName };
		assignString(output, "controlGroup", values.get("ControlGroup"));
		assignString(output, "activeState", values.get("ActiveState"));
		assignString(output, "subState", values.get("SubState"));
		assignString(output, "result", values.get("Result"));
		assignNumber(output, "execMainStatus", values.get("ExecMainStatus"));
		if (values.get("OOMKilled") === "yes") output.oomKilled = true;
		assignNumber(output, "memoryCurrentBytes", values.get("MemoryCurrent"));
		assignNumber(output, "memoryPeakBytes", values.get("MemoryPeak"));
		assignNumber(output, "memoryHighBytes", values.get("MemoryHigh"));
		assignNumber(output, "memoryMaxBytes", values.get("MemoryMax"));
		assignNumber(output, "memorySwapPeakBytes", values.get("MemorySwapPeak"));
		assignNumber(output, "memorySwapMaxBytes", values.get("MemorySwapMax"));
		assignNumber(output, "cpuUsageNs", values.get("CPUUsageNSec"));
		assignNumber(output, "tasksCurrent", values.get("TasksCurrent"));
		assignNumber(output, "tasksPeak", values.get("TasksPeak"));
		assignNumber(output, "ioReadBytes", values.get("IOReadBytes"));
		assignNumber(output, "ioWriteBytes", values.get("IOWriteBytes"));
		return output;
	} catch {
		return fileSnapshot;
	}
}

function readCgroupMetrics(path: string, unitName: string): YieldedRunCgroupSnapshot {
	try {
		const values = new Map<string, string>();
		let ioReadBytes = 0;
		let ioWriteBytes = 0;
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (line.startsWith("io.stat.")) {
				for (const match of line.matchAll(/\b(rbytes|wbytes)=(\d+)/g)) {
					if (match[1] === "rbytes") ioReadBytes += Number(match[2]);
					else ioWriteBytes += Number(match[2]);
				}
				continue;
			}
			const equals = line.indexOf("=");
			if (equals > 0) values.set(line.slice(0, equals), line.slice(equals + 1));
		}
		return {
			unitName,
			controlGroup: nonEmpty(values.get("ControlGroup")),
			oomKilled: (finiteNumber(values.get("memory.events.oom_kill")) ?? 0) > 0,
			memoryCurrentBytes: finiteNumber(values.get("memory.current")),
			memoryPeakBytes: finiteNumber(values.get("memory.peak")),
			memoryHighBytes: finiteNumber(values.get("memory.high")),
			memoryMaxBytes: finiteNumber(values.get("memory.max")),
			memorySwapPeakBytes: finiteNumber(values.get("memory.swap.peak")),
			memorySwapMaxBytes: finiteNumber(values.get("memory.swap.max")),
			cpuUsageNs: (finiteNumber(values.get("cpu.stat.usage_usec")) ?? 0) * 1_000,
			tasksCurrent: finiteNumber(values.get("pids.current")),
			tasksPeak: finiteNumber(values.get("pids.peak")),
			ioReadBytes,
			ioWriteBytes,
		};
	} catch {
		return { unitName };
	} finally {
		try { unlinkSync(path); } catch { /* best-effort transient metrics cleanup */ }
	}
}

async function systemdUnitExists(unitName: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("systemctl", ["show", unitName, "--property=LoadState", "--value"], { timeout: 5_000 });
		return stdout.trim() !== "" && stdout.trim() !== "not-found";
	} catch {
		return false;
	}
}

async function stopSystemdUnit(unitName: string): Promise<boolean> {
	try {
		await execFileAsync("systemctl", ["kill", "--kill-whom=all", "--signal=SIGKILL", unitName], { timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

async function terminateSystemdUnit(unitName: string): Promise<void> {
	await stopSystemdUnit(unitName);
	await execFileAsync("systemctl", ["stop", unitName], { timeout: 5_000 }).catch(() => undefined);
}

async function resetSystemdUnit(unitName: string): Promise<void> {
	await execFileAsync("systemctl", ["reset-failed", unitName], { timeout: 5_000 }).catch(() => undefined);
}

function cgroupReachedResourceLimit(snapshot: YieldedRunCgroupSnapshot | undefined): boolean {
	if (!snapshot) return false;
	if (snapshot.oomKilled || snapshot.result === "oom-kill") return true;
	return snapshot.memoryPeakBytes !== undefined
		&& snapshot.memoryMaxBytes !== undefined
		&& snapshot.memoryMaxBytes > 0
		&& snapshot.memoryPeakBytes >= snapshot.memoryMaxBytes;
}

function cgroupLimitReason(snapshot: YieldedRunCgroupSnapshot | undefined): string | undefined {
	if (!snapshot) return undefined;
	if (snapshot.oomKilled || snapshot.result === "oom-kill") return `yielded-run cgroup ${snapshot.unitName} was OOM-killed`;
	if (
		snapshot.memoryPeakBytes !== undefined
		&& snapshot.memoryMaxBytes !== undefined
		&& snapshot.memoryMaxBytes > 0
		&& snapshot.memoryPeakBytes >= snapshot.memoryMaxBytes
	) {
		return `yielded-run cgroup memory peak ${snapshot.memoryPeakBytes} reached MemoryMax ${snapshot.memoryMaxBytes}`;
	}
	return undefined;
}

function bashCommand(params: unknown): string | undefined {
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	const command = (params as Record<string, unknown>).command;
	return typeof command === "string" && command.length > 0 ? command : undefined;
}

function yieldedRunUnitName(): string {
	return `pibo-yielded-${randomUUID().replaceAll("-", "").slice(0, 24)}.service`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function readOptionalFile(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function nonEmpty(value: string | undefined): string | undefined {
	return value && value !== "[not set]" ? value : undefined;
}

function assignString<K extends "controlGroup" | "activeState" | "subState" | "result">(
	output: YieldedRunCgroupSnapshot,
	key: K,
	value: string | undefined,
): void {
	const normalized = nonEmpty(value);
	if (normalized !== undefined) output[key] = normalized;
}

function assignNumber<K extends "execMainStatus" | "memoryCurrentBytes" | "memoryPeakBytes" | "memoryHighBytes" | "memoryMaxBytes" | "memorySwapPeakBytes" | "memorySwapMaxBytes" | "cpuUsageNs" | "tasksCurrent" | "tasksPeak" | "ioReadBytes" | "ioWriteBytes">(
	output: YieldedRunCgroupSnapshot,
	key: K,
	value: string | undefined,
): void {
	const normalized = finiteNumber(value);
	if (normalized !== undefined) output[key] = normalized;
}

function finiteNumber(value: string | undefined): number | undefined {
	if (!value || value === "infinity") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIsolationMode(value: string | undefined, fallback: YieldedRunIsolationMode): YieldedRunIsolationMode {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return fallback;
	return normalized === "off" || normalized === "0" || normalized === "false" ? "off" : "systemd";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
