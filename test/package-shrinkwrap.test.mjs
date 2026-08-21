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

test("published package metadata includes and cleans the generated shrinkwrap", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

	assert.ok(packageJson.files.includes("npm-shrinkwrap.json"));
	assert.match(packageJson.scripts.prepack, /package-shrinkwrap\.mjs prepare/);
	assert.match(packageJson.scripts.postpack, /package-shrinkwrap\.mjs clean/);
});
