import { Command } from "commander";
import { getComputeResourceHealth, type ComputeResourceHealth } from "../compute/resource-health.js";
import { renderComputeResourceHealthText } from "../compute/cli.js";
import {
	applyResourceReapPlan,
	getActiveResourceLeases,
	planResourceReap,
	type ResourceLease,
	type ResourceReapApplyResult,
	type ResourceReapPlan,
} from "./lifecycle.js";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parseNonNegativeNumber(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Value must be a non-negative number");
	return parsed;
}

export function renderResourceLeasesText(leases: ResourceLease[]): string {
	if (leases.length === 0) return "No active managed browser-pool leases.\nNext: pibo resources status";
	const lines = ["LEASE_ID\tHOLDER\tWORKER/POOL\tEXPIRY\tSTATE"];
	for (const lease of leases) {
		lines.push(`${lease.leaseId}\t${lease.holder ?? "-"}\t${lease.workerId}/${lease.poolId}\t${lease.expiresAt ?? "-"}\t${lease.state}`);
	}
	lines.push("Next: pibo resources status");
	return lines.join("\n");
}

export function renderResourceReapText(value: ResourceReapPlan | ResourceReapApplyResult): string {
	const applied = "applied" in value;
	const plan = applied ? value.plan : value;
	const lines = [
		`Resource reap ${applied ? "apply" : "dry-run"}: ${plan.browserPools.selected} browser pool(s), ${plan.staleFiles.selected} stale pid/port file(s), ${plan.compute.summary.selected} compute worker(s) selected`,
		"BROWSER_ACTION\tWORKER/POOL\tREASON",
	];
	for (const item of plan.browserPools.items) lines.push(`${item.action}\t${item.workerId}/${item.poolId}\t${item.reason}`);
	if (applied) {
		lines.push(`Reaped browser pools: ${value.browserResults.filter((result) => result.reaped).length}`);
		lines.push(`Removed stale pid/port files: ${value.removedStaleFiles.length}`);
		lines.push(`Removed compute workers: ${value.removedComputeWorkers.join(", ") || "none"}`);
	} else {
		const args = [
			"pibo resources reap --apply",
			`--max-age-minutes ${plan.options.maxAgeMinutes}`,
			`--idle-timeout-minutes ${plan.options.idleTimeoutMinutes}`,
		];
		if (plan.options.includeDev) args.push("--include-dev");
		if (plan.options.browserPoolRoot) args.push(`--browser-pool-root ${plan.options.browserPoolRoot}`);
		if (plan.options.browserUseHome) args.push(`--browser-use-home ${plan.options.browserUseHome}`);
		lines.push(`Dry-run only. Apply after review with: ${args.join(" ")}`);
	}
	lines.push("Worktrees are always preserved.");
	return lines.join("\n");
}

export function serializeResourceStatus(health: ComputeResourceHealth): ComputeResourceHealth {
	return {
		...health,
		nextCommands: [...new Set([
			"pibo resources status --json",
			"pibo resources leases --json",
			"pibo resources reap --dry-run --json",
			...health.nextCommands,
		])],
	};
}

export async function runResourcesCli(argv: string[]): Promise<void> {
	const program = new Command();
	program
		.name("pibo resources")
		.description("Inspect and safely reap managed compute and browser resources")
		.helpOption("-h, --help", "Show help")
		.showHelpAfterError()
		.helpCommand("help [command]", "Show help for command")
		.addHelpText("after", "\nNext:\n  pibo resources status\n  pibo resources leases\n  pibo resources reap --help\n");

	program
		.command("status")
		.alias("doctor")
		.description("Show read-only aggregate compute and browser health")
		.option("--browser-pool-root <path>", "Browser pool root directory to scan")
		.option("--browser-use-home <path>", "Browser-use home directory to scan for stale CDP files")
		.option("--json", "Print machine-readable resource health")
		.action(async (options: { browserPoolRoot?: string; browserUseHome?: string; json?: boolean }) => {
			const health = serializeResourceStatus(await getComputeResourceHealth(options));
			if (options.json) printJson(health);
			else console.log(renderComputeResourceHealthText(health).replace(/^Compute resource health:/, "Resource status:"));
		});

	program
		.command("leases")
		.description("List active managed browser-pool leases")
		.option("--browser-pool-root <path>", "Browser pool root directory to scan")
		.option("--json", "Print machine-readable leases")
		.action(async (options: { browserPoolRoot?: string; json?: boolean }) => {
			const leases = await getActiveResourceLeases(options.browserPoolRoot);
			if (options.json) printJson({ leases });
			else console.log(renderResourceLeasesText(leases));
		});

	program
		.command("reap")
		.description("Preview or apply aggregate browser and compute cleanup")
		.option("--dry-run", "Preview cleanup without changing resources (default)")
		.option("--apply", "Apply cleanup after rechecking current resource safety")
		.option("--include-dev", "Also select eligible dev compute workers")
		.option("--max-age-minutes <n>", "Select compute workers older than this many minutes", parseNonNegativeNumber, 60)
		.option("--idle-timeout-minutes <n>", "Select browser pools idle for this many minutes", parseNonNegativeNumber, 10)
		.option("--browser-pool-root <path>", "Browser pool root directory to scan")
		.option("--browser-use-home <path>", "Browser-use home directory to scan for stale CDP files")
		.option("--json", "Print machine-readable cleanup plan or result")
		.action(async (options: {
			dryRun?: boolean;
			apply?: boolean;
			includeDev?: boolean;
			maxAgeMinutes: number;
			idleTimeoutMinutes: number;
			browserPoolRoot?: string;
			browserUseHome?: string;
			json?: boolean;
		}) => {
			if (options.apply && options.dryRun) throw new Error("Use either --apply or --dry-run, not both");
			const plan = await planResourceReap(options);
			const result = options.apply ? await applyResourceReapPlan(plan) : plan;
			if (options.json) printJson(options.apply ? result : { applied: false, dryRun: true, plan: result });
			else console.log(renderResourceReapText(result));
		});

	await program.parseAsync(argv);
}
