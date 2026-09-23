import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Import-isolation regression, not an installation test: the gateway and every
// other product module are deliberately absent from this temporary module tree.
for (const [args, expected] of [
	[["--help"], /Usage: pibo <command>/],
	[["--version"], /^4\.0\.0-test\s*$/],
	[["gateway:web", "--help"], /Usage: pibo gateway:web/],
	[["gateway", "--help"], /Usage: pibo gateway <target>/],
	[["gateway", "web", "--help"], /Usage: pibo gateway web <command>/],
	[["gateway", "web", "status", "--help"], /Usage: pibo gateway web status \[--json\]/],
	[["gateway", "dev", "doctor", "--help"], /Usage: pibo gateway dev doctor \[--json\]/],
]) {
	test(`core CLI ${args.join(" ")} loads no gateway or product state`, () => {
		const root = mkdtempSync(join(tmpdir(), "pibo-cli-discovery-"));
		try {
			const home = join(root, "state-must-not-exist");
			const moduleDir = join(root, "dist", "core");
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", version: "4.0.0-test" }));
			const entry = join(moduleDir, "executable-cli.js");
			copyFileSync(new URL("../dist/core/executable-cli.js", import.meta.url), entry);
			const source = `import { runPiboCoreCli } from ${JSON.stringify(pathToFileURL(entry).href)}; await runPiboCoreCli(${JSON.stringify(["node", "pibo", ...args])});`;
			const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
				cwd: root,
				env: { ...process.env, HOME: home, PIBO_HOME: home },
				encoding: "utf8",
				timeout: 10_000,
			});
			assert.match(output, expected);
			assert.equal(existsSync(home), false, "discovery must not initialize Pibo Home");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("installed gateway refuses mutation before importing the operator graph or touching Pibo Home", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-cli-readonly-"));
	try {
		const home = join(root, "state-must-not-exist");
		const moduleDir = join(root, "dist", "core");
		mkdirSync(moduleDir, { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", version: "4.0.0-test" }));
		const entry = join(moduleDir, "executable-cli.js");
		copyFileSync(new URL("../dist/core/executable-cli.js", import.meta.url), entry);
		const source = `import { runPiboCoreCli } from ${JSON.stringify(pathToFileURL(entry).href)};
		for (const args of [["gateway", "web", "restart"], ["gateway", "dev", "start"], ["gateway", "web", "stop", "--force"], ["gateway", "web", "status", "--force"]]) {
			try { await runPiboCoreCli(["node", "pibo", ...args]); throw Error("unsafe command was accepted"); }
			catch (error) { if (!/read-only|Unknown gateway web status option/.test(String(error.message))) throw error; }
		}`;
		execFileSync(process.execPath, ["--input-type=module", "-e", source], {
			cwd: root,
			env: { ...process.env, HOME: home, PIBO_HOME: home },
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.equal(existsSync(home), false, "disallowed operator commands must not initialize Pibo Home");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
