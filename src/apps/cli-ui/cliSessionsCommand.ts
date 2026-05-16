import React from "react";
import { render } from "ink";
import { createDefaultFakeCliSessionSource, LocalCliSessionSource, type CliSessionSource } from "../../cli-session/index.js";
import { InkSessionApp } from "./InkSessionApp.js";

export type RunCliSessionsUiOptions = {
	source?: CliSessionSource;
	useFakeSource?: boolean;
	initialSessionId?: string;
	ownerScope?: string;
	maxRows?: number;
	stdin?: NodeJS.ReadStream;
	stdout?: NodeJS.WriteStream;
	stderr?: NodeJS.WriteStream;
	allowNonTty?: boolean;
};

export async function runCliSessionsUi(options: RunCliSessionsUiOptions = {}): Promise<void> {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	if (options.allowNonTty !== true && stdout.isTTY !== true) {
		stderr.write("pibo tui:sessions requires an interactive TTY. Re-run from a terminal, or use --help for command usage.\n");
		process.exitCode = 1;
		return;
	}
	const source = options.source ?? (options.useFakeSource
		? createDefaultFakeCliSessionSource()
		: new LocalCliSessionSource({ ownerScope: options.ownerScope }));
	const instance = render(React.createElement(InkSessionApp, {
		initialSessionId: options.initialSessionId,
		maxRows: options.maxRows,
		source,
	}), {
		stdin: options.stdin,
		stdout,
		stderr,
	});
	await instance.waitUntilExit();
}

export function cliSessionsHelpText(): string {
	return `pibo tui:sessions - reduced Web Chat-derived session UI for terminals

Usage:
  pibo tui:sessions [options]

Options:
  --session <id>       Open a specific Pibo session id
  --owner-scope <id>   Limit local/direct discovery to one owner scope
  --max-rows <count>   Limit rendered transcript rows (default: 20)
  --demo               Use deterministic fake session data for smoke testing
  -h, --help           Show this help

V1 commands inside the app:
  /help /new /session /agent /status /clear /exit /quit

Scope:
  CLI Sessions is a reduced session/chat UI for SSH, bootstrap, recovery, and quick local work.
  Web Chat remains the full control center for projects, workflows, Cron, Ralph, Agent Designer, settings, and context management.

Related existing commands:
  pibo tui
  pibo tui:routed
`;
}
