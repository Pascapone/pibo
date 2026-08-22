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

	assert.deepEqual(versions, piPackages.map(() => "0.84.2"));

	for (const packageName of piPackages) {
		assert.equal(packageLock.packages[""].dependencies[packageName], "0.84.2");

		const lockedCopies = Object.entries(packageLock.packages)
			.filter(([packagePath]) => packagePath.endsWith(`node_modules/${packageName}`))
			.map(([, packageEntry]) => packageEntry.version);
		assert.ok(lockedCopies.length > 0, `${packageName} must be present in package-lock.json`);
		assert.deepEqual(lockedCopies, lockedCopies.map(() => "0.84.2"));
	}
});

test("the VS Code test shim installs without a Windows workspace junction", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
	const npmConfig = await readFile(new URL("../.npmrc", import.meta.url), "utf8");
	const installedShim = JSON.parse(await readFile(new URL("../node_modules/vscode/package.json", import.meta.url), "utf8"));

	assert.deepEqual(packageJson.workspaces, ["packages/workflows"]);
	assert.equal(packageJson.devDependencies.vscode, "file:src/apps/chat-vscode/extension/vscode-shim");
	assert.match(npmConfig, /^install-links=true\s*$/);
	assert.deepEqual(packageLock.packages["node_modules/vscode"], {
		version: "0.0.0-pibo-test-shim",
		resolved: "file:src/apps/chat-vscode/extension/vscode-shim",
		dev: true,
	});
	assert.equal(installedShim.name, "vscode");
	assert.equal(installedShim.version, "0.0.0-pibo-test-shim");
});

test("browser-only MDX editor dependencies stay out of the production install", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(packageJson.dependencies["@mdxeditor/editor"], undefined);
	assert.equal(packageJson.devDependencies["@mdxeditor/editor"], "^3.55.0");
	assert.equal(packageJson.overrides["js-yaml"], "4.3.1");
});
