import { createServer, type Server, type Socket } from "node:net";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { PiboSessionRouter } from "../core/session-router.js";
import type { PiboSessionStore } from "../sessions/store.js";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	errorResponse,
	isGatewayRequestFrame,
	type GatewayFrame,
	type GatewayResponseFrame,
} from "./protocol.js";

export type GatewayServerOptions = {
	host?: string;
	port?: number;
	persistSession?: boolean;
	pluginRegistry?: PiboPluginRegistry;
	sessionStore?: PiboSessionStore;
	sessionDbPath?: string;
	startChannels?: boolean;
};

type GatewayConnection = {
	socket: Socket;
	send: (frame: GatewayFrame) => void;
};

function parseJsonLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		throw new Error("Invalid JSON frame");
	}
}

function createConnection(socket: Socket): GatewayConnection {
	return {
		socket,
		send(frame) {
			if (socket.destroyed) return;
			socket.write(encodeFrame(frame));
		},
	};
}

async function createGatewaySessionStore(options: GatewayServerOptions): Promise<PiboSessionStore> {
	const { createDefaultPiboSessionStore, SqlitePiboSessionStore } = await import(
		"../sessions/sqlite-store.js"
	);
	return options.sessionDbPath
		? new SqlitePiboSessionStore(options.sessionDbPath)
		: createDefaultPiboSessionStore();
}

export class PiboGatewayServer {
	private readonly pluginRegistry: PiboPluginRegistry;
	private sessionStore?: PiboSessionStore;
	private ownsSessionStore = false;
	private router?: PiboSessionRouter;
	private readonly startedChannels: PiboChannel[] = [];
	private readonly connections = new Set<GatewayConnection>();
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
		const connection = createConnection(socket);
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
			if (!isGatewayRequestFrame(frame)) {
				throw new Error("Invalid request frame");
			}
		} catch (error) {
			connection.send(errorResponse("invalid", error));
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
			connection.send({ type: "event", event: "router", payload: event });
		}
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
				return this.requireSessionStore().create({ ...input, profile });
			},
			updateSession: (id, input) => this.requireSessionStore().update(id, input),
			deleteSession: (id) => this.requireSessionStore().delete?.(id) ?? false,
			findSessions: (input) => this.requireSessionStore().find(input),
			listSessions: () => this.requireSessionStore().list?.() ?? [],
			getGatewayActions: () => this.pluginRegistry.getGatewayActionInfos(),
			getProfiles: () => this.pluginRegistry.getProfileInfos(),
			getCapabilityCatalog: () => this.pluginRegistry.getCapabilityCatalog(),
			upsertProfile: (profile) => this.pluginRegistry.upsertProfile(profile),
			removeProfile: (name) => this.pluginRegistry.removeProfile(name),
			upsertContextFile: (contextFile) => this.pluginRegistry.upsertContextFile(contextFile),
			removeContextFile: (key) => this.pluginRegistry.removeContextFile(key),
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

	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	console.error(`pibo gateway listening on ${host}:${port}`);

	const stop = async () => {
		await server.stop();
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
