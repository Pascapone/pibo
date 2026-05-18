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
	planReapWorkers,
	applyComputeWorkerReapPlan,
	getSourceHash,
	getComputeDiskDiagnostics,
	type ComputeDiskDiagnostics,
	type ComputeWorkerReapPlan,
	type WorkerInfo,
} from "./docker.js";
import { getComputeResourceHealth, type ComputeResourceHealth, type ResourceHealthSeverity } from "./resource-health.js";
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

function hostPort(value: string | undefined): string | undefined {
	if (!value || value === "-") return undefined;
	const first = value.split(",")[0] ?? value;
	return first.includes(":") ? first.split(":").pop() : first;
}

function formatPorts(worker: WorkerInfo, verbose = false): string {
	if (verbose) return worker.ports || "-";
	const preferred: Array<[string, string | undefined]> = [
		["gw", worker.portMap["4789/tcp"] ?? worker.portMap.gateway],
		["cdp", worker.portMap["56663/tcp"] ?? worker.portMap.cdp],
		["web", worker.portMap["4788/tcp"] ?? worker.portMap.web],
		["chat", worker.portMap["4790/tcp"] ?? worker.portMap.chatUi],
		["ctx", worker.portMap["4791/tcp"] ?? worker.portMap.contextFiles],
	];
	const compact = preferred
		.map(([label, value]) => {
			const port = hostPort(value);
			return port ? `${label}=${port}` : undefined;
		})
		.filter(Boolean) as string[];
	if (compact.length > 0) return compact.join(",");
	const fallback = Object.entries(worker.portMap)
		.slice(0, 4)
		.map(([container, value]) => `${container.replace(/\/tcp$/, "")}=${hostPort(value) ?? value}`);
	return fallback.length > 0 ? fallback.join(",") : worker.ports || "-";
}

function formatResourcePolicy(worker: WorkerInfo): string {
	const policy = worker.resourcePolicy;
	if (!policy) return "-";
	const parts = [
		policy.memory ? `mem=${policy.memory}` : undefined,
		policy.pidsLimit !== undefined ? `pids=${policy.pidsLimit}` : undefined,
		policy.shmSize ? `shm=${policy.shmSize}` : undefined,
	].filter(Boolean);
	return parts.length ? parts.join(",") : "-";
}

function formatCleanup(worker: WorkerInfo): string {
	const prefix = worker.cleanupEligibility.eligible ? "eligible" : "skip";
	return `${prefix}:${worker.cleanupEligibility.reasons.join("+") || "none"}`;
}

function formatComputeReapCommand(plan: ComputeWorkerReapPlan, apply: boolean): string {
	const args = ["pibo", "compute", "reap", apply ? "--apply" : "--dry-run", "--max-age-minutes", String(plan.options.maxAgeMinutes)];
	if (plan.options.includeDev) args.push("--include-dev");
	if (!plan.options.includeStopped) args.push("--no-stopped");
	if (!plan.options.includeDirty) args.push("--no-dirty");
	return args.join(" ");
}

export function renderComputeWorkerListText(workers: WorkerInfo[], options: { all?: boolean; verbose?: boolean } = {}): string {
	if (workers.length === 0) {
		return [
			options.all ? "No Pibo worker containers found." : "No worker containers running.",
			"Next: pibo compute list --all --json",
			"Next: pibo compute reap --help",
		].join("\n");
	}
	const lines = ["NAME\tROLE\tSTATE\tSTATUS\tOOM\tPORTS\tCREATED\tLAST_USED\tOWNER\tWORKTREE\tRALPH_JOB\tRALPH_RUN\tRESOURCE\tCLEANUP"];
	for (const w of workers) {
		lines.push(`${w.name}\t${w.role}\t${w.state}\t${w.status}\t${w.oomKilled ? "yes" : "no"}\t${formatPorts(w, options.verbose === true)}\t${w.createdAt}\t${w.lastUsedAt ?? "-"}\t${w.ownerScope ?? "-"}\t${w.worktree ?? "-"}\t${w.ralphJobId ?? "-"}\t${w.ralphRunId ?? "-"}\t${formatResourcePolicy(w)}\t${formatCleanup(w)}`);
	}
	lines.push(options.verbose ? "Next: pibo compute list --all --json" : "Next: pibo compute list --all --verbose for full Docker port bindings");
	lines.push("Next: pibo compute list --all --json");
	return lines.join("\n");
}

export function renderComputeReapPlanText(plan: ComputeWorkerReapPlan, options: { applied?: boolean; removed?: string[] } = {}): string {
	const mode = options.applied ? "apply" : "dry-run";
	const lines = [`Compute reap ${mode}: ${plan.summary.selected} selected, ${plan.summary.skipped} skipped, ${plan.summary.worktreesPreserved} worktree(s) preserved`];
	if (plan.items.length === 0) {
		lines.push("No Pibo worker containers found.");
	} else {
		lines.push("ACTION\tNAME\tROLE\tSTATE\tAGE_MIN\tREASONS\tSKIP_REASONS\tWORKTREE");
		for (const item of plan.items) {
			lines.push(`${item.action}\t${item.worker.name}\t${item.worker.role}\t${item.worker.state}\t${item.ageMinutes === undefined ? "-" : Math.floor(item.ageMinutes)}\t${item.reasons.join("+") || "-"}\t${item.skipReasons.join("+") || "-"}\t${item.preservesWorktree ? "preserve" : "-"}`);
		}
	}
	if (plan.options.includeDev && plan.summary.selected > 0) lines.push("WARNING: --include-dev selected dev workers. Review ports/worktrees and active Ralph jobs before applying.");
	if (options.applied) lines.push(`Removed: ${options.removed?.join(", ") || "none"}`);
	else lines.push(`Dry-run only. Apply equivalent plan with: ${formatComputeReapCommand(plan, true)}`);
	lines.push(`Review equivalent dry-run with: ${formatComputeReapCommand(plan, false)}`);
	lines.push("Worktrees are preserved; remove Git worktrees only with an explicit worktree cleanup command.");
	lines.push(...plan.nextCommands.map((command) => `Next: ${command}`));
	return lines.join("\n");
}

function formatMaybeBytes(bytes: number | undefined): string {
	return bytes === undefined ? "-" : String(bytes);
}

function severityRank(severity: ResourceHealthSeverity): number {
	if (severity === "critical") return 2;
	if (severity === "warning") return 1;
	return 0;
}

export function renderComputeResourceHealthText(health: ComputeResourceHealth): string {
	const lines = [`Compute resource health: ${health.severity} (read-only)`];
	lines.push(`Generated at: ${health.generatedAt}`);
	lines.push(`Browser processes: ${health.browserProcesses.totalChromiumMainProcesses} main / ${health.browserProcesses.totalChromiumProcesses} total Chromium processes`);
	if (health.browserProcesses.unassignedMainProcessDetails.length > 0) {
		lines.push(`Unmanaged browser main processes: ${health.browserProcesses.unassignedMainProcessDetails.length}`);
		lines.push("PID\tWORKER\tUSER_DATA_DIR\tCOMMAND");
		for (const process of health.browserProcesses.unassignedMainProcessDetails.slice(0, 5)) {
			lines.push(`${process.pid}\t${process.workerName ?? "-"}\t${process.userDataDir ?? "-"}\t${process.commandName}`);
		}
		lines.push("Inspect unmanaged browsers with: pibo compute health --json");
	}
	lines.push(`Active browser leases: ${health.browserLeases.active}`);
	lines.push(`Stale CDP files: ${health.browserLeases.staleCdpFiles.pidFiles} pid, ${health.browserLeases.staleCdpFiles.portFiles} port`);
	lines.push(`Compute workers: ${health.computeWorkers.total} total, ${health.computeWorkers.dirty} dirty, ${health.computeWorkers.oomKilled} OOM-killed, ${health.computeWorkers.cleanupEligible} cleanup-eligible`);
	lines.push(`Docker disk: reclaimable=${formatMaybeBytes(health.dockerDisk.reclaimableBytes)} buildCache=${formatMaybeBytes(health.dockerDisk.buildCacheBytes)} pressure=${health.dockerDisk.pressure ? "yes" : "no"}`);
	lines.push(`Reaper/timer: ${health.reaperTimers.status}${health.reaperTimers.details ? ` - ${health.reaperTimers.details}` : ""}`);
	if (health.browserProcesses.perWorker.length > 0) {
		lines.push("Browser pools:");
		lines.push("WORKER	POOL	STATE	PID	ACTIVE_LEASES	MAIN_PROCESSES	SEVERITY");
		for (const pool of health.browserProcesses.perWorker) {
			lines.push(`${pool.workerId}\t${pool.poolId}\t${pool.state}\t${pool.pid ?? "-"}\t${pool.activeLeaseCount}\t${pool.browserMainProcessCount}\t${pool.severity}`);
		}
	}
	lines.push("Checks:");
	for (const check of [...health.checks].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
		lines.push(`- [${check.severity}] ${check.id}: ${check.message}`);
		for (const command of check.nextCommands) lines.push(`  Next: ${command}`);
	}
	lines.push("Next commands:");
	for (const command of health.nextCommands.slice(0, 8)) lines.push(`- ${command}`);
	return lines.join("\n");
}

export function renderComputeDiskDiagnosticsText(diagnostics: ComputeDiskDiagnostics): string {
	const lines = ["Compute disk diagnostics (read-only)"];
	if (!diagnostics.dockerAvailable) {
		lines.push(`Docker unavailable: ${diagnostics.dockerError ?? "unknown error"}`);
		lines.push("Next: ensure Docker is installed and the daemon is reachable, then run pibo compute diagnostics --json");
		return lines.join("\n");
	}
	if (diagnostics.rows.length === 0) {
		lines.push("Docker reported no disk usage rows.");
	} else {
		lines.push("TYPE\tCOUNT\tACTIVE\tSIZE\tSIZE_BYTES\tRECLAIMABLE\tRECLAIMABLE_BYTES");
		for (const row of diagnostics.rows) {
			lines.push(`${row.label}\t${row.totalCount ?? "-"}\t${row.active ?? "-"}\t${row.size || "-"}\t${formatMaybeBytes(row.sizeBytes)}\t${row.reclaimable || "-"}\t${formatMaybeBytes(row.reclaimableBytes)}`);
		}
	}
	lines.push(`Total bytes: ${formatMaybeBytes(diagnostics.totals.sizeBytes)}`);
	lines.push(`Reclaimable bytes: ${formatMaybeBytes(diagnostics.totals.reclaimableBytes)}`);
	lines.push("Cleanup suggestions:");
	for (const suggestion of diagnostics.suggestions) {
		lines.push(`- ${suggestion.kind}: ${suggestion.reason}`);
		for (const command of suggestion.nextCommands) lines.push(`  Next: ${command}`);
	}
	return lines.join("\n");
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
		.option("--verbose", "Show full Docker port bindings in text output")
		.addHelpText(
			"after",
			`
Shows each worker's name, role, status, mapped ports, creation time, owner, and Ralph ownership when labeled.

Next:
  $ pibo compute list --all --json
`,
		)
		.action(async (options: { all?: boolean; json?: boolean; verbose?: boolean }) => {
			const workers = await listWorkers({ all: options.all === true });
			if (options.json) {
				printJson({ workers });
				return;
			}
			console.log(renderComputeWorkerListText(workers, { all: options.all === true, verbose: options.verbose === true }));
		});

	program
		.command("health")
		.alias("doctor")
		.description("Show read-only compute, browser, Docker, and reaper resource health")
		.option("--json", "Print machine-readable resource health")
		.option("--browser-pool-root <path>", "Browser pool root directory to scan")
		.option("--browser-use-home <path>", "Browser-use home directory to scan for stale CDP files")
		.addHelpText(
			"after",
			`
Reports browser main-process counts, active browser-pool leases, stale CDP files, dirty/OOM workers, Docker disk pressure, and reaper/timer status.
The command is read-only and never reaps, prunes, stops, or removes resources.

Next:
  $ pibo compute health --json
  $ pibo tools browser-use pool reap --json
  $ pibo compute reap --dry-run --json
`,
		)
		.action(async (options: { json?: boolean; browserPoolRoot?: string; browserUseHome?: string }) => {
			const health = await getComputeResourceHealth({ browserPoolRoot: options.browserPoolRoot, browserUseHome: options.browserUseHome });
			if (options.json) {
				printJson(health);
				return;
			}
			console.log(renderComputeResourceHealthText(health));
		});

	program
		.command("diagnostics")
		.alias("disk")
		.description("Show read-only Docker disk and build-cache diagnostics")
		.option("--json", "Print machine-readable disk diagnostics")
		.addHelpText(
			"after",
			`
Reports Docker image, container, local volume, and build-cache usage without pruning anything.
Cleanup suggestions distinguish compute containers, images, build cache, and Git worktrees.

Next:
  $ pibo compute diagnostics --json
  $ pibo compute reap --dry-run --json
`,
		)
		.action(async (options: { json?: boolean }) => {
			const diagnostics = await getComputeDiskDiagnostics();
			if (options.json) {
				printJson(diagnostics);
				return;
			}
			console.log(renderComputeDiskDiagnosticsText(diagnostics));
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
		.description("Preview or apply compute worker container cleanup")
		.option("--max-age-minutes <n>", "Select workers older than this many minutes", "60")
		.option("--include-dev", "Also select dev-worker containers; dev workers are skipped by default")
		.option("--no-stopped", "Do not select stopped, dead, created, or restarting containers")
		.option("--no-dirty", "Do not select dirty or OOM-killed containers")
		.option("--dry-run", "Preview the cleanup plan without removing containers")
		.option("--apply", "Apply the cleanup plan and remove selected containers")
		.option("--json", "Print machine-readable cleanup plan/result")
		.addHelpText(
			"after",
			`
Defaults to a dry-run plan for one-time workers. Dev workers require --include-dev.
Stopped, dirty/OOM, and old workers are selected unless disabled by selector flags.
Worktrees are preserved; container cleanup never deletes Git worktrees.
`,
		)
		.action(async (options: { maxAgeMinutes: string; includeDev?: boolean; stopped?: boolean; dirty?: boolean; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
			const maxAge = Number(options.maxAgeMinutes);
			const plan = await planReapWorkers({
				includeDev: options.includeDev === true,
				includeStopped: options.stopped !== false,
				includeDirty: options.dirty !== false,
				maxAgeMinutes: Number.isFinite(maxAge) ? maxAge : 60,
			});
			const shouldApply = options.apply === true;
			const removed = shouldApply ? await applyComputeWorkerReapPlan(plan) : [];
			if (options.json) {
				printJson({ dryRun: !shouldApply, applied: shouldApply, removed, plan });
				return;
			}
			console.log(renderComputeReapPlanText(plan, { applied: shouldApply, removed }));
		});

	await program.parseAsync(argv);
}
