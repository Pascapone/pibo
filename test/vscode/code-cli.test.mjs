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

describe("vscode/code-cli", () => {
	const script = `
		import assert from "node:assert/strict";
		import { EventEmitter } from "node:events";
		import { mkdtempSync, writeFileSync } from "node:fs";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import {
			detectCodeBinary,
			listInstalledExtensions,
			runCodeCommand,
			SUPPORTED_CODE_BINARIES,
		} from "./src/vscode/code-cli.ts";

		function fakeChild(stdoutText, stderrText, exitCode) {
			const child = new EventEmitter();
			// Stand in for Readable streams; emit data/end events directly.
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

		// detectCodeBinary: returns the first supported binary found in PATH.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-test-bin-"));
			for (const name of SUPPORTED_CODE_BINARIES) writeFileSync(join(dir, name), "#!/bin/sh\\nexit 0\\n");
			const detected = detectCodeBinary({ env: { PATH: dir } });
			assert.ok(detected, "should detect a code binary");
			assert.equal(detected.binary, SUPPORTED_CODE_BINARIES[0]);
		}

		// detectCodeBinary: prefers stable "code" over "code-insiders" when both are present.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-test-bin-"));
			writeFileSync(join(dir, "code-insiders"), "#!/bin/sh\\nexit 0\\n");
			writeFileSync(join(dir, "code"), "#!/bin/sh\\nexit 0\\n");
			const detected = detectCodeBinary({ env: { PATH: dir } });
			assert.equal(detected.binary, "code");
		}

		// detectCodeBinary: returns undefined when no supported binary is on PATH.
		{
			const dir = mkdtempSync(join(tmpdir(), "pibo-vscode-test-bin-"));
			writeFileSync(join(dir, "not-vscode"), "#!/bin/sh\\nexit 0\\n");
			assert.equal(detectCodeBinary({ env: { PATH: dir } }), undefined);
		}

		// detectCodeBinary: empty PATH returns undefined.
		{
			assert.equal(detectCodeBinary({ env: { PATH: "" } }), undefined);
		}

		// runCodeCommand: captures stdout/stderr and resolves with exit code 0.
		{
			const spawnImpl = (bin, args) => {
				assert.equal(bin, "/fake/code");
				assert.deepEqual(args, ["--list-extensions"]);
				return fakeChild("pibo.pibo-vscode-ext@1.3.0\\n", "", 0);
			};
			const result = await runCodeCommand({ binary: "/fake/code", args: ["--list-extensions"], spawnImpl });
			assert.equal(result.exitCode, 0);
			assert.ok(result.stdout.includes("pibo.pibo-vscode-ext"));
		}

		// runCodeCommand: non-zero exit code is surfaced.
		{
			const spawnImpl = () => fakeChild("", "boom\\n", 2);
			const result = await runCodeCommand({ binary: "/fake/code", args: ["--fail"], spawnImpl });
			assert.equal(result.exitCode, 2);
			assert.equal(result.stderr, "boom\\n");
		}

		// listInstalledExtensions: parses "id@version" lines.
		{
			const spawnImpl = () => fakeChild("foo.bar@1.2.3\\nother.ext\\n", "", 0);
			const list = await listInstalledExtensions({ binary: "/fake/code", spawnImpl });
			assert.equal(list.length, 2);
			assert.equal(list[0].id, "foo.bar");
			assert.equal(list[0].version, "1.2.3");
			assert.equal(list[1].id, "other.ext");
			assert.equal(list[1].version, undefined);
		}
	`;

	test("detects code binary and parses code CLI output", async () => {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: root });
	});
});

void execFile;
