import { PiboDataStore } from "../data/pibo-store.js";
import { piboHomePath } from "../core/pibo-home.js";
import { PluginRuntimeCoordinator } from "../agent-runtime/plugin-plan.js";
import type { PluginHost } from "./host.js";
import { PluginManager, type PluginManagerLifecycle } from "./manager.js";
import { preparePluginSdkResolution } from "./backend-loader.js";
import { createStagedPluginDefinition } from "./staged-definition.js";
import { verifyPluginArtifact } from "./sources.js";
import type { PluginConsumerCollector } from "./operations.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, PLUGIN_HOST_SERVICE, PLUGIN_MANAGEMENT_SERVICE, PLUGIN_SESSION_PLAN_SERVICE, type PiboPluginProductOptions, type PluginSessionPlanReader } from "./product-services.js";
import type { PluginInstallation } from "./manifest.js";
import { ensureDefaultPluginInstallations } from "./default-packages.js";

/** Product wiring exposes core services without manufacturing a plugin installation. */
export async function startPluginProductRuntime(options: {
	host: PluginHost;
	data?: PiboDataStore;
	artifactRoot?: string;
	collectConsumers?: PluginConsumerCollector;
	readSessionPlan?: PluginSessionPlanReader;
	productOptions?: PiboPluginProductOptions;
	installDefaultPlugins?: boolean;
	includeWebProduct?: boolean;
	includeUserResources?: boolean;
}) {
	const ownsData = options.data === undefined;
	const data = options.data ?? new PiboDataStore();
	const artifactRoot = options.artifactRoot ?? piboHomePath("plugins", "artifacts");
	const host = options.host;
	const initialState = host.inspect();
	if (initialState.state !== "idle" && initialState.state !== "active") {
		if (ownsData) data.close();
		throw new Error(`Plugin host is ${initialState.state}; recover or stop it before product startup`);
	}
	const ownedPluginIds = new Set<string>();
	const lifecycle: PluginManagerLifecycle = {
		async activate(artifact) {
			await verifyPluginArtifact(artifact);
			await preparePluginSdkResolution(artifactRoot);
			await host.add({ plugins: [createStagedPluginDefinition({ ...artifact, state: "active", enabled: true, stateRevision: 1 })] });
			ownedPluginIds.add(artifact.pluginId);
		},
		async deactivate(pluginId) {
			await host.remove(pluginId);
			ownedPluginIds.delete(pluginId);
		},
		async status(pluginId) {
			const state = host.inspect();
			if (state.state !== "active") return "unknown";
			return state.plugins.some((plugin) => plugin.pluginId === pluginId) ? "active" : "inactive";
		},
	};
	const manager = new PluginManager({ store: data.plugins, artifactRoot, lifecycle, collectConsumers: options.collectConsumers, coreServices: () => host.coreServiceDeclarations() });
	const runtime = new PluginRuntimeCoordinator({ host, manager, store: data.plugins });
	const coreServiceDisposers = [
		host.provideCoreService({ id: PLUGIN_HOST_SERVICE, version: "1.0.0", value: host }),
		host.provideCoreService({ id: PLUGIN_MANAGEMENT_SERVICE, version: "1.0.0", value: manager }),
		host.provideCoreService({ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", value: Object.freeze({ ...options.productOptions }) }),
		...(options.readSessionPlan ? [host.provideCoreService({ id: PLUGIN_SESSION_PLAN_SERVICE, version: "1.0.0", value: options.readSessionPlan })] : []),
	];

	try {
		// Packaged backends resolve against this product version. Upgrade their
		// managed manifests before importing any persisted backend definition.
		if (initialState.state === "idle") await host.start({ plugins: [] });
		if (options.installDefaultPlugins !== false) await ensureDefaultPluginInstallations(manager, artifactRoot, {
			includeWebProduct: options.includeWebProduct, includeUserResources: options.includeUserResources,
			activateExisting: async (installation) => {
				if (!host.inspect().plugins.some((plugin) => plugin.pluginId === installation.pluginId)) await lifecycle.activate(installation);
			},
		});
		const activeIds = new Set(host.inspect().plugins.map((plugin) => plugin.pluginId));
		const installations = data.plugins.listInstallations().filter((installation) => installation.enabled && ["active", "pending-activation"].includes(installation.state) && !activeIds.has(installation.pluginId));
		for (const installation of installations) await verifyPluginArtifact(installation);
		if (installations.length) {
			await preparePluginSdkResolution(artifactRoot);
			await host.add({ plugins: installations.map(createStagedPluginDefinition) });
			for (const installation of installations) ownedPluginIds.add(installation.pluginId);
		}
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		if (initialState.state === "idle") {
			try { await host.stop(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		} else {
			const order = host.inspect().plugins.map((plugin) => plugin.pluginId).filter((id) => ownedPluginIds.has(id)).reverse();
			for (const pluginId of order) {
				try { await host.remove(pluginId); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
		}
		for (const dispose of coreServiceDisposers.reverse()) {
			try { await dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		}
		if (ownsData) data.close();
		if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Plugin product runtime startup and cleanup failed");
		throw error;
	}

	let disposed = false;
	return {
		manager,
		runtime,
		data,
		/** Run only after router/profile collectors are attached; recovery must inspect live consumers. */
		recover: () => manager.recover(),
		async dispose() {
			if (disposed) return;
			disposed = true;
			const errors: unknown[] = [];
			if (initialState.state === "idle") {
				try { await host.stop(); } catch (error) { errors.push(error); }
			} else {
				const order = host.inspect().plugins.map((plugin) => plugin.pluginId).filter((id) => ownedPluginIds.has(id)).reverse();
				for (const pluginId of order) {
					try { await host.remove(pluginId); } catch (error) { errors.push(error); }
				}
			}
			for (const dispose of coreServiceDisposers.reverse()) {
				try { await dispose(); } catch (error) { errors.push(error); }
			}
			if (ownsData) data.close();
			if (errors.length) throw new AggregateError(errors, "Plugin product runtime cleanup failed");
		},
	};
}
