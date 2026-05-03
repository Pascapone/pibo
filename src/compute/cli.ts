import { Command } from "commander";
import {
	IMAGE_NAME,
	imageExists,
	shouldRebuild,
	shouldRebuildDeps,
	dockerBuild,
	saveHash,
	saveDepHash,
	spawnWorker,
	spawnDevWorker,
	listWorkers,
	releaseWorker,
	reapWorkers,
	getSourceHash,
} from "./docker.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const WORKSPACE_DIR = process.env.PIBO_COMPUTE_WORKSPACE || "/root/code/pibo";
const HASH_FILE = path.join(os.homedir(), ".pibo", "compute-image-hash");
const DEP_HASH_FILE = path.join(os.homedir(), ".pibo", "compute-dep-hash");

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export async function runComputeCli(argv: string[]): Promise<void> {
	const program = new Command();
	program.name("pibo compute").description("Manage Pibo Docker compute workers").helpOption(false);

	program
		.command("spawn")
		.description("Spawn a new Pibo worker container")
		.option("--name <name>", "Custom container name")
		.option("--owner <owner>", "Owner tag for the container")
		.action(async (options: { name?: string; owner?: string }) => {
			await mkdir(path.dirname(HASH_FILE), { recursive: true });

			const needsBuild = !(await imageExists(IMAGE_NAME)) || (await shouldRebuild(WORKSPACE_DIR, HASH_FILE));
			if (needsBuild) {
				console.error(`Building ${IMAGE_NAME} from ${WORKSPACE_DIR}...`);
				await dockerBuild(WORKSPACE_DIR);
				await saveHash(WORKSPACE_DIR, HASH_FILE);
				console.error("Build complete.");
			}

			const worker = await spawnWorker({
				workspaceDir: WORKSPACE_DIR,
				name: options.name,
				owner: options.owner,
			});

			printJson(worker);
		});

	const devCmd = program.command("dev").description("Development environment commands");

	devCmd
		.command("spawn")
		.description("Spawn a development container with a Git worktree")
		.requiredOption("--worktree <name>", "Git worktree / branch name")
		.option("--repo <path>", "Repository directory", WORKSPACE_DIR)
		.option("--owner <owner>", "Owner tag for the container")
		.action(async (options: { worktree: string; repo: string; owner?: string }) => {
			await mkdir(path.dirname(DEP_HASH_FILE), { recursive: true });

			console.error("[pibo compute] Checking Docker image status...");
			const needsBuild = !(await imageExists(IMAGE_NAME)) || (await shouldRebuildDeps(options.repo, DEP_HASH_FILE));
			if (needsBuild) {
				console.error(`[pibo compute] Dependencies changed (package.json, package-lock.json, or Dockerfile).`);
				console.error(`[pibo compute] Rebuilding Docker image ${IMAGE_NAME} — this takes 1-2 minutes...`);
				await dockerBuild(options.repo);
				await saveDepHash(options.repo, DEP_HASH_FILE);
				console.error("[pibo compute] Docker image build complete.");
			} else {
				console.error("[pibo compute] Using cached Docker image (dependencies unchanged).");
			}

			console.error(`[pibo compute] Creating git worktree '${options.worktree}'...`);
			const worker = await spawnDevWorker({
				repoDir: options.repo,
				worktreeName: options.worktree,
				owner: options.owner,
			});
			console.error(`[pibo compute] Dev container '${worker.id}' started.`);
			console.error(`[pibo compute] Ports: gateway=${worker.gatewayPort}, cdp=${worker.cdpPort}, web=${worker.webPort}, chat-ui=${worker.webUIPortChat}, context-files=${worker.webUIPortContext}`);
			console.error(`[pibo compute] Worktree: ${worker.worktree}`);
			console.error(`[pibo compute] Connect: ${worker.connect}`);

			printJson(worker);
		});

	program
		.command("rebuild")
		.description("Force rebuild the pibo:latest image")
		.action(async () => {
			console.error(`Rebuilding ${IMAGE_NAME} from ${WORKSPACE_DIR}...`);
			await dockerBuild(WORKSPACE_DIR);
			await saveHash(WORKSPACE_DIR, HASH_FILE);
			await saveDepHash(WORKSPACE_DIR, DEP_HASH_FILE);
			console.error("Build complete.");
		});

	program
		.command("list")
		.description("List running Pibo worker containers")
		.action(async () => {
			const workers = await listWorkers();
			if (workers.length === 0) {
				console.log("No worker containers running.");
				return;
			}
			console.log("NAME\t\tSTATUS\t\tPORTS\t\tCREATED");
			for (const w of workers) {
				console.log(`${w.name}\t${w.status}\t${w.ports}\t${w.createdAt}`);
			}
		});

	program
		.command("release")
		.description("Stop and remove a worker container")
		.argument("<id>", "Container name or ID")
		.action(async (id: string) => {
			await releaseWorker(id);
			console.log(`Released ${id}`);
		});

	program
		.command("reap")
		.description("Remove worker containers older than N minutes")
		.option("--max-age-minutes <n>", "Maximum age in minutes", "60")
		.action(async (options: { maxAgeMinutes: string }) => {
			const maxAge = Number(options.maxAgeMinutes);
			const removed = await reapWorkers(maxAge);
			if (removed.length === 0) {
				console.log("No old workers to reap.");
			} else {
				console.log(`Reaped ${removed.length} worker(s): ${removed.join(", ")}`);
			}
		});

	await program.parseAsync(argv);
}
