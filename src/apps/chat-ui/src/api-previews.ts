import { requestJson } from "./api-http";

export type SessionLivePreview = {
	id: string;
	piboSessionId: string;
	projectId?: string;
	label: string;
	targetHost: "127.0.0.1" | "::1";
	targetPort: number;
	workspace: string;
	createdAt: string;
	expiresAt: string;
	closedAt?: string;
	state: "active" | "expired" | "closed";
	health: "online" | "offline" | "expired" | "closed";
	publicUrl: string;
	openUrl: string;
};

export async function getSessionLivePreviews(piboSessionId: string): Promise<{ configured: boolean; previews: SessionLivePreview[] }> {
	return requestJson(`/api/previews?piboSessionId=${encodeURIComponent(piboSessionId)}`);
}

export async function closeSessionLivePreview(previewId: string): Promise<{ closed: true; preview: SessionLivePreview }> {
	return requestJson(`/api/previews/${encodeURIComponent(previewId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
	});
}
