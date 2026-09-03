import { Command } from "commander";
import { inspectPiPackageSource, parsePiPackageSource } from "./metadata.js";
import { findPiPackage, listPiPackages, removePiPackage, upsertPiPackage } from "./store.js";

export async function runPiPackagesCli(argv = process.argv): Promise<void> {
	if (argv[2] === "--help" || argv[2] === "-h" || argv.length <= 2) {
		printPiPackagesDiscovery();
		return;
	}

	const program = new Command();
	program.name("pibo pi-packages").description("Register Pi Coding Agent packages for Pibo profiles").helpOption(false);

	program.command("list").description("List registered Pi packages").action(() => {
		const packages = listPiPackages();
		if (packages.length === 0) {
			console.log("No Pi packages registered.");
			console.log("Next: pibo pi-packages add <source>");
			return;
		}
		for (const pkg of packages) {
			console.log(`${pkg.name.padEnd(24)} ${pkg.installStatus.padEnd(10)} ${(pkg.resourceTypes.join(", ") || "unknown").padEnd(20)} ${pkg.installSpec}`);
		}
	});

	program.command("add").argument("<source>").description("Register a pi.dev package URL or local path").action(async (source: string) => {
		const pkg = upsertPiPackage(await inspectPiPackageSource(source));
		console.log(`Added Pi package ${pkg.name}`);
		console.log(`  source: ${pkg.source}`);
		console.log(`  install: ${pkg.installSpec}`);
		console.log(`  status: ${pkg.installStatus}`);
		console.log(`Next: pibo pi-packages inspect ${pkg.id}`);
	});

	program.command("inspect").argument("<name-or-id>").description("Inspect one registered Pi package").action((nameOrId: string) => {
		const pkg = findPiPackage(nameOrId);
		if (!pkg) {
			process.exitCode = 1;
			console.error(`Unknown Pi package "${nameOrId}"`);
			return;
		}
		console.log(JSON.stringify(pkg, null, 2));
	});

	program.command("remove").argument("<name-or-id>").description("Remove a registered Pi package").action((nameOrId: string) => {
		const removed = removePiPackage(nameOrId);
		if (!removed) {
			process.exitCode = 1;
			console.error(`Unknown Pi package "${nameOrId}"`);
			return;
		}
		console.log(`Removed Pi package ${removed.name}`);
	});

	program.command("doctor").description("Check registered Pi package sources").action(async () => {
		const packages = listPiPackages();
		if (packages.length === 0) {
			console.log("No Pi packages registered.");
			return;
		}
		let hasErrors = false;
		for (const pkg of packages) {
			const diagnostics: string[] = [];
			try {
				await parsePiPackageSource(pkg.source);
			} catch (error) {
				diagnostics.push(error instanceof Error ? error.message : String(error));
			}
			if (pkg.installPath && !pkg.installPath.startsWith("npm:")) {
				try {
					await parsePiPackageSource(pkg.installPath);
				} catch (error) {
					diagnostics.push(error instanceof Error ? error.message : String(error));
				}
			}
			const status = diagnostics.length || pkg.installStatus === "error" || pkg.installStatus === "missing" ? "error" : "ok";
			if (status === "error") hasErrors = true;
			console.log(`${pkg.name}\t${status}\t${pkg.installSpec}`);
			for (const diagnostic of [...pkg.diagnostics.map((item) => item.message), ...diagnostics]) {
				console.log(`  ${diagnostic}`);
			}
		}
		if (hasErrors) process.exitCode = 1;
	});

	await program.parseAsync(argv);
}

function printPiPackagesDiscovery(): void {
	console.log(`pibo pi-packages - registered Pi Coding Agent packages

Commands:
  list                 List registered packages
  add <source>         Register a pi.dev URL or local path
  inspect <name-or-id> Show package metadata
  remove <name-or-id>  Remove a registration
  doctor               Check package sources

Next:
  pibo pi-packages list
`);
}
