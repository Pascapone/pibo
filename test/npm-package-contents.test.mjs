import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("npm package excludes generated VSIX artifacts while keeping runtime assets", async () => {
	const artifactsDir = join(process.cwd(), "dist", "apps", "vscode-artifacts");
	const artifactsDirExisted = existsSync(artifactsDir);
	const markerName = `package-exclusion-${process.pid}.vsix`;
	const markerPath = join(artifactsDir, markerName);
	await mkdir(artifactsDir, { recursive: true });
	await writeFile(markerPath, "generated VSIX marker");

	try {
		const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
			cwd: process.cwd(),
			maxBuffer: 16 * 1024 * 1024,
		});
		const [report] = JSON.parse(stdout);
		const files = report.files.map((file) => file.path);
		assert.equal(files.some((path) => path.startsWith("dist/apps/vscode-artifacts/")), false);
		assert.equal(files.includes("dist/bin/pibo.js"), true);
		assert.equal(files.some((path) => path.startsWith("dist/apps/chat-ui/")), true);
		assert.equal(existsSync(markerPath), true, "npm pack must not remove release artifacts from the workspace");
	} finally {
		await unlink(markerPath).catch(() => undefined);
		if (!artifactsDirExisted && (await readdir(artifactsDir).catch(() => [])).length === 0) {
			await rm(artifactsDir, { recursive: true, force: true });
		}
	}
});

test("npm package ships the unavailable-tool path contract", async () => {
	const packageDir = await mkdtemp(join(tmpdir(), "pibo-package-tools-contract-"));
	try {
		const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packageDir], {
			cwd: process.cwd(),
			maxBuffer: 16 * 1024 * 1024,
		});
		const [report] = JSON.parse(stdout);
		const archivePath = join(packageDir, report.filename);
		const { stdout: packagedToolsCli } = await execFileAsync("tar", ["-xOf", archivePath, "package/dist/tools/index.js"]);
		assert.match(packagedToolsCli, /CLI_TOOL_NOT_INSTALLED/);
		assert.match(packagedToolsCli, /Run pibo tools install/);
	} finally {
		await rm(packageDir, { recursive: true, force: true });
	}
});
