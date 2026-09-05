export type PreviewExposureState = "active" | "expired" | "closed";
export type PreviewHealthState = "online" | "offline" | "starting" | "stopping" | "stopped" | "error" | "expired" | "closed";
export type PreviewManagementMode = "external" | "managed";
export type PreviewProxyMode = "standard" | "pibo-compute-dev-auth";
export type ManagedPreviewServerState = "stopped" | "starting" | "running" | "stopping" | "error";
export type PreviewManagerKind = "systemd" | "process";

export type PreviewExposure = {
	id: string;
	piboSessionId: string;
	label: string;
	targetHost: "127.0.0.1" | "::1";
	targetPort: number;
	targetProcessId?: number;
	targetProcessStartTicks?: string;
	workspace: string;
	managementMode: PreviewManagementMode;
	proxyMode: PreviewProxyMode;
	startCommand?: string;
	serverState?: ManagedPreviewServerState;
	serverGeneration?: string;
	serverStartedAt?: string;
	serverStopAt?: string;
	serverStoppedAt?: string;
	serverError?: string;
	managerKind?: PreviewManagerKind;
	managerId?: string;
	managerPid?: number;
	managerProcessStartTicks?: string;
	createdAt: string;
	expiresAt: string;
	closedAt?: string;
};

export type CreatePreviewExposureInput = {
	id: string;
	piboSessionId: string;
	label: string;
	targetHost: PreviewExposure["targetHost"];
	targetPort: number;
	targetProcessId?: number;
	targetProcessStartTicks?: string;
	workspace: string;
	managementMode?: PreviewManagementMode;
	proxyMode?: PreviewProxyMode;
	startCommand?: string;
	serverState?: ManagedPreviewServerState;
	createdAt: string;
	expiresAt: string;
};

export type PreviewManagerIdentity = {
	kind: PreviewManagerKind;
	id: string;
	pid?: number;
	processStartTicks?: string;
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

export type PublicPreviewExposure = Omit<PreviewExposure,
	| "workspace"
	| "startCommand"
	| "targetHost"
	| "targetPort"
	| "managementMode"
	| "proxyMode"
	| "targetProcessId"
	| "targetProcessStartTicks"
	| "serverError"
	| "serverGeneration"
	| "managerKind"
	| "managerId"
	| "managerPid"
	| "managerProcessStartTicks"
> & {
	managed: boolean;
	state: PreviewExposureState;
	health: PreviewHealthState;
	publicUrl: string;
	openUrl: string;
};
