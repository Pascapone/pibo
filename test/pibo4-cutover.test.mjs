import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PluginHost } from "../dist/plugins/host.js";
import { PluginManager } from "../dist/plugins/manager.js";
import { preparePibo4Cutover, verifyPreparedPibo4Cutover } from "../dist/plugins/cutover.js";
import { startPluginProductRuntime } from "../dist/plugins/product-runtime.js";

const execFileAsync = promisify(execFile);

async function npmPack(directory, destination) {
	const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd: directory, maxBuffer: 16 * 1024 * 1024 });
	return join(destination, JSON.parse(stdout)[0].filename);
}
async function extractPackage(tarball, target) {
	await mkdir(target, { recursive: true });
	await execFileAsync("tar", ["-xzf", tarball, "--strip-components=1", "-C", target]);
}

test("cutover preparation maps aggregate owners, preserves negative states, and verifies exact bytes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-cutover-plan-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const file = async (name, bytes) => { const path = join(root, name); await writeFile(path, bytes); return path; };
	const source = await file("pibo-3.6.2.tgz", "old-monolith");
	const core = await file("pibo-4.tgz", "minimal-core");
	const preview = await file("preview.tgz", "preview");
	const cron = await file("cron.tgz", "cron");
	const workflows = await file("workflows.tgz", "workflows");
	const loops = await file("loops.tgz", "loops");
	const planPath = join(root, "private", "cutover.json");
	const plan = await preparePibo4Cutover({
		source: { package: "@pasko70/pibo", version: "3.6.2", path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: {
			"pibo.preview": { package: "@pasko70/pibo-plugin-preview", version: "1.0.0", path: preview },
			"pibo.cron": { package: "@pasko70/pibo-plugin-cron", version: "1.0.0", path: cron },
			"pibo.workflows": { package: "@pasko70/pibo-plugin-workflows", version: "1.0.0", path: workflows },
			"pibo.goal-control": { package: "@pasko70/pibo-plugin-goal-loops", version: "1.0.0", path: loops },
		},
		snapshot: { schemaVersion: 1, plugins: [
			{ pluginId: "pibo.web-product", state: "active", contributions: { "preview-app": true, "cron-channel": false } },
			{ pluginId: "pibo.product-ui", state: "active", contributions: { workflows: true, cron: false, loops: false } },
		] },
		outputPath: planPath,
	});
	assert.deepEqual(plan.targets.map(({ pluginId, state }) => [pluginId, state]), [["pibo.cron", "disabled"], ["pibo.goal-control", "disabled"], ["pibo.preview", "active"], ["pibo.workflows", "active"]]);
	assert.deepEqual(plan.sourceSnapshot.plugins.map(({ pluginId, state }) => [pluginId, state]), [["pibo.web-product", "active"], ["pibo.product-ui", "active"]]);
	assert.equal((await verifyPreparedPibo4Cutover(planPath)).planHash, plan.planHash);
	const betaPlan = await preparePibo4Cutover({
		source: { package: "@pasko70/pibo", version: "4.0.0-beta.3", path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: { "pibo.preview": { package: "@pasko70/pibo-plugin-preview", version: "1.0.0", path: preview } },
		snapshot: { schemaVersion: 1, plugins: [{ pluginId: "pibo.preview", state: "active" }] },
		outputPath: join(root, "private", "beta-cutover.json"),
	});
	assert.equal(betaPlan.source.version, "4.0.0-beta.3");
	const disabledAggregate = await preparePibo4Cutover({
		source: { package: "@pasko70/pibo", version: "3.6.2", path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: { "pibo.preview": { package: "@pasko70/pibo-plugin-preview", version: "1.0.0", path: preview }, "pibo.cron": { package: "@pasko70/pibo-plugin-cron", version: "1.0.0", path: cron } },
		snapshot: { schemaVersion: 1, plugins: [{ pluginId: "pibo.web-product", state: "disabled", contributions: { "preview-app": true, "cron-channel": true } }] },
		outputPath: join(root, "private", "disabled-aggregate.json"),
	});
	assert.deepEqual(disabledAggregate.targets.map(({ pluginId, state }) => [pluginId, state]), [["pibo.cron", "disabled"], ["pibo.preview", "disabled"]]);
	await writeFile(preview, "changed");
	await assert.rejects(verifyPreparedPibo4Cutover(planPath), /artifact changed or is missing/);
	await assert.rejects(preparePibo4Cutover({ source: { package: "@pasko70/pibo", version: "3.6.2", path: source }, targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core }, artifacts: {}, snapshot: { schemaVersion: 1, plugins: [{ pluginId: "unknown.legacy", state: "active" }] }, outputPath: join(root, "unknown.json") }), /No exact Pibo 4 artifact/);
});

test("cutover preparation supersedes Standard shell through composition without requiring a plugin artifact", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-standard-shell-cutover-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "pibo-1.7.2.tgz");
	const core = join(root, "pibo-4.tgz");
	const planPath = join(root, "cutover.json");
	await writeFile(source, "real-line source bytes");
	await writeFile(core, "minimal core bytes");
	const plan = await preparePibo4Cutover({
		source: { package: "@pasko70/pibo", version: "1.7.2", path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: {},
		snapshot: { schemaVersion: 1, plugins: [{ pluginId: "pibo.standard-shell", state: "active" }] },
		outputPath: planPath,
	});
	assert.deepEqual(plan.targets, []);
	assert.deepEqual(plan.supersededOwners, ["pibo.standard-shell"]);
	assert.equal((await verifyPreparedPibo4Cutover(planPath)).planHash, plan.planHash);
});

test("verified cutover excludes only superseded providers and rolls back all target rows on a later strict conflict", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-cutover-provider-rollback-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	await mkdir(tarballs, { recursive: true });
	const makeTarget = async (id, name, services) => {
		const directory = join(root, id);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "package.json"), `${JSON.stringify({ name, version: "1.0.0", type: "module", files: ["pibo.plugin.json"] })}\n`);
		await writeFile(join(directory, "pibo.plugin.json"), `${JSON.stringify({ schemaVersion: 1, id, name: id, version: "1.0.0", sdk: "^1.0.0", entrypoints: {}, services, contributions: [] })}\n`);
		return { package: name, version: "1.0.0", path: await npmPack(directory, tarballs) };
	};
	const requiredService = "pibo.user-resources.service";
	const requires = await makeTarget("test.a-requires-user-resources", "@example/requires-user-resources", { requires: [{ id: requiredService, version: "^1.0.0" }] });
	const conflicts = await makeTarget("test.z-conflicts-user-resources", "@example/conflicts-user-resources", { provides: [{ id: requiredService, version: "1.0.0" }] });
	const source = join(root, "pibo-1.7.2.tgz");
	const core = join(root, "pibo-4.tgz");
	await writeFile(source, "retained source bytes");
	await writeFile(core, "target core bytes");
	const prepare = (outputPath, includeConflict) => preparePibo4Cutover({
		source: { package: "@pasko70/pibo", version: "1.7.2", path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: { "test.a-requires-user-resources": requires, ...(includeConflict ? { "test.z-conflicts-user-resources": conflicts } : {}) },
		snapshot: { schemaVersion: 1, plugins: [
			{ pluginId: "pibo.user-resources", state: "active", contributions: { resources: true } },
			{ pluginId: "test.a-requires-user-resources", state: "active" },
			...(includeConflict ? [{ pluginId: "test.z-conflicts-user-resources", state: "active" }] : []),
		] },
		outputPath,
	});
	const failedPlanPath = join(root, "failed-plan.json");
	await prepare(failedPlanPath, true);
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	t.after(() => data.close());
	const legacySource = join(root, "legacy-user-resources");
	await mkdir(legacySource);
	await writeFile(join(legacySource, "pibo.plugin.json"), `${JSON.stringify({ schemaVersion: 1, id: "pibo.user-resources", name: "Legacy user resources", version: "1.7.2", sdk: "^1.0.0", entrypoints: {}, services: { provides: [{ id: requiredService, version: "1.0.0" }] }, contributions: [] })}\n`);
	const seedManager = new PluginManager({ store: data.plugins, artifactRoot: join(root, "artifacts") });
	const seeded = await seedManager.install({ kind: "local", path: legacySource }, { expectedRevision: 0 });
	data.plugins.putInstallation({ ...seeded.installation, source: { kind: "builtin", name: "pibo.user-resources" }, enabled: true, state: "active", updatedAt: new Date().toISOString() }, seeded.installation.stateRevision);
	const before = data.plugins.listInstallations();
	await assert.rejects(startPluginProductRuntime({ host: new PluginHost(), data, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: failedPlanPath, currentCoreVersion: "4.0.0-beta.1" }), /requires an explicit valid provider/);
	assert.deepEqual(data.plugins.listInstallations(), before);
	assert.equal(data.plugins.getInstallation("test.a-requires-user-resources"), undefined);
	assert.equal(data.plugins.getInstallation("test.z-conflicts-user-resources"), undefined);
	await assert.rejects(access(`${failedPlanPath}.complete`));

	const replayPlanPath = join(root, "replay-plan.json");
	await prepare(replayPlanPath, false);
	const product = await startPluginProductRuntime({ host: new PluginHost(), data, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: replayPlanPath, currentCoreVersion: "4.0.0-beta.1" });
	assert.equal(data.plugins.getInstallation("pibo.user-resources").state, "uninstalled");
	assert.equal(data.plugins.getInstallation("test.a-requires-user-resources").state, "active");
	const revision = data.plugins.getInstallation("test.a-requires-user-resources").stateRevision;
	await product.dispose();
	const restarted = await startPluginProductRuntime({ host: new PluginHost(), data, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: replayPlanPath, currentCoreVersion: "4.0.0-beta.1" });
	assert.equal(data.plugins.getInstallation("test.a-requires-user-resources").stateRevision, revision);
	await restarted.dispose();
});

test("cutover preparation accepts real pre-4 package lines and rejects unsupported or malformed source versions", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-cutover-source-versions-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "source.tgz");
	const core = join(root, "core.tgz");
	await writeFile(source, "exact deployed source bytes");
	await writeFile(core, "exact target core bytes");
	const prepare = (version, index, packageName = "@pasko70/pibo") => preparePibo4Cutover({
		source: { package: packageName, version, path: source },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: core },
		artifacts: {},
		snapshot: { schemaVersion: 1, plugins: [] },
		outputPath: join(root, `plan-${index}.json`),
	});
	for (const [index, version] of ["1.7.2", "1.0.0", "2.4.1-beta.2", "3.6.2", "3.9.0+retained.1", "4.0.0-alpha", "4.0.0-beta.3", "4.0.0-rc.2"].entries()) {
		const plan = await prepare(version, `allowed-${index}`);
		assert.equal(plan.source.version, version);
		assert.match(plan.source.contentHash, /^sha256:[0-9a-f]{64}$/);
	}
	for (const [index, version] of ["0.9.0", "1.7", "1.07.2", "v1.7.2", "1.7.2-01", "4.0.0", "4.0.1-beta.1", "4.1.0-beta.1", "4.0.0-preview.1", "5.0.0-alpha.1", "garbage"].entries()) {
		await assert.rejects(prepare(version, `rejected-${index}`), /Unsupported cutover source/);
	}
	await assert.rejects(prepare("1.7.2", "wrong-package", "@other/pibo"), /Cutover source must be @pasko70\/pibo/);
});

test("Minimal-Core refuses a required but unprepared direct cutover before opening product data", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo4-unprepared-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = root;
	t.after(async () => { if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome; await rm(root, { recursive: true, force: true }); });
	await assert.rejects(startPluginProductRuntime({ host: new PluginHost(), requirePreparedCutover: true, installDefaultPlugins: false }), /Run the cutover preparation tool/);
	await assert.rejects(access(join(root, "pibo.sqlite")));
});

test("actual packed 3.6.2 installation prepares before replacement and activates only mapped packed artifacts", { skip: !process.env.PIBO_OLD_PACKAGE_TARBALL && "Set PIBO_OLD_PACKAGE_TARBALL to the packed @pasko70/pibo 3.6.2 tarball" }, async (t) => {
	const oldTarball = resolve(process.env.PIBO_OLD_PACKAGE_TARBALL);
	const root = await mkdtemp(join(tmpdir(), "pibo4-actual-packed-cutover-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const tarballs = join(root, "tarballs");
	const project = join(root, "consumer");
	const oldInstall = join(project, "node_modules", "@pasko70", "pibo");
	const cutoverInstall = join(project, "node_modules", "@pasko70", "pibo-cutover");
	await mkdir(tarballs, { recursive: true });
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "package.json"), '{"name":"pibo4-cutover-consumer","private":true,"type":"module"}\n');
	await extractPackage(oldTarball, oldInstall);
	const oldPackage = JSON.parse(await readFile(join(oldInstall, "package.json"), "utf8"));
	assert.equal(oldPackage.name, "@pasko70/pibo");
	assert.equal(oldPackage.version, "3.6.2");
	const cutoverTarball = await npmPack(resolve("dist/pibo4-cutover-package"), tarballs);
	const coreTarball = await npmPack(resolve("dist/pibo4-core-package"), tarballs);
	await extractPackage(cutoverTarball, cutoverInstall);
	const artifacts = {};
	for (const [pluginId, suffix] of [["pibo.preview", "preview"], ["pibo.cron", "cron"], ["pibo.workflows", "workflows"], ["pibo.goal-control", "goal-loops"], ["pibo.web-search", "web-search"]]) {
		const tarball = await npmPack(resolve("dist/pibo4-artifacts", suffix), tarballs);
		const pkg = JSON.parse(await readFile(join("dist/pibo4-artifacts", suffix, "package.json"), "utf8"));
		artifacts[pluginId] = { package: pkg.name, version: pkg.version, path: tarball };
	}
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	const retainedData = join(home, "retained-user-data.json");
	await writeFile(retainedData, '{"profile":"keep","disabled":["cron","web-search"]}\n');
	const planPath = join(home, "migration", "pibo4-cutover.json");
	const inputPath = join(root, "cutover-input.json");
	await writeFile(inputPath, `${JSON.stringify({
		source: { package: "@pasko70/pibo", version: oldPackage.version, path: oldTarball },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: coreTarball },
		artifacts,
		snapshot: { schemaVersion: 1, plugins: [
			{ pluginId: "pibo.web-product", state: "active", contributions: { "preview-app": true, "cron-channel": false } },
			{ pluginId: "pibo.product-ui", state: "active", contributions: { workflows: true, cron: false, loops: false } },
			{ pluginId: "pibo.web-search", state: "uninstalled" },
		] },
		outputPath: planPath,
	}, null, 2)}\n`);
	await execFileAsync(process.execPath, [join(cutoverInstall, "bin/pibo4-cutover.js"), inputPath], { cwd: project });
	const conflictPlanPath = join(home, "migration", "pibo4-disabled-preview.json");
	const conflictInputPath = join(root, "cutover-conflict-input.json");
	await writeFile(conflictInputPath, `${JSON.stringify({
		source: { package: "@pasko70/pibo", version: oldPackage.version, path: oldTarball },
		targetCore: { package: "@pasko70/pibo", version: "4.0.0-beta.1", path: coreTarball },
		artifacts: { "pibo.preview": artifacts["pibo.preview"] },
		snapshot: { schemaVersion: 1, plugins: [{ pluginId: "pibo.preview", state: "disabled" }] },
		outputPath: conflictPlanPath,
	}, null, 2)}\n`);
	await execFileAsync(process.execPath, [join(cutoverInstall, "bin/pibo4-cutover.js"), conflictInputPath], { cwd: project });
	const prepared = JSON.parse(await readFile(planPath, "utf8"));
	assert.deepEqual(prepared.targets.filter((entry) => entry.state === "active").map((entry) => entry.pluginId), ["pibo.preview", "pibo.workflows"]);
	assert.deepEqual(prepared.targets.filter((entry) => entry.state !== "active").map((entry) => [entry.pluginId, entry.state]), [["pibo.cron", "disabled"], ["pibo.goal-control", "disabled"], ["pibo.web-search", "uninstalled"]]);

	await rm(oldInstall, { recursive: true, force: true });
	await extractPackage(coreTarball, oldInstall);
	const replacement = JSON.parse(await readFile(join(oldInstall, "package.json"), "utf8"));
	assert.equal(replacement.version, "4.0.0-beta.1");
	const runtimeScript = `
		import assert from "node:assert/strict";
		import { access, readFile } from "node:fs/promises";
		import { PluginHost, startPluginProductRuntime } from "@pasko70/pibo";
		await assert.rejects(startPluginProductRuntime({ host: new PluginHost(), requirePreparedCutover: true, installDefaultPlugins: false }), /cutover preparation tool/);
		const host = new PluginHost();
		const product = await startPluginProductRuntime({ host, artifactRoot: ${JSON.stringify(join(home, "plugins", "artifacts"))}, collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: ${JSON.stringify(planPath)}, currentCoreVersion: "4.0.0-beta.1" });
		assert.deepEqual(host.inspect().plugins.map((entry) => entry.pluginId).sort(), ["pibo.preview", "pibo.workflows"]);
		assert.deepEqual(product.data.plugins.listInstallations().map((entry) => [entry.pluginId, entry.state, entry.enabled]).sort(([left], [right]) => left.localeCompare(right)), [["pibo.cron", "installed", false], ["pibo.goal-control", "installed", false], ["pibo.preview", "active", true], ["pibo.web-search", "uninstalled", false], ["pibo.workflows", "active", true]]);
		assert.equal(await readFile(${JSON.stringify(retainedData)}, "utf8"), '{"profile":"keep","disabled":["cron","web-search"]}\\n');
		await access(${JSON.stringify(`${planPath}.complete`)});
		await product.dispose();
		const restartedHost = new PluginHost();
		const restarted = await startPluginProductRuntime({ host: restartedHost, artifactRoot: ${JSON.stringify(join(home, "plugins", "artifacts"))}, collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: ${JSON.stringify(planPath)}, currentCoreVersion: "4.0.0-beta.1" });
		assert.deepEqual(restartedHost.inspect().plugins.map((entry) => entry.pluginId).sort(), ["pibo.preview", "pibo.workflows"]);
		assert.equal(restarted.data.plugins.listInstallations().length, 5);
		await restarted.dispose();
		await assert.rejects(startPluginProductRuntime({ host: new PluginHost(), artifactRoot: ${JSON.stringify(join(home, "plugins", "artifacts"))}, collectConsumers: async () => [], installDefaultPlugins: false, requirePreparedCutover: true, cutoverPlanPath: ${JSON.stringify(conflictPlanPath)}, currentCoreVersion: "4.0.0-beta.1" }), /preserves pibo.preview as disabled/);
	`;
	await execFileAsync(process.execPath, ["--input-type=module", "--eval", runtimeScript], { cwd: project, env: { ...process.env, PIBO_HOME: home }, maxBuffer: 16 * 1024 * 1024 });
});
