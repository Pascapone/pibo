/**
 * `pibo vscode` sub-command — manage the Pibo VS Code extension.
 *
 * Sub-commands:
 *   install     Download and install the latest Pibo VS Code extension.
 *   uninstall   Remove the installed Pibo VS Code extension.
 *   status      Show whether the extension is installed and which CLI is used.
 */

import { Command } from "commander";

import { runInstall } from "./install.js";
import { runStatus, formatStatusText } from "./status.js";
import { runUninstall } from "./uninstall.js";

function printDiscovery(): void {
	console.log(`pibo vscode

Manage the Pibo VS Code extension.

Commands:
  install     Download and install the latest Pibo VS Code extension
  uninstall   Remove the installed Pibo VS Code extension
  status      Show whether the extension is installed

Next: pibo vscode install --help`);
}

export async function runVscodeCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name("pibo vscode").description("Manage the Pibo VS Code extension").helpOption("-h, --help");

	program
		.command("install")
		.description("Download and install the Pibo VS Code extension")
		.option("--version <tag>", "Pibo release tag to install (e.g., v1.3.0). Defaults to latest.")
		.option("--vsix <path>", "Install from a local .vsix file instead of fetching a release")
		.option("--from-url <url>", "Fetch a .vsix from the given URL (release tag will be inferred)")
		.option("--owner <owner>", "GitHub owner for the release source", "Pascapone")
		.option("--repo <repo>", "GitHub repo for the release source", "pibo")
		.option("--no-cache", "Skip the VSIX download cache")
		.option("--json", "Print JSON")
		.action(async (options) => {
			const result = await runInstall({
				vsixPath: options.vsix,
				fromUrl: options.fromUrl,
				version: options.version,
				owner: options.owner,
				repo: options.repo,
				skipCache: options.cache === false,
			});
			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
			} else if (result.status === "installed") {
				console.log(`installed\t${result.tagName}\t${result.vsixPath}`);
			} else {
				process.exitCode = 1;
			}
		});

	program
		.command("uninstall")
		.description("Remove the installed Pibo VS Code extension")
		.option("--json", "Print JSON")
		.action(async (options) => {
			const result = await runUninstall();
			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
			} else if (result.status !== "uninstalled") {
				process.exitCode = 1;
			}
		});

	program
		.command("status")
		.description("Show the Pibo VS Code extension install status")
		.option("--owner <owner>", "GitHub owner for the release source", "Pascapone")
		.option("--repo <repo>", "GitHub repo for the release source", "pibo")
		.option("--json", "Print JSON")
		.action(async (options) => {
			const status = await runStatus({ owner: options.owner, repo: options.repo });
			if (options.json) {
				console.log(JSON.stringify(status, null, 2));
			} else {
				console.log(formatStatusText(status));
			}
		});

	if (argv.length <= 2 || argv.includes("--help") || argv.includes("-h")) {
		printDiscovery();
		return;
	}
	await program.parseAsync(argv);
}
