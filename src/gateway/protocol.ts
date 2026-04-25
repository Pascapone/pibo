import type { PiboInputEvent, PiboOutputEvent } from "../core/events.js";

export const DEFAULT_GATEWAY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 4789;

export type GatewayRequestFrame = {
	type: "req";
	id: string;
	event: PiboInputEvent;
};

export type GatewayResponseFrame = {
	type: "res";
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: { message: string };
};

export type GatewayEventFrame = {
	type: "event";
	event: "router";
	payload: PiboOutputEvent;
};

export type GatewayFrame = GatewayRequestFrame | GatewayResponseFrame | GatewayEventFrame;

export function isGatewayRequestFrame(value: unknown): value is GatewayRequestFrame {
	if (!value || typeof value !== "object") return false;

	const frame = value as { type?: unknown; id?: unknown; event?: unknown };
	if (frame.type !== "req" || typeof frame.id !== "string") return false;
	if (!frame.event || typeof frame.event !== "object") return false;

	const event = frame.event as { type?: unknown; sessionKey?: unknown; text?: unknown; action?: unknown };
	if (typeof event.sessionKey !== "string" || event.sessionKey.length === 0) return false;
	if (event.type === "message") return typeof event.text === "string";
	if (event.type === "execution") return typeof event.action === "string";
	return false;
}

export function encodeFrame(frame: GatewayFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

export function errorResponse(id: string, error: unknown): GatewayResponseFrame {
	return {
		type: "res",
		id,
		ok: false,
		error: { message: error instanceof Error ? error.message : String(error) },
	};
}
