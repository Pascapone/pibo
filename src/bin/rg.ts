#!/usr/bin/env node
import { spawn } from "node:child_process";

import { rgPath } from "@vscode/ripgrep";

const child = spawn(rgPath, process.argv.slice(2), { stdio: "inherit" });

child.on("error", (error) => {
	console.error(`rg: ${error.message}`);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});
