import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export const IMAGE_NAME = "pibo:latest";
export const LABEL_ROLE = "pibo.compute.role";
export const LABEL_CREATED_AT = "pibo.compute.createdAt";
export const LABEL_OWNER = "pibo.compute.owner";

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

export async function spawnDevWorker(options: {
	repoDir: string;
	worktreeName: string;
	owner?: string;
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

	const args = [
		"run",
		"-d",
		"--name",
		id,
		"-p",
		`${gatewayPort}:4789`,
		"-p",
		`${cdpPort}:56663`,
		"-p",
		`${webPort}:4788`,
		"-p",
		`${webUIPortChat}:4790`,
		"-p",
		`${webUIPortContext}:4791`,
		"-v",
		`${worktreePath}:/workspace`,
		"-w",
		"/workspace",
		"--label",
		`${LABEL_ROLE}=dev`,
		"--label",
		`${LABEL_CREATED_AT}=${createdAt}`,
		"--label",
		`pibo.compute.portBlock=${block}`,
		"--label",
		`pibo.compute.worktree=${options.worktreeName}`,
		...(options.owner ? ["--label", `${LABEL_OWNER}=${options.owner}`] : []),
		"--entrypoint",
		"/bin/sh",
		IMAGE_NAME,
		"-c",
		"tail -f /dev/null",
	];

	// Mount host node_modules into the container so dependencies are immediately available
	const hostNodeModules = path.join(options.repoDir, "node_modules");
	try {
		const { stdout } = await execFileAsync("ls", ["-d", hostNodeModules]);
		if (stdout.trim()) {
			args.splice(args.indexOf("-w") + 2, 0, "-v", `${hostNodeModules}:/workspace/node_modules`);
		}
	} catch {
		// host node_modules does not exist; skip mount
	}

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

export async function spawnWorker(options: {
	workspaceDir: string;
	name?: string;
	owner?: string;
}): Promise<SpawnedWorker> {
	const id = options.name || `pibo-worker-${Math.random().toString(36).slice(2, 10)}`;
	const createdAt = new Date().toISOString();

	const args = [
		"run",
		"-d",
		"--name",
		id,
		"-p",
		"4789",
		"-p",
		"56663",
		"-p",
		"4788",
		"--label",
		`${LABEL_ROLE}=worker`,
		"--label",
		`${LABEL_CREATED_AT}=${createdAt}`,
		...(options.owner ? ["--label", `${LABEL_OWNER}=${options.owner}`] : []),
		IMAGE_NAME,
		"gateway:web",
	];

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

export interface WorkerInfo {
	id: string;
	name: string;
	status: string;
	ports: string;
	createdAt: string;
}

export async function listWorkers(): Promise<WorkerInfo[]> {
	const { stdout } = await execFileAsync("docker", [
		"ps",
		"--filter",
		`label=${LABEL_ROLE}=worker`,
		"--format",
		"{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Labels}}",
	]);

	if (!stdout.trim()) return [];

	const lines = stdout.trim().split("\n");
	const workers: WorkerInfo[] = [];

	for (const line of lines) {
		const [containerId, name, status, ports, labelsStr] = line.split("\t");
		const createdMatch = labelsStr?.match(/pibo\.compute\.createdAt=([^,]+)/);
		workers.push({
			id: containerId ?? "",
			name: name ?? "",
			status: status ?? "",
			ports: ports ?? "",
			createdAt: createdMatch ? createdMatch[1] : "unknown",
		});
	}

	return workers;
}

export async function releaseWorker(id: string): Promise<void> {
	try {
		await execFileAsync("docker", ["stop", "-t", "10", id]);
	} catch {
		// might already be stopped
	}
	await execFileAsync("docker", ["rm", id]);
}

export async function reapWorkers(maxAgeMinutes: number): Promise<string[]> {
	const workers = await listWorkers();
	const now = Date.now();
	const removed: string[] = [];

	for (const worker of workers) {
		const created = new Date(worker.createdAt).getTime();
		if (Number.isNaN(created)) continue;
		const ageMinutes = (now - created) / 1000 / 60;

		if (ageMinutes > maxAgeMinutes) {
			await releaseWorker(worker.name);
			removed.push(worker.name);
		}
	}

	return removed;
}
