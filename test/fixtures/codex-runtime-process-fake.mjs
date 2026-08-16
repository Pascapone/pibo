#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const scenario = process.env.PIBO_CODEX_RUNTIME_FAKE_SCENARIO ?? "happy";

if (args[0] === "--version") {
	if (scenario === "version-require-isolation") {
		const protectedKeys = [
			"CODEX_HOME",
			"HOME",
			"USERPROFILE",
			"XDG_CACHE_HOME",
			"XDG_CONFIG_HOME",
			"XDG_DATA_HOME",
			"XDG_STATE_HOME",
			"TMPDIR",
			"TMP",
			"TEMP",
		];
		if (protectedKeys.some((key) => !process.env[key])) {
			if (process.env.PIBO_CODEX_RUNTIME_FAKE_SENTINEL) {
				writeFileSync(process.env.PIBO_CODEX_RUNTIME_FAKE_SENTINEL, "version probe escaped private runtime state");
			}
			process.exitCode = 9;
		} else {
			process.stdout.write("codex-cli 0.147.0\n");
		}
	} else if (scenario === "version-timeout") {
		setInterval(() => {}, 60_000);
	} else if (scenario === "version-too-large") {
		process.stdout.write(`codex-cli 0.147.0 ${"x".repeat(70 * 1024)}\n`);
	} else if (scenario === "version-failed") {
		process.stderr.write("Bearer fixture-secret-token access_token=fixture-access-value\n");
		process.exitCode = 7;
	} else if (scenario === "version-unreadable") {
		process.stdout.write("unknown runtime\n");
	} else {
		process.stdout.write(`codex-cli ${process.env.PIBO_CODEX_RUNTIME_FAKE_VERSION ?? "0.147.0"}\n`);
	}
} else {
	const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
	let initialized = false;
	const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
	lines.on("line", (line) => {
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			send({
				id: message.id,
				result: {
					codexHome: scenario === "home-mismatch" ? "/tmp/not-the-configured-codex-home" : process.env.CODEX_HOME,
					platformFamily: "unix",
					platformOs: "linux",
					userAgent: "fake-codex-app-server/0.147.0",
				},
			});
			return;
		}
		if (message.method === "initialized") {
			initialized = true;
			return;
		}
		if (message.method === "test/process") {
			send({
				id: message.id,
				result: {
					initialized,
					args,
					codexHome: process.env.CODEX_HOME,
					home: process.env.HOME,
					tmp: process.env.TMPDIR,
					xdgConfig: process.env.XDG_CONFIG_HOME,
					allowedValue: process.env.PIBO_ALLOWED_VALUE ?? null,
					resourceValue: process.env.PIBO_RESOURCE_SECRET ?? null,
					unrelatedValue: process.env.PIBO_UNRELATED_SECRET ?? null,
				},
			});
			return;
		}
		send({ id: message.id, result: {} });
	});
	lines.on("close", () => process.exit(0));
}
