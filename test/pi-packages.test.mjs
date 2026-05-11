import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { inspectPiPackageSource, parsePiPackageSource } from "../dist/pi-packages/metadata.js";
import { getPiPackageRuntimeOptions } from "../dist/pi-packages/runtime.js";
import { findPiPackage, listPiPackages, removePiPackage, setPiPackageEnabled, upsertPiPackage } from "../dist/pi-packages/store.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pi package source parser accepts pi.dev package URLs", async () => {
	const parsed = await parsePiPackageSource("https://pi.dev/packages/@ollama/pi-web-search");

	assert.equal(parsed.kind, "npm");
	assert.equal(parsed.name, "@ollama/pi-web-search");
	assert.equal(parsed.installSpec, "npm:@ollama/pi-web-search");
});

test("pi package source parser rejects non-pi.dev URLs", async () => {
	await assert.rejects(
		parsePiPackageSource("https://example.com/packages/pi-web-access"),
		/Unsupported Pi package URL/,
	);
});

test("pi package source parser rejects pi.dev package index URLs", async () => {
	await assert.rejects(
		parsePiPackageSource("https://pi.dev/packages"),
		/Unsupported Pi package URL|must point to a package detail page/,
	);
});

test("pi package inspect discovers local package resources", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-"));
	const packageDir = join(cwd, "local-package");
	mkdirSync(join(packageDir, "skills"), { recursive: true });
	mkdirSync(join(packageDir, "extensions"), { recursive: true });
	writeFileSync(join(packageDir, "skills", "demo.md"), "# Demo\n", "utf-8");
	writeFileSync(join(packageDir, "extensions", "demo.js"), "export default {}\n", "utf-8");
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({
		name: "local-pi-package",
		version: "1.2.3",
		description: "Local package fixture",
		pi: {
			skills: ["skills/*.md"],
			extensions: ["extensions/*.js"],
		},
	}), "utf-8");

	const inspected = await inspectPiPackageSource(packageDir, cwd);

	assert.equal(inspected.name, "local-pi-package");
	assert.equal(inspected.version, "1.2.3");
	assert.deepEqual(inspected.resourceTypes, ["extension", "skill"]);
	assert.equal(inspected.installStatus, "installed");
	assert.equal(inspected.installPath, packageDir);
});

test("pi package store upserts, finds, lists, and removes packages", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-store-"));
	const pkg = upsertPiPackage({
		id: "demo-package",
		name: "demo-package",
		source: "/tmp/demo-package",
		installSpec: "/tmp/demo-package",
		resourceTypes: ["extension"],
		installStatus: "installed",
		installPath: "/tmp/demo-package",
		enabled: true,
		diagnostics: [],
	}, cwd);

	assert.equal(findPiPackage("demo-package", cwd)?.id, pkg.id);
	assert.deepEqual(listPiPackages(cwd).map((item) => item.name), ["demo-package"]);
	assert.equal(removePiPackage("demo-package", cwd)?.id, "demo-package");
	assert.deepEqual(listPiPackages(cwd), []);
});

test("pi package store preserves previous installed package when refresh input is error", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-store-"));
	upsertPiPackage({
		id: "refresh-package",
		name: "refresh-package",
		source: "/tmp/refresh-package",
		installSpec: "/tmp/refresh-package",
		version: "1.0.0",
		resourceTypes: ["extension"],
		installStatus: "installed",
		installPath: "/tmp/refresh-package-installed",
		enabled: true,
		diagnostics: [{ type: "info", message: "previous install ok" }],
		addedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	}, cwd);

	const refreshed = upsertPiPackage({
		id: "refresh-package",
		name: "refresh-package",
		source: "/tmp/refresh-package",
		installSpec: "/tmp/refresh-package",
		version: "2.0.0",
		resourceTypes: ["skill"],
		installStatus: "error",
		enabled: true,
		diagnostics: [{ type: "error", message: "refresh failed" }],
	}, cwd);

	assert.equal(refreshed.installStatus, "installed");
	assert.equal(refreshed.installPath, "/tmp/refresh-package-installed");
	assert.equal(refreshed.version, "1.0.0");
	assert.deepEqual(refreshed.resourceTypes, ["extension"]);
	assert.equal(refreshed.addedAt, "2026-01-01T00:00:00.000Z");
	assert.notEqual(refreshed.updatedAt, "2026-01-01T00:00:00.000Z");
	assert.deepEqual(refreshed.diagnostics, [
		{ type: "info", message: "previous install ok" },
		{ type: "warning", message: "Latest package refresh failed; keeping previous installed record for refresh-package." },
		{ type: "error", message: "refresh failed" },
	]);
	assert.deepEqual(findPiPackage("refresh-package", cwd), refreshed);
});

test("pi package runtime bridge only loads selected registered packages", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-runtime-"));
	const packageDir = join(cwd, "local-package");
	mkdirSync(packageDir, { recursive: true });
	upsertPiPackage({
		id: "local-package",
		name: "local-package",
		source: packageDir,
		installSpec: packageDir,
		resourceTypes: ["extension"],
		installStatus: "installed",
		installPath: packageDir,
		enabled: true,
		diagnostics: [],
	}, cwd);
	const selectedProfile = new InitialSessionContextBuilder("selected")
		.withPiPackages([{ id: "local-package" }])
		.createSession();
	const emptyProfile = new InitialSessionContextBuilder("empty").createSession();

	assert.deepEqual(getPiPackageRuntimeOptions(cwd, selectedProfile).resourceLoaderOptions.additionalExtensionPaths, [packageDir]);
	assert.deepEqual(getPiPackageRuntimeOptions(cwd, emptyProfile).resourceLoaderOptions.additionalExtensionPaths, []);
	assert.equal(getPiPackageRuntimeOptions(cwd, new InitialSessionContextBuilder("missing").withPiPackages([{ id: "missing" }]).createSession()).diagnostics[0].type, "error");
});

test("pi package store defaults legacy packages to enabled and can disable them", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-store-"));
	mkdirSync(join(cwd, ".pibo"), { recursive: true });
	writeFileSync(join(cwd, ".pibo", "pi-packages.json"), JSON.stringify({
		version: 1,
		packages: [{
			id: "legacy-package",
			name: "legacy-package",
			source: "/tmp/legacy-package",
			installSpec: "/tmp/legacy-package",
			resourceTypes: ["extension"],
			installed: true,
			diagnostics: [],
		}],
	}), "utf-8");

	assert.equal(findPiPackage("legacy-package", cwd)?.enabled, true);
	assert.equal(findPiPackage("legacy-package", cwd)?.installStatus, "installed");
	assert.equal(setPiPackageEnabled("legacy-package", false, cwd)?.enabled, false);
	assert.equal(findPiPackage("legacy-package", cwd)?.enabled, false);
});

test("pi package runtime skips globally disabled selected packages", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-runtime-"));
	const packageDir = join(cwd, "disabled-package");
	mkdirSync(packageDir, { recursive: true });
	upsertPiPackage({
		id: "disabled-package",
		name: "disabled-package",
		source: packageDir,
		installSpec: packageDir,
		resourceTypes: ["extension"],
		installStatus: "installed",
		installPath: packageDir,
		enabled: false,
		diagnostics: [],
	}, cwd);

	const profile = new InitialSessionContextBuilder("disabled")
		.withPiPackages([{ id: "disabled-package" }])
		.createSession();
	const options = getPiPackageRuntimeOptions(cwd, profile);

	assert.deepEqual(options.resourceLoaderOptions.additionalExtensionPaths, []);
	assert.match(options.diagnostics[0].message, /globally disabled/);
	assert.equal(options.diagnostics[0].type, "warning");
});

test("pibo pi-packages CLI provides progressive help and local add/list/remove", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-pi-package-cli-"));
	const packageDir = join(cwd, "local-package");
	mkdirSync(join(packageDir, "extensions"), { recursive: true });
	writeFileSync(join(packageDir, "extensions", "demo.js"), "export default {}\n", "utf-8");
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({
		name: "local-cli-package",
		pi: { extensions: ["extensions/*.js"] },
	}), "utf-8");

	const help = await execFileAsync("node", [cliPath, "pi-packages", "--help"], { cwd });
	assert.match(help.stdout, /Commands:/);
	assert.doesNotMatch(help.stdout, /Store File/);

	const added = await execFileAsync("node", [cliPath, "pi-packages", "add", packageDir], { cwd });
	assert.match(added.stdout, /Added Pi package local-cli-package/);
	assert.match(added.stdout, /status: installed/);

	const listed = await execFileAsync("node", [cliPath, "pi-packages", "list"], { cwd });
	assert.match(listed.stdout, /local-cli-package\s+installed/);

	const inspected = await execFileAsync("node", [cliPath, "pi-packages", "inspect", "local-cli-package"], { cwd });
	assert.match(inspected.stdout, /"installStatus": "installed"/);

	const removed = await execFileAsync("node", [cliPath, "pi-packages", "remove", "local-cli-package"], { cwd });
	assert.match(removed.stdout, /Removed Pi package local-cli-package/);
});
