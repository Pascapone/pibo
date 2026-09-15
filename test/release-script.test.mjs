import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("release updates private workspace lock metadata before building versioned artifacts", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-release-version-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "scripts"), { recursive: true });
	await mkdir(join(root, "fake-bin"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-core-package"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-cutover-package"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-artifacts/preview"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-standard-package"), { recursive: true });
	await copyFile(new URL("../scripts/release.mjs", import.meta.url), join(root, "scripts/release.mjs"));
	await writeFile(join(root, "dist/pibo4-core-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo", version: "9.9.9" })}\n`);
	await writeFile(join(root, "dist/pibo4-cutover-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-cutover", version: "9.9.9" })}\n`);
	await writeFile(join(root, "dist/pibo4-artifacts/preview/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-plugin-preview", version: "1.0.0" })}\n`);
	await writeFile(join(root, "dist/pibo4-artifacts/standard-package-set.json"), `${JSON.stringify({ plugins: [{ package: "@pasko70/pibo-plugin-preview", version: "1.0.0" }] })}\n`);
	await writeFile(join(root, "dist/pibo4-standard-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-standard", version: "9.9.9", dependencies: { "@pasko70/pibo": "9.9.9", "@pasko70/pibo-plugin-preview": "1.0.0" } })}\n`);
	await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "@pasko70/pibo", version: "1.7.2", private: true }, null, 2)}\n`);
	await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
		name: "@pasko70/pibo",
		version: "1.7.2",
		lockfileVersion: 3,
		packages: { "": { name: "@pasko70/pibo", version: "1.7.2" } },
	}, null, 2)}\n`);
	const fakeNpmPath = join(root, "fake-bin/npm");
	await writeFile(fakeNpmPath, "#!/usr/bin/env node\n");
	await chmod(fakeNpmPath, 0o755);

	await execFileAsync(process.execPath, [join(root, "scripts/release.mjs"), "--version", "9.9.9", "--no-publish", "--no-release"], {
		cwd: root,
		env: { ...process.env, PATH: `${join(root, "fake-bin")}${delimiter}${process.env.PATH ?? ""}` },
	});

	const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const packageLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
	assert.equal(packageJson.version, "9.9.9");
	assert.equal(packageLock.version, "9.9.9");
	assert.equal(packageLock.packages[""].version, "9.9.9");
});

test("release publishes only generated Minimal-Core, Cutover, plugin, and Standard packages", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-release-packages-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "scripts"), { recursive: true });
	await mkdir(join(root, "fake-bin"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-core-package"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-cutover-package"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-artifacts/preview"), { recursive: true });
	await mkdir(join(root, "dist/pibo4-standard-package"), { recursive: true });
	await copyFile(new URL("../scripts/release.mjs", import.meta.url), join(root, "scripts/release.mjs"));
	await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "@pasko70/pibo", version: "3.9.0", private: true }, null, 2)}\n`);
	await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
		name: "@pasko70/pibo",
		version: "3.9.0",
		lockfileVersion: 3,
		packages: { "": { name: "@pasko70/pibo", version: "3.9.0", private: true } },
	}, null, 2)}\n`);
	await writeFile(join(root, "dist/pibo4-core-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo", version: "4.0.0" })}\n`);
	await writeFile(join(root, "dist/pibo4-cutover-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-cutover", version: "4.0.0" })}\n`);
	await writeFile(join(root, "dist/pibo4-artifacts/preview/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-plugin-preview", version: "1.0.0" })}\n`);
	await writeFile(join(root, "dist/pibo4-artifacts/standard-package-set.json"), `${JSON.stringify({ plugins: [{ package: "@pasko70/pibo-plugin-preview", version: "1.0.0" }] })}\n`);
	await writeFile(join(root, "dist/pibo4-standard-package/package.json"), `${JSON.stringify({ name: "@pasko70/pibo-standard", version: "4.0.0", dependencies: { "@pasko70/pibo": "4.0.0", "@pasko70/pibo-plugin-preview": "1.0.0" } })}\n`);
	const npmLog = join(root, "npm.log");
	const fakeNpmPath = join(root, "fake-bin/npm");
	await writeFile(fakeNpmPath, `#!/usr/bin/env node\nconst fs=require("node:fs");fs.appendFileSync(${JSON.stringify(npmLog)},JSON.stringify(process.argv.slice(2))+"\\n");\n`);
	await chmod(fakeNpmPath, 0o755);

	await execFileAsync(process.execPath, [join(root, "scripts/release.mjs"), "--version", "4.0.0", "--publish-npm", "--no-release"], {
		cwd: root,
		env: { ...process.env, PATH: `${join(root, "fake-bin")}${delimiter}${process.env.PATH ?? ""}` },
	});

	const calls = (await readFile(npmLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(calls, [
		["run", "--silent", "build"],
		["run", "--silent", "pibo4:minimal-core"],
		["publish", "dist/pibo4-core-package", "--access", "public"],
		["publish", "dist/pibo4-cutover-package", "--access", "public"],
		["publish", "dist/pibo4-artifacts/preview", "--access", "public"],
		["publish", "dist/pibo4-standard-package", "--access", "public"],
	]);
	assert.equal(calls.some((call) => call.length === 1 && call[0] === "publish"), false, "the repository root must never be published");
});
