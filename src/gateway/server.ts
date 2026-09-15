import { startPluginProductRuntime } from "../plugins/product-runtime.js";
import { createPluginConsumerCollector, pluginImpact, type PluginConsumer, type PluginConsumerCollector } from "../plugins/operations.js";
import { catalogPluginServices, PIBO_MESSAGE_PREFLIGHT_SERVICE, PIBO_USER_RESOURCES_SERVICE, PLUGIN_CONSUMER_COLLECTOR_RESOURCE, type PiboMessagePreflight, type PiboPluginProductOptions, type PiboUserResourcesService, type PluginOwnedConsumerCollector } from "../plugins/product-services.js";
import { CustomAgentStore, createDefaultCustomAgentStore, migrateLegacyAgentsAtStartup, profileConsumerCollector } from "../apps/chat/agent-store.js";
import { createCustomAgentProfileDefinition } from "../apps/chat/agent-profiles.js";
import { PiboDataStore } from "../data/pibo-store.js";
import { migrateLegacySessionDatabaseAtStartup } from "../data/legacy-session-upgrade.js";
import { PiboDataSessionStore } from "../sessions/pibo-data-store.js";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { createPiboProfileFromCapabilitiesOrDefault, resolvePiboProfileNameFromCapabilitiesOrDefault } from "../plugins/builtin.js";
import { authorizeAgentRuntimeHistoryProof } from "../agent-runtime/history-authority.js";
import { PiboCapabilityHost } from "../core/capability-host.js";
import { PIBO_RUNTIME_UNASSIGNED_ADAPTER_ID, PIBO_RUNTIME_UNASSIGNED_INSTANCE_ID } from "../core/runtime-unassigned.js";
import { PiboSessionRouter } from "../core/session-router.js";
import { loadPiboModelDefaults, selectRequestedModelProfile } from "../core/model-defaults.js";
import type { ResourceReaperService, ResourceReaperServiceOptions } from "../resources/reaper.js";
import { InMemoryPiboSessionStore, type PiboSessionStore } from "../sessions/store.js";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	errorResponse,
	isGatewayRequestFrame,
	isGatewaySubscribeFrame,
	type GatewayFrame,
	type GatewayResponseFrame,
	type GatewaySubscription,
} from "./protocol.js";
import { releaseFallbackGatewayPid, releaseGatewayPid, writeFallbackGatewayPid, writeGatewayPid } from "./pidfile.js";
import { piboHomePath } from "../core/pibo-home.js";
import { provideCoreWebProduct } from "../core/web-product.js";
import type { PluginSourceInput } from "../plugins/sources.js";

export type GatewayServerOptions = {
	host?: string;
	port?: number;
	persistSession?: boolean;
	/** Whether this process owns persistent gateway runtime state and may reconcile interrupted work. */
	authoritativeRuntime?: boolean;
	/** Stable identifier included in recovery diagnostics. */
	runtimeInstanceId?: string;
	capabilityHost?: PiboCapabilityHost;
	sessionStore?: PiboSessionStore;
	sessionDbPath?: string;
	/** Shared pibo.sqlite path for sessions, plugin state and product projections. */
	dataStorePath?: string;
	/** Existing Custom Agent owner store used for complete plugin impact collection. */
	agentStorePath?: string;
	dataPayloadRootDir?: string;
	/** Immutable installed-plugin artifact root and packaged built-in sources. */
	pluginArtifactRoot?: string;
	startChannels?: boolean;
	maxBackpressureFrames?: number;
	maxBackpressureBytes?: number;
	resourceReaper?: ResourceReaperServiceOptions | false;
	loopStorePath?: string;
	pluginProductOptions?: PiboPluginProductOptions;
	includeWebProduct?: boolean;
	/** Install repository-packaged defaults. Generated Minimal-Core executables set this to false. */
	installDefaultPlugins?: boolean;
	/** Generic executable-composition sources installed and activated before persisted plugins are restored. */
	bootstrapPluginSources?: readonly PluginSourceInput[];
};

type GatewayQueuedFrame = {
	frame: GatewayFrame;
	bytes: number;
	droppable: boolean;
};

export type GatewayConnectionDiagnostics = {
	slow: boolean;
	queuedFrames: number;
	queuedBytes: number;
	droppedEvents: number;
	closedForBackpressure: boolean;
	subscription: GatewaySubscription;
};

export type GatewayDiagnostics = {
	runtimeInstanceId: string;
	authoritativeRuntime: boolean;
	connections: number;
	slowConnections: number;
	droppedEvents: number;
	closedSlowClients: number;
	connectionDetails: GatewayConnectionDiagnostics[];
};

type GatewayConnection = {
	socket: Socket;
	subscription: GatewaySubscription;
	readonly diagnostics: GatewayConnectionDiagnostics;
	send: (frame: GatewayFrame, options?: { droppable?: boolean }) => void;
	matches: (event: PiboOutputEvent) => boolean;
};

const DEFAULT_MAX_BACKPRESSURE_FRAMES = 1_000;
const DEFAULT_MAX_BACKPRESSURE_BYTES = 4 * 1024 * 1024;

function parseJsonLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		throw new Error("Invalid JSON frame");
	}
}

function classifyGatewayEvent(event: PiboOutputEvent): "critical" | "structural" | "live-delta" | "debug" {
	if (event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated") {
		return "live-delta";
	}
	if (event.type === "pi_event") return "debug";
	if (event.type === "session_error" || event.type === "execution_result" || event.type.endsWith("_finished")) {
		return "critical";
	}
	return "structural";
}

function isDroppableRouterEvent(event: PiboOutputEvent): boolean {
	const eventClass = classifyGatewayEvent(event);
	return eventClass === "live-delta" || eventClass === "debug";
}

function createConnection(
	socket: Socket,
	options: {
		maxBackpressureFrames: number;
		maxBackpressureBytes: number;
		onDroppedEvent: () => void;
		onClosedForBackpressure: () => void;
	},
): GatewayConnection {
	const queue: GatewayQueuedFrame[] = [];
	const diagnostics: GatewayConnectionDiagnostics = {
		slow: false,
		queuedFrames: 0,
		queuedBytes: 0,
		droppedEvents: 0,
		closedForBackpressure: false,
		subscription: { type: "legacy-all" },
	};

	function syncDiagnostics(): void {
		diagnostics.queuedFrames = queue.length;
		diagnostics.queuedBytes = queue.reduce((sum, item) => sum + item.bytes, 0);
	}

	function recordDroppedEvent(): void {
		diagnostics.droppedEvents += 1;
		options.onDroppedEvent();
	}

	function closeForBackpressure(): void {
		if (!diagnostics.closedForBackpressure) {
			diagnostics.closedForBackpressure = true;
			options.onClosedForBackpressure();
		}
		socket.destroy(new Error("Gateway client closed because its send backlog exceeded the backpressure limit"));
	}

	function tryFlush(): void {
		if (socket.destroyed) return;
		diagnostics.slow = false;
		while (queue.length > 0) {
			const next = queue[0]!;
			const accepted = socket.write(encodeFrame(next.frame));
			queue.shift();
			syncDiagnostics();
			if (!accepted) {
				diagnostics.slow = true;
				return;
			}
		}
	}

	socket.on("drain", tryFlush);

	const connection: GatewayConnection = {
		socket,
		subscription: diagnostics.subscription,
		diagnostics,
		send(frame, sendOptions = {}) {
			if (socket.destroyed) return;
			const encoded = encodeFrame(frame);
			if (!diagnostics.slow && queue.length === 0) {
				const accepted = socket.write(encoded);
				if (accepted) return;
				diagnostics.slow = true;
			}

			const queued: GatewayQueuedFrame = { frame, bytes: Buffer.byteLength(encoded), droppable: sendOptions.droppable === true };
			if (queued.droppable && (queue.length >= options.maxBackpressureFrames || diagnostics.queuedBytes + queued.bytes > options.maxBackpressureBytes)) {
				recordDroppedEvent();
				return;
			}
			queue.push(queued);
			syncDiagnostics();

			if (queue.length > options.maxBackpressureFrames || diagnostics.queuedBytes > options.maxBackpressureBytes) {
				const dropIndex = queue.findIndex((item) => item.droppable);
				if (dropIndex >= 0) {
					queue.splice(dropIndex, 1);
					recordDroppedEvent();
					syncDiagnostics();
				} else {
					closeForBackpressure();
				}
			}
		},
		matches(event) {
			if (connection.subscription.type === "legacy-all") return true;
			return event.piboSessionId === connection.subscription.piboSessionId;
		},
	};

	return connection;
}

const PIBO_V4_RUNTIME_BINDING_MIGRATION_KEY = "pibo4RuntimeBindingMigrated";

export function migrateSessionRuntimeBindingsAtStartup(store: PiboSessionStore): number {
	if (!store.list || !store.updateRuntimeBinding) return 0;
	let migrated = 0;
	for (const session of store.list()) {
		const binding = store.getRuntimeBinding?.(session.id) ?? session.runtimeBinding;
		if (!binding || binding.metadata?.[PIBO_V4_RUNTIME_BINDING_MIGRATION_KEY] === true) continue;
		const next = {
			...binding,
			metadata: { ...(binding.metadata ?? {}), [PIBO_V4_RUNTIME_BINDING_MIGRATION_KEY]: true },
		};
		const updated = store.updateRuntimeBinding(session.id, next, { expectedRevision: binding.revision ?? 1, mode: "repair" });
		if (!updated) throw new Error(`Could not persist Pibo 4.0 runtime binding migration for session ${session.id}`);
		migrated += 1;
	}
	return migrated;
}

async function createGatewaySessionStore(options: GatewayServerOptions): Promise<PiboSessionStore> {
	if (options.sessionDbPath) {
		const { SqlitePiboSessionStore } = await import("../sessions/sqlite-store.js");
		return new SqlitePiboSessionStore(options.sessionDbPath);
	}
	if (options.persistSession === false) return new InMemoryPiboSessionStore();
	const targetPath = options.dataStorePath ?? piboHomePath("pibo.sqlite");
	const sourcePath = join(dirname(targetPath), "pibo-sessions.sqlite");
	const migration = await migrateLegacySessionDatabaseAtStartup({ sourcePath, targetPath });
	for (const blocked of migration.blocked) {
		console.error(`[pibo] Automatic Pibo 4.0 session migration blocked for ${blocked.piboSessionId}: ${blocked.diagnostic}. ${blocked.repair}`);
	}
	return new PiboDataSessionStore(targetPath);
}

function registeredProfileConsumers(registry: PiboCapabilityHost, pluginId: string): PluginConsumer[] {
	const consumers: PluginConsumer[] = [];
	for (const info of registry.getProfileInfos()) {
		const profile = createPiboProfileFromCapabilitiesOrDefault(registry, info.name);
		const entry = profile.pluginSelection?.plugins.find((candidate) => candidate.pluginId === pluginId);
		if (!entry) continue;
		consumers.push({
			kind: "profile",
			id: info.name,
			usage: entry.enabled ? "optional" : "historical",
			revision: entry.revision,
		});
	}
	return consumers;
}

export class PiboGatewayServer {
	private readonly capabilityHost: PiboCapabilityHost;
	private readonly ownsPluginRegistry: boolean;
	private readonly runtimeInstanceId: string;
	private sessionStore?: PiboSessionStore;
	private ownsSessionStore = false;
	private pluginData?: PiboDataStore;
	private ownsPluginData = false;
	private pluginAgentStore?: CustomAgentStore;
	private router?: PiboSessionRouter;
	private pluginProduct?: Awaited<ReturnType<typeof startPluginProductRuntime>>;
	private readonly startedChannels: PiboChannel[] = [];
	private readonly connections = new Set<GatewayConnection>();
	private droppedRouterEvents = 0;
	private closedSlowClients = 0;
	private server?: Server;
	private unsubscribe?: () => void;
	private resourceReaper?: ResourceReaperService;

	constructor(private readonly options: GatewayServerOptions = {}) {
		this.ownsPluginRegistry = options.capabilityHost === undefined;
		this.capabilityHost = options.capabilityHost ?? PiboCapabilityHost.create();
		this.runtimeInstanceId = options.runtimeInstanceId ?? `gateway:${process.pid}:${randomUUID()}`;
	}

	async start(): Promise<void> {
		if (this.server) return;

		try {
		this.validateChannels();
		this.sessionStore = this.options.sessionStore ?? (await createGatewaySessionStore(this.options));
		this.ownsSessionStore = !this.options.sessionStore;
		migrateSessionRuntimeBindingsAtStartup(this.sessionStore);
		const hasExplicitPersistentStore = this.options.sessionStore !== undefined || this.options.sessionDbPath !== undefined;
		const recoverInterruptedRuntimeState = this.options.authoritativeRuntime === true
			&& (this.options.persistSession !== false || hasExplicitPersistentStore);
		if (this.sessionStore instanceof PiboDataSessionStore) {
			this.pluginData = this.sessionStore.getDataStore();
			this.ownsPluginData = false;
		} else {
			this.pluginData = new PiboDataStore(this.options.persistSession === false ? ":memory:" : this.options.dataStorePath);
			this.ownsPluginData = true;
		}
		this.pluginAgentStore = this.options.persistSession === false && !this.options.agentStorePath
			? new CustomAgentStore(":memory:")
			: this.options.agentStorePath
				? new CustomAgentStore(this.options.agentStorePath)
				: createDefaultCustomAgentStore();
		const host = this.capabilityHost.getPluginHost();
		const catalog = () => {
			const installations = this.pluginData!.plugins.listInstallations();
			return { schemaVersion: 1 as const, revision: installations.reduce((sum, installation) => sum + installation.stateRevision, 0), installations };
		};
		const collectProfiles = profileConsumerCollector(this.pluginAgentStore, catalog);
		const collectLive: PluginConsumerCollector = async (pluginId) => {
			const consumers = [...(this.router?.collectPluginConsumers(pluginId) ?? []), ...registeredProfileConsumers(this.capabilityHost, pluginId)];
			for (const entry of host.contributions.list<PluginOwnedConsumerCollector>(PLUGIN_CONSUMER_COLLECTOR_RESOURCE)) {
				consumers.push(...await entry.value(pluginId));
			}
			return pluginImpact(consumers).consumers;
		};
		this.pluginProduct = await startPluginProductRuntime({
			host,
			data: this.pluginData,
			artifactRoot: this.options.pluginArtifactRoot,
			productOptions: {
				...this.options.pluginProductOptions,
				loopStorePath: this.options.loopStorePath,
				dataStorePath: this.options.dataStorePath,
				dataPayloadRootDir: this.options.dataPayloadRootDir,
				userResources: { contextFilesMode: "catalog", userSkills: {}, customAgents: { agentStorePath: this.options.agentStorePath }, ...this.options.pluginProductOptions?.userResources },
			},
			includeWebProduct: this.options.includeWebProduct,
			installDefaultPlugins: this.options.installDefaultPlugins,
			bootstrapPluginSources: this.options.bootstrapPluginSources,
			provideWebProduct: provideCoreWebProduct,
			collectConsumers: createPluginConsumerCollector({ store: this.pluginData, collectLive, collectProfiles }),
			readSessionPlan: (piboSessionId, kind) => {
				if (!this.router) throw new Error("Plugin session plan service is not ready");
				return this.router.readPluginSessionPlan(piboSessionId, kind);
			},
		});
		const installations = this.pluginData.plugins.listInstallations();
		const capabilityCatalog = this.capabilityHost.getCapabilityCatalog();
		const serviceState = catalogPluginServices(host, installations);
		const migrationResults = await migrateLegacyAgentsAtStartup({
			agents: this.pluginAgentStore,
			plugins: this.pluginData.plugins,
			catalog: { schemaVersion: 1, revision: installations.reduce((sum, installation) => sum + installation.stateRevision, 0), installations },
			legacyCatalog: {
				nativeTools: capabilityCatalog.nativeTools,
				skills: capabilityCatalog.skills,
				contextFiles: capabilityCatalog.contextFiles,
			},
			backupRoot: piboHomePath("plugins", "migration-backups", "pibo-4", "agents"),
			...serviceState,
			resolveRuntime: (instanceId) => {
				const adapter = this.capabilityHost.getAgentRuntimeAdapter(instanceId);
				if (!adapter?.enabled) throw new Error(`Stored agent runtime instance "${instanceId}" is unavailable during Pibo 4.0 migration`);
				return { adapterId: adapter.descriptor.id, instanceId: adapter.instanceId, capabilities: adapter.descriptor.capabilities as unknown as import("../plugins/manifest.js").PluginJsonObject };
			},
		});
		const userResources = host.services.require<PiboUserResourcesService>(PIBO_USER_RESOURCES_SERVICE);
		for (const result of migrationResults) {
			const migrated = this.pluginAgentStore.get(result.agentId);
			if (migrated && !migrated.archivedAt) userResources.upsertProfile(createCustomAgentProfileDefinition(migrated));
			if (result.status === "blocked") console.error(`[pibo] Pibo 4.0 migration blocked for ${result.profileName}; source is backed up and runtime admission remains disabled${result.diagnostic ? ` (${result.diagnostic})` : ""}`);
		}
		this.router = new PiboSessionRouter({
			pluginRuntime: this.pluginProduct.runtime,
			persistSession: this.options.persistSession,
			capabilityHost: this.capabilityHost,
			sessionStore: this.sessionStore,
			messagePreflight: async (event) => {
				const preflight = host.services.get<PiboMessagePreflight>(PIBO_MESSAGE_PREFLIGHT_SERVICE);
				return preflight ? await preflight(event) : { allowed: true };
			},
			goalStorePath: this.options.loopStorePath,
			recoverInterruptedRuntimeState,
			runtimeInstanceId: recoverInterruptedRuntimeState ? this.runtimeInstanceId : undefined,
		});
		await this.pluginProduct.recover();
		this.unsubscribe = this.router.subscribe((event) => this.broadcastRouterEvent(event));
		this.server = createServer((socket) => this.handleSocket(socket));
		await this.capabilityHost.getAuthService()?.start?.();

		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(this.options.port ?? DEFAULT_GATEWAY_PORT, this.options.host ?? DEFAULT_GATEWAY_HOST, () => {
				this.server!.off("error", reject);
				resolve();
			});
		});

		if (this.options.startChannels !== false) {
			await this.startChannels();
		}
		if (this.options.resourceReaper) {
			const resourceReaperModule = "../resources/reaper.js";
			const { ResourceReaperService } = await import(resourceReaperModule) as typeof import("../resources/reaper.js");
			this.resourceReaper = new ResourceReaperService(this.options.resourceReaper);
			await this.resourceReaper.start();
		}
		} catch (error) {
			try { await this.stop(); }
			catch (cleanupError) { throw new AggregateError([error, cleanupError], "Gateway startup and cleanup failed"); }
			throw error;
		}
	}

	async stop(): Promise<void> {
		await this.resourceReaper?.stop();
		this.resourceReaper = undefined;
		await this.stopChannels();
		await this.capabilityHost.getAuthService()?.stop?.();

		this.unsubscribe?.();
		this.unsubscribe = undefined;

		for (const connection of this.connections) {
			connection.socket.destroy();
		}
		this.connections.clear();

		if (this.server) {
			await new Promise<void>((resolve, reject) => {
				this.server!.close((error) => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
			});
			this.server = undefined;
		}

		await this.router?.disposeAll();
		this.router = undefined;
		await this.capabilityHost.disposeAgentRuntimeAuth();
		await this.pluginProduct?.dispose();
		this.pluginProduct = undefined;
		this.pluginAgentStore?.close();
		this.pluginAgentStore = undefined;

		const ownedPluginRegistries = this.ownsPluginRegistry
			? [this.capabilityHost]
			: [];
		for (const registry of ownedPluginRegistries) {
			for (const app of registry.getWebApps()) await app.dispose?.();
		}
		await Promise.allSettled(
			[this.capabilityHost]
				.map(async (registry) => await registry.disposeSpeechProviders()),
		);

		if (this.ownsSessionStore) {
			this.sessionStore?.close?.();
		}
		this.sessionStore = undefined;
		this.ownsSessionStore = false;
		if (this.ownsPluginData) this.pluginData?.close();
		this.pluginData = undefined;
		this.ownsPluginData = false;
	}

	private handleSocket(socket: Socket): void {
		const connection = createConnection(socket, {
			maxBackpressureFrames: this.options.maxBackpressureFrames ?? DEFAULT_MAX_BACKPRESSURE_FRAMES,
			maxBackpressureBytes: this.options.maxBackpressureBytes ?? DEFAULT_MAX_BACKPRESSURE_BYTES,
			onDroppedEvent: () => {
				this.droppedRouterEvents += 1;
			},
			onClosedForBackpressure: () => {
				this.closedSlowClients += 1;
			},
		});
		this.connections.add(connection);

		let buffer = "";
		socket.setEncoding("utf-8");

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					void this.handleLine(connection, line);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});

		socket.once("close", () => {
			this.connections.delete(connection);
		});
		socket.once("error", () => {
			this.connections.delete(connection);
		});
	}

	private async handleLine(connection: GatewayConnection, line: string): Promise<void> {
		let frame: unknown;
		try {
			frame = parseJsonLine(line);
		} catch (error) {
			connection.send(errorResponse("invalid", error));
			return;
		}

		if (isGatewaySubscribeFrame(frame)) {
			connection.subscription = frame.subscription;
			connection.diagnostics.subscription = frame.subscription;
			connection.send({ type: "res", id: frame.id, ok: true, payload: { subscription: frame.subscription } });
			return;
		}

		if (!isGatewayRequestFrame(frame)) {
			connection.send(errorResponse("invalid", new Error("Invalid request frame")));
			return;
		}

		try {
			const output = await this.requireRouter().emit(frame.event);
			const response: GatewayResponseFrame = {
				type: "res",
				id: frame.id,
				ok: true,
				payload: output,
			};
			connection.send(response);
		} catch (error) {
			connection.send(errorResponse(frame.id, error));
		}
	}

	private broadcastRouterEvent(event: PiboOutputEvent): void {
		for (const connection of this.connections) {
			if (!connection.matches(event)) continue;
			connection.send({ type: "event", event: "router", payload: event }, { droppable: isDroppableRouterEvent(event) });
		}
	}

	getDiagnostics(): GatewayDiagnostics {
		const connectionDetails = [...this.connections].map((connection) => ({ ...connection.diagnostics }));
		return {
			runtimeInstanceId: this.runtimeInstanceId,
			authoritativeRuntime: this.options.authoritativeRuntime === true,
			connections: connectionDetails.length,
			slowConnections: connectionDetails.filter((connection) => connection.slow).length,
			droppedEvents: this.droppedRouterEvents,
			closedSlowClients: this.closedSlowClients,
			connectionDetails,
		};
	}

	private async startChannels(): Promise<void> {
		const context = this.createChannelContext();
		for (const channel of this.capabilityHost.getChannels()) {
			if (channel.auth.mode === "none") {
				console.error(`Warning: channel "${channel.name}" starts without auth`);
			}
			await channel.start(context);
			this.startedChannels.push(channel);
		}
	}

	private validateChannels(): void {
		for (const channel of this.capabilityHost.getChannels()) {
			if (channel.auth.mode === "required" && !this.capabilityHost.getAuthService()) {
				throw new Error(`Channel "${channel.name}" requires auth, but no auth service is registered`);
			}
		}
	}

	private async stopChannels(): Promise<void> {
		while (this.startedChannels.length > 0) {
			const channel = this.startedChannels.pop()!;
			await channel.stop?.();
		}
	}

	private createChannelContext(): PiboChannelContext {
		return {
			getService: <T>(id: string) => this.capabilityHost.getPluginHost().services.get<T>(id),
			emit: (event) => this.requireRouter().emit(event),
			subscribe: (listener) => this.requireRouter().subscribe(listener),
			getSession: (id) => this.requireSessionStore().get(id),
			createSession: (input) => {
				const profile = resolvePiboProfileNameFromCapabilitiesOrDefault(this.capabilityHost, input.profile);
				const profileContext = createPiboProfileFromCapabilitiesOrDefault(this.capabilityHost, profile);
				const runtimeAdapter = this.capabilityHost.getAgentRuntimeAdapter(profileContext.runtimeInstanceId);
				if (!runtimeAdapter) {
					if (this.capabilityHost.getCapabilityCatalog().agentRuntimes.length > 0 || input.runtimeBinding) {
						throw new Error(`Unknown agent runtime instance "${profileContext.runtimeInstanceId}".`);
					}
					return this.requireSessionStore().create({
						...input,
						profile,
						runtimeBinding: {
							runtimeInstanceId: PIBO_RUNTIME_UNASSIGNED_INSTANCE_ID,
							adapterId: PIBO_RUNTIME_UNASSIGNED_ADAPTER_ID,
							state: "unbound",
							metadata: { reason: "no-runtime-installed" },
						},
					});
				}
				const activeModel = input.activeModel ?? selectRequestedModelProfile(profileContext, loadPiboModelDefaults());
				return this.requireSessionStore().create({
					...input,
					profile,
					activeModel,
					runtimeBinding: input.runtimeBinding ?? {
						runtimeInstanceId: profileContext.runtimeInstanceId,
						adapterId: runtimeAdapter.descriptor.id,
						state: "unbound",
						protocol: runtimeAdapter.descriptor.protocol?.name,
					},
				});
			},
			updateSession: (id, input) => this.requireSessionStore().update(id, input),
			setLiveSessionActiveModel: (id, model) => this.requireRouter().setLiveSessionActiveModel(id, model),
			reportSessionError: (id, error, options) => this.requireRouter().reportSessionError(id, error, options),
			deleteSession: async (id) => {
				await this.requireRouter().disposeSession(id, "session deleted");
				return this.requireSessionStore().delete?.(id) ?? false;
			},
			findSessions: (input) => this.requireSessionStore().find(input),
			listSessions: () => this.requireSessionStore().list?.() ?? [],
			getSessionStructureRevision: () => this.requireSessionStore().getStructureRevision?.(),
			getSessionRuntimeBinding: (piboSessionId) => this.requireRouter().getSessionRuntimeBinding(piboSessionId),
			getSessionRuntimeProfile: (piboSessionId) => this.requireRouter().getSessionRuntimeProfile(piboSessionId),
			inspectSessionRuntimeHistory: async (piboSessionId) => {
				const session = this.requireSessionStore().get(piboSessionId);
				if (!session) throw new Error(`Pibo session "${piboSessionId}" was not found.`);
				const binding = this.requireRouter().getSessionRuntimeBinding(piboSessionId) ?? session.runtimeBinding;
				if (!binding) throw new Error(`Pibo session "${piboSessionId}" has no runtime binding.`);
				const adapter = this.capabilityHost.getAgentRuntimeAdapter(binding.runtimeInstanceId);
				if (!adapter) {
					return {
						runtimeInstanceId: binding.runtimeInstanceId,
						adapterId: binding.adapterId,
						bindingState: binding.state,
						available: false,
						diagnostics: [{
							severity: "error",
							code: "runtime_history_instance_unavailable",
							message: `Agent runtime instance "${binding.runtimeInstanceId}" is not registered in this gateway.`,
						}],
					};
				}
				if (!adapter.descriptor.capabilities.maintenance.history || !adapter.inspectHistory) {
					return {
						runtimeInstanceId: binding.runtimeInstanceId,
						adapterId: binding.adapterId,
						bindingState: binding.state,
						available: false,
						diagnostics: [{
							severity: "warning",
							code: "runtime_history_unsupported",
							message: `Agent runtime instance "${binding.runtimeInstanceId}" does not provide native history inspection.`,
						}],
					};
				}
				return await adapter.inspectHistory({ binding, workspace: session.workspace ?? process.cwd() });
			},
			readSessionRuntimeHistory: async (piboSessionId, input = {}) => {
				const session = this.requireSessionStore().get(piboSessionId);
				if (!session) throw new Error(`Pibo session "${piboSessionId}" was not found.`);
				const binding = this.requireRouter().getSessionRuntimeBinding(piboSessionId) ?? session.runtimeBinding;
				if (!binding) throw new Error(`Pibo session "${piboSessionId}" has no runtime binding.`);
				const adapter = this.capabilityHost.getAgentRuntimeAdapter(binding.runtimeInstanceId);
				if (!adapter?.descriptor.capabilities.maintenance.history || !adapter.readHistory) {
					throw new Error(`Agent runtime instance "${binding.runtimeInstanceId}" does not provide native history.`);
				}
				const page = await adapter.readHistory({
					binding,
					workspace: session.workspace ?? process.cwd(),
					cursor: input.cursor,
					beforeTimestamp: input.beforeTimestamp,
					limit: input.limit,
				});
				authorizeAgentRuntimeHistoryProof(adapter, page.reconciliationProof);
				return page;
			},
			rebindSessionRuntime: (piboSessionId, input) => this.requireRouter().rebindSessionRuntime(piboSessionId, input),
			getSessionRuntimeStatus: (piboSessionId) => this.requireRouter().getSessionRuntimeStatus(piboSessionId),
			getSessionStatusSnapshot: (piboSessionId, options) => this.requireRouter().getSessionStatusSnapshot(piboSessionId, options),
			getSessionForkCandidates: (piboSessionId) => this.requireRouter().getSessionForkCandidates(piboSessionId),
			listSessionRuntimeStatuses: () => this.requireRouter().listSessionRuntimeStatuses(),
			getRuntimeCapacityStatus: () => this.requireRouter().getRuntimeCapacityStatus(),
			listRuns: (options) => this.requireRouter().listRuns(options),
			getRunJobReliabilityStatus: () => this.requireRouter().getRunJobReliabilityStatus(),
			snapshotSignalSession: (piboSessionId) => this.requireRouter().snapshotSignalSession(piboSessionId),
			snapshotSignalTree: (rootPiboSessionId) => this.requireRouter().snapshotSignalTree(rootPiboSessionId),
			snapshotSignalStatuses: () => this.requireRouter().snapshotSignalStatuses(),
			subscribeSignalTree: (rootPiboSessionId, listener) => this.requireRouter().subscribeSignalTree(rootPiboSessionId, listener),
			subscribeSignalStatuses: (listener) => this.requireRouter().subscribeSignalStatuses(listener),
			getGatewayActions: () => this.capabilityHost.getGatewayActionInfos(),
			getProfiles: () => this.capabilityHost.getProfileInfos(),
			createProfile: (name) => this.capabilityHost.createProfile(name),
			getCapabilityCatalog: () => this.capabilityHost.getCapabilityCatalog(),
			getTranscriptionProviderInfos: () => this.capabilityHost.getTranscriptionProviderInfos(),
			transcribe: (providerId, input) => this.capabilityHost.transcribe(providerId, input),
			getSpeechProviderIds: () => this.capabilityHost.getSpeechProviderIds(),
			getSpeechProviderInfos: () => this.capabilityHost.getSpeechProviderInfos(),
			startSpeechSession: (providerId, input, options) => this.capabilityHost.startSpeechSession(providerId, input, options),
			speakSpeechSession: (sessionId, input) => this.capabilityHost.speakSpeechSession(sessionId, input),
			stopSpeechSession: (sessionId) => this.capabilityHost.stopSpeechSession(sessionId),
			inspectAgentRuntimeInstances: () => this.capabilityHost.inspectAgentRuntimeInstances(),
			getAgentRuntimeAuthStatus: (runtimeInstanceId) => this.requireRouter().getAgentRuntimeAuthStatus(runtimeInstanceId),
			startAgentRuntimeAuth: (runtimeInstanceId, input) => this.requireRouter().startAgentRuntimeAuth(runtimeInstanceId, input),
			completeAgentRuntimeAuth: (runtimeInstanceId, input) => this.requireRouter().completeAgentRuntimeAuth(runtimeInstanceId, input),
			cancelAgentRuntimeAuth: (runtimeInstanceId, input) => this.requireRouter().cancelAgentRuntimeAuth(runtimeInstanceId, input),
			logoutAgentRuntimeAuth: (runtimeInstanceId, input) => this.requireRouter().logoutAgentRuntimeAuth(runtimeInstanceId, input),
			validateAgentRuntimeProfile: (profile, workspace) => this.capabilityHost.validateAgentRuntimeProfile(profile, workspace),
			getLoopStopConditionDefinitions: () => this.capabilityHost.getLoopStopConditionDefinitions(),
			getLoopStopConditionInfos: () => this.capabilityHost.getLoopStopConditionInfos(),
			getRalphStopConditionDefinitions: () => this.capabilityHost.getLoopStopConditionDefinitions(),
			getRalphStopConditionInfos: () => this.capabilityHost.getLoopStopConditionInfos(),
			upsertProfile: (profile) => this.requireUserResources().upsertProfile(profile),
			removeProfile: (name) => this.requireUserResources().removeProfile(name),
			upsertContextFile: (contextFile) => this.requireUserResources().upsertContextFile(contextFile),
			removeContextFile: (key) => this.requireUserResources().removeContextFile(key),
			registerSkill: (skill) => this.requireUserResources().upsertSkill(skill),
			unregisterSkill: (name) => this.requireUserResources().removeSkill(name),
			emitProductEvent: (event) => this.capabilityHost.emitProductEvent(event),
			subscribeProductEvents: (listener) => this.capabilityHost.onProductEvent(listener),
			auth: this.capabilityHost.getAuthService(),
			getWebApps: () => this.capabilityHost.getWebApps(),
		};
	}

	private requireUserResources(): PiboUserResourcesService {
		return this.capabilityHost.getPluginHost().services.require<PiboUserResourcesService>(PIBO_USER_RESOURCES_SERVICE);
	}

	private requireRouter(): PiboSessionRouter {
		if (!this.router) throw new Error("Gateway router is not started");
		return this.router;
	}

	private requireSessionStore(): PiboSessionStore {
		if (!this.sessionStore) throw new Error("Gateway session store is not started");
		return this.sessionStore;
	}
}

export function resolveGatewayResourceReaperOptions(options: GatewayServerOptions): ResourceReaperServiceOptions | false {
	if (options.resourceReaper === false || process.env.PIBO_RESOURCE_REAPER_DISABLED === "1") return false;
	return options.resourceReaper ?? {};
}

export async function runGatewayServer(options: GatewayServerOptions = {}): Promise<void> {
	const fallbackMode = process.env.PIBO_FALLBACK_MODE === "1";
	try {
		if (fallbackMode) writeFallbackGatewayPid();
		else writeGatewayPid();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	const releasePid = fallbackMode ? releaseFallbackGatewayPid : releaseGatewayPid;
	let server: PiboGatewayServer;
	try {
		server = new PiboGatewayServer({
			...options,
			authoritativeRuntime: options.authoritativeRuntime ?? true,
			resourceReaper: resolveGatewayResourceReaperOptions(options),
		});
		await server.start();
	} catch (error) {
		releasePid();
		throw error;
	}

	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	console.error(`pibo gateway listening on ${host}:${port}`);

	const stop = async () => {
		try {
			await server.stop();
		} finally {
			releasePid();
		}
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
