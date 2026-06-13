import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = join(import.meta.dirname, "..", "..");

describe("vscode/uninstall", () => {
	const script = `
		import assert from "node:assert/strict";
		import { EventEmitter } from "node:events";
		import { mkdtempSync, writeFileSync } from "node:fs";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { runUninstall } from "./src/vscode/uninstall.ts";

		function fakeChild(stdoutText, stderrText, exitCode) {
			const child = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = () => {};
			queueMicrotask(() => {
				if (stdoutText) child.stdout.emit("data", Buffer.from(stdoutText));
				child.stdout.emit("end");
				if (stderrText) child.stderr.emit("data", Buffer.from(stderrText));
				child.stderr.emit("end");
				child.emit("close", exitCode);
			});
			return child;
		}

		// No code CLI → failed.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-uninstall-"));
			const result = await runUninstall({ env: { PATH: dir } });
			assert.equal(result.status, "failed");
			assert.equal(result.reason, "no-code-cli");
		}

		// Happy path: code --uninstall-extension exits 0.
		{
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-uninstall-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 0\\n");
			const uninstallCalls = [];
			const spawnImpl = (bin, args) => {
				uninstallCalls.push({ bin, args });
				return fakeChild("Extension 'pibo.pibo-vscode' was successfully uninstalled!\\n", "", 0);
			};
			const result = await runUninstall({ env: { PATH: codeDir }, spawnImpl });
			assert.equal(result.status, "uninstalled");
			assert.equal(uninstallCalls[0].args[0], "--uninstall-extension");
			assert.equal(uninstallCalls[0].args[1], "pibo.pibo-vscode");
		}

		// "Extension not found" stderr → not-installed.
		{
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-uninstall-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 1\\n");
			const spawnImpl = () => fakeChild("", "Extension 'pibo.pibo-vscode' is not installed.\\n", 1);
			const result = await runUninstall({ env: { PATH: codeDir }, spawnImpl });
			assert.equal(result.status, "not-installed");
		}

		// Unrelated error → failed.
		{
			const codeDir = mkdtempSync(join(tmpdir(), "pibo-vscode-uninstall-code-"));
			writeFileSync(join(codeDir, "code"), "#!/bin/sh\\nexit 2\\n");
			const spawnImpl = () => fakeChild("", "permission denied\\n", 2);
			const result = await runUninstall({ env: { PATH: codeDir }, spawnImpl });
			assert.equal(result.status, "failed");
			assert.match(result.reason, /permission denied/);
		}
	`;

	test("uninstalls the Pibo VS Code extension or reports not-installed", async () => {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: root });
	});
});

void execFile;
