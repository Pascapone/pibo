import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PluginHost } from "../dist/plugins/host.js";
import { remoteAgentPackageManifest } from "../dist/plugins/default-packages.js";
import { startPluginProductRuntime } from "../dist/plugins/product-runtime.js";
import { PiboChatExtensionRegistry } from "../dist/plugins/product-services.js";
import { setupRemoteAgent } from "../dist/plugins/packaged-remote-agent.js";
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";

function remoteDefinition() {
	const manifest = remoteAgentPackageManifest();
	return {
		installation: {
			pluginId: manifest.id,
			revision: "builtin:remote-agent-test",
			contentHash: "builtin:remote-agent-test",
			version: manifest.version,
			manifest,
			source: { kind: "builtin", name: manifest.id },
			enabled: true,
			state: "active",
			stateRevision: 1,
			createdAt: new Date().toISOString(),
		},
		setup: setupRemoteAgent,
	};
}

const savedPiboHome = process.env.PIBO_HOME;

async function startProductWithRemote(root) {
	process.env.PIBO_HOME = join(root, "pibo-home");
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const host = new PluginHost();
	const product = await startPluginProductRuntime({
		host,
		data,
		artifactRoot: join(root, "artifacts"),
		collectConsumers: async () => [],
	});
	return { data, host, product };
}

async function disposeProduct(product, data, root) {
	await product.dispose().catch(() => {});
	try { data.close(); } catch {}
	process.env.PIBO_HOME = savedPiboHome;
	await rm(root, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("remote plugin setup under an outer migration write transaction uses the shared store", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	data.db.exec("BEGIN IMMEDIATE");
	try {
		await assert.doesNotReject(host.add({ plugins: [remoteDefinition()] }));
		assert.equal(host.inspect().plugins.some((entry) => entry.pluginId === "pibo.remote-agent"), true);
	} finally {
		try { data.db.exec("ROLLBACK"); } catch {}
	}
	await host.remove("pibo.remote-agent");
	await disposeProduct(product, data, root);
});

test("borrowed product store stays usable after remote plugin disposal", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	await host.add({ plugins: [remoteDefinition()] });
	await host.remove("pibo.remote-agent");
	assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	await disposeProduct(product, data, root);
});

test("host disposal waits for a delayed remote stop before closing resources", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	await host.add({ plugins: [remoteDefinition()] });
	const originalStop = PiboRemoteAgentService.prototype.stop;
	let releaseStop;
	const stopGate = new Promise((resolve) => { releaseStop = resolve; });
	PiboRemoteAgentService.prototype.stop = async function (...args) {
		await stopGate;
		return originalStop.apply(this, args);
	};
	const originalClose = PiboRemoteAgentStore.prototype.close;
	let ownStoreClosed = false;
	PiboRemoteAgentStore.prototype.close = function (...args) {
		ownStoreClosed = true;
		return originalClose.apply(this, args);
	};
	try {
		let settled = null;
		const removal = host.remove("pibo.remote-agent").then(
			() => { settled = "resolved"; },
			(error) => { settled = error; },
		);
		await sleep(50);
		assert.equal(ownStoreClosed, false);
		assert.equal(settled, null);
		releaseStop();
		await removal;
		assert.equal(settled, "resolved");
		assert.equal(ownStoreClosed, true);
		assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	} finally {
		PiboRemoteAgentService.prototype.stop = originalStop;
		PiboRemoteAgentStore.prototype.close = originalClose;
	}
	await disposeProduct(product, data, root);
});

test("remote stop failure still closes the own store and never the borrowed store", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	await host.add({ plugins: [remoteDefinition()] });
	const originalStop = PiboRemoteAgentService.prototype.stop;
	PiboRemoteAgentService.prototype.stop = async () => { throw new Error("boom-remote-stop"); };
	const originalClose = PiboRemoteAgentStore.prototype.close;
	let ownStoreClosed = false;
	PiboRemoteAgentStore.prototype.close = function (...args) {
		ownStoreClosed = true;
		return originalClose.apply(this, args);
	};
	try {
		await assert.rejects(host.remove("pibo.remote-agent"));
		assert.equal(ownStoreClosed, true);
		assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	} finally {
		PiboRemoteAgentService.prototype.stop = originalStop;
		PiboRemoteAgentStore.prototype.close = originalClose;
	}
	await disposeProduct(product, data, root);
});

test("remote plugin setup without a provided data store keeps file defaults", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	process.env.PIBO_HOME = join(root, "pibo-home");
	const host = new PluginHost();
	host.provideCoreService({ id: "pibo.product.options", version: "1.0.0", value: {} });
	host.provideCoreService({ id: "pibo.chat.extensions", version: "1.0.0", value: new PiboChatExtensionRegistry() });
	try {
		await assert.doesNotReject(host.start({ plugins: [remoteDefinition()] }));
		await host.remove("pibo.remote-agent");
	} finally {
		await host.stop().catch(() => {});
		process.env.PIBO_HOME = savedPiboHome;
		await rm(root, { recursive: true, force: true });
	}
});
