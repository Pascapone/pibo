import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function npmPack(directory, destination) {
	const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd: directory, maxBuffer: 16 * 1024 * 1024 });
	return join(destination, JSON.parse(stdout)[0].filename);
}

async function runNode(cwd, source, env = {}) {
	return execFileAsync(process.execPath, ["--input-type=module", "--eval", source], { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });
}

test("packed Minimal-Core starts with zero plugins and installs one independently packed feature", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-packed-distribution-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const project = join(root, "consumer");
	await execFileAsync("mkdir", ["-p", tarballs, project]);
	const coreTarball = await npmPack(resolve("dist/pibo4-core-package"), tarballs);
	const previewTarball = await npmPack(resolve("dist/pibo4-artifacts/preview"), tarballs);
	await writeFile(join(project, "package.json"), `${JSON.stringify({ name: "pibo4-packed-consumer", private: true, type: "module" })}\n`);
	await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", coreTarball], { cwd: project, maxBuffer: 16 * 1024 * 1024 });

	const home = join(root, "home");
	const artifactRoot = join(home, "plugins", "artifacts");
	const script = `
		import assert from "node:assert/strict";
		import { PluginHost, startPluginProductRuntime } from "@pasko70/pibo";
		const host = new PluginHost();
		const product = await startPluginProductRuntime({ host, artifactRoot: ${JSON.stringify(artifactRoot)}, installDefaultPlugins: false, collectConsumers: async () => [] });
		assert.deepEqual(host.inspect().plugins, []);
		assert.equal(host.inspect().state, "active");
		const inspected = await product.manager.inspect({ kind: "package", path: ${JSON.stringify(previewTarball)}, name: "@pasko70/pibo-plugin-preview", version: "1.0.0" });
		assert.equal(inspected.manifest.id, "pibo.preview");
		await product.manager.install({ kind: "package", path: ${JSON.stringify(previewTarball)}, name: "@pasko70/pibo-plugin-preview", version: "1.0.0" }, { expectedRevision: 0 });
		const installed = product.manager.store.getInstallation("pibo.preview");
		assert.equal(installed.source.kind, "package");
		const activation = await product.manager.activate("pibo.preview", { expectedRevision: installed.stateRevision });
		assert.equal(activation.state, "complete");
		assert.equal(host.inspect().plugins.map((entry) => entry.pluginId).join(","), "pibo.preview");
		assert.equal(host.contributions.get("contribution", "pibo.preview/view").contribution.view.exportName, "PreviewView");
		await product.dispose();
	`;
	await runNode(project, script, { PIBO_HOME: home });

	const corePackage = JSON.parse(await readFile(join(project, "node_modules/@pasko70/pibo/package.json"), "utf8"));
	assert.deepEqual(Object.keys(corePackage.exports).sort(), [".", "./executable-cli", "./package.json", "./plugin-cutover", "./plugin-host", "./plugin-runtime", "./plugin-sdk", "./product-runtime"].sort());
	assert.equal(corePackage.dependencies, undefined);
	const previewPackage = JSON.parse(await readFile(join("dist/pibo4-artifacts/preview/package.json"), "utf8"));
	assert.equal(previewPackage.name, "@pasko70/pibo-plugin-preview");
	assert.ok((await readFile(join("dist/pibo4-artifacts/preview/browser/index.js"), "utf8")).includes("__PIBO_BROWSER_PLUGIN_BRIDGE__"));
});

test("packed Minimal-Core public library exports exclude runtime, Run, and Delegation implementations", async () => {
	const files = ["index.js", "plugin-cutover.js", "plugin-host.js", "plugin-runtime.js", "plugin-sdk.js", "product-runtime.js"];
	const forbidden = [
		"PI_AGENT_RUNTIME_DRIVER",
		"CODEX_NATIVE_AGENT_RUNTIME_DRIVER",
		"OMP_AGENT_RUNTIME_DRIVER",
		"pibo_agents_",
		"createPiboDelegationController",
		"formatPiboRunReminderMessage",
		"CodexBrowserSessionController",
	];
	for (const file of files) {
		const source = await readFile(join("dist/pibo4-core-package", file), "utf8");
		for (const token of forbidden) assert.equal(source.includes(token), false, `${file} must exclude ${token}`);
	}
});

test("every first-party artifact independently packs with exact identity and self-contained backend", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-independent-packs-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const set = JSON.parse(await readFile("dist/pibo4-artifacts/standard-package-set.json", "utf8"));
	for (const entry of set.plugins) {
		const suffix = entry.package.slice("@pasko70/pibo-plugin-".length);
		const directory = resolve("dist/pibo4-artifacts", suffix);
		const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
		const manifest = JSON.parse(await readFile(join(directory, "pibo.plugin.json"), "utf8"));
		assert.equal(pkg.name, entry.package);
		assert.equal(pkg.version, entry.version);
		assert.equal(manifest.id, entry.pluginId);
		assert.equal(manifest.version, entry.version);
		if (suffix === "runtime-codex-native") {
			assert.deepEqual(pkg.dependencies, { "@openai/codex": "0.153.2" });
		} else {
			assert.equal(pkg.dependencies, undefined);
		}
		assert.ok((await readFile(join(directory, "backend.mjs"), "utf8")).length > 100);
		const tarball = await npmPack(directory, root);
		assert.ok(basename(tarball).endsWith(".tgz"));
	}
});

test("packed Pi runtime derives OpenAI Codex OAuth from a clean installed artifact", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-packed-pi-oauth-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const consumer = join(root, "consumer");
	const piHome = join(root, "pi-agent");
	await mkdir(tarballs, { recursive: true });
	await mkdir(consumer, { recursive: true });
	await mkdir(piHome, { recursive: true });
	await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "clean-pi-runtime-consumer", private: true, type: "module" }));
	const tarball = await npmPack(resolve("dist/pibo4-artifacts/runtime-pi"), tarballs);
	await execFileAsync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: consumer, env: { ...process.env, npm_config_cache: join(root, "npm-cache") }, maxBuffer: 16 * 1024 * 1024 });
	await writeFile(join(piHome, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "packed-access-token", refresh: "packed-refresh-token", expires: Date.now() + 24 * 60 * 60_000, accountId: "acct-packed" } }));
	const { stdout, stderr } = await runNode(consumer, `
		const backend = await import("@pasko70/pibo-plugin-runtime-pi/backend.mjs");
		let driver;
		backend.setup({ register(name, value) { if (name === "driver") driver = value; } });
		if (driver?.descriptor?.id !== "pi") throw new Error("Packed Pi adapter setup did not register its real driver");
		const auth = await backend.derivePackagedPiProviderAuth("openai-codex");
		if (auth?.auth?.apiKey !== "packed-access-token") throw new Error("Packed OAuth derivation did not return the retained access token");
		console.log("PACKED_PI_OAUTH_OK");
	`, { PI_CODING_AGENT_DIR: piHome, HOME: join(root, "clean-home") });
	assert.match(stdout, /PACKED_PI_OAUTH_OK/);
	assert.equal(stderr, "");
});

test("standard artifact set maps every package to one exact plugin id and version", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-standard-pack-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const set = JSON.parse(await readFile("dist/pibo4-artifacts/standard-package-set.json", "utf8"));
	assert.equal(set.schemaVersion, 1);
	assert.equal(set.core, "@pasko70/pibo");
	assert.equal(set.standard, "@pasko70/pibo-standard");
	assert.equal(set.plugins.length, 20);
	assert.equal(new Set(set.plugins.map((entry) => entry.pluginId)).size, set.plugins.length);
	assert.ok(set.plugins.every((entry) => entry.version === "1.0.0" && entry.package.startsWith("@pasko70/pibo-plugin-")));
	const standardPackage = JSON.parse(await readFile("dist/pibo4-standard-package/package.json", "utf8"));
	assert.equal(standardPackage.name, "@pasko70/pibo-standard");
	assert.deepEqual(standardPackage.bin, { pibo: "./bin/pibo.js", "pibo-standard": "./bin/pibo.js" });
	assert.equal(standardPackage.dependencies["@pasko70/pibo"], "4.0.0-beta.1");
	assert.deepEqual(
		new Set(standardPackage.bundledDependencies),
		new Set([...Object.keys(standardPackage.dependencies), ...Object.keys(standardPackage.optionalDependencies)]),
	);
	for (const entry of set.plugins) {
		assert.equal(standardPackage.dependencies[entry.package], entry.version);
		assert.equal(existsSync(join("dist/pibo4-standard-package/node_modules", ...entry.package.split("/"), "pibo.plugin.json")), true);
	}
	assert.equal(
		existsSync(join("dist/pibo4-standard-package/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host")),
		true,
		"Pibo Standard must bundle the Codex Code Mode host with Codex Native",
	);
	const standardTarball = await npmPack(resolve("dist/pibo4-standard-package"), root);
	const cutoverTarball = await npmPack(resolve("dist/pibo4-cutover-package"), root);
	assert.match(basename(standardTarball), /^pasko70-pibo-standard-/);
	assert.match(basename(cutoverTarball), /^pasko70-pibo-cutover-/);
});
