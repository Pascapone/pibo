import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
	COMPUTE_RESOURCE_POLICY_LABELS,
	buildComputeResourcePolicyLabels,
	buildDockerResourcePolicyArgs,
	resolveComputeResourcePolicy,
	type ComputeResourcePolicy,
} from "./resource-policy.js";

const execFileAsync = promisify(execFile);

export const IMAGE_NAME = "pibo:latest";
export const LABEL_ROLE = "pibo.compute.role";
export const LABEL_CREATED_AT = "pibo.compute.createdAt";
export const LABEL_OWNER = "pibo.compute.owner";
export const LABEL_OWNER_SCOPE = "pibo.compute.ownerScope";
export const LABEL_WORKTREE = "pibo.compute.worktree";
export const LABEL_WORKTREE_PATH = "pibo.compute.worktreePath";
export const LABEL_PORT_BLOCK = "pibo.compute.portBlock";
export const LABEL_TTL_SECONDS = "pibo.compute.ttlSeconds";
export const LABEL_IDLE_SECONDS = "pibo.compute.idleSeconds";
export const LABEL_LAST_USED_AT = "pibo.compute.lastUsedAt";
export const LABEL_CLEANUP_STATE = "pibo.compute.cleanupState";
export const LABEL_DIRTY_REASON = "pibo.compute.dirtyReason";
export const LABEL_RALPH_JOB_ID = "pibo.ralph.jobId";
export const LABEL_RALPH_RUN_ID = "pibo.ralph.runId";

export interface SpawnedWorker {
	id: string;
	image: string;
	gatewayHost: string;
	gatewayPort: number;
	cdpPort: number;
	webPort: number;
	connect: string;
}

export async function dockerBuild(workspaceDir: string): Promise<void> {
	const { stderr } = await execFileAsync("docker", ["build", "-t", IMAGE_NAME, "."], {
		cwd: workspaceDir,
		maxBuffer: 50 * 1024 * 1024,
	});
	if (stderr) console.error(stderr);
}

export async function imageExists(name: string): Promise<boolean> {
	try {
		await execFileAsync("docker", ["inspect", "--type=image", name]);
		return true;
	} catch {
		return false;
	}
}

export async function getDependencyHash(workspaceDir: string): Promise<string> {
	const hash = createHash("sha256");
	const files = ["package.json", "package-lock.json", "Dockerfile"];
	for (const file of files) {
		try {
			const content = await readFile(path.join(workspaceDir, file));
			hash.update(content);
		} catch {
			// file missing, skip
		}
	}
	return hash.digest("hex");
}

export async function getSourceHash(workspaceDir: string): Promise<string> {
	const hash = createHash("sha256");
	const files: string[] = [];

	async function walk(dir: string) {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (
					entry.name === "node_modules" ||
					entry.name === ".git" ||
					entry.name === "dist" ||
					entry.name === ".pibo" ||
					entry.name === "plans" ||
					entry.name === "Reports"
				) {
					continue;
				}
				await walk(fullPath);
			} else if (entry.isFile()) {
				if (
					entry.name.endsWith(".ts") ||
					entry.name.endsWith(".tsx") ||
					entry.name === "package.json" ||
					entry.name === "package-lock.json" ||
					entry.name === "Dockerfile"
				) {
					files.push(fullPath);
				}
			}
		}
	}

	await walk(workspaceDir);
	files.sort();

	for (const file of files) {
		const content = await readFile(file);
		hash.update(content);
	}

	return hash.digest("hex");
}

export async function shouldRebuild(workspaceDir: string, hashFile: string): Promise<boolean> {
	const currentHash = await getSourceHash(workspaceDir);
	try {
		const savedHash = await readFile(hashFile, "utf-8");
		return savedHash.trim() !== currentHash;
	} catch {
		return true;
	}
}

export async function shouldRebuildDeps(workspaceDir: string, hashFile: string): Promise<boolean> {
	const currentHash = await getDependencyHash(workspaceDir);
	try {
		const savedHash = await readFile(hashFile, "utf-8");
		return savedHash.trim() !== currentHash;
	} catch {
		return true;
	}
}

export async function saveHash(workspaceDir: string, hashFile: string): Promise<void> {
	const hash = await getSourceHash(workspaceDir);
	await mkdir(path.dirname(hashFile), { recursive: true });
	await writeFile(hashFile, hash, "utf-8");
}

export async function saveDepHash(workspaceDir: string, hashFile: string): Promise<void> {
	const hash = await getDependencyHash(workspaceDir);
	await mkdir(path.dirname(hashFile), { recursive: true });
	await writeFile(hashFile, hash, "utf-8");
}

export interface SpawnedDevWorker {
	id: string;
	image: string;
	gatewayHost: string;
	gatewayPort: number;
	cdpPort: number;
	webPort: number;
	webUIPortChat: number;
	webUIPortContext: number;
	connect: string;
	worktree: string;
}

const DEV_PORT_BASE = 4800;
const DEV_PORT_BLOCK_SIZE = 10;

async function findNextPortBlock(): Promise<number> {
	const { stdout } = await execFileAsync("docker", [
		"ps",
		"--filter",
		`label=${LABEL_ROLE}=dev`,
		"--format",
		"{{.Labels}}",
	]);
	const usedBlocks = new Set<number>();
	for (const line of stdout.trim().split("\n")) {
		const match = line.match(/pibo\.compute\.portBlock=(\d+)/);
		if (match) usedBlocks.add(Number(match[1]));
	}
	let block = 0;
	while (usedBlocks.has(block)) block++;
	return block;
}

export const DEFAULT_COMPUTE_WORKER_TTL_SECONDS = 60 * 60;
export const DEFAULT_COMPUTE_WORKER_IDLE_SECONDS = 30 * 60;

export interface ComputeWorkerLifecycleLabels {
	ttlSeconds: number;
	idleSeconds: number;
}

export function resolveComputeWorkerLifecycle(options: { ttlSeconds?: number; idleSeconds?: number } = {}, env: NodeJS.ProcessEnv = process.env): ComputeWorkerLifecycleLabels {
	return {
		ttlSeconds: positiveIntegerOption(options.ttlSeconds, env.PIBO_COMPUTE_TTL_SECONDS, DEFAULT_COMPUTE_WORKER_TTL_SECONDS),
		idleSeconds: positiveIntegerOption(options.idleSeconds, env.PIBO_COMPUTE_IDLE_SECONDS, DEFAULT_COMPUTE_WORKER_IDLE_SECONDS),
	};
}

interface ComputeWorkerMetadataLabelOptions {
	role: "worker" | "dev" | string;
	createdAt: string;
	owner?: string;
	worktree?: string;
	worktreePath?: string;
	portBlock: string;
	ports: Record<string, string>;
	ttlSeconds: number;
	idleSeconds: number;
	ralphJobId?: string;
	ralphRunId?: string;
}

const SAFE_RALPH_LABEL_VALUE = /^[A-Za-z0-9._:-]{1,128}$/;

function safeRalphLabel(label: string, value: string | undefined): string[] {
	if (!value || !SAFE_RALPH_LABEL_VALUE.test(value)) return [];
	return [`${label}=${value}`];
}

function buildComputeWorkerMetadataLabels(options: ComputeWorkerMetadataLabelOptions): string[] {
	return [
		`${LABEL_ROLE}=${options.role}`,
		`${LABEL_CREATED_AT}=${options.createdAt}`,
		`${LABEL_PORT_BLOCK}=${options.portBlock}`,
		`${LABEL_TTL_SECONDS}=${options.ttlSeconds}`,
		`${LABEL_IDLE_SECONDS}=${options.idleSeconds}`,
		...(options.owner ? [`${LABEL_OWNER}=${options.owner}`, `${LABEL_OWNER_SCOPE}=${options.owner}`] : []),
		...(options.worktree ? [`${LABEL_WORKTREE}=${options.worktree}`] : []),
		...(options.worktreePath ? [`${LABEL_WORKTREE_PATH}=${options.worktreePath}`] : []),
		...Object.entries(options.ports).map(([name, value]) => `pibo.compute.port.${name}=${value}`),
		...safeRalphLabel(LABEL_RALPH_JOB_ID, options.ralphJobId),
		...safeRalphLabel(LABEL_RALPH_RUN_ID, options.ralphRunId),
	];
}

function positiveIntegerOption(optionValue: number | undefined, envValue: string | undefined, fallback: number): number {
	if (typeof optionValue === "number" && Number.isInteger(optionValue) && optionValue > 0) return optionValue;
	if (envValue === undefined || envValue.trim() === "") return fallback;
	const parsed = Number(envValue);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function createWorktree(repoDir: string, name: string): Promise<string> {
	const worktreePath = path.join(repoDir, ".worktrees", name);
	try {
		await execFileAsync("git", ["worktree", "add", worktreePath, "-b", name], { cwd: repoDir });
	} catch (err: any) {
		if (err.stderr?.includes("already exists")) {
			// branch or worktree exists; try without -b
			await execFileAsync("git", ["worktree", "add", worktreePath, name], { cwd: repoDir });
		} else {
			throw err;
		}
	}
	return worktreePath;
}

export interface BuildDevWorkerDockerRunArgsOptions {
	id: string;
	worktreePath: string;
	worktreeName: string;
	block: number;
	gatewayPort: number;
	cdpPort: number;
	webPort: number;
	webUIPortChat: number;
	webUIPortContext: number;
	createdAt: string;
	owner?: string;
	ttlSeconds?: number;
	idleSeconds?: number;
	ralphJobId?: string;
	ralphRunId?: string;
	hostNodeModules?: string;
	policy?: ComputeResourcePolicy;
}

export function buildDevWorkerDockerRunArgs(options: BuildDevWorkerDockerRunArgsOptions): string[] {
	const policy = options.policy ?? resolveComputeResourcePolicy();
	const lifecycle = resolveComputeWorkerLifecycle(options);
	return [
		"run",
		"-d",
		"--name",
		options.id,
		...buildDockerResourcePolicyArgs(policy),
		"-p",
		`${options.gatewayPort}:4789`,
		"-p",
		`${options.cdpPort}:56663`,
		"-p",
		`${options.webPort}:4788`,
		"-p",
		`${options.webUIPortChat}:4790`,
		"-p",
		`${options.webUIPortContext}:4791`,
		"-v",
		`${options.worktreePath}:/workspace`,
		...(options.hostNodeModules ? ["-v", `${options.hostNodeModules}:/workspace/node_modules`] : []),
		"-w",
		"/workspace",
		...buildComputeWorkerMetadataLabels({
			role: "dev",
			createdAt: options.createdAt,
			owner: options.owner,
			worktree: options.worktreeName,
			worktreePath: options.worktreePath,
			portBlock: String(options.block),
			ports: {
				gateway: String(options.gatewayPort),
				cdp: String(options.cdpPort),
				web: String(options.webPort),
				chatUi: String(options.webUIPortChat),
				contextUi: String(options.webUIPortContext),
			},
			ttlSeconds: lifecycle.ttlSeconds,
			idleSeconds: lifecycle.idleSeconds,
			ralphJobId: options.ralphJobId,
			ralphRunId: options.ralphRunId,
		}).flatMap((label) => ["--label", label]),
		...buildComputeResourcePolicyLabels(policy).flatMap((label) => ["--label", label]),
		"--entrypoint",
		"/bin/sh",
		IMAGE_NAME,
		"-c",
		"tail -f /dev/null",
	];
}

export async function spawnDevWorker(options: {
	repoDir: string;
	worktreeName: string;
	owner?: string;
	ttlSeconds?: number;
	idleSeconds?: number;
	ralphJobId?: string;
	ralphRunId?: string;
}): Promise<SpawnedDevWorker> {
	const worktreePath = path.join(options.repoDir, ".worktrees", options.worktreeName);
	await createWorktree(options.repoDir, options.worktreeName);

	const block = await findNextPortBlock();
	const base = DEV_PORT_BASE + block * DEV_PORT_BLOCK_SIZE;
	const gatewayPort = base;
	const cdpPort = base + 1;
	const webPort = base + 2;
	const webUIPortChat = base + 3;
	const webUIPortContext = base + 4;

	const id = `pibo-dev-${options.worktreeName}`;
	const createdAt = new Date().toISOString();

	// Mount host node_modules into the container so dependencies are immediately available
	const hostNodeModules = path.join(options.repoDir, "node_modules");
	let nodeModulesMount: string | undefined;
	try {
		const { stdout } = await execFileAsync("ls", ["-d", hostNodeModules]);
		if (stdout.trim()) nodeModulesMount = hostNodeModules;
	} catch {
		// host node_modules does not exist; skip mount
	}

	const args = buildDevWorkerDockerRunArgs({
		id,
		worktreePath,
		worktreeName: options.worktreeName,
		block,
		gatewayPort,
		cdpPort,
		webPort,
		webUIPortChat,
		webUIPortContext,
		createdAt,
		owner: options.owner,
		ttlSeconds: options.ttlSeconds,
		idleSeconds: options.idleSeconds,
		ralphJobId: options.ralphJobId,
		ralphRunId: options.ralphRunId,
		hostNodeModules: nodeModulesMount,
	});

	await execFileAsync("docker", args, { cwd: options.repoDir });

	const host = await detectHost();

	return {
		id,
		image: IMAGE_NAME,
		gatewayHost: host,
		gatewayPort,
		cdpPort,
		webPort,
		webUIPortChat,
		webUIPortContext,
		connect: `docker exec -it ${id} bash`,
		worktree: worktreePath,
	};
}

export interface BuildWorkerDockerRunArgsOptions {
	id: string;
	createdAt: string;
	owner?: string;
	worktreePath?: string;
	ttlSeconds?: number;
	idleSeconds?: number;
	ralphJobId?: string;
	ralphRunId?: string;
	policy?: ComputeResourcePolicy;
}

export function buildWorkerDockerRunArgs(options: BuildWorkerDockerRunArgsOptions): string[] {
	const policy = options.policy ?? resolveComputeResourcePolicy();
	const lifecycle = resolveComputeWorkerLifecycle(options);
	return [
		"run",
		"-d",
		"--name",
		options.id,
		...buildDockerResourcePolicyArgs(policy),
		"-p",
		"4789",
		"-p",
		"56663",
		"-p",
		"4788",
		...buildComputeWorkerMetadataLabels({
			role: "worker",
			createdAt: options.createdAt,
			owner: options.owner,
			worktree: options.worktreePath ? path.basename(options.worktreePath) : undefined,
			worktreePath: options.worktreePath,
			portBlock: "dynamic",
			ports: { gateway: "4789", cdp: "56663", web: "4788" },
			ttlSeconds: lifecycle.ttlSeconds,
			idleSeconds: lifecycle.idleSeconds,
			ralphJobId: options.ralphJobId,
			ralphRunId: options.ralphRunId,
		}).flatMap((label) => ["--label", label]),
		...buildComputeResourcePolicyLabels(policy).flatMap((label) => ["--label", label]),
		IMAGE_NAME,
		"gateway:web",
	];
}

export async function spawnWorker(options: {
	workspaceDir: string;
	name?: string;
	owner?: string;
	ttlSeconds?: number;
	idleSeconds?: number;
	ralphJobId?: string;
	ralphRunId?: string;
}): Promise<SpawnedWorker> {
	const id = options.name || `pibo-worker-${Math.random().toString(36).slice(2, 10)}`;
	const createdAt = new Date().toISOString();

	const args = buildWorkerDockerRunArgs({
		id,
		createdAt,
		owner: options.owner,
		worktreePath: options.workspaceDir,
		ttlSeconds: options.ttlSeconds,
		idleSeconds: options.idleSeconds,
		ralphJobId: options.ralphJobId,
		ralphRunId: options.ralphRunId,
	});

	await execFileAsync("docker", args, { cwd: options.workspaceDir });

	// Get assigned ports
	const { stdout: port4789 } = await execFileAsync("docker", ["port", id, "4789"]);
	const { stdout: port56663 } = await execFileAsync("docker", ["port", id, "56663"]);
	const { stdout: port4788 } = await execFileAsync("docker", ["port", id, "4788"]);

	const gatewayPort = parseHostPort(port4789);
	const cdpPort = parseHostPort(port56663);
	const webPort = parseHostPort(port4788);

	// Detect host IP
	const host = await detectHost();

	return {
		id,
		image: IMAGE_NAME,
		gatewayHost: host,
		gatewayPort,
		cdpPort,
		webPort,
		connect: `docker exec -it ${id} bash`,
	};
}

function parseHostPort(dockerPortOutput: string): number {
	const lines = dockerPortOutput.trim().split("\n");
	for (const line of lines) {
		const parts = line.trim().split(":");
		if (parts.length >= 2) {
			const port = parseInt(parts[parts.length - 1], 10);
			if (!Number.isNaN(port) && port > 0) {
				return port;
			}
		}
	}
	return 0;
}

async function detectHost(): Promise<string> {
	try {
		const { stdout } = await execFileAsync("hostname", ["-I"]);
		const ips = stdout.trim().split(/\s+/);
		const nonLocal = ips.find((ip) => !ip.startsWith("127."));
		if (nonLocal) return nonLocal;
		return ips[0] || "127.0.0.1";
	} catch {
		return "127.0.0.1";
	}
}

export interface ComputeWorkerCleanupEligibility {
	eligible: boolean;
	reasons: string[];
	nextCommands: string[];
}

export interface WorkerInfo {
	id: string;
	name: string;
	role: "worker" | "dev" | string;
	state: string;
	status: string;
	ports: string;
	portMap: Record<string, string>;
	hostPid?: number;
	createdAt: string;
	lastUsedAt?: string;
	ownerScope?: string;
	worktree?: string;
	worktreePath?: string;
	ralphJobId?: string;
	ralphRunId?: string;
	cleanupState?: string;
	dirtyReason?: string;
	oomKilled?: boolean;
	exitCode?: number;
	resourcePolicy?: Partial<ComputeResourcePolicy>;
	cleanupEligibility: ComputeWorkerCleanupEligibility;
}

export type DockerDiskUsageKind = "images" | "containers" | "localVolumes" | "buildCache" | "unknown";

export interface DockerDiskUsageRow {
	kind: DockerDiskUsageKind;
	label: string;
	totalCount?: number;
	active?: number;
	size: string;
	sizeBytes?: number;
	reclaimable: string;
	reclaimableBytes?: number;
	raw: Record<string, string>;
}

export interface ComputeDiskCleanupSuggestion {
	kind: "container-cleanup" | "image-cleanup" | "build-cache-prune" | "worktree-cleanup";
	reason: string;
	nextCommands: string[];
}

export interface ComputeDiskDiagnostics {
	generatedAt: string;
	readOnly: true;
	dockerAvailable: boolean;
	dockerError?: string;
	usage: Record<DockerDiskUsageKind, DockerDiskUsageRow | undefined>;
	rows: DockerDiskUsageRow[];
	totals: {
		sizeBytes?: number;
		reclaimableBytes?: number;
	};
	suggestions: ComputeDiskCleanupSuggestion[];
}

interface DockerInspectContainer {
	Id?: string;
	Name?: string;
	Created?: string;
	Config?: { Labels?: Record<string, string> | null };
	State?: { Status?: string; Running?: boolean; OOMKilled?: boolean; Dead?: boolean; ExitCode?: number; StartedAt?: string; FinishedAt?: string; Pid?: number };
	HostConfig?: { Memory?: number; MemorySwap?: number; PidsLimit?: number; ShmSize?: number; RestartPolicy?: { Name?: string }; LogConfig?: { Type?: string; Config?: Record<string, string> } };
	NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | null };
}

export function parseDockerLabels(labelsStr: string | undefined): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const part of (labelsStr ?? "").split(",")) {
		const index = part.indexOf("=");
		if (index <= 0) continue;
		labels[part.slice(0, index)] = part.slice(index + 1);
	}
	return labels;
}

function numberLabel(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function resourcePolicyFromLabels(labels: Record<string, string>): Partial<ComputeResourcePolicy> | undefined {
	const policy: Partial<ComputeResourcePolicy> = {};
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.memory]) policy.memory = labels[COMPUTE_RESOURCE_POLICY_LABELS.memory];
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.memorySwap]) policy.memorySwap = labels[COMPUTE_RESOURCE_POLICY_LABELS.memorySwap];
	const pidsLimit = numberLabel(labels[COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit]);
	if (pidsLimit !== undefined) policy.pidsLimit = pidsLimit;
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.shmSize]) policy.shmSize = labels[COMPUTE_RESOURCE_POLICY_LABELS.shmSize];
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.init]) policy.init = labels[COMPUTE_RESOURCE_POLICY_LABELS.init] === "true";
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.restart] === "no") policy.restart = "no";
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.logDriver] === "json-file") policy.logDriver = "json-file";
	if (labels[COMPUTE_RESOURCE_POLICY_LABELS.logMaxSize]) policy.logMaxSize = labels[COMPUTE_RESOURCE_POLICY_LABELS.logMaxSize];
	const logMaxFile = numberLabel(labels[COMPUTE_RESOURCE_POLICY_LABELS.logMaxFile]);
	if (logMaxFile !== undefined) policy.logMaxFile = logMaxFile;
	return Object.keys(policy).length > 0 ? policy : undefined;
}

function portMapFromLabels(labels: Record<string, string>): Record<string, string> {
	const portMap: Record<string, string> = {};
	for (const [key, value] of Object.entries(labels)) {
		if (!key.startsWith("pibo.compute.port.")) continue;
		portMap[key.slice("pibo.compute.port.".length)] = value;
	}
	return portMap;
}

function portMapFromInspectPorts(ports: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | null | undefined): Record<string, string> {
	const portMap: Record<string, string> = {};
	if (!ports) return portMap;
	for (const [containerPort, bindings] of Object.entries(ports)) {
		if (!bindings?.length) continue;
		portMap[containerPort] = bindings.map((binding) => `${binding.HostIp ?? ""}:${binding.HostPort ?? ""}`).join(",");
	}
	return portMap;
}

function cleanupEligibilityForWorker(worker: Pick<WorkerInfo, "role" | "state" | "status" | "oomKilled" | "cleanupState" | "dirtyReason">): ComputeWorkerCleanupEligibility {
	const reasons: string[] = [];
	const normalizedState = worker.state.toLowerCase();
	const stopped = ["exited", "dead", "created"].includes(normalizedState) || /^exited\b/i.test(worker.status);
	if (worker.oomKilled) reasons.push("oom-killed");
	if (worker.cleanupState === "dirty" || worker.dirtyReason) reasons.push("dirty");
	if (stopped) reasons.push("stopped");
	if (normalizedState === "restarting") reasons.push("restarting");
	if (worker.role === "dev" && reasons.length > 0) {
		return {
			eligible: false,
			reasons: ["dev-worker-preserved", ...reasons],
			nextCommands: ["pibo compute reap --include-dev --max-age-minutes <n>"],
		};
	}
	if (reasons.length === 0) {
		return { eligible: false, reasons: ["running-or-retained"], nextCommands: ["pibo compute list --all --json"] };
	}
	return {
		eligible: true,
		reasons,
		nextCommands: ["pibo compute reap --max-age-minutes <n>"],
	};
}

function workerFromLabels(base: { id: string; name: string; state: string; status: string; ports: string; labels: Record<string, string>; fallbackRole?: string; oomKilled?: boolean; exitCode?: number; hostPid?: number }): WorkerInfo {
	const role = base.labels[LABEL_ROLE] ?? base.fallbackRole ?? "unknown";
	const portMap = portMapFromLabels(base.labels);
	const worker: WorkerInfo = {
		id: base.id,
		name: base.name,
		role,
		state: base.state || stateFromStatus(base.status),
		status: base.status ?? "",
		ports: base.ports ?? "",
		portMap,
		hostPid: base.hostPid,
		createdAt: base.labels[LABEL_CREATED_AT] ?? "unknown",
		lastUsedAt: base.labels[LABEL_LAST_USED_AT],
		ownerScope: base.labels[LABEL_OWNER_SCOPE] ?? base.labels[LABEL_OWNER],
		worktree: base.labels[LABEL_WORKTREE],
		worktreePath: base.labels[LABEL_WORKTREE_PATH],
		ralphJobId: base.labels[LABEL_RALPH_JOB_ID],
		ralphRunId: base.labels[LABEL_RALPH_RUN_ID],
		cleanupState: base.labels[LABEL_CLEANUP_STATE],
		dirtyReason: base.labels[LABEL_DIRTY_REASON],
		oomKilled: base.oomKilled,
		exitCode: base.exitCode,
		resourcePolicy: resourcePolicyFromLabels(base.labels),
		cleanupEligibility: { eligible: false, reasons: [], nextCommands: [] },
	};
	worker.cleanupEligibility = cleanupEligibilityForWorker(worker);
	return worker;
}

function stateFromStatus(status: string): string {
	const lower = status.toLowerCase();
	if (lower.startsWith("up")) return "running";
	if (lower.startsWith("exited")) return "exited";
	if (lower.includes("restarting")) return "restarting";
	if (lower.startsWith("created")) return "created";
	if (lower.startsWith("dead")) return "dead";
	return "unknown";
}

export function parseDockerWorkerListLine(line: string, fallbackRole?: string): WorkerInfo | undefined {
	const [containerId, name, stateOrStatus, statusOrPorts, portsOrLabels, labelsMaybe] = line.split("\t");
	if (!containerId || !name) return undefined;
	const hasStateColumn = labelsMaybe !== undefined;
	const state = hasStateColumn ? stateOrStatus : stateFromStatus(stateOrStatus ?? "");
	const status = hasStateColumn ? statusOrPorts : stateOrStatus;
	const ports = hasStateColumn ? portsOrLabels : statusOrPorts;
	const labels = parseDockerLabels(hasStateColumn ? labelsMaybe : portsOrLabels);
	return workerFromLabels({ id: containerId, name, state: state ?? "unknown", status: status ?? "", ports: ports ?? "", labels, fallbackRole });
}

export function parseDockerWorkerInspect(value: DockerInspectContainer, fallback?: WorkerInfo): WorkerInfo | undefined {
	const labels = value.Config?.Labels ?? {};
	const role = labels[LABEL_ROLE] ?? fallback?.role;
	if (!role) return fallback;
	const state = value.State?.Status ?? fallback?.state ?? "unknown";
	const status = statusFromInspectState(value.State, fallback?.status ?? state);
	const portMap = { ...portMapFromInspectPorts(value.NetworkSettings?.Ports), ...portMapFromLabels(labels) };
	const worker = workerFromLabels({
		id: value.Id ?? fallback?.id ?? "unknown",
		name: (value.Name ?? fallback?.name ?? "unknown").replace(/^\//, ""),
		state,
		status,
		ports: fallback?.ports ?? portsTextFromPortMap(portMap),
		labels,
		fallbackRole: role,
		oomKilled: value.State?.OOMKilled,
		exitCode: value.State?.ExitCode,
		hostPid: value.State?.Pid,
	});
	worker.portMap = portMap;
	if (value.Created && worker.createdAt === "unknown") worker.createdAt = value.Created;
	return worker;
}

function statusFromInspectState(state: DockerInspectContainer["State"], fallback: string): string {
	if (!state) return fallback;
	if (state.Status === "running" && state.StartedAt) return `running since ${state.StartedAt}`;
	if (state.Status === "exited") return `exited (${state.ExitCode ?? "unknown"})`;
	if (state.Status) return state.Status;
	return fallback;
}

function portsTextFromPortMap(portMap: Record<string, string>): string {
	const entries = Object.entries(portMap);
	return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(",") : "-";
}

async function enrichWorkersWithInspect(workers: WorkerInfo[]): Promise<WorkerInfo[]> {
	if (workers.length === 0) return workers;
	try {
		const { stdout } = await execFileAsync("docker", ["inspect", ...workers.map((worker) => worker.id)]);
		const inspected = JSON.parse(stdout) as DockerInspectContainer[];
		const fallbackById = new Map(workers.map((worker) => [worker.id, worker]));
		const fallbackByName = new Map(workers.map((worker) => [worker.name, worker]));
		return inspected.map((container) => parseDockerWorkerInspect(container, fallbackById.get(container.Id ?? "") ?? fallbackByName.get((container.Name ?? "").replace(/^\//, "")))).filter((worker): worker is WorkerInfo => Boolean(worker));
	} catch {
		return workers;
	}
}

export async function listWorkers(options: { includeDev?: boolean; all?: boolean } = {}): Promise<WorkerInfo[]> {
	const roles = options.includeDev === false ? ["worker"] : ["worker", "dev"];
	const workers: WorkerInfo[] = [];

	for (const role of roles) {
		const { stdout } = await execFileAsync("docker", [
			"ps",
			...(options.all ? ["--all"] : []),
			"--filter",
			`label=${LABEL_ROLE}=${role}`,
			"--format",
			"{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t{{.Labels}}",
		]);

		if (!stdout.trim()) continue;

		const lines = stdout.trim().split("\n");
		for (const line of lines) {
			const worker = parseDockerWorkerListLine(line, role);
			if (worker) workers.push(worker);
		}
	}

	return enrichWorkersWithInspect(workers);
}

export interface ComputeWorkerReapPlanOptions {
	includeDev?: boolean;
	includeStopped?: boolean;
	includeDirty?: boolean;
	maxAgeMinutes?: number;
	now?: Date;
}

export interface ComputeWorkerReapPlanItem {
	worker: WorkerInfo;
	action: "remove" | "skip";
	reasons: string[];
	skipReasons: string[];
	ageMinutes?: number;
	preservesWorktree: boolean;
}

export interface ComputeWorkerReapPlan {
	createdAt: string;
	options: Required<Omit<ComputeWorkerReapPlanOptions, "now">>;
	items: ComputeWorkerReapPlanItem[];
	summary: {
		selected: number;
		skipped: number;
		worktreesPreserved: number;
	};
	nextCommands: string[];
}

function isStoppedWorker(worker: WorkerInfo): boolean {
	const normalizedState = worker.state.toLowerCase();
	return ["exited", "dead", "created"].includes(normalizedState) || /^exited\b/i.test(worker.status) || normalizedState === "restarting";
}

function isDirtyWorker(worker: WorkerInfo): boolean {
	return worker.cleanupState === "dirty" || Boolean(worker.dirtyReason) || worker.oomKilled === true;
}

export function buildComputeWorkerReapPlan(workers: WorkerInfo[], options: ComputeWorkerReapPlanOptions = {}): ComputeWorkerReapPlan {
	const now = options.now ?? new Date();
	const maxAgeMinutes = options.maxAgeMinutes ?? 60;
	const resolved = {
		includeDev: options.includeDev === true,
		includeStopped: options.includeStopped !== false,
		includeDirty: options.includeDirty !== false,
		maxAgeMinutes,
	};
	const items = workers.map((worker): ComputeWorkerReapPlanItem => {
		const reasons: string[] = [];
		const skipReasons: string[] = [];
		const created = new Date(worker.createdAt).getTime();
		const ageMinutes = Number.isNaN(created) ? undefined : (now.getTime() - created) / 1000 / 60;
		if (worker.role === "dev" && !resolved.includeDev) skipReasons.push("dev-worker-preserved");
		if (worker.role !== "worker" && worker.role !== "dev") skipReasons.push("unsupported-role");
		if (resolved.includeStopped && isStoppedWorker(worker)) reasons.push("stopped");
		if (resolved.includeDirty && isDirtyWorker(worker)) reasons.push(worker.oomKilled ? "oom-killed" : "dirty");
		if (ageMinutes !== undefined && ageMinutes > resolved.maxAgeMinutes) reasons.push("old");
		if (reasons.length === 0) skipReasons.push("not-selected");
		const action = skipReasons.length === 0 ? "remove" : "skip";
		return {
			worker,
			action,
			reasons,
			skipReasons,
			ageMinutes,
			preservesWorktree: Boolean(worker.worktreePath),
		};
	});
	return {
		createdAt: now.toISOString(),
		options: resolved,
		items,
		summary: {
			selected: items.filter((item) => item.action === "remove").length,
			skipped: items.filter((item) => item.action === "skip").length,
			worktreesPreserved: items.filter((item) => item.action === "remove" && item.preservesWorktree).length,
		},
		nextCommands: [
			"pibo compute reap --dry-run --max-age-minutes <n>",
			"pibo compute reap --apply --max-age-minutes <n>",
			"pibo compute list --all --json",
		],
	};
}

export async function releaseWorker(id: string): Promise<void> {
	try {
		await execFileAsync("docker", ["stop", "-t", "10", id]);
	} catch {
		// might already be stopped
	}
	await execFileAsync("docker", ["rm", id]);
}

export async function applyComputeWorkerReapPlan(plan: ComputeWorkerReapPlan, options: { release?: (id: string) => Promise<void> } = {}): Promise<string[]> {
	const release = options.release ?? releaseWorker;
	const removed: string[] = [];
	for (const item of plan.items) {
		if (item.action !== "remove") continue;
		await release(item.worker.name);
		removed.push(item.worker.name);
	}
	return removed;
}

export async function planReapWorkers(options: ComputeWorkerReapPlanOptions = {}): Promise<ComputeWorkerReapPlan> {
	const workers = await listWorkers({ all: true });
	return buildComputeWorkerReapPlan(workers, options);
}

export async function reapWorkers(maxAgeMinutes: number, options: { includeDev?: boolean; includeStopped?: boolean; includeDirty?: boolean } = {}): Promise<string[]> {
	const plan = await planReapWorkers({ ...options, maxAgeMinutes });
	return applyComputeWorkerReapPlan(plan);
}

function normalizeDockerSystemDfKind(type: string | undefined): DockerDiskUsageKind {
	const normalized = (type ?? "").trim().toLowerCase();
	if (normalized === "images") return "images";
	if (normalized === "containers") return "containers";
	if (normalized === "local volumes" || normalized === "volumes") return "localVolumes";
	if (normalized === "build cache" || normalized === "buildkit cache") return "buildCache";
	return "unknown";
}

function parseOptionalNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseDockerSizeBytes(value: string | undefined): number | undefined {
	const match = (value ?? "").trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?/);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return undefined;
	const unit = (match[2] ?? "B").toLowerCase();
	const multipliers: Record<string, number> = {
		b: 1,
		kb: 1000,
		mb: 1000 ** 2,
		gb: 1000 ** 3,
		tb: 1000 ** 4,
		kib: 1024,
		mib: 1024 ** 2,
		gib: 1024 ** 3,
		tib: 1024 ** 4,
	};
	const multiplier = multipliers[unit];
	if (!multiplier) return undefined;
	return Math.round(amount * multiplier);
}

export function parseDockerSystemDfLines(output: string): DockerDiskUsageRow[] {
	const rows: DockerDiskUsageRow[] = [];
	for (const line of output.trim().split("\n")) {
		if (!line.trim()) continue;
		let raw: Record<string, string>;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			raw = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]));
		} catch {
			continue;
		}
		const label = raw.Type ?? raw.type ?? "unknown";
		const size = raw.Size ?? raw.size ?? "";
		const reclaimable = raw.Reclaimable ?? raw.reclaimable ?? "";
		rows.push({
			kind: normalizeDockerSystemDfKind(label),
			label,
			totalCount: parseOptionalNumber(raw.TotalCount ?? raw.totalCount),
			active: parseOptionalNumber(raw.Active ?? raw.active),
			size,
			sizeBytes: parseDockerSizeBytes(size),
			reclaimable,
			reclaimableBytes: parseDockerSizeBytes(reclaimable),
			raw,
		});
	}
	return rows;
}

export function buildComputeDiskDiagnostics(rows: DockerDiskUsageRow[], options: { now?: Date; dockerAvailable?: boolean; dockerError?: string } = {}): ComputeDiskDiagnostics {
	const usage: Record<DockerDiskUsageKind, DockerDiskUsageRow | undefined> = {
		images: undefined,
		containers: undefined,
		localVolumes: undefined,
		buildCache: undefined,
		unknown: undefined,
	};
	for (const row of rows) {
		usage[row.kind] = row;
	}
	const sizeBytes = rows.reduce((sum, row) => row.sizeBytes === undefined ? sum : sum + row.sizeBytes, 0);
	const reclaimableBytes = rows.reduce((sum, row) => row.reclaimableBytes === undefined ? sum : sum + row.reclaimableBytes, 0);
	return {
		generatedAt: (options.now ?? new Date()).toISOString(),
		readOnly: true,
		dockerAvailable: options.dockerAvailable !== false,
		dockerError: options.dockerError,
		usage,
		rows,
		totals: {
			sizeBytes: rows.some((row) => row.sizeBytes !== undefined) ? sizeBytes : undefined,
			reclaimableBytes: rows.some((row) => row.reclaimableBytes !== undefined) ? reclaimableBytes : undefined,
		},
		suggestions: [
			{
				kind: "container-cleanup",
				reason: "Remove stopped, dirty, or old Pibo compute containers without deleting Git worktrees.",
				nextCommands: ["pibo compute reap --dry-run --json", "pibo compute reap --apply --max-age-minutes <n>"],
			},
			{
				kind: "image-cleanup",
				reason: "Review unused Docker images separately from Pibo compute containers.",
				nextCommands: ["docker image ls", "docker image prune"],
			},
			{
				kind: "build-cache-prune",
				reason: "Review BuildKit cache before pruning retained build layers.",
				nextCommands: ["docker builder du", "docker builder prune"],
			},
			{
				kind: "worktree-cleanup",
				reason: "Clean Git worktrees explicitly; compute container cleanup does not remove them.",
				nextCommands: ["git worktree list", "git worktree prune"],
			},
		],
	};
}

export async function getComputeDiskDiagnostics(options: { now?: Date } = {}): Promise<ComputeDiskDiagnostics> {
	try {
		const { stdout } = await execFileAsync("docker", ["system", "df", "--format", "{{json .}}"], { maxBuffer: 10 * 1024 * 1024 });
		return buildComputeDiskDiagnostics(parseDockerSystemDfLines(stdout), { now: options.now, dockerAvailable: true });
	} catch (error: any) {
		return buildComputeDiskDiagnostics([], { now: options.now, dockerAvailable: false, dockerError: String(error?.message ?? error) });
	}
}
