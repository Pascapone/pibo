import { spawn } from "node:child_process";

const ENVIRONMENT_KEY_PATTERN = /^PIBO_CODEX_MCP_STDIO_[A-F0-9]{16}_(COMMAND|ARGS|ENV|CWD)$/;
const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_ARGS = 512;
const MAX_ARGS_BYTES = 256 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 512;
const MAX_ENVIRONMENT_BYTES = 512 * 1024;

function fail(): never {
	process.stderr.write("Pibo native Codex MCP stdio launcher configuration is invalid.\n");
	process.exit(125);
}

function takeEnvironment(name: string | undefined): string {
	if (!name || !ENVIRONMENT_KEY_PATTERN.test(name)) fail();
	const value = process.env[name];
	delete process.env[name];
	if (value === undefined) fail();
	return value;
}

function parseStringArray(value: string): string[] {
	if (Buffer.byteLength(value, "utf8") > MAX_ARGS_BYTES) fail();
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		fail();
	}
	if (!Array.isArray(parsed) || parsed.length > MAX_ARGS || parsed.some((entry) => typeof entry !== "string")) fail();
	return parsed;
}

function parseEnvironment(value: string): Record<string, string> {
	if (Buffer.byteLength(value, "utf8") > MAX_ENVIRONMENT_BYTES) fail();
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		fail();
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();
	const entries = Object.entries(parsed);
	if (entries.length > MAX_ENVIRONMENT_ENTRIES) fail();
	const environment: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const [name, entry] of entries) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof entry !== "string") fail();
		environment[name] = entry;
	}
	return environment;
}

const [commandEnvironment, argsEnvironment, childEnvironment, cwdEnvironment] = process.argv.slice(2);
const command = takeEnvironment(commandEnvironment);
if (!command.trim() || Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) fail();
const args = parseStringArray(takeEnvironment(argsEnvironment));
const configuredEnvironment = parseEnvironment(takeEnvironment(childEnvironment));
const cwdValue = takeEnvironment(cwdEnvironment);
const cwd = cwdValue || undefined;
const environment = {
	...process.env,
	...configuredEnvironment,
};

const child = spawn(command, args, {
	cwd,
	env: environment,
	stdio: "inherit",
});
let terminal = false;
const finish = (code: number): void => {
	if (terminal) return;
	terminal = true;
	process.exit(code);
};
child.once("error", () => finish(126));
child.once("exit", (code, signal) => finish(code ?? (signal ? 128 : 1)));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.once(signal, () => {
		if (!terminal) child.kill(signal);
	});
}
