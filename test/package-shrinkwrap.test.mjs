import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanPackageShrinkwrap, preparePackageShrinkwrap } from "../scripts/package-shrinkwrap.mjs";

test("package lifecycle publishes the repository lock as npm-shrinkwrap.json", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-package-shrinkwrap-"));
	t.after(() => rm(root, { recursive: true, force: true }));

	const packageJson = { name: "@pasko70/pibo", version: "1.2.3" };
	const packageLock = {
		name: packageJson.name,
		version: packageJson.version,
		lockfileVersion: 3,
		packages: { "": packageJson },
	};
	const lockBytes = `${JSON.stringify(packageLock, null, 2)}\n`;
	await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
	await writeFile(join(root, "package-lock.json"), lockBytes);

	await preparePackageShrinkwrap(root);
	assert.equal(await readFile(join(root, "npm-shrinkwrap.json"), "utf8"), lockBytes);

	await cleanPackageShrinkwrap(root);
	await assert.rejects(readFile(join(root, "npm-shrinkwrap.json"), "utf8"), { code: "ENOENT" });
});

test("package lifecycle rejects stale lockfile version metadata", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-package-shrinkwrap-version-"));
	t.after(() => rm(root, { recursive: true, force: true }));

	const packageJson = { name: "@pasko70/pibo", version: "2.0.0" };
	const packageLock = {
		name: packageJson.name,
		version: "1.0.0",
		lockfileVersion: 3,
		packages: { "": { name: packageJson.name, version: "1.0.0" } },
	};
	await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
	await writeFile(join(root, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`);

	await assert.rejects(preparePackageShrinkwrap(root), /does not match package\.json version/);
	await assert.rejects(readFile(join(root, "npm-shrinkwrap.json"), "utf8"), { code: "ENOENT" });
});

test("published package metadata includes and cleans the generated shrinkwrap", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

	assert.ok(packageJson.files.includes("npm-shrinkwrap.json"));
	assert.match(packageJson.scripts.prepack, /package-shrinkwrap\.mjs prepare/);
	assert.match(packageJson.scripts.postpack, /package-shrinkwrap\.mjs clean/);
});
