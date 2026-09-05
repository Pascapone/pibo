import { requestJson } from "./api-http";

export type SessionLivePreview = {
	id: string;
	piboSessionId: string;
	label: string;
	managed: boolean;
	serverState?: "stopped" | "starting" | "running" | "stopping" | "error";
	serverStartedAt?: string;
	serverStopAt?: string;
	serverStoppedAt?: string;
	createdAt: string;
	expiresAt: string;
	closedAt?: string;
	state: "active" | "expired" | "closed";
	health: "online" | "offline" | "starting" | "stopping" | "stopped" | "error" | "expired" | "closed";
	publicUrl: string;
	openUrl: string;
};

export type SessionLivePreviewList = {
	configured: boolean;
	previews: SessionLivePreview[];
};

export async function getSessionLivePreviews(
	piboSessionId: string,
	options: { signal?: AbortSignal } = {},
): Promise<SessionLivePreviewList> {
	return requestJson(`/api/previews?piboSessionId=${encodeURIComponent(piboSessionId)}`, { signal: options.signal });
}

export async function startSessionLivePreview(previewId: string): Promise<SessionLivePreview> {
	return (await requestJson<{ preview: SessionLivePreview }>(`/api/previews/${encodeURIComponent(previewId)}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).preview;
}

export async function stopSessionLivePreview(previewId: string): Promise<SessionLivePreview> {
	return (await requestJson<{ preview: SessionLivePreview }>(`/api/previews/${encodeURIComponent(previewId)}/stop`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).preview;
}

export async function removeSessionLivePreview(previewId: string): Promise<{ removed: true; preview: SessionLivePreview }> {
	return requestJson(`/api/previews/${encodeURIComponent(previewId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
	});
}
