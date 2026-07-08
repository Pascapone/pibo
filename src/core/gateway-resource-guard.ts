import { execFile } from "node:child_process";
import { freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { getHeapStatistics } from "node:v8";

const execFileAsync = promisify(execFile);

export type GatewayResourceGuardMode = "off" | "warn" | "block";
export type GatewayResourceSeverity = "ok" | "warning" | "critical";

export interface GatewayResourceGuardPolicy {
	mode: GatewayResourceGuardMode;
	minFreeMemoryBytes: number;
	minHeapAvailableBytes: number;
	maxRssBytes: number;
	knownDaemonWarningRssBytes: number;
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
}

const DEFAULT_POLICY: GatewayResourceGuardPolicy = Object.freeze({
	mode: "warn",
	minFreeMemoryBytes: 256 * 1024 * 1024,
	minHeapAvailableBytes: 64 * 1024 * 1024,
	maxRssBytes: 1536 * 1024 * 1024,
	knownDaemonWarningRssBytes: 2 * 1024 * 1024 * 1024,
});

export function resolveGatewayResourceGuardPolicy(env: NodeJS.ProcessEnv = process.env): GatewayResourceGuardPolicy {
	return {
		mode: parseMode(env.PIBO_GATEWAY_RESOURCE_GUARD, DEFAULT_POLICY.mode),
		minFreeMemoryBytes: parseByteThreshold(env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES, DEFAULT_POLICY.minFreeMemoryBytes),
		minHeapAvailableBytes: parseByteThreshold(env.PIBO_GATEWAY_MIN_HEAP_AVAILABLE_BYTES, DEFAULT_POLICY.minHeapAvailableBytes),
		maxRssBytes: parseByteThreshold(env.PIBO_GATEWAY_MAX_RSS_BYTES, DEFAULT_POLICY.maxRssBytes),
		knownDaemonWarningRssBytes: parseByteThreshold(env.PIBO_GATEWAY_KNOWN_DAEMON_WARNING_RSS_BYTES, DEFAULT_POLICY.knownDaemonWarningRssBytes),
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
	const host = { freeBytes: freemem(), totalBytes: totalmem() };
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
	if (options.includeProcesses === false || options.processListOutput !== undefined || options.processListError !== undefined) {
		return buildGatewayResourceSnapshot(options);
	}
	try {
		const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,rss=,comm=,args="], { maxBuffer: 10 * 1024 * 1024 });
		return buildGatewayResourceSnapshot({ ...options, processListOutput: stdout });
	} catch (error) {
		return buildGatewayResourceSnapshot({ ...options, processListError: error instanceof Error ? error.message : String(error) });
	}
}

export function assertGatewayResourceAvailableForWork(workLabel: string, env: NodeJS.ProcessEnv = process.env): void {
	const snapshot = buildGatewayResourceSnapshot({ env, includeProcesses: false });
	if (snapshot.guardAction !== "block") return;
	const reasons = snapshot.checks.filter((check) => check.severity === "critical").map((check) => check.message).join("; ");
	throw new Error(`Gateway resource guard blocked ${workLabel} before starting: ${reasons}`);
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

export function renderGatewayResourceSnapshotText(snapshot: GatewayResourceSnapshot): string {
	const lines = [`Gateway resource health: ${snapshot.severity} (guard=${snapshot.policy.mode}, action=${snapshot.guardAction})`];
	lines.push(`Generated at: ${snapshot.generatedAt}`);
	lines.push(`Gateway PID: ${snapshot.gateway.pid}`);
	lines.push(`Gateway memory: rss=${snapshot.gateway.rssBytes} heapUsed=${snapshot.gateway.heapUsedBytes} heapAvailable=${snapshot.gateway.heapAvailableBytes} heapLimit=${snapshot.gateway.heapLimitBytes}`);
	lines.push(`Host memory: free=${snapshot.host.freeBytes} total=${snapshot.host.totalBytes}`);
	lines.push(`Thresholds: minFree=${snapshot.policy.minFreeMemoryBytes} minHeapAvailable=${snapshot.policy.minHeapAvailableBytes} maxRss=${snapshot.policy.maxRssBytes} daemonWarnRss=${snapshot.policy.knownDaemonWarningRssBytes}`);
	lines.push(`Related processes: children=${snapshot.processes.children.length} knownDaemons=${snapshot.processes.knownDaemons.length} processList=${snapshot.processes.available ? "available" : "unavailable"}`);
	if (snapshot.processes.error) lines.push(`Process list error: ${snapshot.processes.error}`);
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
	checks.push(input.host.freeBytes < input.policy.minFreeMemoryBytes
		? { id: "host-memory-reserve", severity: "critical", message: `Host free memory ${input.host.freeBytes} is below reserve ${input.policy.minFreeMemoryBytes}.` }
		: { id: "host-memory-reserve", severity: "ok", message: `Host free memory ${input.host.freeBytes} satisfies reserve ${input.policy.minFreeMemoryBytes}.` });
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

function parseMode(value: string | undefined, fallback: GatewayResourceGuardMode): GatewayResourceGuardMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "off" || normalized === "0" || normalized === "false") return "off";
	if (normalized === "block" || normalized === "strict") return "block";
	if (normalized === "warn" || normalized === "1" || normalized === "true" || normalized === undefined || normalized === "") return "warn";
	return fallback;
}

function parseByteThreshold(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
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
