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

const WORKSPACE_DIR = process.env.PIBO_COMPUTE_WORKSPACE || process.cwd();
const HASH_FILE = path.join(os.homedir(), ".pibo", "compute-image-hash");
const DEP_HASH_FILE = path.join(os.homedir(), ".pibo", "compute-dep-hash");

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parsePositiveIntegerOption(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function runComputeCli(argv: string[]): Promise<void> {
	const program = new Command();
	program
		.name("pibo compute")
		.description("Manage isolated Docker workers for Pibo development and testing")
		.helpOption("-h, --help", "Show help")
		.showHelpAfterError()
		.helpCommand("help [command]", "Show help for command")
		.addHelpText(
			"after",
			`
Examples:
  $ pibo compute spawn
  $ pibo compute dev spawn --worktree my-fix
  $ pibo compute list
  $ pibo compute release pibo-worker-abc123

Next:
  $ pibo compute spawn --help
  $ pibo compute dev --help
`,
		);

	program
		.command("spawn")
		.description("Create a one-time worker from the current Docker image")
		.option("--name <name>", "Set the container name")
		.option("--owner <owner>", "Tag the container owner scope")
		.option("--ttl-seconds <n>", "Tag the worker TTL in seconds")
		.option("--idle-seconds <n>", "Tag the worker idle retention in seconds")
		.option("--ralph-job-id <id>", "Tag the Ralph job id when this worker is Ralph-owned")
		.option("--ralph-run-id <id>", "Tag the Ralph run id when this worker is Ralph-owned")
		.addHelpText(
			"after",
			`
Creates a worker container and starts the gateway. Prints JSON with the container id and mapped ports.

Use this for quick isolated checks. For code changes, prefer:
  $ pibo compute dev spawn --worktree my-fix
`,
		)
		.action(async (options: { name?: string; owner?: string; ttlSeconds?: string; idleSeconds?: string; ralphJobId?: string; ralphRunId?: string }) => {
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
				ttlSeconds: parsePositiveIntegerOption(options.ttlSeconds),
				idleSeconds: parsePositiveIntegerOption(options.idleSeconds),
				ralphJobId: options.ralphJobId,
				ralphRunId: options.ralphRunId,
			});

			printJson(worker);
		});

	const devCmd = program
		.command("dev")
		.description("Manage development workers with Git worktrees")
		.helpCommand("help [command]", "Show help for command")
		.addHelpText(
			"after",
			`
Use dev workers for Pibo code changes. Each worker gets its own Git worktree and port block.

Next:
  $ pibo compute dev spawn --help
`,
		);

	devCmd
		.command("spawn")
		.description("Create a development worker with a Git worktree")
		.requiredOption("--worktree <name>", "Name the Git worktree and branch")
		.option("--repo <path>", "Use this repository", WORKSPACE_DIR)
		.option("--owner <owner>", "Tag the container owner scope")
		.option("--ttl-seconds <n>", "Tag the worker TTL in seconds")
		.option("--idle-seconds <n>", "Tag the worker idle retention in seconds")
		.option("--ralph-job-id <id>", "Tag the Ralph job id when this worker is Ralph-owned")
		.option("--ralph-run-id <id>", "Tag the Ralph run id when this worker is Ralph-owned")
		.addHelpText(
			"after",
			`
Creates .worktrees/<name>, starts a worker, and prints JSON with ports and the worktree path.

Example:
  $ pibo compute dev spawn --worktree my-fix
`,
		)
		.action(async (options: { worktree: string; repo: string; owner?: string; ttlSeconds?: string; idleSeconds?: string; ralphJobId?: string; ralphRunId?: string }) => {
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
				ttlSeconds: parsePositiveIntegerOption(options.ttlSeconds),
				idleSeconds: parsePositiveIntegerOption(options.idleSeconds),
				ralphJobId: options.ralphJobId,
				ralphRunId: options.ralphRunId,
			});
			console.error(`[pibo compute] Dev container '${worker.id}' started.`);
			console.error(`[pibo compute] Ports: gateway=${worker.gatewayPort}, cdp=${worker.cdpPort}, web=${worker.webPort}, chat-ui=${worker.webUIPortChat}, context-files=${worker.webUIPortContext}`);
			console.error(`[pibo compute] Worktree: ${worker.worktree}`);
			console.error(`[pibo compute] Connect: ${worker.connect}`);

			printJson(worker);
		});

	program
		.command("rebuild")
		.description("Rebuild the pibo:latest Docker image")
		.addHelpText(
			"after",
			`
Rebuilds from the current workspace and refreshes compute image hashes.
`,
		)
		.action(async () => {
			console.error(`Rebuilding ${IMAGE_NAME} from ${WORKSPACE_DIR}...`);
			await dockerBuild(WORKSPACE_DIR);
			await saveHash(WORKSPACE_DIR, HASH_FILE);
			await saveDepHash(WORKSPACE_DIR, DEP_HASH_FILE);
			console.error("Build complete.");
		});

	program
		.command("list")
		.description("List Pibo worker and dev-worker containers")
		.option("--all", "Include stopped, exited, dead, and restarting Pibo workers")
		.option("--json", "Print machine-readable worker metadata")
		.addHelpText(
			"after",
			`
Shows each worker's name, role, status, mapped ports, creation time, owner, and Ralph ownership when labeled.

Next:
  $ pibo compute list --all --json
`,
		)
		.action(async (options: { all?: boolean; json?: boolean }) => {
			const workers = await listWorkers({ all: options.all === true });
			if (options.json) {
				printJson({ workers });
				return;
			}
			if (workers.length === 0) {
				console.log(options.all ? "No Pibo worker containers found." : "No worker containers running.");
				return;
			}
			console.log("NAME\tROLE\tSTATUS\tPORTS\tCREATED\tOWNER\tRALPH_JOB\tRALPH_RUN");
			for (const w of workers) {
				console.log(`${w.name}\t${w.role}\t${w.status}\t${w.ports}\t${w.createdAt}\t${w.ownerScope ?? "-"}\t${w.ralphJobId ?? "-"}\t${w.ralphRunId ?? "-"}`);
			}
		});

	program
		.command("release")
		.description("Stop and remove a worker container")
		.argument("<id>", "Container name or ID")
		.addHelpText(
			"after",
			`
Use the name or id shown by:
  $ pibo compute list
`,
		)
		.action(async (id: string) => {
			await releaseWorker(id);
			console.log(`Released ${id}`);
		});

	program
		.command("reap")
		.description("Remove old worker containers")
		.option("--max-age-minutes <n>", "Remove workers older than this many minutes", "60")
		.option("--include-dev", "Also remove old dev-worker containers")
		.addHelpText(
			"after",
			`
Defaults to 60 minutes and one-time workers only. Use --include-dev to reap dev workers too.
`,
		)
		.action(async (options: { maxAgeMinutes: string; includeDev?: boolean }) => {
			const maxAge = Number(options.maxAgeMinutes);
			const removed = await reapWorkers(maxAge, { includeDev: options.includeDev === true });
			if (removed.length === 0) {
				console.log("No old workers to reap.");
			} else {
				console.log(`Reaped ${removed.length} worker(s): ${removed.join(", ")}`);
			}
		});

	await program.parseAsync(argv);
}
