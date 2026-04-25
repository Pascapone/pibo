import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	type GatewayFrame,
	type GatewayResponseFrame,
} from "./protocol.js";
import type { PiboAssistantMessageEvent, PiboInputEvent, PiboMessageEvent } from "../core/events.js";

export type GatewayRequestOptions = {
	host?: string;
	port?: number;
	timeoutMs?: number;
};

export type GatewayReplyResult = {
	response: GatewayResponseFrame;
	reply: PiboAssistantMessageEvent;
};

function parseJsonLine(line: string): GatewayFrame | undefined {
	try {
		return JSON.parse(line) as GatewayFrame;
	} catch {
		return undefined;
	}
}

function writeFrame(socket: Socket, frame: GatewayFrame): void {
	socket.write(encodeFrame(frame));
}

export async function sendGatewayEvent(
	event: PiboInputEvent,
	options: GatewayRequestOptions = {},
): Promise<GatewayResponseFrame> {
	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	const timeoutMs = options.timeoutMs ?? 5000;
	const id = randomUUID();
	const eventWithId: PiboInputEvent = { ...event, id: event.id ?? id };

	return await new Promise<GatewayResponseFrame>((resolve, reject) => {
		const socket = connect({ host, port });
		socket.setEncoding("utf-8");

		let buffer = "";
		let settled = false;

		const timeout = setTimeout(() => {
			finish(new Error(`Timed out waiting for gateway response at ${host}:${port}`));
		}, timeoutMs);

		const finish = (result: GatewayResponseFrame | Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.end();

			if (result instanceof Error) {
				reject(result);
			} else {
				resolve(result);
			}
		};

		socket.once("connect", () => {
			writeFrame(socket, { type: "req", id, event: eventWithId });
		});
		socket.once("error", finish);
		socket.once("close", () => {
			finish(new Error("Gateway connection closed before response"));
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				const frame = line ? parseJsonLine(line) : undefined;
				if (frame?.type === "res" && frame.id === id) {
					finish(frame);
					return;
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
	});
}

export async function sendGatewayMessageAndWaitForReply(
	event: PiboMessageEvent,
	options: GatewayRequestOptions = {},
): Promise<GatewayReplyResult> {
	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	const timeoutMs = options.timeoutMs ?? 120000;
	const id = randomUUID();
	const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? id };

	return await new Promise<GatewayReplyResult>((resolve, reject) => {
		const socket = connect({ host, port });
		socket.setEncoding("utf-8");

		let buffer = "";
		let settled = false;
		let response: GatewayResponseFrame | undefined;
		let reply: PiboAssistantMessageEvent | undefined;

		const timeout = setTimeout(() => {
			finish(new Error(`Timed out waiting for assistant reply from session "${event.sessionKey}"`));
		}, timeoutMs);

		const finish = (result: GatewayReplyResult | Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.end();

			if (result instanceof Error) {
				reject(result);
			} else {
				resolve(result);
			}
		};

		const handleFrame = (frame: GatewayFrame): void => {
			if (frame.type === "res" && frame.id === id) {
				response = frame;
				if (!frame.ok) {
					finish(new Error(frame.error?.message ?? "Gateway rejected the message"));
				} else if (reply) {
					finish({ response, reply });
				}
				return;
			}

			if (frame.type !== "event" || frame.event !== "router") return;

			const output = frame.payload;
			if (
				output.type === "session_error" &&
				output.sessionKey === eventWithId.sessionKey &&
				output.eventId === eventWithId.id
			) {
				finish(new Error(output.error));
				return;
			}

			if (
				output.type === "assistant_message" &&
				output.sessionKey === eventWithId.sessionKey &&
				output.eventId === eventWithId.id
			) {
				reply = output;
				if (response?.ok) {
					finish({ response, reply });
				}
			}
		};

		socket.once("connect", () => {
			writeFrame(socket, { type: "req", id, event: eventWithId });
		});
		socket.once("error", finish);
		socket.once("close", () => {
			finish(new Error("Gateway connection closed before assistant reply"));
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				const frame = line ? parseJsonLine(line) : undefined;
				if (frame) {
					handleFrame(frame);
					if (settled) return;
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
	});
}
