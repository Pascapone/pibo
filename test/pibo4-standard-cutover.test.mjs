import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ensureDeploymentArtifact } from "../dist/compute/pool/artifacts.js";
import { PluginManager } from "../dist/plugins/manager.js";

const execFileAsync = promisify(execFile);

async function npmPack(directory, destination) {
	const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination, directory], { maxBuffer: 64 * 1024 * 1024 });
	return join(destination, JSON.parse(stdout)[0].filename);
}

async function sha256(path) {
	return createHash("sha256").update(await readFile(path)).digest("hex");
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

async function waitForHttp(url, child, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Gateway exited before ${url} became ready`);
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

async function stageLegacyInstallation(data, artifactRoot, pluginId, state) {
	const source = join(artifactRoot, "legacy-sources", pluginId);
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "pibo.plugin.json"), `${JSON.stringify({
		schemaVersion: 1,
		id: pluginId,
		name: `Retained legacy ${pluginId}`,
		version: "3.6.2",
		sdk: "^1.0.0",
		entrypoints: {},
		contributions: [],
	})}\n`);
	const manager = new PluginManager({ store: data.plugins, artifactRoot });
	const installed = await manager.install({ kind: "local", path: source }, { expectedRevision: 0 });
	return data.plugins.putInstallation({
		...installed.installation,
		source: { kind: "builtin", name: pluginId },
		enabled: state === "active",
		state,
		updatedAt: new Date().toISOString(),
	}, installed.installation.stateRevision);
}

function selectedState(installations, pluginId) {
	const installation = installations.find((entry) => entry.pluginId === pluginId);
	assert.ok(installation, pluginId);
	return { state: installation.state, enabled: installation.enabled, stateRevision: installation.stateRevision, contentHash: installation.contentHash };
}

test("packed Candidate Standard applies prepared aggregate cutover through its real CLI/Gateway and restarts idempotently", { timeout: 300_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-standard-cutover-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packed = join(root, "packed");
	const preparation = join(root, "preparation");
	const home = join(root, "home");
	await Promise.all([packed, preparation, home].map((path) => mkdir(path, { recursive: true })));

	const assemblyArchive = await npmPack(resolve("dist/pibo4-candidate-assembly"), packed);
	const expectedAssemblySha256 = await sha256(assemblyArchive);
	const previousEnvironment = {
		offline: process.env.npm_config_offline,
		cache: process.env.npm_config_cache,
		registry: process.env.npm_config_registry,
	};
	process.env.npm_config_offline = "true";
	process.env.npm_config_cache = join(root, "empty-npm-cache");
	process.env.npm_config_registry = "http://127.0.0.1:9";
	const deployment = await ensureDeploymentArtifact({ config: { artifactRoot: join(root, "artifacts") }, archivePath: assemblyArchive });
	if (previousEnvironment.offline === undefined) delete process.env.npm_config_offline; else process.env.npm_config_offline = previousEnvironment.offline;
	if (previousEnvironment.cache === undefined) delete process.env.npm_config_cache; else process.env.npm_config_cache = previousEnvironment.cache;
	if (previousEnvironment.registry === undefined) delete process.env.npm_config_registry; else process.env.npm_config_registry = previousEnvironment.registry;
	assert.equal(deployment.sha256, expectedAssemblySha256);
	assert.equal(deployment.reused, false);
	assert.equal(deployment.binaryPath, join(deployment.runtimePath, "node_modules/@pasko70/pibo-standard/bin/pibo.js"));

	const installedAssemblyRoot = join(deployment.runtimePath, ".pibo-candidate-assembly");
	const assemblyManifest = JSON.parse(await readFile(join(installedAssemblyRoot, "assembly-manifest.json"), "utf8"));
	assert.equal(assemblyManifest.artifacts.length, 23);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "plugin").length, 20);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "core").length, 1);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "cutover").length, 1);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "standard").length, 1);
	assert.deepEqual(assemblyManifest.cutover.command, ["node", "node_modules/@pasko70/pibo-cutover/bin/pibo4-cutover.js", "<prepare-input.json>"]);
	assert.equal(assemblyManifest.cutover.sourceArtifact, "external-retained");
	assert.deepEqual(assemblyManifest.application.cutoverCommand, ["node", "node_modules/@pasko70/pibo-standard/bin/pibo.js", "gateway:web", "--cutover-plan", "<prepared-plan.json>", "--web-host", "0.0.0.0", "--web-port", "4788", "--gateway-port", "4789"]);
	for (const artifact of assemblyManifest.artifacts) {
		const path = join(installedAssemblyRoot, artifact.file);
		assert.equal(await sha256(path), artifact.sha256, artifact.package);
	}

	const cutoverArtifact = assemblyManifest.artifacts.find((entry) => entry.role === "cutover");
	assert.ok(cutoverArtifact);
	const cutoverBinary = join(deployment.runtimePath, "node_modules/@pasko70/pibo-cutover/bin/pibo4-cutover.js");
	assert.equal(existsSync(cutoverBinary), true);
	const sourcePath = join(preparation, "pibo-1.7.2.tgz");
	await writeFile(sourcePath, "retained legacy pibo 1.7.2 package bytes\n");
	const packageSet = JSON.parse(await readFile(join(deployment.runtimePath, "node_modules/@pasko70/pibo-standard/package-set.json"), "utf8"));
	const targets = new Map(packageSet.plugins.map((entry) => [entry.pluginId, entry]));
	const targetPluginIds = ["pibo.preview", "pibo.workflows", "pibo.cron", "pibo.goal-control", "pibo.web-search"];
	const preparedArtifacts = {};
	for (const pluginId of targetPluginIds) {
		const coordinate = targets.get(pluginId);
		assert.ok(coordinate, pluginId);
		const artifact = assemblyManifest.artifacts.find((entry) => entry.package === coordinate.package);
		assert.ok(artifact, coordinate.package);
		const path = join(preparation, basename(artifact.file));
		await copyFile(join(installedAssemblyRoot, artifact.file), path);
		preparedArtifacts[pluginId] = { package: coordinate.package, version: coordinate.version, path };
	}
	const coreArtifact = assemblyManifest.artifacts.find((entry) => entry.role === "core");
	assert.ok(coreArtifact);
	const preparedCorePath = join(preparation, basename(coreArtifact.file));
	await copyFile(join(installedAssemblyRoot, coreArtifact.file), preparedCorePath);
	const planPath = join(home, "migration", "pibo4-cutover.json");
	const inputPath = join(root, "cutover-input.json");
	await writeFile(inputPath, `${JSON.stringify({
		source: { package: "@pasko70/pibo", version: "1.7.2", path: sourcePath },
		targetCore: { package: "@pasko70/pibo", version: coreArtifact.version, path: preparedCorePath },
		artifacts: preparedArtifacts,
		snapshot: { schemaVersion: 1, plugins: [
			{ pluginId: "pibo.standard-shell", state: "active" },
			{ pluginId: "pibo.core", state: "active", contributions: { core: true } },
			{ pluginId: "pibo.product-ui", state: "active", contributions: { workflows: true, cron: false, loops: false, "agent-designer": true, settings: true, "user-resources": true } },
			{ pluginId: "pibo.user-resources", state: "active", contributions: { resources: true } },
			{ pluginId: "pibo.web-product", state: "active", contributions: { "preview-app": true, "cron-channel": false } },
			{ pluginId: "pibo.web-search", state: "uninstalled" },
		] },
		outputPath: planPath,
	}, null, 2)}\n`);
	await execFileAsync(process.execPath, [cutoverBinary, inputPath], { cwd: deployment.runtimePath });
	await rm(preparation, { recursive: true, force: true });

	const data = new PiboDataStore(join(home, "pibo.sqlite"), { payloadRootDir: join(home, "payloads") });
	const pluginArtifactRoot = join(home, "plugins", "artifacts");
	for (const pluginId of ["pibo.standard-shell", "pibo.core", "pibo.product-ui", "pibo.user-resources", "pibo.web-product"]) await stageLegacyInstallation(data, pluginArtifactRoot, pluginId, "active");
	await stageLegacyInstallation(data, pluginArtifactRoot, "pibo.web-search", "uninstalled");
	const retainedAt = "2026-09-15T08:00:00.000Z";
	data.sessions.upsertSession({
		session: { id: "ps_retained_cutover", piSessionId: "pi_retained_cutover", channel: "chat", kind: "runtime", profile: "base", title: "Retained cutover session", metadata: { retained: true }, createdAt: retainedAt },
		roomId: "room_retained_cutover",
		status: "idle",
		firstMessagePreview: "Retained question",
		lastActivityAt: retainedAt,
	});
	data.messages.insertMessage({ id: "msg_retained_cutover", sessionId: "ps_retained_cutover", roomId: "room_retained_cutover", sequence: 1, role: "user", status: "complete", createdAt: retainedAt, completedAt: retainedAt, contentPreview: "Retained question" });
	data.close();

	const webPort = await freePort();
	const gatewayPort = await freePort();
	const gatewayArgs = [deployment.binaryPath, "gateway:web", `--cutover-plan=${planPath}`, "--auth=local", "--web-host=127.0.0.1", `--web-port=${webPort}`, `--gateway-port=${gatewayPort}`];
	const gatewayEnvironment = { ...process.env, HOME: home, PIBO_HOME: home, PIBO_GATEWAY_MODE: "dev" };
	const startGateway = () => spawn(process.execPath, gatewayArgs, { cwd: deployment.runtimePath, env: gatewayEnvironment, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	const gateway = startGateway();
	gateway.stderr.setEncoding("utf8");
	gateway.stderr.on("data", (chunk) => { stderr += chunk; });
	t.after(() => stopProcess(gateway).catch(() => {}));
	try {
		await waitForHttp(`http://127.0.0.1:${webPort}/health`, gateway);
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
	}
	const firstInstallationsResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat/plugins`);
	assert.equal(firstInstallationsResponse.status, 200);
	const firstInstallations = (await firstInstallationsResponse.json()).installations;
	const packagePluginIds = new Set(packageSet.plugins.map((entry) => entry.pluginId));
	assert.equal(firstInstallations.filter((entry) => packagePluginIds.has(entry.pluginId)).length, 20);
	assert.equal(selectedState(firstInstallations, "pibo.preview").state, "active");
	assert.equal(selectedState(firstInstallations, "pibo.workflows").state, "active");
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.cron").state, enabled: selectedState(firstInstallations, "pibo.cron").enabled }, { state: "installed", enabled: false });
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.goal-control").state, enabled: selectedState(firstInstallations, "pibo.goal-control").enabled }, { state: "installed", enabled: false });
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.web-search").state, enabled: selectedState(firstInstallations, "pibo.web-search").enabled }, { state: "uninstalled", enabled: false });
	for (const pluginId of ["pibo.standard-shell", "pibo.core", "pibo.product-ui", "pibo.user-resources", "pibo.web-product"]) {
		assert.equal(selectedState(firstInstallations, pluginId).state, "uninstalled");
	}
	assert.equal(firstInstallations.filter((entry) => packagePluginIds.has(entry.pluginId) && entry.state === "active" && entry.enabled).length, 17);
	assert.doesNotMatch(stderr, /cutover is required|artifact changed or is missing|activation did not complete|Cannot find module/);
	const receiptPath = `${planPath}.complete`;
	const receiptFirst = await readFile(receiptPath, "utf8");
	const receipt = JSON.parse(receiptFirst);
	assert.equal(receipt.targets.length, 5);
	assert.deepEqual(receipt.supersededOwners, ["pibo.core", "pibo.product-ui", "pibo.standard-shell", "pibo.user-resources", "pibo.web-product"]);
	assert.deepEqual(receipt.targets.map((entry) => [entry.pluginId, entry.state]), [
		["pibo.cron", "disabled"],
		["pibo.goal-control", "disabled"],
		["pibo.preview", "active"],
		["pibo.web-search", "uninstalled"],
		["pibo.workflows", "active"],
	]);
	await stopProcess(gateway);

	const firstSnapshot = firstInstallations.map((entry) => [entry.pluginId, entry.state, entry.enabled, entry.stateRevision, entry.contentHash]).sort(([left], [right]) => left.localeCompare(right));
	const restarted = startGateway();
	t.after(() => stopProcess(restarted).catch(() => {}));
	await waitForHttp(`http://127.0.0.1:${webPort}/health`, restarted);
	const restartedInstallations = (await (await fetch(`http://127.0.0.1:${webPort}/api/chat/plugins`)).json()).installations;
	const restartedSnapshot = restartedInstallations.map((entry) => [entry.pluginId, entry.state, entry.enabled, entry.stateRevision, entry.contentHash]).sort(([left], [right]) => left.localeCompare(right));
	assert.deepEqual(restartedSnapshot, firstSnapshot);
	assert.equal(await readFile(receiptPath, "utf8"), receiptFirst);
	await stopProcess(restarted);

	const db = new DatabaseSync(join(home, "pibo.sqlite"), { readOnly: true });
	try {
		assert.deepEqual({ ...db.prepare("SELECT id, title, first_message_preview FROM sessions WHERE id = ?").get("ps_retained_cutover") }, { id: "ps_retained_cutover", title: "Retained cutover session", first_message_preview: "Retained question" });
		assert.deepEqual({ ...db.prepare("SELECT id, session_id, content_preview FROM chat_messages WHERE id = ?").get("msg_retained_cutover") }, { id: "msg_retained_cutover", session_id: "ps_retained_cutover", content_preview: "Retained question" });
	} finally {
		db.close();
	}
	const reused = await ensureDeploymentArtifact({ config: { artifactRoot: join(root, "artifacts") }, archivePath: assemblyArchive });
	assert.equal(reused.reused, true);
	assert.equal(reused.sha256, deployment.sha256);
	assert.equal(reused.binaryPath, deployment.binaryPath);
});
