import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	type GatewayFrame,
	type GatewayRequestFrame,
	type GatewayResponseFrame,
	type GatewaySubscribeFrame,
} from "./protocol.js";
import type {
	PiboInputEvent,
	PiboMessageDelivery,
	PiboMessageQueuedEvent,
	PiboMessageStartedEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "../core/events.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";

const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;

export type GatewayClientOptions = {
	host?: string;
	port?: number;
	piboSessionId?: string;
	acknowledgementTimeoutMs?: number;
	terminalTimeoutMs?: number;
};

export type GatewayClientMessageParseResult =
	| { ok: true; text: string; delivery?: PiboMessageDelivery }
	| { ok: false; error: string };

export class GatewayClientExpectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GatewayClientExpectedError";
	}
}

export function isGatewayClientExpectedError(error: unknown): error is GatewayClientExpectedError {
	return error instanceof GatewayClientExpectedError;
}

type GatewayClientRenderState = {
	visibleIncomingEventIds: Set<string>;
	sawAssistantDelta: boolean;
	showThinking: boolean;
	sawThinkingDelta: boolean;
};

type PendingGatewayClientRequest = {
	frameId: string;
	event: PiboInputEvent;
	acknowledged: boolean;
	terminalEventId?: string;
};

type GatewayClientTerminalOutcome =
	| { ok: true }
	| { ok: false; error: string };

type PendingWaitKind = "acknowledgement" | "terminal";

type PendingWaiter = {
	kind: PendingWaitKind;
	resolve: () => void;
	reject: (error: GatewayClientExpectedError) => void;
	timeout: ReturnType<typeof setTimeout>;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function parseGatewayClientMessage(value: string): GatewayClientMessageParseResult {
	const text = value.trim();
	if (!text) return { ok: false, error: "Message text is required" };
	const command = /^\/(queue|steer)(?:\s+|$)/.exec(text);
	if (!command) return { ok: true, text };
	const delivery = command[1] as PiboMessageDelivery;
	const message = text.slice(command[0].length).trim();
	return message
		? { ok: true, text: message, delivery }
		: { ok: false, error: `Usage: /${delivery} <message>` };
}

export function createGatewayClientRequestFrame(event: PiboInputEvent): GatewayRequestFrame {
	const id = randomUUID();
	return { type: "req", id, event: { ...event, id: event.id ?? id } };
}

export function createGatewayClientSubscriptionFrame(piboSessionId: string): GatewaySubscribeFrame {
	return {
		type: "subscribe",
		id: randomUUID(),
		subscription: { type: "session", piboSessionId },
	};
}

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
	if (!frame.ok) {
		console.error(`\nerror: ${frame.error?.message ?? "request failed"}`);
		return;
	}
	if (!frame.payload || typeof frame.payload !== "object") return;
	const payload = frame.payload as { type?: unknown; activeEventId?: unknown };
	if (payload.type !== "message_steered" || typeof payload.activeEventId !== "string" || payload.activeEventId.length === 0) return;
	console.error(`steer: delivered to active turn ${payload.activeEventId}`);
}

function printGatewayClientHelp(): void {
	console.error("messages queue by default; /queue <message> queues explicitly; /steer <message> steers the active turn");
	console.error("commands: /status, /clear, /abort, /thinking [level], /thinking-show, /goal [command], /help, /quit");
	console.error("piped EOF waits for acknowledgements and terminal completion of every accepted message while assistant output keeps streaming");
	console.error("security: raw gateway TCP is unauthenticated and unencrypted; use remote hosts only on trusted networks or through a secure tunnel");
}

function isSessionStatus(value: unknown): value is PiboSessionStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { piboSessionId?: unknown; queuedMessages?: unknown; processing?: unknown };
	return (
		typeof candidate.piboSessionId === "string" &&
		typeof candidate.queuedMessages === "number" &&
		typeof candidate.processing === "boolean"
	);
}

function printExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): void {
	if (event.action === "status" && isSessionStatus(event.result)) {
		console.error(
			`status: session=${event.result.piboSessionId} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`,
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

function printEvent(frame: GatewayFrame, piboSessionId: string, state: GatewayClientRenderState): void {
	if (frame.type !== "event" || frame.event !== "router") return;

	const event = frame.payload;
	if (event.piboSessionId !== piboSessionId) return;

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

function isExpectedSubscriptionResponse(frame: GatewayResponseFrame, piboSessionId: string): boolean {
	if (!frame.payload || typeof frame.payload !== "object") return false;
	const payload = frame.payload as { subscription?: { type?: unknown; piboSessionId?: unknown } };
	return payload.subscription?.type === "session" && payload.subscription.piboSessionId === piboSessionId;
}

function steeringTargetEventId(frame: GatewayResponseFrame): string | undefined {
	if (!frame.payload || typeof frame.payload !== "object") return undefined;
	const payload = frame.payload as { type?: unknown; activeEventId?: unknown };
	return payload.type === "message_steered" && typeof payload.activeEventId === "string" && payload.activeEventId.length > 0
		? payload.activeEventId
		: undefined;
}

function handleGatewayClientLine(
	value: string,
	sendRequest: (event: PiboInputEvent) => void,
	piboSessionId: string,
	renderState: GatewayClientRenderState,
): "continue" | "quit" | "error" {
	const text = value.trim();
	if (!text) return "continue";
	if (text === "/quit" || text === "/exit") return "quit";
	if (text === "/help") {
		printGatewayClientHelp();
		return "continue";
	}
	if (text === "/thinking-show") {
		renderState.showThinking = !renderState.showThinking;
		console.error(`thinking display: ${renderState.showThinking ? "on" : "off"}`);
		return "continue";
	}

	if (text === "/thinking" || text.startsWith("/thinking ")) {
		const level = text.slice("/thinking".length).trim();
		let params: { level: ReturnType<typeof parsePiboThinkingLevel> } | undefined;
		try {
			params = level ? { level: parsePiboThinkingLevel(level) } : undefined;
		} catch (error) {
			console.error(errorMessage(error));
			return "error";
		}
		sendRequest(
			params === undefined
				? { type: "execution", piboSessionId, action: "thinking" }
				: { type: "execution", piboSessionId, action: "thinking", params },
		);
		return "continue";
	}

	if (text === "/status" || text === "/clear" || text === "/abort") {
		const action = text === "/status" ? "status" : text === "/clear" ? "clear_queue" : "abort";
		sendRequest({ type: "execution", piboSessionId, action });
		return "continue";
	}

	if (text === "/goal" || text.startsWith("/goal ")) {
		sendRequest({
			type: "execution",
			piboSessionId,
			action: "goal",
			params: { command: text.slice("/goal".length).trim() },
		});
		return "continue";
	}

	const message = parseGatewayClientMessage(text);
	if (!message.ok) {
		console.error(message.error);
		return "error";
	}
	sendRequest({
		type: "message",
		piboSessionId,
		text: message.text,
		source: "user",
		...(message.delivery ? { delivery: message.delivery } : {}),
	});
	return "continue";
}

export async function runGatewayClient(options: GatewayClientOptions = {}): Promise<void> {
	const interactive = input.isTTY === true && output.isTTY === true;
	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	const piboSessionId = (options.piboSessionId ?? "default").trim();
	const acknowledgementTimeoutMs = options.acknowledgementTimeoutMs ?? DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS;
	const terminalTimeoutMs = options.terminalTimeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS;
	if (!piboSessionId) throw new GatewayClientExpectedError("Pibo Session ID must not be empty");

	const socket = connect({ host, port });
	socket.setEncoding("utf-8");
	try {
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => reject(error);
			socket.once("error", onError);
			socket.once("connect", () => {
				socket.off("error", onError);
				resolve();
			});
		});
	} catch (error) {
		socket.destroy();
		throw new GatewayClientExpectedError(`Could not connect to gateway at ${host}:${port}: ${errorMessage(error)}`);
	}

	let buffer = "";
	let closing = false;
	let inputEnded = false;
	let connectionFailure: GatewayClientExpectedError | undefined;
	let rl: ReturnType<typeof readline.createInterface> | undefined;
	let pendingWaiter: PendingWaiter | undefined;
	let pipedInputFailed = false;
	let completedNormally = false;
	const pendingRequests = new Map<string, PendingGatewayClientRequest>();
	const terminalOutcomes = new Map<string, GatewayClientTerminalOutcome>();
	const renderState: GatewayClientRenderState = {
		visibleIncomingEventIds: new Set<string>(),
		sawAssistantDelta: false,
		showThinking: false,
		sawThinkingDelta: false,
	};

	const pendingCount = (kind: PendingWaitKind): number => {
		let count = 0;
		for (const request of pendingRequests.values()) {
			if (kind === "acknowledgement" ? !request.acknowledged : request.acknowledged && request.terminalEventId !== undefined) {
				count += 1;
			}
		}
		return count;
	};
	const finishPendingWaiter = (error?: GatewayClientExpectedError): void => {
		const waiter = pendingWaiter;
		if (!waiter) return;
		pendingWaiter = undefined;
		clearTimeout(waiter.timeout);
		if (error) waiter.reject(error);
		else waiter.resolve();
	};
	const notifyPendingWaiter = (): void => {
		if (pendingWaiter && pendingCount(pendingWaiter.kind) === 0) finishPendingWaiter();
	};
	const waitForPending = async (kind: PendingWaitKind, timeoutMs: number): Promise<void> => {
		if (connectionFailure) throw connectionFailure;
		const count = pendingCount(kind);
		if (count === 0) return;
		await new Promise<void>((resolve, reject) => {
			const label = kind === "acknowledgement" ? "gateway acknowledgement" : "terminal message completion";
			pendingWaiter = {
				kind,
				resolve,
				reject,
				timeout: setTimeout(() => {
					finishPendingWaiter(new GatewayClientExpectedError(`Timed out waiting for ${pendingCount(kind)} ${label}(s)`));
				}, timeoutMs),
			};
		});
	};
	const finishRequestTerminal = (request: PendingGatewayClientRequest): void => {
		if (!request.terminalEventId) return;
		const outcome = terminalOutcomes.get(request.terminalEventId);
		if (!outcome) return;
		if (!outcome.ok && !interactive) pipedInputFailed = true;
		pendingRequests.delete(request.frameId);
		notifyPendingWaiter();
	};
	const recordTerminalOutcome = (event: PiboOutputEvent): void => {
		if (interactive || (event.type !== "message_finished" && event.type !== "session_error") || !event.eventId) return;
		const outcome: GatewayClientTerminalOutcome = event.type === "message_finished"
			? { ok: true }
			: { ok: false, error: event.error };
		terminalOutcomes.set(event.eventId, outcome);
		for (const request of [...pendingRequests.values()]) {
			if (request.terminalEventId === event.eventId) finishRequestTerminal(request);
		}
	};
	const sendRequest = (event: PiboInputEvent): void => {
		const frame = createGatewayClientRequestFrame(event);
		pendingRequests.set(frame.id, {
			frameId: frame.id,
			event: frame.event,
			acknowledged: false,
			terminalEventId: !interactive && frame.event.type === "message" && frame.event.delivery !== "steer"
				? frame.event.id
				: undefined,
		});
		writeFrame(socket, frame);
	};
	const subscriptionFrame = createGatewayClientSubscriptionFrame(piboSessionId);
	let subscribed = false;
	let settleSubscription: ((error?: GatewayClientExpectedError) => void) | undefined;
	let subscriptionTimeout: ReturnType<typeof setTimeout> | undefined;
	const subscription = new Promise<void>((resolve, reject) => {
		settleSubscription = (error) => error ? reject(error) : resolve();
	});
	const finishSubscription = (error?: GatewayClientExpectedError): void => {
		const settle = settleSubscription;
		if (!settle) return;
		settleSubscription = undefined;
		if (subscriptionTimeout) clearTimeout(subscriptionTimeout);
		settle(error);
	};
	subscriptionTimeout = setTimeout(() => {
		finishSubscription(new GatewayClientExpectedError(`Timed out subscribing to Pibo Session "${piboSessionId}"`));
	}, acknowledgementTimeoutMs);

	const failConnection = (error: GatewayClientExpectedError): void => {
		if (!subscribed) {
			finishSubscription(error);
			return;
		}
		if (closing || connectionFailure || (!interactive && inputEnded && pendingRequests.size === 0)) return;
		connectionFailure = error;
		finishPendingWaiter(error);
		rl?.close();
	};

	socket.on("error", (error) => {
		failConnection(new GatewayClientExpectedError(`Gateway connection error: ${errorMessage(error)}`));
	});
	socket.on("close", () => {
		const acknowledgements = pendingCount("acknowledgement");
		const terminals = pendingCount("terminal");
		const suffix = acknowledgements > 0 || terminals > 0
			? ` before ${acknowledgements} acknowledgement(s) and ${terminals} terminal completion(s)`
			: "";
		failConnection(new GatewayClientExpectedError(`Gateway connection closed${suffix}`));
	});
	socket.on("data", (chunk) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			const frame = line ? parseJsonLine(line) : undefined;
			if (frame?.type === "res" && frame.id === subscriptionFrame.id) {
				if (!frame.ok) {
					finishSubscription(new GatewayClientExpectedError(frame.error?.message ?? "Gateway rejected the session subscription"));
				} else if (!isExpectedSubscriptionResponse(frame, piboSessionId)) {
					finishSubscription(new GatewayClientExpectedError("Gateway returned a mismatched session subscription"));
				} else {
					subscribed = true;
					finishSubscription();
				}
			} else if (subscribed && frame?.type === "res") {
				printResponse(frame);
				const request = pendingRequests.get(frame.id);
				if (request) {
					request.acknowledged = true;
					if (!frame.ok) {
						if (!interactive) pipedInputFailed = true;
						pendingRequests.delete(frame.id);
					} else if (request.event.type === "message") {
						if (request.event.delivery === "steer") {
							const activeEventId = steeringTargetEventId(frame);
							if (!activeEventId) {
								console.error("\nerror: gateway steering acknowledgement did not identify the active turn");
								if (!interactive) pipedInputFailed = true;
								pendingRequests.delete(frame.id);
							} else if (interactive) {
								pendingRequests.delete(frame.id);
							} else {
								request.terminalEventId = activeEventId;
								finishRequestTerminal(request);
							}
						} else if (interactive) {
							pendingRequests.delete(frame.id);
						} else {
							finishRequestTerminal(request);
						}
					} else {
						pendingRequests.delete(frame.id);
					}
					notifyPendingWaiter();
				}
			} else if (subscribed && frame?.type === "event") {
				printEvent(frame, piboSessionId, renderState);
				recordTerminalOutcome(frame.payload);
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});

	writeFrame(socket, subscriptionFrame);
	try {
		await subscription;
	} catch (error) {
		closing = true;
		socket.destroy();
		throw error;
	}
	if (connectionFailure || socket.destroyed) {
		closing = true;
		socket.destroy();
		throw connectionFailure ?? new GatewayClientExpectedError("Gateway connection closed");
	}

	console.error(`connected to pibo gateway at ${host}:${port}`);
	console.error(`session: ${piboSessionId}`);
	printGatewayClientHelp();

	rl = readline.createInterface({ input, output, terminal: interactive });
	if (interactive) {
		rl.setPrompt("you> ");
		rl.prompt();
	}
	try {
		for await (const line of rl) {
			const result = handleGatewayClientLine(line, sendRequest, piboSessionId, renderState);
			if (result === "error" && !interactive) pipedInputFailed = true;
			if (result === "quit") break;
			if (interactive && !socket.destroyed) rl.prompt();
		}
		inputEnded = true;
		if (!interactive) {
			await waitForPending("acknowledgement", acknowledgementTimeoutMs);
			await waitForPending("terminal", terminalTimeoutMs);
		}
		completedNormally = true;
	} finally {
		closing = true;
		rl.close();
		if (completedNormally) socket.end();
		else socket.destroy();
	}
	if (connectionFailure) throw connectionFailure;
	if (!interactive && pipedInputFailed) process.exitCode = 1;
}
