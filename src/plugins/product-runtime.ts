import { PiboDataStore } from "../data/pibo-store.js";
import { piboHomePath } from "../core/pibo-home.js";
import { PluginRuntimeCoordinator } from "../agent-runtime/plugin-plan.js";
import type { PluginHost, PluginDefinition } from "./host.js";
import { PluginManager, type PluginManagerLifecycle } from "./manager.js";
import { preparePluginSdkResolution } from "./backend-loader.js";
import { createStagedPluginDefinition } from "./staged-definition.js";
import { verifyPluginArtifact } from "./sources.js";
import type { PluginConsumerCollector } from "./operations.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, PLUGIN_HOST_SERVICE, PLUGIN_MANAGEMENT_SERVICE, PLUGIN_SESSION_PLAN_SERVICE, type PiboPluginProductOptions, type PluginSessionPlanReader } from "./product-services.js";
import type { PluginInstallation, PluginManifest } from "./manifest.js";
import { PluginValidationError } from "./store.js";
import { ensureDefaultPluginInstallations } from "./default-packages.js";

const MANAGEMENT_PLUGIN_ID = "pibo.plugin-management";

function managementManifest(readSessionPlan: PluginSessionPlanReader | undefined): PluginManifest {
	const serviceIds = [PLUGIN_HOST_SERVICE, PLUGIN_MANAGEMENT_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, ...(readSessionPlan ? [PLUGIN_SESSION_PLAN_SERVICE] : [])];
	return {
		schemaVersion: 1,
		id: MANAGEMENT_PLUGIN_ID,
		name: "Plugin management",
		version: "1.0.0",
		sdk: "^1.0.0",
		contributions: [],
		services: { provides: serviceIds.map((id) => ({ id, version: "1.0.0" })) },
	};
}

function builtinInstallation(manifest: PluginManifest): PluginInstallation {
	const createdAt = new Date().toISOString();
	return {
		pluginId: manifest.id,
		revision: "builtin:1",
		contentHash: "builtin:1",
		version: manifest.version,
		manifest,
		source: { kind: "builtin", name: manifest.id },
		enabled: true,
		state: "active",
		stateRevision: 1,
		createdAt,
	};
}

/** Product wiring owns no second registry and never restarts existing system services. */
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
	if (data.plugins.getInstallation(MANAGEMENT_PLUGIN_ID)) {
		if (ownsData) data.close();
		throw new PluginValidationError(`${MANAGEMENT_PLUGIN_ID} is reserved for the product composition`);
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
	const manifest = managementManifest(options.readSessionPlan);
	const managementInstallation = builtinInstallation(manifest);
	const manager = new PluginManager({ store: data.plugins, artifactRoot, lifecycle, collectConsumers: options.collectConsumers, externalInstallations: [managementInstallation] });
	const runtime = new PluginRuntimeCoordinator({ host, manager, store: data.plugins });
	const management: PluginDefinition = {
		installation: managementInstallation,
		setup(context) {
			context.services.provide(PLUGIN_HOST_SERVICE, host);
			context.services.provide(PLUGIN_MANAGEMENT_SERVICE, manager);
			context.services.provide(PIBO_PRODUCT_OPTIONS_SERVICE, Object.freeze({ ...options.productOptions }));
			if (options.readSessionPlan) context.services.provide(PLUGIN_SESSION_PLAN_SERVICE, options.readSessionPlan);
		},
	};

	try {
		const installations = data.plugins.listInstallations().filter((installation) => installation.enabled && ["active", "pending-activation"].includes(installation.state));
		if (installations.some((installation) => installation.pluginId === MANAGEMENT_PLUGIN_ID)) throw new PluginValidationError(`${MANAGEMENT_PLUGIN_ID} is reserved for the product composition`);
		for (const installation of installations) await verifyPluginArtifact(installation);
		if (installations.length) await preparePluginSdkResolution(artifactRoot);
		const definitions = [management, ...installations.map(createStagedPluginDefinition)];
		if (initialState.state === "idle") await host.start({ plugins: definitions });
		else await host.add({ plugins: definitions });
		for (const definition of definitions) ownedPluginIds.add(definition.installation.pluginId);
		if (options.installDefaultPlugins !== false) await ensureDefaultPluginInstallations(manager, artifactRoot, { includeWebProduct: options.includeWebProduct, includeUserResources: options.includeUserResources });
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
			if (ownsData) data.close();
			if (errors.length) throw new AggregateError(errors, "Plugin product runtime cleanup failed");
		},
	};
}
