import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const piPackages = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
];

test("Pi runtime packages use one exact compatible version", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
	const versions = piPackages.map((packageName) => packageJson.dependencies[packageName]);

	assert.deepEqual(versions, piPackages.map(() => "0.80.6"));

	for (const packageName of piPackages) {
		assert.equal(packageLock.packages[""].dependencies[packageName], "0.80.6");

		const lockedCopies = Object.entries(packageLock.packages)
			.filter(([packagePath]) => packagePath.endsWith(`node_modules/${packageName}`))
			.map(([, packageEntry]) => packageEntry.version);
		assert.ok(lockedCopies.length > 0, `${packageName} must be present in package-lock.json`);
		assert.deepEqual(lockedCopies, lockedCopies.map(() => "0.80.6"));
	}
});
