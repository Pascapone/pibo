import type { PiboInputEvent, PiboOutputEvent } from "../core/events.js";

export const DEFAULT_GATEWAY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 4789;

export type GatewayRequestFrame = {
	type: "req";
	id: string;
	event: PiboInputEvent;
};

export type GatewaySubscription =
	| { type: "legacy-all" }
	| { type: "session"; piboSessionId: string };

export type GatewaySubscribeFrame = {
	type: "subscribe";
	id: string;
	subscription: GatewaySubscription;
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

export type GatewayFrame = GatewayRequestFrame | GatewaySubscribeFrame | GatewayResponseFrame | GatewayEventFrame;

function isJsonValue(value: unknown): boolean {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (typeof value === "object") {
		return Object.values(value).every(isJsonValue);
	}

	return false;
}

export function isGatewayRequestFrame(value: unknown): value is GatewayRequestFrame {
	// Keep this unversioned wire validator compatible with existing clients. Stricter
	// message text, delivery, and identifier validation belongs at client boundaries.
	if (!value || typeof value !== "object") return false;

	const frame = value as { type?: unknown; id?: unknown; event?: unknown };
	if (frame.type !== "req" || typeof frame.id !== "string") return false;
	if (!frame.event || typeof frame.event !== "object") return false;

	const event = frame.event as {
		type?: unknown;
		piboSessionId?: unknown;
		text?: unknown;
		action?: unknown;
		params?: unknown;
	};
	if (typeof event.piboSessionId !== "string" || event.piboSessionId.length === 0) return false;
	if (event.type === "message") return typeof event.text === "string";
	if (event.type === "execution") {
		return typeof event.action === "string" && (event.params === undefined || isJsonValue(event.params));
	}
	return false;
}

export function isGatewaySubscribeFrame(value: unknown): value is GatewaySubscribeFrame {
	if (!value || typeof value !== "object") return false;

	const frame = value as { type?: unknown; id?: unknown; subscription?: unknown };
	if (frame.type !== "subscribe" || typeof frame.id !== "string") return false;
	if (!frame.subscription || typeof frame.subscription !== "object") return false;

	const subscription = frame.subscription as { type?: unknown; piboSessionId?: unknown };
	if (subscription.type === "legacy-all") return true;
	if (subscription.type === "session") {
		return typeof subscription.piboSessionId === "string" && subscription.piboSessionId.length > 0;
	}
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
