import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { connect } from "node:net";
import type { PreviewExposure } from "./types.js";

const RESERVED_PREVIEW_PORTS = new Set([
	2375,
	2376,
	3306,
	4788,
	4789,
	4808,
	4809,
	5432,
	6379,
	9200,
	9222,
	9223,
	27017,
]);

const targetIdentityCache = new Map<string, { checkedAt: number; current: boolean }>();

export type PreviewTargetProcessIdentity = {
	pid: number;
	startTicks: string;
};

export function validatePreviewPort(port: number): number {
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error("Preview port must be an integer between 1024 and 65535");
	}
	if (RESERVED_PREVIEW_PORTS.has(port)) {
		throw new Error(`Port ${port} is reserved and cannot be exposed as a Pibo preview`);
	}
	return port;
}

export async function probePreviewTarget(
	port: number,
	options: { timeoutMs?: number } = {},
): Promise<{ host: "127.0.0.1" | "::1"; latencyMs: number } | undefined> {
	validatePreviewPort(port);
	for (const host of ["127.0.0.1", "::1"] as const) {
		const startedAt = performance.now();
		const reachable = await new Promise<boolean>((resolve) => {
			const socket = connect({ host, port });
			let settled = false;
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				socket.destroy();
				resolve(value);
			};
			socket.setTimeout(options.timeoutMs ?? 750);
			socket.once("connect", () => finish(true));
			socket.once("timeout", () => finish(false));
			socket.once("error", () => finish(false));
		});
		if (reachable) return { host, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
	}
	return undefined;
}

export function previewProcessStartTicks(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
		const closingParen = stat.lastIndexOf(")");
		if (closingParen < 0) return undefined;
		return stat.slice(closingParen + 1).trim().split(/\s+/)[19];
	} catch {
		return undefined;
	}
}

export function isPiboYieldedProcess(pid: number): boolean {
	if (process.platform !== "linux") return false;
	try {
		return /(?:^|\/)pibo-yielded-[^/\n]+\.service(?:$|\/)/m.test(readFileSync(`/proc/${pid}/cgroup`, "utf8"));
	} catch {
		return false;
	}
}

export function isPiboControlProcess(pid: number): boolean {
	if (pid === process.pid) return true;
	if (process.platform !== "linux") return false;
	try {
		const cgroup = readFileSync(`/proc/${pid}/cgroup`, "utf8");
		if (/(?:^|\/)pibo-(?:web|gateway|dev|fallback)[^/\n]*\.service(?:$|\/)/m.test(cgroup)) return true;
	} catch {
		// Fall through to command-line inspection.
	}
	try {
		const argv = readFileSync(`/proc/${pid}/cmdline`)
			.toString("utf8")
			.split("\0")
			.filter(Boolean);
		const command = argv.join(" ");
		return /(?:^|\s)(?:pibo|[^\s/]*\/pibo)(?:\s|$)/.test(command) &&
			/(?:^|\s)gateway(?::web)?(?:\s|$)/.test(command) ||
			/(?:dist|src)\/bin\/pibo\.(?:js|ts).*\bgateway(?::web)?\b/.test(command);
	} catch {
		return false;
	}
}

function loopbackSocketInodes(host: PreviewExposure["targetHost"], port: number): Set<string> {
	if (process.platform !== "linux") return new Set();
	const portHex = port.toString(16).toUpperCase().padStart(4, "0");
	const sources = host === "127.0.0.1"
		? [["/proc/net/tcp", "0100007F"]] as const
		: [["/proc/net/tcp6", "00000000000000000000000001000000"]] as const;
	const inodes = new Set<string>();
	for (const [path, address] of sources) {
		let lines: string[];
		try { lines = readFileSync(path, "utf8").split("\n").slice(1); } catch { continue; }
		for (const line of lines) {
			const fields = line.trim().split(/\s+/);
			if (fields.length < 10 || fields[3] !== "0A") continue;
			const [localAddress, localPort] = fields[1]!.split(":");
			if (localAddress === address && localPort === portHex && fields[9]) inodes.add(fields[9]);
		}
	}
	return inodes;
}

function processOwnsSocket(pid: number, inodes: ReadonlySet<string>): boolean {
	if (inodes.size === 0) return false;
	let descriptors: string[];
	try { descriptors = readdirSync(`/proc/${pid}/fd`); } catch { return false; }
	for (const descriptor of descriptors) {
		try {
			const target = readlinkSync(`/proc/${pid}/fd/${descriptor}`);
			const match = target.match(/^socket:\[(\d+)]$/);
			if (match && inodes.has(match[1]!)) return true;
		} catch {
			// File descriptors can disappear while being inspected.
		}
	}
	return false;
}

export function findPreviewTargetProcess(
	host: PreviewExposure["targetHost"],
	port: number,
): PreviewTargetProcessIdentity | undefined {
	const inodes = loopbackSocketInodes(host, port);
	if (inodes.size === 0) return undefined;
	let entries: string[];
	try { entries = readdirSync("/proc"); } catch { return undefined; }
	const owners: PreviewTargetProcessIdentity[] = [];
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number(entry);
		if (!processOwnsSocket(pid, inodes)) continue;
		const startTicks = previewProcessStartTicks(pid);
		if (startTicks) owners.push({ pid, startTicks });
	}
	return owners.length === 1 ? owners[0] : undefined;
}

export function isPreviewTargetProcessCurrent(
	exposure: Pick<PreviewExposure, "id" | "targetHost" | "targetPort" | "targetProcessId" | "targetProcessStartTicks">,
	options: { cacheMs?: number } = {},
): boolean {
	if (process.platform !== "linux") return true;
	if (!exposure.targetProcessId || !exposure.targetProcessStartTicks) return false;
	const cacheMs = options.cacheMs ?? 1_000;
	const cacheKey = [
		exposure.id,
		exposure.targetHost,
		exposure.targetPort,
		exposure.targetProcessId,
		exposure.targetProcessStartTicks,
	].join(":");
	const cached = targetIdentityCache.get(cacheKey);
	const now = Date.now();
	if (cached && now - cached.checkedAt < cacheMs) return cached.current;
	const current = previewProcessStartTicks(exposure.targetProcessId) === exposure.targetProcessStartTicks &&
		processOwnsSocket(exposure.targetProcessId, loopbackSocketInodes(exposure.targetHost, exposure.targetPort));
	if (targetIdentityCache.size >= 1_024) targetIdentityCache.clear();
	targetIdentityCache.set(cacheKey, { checkedAt: now, current });
	return current;
}
