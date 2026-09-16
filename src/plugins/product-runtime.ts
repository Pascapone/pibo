import { PiboDataStore } from "../data/pibo-store.js";
import { piboHomePath } from "../core/pibo-home.js";
import { PluginRuntimeCoordinator } from "../agent-runtime/plugin-plan.js";
import type { PluginHost } from "./host.js";
import { PluginManager, type PluginManagerLifecycle } from "./manager.js";
import { handoffPluginSdkResolutionAtStoppedBoundary, preparePluginSdkResolution } from "./backend-loader.js";
import { createStagedPluginDefinition } from "./staged-definition.js";
import { verifyPluginArtifact, type PluginSourceInput } from "./sources.js";
import type { PluginConsumerCollector } from "./operations.js";
import { PIBO_CHAT_EXTENSION_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, PLUGIN_HOST_SERVICE, PLUGIN_MANAGEMENT_SERVICE, PLUGIN_SESSION_PLAN_SERVICE, PiboChatExtensionRegistry, type PiboPluginProductOptions, type PluginSessionPlanReader } from "./product-services.js";
import type { PluginInstallation } from "./manifest.js";
import { prepareCoreUserResources } from "../core/user-resources.js";
import { provideCoreCapabilities } from "../core/capabilities.js";
import { verifyPreparedPibo4Cutover, writePibo4CutoverReceipt, type Pibo4CutoverArtifactBinding, type Pibo4CutoverPlan } from "./cutover-contract.js";

const RETIRED_CORE_PLUGIN_IDS = ["pibo.agent-delegation"] as const;

function retireCoreOwnedPluginInstallations(data: PiboDataStore): void {
	for (const pluginId of RETIRED_CORE_PLUGIN_IDS) {
		const installation = data.plugins.getInstallation(pluginId);
		if (!installation || installation.state === "uninstalled") continue;
		if (data.plugins.listAdmissions(pluginId).length > 0) {
			throw new Error(`Retired plugin ${pluginId} still has generation admissions; recover those stopped-process admissions before upgrading`);
		}
		data.plugins.putInstallation({
			...installation,
			enabled: false,
			state: "uninstalled",
			pendingArtifact: undefined,
			diagnostic: "Capability moved into Pibo Core",
			updatedAt: new Date().toISOString(),
		}, installation.stateRevision);
	}
}

/** Product wiring exposes core services without manufacturing a plugin installation. */
export async function startPluginProductRuntime(options: {
	host: PluginHost;
	data?: PiboDataStore;
	artifactRoot?: string;
	collectConsumers?: PluginConsumerCollector;
	readSessionPlan?: PluginSessionPlanReader;
	productOptions?: PiboPluginProductOptions;
	installDefaultPlugins?: boolean;
	/** Package or local sources supplied by an executable composition. Missing sources are installed and activated in declaration order. */
	bootstrapPluginSources?: readonly PluginSourceInput[];
	includeWebProduct?: boolean;
	requirePreparedCutover?: boolean;
	cutoverPlanPath?: string;
	cutoverArtifactBindings?: readonly Pibo4CutoverArtifactBinding[];
	verifyCutoverSourceArtifact?: boolean;
	currentCoreVersion?: string;
	provideWebProduct?: (host: PluginHost, options: NonNullable<PiboPluginProductOptions["web"]>) => () => void | Promise<void>;
}) {
	let cutover: Pibo4CutoverPlan | undefined;
	if (options.requirePreparedCutover || options.cutoverPlanPath) {
		if (!options.cutoverPlanPath) throw new Error("Pibo 4 cutover is required. Run the cutover preparation tool against the retained old package and pass cutoverPlanPath before starting Minimal-Core");
		cutover = await verifyPreparedPibo4Cutover(options.cutoverPlanPath, {
			targetArtifacts: options.cutoverArtifactBindings,
			verifySourceArtifact: options.verifyCutoverSourceArtifact,
		});
		if (!options.currentCoreVersion || options.currentCoreVersion !== cutover.targetCore.version) throw new Error(`Prepared cutover targets @pasko70/pibo@${cutover.targetCore.version}, but the starting Minimal-Core version is ${options.currentCoreVersion ?? "unknown"}; install the exact prepared core tarball`);
		if (options.installDefaultPlugins !== false) throw new Error("Prepared cutover requires installDefaultPlugins=false so disabled or uninstalled legacy features cannot be re-enabled by defaults");
	}
	const ownsData = options.data === undefined;
	const data = options.data ?? new PiboDataStore();
	retireCoreOwnedPluginInstallations(data);
	const artifactRoot = options.artifactRoot ?? piboHomePath("plugins", "artifacts");
	const host = options.host;
	const initialState = host.inspect();
	const activeLegacyInstallations = data.plugins.listInstallations().filter((installation) => installation.source.kind === "builtin" && installation.enabled && installation.state !== "uninstalled");
	if (activeLegacyInstallations.length && !cutover) {
		if (ownsData) data.close();
		throw new Error(`Legacy built-in plugin installations require a prepared Pibo 4 cutover before startup: ${activeLegacyInstallations.map((entry) => entry.pluginId).join(", ")}. Restore the old package if necessary, run the packaged cutover preparation command, then retry with cutoverPlanPath`);
	}
	if (cutover) {
		if (initialState.state !== "idle") {
			if (ownsData) data.close();
			throw new Error(`Prepared cutover requires an idle/stopped PluginHost before host.start; found ${initialState.state}`);
		}
		const preparedOwners = new Set([...cutover.supersededOwners, ...cutover.targets.map((target) => target.pluginId)]);
		const unpreparedOwners = activeLegacyInstallations.filter((installation) => !preparedOwners.has(installation.pluginId));
		if (unpreparedOwners.length) {
			if (ownsData) data.close();
			throw new Error(`Prepared cutover does not include active legacy owners: ${unpreparedOwners.map((entry) => entry.pluginId).join(", ")}`);
		}
		await handoffPluginSdkResolutionAtStoppedBoundary(artifactRoot, host);
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
		async activateBatch(artifacts) {
			for (const artifact of artifacts) await verifyPluginArtifact(artifact);
			await preparePluginSdkResolution(artifactRoot);
			await host.add({ plugins: artifacts.map((artifact) => createStagedPluginDefinition({ ...artifact, state: "active", enabled: true, stateRevision: 1 })) });
			for (const artifact of artifacts) ownedPluginIds.add(artifact.pluginId);
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
	const manager = new PluginManager({
		store: data.plugins,
		artifactRoot,
		lifecycle,
		collectConsumers: options.collectConsumers,
		coreServices: () => host.coreServiceDeclarations(),
		excludedInstallationIds: cutover ? new Set(cutover.supersededOwners) : undefined,
	});
	const runtime = new PluginRuntimeCoordinator({ host, manager, store: data.plugins });
	const chatExtensions = new PiboChatExtensionRegistry();
	const coreUserResources = prepareCoreUserResources(host, options.productOptions?.userResources);
	const coreServiceDisposers = [
		host.provideCoreService({ id: PLUGIN_HOST_SERVICE, version: "1.0.0", value: host }),
		host.provideCoreService({ id: PLUGIN_MANAGEMENT_SERVICE, version: "1.0.0", value: manager }),
		host.provideCoreService({ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", value: Object.freeze({ ...options.productOptions }) }),
		host.provideCoreService({ id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0", value: chatExtensions }),
		...(options.readSessionPlan ? [host.provideCoreService({ id: PLUGIN_SESSION_PLAN_SERVICE, version: "1.0.0", value: options.readSessionPlan })] : []),
		provideCoreCapabilities(host),
		() => coreUserResources.dispose(),
	];
	if (options.productOptions?.web) {
		if (options.provideWebProduct) {
			coreServiceDisposers.push(options.provideWebProduct(host, options.productOptions.web));
		} else {
			const webProductModule = "../core/web-product.js";
			const { provideCoreWebProduct } = await import(webProductModule) as typeof import("../core/web-product.js");
			coreServiceDisposers.push(provideCoreWebProduct(host, options.productOptions.web));
		}
	}

	let cutoverTransactionOpen = false;
	try {
		// Packaged backends resolve against this product version. Upgrade their
		// managed manifests before importing any persisted backend definition.
		if (initialState.state === "idle") await host.start({ plugins: [] });
		if (cutover) {
			data.db.exec("BEGIN IMMEDIATE");
			cutoverTransactionOpen = true;
			const coldActivations: { pluginId: string; expectedRevision: number }[] = [];
			for (const target of cutover.targets.filter((entry) => entry.state !== "active")) {
				let existing = data.plugins.getInstallation(target.pluginId);
				if (existing?.enabled || (existing && !["installed", "uninstalled"].includes(existing.state))) throw new Error(`Prepared cutover preserves ${target.pluginId} as ${target.state}, but the target store already has it enabled in ${existing.state}; disable or uninstall that target explicitly before retrying`);
				const source = { kind: "package" as const, path: target.path, name: target.package, version: target.version };
				const inspected = await manager.inspect(source);
				if (inspected.manifest.id !== target.pluginId || inspected.manifest.version !== target.version) throw new Error(`Prepared artifact ${target.package}@${target.version} does not match disabled or uninstalled target ${target.pluginId}; cutover refused`);
				if (!existing || existing.contentHash !== inspected.contentHash || (target.state === "disabled" && existing.state === "uninstalled")) {
					const installed = await manager.install(source, { expectedRevision: existing?.stateRevision ?? 0 });
					existing = installed.installation;
				}
				if (!existing) throw new Error(`Cutover did not materialize preserved target ${target.pluginId}`);
				if (target.state === "uninstalled" && existing.state !== "uninstalled") {
					existing = data.plugins.putInstallation({ ...existing, enabled: false, state: "uninstalled", updatedAt: new Date().toISOString() }, existing.stateRevision);
				}
			}
			for (const target of cutover.targets.filter((entry) => entry.state === "active")) {
				const source = { kind: "package" as const, path: target.path, name: target.package, version: target.version };
				const inspected = await manager.inspect(source);
				if (inspected.manifest.id !== target.pluginId || inspected.manifest.version !== target.version) throw new Error(`Prepared artifact ${target.package}@${target.version} resolved as ${inspected.manifest.id}@${inspected.manifest.version}; cutover refused`);
				let installation = data.plugins.getInstallation(target.pluginId);
				if (!installation || installation.state === "uninstalled" || installation.contentHash !== inspected.contentHash) {
					const installed = await manager.install(source, { expectedRevision: installation?.stateRevision ?? 0 });
					installation = installed.installation;
				}
				if (!installation) throw new Error(`Cutover did not create installation ${target.pluginId}`);
				if (["installed", "pending-activation", "failed"].includes(installation.state)) coldActivations.push({ pluginId: target.pluginId, expectedRevision: installation.stateRevision });
			}
			const activations = await manager.activateColdReplacements(coldActivations);
			if (activations.some((activation) => activation.state !== "complete")) throw new Error(`Cutover plugin activation batch did not complete: ${activations.map((activation) => `${activation.pluginId}:${activation.state}`).join(", ")}`);
			for (const pluginId of cutover.supersededOwners) {
				const legacy = data.plugins.getInstallation(pluginId);
				if (!legacy || legacy.state === "uninstalled") continue;
				if (host.inspect().plugins.some((plugin) => plugin.pluginId === pluginId)) throw new Error(`Legacy aggregate ${pluginId} is already active in the host; stop it before completing the Pibo 4 cutover`);
				data.plugins.putInstallation({ ...legacy, enabled: false, state: "uninstalled", pendingArtifact: undefined, diagnostic: "Superseded by prepared Pibo 4 package cutover", updatedAt: new Date().toISOString() }, legacy.stateRevision);
			}
		}
		if (options.bootstrapPluginSources) {
			for (const source of options.bootstrapPluginSources) {
				const inspected = await manager.inspect(source);
				const existing = data.plugins.getInstallation(inspected.manifest.id);
				if (existing) continue;
				const installed = await manager.install(source, { expectedRevision: 0 });
				if (!installed.installation) throw new Error(`Bootstrap plugin ${inspected.manifest.id} was not installed`);
				const activation = await manager.activate(inspected.manifest.id, { expectedRevision: installed.installation.stateRevision });
				if (activation.state !== "complete") throw new Error(`Bootstrap plugin ${inspected.manifest.id} activation did not complete: ${activation.state}`);
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
		coreUserResources.initialize();
		if (cutoverTransactionOpen) {
			data.db.exec("COMMIT");
			cutoverTransactionOpen = false;
		}
		if (cutover && options.cutoverPlanPath) await writePibo4CutoverReceipt(options.cutoverPlanPath, cutover);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		if (cutoverTransactionOpen) {
			try { data.db.exec("ROLLBACK"); cutoverTransactionOpen = false; } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		}
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
