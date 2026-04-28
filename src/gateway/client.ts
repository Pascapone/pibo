import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	type GatewayFrame,
	type GatewayResponseFrame,
} from "./protocol.js";
import type {
	PiboMessageQueuedEvent,
	PiboMessageStartedEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "../core/events.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";

export type GatewayClientOptions = {
	host?: string;
	port?: number;
	sessionKey?: string;
};

type GatewayClientRenderState = {
	visibleIncomingEventIds: Set<string>;
	sawAssistantDelta: boolean;
	showThinking: boolean;
	sawThinkingDelta: boolean;
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

function printResponse(frame: GatewayResponseFrame): void {
	if (frame.ok) return;
	console.error(`\nerror: ${frame.error?.message ?? "request failed"}`);
}

function isSessionStatus(value: unknown): value is PiboSessionStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { sessionKey?: unknown; queuedMessages?: unknown; processing?: unknown };
	return (
		typeof candidate.sessionKey === "string" &&
		typeof candidate.queuedMessages === "number" &&
		typeof candidate.processing === "boolean"
	);
}

function printExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): void {
	if (event.action === "status" && isSessionStatus(event.result)) {
		console.error(
			`status: session=${event.result.sessionKey} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`,
		);
		return;
	}

	if (event.action === "clear_queue" && event.result && typeof event.result === "object") {
		const cleared = (event.result as { cleared?: unknown }).cleared;
		console.error(`clear: removed ${typeof cleared === "number" ? cleared : 0} queued message(s)`);
		return;
	}

	console.error(`${event.action}: ${JSON.stringify(event.result)}`);
}

function printIncomingMessage(
	event: PiboMessageQueuedEvent | PiboMessageStartedEvent,
	state: GatewayClientRenderState,
): void {
	if (event.source === "user") return;
	if (event.eventId && state.visibleIncomingEventIds.has(event.eventId)) return;
	if (event.eventId) state.visibleIncomingEventIds.add(event.eventId);

	const source = event.source ?? "external";
	console.error(`\nincoming ${source}> ${event.text}`);
}

function printEvent(frame: GatewayFrame, sessionKey: string, state: GatewayClientRenderState): void {
	if (frame.type !== "event" || frame.event !== "router") return;

	const event = frame.payload;
	if (event.sessionKey !== sessionKey) return;

	if (event.type === "message_queued") {
		printIncomingMessage(event, state);
		return;
	}
	if (event.type === "assistant_delta") {
		state.sawAssistantDelta = true;
		output.write(event.text);
		return;
	}
	if (event.type === "thinking_started") {
		state.sawThinkingDelta = false;
		if (state.showThinking) output.write("\nthinking> ");
		return;
	}
	if (event.type === "thinking_delta") {
		if (!state.showThinking) return;
		state.sawThinkingDelta = true;
		output.write(event.text);
		return;
	}
	if (event.type === "thinking_finished") {
		if (!state.showThinking) return;
		if (!state.sawThinkingDelta && event.text) output.write(event.text);
		state.sawThinkingDelta = false;
		output.write("\n");
		return;
	}
	if (event.type === "assistant_message") {
		if (!state.sawAssistantDelta) {
			output.write(event.text);
		}
		state.sawAssistantDelta = false;
		output.write("\n");
		return;
	}
	if (event.type === "session_error") {
		console.error(`\nsession error: ${event.error}`);
		return;
	}
	if (event.type === "execution_result") {
		printExecutionResult(event);
		return;
	}
	if (event.type === "message_started") {
		state.sawAssistantDelta = false;
		printIncomingMessage(event, state);
		output.write("assistant> ");
	}
}

export async function runGatewayClient(options: GatewayClientOptions = {}): Promise<void> {
	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	const sessionKey = options.sessionKey ?? "default";

	const socket = connect({ host, port });
	socket.setEncoding("utf-8");

	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});

	console.error(`connected to pibo gateway at ${host}:${port}`);
	console.error(`session: ${sessionKey}`);
	console.error("type a message, /status, /clear, /abort, /thinking [level], /thinking-show, or /quit");

	let buffer = "";
	const renderState: GatewayClientRenderState = {
		visibleIncomingEventIds: new Set<string>(),
		sawAssistantDelta: false,
		showThinking: false,
		sawThinkingDelta: false,
	};
	socket.on("data", (chunk) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			const frame = line ? parseJsonLine(line) : undefined;
			if (frame?.type === "res") {
				printResponse(frame);
			} else if (frame?.type === "event") {
				printEvent(frame, sessionKey, renderState);
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});

	const rl = readline.createInterface({ input, output });

	try {
		while (!socket.destroyed) {
			const text = (await rl.question("you> ")).trim();
			if (!text) continue;
			if (text === "/quit" || text === "/exit") break;
			if (text === "/thinking-show") {
				renderState.showThinking = !renderState.showThinking;
				console.error(`thinking display: ${renderState.showThinking ? "on" : "off"}`);
				continue;
			}

			if (text === "/thinking" || text.startsWith("/thinking ")) {
				const level = text.slice("/thinking".length).trim();
				let params: { level: ReturnType<typeof parsePiboThinkingLevel> } | undefined;
				try {
					params = level ? { level: parsePiboThinkingLevel(level) } : undefined;
				} catch (error) {
					console.error(error instanceof Error ? error.message : String(error));
					continue;
				}
				writeFrame(socket, {
					type: "req",
					id: randomUUID(),
					event:
						params === undefined
							? { type: "execution", sessionKey, action: "thinking" }
							: { type: "execution", sessionKey, action: "thinking", params },
				});
				continue;
			}

			if (text === "/status" || text === "/clear" || text === "/abort") {
				const action = text === "/status" ? "status" : text === "/clear" ? "clear_queue" : "abort";
				writeFrame(socket, {
					type: "req",
					id: randomUUID(),
					event: { type: "execution", sessionKey, action },
				});
				continue;
			}

			writeFrame(socket, {
				type: "req",
				id: randomUUID(),
				event: { type: "message", sessionKey, text, source: "user" },
			});
		}
	} finally {
		rl.close();
		socket.end();
	}
}
