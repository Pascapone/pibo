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

function restorePiboHome() {
	if (savedPiboHome === undefined) delete process.env.PIBO_HOME;
	else process.env.PIBO_HOME = savedPiboHome;
}

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
	try {
		await product.dispose();
	} catch {}
	try {
		data.close();
	} catch {}
	restorePiboHome();
	await rm(root, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFlag(ref, timeoutMs, label) {
	const start = Date.now();
	while (!ref.current) {
		if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await sleep(10);
	}
}

function containsMessage(error, message) {
	if (error instanceof AggregateError) return error.errors.some((entry) => containsMessage(entry, message));
	return error instanceof Error && error.message === message;
}

test("remote plugin setup under an outer migration write transaction uses the shared store", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	try {
		data.db.exec("BEGIN IMMEDIATE");
		try {
			await assert.doesNotReject(host.add({ plugins: [remoteDefinition()] }));
			assert.equal(host.inspect().plugins.some((entry) => entry.pluginId === "pibo.remote-agent"), true);
		} finally {
			try { data.db.exec("ROLLBACK"); } catch {}
		}
		await host.remove("pibo.remote-agent");
	} finally {
		await host.remove("pibo.remote-agent").catch(() => {});
		await disposeProduct(product, data, root);
	}
});

test("borrowed product store stays usable after remote plugin disposal", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	try {
		await host.add({ plugins: [remoteDefinition()] });
		await host.remove("pibo.remote-agent");
		assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	} finally {
		await host.remove("pibo.remote-agent").catch(() => {});
		await disposeProduct(product, data, root);
	}
});

test("host disposal waits for a delayed remote stop before closing resources", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	const releaseRef = { current: null };
	const stopEntered = { current: false };
	const originalStop = PiboRemoteAgentService.prototype.stop;
	let releaseStop;
	const stopGate = new Promise((resolve) => { releaseStop = resolve; });
	releaseRef.current = releaseStop;
	PiboRemoteAgentService.prototype.stop = async function (...args) {
		stopEntered.current = true;
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
		await host.add({ plugins: [remoteDefinition()] });
		let settled = null;
		const removal = host.remove("pibo.remote-agent").then(
			() => { settled = "resolved"; },
			(error) => { settled = error; },
		);
		await waitForFlag(stopEntered, 2000, "remote stop entry");
		await sleep(50);
		assert.equal(ownStoreClosed, false);
		assert.equal(settled, null);
		releaseRef.current();
		await removal;
		assert.equal(settled, "resolved");
		assert.equal(ownStoreClosed, true);
		assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	} finally {
		releaseRef.current?.();
		PiboRemoteAgentService.prototype.stop = originalStop;
		PiboRemoteAgentStore.prototype.close = originalClose;
		await host.remove("pibo.remote-agent").catch(() => {});
		await disposeProduct(product, data, root);
	}
});

test("remote stop failure still closes the own store and never the borrowed store", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-lifecycle-"));
	const { data, host, product } = await startProductWithRemote(root);
	const originalStop = PiboRemoteAgentService.prototype.stop;
	PiboRemoteAgentService.prototype.stop = async () => { throw new Error("boom-remote-stop"); };
	const originalClose = PiboRemoteAgentStore.prototype.close;
	let ownStoreClosed = false;
	PiboRemoteAgentStore.prototype.close = function (...args) {
		ownStoreClosed = true;
		return originalClose.apply(this, args);
	};
	try {
		await host.add({ plugins: [remoteDefinition()] });
		const error = await host.remove("pibo.remote-agent").then(() => null, (cause) => cause);
		assert.ok(error instanceof AggregateError, "expected an AggregateError from host disposal");
		assert.ok(containsMessage(error, "boom-remote-stop"), "expected the injected stop failure in the error chain");
		assert.equal(ownStoreClosed, true);
		assert.equal(data.db.prepare("SELECT 1 AS ok").get().ok, 1);
	} finally {
		PiboRemoteAgentService.prototype.stop = originalStop;
		PiboRemoteAgentStore.prototype.close = originalClose;
		await host.remove("pibo.remote-agent").catch(() => {});
		await disposeProduct(product, data, root);
	}
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
		await host.remove("pibo.remote-agent").catch(() => {});
		await host.stop().catch(() => {});
		restorePiboHome();
		await rm(root, { recursive: true, force: true });
	}
});
