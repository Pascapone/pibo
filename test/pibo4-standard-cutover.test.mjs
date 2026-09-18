import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, glob, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ensureDeploymentArtifact } from "../dist/compute/pool/artifacts.js";
import { PluginManager } from "../dist/plugins/manager.js";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";

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
	const signalGroup = (signal) => {
		try { process.kill(-child.pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; }
	};
	const waitForExit = async (timeoutMs) => {
		if (child.exitCode !== null || child.signalCode !== null) return true;
		return await Promise.race([
			new Promise((resolvePromise) => {
				const done = () => resolvePromise(true);
				child.once("exit", done);
				if (child.exitCode !== null || child.signalCode !== null) { child.off("exit", done); resolvePromise(true); }
			}),
			new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
		]);
	};
	if (child.exitCode === null && child.signalCode === null) {
		signalGroup("SIGTERM");
		await waitForExit(5_000);
	}
	if (child.exitCode === null && child.signalCode === null) {
		signalGroup("SIGKILL");
		await waitForExit(5_000);
	}
	child.stdout?.destroy();
	child.stderr?.destroy();
}

async function stageLegacyInstallation(data, artifactRoot, pluginId, state, packageRoot) {
	const source = join(artifactRoot, "legacy-sources", pluginId);
	await mkdir(source, { recursive: true });
	if (packageRoot) {
		await cp(packageRoot, source, { recursive: true });
		const manifest = JSON.parse(await readFile(join(source, "pibo.plugin.json"), "utf8"));
		await writeFile(join(source, "pibo.plugin.json"), `${JSON.stringify({ ...manifest, version: "0.9.0" })}\n`);
		const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
		await writeFile(join(source, "package.json"), `${JSON.stringify({ ...pkg, version: "0.9.0" })}\n`);
	} else await writeFile(join(source, "pibo.plugin.json"), `${JSON.stringify({
		schemaVersion: 1,
		id: pluginId,
		name: `Retained legacy ${pluginId}`,
		version: "3.6.2",
		sdk: "^1.0.0",
		entrypoints: {},
		...(pluginId === "pibo.user-resources" ? { services: { provides: [{ id: "pibo.user-resources.service", version: "1.0.0" }] } } : {}),
		contributions: [],
	})}\n`);
	const manager = new PluginManager({ store: data.plugins, artifactRoot, coreServices: {
		"pibo.chat.extensions": { owner: "@pibo/core", version: "1.0.0" },
		"pibo.product.options": { owner: "@pibo/core", version: "1.0.0" },
	} });
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
	assert.equal(assemblyManifest.artifacts.length, 26);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "plugin").length, 21);
	assert.equal(assemblyManifest.artifacts.filter((entry) => entry.role === "dependency").length, 2);
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
	const targetPluginIds = packageSet.plugins.map((entry) => entry.pluginId);
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
			...packageSet.plugins.filter((entry) => !new Set(["pibo.preview", "pibo.workflows", "pibo.cron", "pibo.goal-control", "pibo.web-search"]).has(entry.pluginId)).map((entry) => ({ pluginId: entry.pluginId, state: "active" })),
		] },
		outputPath: planPath,
	}, null, 2)}\n`);
	await execFileAsync(process.execPath, [cutoverBinary, inputPath], { cwd: deployment.runtimePath });
	await rm(preparation, { recursive: true, force: true });

	const retainedSkillPath = join(home, "user-skills", "maintain-okf-docs", "SKILL.md");
	await mkdir(join(home, "user-skills", "maintain-okf-docs"), { recursive: true });
	await writeFile(retainedSkillPath, "---\nname: maintain-okf-docs\ndescription: Retained documentation skill\n---\n\nUse retained project documentation rules.\n");
	await writeFile(join(home, "user-skills.json"), JSON.stringify({ version: 1, skills: [{ id: "skill-retained-okf", name: "maintain-okf-docs", path: "/root/.pibo/user-skills/maintain-okf-docs/SKILL.md", enabled: true, source: "user-created", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }] }));
	const agentStore = new CustomAgentStore(join(home, "chat-agents.sqlite"));
	try { agentStore.create({ schemaVersion: 2, displayName: "pibo-agent", skills: ["maintain-okf-docs"], pluginSelection: { schemaVersion: 1, plugins: [] } }); } finally { agentStore.close(); }

	const retainedWorkspace = join(root, "retained-workspace");
	await mkdir(retainedWorkspace, { recursive: true });
	const data = new PiboDataStore(join(home, "pibo.sqlite"), { payloadRootDir: join(home, "payloads") });
	new ChatRoomService(data).createRoom({ id: "room_retained_cutover", name: "Retained cutover room", type: "chat", metadata: { workspace: retainedWorkspace } });
	const pluginArtifactRoot = join(home, "plugins", "artifacts");
	const retainedOldCore = join(root, "retained-old-core");
	const sdkScope = join(pluginArtifactRoot, "node_modules", "@pasko70");
	await mkdir(retainedOldCore, { recursive: true });
	await mkdir(sdkScope, { recursive: true });
	await symlink(retainedOldCore, join(sdkScope, "pibo"), "dir");
	for (const pluginId of ["pibo.standard-shell", "pibo.core", "pibo.product-ui", "pibo.user-resources", "pibo.web-product"]) await stageLegacyInstallation(data, pluginArtifactRoot, pluginId, "active");
	const oldPluginOrder = [...packageSet.plugins].sort((left, right) => left.pluginId === "pibo.run-control" ? -1 : right.pluginId === "pibo.run-control" ? 1 : left.pluginId.localeCompare(right.pluginId));
	for (const entry of oldPluginOrder) {
		const state = ["pibo.cron", "pibo.goal-control"].includes(entry.pluginId) ? "installed" : entry.pluginId === "pibo.web-search" ? "uninstalled" : "active";
		await stageLegacyInstallation(data, pluginArtifactRoot, entry.pluginId, state, join(deployment.runtimePath, "node_modules", ...entry.package.split("/")));
	}
	const retainedAt = "2026-09-15T08:00:00.000Z";
	data.sessions.upsertSession({
		session: { id: "ps_retained_cutover", piSessionId: "pi_retained_cutover", channel: "chat", kind: "runtime", profile: "base", workspace: retainedWorkspace, title: "Retained cutover session", metadata: { retained: true, chatRoomId: "room_retained_cutover" }, createdAt: retainedAt },
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
	const gatewayEnvironment = { ...process.env, HOME: join(root, "unrelated-service-home"), PIBO_HOME: home, PI_CODING_AGENT_DIR: join(root, "empty-pi-agent"), PIBO_GATEWAY_MODE: "dev" };
	const startGateway = () => spawn(process.execPath, gatewayArgs, { cwd: deployment.runtimePath, env: gatewayEnvironment, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
	assert.equal(await realpath(join(sdkScope, "pibo")), await realpath(join(deployment.runtimePath, "node_modules", "@pasko70", "pibo")));
	const firstInstallationsResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat/plugins`);
	assert.equal(firstInstallationsResponse.status, 200);
	const firstInstallations = (await firstInstallationsResponse.json()).installations;
	const packagePluginIds = new Set(packageSet.plugins.map((entry) => entry.pluginId));
	assert.equal(firstInstallations.filter((entry) => packagePluginIds.has(entry.pluginId)).length, 21);
	assert.equal(selectedState(firstInstallations, "pibo.preview").state, "active");
	assert.equal(selectedState(firstInstallations, "pibo.workflows").state, "active");
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.cron").state, enabled: selectedState(firstInstallations, "pibo.cron").enabled }, { state: "installed", enabled: false });
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.goal-control").state, enabled: selectedState(firstInstallations, "pibo.goal-control").enabled }, { state: "installed", enabled: false });
	assert.deepEqual({ state: selectedState(firstInstallations, "pibo.web-search").state, enabled: selectedState(firstInstallations, "pibo.web-search").enabled }, { state: "uninstalled", enabled: false });
	for (const pluginId of ["pibo.standard-shell", "pibo.core", "pibo.product-ui", "pibo.user-resources", "pibo.web-product"]) {
		assert.equal(selectedState(firstInstallations, pluginId).state, "uninstalled");
	}
	assert.equal(firstInstallations.filter((entry) => packagePluginIds.has(entry.pluginId) && entry.state === "active" && entry.enabled).length, 18);
	const bootstrapText = await (await fetch(`http://127.0.0.1:${webPort}/api/chat/bootstrap`)).text();
	assert.match(bootstrapText, new RegExp(retainedSkillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(bootstrapText, /\/root\/\.pibo\/user-skills\/maintain-okf-docs/);
	const createSessionResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${webPort}` }, body: JSON.stringify({ profile: "pibo-agent", roomId: "room_retained_cutover" }) });
	const createSessionText = await createSessionResponse.text();
	assert.equal(createSessionResponse.status, 201, createSessionText);
	const preparedSessionId = JSON.parse(createSessionText).session.id;
	const turnController = new AbortController();
	const turnPromise = fetch(`http://127.0.0.1:${webPort}/api/chat/rooms/room_retained_cutover/messages`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${webPort}` }, body: JSON.stringify({ piboSessionId: preparedSessionId, text: "Verify retained resources", clientTxnId: "n033-retained-resource-turn" }), signal: turnController.signal })
		.then(async (response) => ({ status: response.status, body: await response.text() }))
		.catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
	let materializedSkillPath;
	let turnEvents = "";
	const turnDeadline = Date.now() + 20_000;
	while (Date.now() < turnDeadline && !materializedSkillPath && !/session_error|message_finished|assistant_message/.test(turnEvents)) {
		for await (const candidate of glob(join(home, "agent-runtimes", "**", "skills", "**", "SKILL.md"))) {
			if ((await readFile(candidate, "utf8")).includes("Retained documentation skill")) { materializedSkillPath = candidate; break; }
		}
		turnEvents = await (await fetch(`http://127.0.0.1:${webPort}/api/chat/rooms/room_retained_cutover/events`)).text();
		if (!materializedSkillPath && !/session_error|message_finished|assistant_message/.test(turnEvents)) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	turnController.abort();
	const turnOutcome = await Promise.race([turnPromise, new Promise((resolvePromise) => setTimeout(() => resolvePromise({ error: "turn did not settle after abort" }), 2_000))]);
	if (!materializedSkillPath && !/session_error|message_finished|assistant_message/.test(turnEvents)) {
		await stopProcess(gateway);
		throw new Error(`Retained user skill turn preparation did not settle: ${JSON.stringify(turnOutcome)}\n${stderr}`);
	}
	if (materializedSkillPath) {
		assert.equal(materializedSkillPath.startsWith(join(home, "agent-runtimes")), true);
		assert.doesNotMatch(materializedSkillPath, /\/root\/\.pibo\/user-skills/);
	}
	assert.doesNotMatch(turnEvents, /Runtime resource preparation failed|maintain-okf-docs.*could not be loaded|\/root\/\.pibo\/user-skills/);
	assert.doesNotMatch(stderr, /cutover is required|artifact changed or is missing|activation did not complete|Cannot find module|maintain-okf-docs.*could not be loaded|\/root\/\.pibo\/user-skills/);
	const receiptPath = `${planPath}.complete`;
	const receiptFirst = await readFile(receiptPath, "utf8");
	const receipt = JSON.parse(receiptFirst);
	assert.equal(receipt.targets.length, 21);
	assert.deepEqual(receipt.supersededOwners, ["pibo.core", "pibo.product-ui", "pibo.standard-shell", "pibo.user-resources", "pibo.web-product"]);
	const receiptStates = new Map(receipt.targets.map((entry) => [entry.pluginId, entry.state]));
		assert.equal(receiptStates.get("pibo.cron"), "disabled");
	assert.equal(receiptStates.get("pibo.goal-control"), "disabled");
	assert.equal(receiptStates.get("pibo.web-search"), "uninstalled");
	assert.equal([...receiptStates.values()].filter((state) => state === "active").length, 18);
	await stopProcess(gateway);

	const firstSnapshot = firstInstallations.map((entry) => [entry.pluginId, entry.state, entry.enabled, entry.stateRevision, entry.contentHash]).sort(([left], [right]) => left.localeCompare(right));
	const restarted = startGateway();
	t.after(() => stopProcess(restarted).catch(() => {}));
	await waitForHttp(`http://127.0.0.1:${webPort}/health`, restarted);
	assert.equal(await realpath(join(sdkScope, "pibo")), await realpath(join(deployment.runtimePath, "node_modules", "@pasko70", "pibo")));
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
