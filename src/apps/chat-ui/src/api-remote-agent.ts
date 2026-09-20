import { requestJson } from "./api-http";

export type RemoteAgentModuleName = "sessions" | "observe" | "files" | "bash";
export type RemoteAgentMode = "sandbox" | "yolo";
export type RemoteAgentRuntime = "muse" | "pi";

export type RemoteRoomConfig = {
	roomId: string;
	enabled: boolean;
	mode: RemoteAgentMode;
	runtime: RemoteAgentRuntime;
	sandboxPath: string;
	modules: Record<RemoteAgentModuleName, boolean>;
	defaultProfile: string;
	allowedProfiles: string[];
	allowInternet: boolean;
	updatedAt: string;
};

export type RemoteTokenInfo = {
	id: string;
	label: string;
	roomId: string;
	modules: RemoteAgentModuleName[];
	createdAt: string;
	expiresAt: string;
	revoked: boolean;
	revokedAt?: string;
};

export type RemoteRoomState = {
	config: RemoteRoomConfig;
	effectiveMode: RemoteAgentMode;
	effectiveInternet: boolean;
	roomWorkspace: string | null;
	tokens: RemoteTokenInfo[];
	mcpUrl: string | null;
};

export type RemoteStatus = {
	running: boolean;
	url?: string;
	enabledRooms: string[];
	connections: number;
};

export type DeviceCodeResult = {
	code: { code: string; roomId: string; label?: string; expiresAt: string };
	mcpUrl: string | null;
};

export async function getRemoteAgentStatus(): Promise<{ status: RemoteStatus }> {
	return requestJson<{ status: RemoteStatus }>("/api/chat/remote-agent/status");
}

export async function getRemoteRoomState(roomId: string): Promise<RemoteRoomState> {
	return requestJson<RemoteRoomState>(`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}`);
}

export async function patchRemoteRoomConfig(
	roomId: string,
	patch: {
		enabled?: boolean;
		mode?: RemoteAgentMode;
		runtime?: RemoteAgentRuntime;
		sandboxPath?: string;
		modules?: Partial<Record<RemoteAgentModuleName, boolean>>;
		defaultProfile?: string;
		allowedProfiles?: string[];
		allowInternet?: boolean;
	},
): Promise<RemoteRoomState> {
	return requestJson<RemoteRoomState>(`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(patch),
	});
}

export async function postRemoteDeviceCode(roomId: string, label?: string): Promise<DeviceCodeResult> {
	return requestJson<DeviceCodeResult>(`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}/codes`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(label ? { label } : {}),
	});
}

export type DirectTokenResult = {
	token: string;
	info: RemoteTokenInfo;
	mcpUrl: string | null;
};

export async function postRemoteToken(roomId: string, label?: string): Promise<DirectTokenResult> {
	return requestJson<DirectTokenResult>(`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}/tokens`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(label ? { label } : {}),
	});
}

export type RemoteToolCallTransport = "mcp" | "rest";

export type RemoteToolCallRecord = {
	id: number;
	toolCallId: string;
	roomId: string;
	tokenId: string;
	label: string;
	transport: RemoteToolCallTransport;
	toolName: string;
	argsJson: string;
	ok: boolean;
	resultText?: string;
	resultJson?: string;
	error?: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
};

export async function listRemoteToolCalls(roomId: string, limit = 100): Promise<{ toolCalls: RemoteToolCallRecord[] }> {
	return requestJson<{ toolCalls: RemoteToolCallRecord[] }>(
		`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}/tool-calls?limit=${encodeURIComponent(String(limit))}`,
	);
}

export async function deleteRemoteToken(roomId: string, tokenId: string): Promise<{ revoked: boolean }> {
	return requestJson<{ revoked: boolean }>(
		`/api/chat/remote-agent/rooms/${encodeURIComponent(roomId)}/tokens/${encodeURIComponent(tokenId)}`,
		{ method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
	);
}
