export type PreviewExposureState = "active" | "expired" | "closed";
export type PreviewHealthState = "online" | "offline" | "expired" | "closed";

export type PreviewExposure = {
	id: string;
	piboSessionId: string;
	projectId?: string;
	label: string;
	targetHost: "127.0.0.1" | "::1";
	targetPort: number;
	targetProcessId?: number;
	targetProcessStartTicks?: string;
	workspace: string;
	createdAt: string;
	expiresAt: string;
	closedAt?: string;
};

export type CreatePreviewExposureInput = {
	id: string;
	piboSessionId: string;
	projectId?: string;
	label: string;
	targetHost: PreviewExposure["targetHost"];
	targetPort: number;
	targetProcessId?: number;
	targetProcessStartTicks?: string;
	workspace: string;
	createdAt: string;
	expiresAt: string;
};

export type PreviewTicket = {
	token: string;
	previewId: string;
	expiresAt: string;
};

export type PreviewBrowserSession = {
	token: string;
	previewId: string;
	expiresAt: string;
};

export type PublicPreviewExposure = Omit<PreviewExposure, "workspace" | "targetProcessId" | "targetProcessStartTicks"> & {
	state: PreviewExposureState;
	health: PreviewHealthState;
	publicUrl: string;
	openUrl: string;
};
