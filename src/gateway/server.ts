import { createServer, type Server, type Socket } from "node:net";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { PiboSessionRouter } from "../core/session-router.js";
import { loadPiboModelDefaults, selectRequestedModelProfile } from "../core/model-defaults.js";
import type { PiboSessionStore } from "../sessions/store.js";
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
import { clearFallbackPidFile, clearPidFile, writeFallbackGatewayPid, writeGatewayPid } from "./pidfile.js";

export type GatewayServerOptions = {
	host?: string;
	port?: number;
	persistSession?: boolean;
	pluginRegistry?: PiboPluginRegistry;
	sessionStore?: PiboSessionStore;
	sessionDbPath?: string;
	startChannels?: boolean;
	maxBackpressureFrames?: number;
	maxBackpressureBytes?: number;
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

async function createGatewaySessionStore(options: GatewayServerOptions): Promise<PiboSessionStore> {
	if (options.sessionDbPath) {
		const { SqlitePiboSessionStore } = await import("../sessions/sqlite-store.js");
		return new SqlitePiboSessionStore(options.sessionDbPath);
	}
	const { createDefaultPiboDataSessionStore } = await import("../sessions/pibo-data-store.js");
	return createDefaultPiboDataSessionStore();
}

export class PiboGatewayServer {
	private readonly pluginRegistry: PiboPluginRegistry;
	private sessionStore?: PiboSessionStore;
	private ownsSessionStore = false;
	private router?: PiboSessionRouter;
	private readonly startedChannels: PiboChannel[] = [];
	private readonly connections = new Set<GatewayConnection>();
	private droppedRouterEvents = 0;
	private closedSlowClients = 0;
	private server?: Server;
	private unsubscribe?: () => void;

	constructor(private readonly options: GatewayServerOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
	}

	async start(): Promise<void> {
		if (this.server) return;

		this.validateChannels();
		this.sessionStore = this.options.sessionStore ?? (await createGatewaySessionStore(this.options));
		this.ownsSessionStore = !this.options.sessionStore;
		this.router = new PiboSessionRouter({
			persistSession: this.options.persistSession,
			pluginRegistry: this.pluginRegistry,
			sessionStore: this.sessionStore,
		});
		this.unsubscribe = this.router.subscribe((event) => this.broadcastRouterEvent(event));
		this.server = createServer((socket) => this.handleSocket(socket));
		await this.pluginRegistry.getAuthService()?.start?.();

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
	}

	async stop(): Promise<void> {
		await this.stopChannels();
		await this.pluginRegistry.getAuthService()?.stop?.();

		this.unsubscribe?.();
		this.unsubscribe = undefined;

		for (const connection of this.connections) {
			connection.socket.destroy();
		}
		this.connections.clear();

		if (this.server) {
			await new Promise<void>((resolve, reject) => {
				this.server!.close((error) => (error ? reject(error) : resolve()));
			});
			this.server = undefined;
		}

		await this.router?.disposeAll();
		this.router = undefined;

		if (this.ownsSessionStore) {
			this.sessionStore?.close?.();
		}
		this.sessionStore = undefined;
		this.ownsSessionStore = false;
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
			connections: connectionDetails.length,
			slowConnections: connectionDetails.filter((connection) => connection.slow).length,
			droppedEvents: this.droppedRouterEvents,
			closedSlowClients: this.closedSlowClients,
			connectionDetails,
		};
	}

	private async startChannels(): Promise<void> {
		const context = this.createChannelContext();
		for (const channel of this.pluginRegistry.getChannels()) {
			if (channel.auth.mode === "none") {
				console.error(`Warning: channel "${channel.name}" starts without auth`);
			}
			await channel.start(context);
			this.startedChannels.push(channel);
		}
	}

	private validateChannels(): void {
		for (const channel of this.pluginRegistry.getChannels()) {
			if (channel.auth.mode === "required" && !this.pluginRegistry.getAuthService()) {
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
			emit: (event) => this.requireRouter().emit(event),
			subscribe: (listener) => this.requireRouter().subscribe(listener),
			getSession: (id) => this.requireSessionStore().get(id),
			createSession: (input) => {
				const profile = this.pluginRegistry.resolveProfileName(input.profile);
				const profileContext = this.pluginRegistry.createProfile(profile);
				const activeModel = input.activeModel ?? selectRequestedModelProfile(profileContext, loadPiboModelDefaults());
				return this.requireSessionStore().create({ ...input, profile, activeModel });
			},
			updateSession: (id, input) => this.requireSessionStore().update(id, input),
			setLiveSessionActiveModel: (id, model) => this.requireRouter().setLiveSessionActiveModel(id, model),
			reportSessionError: (id, error, options) => this.requireRouter().reportSessionError(id, error, options),
			deleteSession: (id) => this.requireSessionStore().delete?.(id) ?? false,
			findSessions: (input) => this.requireSessionStore().find(input),
			listSessions: () => this.requireSessionStore().list?.() ?? [],
			getSessionRuntimeStatus: (piboSessionId) => this.requireRouter().getSessionRuntimeStatus(piboSessionId),
			listSessionRuntimeStatuses: () => this.requireRouter().listSessionRuntimeStatuses(),
			listRuns: (options) => this.requireRouter().listRuns(options),
			snapshotSignalSession: (piboSessionId) => this.requireRouter().snapshotSignalSession(piboSessionId),
			snapshotSignalTree: (rootPiboSessionId) => this.requireRouter().snapshotSignalTree(rootPiboSessionId),
			subscribeSignalTree: (rootPiboSessionId, listener) => this.requireRouter().subscribeSignalTree(rootPiboSessionId, listener),
			getGatewayActions: () => this.pluginRegistry.getGatewayActionInfos(),
			getProfiles: () => this.pluginRegistry.getProfileInfos(),
			createProfile: (name) => this.pluginRegistry.createProfile(name),
			getCapabilityCatalog: () => this.pluginRegistry.getCapabilityCatalog(),
			getRalphStopConditionDefinitions: () => this.pluginRegistry.getRalphStopConditionDefinitions(),
			getRalphStopConditionInfos: () => this.pluginRegistry.getRalphStopConditionInfos(),
			upsertProfile: (profile) => this.pluginRegistry.upsertProfile(profile),
			removeProfile: (name) => this.pluginRegistry.removeProfile(name),
			upsertContextFile: (contextFile) => this.pluginRegistry.upsertContextFile(contextFile),
			removeContextFile: (key) => this.pluginRegistry.removeContextFile(key),
			registerSkill: (skill) => this.pluginRegistry.registerSkill(skill),
			unregisterSkill: (name) => this.pluginRegistry.unregisterSkill(name),
			emitProductEvent: (event) => this.pluginRegistry.emitProductEvent(event),
			subscribeProductEvents: (listener) => this.pluginRegistry.onProductEvent(listener),
			auth: this.pluginRegistry.getAuthService(),
			getWebApps: () => this.pluginRegistry.getWebApps(),
		};
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

export async function runGatewayServer(options: GatewayServerOptions = {}): Promise<void> {
	const server = new PiboGatewayServer(options);
	await server.start();
	try {
		if (process.env.PIBO_FALLBACK_MODE === "1") {
			writeFallbackGatewayPid();
		} else {
			writeGatewayPid();
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		await server.stop();
		process.exit(1);
	}

	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	console.error(`pibo gateway listening on ${host}:${port}`);

	const stop = async () => {
		await server.stop();
		if (process.env.PIBO_FALLBACK_MODE === "1") {
			clearFallbackPidFile();
		} else {
			clearPidFile();
		}
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
