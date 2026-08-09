import { execFile } from "node:child_process";
import { freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { getHeapStatistics } from "node:v8";
import { collectYieldedRunHostResourceSnapshot, type YieldedRunHostResourceSnapshot } from "../runs/resource-isolation.js";

const execFileAsync = promisify(execFile);

export type GatewayResourceGuardMode = "off" | "warn" | "block";
export type GatewayResourceSeverity = "ok" | "warning" | "critical";

export interface GatewayResourceGuardPolicy {
	mode: GatewayResourceGuardMode;
	minFreeMemoryBytes: number;
	minHeapAvailableBytes: number;
	maxRssBytes: number;
	knownDaemonWarningRssBytes: number;
	maxConcurrentYieldedRuns: number;
	yieldedRunMemoryReservationBytes: number;
}

export interface GatewayWorkReservation {
	admission: YieldedRunHostResourceSnapshot;
	release(): void;
}

export interface GatewayProcessMemorySnapshot {
	pid: number;
	rssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
	heapLimitBytes: number;
	heapAvailableBytes: number;
	externalBytes: number;
	arrayBuffersBytes: number;
}

export interface HostMemorySnapshot {
	freeBytes: number;
	availableBytes: number;
	totalBytes: number;
}

export interface HostProcessResourceInfo {
	pid: number;
	ppid: number;
	rssBytes: number;
	commandName: string;
	args: string;
	kind: "gateway" | "child" | "known-daemon" | "other";
	label?: string;
}

export interface GatewayResourceCheck {
	id: string;
	severity: GatewayResourceSeverity;
	message: string;
}

export interface YieldedRunSystemdUnit {
	unitName: string;
	loadState: string;
	activeState: string;
	subState: string;
	description: string;
}

export interface GatewayResourceSnapshot {
	generatedAt: string;
	readOnly: true;
	policy: GatewayResourceGuardPolicy;
	gateway: GatewayProcessMemorySnapshot;
	host: HostMemorySnapshot;
	checks: GatewayResourceCheck[];
	processes: {
		available: boolean;
		error?: string;
		gatewayPid: number;
		children: HostProcessResourceInfo[];
		knownDaemons: HostProcessResourceInfo[];
	};
	yieldedRunUnits: {
		available: boolean;
		error?: string;
		units: YieldedRunSystemdUnit[];
	};
	severity: GatewayResourceSeverity;
	guardAction: "allow" | "warn" | "block";
	nextCommands: string[];
}

export interface CollectGatewayResourceSnapshotOptions {
	now?: Date;
	env?: NodeJS.ProcessEnv;
	includeProcesses?: boolean;
	processListOutput?: string;
	processListError?: string;
	yieldedUnitListOutput?: string;
	yieldedUnitListError?: string;
	hostResourceSnapshot?: YieldedRunHostResourceSnapshot;
}

const DEFAULT_POLICY: GatewayResourceGuardPolicy = Object.freeze({
	mode: "block",
	minFreeMemoryBytes: 256 * 1024 * 1024,
	minHeapAvailableBytes: 64 * 1024 * 1024,
	maxRssBytes: 1536 * 1024 * 1024,
	knownDaemonWarningRssBytes: 2 * 1024 * 1024 * 1024,
	maxConcurrentYieldedRuns: 1,
	yieldedRunMemoryReservationBytes: 2 * 1024 * 1024 * 1024,
});

export function resolveGatewayResourceGuardPolicy(env: NodeJS.ProcessEnv = process.env): GatewayResourceGuardPolicy {
	return {
		mode: parseMode(env.PIBO_GATEWAY_RESOURCE_GUARD, DEFAULT_POLICY.mode),
		minFreeMemoryBytes: parseByteThreshold(env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES, DEFAULT_POLICY.minFreeMemoryBytes),
		minHeapAvailableBytes: parseByteThreshold(env.PIBO_GATEWAY_MIN_HEAP_AVAILABLE_BYTES, DEFAULT_POLICY.minHeapAvailableBytes),
		maxRssBytes: parseByteThreshold(env.PIBO_GATEWAY_MAX_RSS_BYTES, DEFAULT_POLICY.maxRssBytes),
		knownDaemonWarningRssBytes: parseByteThreshold(env.PIBO_GATEWAY_KNOWN_DAEMON_WARNING_RSS_BYTES, DEFAULT_POLICY.knownDaemonWarningRssBytes),
		maxConcurrentYieldedRuns: parsePositiveInteger(env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS, DEFAULT_POLICY.maxConcurrentYieldedRuns),
		yieldedRunMemoryReservationBytes: parseByteThreshold(env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES, DEFAULT_POLICY.yieldedRunMemoryReservationBytes),
	};
}

export function collectGatewayProcessMemory(): GatewayProcessMemorySnapshot {
	const memory = process.memoryUsage();
	const heap = getHeapStatistics();
	return {
		pid: process.pid,
		rssBytes: memory.rss,
		heapUsedBytes: memory.heapUsed,
		heapTotalBytes: memory.heapTotal,
		heapLimitBytes: heap.heap_size_limit,
		heapAvailableBytes: Math.max(0, heap.heap_size_limit - memory.heapUsed),
		externalBytes: memory.external,
		arrayBuffersBytes: memory.arrayBuffers,
	};
}

export function buildGatewayResourceSnapshot(options: CollectGatewayResourceSnapshotOptions = {}): GatewayResourceSnapshot {
	const policy = resolveGatewayResourceGuardPolicy(options.env);
	const gateway = collectGatewayProcessMemory();
	const hostResources = options.hostResourceSnapshot ?? collectYieldedRunHostResourceSnapshot({ now: options.now });
	const host = { freeBytes: hostResources.memoryFreeBytes || freemem(), availableBytes: hostResources.memoryAvailableBytes || freemem(), totalBytes: totalmem() };
	const processResult = processResultFromOptions(gateway.pid, options, policy);
	const checks = evaluateGatewayResourceChecks({ gateway, host, policy, knownDaemons: processResult.knownDaemons });
	const severity = maxSeverity(checks.map((check) => check.severity));
	return {
		generatedAt: (options.now ?? new Date()).toISOString(),
		readOnly: true,
		policy,
		gateway,
		host,
		checks,
		processes: processResult,
		yieldedRunUnits: yieldedUnitResultFromOptions(options),
		severity,
		guardAction: guardAction(policy, severity),
		nextCommands: [
			"pibo debug resources --json",
			"pibo compute health --json",
			"pibo debug telemetry sessions --active",
			"pibo debug runs list <pibo-session-id> --json",
		],
	};
}

export async function collectGatewayResourceSnapshot(options: CollectGatewayResourceSnapshotOptions = {}): Promise<GatewayResourceSnapshot> {
	if (
		options.includeProcesses === false
		|| options.processListOutput !== undefined
		|| options.processListError !== undefined
		|| options.yieldedUnitListOutput !== undefined
		|| options.yieldedUnitListError !== undefined
	) {
		return buildGatewayResourceSnapshot(options);
	}
	const [processes, yieldedUnits] = await Promise.allSettled([
		execFileAsync("ps", ["-eo", "pid=,ppid=,rss=,comm=,args="], { maxBuffer: 10 * 1024 * 1024 }),
		execFileAsync("systemctl", ["list-units", "--all", "--plain", "--no-legend", "--no-pager", "pibo-yielded-*.service"], { maxBuffer: 1024 * 1024 }),
	]);
	return buildGatewayResourceSnapshot({
		...options,
		...(processes.status === "fulfilled" ? { processListOutput: processes.value.stdout } : { processListError: errorText(processes.reason) }),
		...(yieldedUnits.status === "fulfilled" ? { yieldedUnitListOutput: yieldedUnits.value.stdout } : { yieldedUnitListError: errorText(yieldedUnits.reason) }),
	});
}

export function assertGatewayResourceAvailableForWork(workLabel: string, env: NodeJS.ProcessEnv = process.env): void {
	const snapshot = buildGatewayResourceSnapshot({ env, includeProcesses: false });
	if (snapshot.guardAction !== "block") return;
	throwGatewayResourceBlock(workLabel, snapshot.checks.filter((check) => check.severity === "critical").map((check) => check.message));
}

export class GatewayWorkAdmissionController {
	private readonly activeReservations = new Set<symbol>();

	reserve(workLabel: string, env: NodeJS.ProcessEnv = process.env): GatewayWorkReservation {
		const snapshot = buildGatewayResourceSnapshot({ env, includeProcesses: false });
		const policy = snapshot.policy;
		if (snapshot.guardAction === "block") {
			throwGatewayResourceBlock(workLabel, snapshot.checks.filter((check) => check.severity === "critical").map((check) => check.message));
		}
		if (policy.mode === "block" && this.activeReservations.size >= policy.maxConcurrentYieldedRuns) {
			throwGatewayResourceBlock(workLabel, [
				`Active yielded runs ${this.activeReservations.size} reached the configured limit ${policy.maxConcurrentYieldedRuns}. Wait for an active run to settle or raise PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS explicitly.`,
			]);
		}
		if (
			policy.mode === "block" &&
			snapshot.host.availableBytes < policy.minFreeMemoryBytes + policy.yieldedRunMemoryReservationBytes
		) {
			throwGatewayResourceBlock(workLabel, [
				`Host available memory ${snapshot.host.availableBytes} cannot preserve reserve ${policy.minFreeMemoryBytes} after the yielded-run reservation ${policy.yieldedRunMemoryReservationBytes}.`,
			]);
		}

		const reservation = Symbol(workLabel);
		this.activeReservations.add(reservation);
		let released = false;
		return {
			admission: collectYieldedRunHostResourceSnapshot(),
			release: () => {
				if (released) return;
				released = true;
				this.activeReservations.delete(reservation);
			},
		};
	}
}

export function parseHostProcessResourceList(output: string, gatewayPid: number, policy: GatewayResourceGuardPolicy = DEFAULT_POLICY): HostProcessResourceInfo[] {
	const rows: HostProcessResourceInfo[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
		if (!match) continue;
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const rssBytes = Number(match[3]) * 1024;
		if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(rssBytes)) continue;
		const commandName = match[4] ?? "";
		const args = match[5] ?? "";
		const daemonLabel = knownDaemonLabel(commandName, args);
		const kind: HostProcessResourceInfo["kind"] = pid === gatewayPid ? "gateway" : ppid === gatewayPid ? "child" : daemonLabel ? "known-daemon" : "other";
		rows.push({ pid, ppid, rssBytes, commandName, args: sanitizeArgsPreview(args), kind, label: daemonLabel });
	}
	return rows
		.filter((row) => row.kind === "gateway" || row.kind === "child" || row.kind === "known-daemon")
		.sort((a, b) => resourceProcessRank(a, policy) - resourceProcessRank(b, policy) || b.rssBytes - a.rssBytes);
}

export function parseYieldedRunSystemdUnits(output: string): YieldedRunSystemdUnit[] {
	return output.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(pibo-yielded-[^\s]+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
		return match ? [{ unitName: match[1]!, loadState: match[2]!, activeState: match[3]!, subState: match[4]!, description: match[5] ?? "" }] : [];
	});
}

export function renderGatewayResourceSnapshotText(snapshot: GatewayResourceSnapshot): string {
	const lines = [`Gateway resource health: ${snapshot.severity} (guard=${snapshot.policy.mode}, action=${snapshot.guardAction})`];
	lines.push(`Generated at: ${snapshot.generatedAt}`);
	lines.push(`Gateway PID: ${snapshot.gateway.pid}`);
	lines.push(`Gateway memory: rss=${snapshot.gateway.rssBytes} heapUsed=${snapshot.gateway.heapUsedBytes} heapAvailable=${snapshot.gateway.heapAvailableBytes} heapLimit=${snapshot.gateway.heapLimitBytes}`);
	lines.push(`Host memory: free=${snapshot.host.freeBytes} available=${snapshot.host.availableBytes} total=${snapshot.host.totalBytes}`);
	lines.push(`Thresholds: minFree=${snapshot.policy.minFreeMemoryBytes} minHeapAvailable=${snapshot.policy.minHeapAvailableBytes} maxRss=${snapshot.policy.maxRssBytes} daemonWarnRss=${snapshot.policy.knownDaemonWarningRssBytes} maxYieldedRuns=${snapshot.policy.maxConcurrentYieldedRuns} yieldedRunReservation=${snapshot.policy.yieldedRunMemoryReservationBytes}`);
	lines.push(`Related processes: children=${snapshot.processes.children.length} knownDaemons=${snapshot.processes.knownDaemons.length} processList=${snapshot.processes.available ? "available" : "unavailable"}`);
	lines.push(`Yielded-run cgroups: units=${snapshot.yieldedRunUnits.units.length} systemdList=${snapshot.yieldedRunUnits.available ? "available" : "unavailable"}`);
	if (snapshot.processes.error) lines.push(`Process list error: ${snapshot.processes.error}`);
	if (snapshot.yieldedRunUnits.error) lines.push(`Yielded-run unit list error: ${snapshot.yieldedRunUnits.error}`);
	for (const unit of snapshot.yieldedRunUnits.units) lines.push(`- ${unit.unitName}: ${unit.activeState}/${unit.subState}`);
	const visibleProcesses = [...snapshot.processes.children, ...snapshot.processes.knownDaemons].slice(0, 10);
	if (visibleProcesses.length > 0) {
		lines.push("PID\tPPID\tRSS_BYTES\tKIND\tLABEL\tCOMMAND");
		for (const process of visibleProcesses) {
			lines.push(`${process.pid}\t${process.ppid}\t${process.rssBytes}\t${process.kind}\t${process.label ?? "-"}\t${process.commandName}`);
		}
	}
	lines.push("Checks:");
	for (const check of snapshot.checks) lines.push(`- [${check.severity}] ${check.id}: ${check.message}`);
	lines.push("Next commands:");
	for (const command of snapshot.nextCommands) lines.push(`- ${command}`);
	return lines.join("\n");
}

function evaluateGatewayResourceChecks(input: { gateway: GatewayProcessMemorySnapshot; host: HostMemorySnapshot; policy: GatewayResourceGuardPolicy; knownDaemons: HostProcessResourceInfo[] }): GatewayResourceCheck[] {
	const checks: GatewayResourceCheck[] = [];
	if (input.policy.mode === "off") {
		checks.push({ id: "guard-disabled", severity: "ok", message: "Gateway resource guard is disabled." });
		return checks;
	}
	checks.push(input.host.availableBytes < input.policy.minFreeMemoryBytes
		? { id: "host-memory-reserve", severity: "critical", message: `Host available memory ${input.host.availableBytes} is below reserve ${input.policy.minFreeMemoryBytes}.` }
		: { id: "host-memory-reserve", severity: "ok", message: `Host available memory ${input.host.availableBytes} satisfies reserve ${input.policy.minFreeMemoryBytes}.` });
	checks.push(input.gateway.heapAvailableBytes < input.policy.minHeapAvailableBytes
		? { id: "gateway-heap-reserve", severity: "critical", message: `Gateway heap availability ${input.gateway.heapAvailableBytes} is below reserve ${input.policy.minHeapAvailableBytes}.` }
		: { id: "gateway-heap-reserve", severity: "ok", message: `Gateway heap availability ${input.gateway.heapAvailableBytes} satisfies reserve ${input.policy.minHeapAvailableBytes}.` });
	checks.push(input.gateway.rssBytes > input.policy.maxRssBytes
		? { id: "gateway-rss-limit", severity: "critical", message: `Gateway RSS ${input.gateway.rssBytes} exceeds limit ${input.policy.maxRssBytes}.` }
		: { id: "gateway-rss-limit", severity: "ok", message: `Gateway RSS ${input.gateway.rssBytes} is within limit ${input.policy.maxRssBytes}.` });
	const heavyDaemons = input.knownDaemons.filter((process) => process.rssBytes >= input.policy.knownDaemonWarningRssBytes);
	if (heavyDaemons.length > 0) checks.push({ id: "known-heavy-daemons", severity: "warning", message: `${heavyDaemons.length} known heavy daemon(s) exceed RSS warning threshold: ${heavyDaemons.map((process) => `${process.label ?? process.commandName}:${process.rssBytes}`).join(", ")}.` });
	return checks;
}

function processResultFromOptions(gatewayPid: number, options: CollectGatewayResourceSnapshotOptions, policy: GatewayResourceGuardPolicy): GatewayResourceSnapshot["processes"] {
	if (options.processListError) return { available: false, error: options.processListError, gatewayPid, children: [], knownDaemons: [] };
	if (options.processListOutput === undefined) return { available: false, gatewayPid, children: [], knownDaemons: [] };
	const rows = parseHostProcessResourceList(options.processListOutput, gatewayPid, policy);
	return {
		available: true,
		gatewayPid,
		children: rows.filter((row) => row.kind === "child"),
		knownDaemons: rows.filter((row) => row.kind === "known-daemon"),
	};
}

function yieldedUnitResultFromOptions(options: CollectGatewayResourceSnapshotOptions): GatewayResourceSnapshot["yieldedRunUnits"] {
	if (options.yieldedUnitListError) return { available: false, error: options.yieldedUnitListError, units: [] };
	if (options.yieldedUnitListOutput === undefined) return { available: false, units: [] };
	return { available: true, units: parseYieldedRunSystemdUnits(options.yieldedUnitListOutput) };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseMode(value: string | undefined, fallback: GatewayResourceGuardMode): GatewayResourceGuardMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === undefined || normalized === "") return fallback;
	if (normalized === "off" || normalized === "0" || normalized === "false") return "off";
	if (normalized === "block" || normalized === "strict") return "block";
	if (normalized === "warn" || normalized === "1" || normalized === "true") return "warn";
	return fallback;
}

function parseByteThreshold(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function throwGatewayResourceBlock(workLabel: string, reasons: string[]): never {
	throw new Error(`Gateway resource guard blocked ${workLabel} before starting: ${reasons.join("; ")}`);
}

function knownDaemonLabel(commandName: string, args: string): string | undefined {
	const combined = `${commandName} ${args}`;
	if (/comfyui|main\.py.*--port\s+8188/i.test(combined)) return "ComfyUI";
	if (/unity(\.exe)?|Unity Editor/i.test(combined)) return "Unity";
	return undefined;
}

function sanitizeArgsPreview(args: string): string {
	const redacted = args
		.replace(/(token|access_token|refresh_token|password|passwd|cookie|secret)=([^\s]+)/gi, "$1=<redacted>")
		.replace(/(--(?:token|password|cookie|secret))\s+([^\s]+)/gi, "$1 <redacted>");
	return redacted.length > 220 ? `${redacted.slice(0, 217)}...` : redacted;
}

function resourceProcessRank(process: HostProcessResourceInfo, policy: GatewayResourceGuardPolicy): number {
	if (process.kind === "gateway") return 0;
	if (process.kind === "child") return 1;
	if (process.rssBytes >= policy.knownDaemonWarningRssBytes) return 2;
	return 3;
}

function guardAction(policy: GatewayResourceGuardPolicy, severity: GatewayResourceSeverity): GatewayResourceSnapshot["guardAction"] {
	if (policy.mode === "off") return "allow";
	if (policy.mode === "block" && severity === "critical") return "block";
	if (severity === "warning" || severity === "critical") return "warn";
	return "allow";
}

function maxSeverity(values: GatewayResourceSeverity[]): GatewayResourceSeverity {
	if (values.includes("critical")) return "critical";
	if (values.includes("warning")) return "warning";
	return "ok";
}
