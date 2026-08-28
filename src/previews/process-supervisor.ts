import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const command = process.env.PIBO_PREVIEW_START_COMMAND;
if (!command) throw new Error("Preview supervisor requires a start command");

const environment = { ...process.env };
delete environment.PIBO_PREVIEW_START_COMMAND;
const shell = previewShell();
const child = spawn(shell.command, shell.args(command), {
	env: environment,
	stdio: "ignore",
	windowsHide: true,
});

child.once("error", (error) => {
	console.error(`Preview supervisor could not start its command: ${error.message}`);
	process.exitCode = 1;
});
child.once("exit", (code, signal) => {
	process.exitCode = code ?? (signal ? 1 : 0);
});

function previewShell(): { command: string; args(command: string): string[] } {
	if (process.platform === "win32") {
		return {
			command: process.env.ComSpec ?? "cmd.exe",
			args: (value) => ["/d", "/s", "/c", value],
		};
	}
	const shell = process.env.SHELL && existsSync(process.env.SHELL)
		? process.env.SHELL
		: existsSync("/bin/bash")
			? "/bin/bash"
			: "/bin/sh";
	return {
		command: shell,
		args: (value) => basename(shell).includes("bash") ? ["-lc", value] : ["-c", value],
	};
}
