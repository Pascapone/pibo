import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureDeploymentArtifact } from "../dist/compute/pool/artifacts.js";
import { standardPluginCoordinates } from "../dist/plugins/default-packages.js";

const expectedPluginCount = standardPluginCoordinates().length;

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

async function npmPack(directory, destination) {
	const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination, directory], { maxBuffer: 32 * 1024 * 1024 });
	return join(destination, JSON.parse(stdout)[0].filename);
}

async function freePort() {
	const server = createServer();
	await new Promise((resolvePromise, reject) => server.listen(0, "127.0.0.1", resolvePromise).once("error", reject));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : undefined;
	await new Promise((resolvePromise) => server.close(resolvePromise));
	if (!port) throw new Error("Unable to reserve a local port");
	return port;
}

async function waitForHttp(url, processState, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (processState.exitCode !== null) throw new Error(`Gateway exited before ${url} became ready`);
		try {
			const response = await fetch(url);
			if (response.ok) return response;
		} catch {}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise((resolvePromise) => child.once("exit", resolvePromise)),
		new Promise((_, reject) => setTimeout(() => reject(new Error("Gateway did not stop after SIGTERM")), 10_000)),
	]);
}

async function recursiveFiles(root) {
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...await recursiveFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function packAllPibo4Packages(destination) {
	const packageSet = JSON.parse(await readFile("dist/pibo4-artifacts/standard-package-set.json", "utf8"));
	const packages = [
		resolve("dist/pibo4-core-package"),
		resolve("dist/pibo4-cutover-package"),
		...packageSet.plugins.map((entry) => resolve("dist/pibo4-artifacts", entry.package.slice("@pasko70/pibo-plugin-".length))),
		resolve("dist/pibo4-standard-package"),
	];
	assert.equal(packages.length, packageSet.plugins.length + 3);
	const packed = [];
	for (const directory of packages) {
		packed.push({
			directory,
			tarball: await npmPack(directory, destination),
			pkg: JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
		});
	}
	return packed;
}

test("packed Minimal-Core installs offline and runs its real CLI, Gateway, Chat, and five Core views", { timeout: 120_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-executable-core-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const project = join(root, "consumer");
	const home = join(root, "home");
	await Promise.all([tarballs, project, home].map((path) => execFileAsync("mkdir", ["-p", path])));
	const coreTarball = await npmPack(resolve("dist/pibo4-core-package"), tarballs);
	await writeFile(join(project, "package.json"), `${JSON.stringify({ name: "pibo4-executable-core-consumer", private: true })}\n`);
	await execFileAsync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", coreTarball], { cwd: project, maxBuffer: 32 * 1024 * 1024 });

	const packageRoot = join(project, "node_modules/@pasko70/pibo");
	const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(packageJson.bin, { pibo: "./dist/bin/pibo.js" });
	assert.equal(packageJson.dependencies, undefined);
	assert.equal((await lstat(join(packageRoot, "dist/bin/pibo.js"))).isFile(), true);
	assert.equal((await lstat(join(project, "node_modules/.bin/pibo"))).isSymbolicLink(), true);
	const cliPath = join(project, "node_modules/.bin/pibo");
	const cliEnv = { ...process.env, HOME: home, PIBO_HOME: home };
	const version = await execFileAsync(cliPath, ["--version"], { cwd: project, env: cliEnv });
	assert.equal(version.stdout.trim(), "4.0.0-beta.1");
	const rootHelp = await execFileAsync(cliPath, ["--help"], { cwd: project, env: cliEnv });
	assert.match(rootHelp.stdout, /Pibo Minimal Core/);
	assert.match(rootHelp.stdout, /gateway:web/);
	const gatewayHelp = await execFileAsync(cliPath, ["gateway:web", "--help"], { cwd: project, env: cliEnv });
	assert.match(gatewayHelp.stdout, /plugin-free Web Gateway and Chat app/);

	const webPort = await freePort();
	const gatewayPort = await freePort();
	let stderr = "";
	const gateway = spawn(join(project, "node_modules/.bin/pibo"), ["gateway:web", "--auth=local", "--web-host=127.0.0.1", `--web-port=${webPort}`, `--gateway-port=${gatewayPort}`], {
		cwd: project,
		env: { ...process.env, HOME: home, PIBO_HOME: home, PIBO_GATEWAY_MODE: "dev" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	gateway.stderr.setEncoding("utf8");
	gateway.stderr.on("data", (chunk) => { stderr += chunk; });
	t.after(() => stopProcess(gateway).catch(() => {}));
	const health = await waitForHttp(`http://127.0.0.1:${webPort}/health`, gateway);
	assert.deepEqual(await health.json(), { status: "ok", mode: "main" });
	const chat = await fetch(`http://127.0.0.1:${webPort}/apps/chat`);
	assert.equal(chat.status, 200);
	assert.match(chat.headers.get("content-type") ?? "", /text\/html/);
	assert.match(await chat.text(), /<div id="root"><\/div>/);
	const bootstrap = await fetch(`http://127.0.0.1:${webPort}/api/chat/bootstrap`);
	assert.equal(bootstrap.status, 200);
	const bootstrapPayload = await bootstrap.json();
	assert.deepEqual(bootstrapPayload.modelCatalog.providers, []);
	assert.equal(bootstrapPayload.session.profile, "core");
	assert.equal(bootstrapPayload.session.piSessionId, "");
	assert.equal(bootstrapPayload.session.runtimeBinding.runtimeInstanceId, "pibo.runtime-unassigned");
	assert.equal(bootstrapPayload.session.runtimeBinding.adapterId, "unassigned");
	assert.equal(bootstrapPayload.session.runtimeBinding.nativeSessionId, undefined);
	const agentCatalog = await fetch(`http://127.0.0.1:${webPort}/api/chat/agent-catalog`);
	assert.equal(agentCatalog.status, 200);
	const agentCatalogPayload = await agentCatalog.json();
	assert.deepEqual(agentCatalogPayload.catalog.skills, []);
	assert.deepEqual(agentCatalogPayload.catalog.skills.map((skill) => skill.name), []);
	const sessionPlan = await fetch(`http://127.0.0.1:${webPort}/api/chat/sessions/${bootstrapPayload.session.id}/plugin-plan`);
	assert.equal(sessionPlan.status, 200);
	const sessionPlanPayload = await sessionPlan.json();
	assert.equal(sessionPlanPayload.plan.valid, true);
	assert.deepEqual(sessionPlanPayload.plan.plugins, []);
	assert.deepEqual(sessionPlanPayload.plan.contributions, []);
	assert.equal(sessionPlanPayload.plan.diagnostics.some((diagnostic) => diagnostic.code === "runtime-unassigned" && diagnostic.severity === "warning"), true);
	const agentPreview = await fetch(`http://127.0.0.1:${webPort}/api/chat/agent-plugin-preview`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: `http://127.0.0.1:${webPort}` },
		body: JSON.stringify({
			schemaVersion: 2,
			expectedRevision: 0,
			runtimeInstanceId: "pibo.runtime-unassigned",
			pluginSelection: { schemaVersion: 1, plugins: [] },
			skills: [],
			contextFiles: [],
			subagents: [],
			builtinTools: "disabled",
			builtinToolNames: [],
		}),
	});
	assert.equal(agentPreview.status, 200);
	const agentPreviewPayload = await agentPreview.json();
	assert.equal(agentPreviewPayload.plan.valid, true);
	assert.deepEqual(agentPreviewPayload.plan.plugins, []);
	assert.deepEqual(agentPreviewPayload.plan.contributions, []);
	assert.equal(agentPreviewPayload.plan.diagnostics.some((diagnostic) => diagnostic.code === "runtime-unassigned" && diagnostic.severity === "warning"), true);
	assert.match(stderr, /pibo chat app available/);
	assert.doesNotMatch(stderr, /storage_worker_failed|Cannot find module|activation did not complete/);
	await stopProcess(gateway);

	const assets = await recursiveFiles(join(packageRoot, "dist/apps/chat-ui/assets"));
	assert.equal(assets.some((path) => basename(path).startsWith("pibo-plugin-")), false);
	const browserSource = (await Promise.all(assets.filter((path) => path.endsWith(".js")).map((path) => readFile(path, "utf8")))).join("\n");
	for (const title of ["Settings", "Agent Designer", "Context", "Raw Events", "Session Inspector"]) assert.match(browserSource, new RegExp(title));

	const dataPath = join(home, "pibo.sqlite");
	assert.equal(existsSync(dataPath), true);
	const db = new DatabaseSync(dataPath);
	try {
		const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_installations'").get();
		assert.ok(table);
		assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plugin_installations").get().count, 0);
	} finally {
		db.close();
	}
});

test("Minimal-Core physical closure excludes runtime, feature-tool, and first-party feature-view delivery", async () => {
	const packageRoot = resolve("dist/pibo4-core-package");
	const meta = JSON.parse(await readFile("dist/pibo4-core-executable.metafile.json", "utf8"));
	const inputs = [meta.executable, ...meta.workers].flatMap((entry) => Object.keys(entry.inputs)).map((path) => path.replaceAll("\\", "/"));
	const forbiddenInputs = [
		"src/agent-runtimes/",
		"src/plugins/packaged-",
		"src/loops/",
		"src/cron/",
		"src/web-annotations/",
		"src/runs/tools.ts",
		"src/tools/browser-pool.ts",
		"src/tools/codex-",
		"src/resources/lifecycle.ts",
	];
	for (const fragment of forbiddenInputs) assert.equal(inputs.some((path) => path.includes(fragment)), false, fragment);
	const files = await recursiveFiles(packageRoot);
	assert.equal(files.some((path) => basename(path).startsWith("pibo-plugin-")), false);
	assert.equal(files.some((path) => basename(path).startsWith("first-party-subview-")), false);
	assert.equal(files.some((path) => path.endsWith("/backend.mjs") || path.endsWith("/browser.mjs") || path.endsWith("/pibo.plugin.json")), false);
	const executableSource = (await Promise.all(files.filter((path) => path.endsWith(".js") && !path.includes("/dist/apps/")).map((path) => readFile(path, "utf8")))).join("\n");
	for (const token of ["PI_AGENT_RUNTIME_DRIVER", "CODEX_NATIVE_AGENT_RUNTIME_DRIVER", "MUSE_NATIVE_AGENT_RUNTIME_DRIVER", "OMP_AGENT_RUNTIME_DRIVER", "createPiboGoalToolDefinitions", "formatPiboRunReminderMessage", "CodexBrowserSessionController", "saveCodexGeneratedImage", "preparePibo4Cutover"]) {
		assert.equal(executableSource.includes(token), false, token);
	}
	const genericCompositionSource = `${await readFile(join(packageRoot, "plugin-cutover.js"), "utf8")}\n${await readFile(join(packageRoot, "product-runtime.js"), "utf8")}`;
	const packageSet = JSON.parse(await readFile("dist/pibo4-artifacts/standard-package-set.json", "utf8"));
	for (const identity of ["pibo.product-ui", "pibo.web-product", "pibo.user-resources", "pibo.core", ...packageSet.plugins.flatMap((entry) => [entry.package, entry.pluginId])]) {
		assert.equal(genericCompositionSource.includes(JSON.stringify(identity)), false, identity);
	}
});

test("all Pibo 4 tarballs install together offline and Standard resolves its exact package set", { timeout: 180_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-offline-package-set-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const project = join(root, "consumer");
	await Promise.all([tarballs, project].map((path) => execFileAsync("mkdir", ["-p", path])));
	const packages = await packAllPibo4Packages(tarballs);
	const dependencies = Object.fromEntries(packages.map(({ pkg, tarball }) => [pkg.name, `file:${tarball}`]));
	const codexPackage = dirname(require.resolve("@openai/codex/package.json"));
	const codexPlatformPackageName = process.platform === "linux" && process.arch === "x64" ? "@openai/codex-linux-x64"
		: process.platform === "linux" && process.arch === "arm64" ? "@openai/codex-linux-arm64"
			: process.platform === "darwin" && process.arch === "x64" ? "@openai/codex-darwin-x64"
				: process.platform === "darwin" && process.arch === "arm64" ? "@openai/codex-darwin-arm64"
					: process.platform === "win32" && process.arch === "x64" ? "@openai/codex-win32-x64"
						: process.platform === "win32" && process.arch === "arm64" ? "@openai/codex-win32-arm64"
							: undefined;
	assert.ok(codexPlatformPackageName, "Codex Native package test requires a supported build platform");
	dependencies["@openai/codex"] = `file:${await npmPack(codexPackage, tarballs)}`;
	dependencies[codexPlatformPackageName] = `file:${await npmPack(dirname(require.resolve(`${codexPlatformPackageName}/package.json`)), tarballs)}`;
	await writeFile(join(project, "package.json"), `${JSON.stringify({ name: "pibo4-offline-package-set", private: true, type: "module", dependencies }, null, 2)}\n`);
	await execFileAsync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: project, maxBuffer: 32 * 1024 * 1024 });
	for (const { pkg } of packages) {
		const installed = JSON.parse(await readFile(join(project, "node_modules", ...pkg.name.split("/"), "package.json"), "utf8"));
		assert.equal(installed.version, pkg.version, pkg.name);
	}
	const imported = await execFileAsync(process.execPath, ["--input-type=module", "--eval", "import { packageSet } from '@pasko70/pibo-standard'; console.log(JSON.stringify(packageSet));"], { cwd: project });
	const packageSet = JSON.parse(imported.stdout);
	assert.equal(packageSet.plugins.length, expectedPluginCount);
	for (const entry of packageSet.plugins) {
		const installed = JSON.parse(await readFile(join(project, "node_modules", ...entry.package.split("/"), "package.json"), "utf8"));
		assert.equal(installed.version, entry.version);
	}
});

test("packed Standard installs alone offline and starts exactly its declared plugin packages", { timeout: 180_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-executable-standard-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const project = join(root, "consumer");
	const home = join(root, "home");
	await Promise.all([tarballs, project, home].map((path) => execFileAsync("mkdir", ["-p", path])));
	const standardTarball = await npmPack(resolve("dist/pibo4-standard-package"), tarballs);
	await writeFile(join(project, "package.json"), `${JSON.stringify({ name: "pibo4-executable-standard-consumer", private: true })}\n`);
	await execFileAsync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", standardTarball], { cwd: project, maxBuffer: 64 * 1024 * 1024 });

	const standardRoot = join(project, "node_modules/@pasko70/pibo-standard");
	const standardPackage = JSON.parse(await readFile(join(standardRoot, "package.json"), "utf8"));
	assert.deepEqual(standardPackage.bin, { pibo: "./bin/pibo.js", "pibo-standard": "./bin/pibo.js" });
	assert.equal((await lstat(join(project, "node_modules/.bin/pibo"))).isSymbolicLink(), true);
	const packageSet = JSON.parse(await readFile(join(standardRoot, "package-set.json"), "utf8"));
	assert.equal(packageSet.plugins.length, expectedPluginCount);
	for (const entry of packageSet.plugins) {
		const installed = JSON.parse(await readFile(join(standardRoot, "node_modules", ...entry.package.split("/"), "package.json"), "utf8"));
		assert.equal(installed.version, entry.version, entry.package);
	}

	const cliPath = join(project, "node_modules/.bin/pibo");
	const cliEnv = { ...process.env, HOME: home, PIBO_HOME: home };
	const rootHelp = await execFileAsync(cliPath, ["--help"], { cwd: project, env: cliEnv });
	assert.match(rootHelp.stdout, /Pibo Standard/);
	assert.match(rootHelp.stdout, new RegExp(`${packageSet.plugins.length} plugin packages`));
	const webPort = await freePort();
	const gatewayPort = await freePort();
	let stderr = "";
	const gateway = spawn(cliPath, ["gateway:web", "--auth=local", "--web-host=127.0.0.1", `--web-port=${webPort}`, `--gateway-port=${gatewayPort}`], {
		cwd: project,
		env: { ...cliEnv, PIBO_GATEWAY_MODE: "dev" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	gateway.stderr.setEncoding("utf8");
	gateway.stderr.on("data", (chunk) => { stderr += chunk; });
	t.after(() => stopProcess(gateway).catch(() => {}));
	await waitForHttp(`http://127.0.0.1:${webPort}/health`, gateway, 60_000);
	const bootstrap = await fetch(`http://127.0.0.1:${webPort}/api/chat/bootstrap`);
	assert.equal(bootstrap.status, 200);
	const bootstrapPayload = await bootstrap.json();
	assert.equal(bootstrapPayload.session.profile, "base");
	assert.equal(bootstrapPayload.session.runtimeBinding.runtimeInstanceId, "pi");
	const installationsResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat/plugins`);
	assert.equal(installationsResponse.status, 200);
	const installations = (await installationsResponse.json()).installations;
	assert.equal(installations.length, packageSet.plugins.length);
	assert.deepEqual(new Set(installations.map((entry) => entry.pluginId)), new Set(packageSet.plugins.map((entry) => entry.pluginId)));
	assert.equal(installations.every((entry) => entry.enabled && entry.state === "active"), true);
	const catalogResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat/agent-catalog`);
	assert.equal(catalogResponse.status, 200);
	const catalog = (await catalogResponse.json()).catalog;
	assert.equal(catalog.skills.find((skill) => skill.name === "pi-agent-harness")?.pluginId, "pibo.builtin-profiles");
	assert.equal(catalog.skills.find((skill) => skill.name === "pibo-docker-system")?.pluginId, "pibo.builtin-profiles");
	assert.equal(catalog.skills.every((skill) => skill.pluginId !== undefined && existsSync(skill.path)), true);
	assert.doesNotMatch(stderr, /Cannot find module|activation did not complete|Plugin artifact has no staged root/);
	await stopProcess(gateway);

	const restarted = spawn(cliPath, ["gateway:web", "--auth=local", "--web-host=127.0.0.1", `--web-port=${webPort}`, `--gateway-port=${gatewayPort}`], {
		cwd: project,
		env: { ...cliEnv, PIBO_GATEWAY_MODE: "dev" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	t.after(() => stopProcess(restarted).catch(() => {}));
	await waitForHttp(`http://127.0.0.1:${webPort}/health`, restarted, 60_000);
	const restartedInstallations = (await (await fetch(`http://127.0.0.1:${webPort}/api/chat/plugins`)).json()).installations;
	assert.equal(restartedInstallations.length, packageSet.plugins.length);
	assert.equal(restartedInstallations.every((entry) => entry.enabled && entry.state === "active"), true);
	await stopProcess(restarted);
});

test("content-addressed Candidate installer accepts and reuses the executable Standard tarball offline", { timeout: 180_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-candidate-installer-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	await execFileAsync("mkdir", ["-p", tarballs]);
	const standardTarball = await npmPack(resolve("dist/pibo4-standard-package"), tarballs);
	const previousOffline = process.env.npm_config_offline;
	process.env.npm_config_offline = "true";
	t.after(() => {
		if (previousOffline === undefined) delete process.env.npm_config_offline;
		else process.env.npm_config_offline = previousOffline;
	});
	const config = { artifactRoot: join(root, "artifacts") };
	const first = await ensureDeploymentArtifact({ config, archivePath: standardTarball });
	assert.equal(first.reused, false);
	assert.equal(first.packageVersion, "4.0.0-beta.1");
	assert.equal(first.runtimePath, join(config.artifactRoot, first.sha256, "runtime"));
	assert.equal(first.binaryPath, join(first.runtimePath, "node_modules/@pasko70/pibo-standard/bin/pibo.js"));
	assert.equal(existsSync(first.binaryPath), true);
	const version = await execFileAsync(first.binaryPath, ["--version"], { env: { ...process.env, HOME: join(root, "home"), PIBO_HOME: join(root, "home") } });
	assert.equal(version.stdout.trim(), "4.0.0-beta.1");
	const second = await ensureDeploymentArtifact({ config, archivePath: standardTarball });
	assert.equal(second.reused, true);
	assert.equal(second.sha256, first.sha256);
	assert.equal(second.binaryPath, first.binaryPath);
});

test("deployment-pool artifact upload packs the generated Candidate assembly rather than Core, Standard alone, or the private repository root", async () => {
	const script = await readFile("scripts/deployment-pool-remote.sh", "utf8");
	assert.match(script, /npm run pibo4:packages/);
	assert.match(script, /npm pack --ignore-scripts --pack-destination "\$tmp_dir" \.\/dist\/pibo4-candidate-assembly/);
	assert.doesNotMatch(script, /npm pack --ignore-scripts --pack-destination "\$tmp_dir" \.\/dist\/pibo4-(?:core|standard)-package/);
	assert.doesNotMatch(script, /npm pack --pack-destination "\$tmp_dir"\s*>/);
});
