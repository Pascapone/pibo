import type { PiboExecutionAction, PiboOutputEvent } from "../core/events.js";
import type { PiboGatewayActionInfo } from "../plugins/types.js";
import type { PiboSessionBinding } from "../sessions/bindings.js";

export const DEFAULT_REMOTE_AGENT_HOST = "127.0.0.1";
export const DEFAULT_REMOTE_AGENT_PORT = 4790;
export const REMOTE_AGENT_CHANNEL_NAME = "remote-agent";

export type RemoteAgentAttachRequestFrame = {
	type: "remote_attach";
	id: string;
	sessionName: string;
	profile?: string;
};

export type RemoteAgentInput =
	| {
			type: "message";
			text: string;
	  }
	| {
			type: "execution";
			action: PiboExecutionAction;
	  };

export type RemoteAgentInputRequestFrame = {
	type: "remote_input";
	id: string;
	input: RemoteAgentInput;
};

export type RemoteAgentCapabilitiesRequestFrame = {
	type: "remote_capabilities";
	id: string;
};

export type RemoteAgentRequestFrame =
	| RemoteAgentAttachRequestFrame
	| RemoteAgentInputRequestFrame
	| RemoteAgentCapabilitiesRequestFrame;

export type RemoteAgentResponseFrame = {
	type: "remote_res";
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: { message: string };
};

export type RemoteAgentEventFrame = {
	type: "remote_event";
	sessionKey: string;
	payload: PiboOutputEvent;
};

export type RemoteAgentAttachedPayload = {
	binding: PiboSessionBinding;
	capabilities: RemoteAgentCapabilities;
};

export type RemoteAgentCapabilities = {
	actions: PiboGatewayActionInfo[];
};

export type RemoteAgentFrame = RemoteAgentRequestFrame | RemoteAgentResponseFrame | RemoteAgentEventFrame;

export function encodeRemoteAgentFrame(frame: RemoteAgentFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

export function remoteAgentErrorResponse(id: string, error: unknown): RemoteAgentResponseFrame {
	return {
		type: "remote_res",
		id,
		ok: false,
		error: { message: error instanceof Error ? error.message : String(error) },
	};
}

export function isRemoteAgentRequestFrame(value: unknown): value is RemoteAgentRequestFrame {
	if (!value || typeof value !== "object") return false;

	const frame = value as {
		type?: unknown;
		id?: unknown;
		sessionName?: unknown;
		profile?: unknown;
		input?: unknown;
	};
	if (typeof frame.id !== "string") return false;

	if (frame.type === "remote_attach") {
		return (
			typeof frame.sessionName === "string" &&
			frame.sessionName.length > 0 &&
			(frame.profile === undefined || typeof frame.profile === "string")
		);
	}

	if (frame.type === "remote_input") {
		if (!frame.input || typeof frame.input !== "object") return false;
		const input = frame.input as { type?: unknown; text?: unknown; action?: unknown };
		if (input.type === "message") return typeof input.text === "string";
		if (input.type === "execution") return typeof input.action === "string";
	}

	if (frame.type === "remote_capabilities") {
		return true;
	}

	return false;
}
