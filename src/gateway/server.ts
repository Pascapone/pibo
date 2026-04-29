import { createServer, type Server, type Socket } from "node:net";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { PiboSessionRouter } from "../core/session-router.js";
import type { PiboSessionBindingStore } from "../sessions/bindings.js";
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
	bindingStore?: PiboSessionBindingStore;
	bindingDbPath?: string;
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

async function createGatewayBindingStore(options: GatewayServerOptions): Promise<PiboSessionBindingStore> {
	const { createDefaultSessionBindingStore, SqliteSessionBindingStore } = await import(
		"../sessions/sqlite-store.js"
	);
	return options.bindingDbPath
		? new SqliteSessionBindingStore(options.bindingDbPath)
		: createDefaultSessionBindingStore();
}

export class PiboGatewayServer {
	private readonly pluginRegistry: PiboPluginRegistry;
	private bindingStore?: PiboSessionBindingStore;
	private ownsBindingStore = false;
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
		this.bindingStore = this.options.bindingStore ?? (await createGatewayBindingStore(this.options));
		this.ownsBindingStore = !this.options.bindingStore;
		this.router = new PiboSessionRouter({
			persistSession: this.options.persistSession,
			pluginRegistry: this.pluginRegistry,
			bindingStore: this.bindingStore,
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

		if (this.ownsBindingStore) {
			this.bindingStore?.close?.();
		}
		this.bindingStore = undefined;
		this.ownsBindingStore = false;
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
			resolveSession: (input) => {
				const defaultProfile = this.pluginRegistry.resolveProfileName(input.defaultProfile);
				return this.requireBindingStore().resolve({ ...input, defaultProfile });
			},
			updateSession: (sessionKey, input) => this.requireBindingStore().update?.(sessionKey, input),
			listSessions: () => this.requireBindingStore().list?.() ?? [],
			getGatewayActions: () => this.pluginRegistry.getGatewayActionInfos(),
			getProfiles: () => this.pluginRegistry.getProfileInfos(),
			auth: this.pluginRegistry.getAuthService(),
			getWebApps: () => this.pluginRegistry.getWebApps(),
		};
	}

	private requireRouter(): PiboSessionRouter {
		if (!this.router) throw new Error("Gateway router is not started");
		return this.router;
	}

	private requireBindingStore(): PiboSessionBindingStore {
		if (!this.bindingStore) throw new Error("Gateway binding store is not started");
		return this.bindingStore;
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
