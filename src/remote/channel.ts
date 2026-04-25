import { createServer, type Server, type Socket } from "node:net";
import type { PiboChannel, PiboChannelContext } from "../channels/types.js";
import type { PiboSessionBinding } from "../sessions/bindings.js";
import {
	DEFAULT_REMOTE_AGENT_HOST,
	DEFAULT_REMOTE_AGENT_PORT,
	REMOTE_AGENT_CHANNEL_NAME,
	encodeRemoteAgentFrame,
	isRemoteAgentRequestFrame,
	remoteAgentErrorResponse,
	type RemoteAgentFrame,
	type RemoteAgentRequestFrame,
	type RemoteAgentResponseFrame,
} from "./protocol.js";

export type RemoteAgentChannelOptions = {
	host?: string;
	port?: number;
	defaultProfile?: string;
	announce?: boolean;
};

type RemoteAgentConnection = {
	socket: Socket;
	binding?: PiboSessionBinding;
	send(frame: RemoteAgentFrame): void;
};

export type RemoteAgentChannel = PiboChannel & {
	getAddress(): { host: string; port: number } | undefined;
};

function parseJsonLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		throw new Error("Invalid JSON frame");
	}
}

function createConnection(socket: Socket): RemoteAgentConnection {
	return {
		socket,
		send(frame) {
			if (socket.destroyed) return;
			socket.write(encodeRemoteAgentFrame(frame));
		},
	};
}

export function createRemoteAgentChannel(options: RemoteAgentChannelOptions = {}): RemoteAgentChannel {
	const host = options.host ?? DEFAULT_REMOTE_AGENT_HOST;
	const port = options.port ?? DEFAULT_REMOTE_AGENT_PORT;
	const defaultProfile = options.defaultProfile ?? "pibo-minimal";
	const connections = new Set<RemoteAgentConnection>();
	let server: Server | undefined;
	let unsubscribe: (() => void) | undefined;
	let context: PiboChannelContext | undefined;

	const requireContext = (): PiboChannelContext => {
		if (!context) throw new Error("Remote agent channel is not started");
		return context;
	};

	const handleRequest = async (
		connection: RemoteAgentConnection,
		frame: RemoteAgentRequestFrame,
	): Promise<RemoteAgentResponseFrame> => {
		const ctx = requireContext();

		if (frame.type === "remote_attach") {
			const binding = ctx.resolveSession({
				channel: REMOTE_AGENT_CHANNEL_NAME,
				externalId: frame.sessionName,
				defaultProfile: frame.profile ?? defaultProfile,
			});
			connection.binding = binding;
			return {
				type: "remote_res",
				id: frame.id,
				ok: true,
				payload: {
					binding,
					capabilities: {
						actions: ctx.getGatewayActions(),
					},
				},
			};
		}

		if (frame.type === "remote_capabilities") {
			return {
				type: "remote_res",
				id: frame.id,
				ok: true,
				payload: {
					actions: ctx.getGatewayActions(),
				},
			};
		}

		if (!connection.binding) {
			throw new Error("Remote agent client is not attached");
		}

		const sessionKey = connection.binding.sessionKey;
		const output =
			frame.input.type === "message"
				? await ctx.emit({
						type: "message",
						sessionKey,
						id: frame.id,
						text: frame.input.text,
						source: "ui",
					})
				: await ctx.emit({
						type: "execution",
						sessionKey,
						id: frame.id,
						action: frame.input.action,
					});

		return { type: "remote_res", id: frame.id, ok: true, payload: output };
	};

	const handleLine = async (connection: RemoteAgentConnection, line: string): Promise<void> => {
		let frame: unknown;
		try {
			frame = parseJsonLine(line);
			if (!isRemoteAgentRequestFrame(frame)) {
				throw new Error("Invalid remote agent request frame");
			}
		} catch (error) {
			connection.send(remoteAgentErrorResponse("invalid", error));
			return;
		}

		try {
			connection.send(await handleRequest(connection, frame));
		} catch (error) {
			connection.send(remoteAgentErrorResponse(frame.id, error));
		}
	};

	const handleSocket = (socket: Socket): void => {
		const connection = createConnection(socket);
		connections.add(connection);

		let buffer = "";
		socket.setEncoding("utf-8");
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					void handleLine(connection, line);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
		socket.once("close", () => connections.delete(connection));
		socket.once("error", () => connections.delete(connection));
	};

	return {
		name: REMOTE_AGENT_CHANNEL_NAME,
		kind: "local",
		description: "Local Pi Coding Agent style remote-control channel for pibo sessions.",
		auth: { mode: "trusted-local" },
		async start(channelContext) {
			if (server) return;
			context = channelContext;
			unsubscribe = channelContext.subscribe((event) => {
				for (const connection of connections) {
					if (connection.binding?.sessionKey === event.sessionKey) {
						connection.send({ type: "remote_event", sessionKey: event.sessionKey, payload: event });
					}
				}
			});
			server = createServer((socket) => handleSocket(socket));
			await new Promise<void>((resolve, reject) => {
				server!.once("error", reject);
				server!.listen(port, host, () => {
					server!.off("error", reject);
					resolve();
				});
			});
			const address = this.getAddress();
			if (address && options.announce !== false) {
				console.error(`pibo remote agent channel listening on ${address.host}:${address.port}`);
			}
		},
		async stop() {
			unsubscribe?.();
			unsubscribe = undefined;
			context = undefined;

			for (const connection of connections) {
				connection.socket.destroy();
			}
			connections.clear();

			if (server) {
				await new Promise<void>((resolve, reject) => {
					server!.close((error) => (error ? reject(error) : resolve()));
				});
				server = undefined;
			}
		},
		getAddress() {
			const address = server?.address();
			if (!address || typeof address === "string") return undefined;
			return { host: address.address, port: address.port };
		},
	};
}
