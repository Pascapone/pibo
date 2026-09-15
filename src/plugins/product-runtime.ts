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
import { provideCoreUserResources } from "../core/user-resources.js";
import { provideCoreCapabilities } from "../core/capabilities.js";
import { isPibo4LegacyAggregatePluginId, pibo4LegacyAggregateOwners, verifyPreparedPibo4Cutover, writePibo4CutoverReceipt, type Pibo4CutoverPlan } from "./cutover.js";

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
	requirePreparedCutover?: boolean;
	cutoverPlanPath?: string;
	currentCoreVersion?: string;
}) {
	let cutover: Pibo4CutoverPlan | undefined;
	if (options.requirePreparedCutover || options.cutoverPlanPath) {
		if (!options.cutoverPlanPath) throw new Error("Pibo 4 cutover is required. Run the cutover preparation tool against the retained old package and pass cutoverPlanPath before starting Minimal-Core");
		cutover = await verifyPreparedPibo4Cutover(options.cutoverPlanPath);
		if (!options.currentCoreVersion || options.currentCoreVersion !== cutover.targetCore.version) throw new Error(`Prepared cutover targets @pasko70/pibo@${cutover.targetCore.version}, but the starting Minimal-Core version is ${options.currentCoreVersion ?? "unknown"}; install the exact prepared core tarball`);
		if (options.installDefaultPlugins !== false) throw new Error("Prepared cutover requires installDefaultPlugins=false so disabled or uninstalled legacy features cannot be re-enabled by defaults");
	}
	const ownsData = options.data === undefined;
	const data = options.data ?? new PiboDataStore();
	const artifactRoot = options.artifactRoot ?? piboHomePath("plugins", "artifacts");
	const host = options.host;
	const initialState = host.inspect();
	const activeLegacyInstallations = data.plugins.listInstallations().filter((installation) => isPibo4LegacyAggregatePluginId(installation.pluginId) && installation.enabled && installation.state !== "uninstalled");
	if (activeLegacyInstallations.length && !cutover) {
		if (ownsData) data.close();
		throw new Error(`Legacy aggregate plugin installations require a prepared Pibo 4 cutover before startup: ${activeLegacyInstallations.map((entry) => entry.pluginId).join(", ")}. Restore the old package if necessary, run @pasko70/pibo-cutover, then retry with cutoverPlanPath`);
	}
	if (cutover) {
		const preparedOwners = new Set(pibo4LegacyAggregateOwners(cutover));
		const unpreparedOwners = activeLegacyInstallations.filter((installation) => !preparedOwners.has(installation.pluginId));
		if (unpreparedOwners.length) {
			if (ownsData) data.close();
			throw new Error(`Prepared cutover does not include active legacy owners: ${unpreparedOwners.map((entry) => entry.pluginId).join(", ")}`);
		}
	}
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
		provideCoreCapabilities(host),
		provideCoreUserResources(host, options.productOptions?.userResources),
	];
	if (options.productOptions?.web) {
		const webProductModule = "../core/web-product.js";
		const { provideCoreWebProduct } = await import(webProductModule) as typeof import("../core/web-product.js");
		coreServiceDisposers.push(provideCoreWebProduct(host, options.productOptions.web));
	}

	try {
		// Packaged backends resolve against this product version. Upgrade their
		// managed manifests before importing any persisted backend definition.
		if (initialState.state === "idle") await host.start({ plugins: [] });
		if (cutover) {
			for (const target of cutover.targets.filter((entry) => entry.state !== "active")) {
				const existing = data.plugins.getInstallation(target.pluginId);
				if (existing?.enabled || (existing && !["installed", "uninstalled"].includes(existing.state))) throw new Error(`Prepared cutover preserves ${target.pluginId} as ${target.state}, but the target store already has it enabled in ${existing.state}; disable or uninstall that target explicitly before retrying`);
			}
			for (const target of cutover.targets.filter((entry) => entry.state === "active")) {
				const source = { kind: "package" as const, path: target.path, name: target.package, version: target.version };
				const inspected = await manager.inspect(source);
				if (inspected.manifest.id !== target.pluginId || inspected.manifest.version !== target.version) throw new Error(`Prepared artifact ${target.package}@${target.version} resolved as ${inspected.manifest.id}@${inspected.manifest.version}; cutover refused`);
				let installation = data.plugins.getInstallation(target.pluginId);
				if (installation && installation.contentHash !== inspected.contentHash) throw new Error(`Target store already contains a different ${target.pluginId} artifact; retain both sources and reconcile before cutover`);
				if (!installation || installation.state === "uninstalled") {
					const installed = await manager.install(source, { expectedRevision: installation?.stateRevision ?? 0 });
					installation = installed.installation;
				}
				if (!installation) throw new Error(`Cutover did not create installation ${target.pluginId}`);
				if (["installed", "pending-activation", "failed"].includes(installation.state)) await manager.activate(target.pluginId, { expectedRevision: installation.stateRevision });
			}
			for (const pluginId of pibo4LegacyAggregateOwners(cutover)) {
				const legacy = data.plugins.getInstallation(pluginId);
				if (!legacy || legacy.state === "uninstalled") continue;
				if (host.inspect().plugins.some((plugin) => plugin.pluginId === pluginId)) throw new Error(`Legacy aggregate ${pluginId} is already active in the host; stop it before completing the Pibo 4 cutover`);
				data.plugins.putInstallation({ ...legacy, enabled: false, state: "uninstalled", pendingArtifact: undefined, diagnostic: "Superseded by prepared Pibo 4 package cutover", updatedAt: new Date().toISOString() }, legacy.stateRevision);
			}
		}
		if (options.installDefaultPlugins !== false) {
			const defaultPackagesModule = "./default-packages.js";
			const { ensureDefaultPluginInstallations } = await import(defaultPackagesModule) as typeof import("./default-packages.js");
			await ensureDefaultPluginInstallations(manager, artifactRoot, {
				includeWebProduct: options.includeWebProduct,
				activateExisting: async (installation) => {
					if (!host.inspect().plugins.some((plugin) => plugin.pluginId === installation.pluginId)) await lifecycle.activate(installation);
				},
			});
		}
		const activeIds = new Set(host.inspect().plugins.map((plugin) => plugin.pluginId));
		const installations = data.plugins.listInstallations().filter((installation) => installation.enabled && ["active", "pending-activation"].includes(installation.state) && !activeIds.has(installation.pluginId));
		for (const installation of installations) await verifyPluginArtifact(installation);
		if (installations.length) {
			await preparePluginSdkResolution(artifactRoot);
			await host.add({ plugins: installations.map(createStagedPluginDefinition) });
			for (const installation of installations) ownedPluginIds.add(installation.pluginId);
		}
		if (cutover && options.cutoverPlanPath) await writePibo4CutoverReceipt(options.cutoverPlanPath, cutover);
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
