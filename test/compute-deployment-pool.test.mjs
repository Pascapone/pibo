import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { deploymentSlotDefinitions, resolveDeploymentPoolConfig } from "../dist/compute/pool/config.js";
import { DeploymentPoolStore } from "../dist/compute/pool/store.js";
import { prepareDeploymentSeed } from "../dist/compute/pool/seeds.js";
import { inspectRuntimeArtifact } from "../dist/compute/pool/artifacts.js";
import { buildDeploymentContainerArgs } from "../dist/compute/pool/docker.js";
import { planDeploymentPoolReap } from "../dist/compute/pool/service.js";

function fixtureConfig(root, sourceHome, overrides = {}) {
	return resolveDeploymentPoolConfig({
		root,
		baseURL: "https://pool.example.test",
		env: {
			PIBO_COMPUTE_POOL_SLOT_COUNT: "3",
			PIBO_COMPUTE_POOL_MAX_ACTIVE: "3",
			PIBO_COMPUTE_POOL_PORT_BASE: "15000",
			PIBO_COMPUTE_POOL_SEED_SOURCE_HOME: sourceHome,
			...overrides,
		},
	});
}

function createSourceHome(root) {
	const home = resolve(root, "source-home");
	mkdirSync(home, { recursive: true });
	writeFileSync(resolve(home, "config.json"), JSON.stringify({ auth: { baseURL: "https://canonical.example.test", trustedOrigins: ["https://canonical.example.test"], secret: "fixture-secret-that-is-long-enough" } }));
	writeFileSync(resolve(home, "machine-keys.json"), "[]\n");
	writeFileSync(resolve(home, "payload.txt"), "full-only");
	mkdirSync(resolve(home, "context-files"));
	writeFileSync(resolve(home, "context-files", "context.md"), "context");
	mkdirSync(resolve(home, "payloads"));
	writeFileSync(resolve(home, "payloads", "large.txt"), "payload");
	mkdirSync(resolve(home, "secrets"));
	writeFileSync(resolve(home, "secrets", "must-not-copy"), "secret");
	for (const name of ["pibo.sqlite", "pibo-events.sqlite", "pibo-cron.sqlite", "auth.sqlite", "previews.sqlite"]) {
		const db = new DatabaseSync(resolve(home, name));
		db.exec("CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('ok')");
		db.close();
	}
	return home;
}

test("deployment pool config creates fixed slots and caps active count", () => {
	const config = fixtureConfig("/tmp/pool-config", "/tmp/source", { PIBO_COMPUTE_POOL_SLOT_COUNT: "4", PIBO_COMPUTE_POOL_MAX_ACTIVE: "9" });
	assert.equal(config.maxActive, 4);
	assert.deepEqual(deploymentSlotDefinitions(config).map((slot) => [slot.id, slot.webPort, slot.gatewayPort, slot.publicUrl]), [
		["slot-01", 15000, 15001, "https://slot-01.pool.example.test/"],
		["slot-02", 15010, 15011, "https://slot-02.pool.example.test/"],
		["slot-03", 15020, 15021, "https://slot-03.pool.example.test/"],
		["slot-04", 15030, 15031, "https://slot-04.pool.example.test/"],
	]);
});

test("installed runtime artifact digest covers the complete Pibo package", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-pool-artifact-"));
	try {
		const createRuntime = (name, extraContent) => {
			const runtime = resolve(dir, name);
			const packageRoot = resolve(runtime, "node_modules/@pasko70/pibo");
			mkdirSync(resolve(packageRoot, "dist/bin"), { recursive: true });
			writeFileSync(resolve(packageRoot, "package.json"), '{"name":"@pasko70/pibo","version":"1.0.0"}\n');
			writeFileSync(resolve(packageRoot, "dist/bin/pibo.js"), "entrypoint\n");
			writeFileSync(resolve(packageRoot, "dist/extra.js"), extraContent);
			return runtime;
		};
		const first = await inspectRuntimeArtifact(createRuntime("first", "first\n"));
		const duplicate = await inspectRuntimeArtifact(createRuntime("duplicate", "first\n"));
		const changed = await inspectRuntimeArtifact(createRuntime("changed", "changed\n"));
		assert.equal(first.sha256, duplicate.sha256);
		assert.notEqual(first.sha256, changed.sha256);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deployment store reserves unique slots and enforces maxActive", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-pool-store-"));
	const config = fixtureConfig(dir, dir, { PIBO_COMPUTE_POOL_MAX_ACTIVE: "2" });
	const store = new DeploymentPoolStore(config.databasePath, deploymentSlotDefinitions(config));
	try {
		const base = { holder: "ps_holder", seedMode: "medium", artifactSha256: "a", artifactRuntimePath: "/runtime", createdAt: "2026-08-23T12:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z", maxActive: 2 };
		const first = store.reserveLease({ ...base, id: "lease_a" });
		const second = store.reserveLease({ ...base, id: "lease_b" });
		assert.equal(first.slot.id, "slot-01");
		assert.equal(second.slot.id, "slot-02");
		assert.throws(() => store.reserveLease({ ...base, id: "lease_c" }), /capacity reached/);
		store.markReady(first.lease.id);
		const renewed = store.renewLease(first.lease.id, "ps_holder", "2026-08-23T14:00:00.000Z");
		assert.equal(renewed.expiresAt, "2026-08-23T14:00:00.000Z");
		store.markReleased(first.lease.id, "released");
		assert.equal(store.getSlot("slot-01").state, "free");
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("seed modes provide full, medium, and fresh state with slot auth URL", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-pool-seed-"));
	const sourceHome = createSourceHome(dir);
	const sourcePiHome = resolve(dir, "source-pi");
	mkdirSync(resolve(sourcePiHome, "agent"), { recursive: true });
	writeFileSync(resolve(sourcePiHome, "agent", "auth.json"), '{"fixture":{"type":"api_key","key":"secret"}}\n');
	writeFileSync(resolve(sourcePiHome, "agent", "models-store.json"), '{}\n');
	try {
		for (const mode of ["full", "medium", "fresh"]) {
			const config = fixtureConfig(resolve(dir, `pool-${mode}`), sourceHome, { PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME: sourcePiHome });
			const prepared = await prepareDeploymentSeed({ config, slotId: "slot-01", mode, publicUrl: "https://slot-01.pool.example.test/" });
			const authConfig = JSON.parse(await readFile(resolve(prepared.homePath, "config.json"), "utf8"));
			assert.equal(authConfig.auth.mode, "better-auth");
			assert.equal(authConfig.auth.baseURL, "https://slot-01.pool.example.test");
			assert.ok(authConfig.auth.trustedOrigins.includes("https://slot-01.pool.example.test"));
			assert.equal(existsSync(resolve(prepared.homePath, "machine-keys.json")), true);
			assert.equal(existsSync(resolve(prepared.piHomePath, "agent", "auth.json")), true);
			assert.equal(existsSync(resolve(prepared.piHomePath, "agent", "models-store.json")), true);
			if (mode === "full") {
				assert.equal(existsSync(resolve(prepared.homePath, "payload.txt")), true);
				assert.equal(existsSync(resolve(prepared.homePath, "payloads", "large.txt")), true);
				assert.equal(existsSync(resolve(prepared.homePath, "secrets")), false);
				assert.equal(existsSync(resolve(prepared.homePath, "auth.sqlite")), false);
				assert.equal(existsSync(resolve(prepared.homePath, "previews.sqlite")), false);
				assert.deepEqual(prepared.copiedDatabases, ["pibo-cron.sqlite", "pibo-events.sqlite", "pibo.sqlite"]);
			} else if (mode === "medium") {
				assert.equal(existsSync(resolve(prepared.homePath, "payload.txt")), false);
				assert.equal(existsSync(resolve(prepared.homePath, "payloads")), false);
				assert.deepEqual(prepared.copiedDatabases, ["pibo-events.sqlite", "pibo.sqlite"]);
			} else {
				assert.equal(existsSync(resolve(prepared.homePath, "pibo.sqlite")), false);
				assert.deepEqual(prepared.copiedDatabases, []);
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deployment container args use one image, loopback ports, isolated mounts, and no Docker socket", () => {
	const config = fixtureConfig("/tmp/pool-docker", "/tmp/source");
	const slot = { ...deploymentSlotDefinitions(config)[0], state: "provisioning", activeLeaseId: "lease_a", updatedAt: "2026-08-23T12:00:00.000Z" };
	const lease = {
		id: "lease_a", slotId: slot.id, holder: "ps_holder", seedMode: "fresh", artifactSha256: "abc", artifactRuntimePath: "/runtime/artifact", containerName: "pibo-pool-slot-01", publicUrl: slot.publicUrl, status: "provisioning", createdAt: "2026-08-23T12:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z",
	};
	const args = buildDeploymentContainerArgs({ config, slot, lease, homePath: "/pool/home", piHomePath: "/pool/pi-home", workspacePath: "/pool/workspace" });
	assert.ok(args.includes("127.0.0.1:15000:4788"));
	assert.ok(args.includes("127.0.0.1:15001:4789"));
	assert.ok(args.includes("/runtime/artifact:/opt/pibo-runtime:ro"));
	assert.ok(args.includes("/pool/home:/root/.pibo"));
	assert.ok(args.includes("/pool/pi-home:/root/.pi"));
	assert.ok(args.includes("pibo:latest"));
	assert.equal(args.some((value) => value.includes("docker.sock")), false);
	assert.equal(args[args.length - 2], "-lc");
});

test("deployment reap selects expired leases and caps retained failures", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-pool-reap-"));
	const config = fixtureConfig(dir, dir, { PIBO_COMPUTE_POOL_MAX_FAILED_SNAPSHOTS: "1" });
	await mkdir(config.failuresRoot, { recursive: true });
	const store = new DeploymentPoolStore(config.databasePath, deploymentSlotDefinitions(config));
	try {
		store.reserveLease({ id: "lease_expired", holder: "ps_holder", seedMode: "fresh", artifactSha256: "a", artifactRuntimePath: "/runtime", createdAt: "2026-08-23T10:00:00.000Z", expiresAt: "2026-08-23T11:00:00.000Z", maxActive: 3 });
		store.markReady("lease_expired");
	} finally { store.close(); }
	for (const [index, createdAt] of ["2026-08-23T11:30:00.000Z", "2026-08-23T11:20:00.000Z"].entries()) {
		const path = resolve(config.failuresRoot, `failure-${index}`);
		await mkdir(path);
		writeFileSync(resolve(path, "failure.json"), JSON.stringify({ leaseId: `failed_${index}`, createdAt, expiresAt: "2026-08-23T14:00:00.000Z" }));
	}
	try {
		const plan = await planDeploymentPoolReap({ config, now: new Date("2026-08-23T12:00:00.000Z"), listContainers: async () => [] });
		assert.equal(plan.summary.selectedLeases, 1);
		assert.equal(plan.items[0].reasons[0], "expired");
		assert.equal(plan.summary.selectedFailureSnapshots, 1);
		assert.equal(plan.failureSnapshots.find((item) => item.leaseId === "failed_1").reason, "snapshot-cap-exceeded");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deployment reap reconciles missing and orphan containers and removes stale artifacts", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-pool-reconcile-"));
	const config = fixtureConfig(dir, dir, { PIBO_COMPUTE_POOL_ARTIFACT_RETENTION_HOURS: "1", PIBO_COMPUTE_POOL_MAX_ARTIFACTS: "1" });
	const store = new DeploymentPoolStore(config.databasePath, deploymentSlotDefinitions(config));
	try {
		store.reserveLease({ id: "lease_ready", holder: "ps_holder", seedMode: "fresh", artifactSha256: "active-sha", artifactRuntimePath: "/runtime", createdAt: "2026-08-23T10:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z", maxActive: 3 });
		store.markReady("lease_ready");
		store.reserveLease({ id: "lease_dirty", holder: "ps_holder", seedMode: "fresh", artifactSha256: "dirty-sha", artifactRuntimePath: "/runtime", createdAt: "2026-08-23T10:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z", maxActive: 3 });
		store.markFailed("lease_dirty", "fixture failure", undefined, { slotClean: false, now: "2026-08-23T10:01:00.000Z" });
	} finally { store.close(); }
	for (const name of ["active-sha", "stale-sha"]) mkdirSync(resolve(config.artifactRoot, name), { recursive: true });
	utimesSync(resolve(config.artifactRoot, "active-sha"), new Date("2026-08-23T09:00:00.000Z"), new Date("2026-08-23T09:00:00.000Z"));
	utimesSync(resolve(config.artifactRoot, "stale-sha"), new Date("2026-08-23T09:00:00.000Z"), new Date("2026-08-23T09:00:00.000Z"));
	try {
		const plan = await planDeploymentPoolReap({
			config,
			now: new Date("2026-08-23T12:00:00.000Z"),
			listContainers: async () => [{ id: "container-1", name: "pibo-pool-orphan", leaseId: "lease_orphan", slotId: "slot-03", state: "running" }],
		});
		assert.equal(plan.items.find((item) => item.lease.id === "lease_ready").reasons[0], "container-missing");
		assert.equal(plan.summary.selectedOrphanContainers, 1);
		assert.equal(plan.orphanContainers[0].reason, "no-active-registry-lease");
		assert.equal(plan.summary.selectedDirtySlots, 1);
		assert.equal(plan.dirtySlots[0].slotId, "slot-02");
		assert.equal(plan.artifacts.find((item) => item.sha256 === "active-sha").reason, "active-lease");
		assert.equal(plan.artifacts.find((item) => item.sha256 === "stale-sha").reason, "retention-expired");
		assert.equal(plan.summary.selectedArtifacts, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
