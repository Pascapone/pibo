import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
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
