import { Command } from "commander";
import { ensureDeploymentArtifact } from "./artifacts.js";
import { resolveDeploymentPoolConfig } from "./config.js";
import {
	acquireDeployment,
	applyDeploymentPoolReapPlan,
	getDeploymentPoolDoctor,
	getDeploymentPoolStatus,
	listDeploymentArtifacts,
	planDeploymentPoolReap,
	releaseDeploymentLease,
	renewDeploymentLease,
} from "./service.js";
import type { DeploymentSeedMode } from "./types.js";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parsePositiveInteger(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Value must be a positive integer");
	return parsed;
}

function parseSeedMode(value: string): DeploymentSeedMode {
	if (value === "full" || value === "medium" || value === "fresh") return value;
	throw new Error("Seed mode must be full, medium, or fresh");
}

function printDiscovery(): void {
	console.log(`pibo compute pool - lease isolated Pibo deployment slots

Commands:
  status                 Show slots and active leases
  acquire                Install an exact runtime into a free slot
  renew <lease-id>       Extend an active lease
  release <lease-id>     Stop and free a lease
  reap                    Preview or apply expired-lease cleanup
  doctor                  Check pool, Docker, seed, and container state
  artifacts               List installed checksum-addressed runtimes
  seed                    Explain available seed modes

Next:
  pibo compute pool acquire --help
`);
}

export async function runComputePoolCli(argv: string[]): Promise<void> {
	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		printDiscovery();
		return;
	}
	const program = new Command();
	program.name("pibo compute pool").description("Lease isolated Pibo deployment slots").showHelpAfterError();

	program.command("status")
		.option("--json", "Print machine-readable status")
		.action((options: { json?: boolean }) => {
			const status = getDeploymentPoolStatus();
			if (options.json) printJson(status);
			else {
				console.log(`Deployment pool: ${status.active}/${status.maxActive} active, ${status.free} free`);
				for (const slot of status.slots) console.log(`${slot.id}\t${slot.state}\t${slot.publicUrl ?? "-"}\t${slot.lease?.holder ?? "-"}\t${slot.lease?.expiresAt ?? "-"}`);
			}
		});

	program.command("acquire")
		.requiredOption("--holder <holder>", "Pibo Session ID or other stable holder")
		.option("--artifact <path>", "Server-local npm package archive")
		.option("--runtime <path>", "Server-local installed Pibo runtime directory")
		.option("--seed <mode>", "Seed mode: full, medium, or fresh", parseSeedMode, "medium")
		.option("--ttl-minutes <minutes>", "Lease lifetime", parsePositiveInteger)
		.option("--commit <sha>", "Source commit metadata")
		.option("--json", "Print machine-readable lease")
		.addHelpText("after", `
Provide exactly one source:
  pibo compute pool acquire --holder ps_... --artifact /path/pibo.tgz --seed medium
  pibo compute pool acquire --holder ps_... --runtime /opt/pibo-candidates/name/commit/runtime --seed fresh
`)
		.action(async (options: { holder: string; artifact?: string; runtime?: string; seed: DeploymentSeedMode; ttlMinutes?: number; commit?: string; json?: boolean }) => {
			const config = resolveDeploymentPoolConfig();
			const artifact = await ensureDeploymentArtifact({ config, archivePath: options.artifact, runtimePath: options.runtime });
			const lease = await acquireDeployment({ holder: options.holder, seedMode: options.seed, artifact, ttlMinutes: options.ttlMinutes, commit: options.commit, config });
			if (options.json) printJson(lease);
			else {
				console.log(`${lease.id}\t${lease.status}\t${lease.slotId}\t${lease.publicUrl ?? "-"}`);
				console.log(`expires\t${lease.expiresAt}`);
				console.log(`renew\tpibo compute pool renew ${lease.id} --holder ${lease.holder}`);
				console.log(`release\tpibo compute pool release ${lease.id} --holder ${lease.holder}`);
			}
		});

	program.command("renew")
		.argument("<lease-id>")
		.requiredOption("--holder <holder>")
		.option("--ttl-minutes <minutes>", "New lifetime from now", parsePositiveInteger)
		.option("--json")
		.action((leaseId: string, options: { holder: string; ttlMinutes?: number; json?: boolean }) => {
			const lease = renewDeploymentLease({ leaseId, holder: options.holder, ttlMinutes: options.ttlMinutes });
			if (options.json) printJson(lease);
			else console.log(`${lease.id}\tready\texpires=${lease.expiresAt}`);
		});

	program.command("release")
		.argument("<lease-id>")
		.option("--holder <holder>")
		.option("--force", "Operator release without holder match")
		.option("--json")
		.action(async (leaseId: string, options: { holder?: string; force?: boolean; json?: boolean }) => {
			if (!options.force && !options.holder) throw new Error("--holder is required unless --force is used");
			const lease = await releaseDeploymentLease({ leaseId, holder: options.holder, force: options.force });
			if (options.json) printJson(lease);
			else console.log(`${lease.id}\t${lease.status}`);
		});

	program.command("reap")
		.option("--dry-run", "Preview cleanup", true)
		.option("--apply", "Apply cleanup")
		.option("--json")
		.action(async (options: { apply?: boolean; json?: boolean }) => {
			const plan = await planDeploymentPoolReap();
			const result = options.apply ? await applyDeploymentPoolReapPlan(plan) : { applied: false, plan };
			if (options.json) printJson(result);
			else {
				console.log(`Deployment pool reap ${options.apply ? "apply" : "dry-run"}: ${plan.summary.selectedLeases} lease(s), ${plan.summary.selectedOrphanContainers} orphan container(s), ${plan.summary.selectedDirtySlots} dirty slot(s), ${plan.summary.selectedFailureSnapshots} failure snapshot(s), ${plan.summary.selectedArtifacts} artifact(s)`);
				for (const item of plan.items) console.log(`${item.action}\t${item.lease.id}\t${item.reasons.join("+") || "active"}`);
				if (!options.apply) console.log("Dry-run only. Apply with: pibo compute pool reap --apply");
			}
		});

	program.command("doctor")
		.option("--json")
		.action(async (options: { json?: boolean }) => {
			const result = await getDeploymentPoolDoctor();
			if (options.json) printJson(result);
			else {
				console.log(`configured\t${result.configured}`);
				console.log(`runtime-image\t${result.runtimeImageAvailable ? "ok" : "missing"}\t${result.runtimeImage}`);
				console.log(`seed-source\t${result.seedSourceHomeAvailable ? "ok" : "missing"}\t${result.seedSourceHome}`);
				console.log("Next: pibo compute pool status --json");
			}
		});

	program.command("artifacts")
		.option("--json")
		.action(async (options: { json?: boolean }) => {
			const rows = await listDeploymentArtifacts();
			if (options.json) printJson({ artifacts: rows });
			else if (!rows.length) console.log("No deployment pool artifacts.");
			else for (const row of rows) console.log(`${row.sha256}\t${row.bytes}\t${row.modifiedAt}\t${row.path}`);
		});

	program.command("seed")
		.action(() => console.log(`Deployment seed modes:
  full    Nearly complete Pibo home plus configured workspace; excludes active runtime, lock, browser, debug, and pool state.
  medium  Operational config, selected product databases, projects, contexts, agents, and user skills; excludes heavy payload/tool/browser/debug state.
  fresh   Operational config, Google/Machine auth configuration, model defaults, contexts, and user skills; no existing product databases.
`));

	await program.parseAsync(argv);
}
