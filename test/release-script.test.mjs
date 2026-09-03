import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("release updates root lock metadata to the published package version", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-release-version-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "scripts"), { recursive: true });
	await mkdir(join(root, "src/apps/chat-vscode"), { recursive: true });
	await mkdir(join(root, "fake-bin"), { recursive: true });
	await copyFile(new URL("../scripts/release.mjs", import.meta.url), join(root, "scripts/release.mjs"));
	await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "@pasko70/pibo", version: "1.7.2" }, null, 2)}\n`);
	await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
		name: "@pasko70/pibo",
		version: "1.7.2",
		lockfileVersion: 3,
		packages: { "": { name: "@pasko70/pibo", version: "1.7.2" } },
	}, null, 2)}\n`);
	await writeFile(join(root, "src/apps/chat-vscode/package.json"), `${JSON.stringify({ name: "pibo-vscode-ext", publisher: "pibo", version: "1.7.2" }, null, 2)}\n`);
	const fakeNpmPath = join(root, "fake-bin/npm");
	await writeFile(fakeNpmPath, `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
if (process.argv.includes("vscode:package")) {
  const extension = JSON.parse(readFileSync(resolve("src/apps/chat-vscode/package.json"), "utf8"));
  const artifacts = resolve("dist/apps/vscode-artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(resolve(artifacts, extension.name + "-" + extension.version + ".vsix"), "fixture");
}
`);
	await chmod(fakeNpmPath, 0o755);

	await execFileAsync(process.execPath, [join(root, "scripts/release.mjs"), "--version", "9.9.9", "--no-publish", "--no-release"], {
		cwd: root,
		env: { ...process.env, PATH: `${join(root, "fake-bin")}${delimiter}${process.env.PATH ?? ""}` },
	});

	const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const packageLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
	const extensionPackageJson = JSON.parse(await readFile(join(root, "src/apps/chat-vscode/package.json"), "utf8"));
	assert.equal(packageJson.version, "9.9.9");
	assert.equal(packageLock.version, "9.9.9");
	assert.equal(packageLock.packages[""].version, "9.9.9");
	assert.equal(extensionPackageJson.version, "9.9.9");
});
