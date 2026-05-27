import { requestJson } from "./api-http";
import type { BootstrapData, ChatSessionPage, CreateSessionData, ModelProfile, NavigationData, PiboProject, ProjectsBootstrapData, PiboRoom, PiboSession, PiboSessionTraceSummary, PiboSessionTraceView, PiboSignalPatch, PiboSignalSnapshot } from "./types";

const DOWNLOAD_FILENAME_RE = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i;

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ChatUploadedFile = {
	name: string;
	path: string;
	bytes: number;
};

export type ChatUploadResult = {
	uploadDir: string;
	files: ChatUploadedFile[];
};

export type WebAnnotationTargetSummary = {
	id: string;
	type: string;
	title: string;
	url: string;
	attachable: boolean;
};

export type WebAnnotationBindingSummary = {
	id: string;
	piboSessionId: string;
	piboRoomId?: string;
	state: string;
	url: string;
	title?: string;
	targetId?: string;
	createdAt: string;
	lastInjectedAt?: string;
	error?: string;
};

export type WebAnnotationOverlayConfig = {
	bindingId: string;
	bindingToken: string;
	piboSessionId?: string;
	apiBaseUrl?: string;
	annotationShortcut?: string;
};

export type WebAnnotationBindingResponse = {
	ok: true;
	binding: WebAnnotationBindingSummary;
	target?: WebAnnotationTargetSummary;
	overlay?: WebAnnotationOverlayConfig;
	injected?: boolean;
	stopped?: boolean;
};

export type WebAnnotationStatus = "open" | "attached" | "acknowledged" | "applying" | "needs_review" | "resolved" | "dismissed" | "failed";

export type WebAnnotationMessageAttachment = {
	id: string;
	status: WebAnnotationStatus;
	targetKind: string;
	piboSessionId: string;
	piboRoomId?: string;
	url: string;
	label?: string;
	selector?: string;
	primaryTarget?: string;
	piboContext?: string;
	sourceHint?: string;
	sourceHints?: string[];
	position?: string;
	text?: string;
	note: string;
	createdAt: string;
};

export type WebAnnotationListResponse = {
	ok: true;
	scope?: "session" | "owner";
	annotations: WebAnnotationMessageAttachment[];
};

export type ProductEvent = {
	id?: string;
	type: string;
	source: string;
	actorId?: string;
	createdAt?: string;
	payload?: {
		key?: string;
		path?: string;
		version?: string;
		updatedAt?: string;
		[name: string]: unknown;
	};
};

export async function getBootstrap(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
	markRead = false,
): Promise<BootstrapData> {
	const params = createNavigationParams(piboSessionId, includeArchived, roomId);
	if (markRead) params.set("markRead", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<Partial<BootstrapData>>(`/api/chat/bootstrap${suffix}`).then(normalizeBootstrap);
}

export async function getNavigation(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
): Promise<NavigationData> {
	const params = createNavigationParams(piboSessionId, includeArchived, roomId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<Partial<NavigationData>>(`/api/chat/navigation${suffix}`).then(normalizeNavigation);
}

export async function getProjectsBootstrap(input: { projectId?: string; piboSessionId?: string; includeArchived?: boolean } = {}): Promise<ProjectsBootstrapData> {
	const params = new URLSearchParams();
	if (input.projectId) params.set("projectId", input.projectId);
	if (input.piboSessionId) params.set("piboSessionId", input.piboSessionId);
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<ProjectsBootstrapData>(`/api/chat/projects/bootstrap${suffix}`);
}

export async function postProject(input: { name: string; projectFolder: string; description?: string; createFolder?: boolean }): Promise<{ project: PiboProject }> {
	return requestJson<{ project: PiboProject }>("/api/chat/projects", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchProject(projectId: string, input: { name?: string; description?: string | null; archived?: boolean }): Promise<{ project: PiboProject }> {
	return requestJson<{ project: PiboProject }>(`/api/chat/projects/${encodeURIComponent(projectId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteProject(projectId: string, input: { confirmName: string; deleteFiles?: boolean }): Promise<{ deletedProjectId: string }> {
	return requestJson<{ deletedProjectId: string }>(`/api/chat/projects/${encodeURIComponent(projectId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postProjectSession(projectId: string, input: { profile?: string; workflowId?: string } = {}): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>(`/api/chat/projects/${encodeURIComponent(projectId)}/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}


export async function patchProjectSession(piboSessionId: string, input: { title?: string | null; archived?: boolean }): Promise<{ session: PiboSession }> {
	return requestJson<{ session: PiboSession }>(`/api/chat/project-sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postProjectMessage(piboSessionId: string, text: string, clientTxnId?: string): Promise<unknown> {
	return requestJson<unknown>("/api/chat/projects/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, text, ...(clientTxnId ? { clientTxnId } : {}) }),
	});
}


export async function getSessionPage(input: {
	roomId?: string;
	piboSessionId?: string;
	archived?: boolean;
	cursor?: string;
	limit?: number;
}): Promise<ChatSessionPage> {
	const params = new URLSearchParams();
	if (input.roomId) params.set("roomId", input.roomId);
	if (input.piboSessionId) params.set("piboSessionId", input.piboSessionId);
	if (input.archived) params.set("archived", "true");
	if (input.cursor) params.set("cursor", input.cursor);
	if (input.limit) params.set("limit", String(input.limit));
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<ChatSessionPage>(`/api/chat/sessions${suffix}`);
}

export async function getTraceSummary(piboSessionId: string, knownVersion?: string): Promise<{ summary?: PiboSessionTraceSummary; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	const response = await fetch(`/api/chat/trace/summary?${params.toString()}`, {
		headers: knownVersion ? { "if-none-match": toEtag(knownVersion) } : undefined,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		summary: payload as PiboSessionTraceSummary,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceSummary).version,
	};
}

export async function getTrace(
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number; eventLimit?: number; beforeSequence?: number; pageSize?: number; knownVersion?: string } = {},
): Promise<{ trace?: PiboSessionTraceView; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.includeRawEvents) params.set("includeRawEvents", "true");
	if (options.rawEventsLimit) params.set("rawEventsLimit", String(options.rawEventsLimit));
	if (options.pageSize) params.set("pageSize", String(options.pageSize));
	if (options.beforeSequence !== undefined) params.set("beforeSequence", String(options.beforeSequence));
	else if (options.eventLimit) params.set("eventLimit", String(options.eventLimit));
	const response = await fetch(`/api/chat/trace?${params.toString()}`, {
		headers: options.knownVersion ? { "if-none-match": toEtag(options.knownVersion) } : undefined,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? options.knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		trace: payload as PiboSessionTraceView,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceView).version,
	};
}

export async function fetchSessionSignals(piboSessionId: string): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/session/${encodeURIComponent(piboSessionId)}`);
}

export async function fetchSignalTree(piboSessionId: string): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/tree/${encodeURIComponent(piboSessionId)}`);
}

export function subscribeSignalTree(
	rootPiboSessionId: string,
	handlers: {
		onSnapshot?: (snapshot: PiboSignalSnapshot) => void;
		onPatch?: (patch: PiboSignalPatch) => void;
		onError?: (event: Event) => void;
	},
): () => void {
	const params = new URLSearchParams({ rootPiboSessionId });
	const events = new EventSource(`/api/chat/signals/events?${params.toString()}`);
	events.addEventListener("signal_snapshot", (message) => handlers.onSnapshot?.(JSON.parse((message as MessageEvent).data) as PiboSignalSnapshot));
	events.addEventListener("signal_patch", (message) => handlers.onPatch?.(JSON.parse((message as MessageEvent).data) as PiboSignalPatch));
	events.onerror = (event) => handlers.onError?.(event);
	return () => events.close();
}

export async function postSession(profile?: string, roomId?: string): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>("/api/chat/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...(profile ? { profile } : {}), ...(roomId ? { roomId } : {}) }),
	});
}

export async function markSessionRead(piboSessionId: string): Promise<{ ok: true; piboSessionId: string }> {
	return requestJson<{ ok: true; piboSessionId: string }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}/read`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function markRoomRead(roomId: string): Promise<{ ok: true; roomId: string; readSessionIds: string[] }> {
	return requestJson<{ ok: true; roomId: string; readSessionIds: string[] }>(`/api/chat/rooms/${encodeURIComponent(roomId)}/read`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function postRoom(input: { name: string; topic?: string; workspace?: string | null }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>("/api/chat/rooms", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchRoom(roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null; archived?: boolean }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>(`/api/chat/rooms/${encodeURIComponent(roomId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteRoom(roomId: string, confirmName: string): Promise<{ deletedRoomIds: string[]; deletedSessionIds: string[] }> {
	return requestJson<{ deletedRoomIds: string[]; deletedSessionIds: string[] }>(`/api/chat/rooms/${encodeURIComponent(roomId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmName }),
	});
}

export async function patchSession(
	piboSessionId: string,
	input: { title?: string | null; archived?: boolean; profile?: string; activeModel?: ModelProfile | null },
): Promise<{ session: PiboSession }> {
	return requestJson<{ session: PiboSession }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteSession(
	piboSessionId: string,
	confirmText: string,
): Promise<{ deletedSessionIds: string[] }> {
	return requestJson<{ deletedSessionIds: string[] }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmText }),
	});
}

export async function postMessage(
	piboSessionId: string,
	text: string,
	clientTxnId: string,
	roomId?: string,
	webAnnotationIds: readonly string[] = [],
	fileAttachmentPaths: readonly string[] = [],
): Promise<unknown> {
	return requestJson("/api/chat/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			piboSessionId,
			text,
			clientTxnId,
			...(roomId ? { roomId } : {}),
			...(webAnnotationIds.length ? { webAnnotationIds } : {}),
			...(fileAttachmentPaths.length ? { fileAttachmentPaths } : {}),
		}),
	});
}

export async function listWebAnnotations(piboSessionId: string, input: { status?: WebAnnotationStatus; limit?: number; scope?: "session" | "owner" } = {}): Promise<WebAnnotationListResponse> {
	const params = new URLSearchParams({ piboSessionId });
	if (input.status) params.set("status", input.status);
	if (input.limit) params.set("limit", String(input.limit));
	if (input.scope) params.set("scope", input.scope);
	return requestJson<WebAnnotationListResponse>(`/api/web-annotations?${params.toString()}`);
}

export async function patchWebAnnotation(annotationId: string, input: { piboSessionId: string; status?: WebAnnotationStatus; summary?: string | null }): Promise<{ ok: true; annotation: WebAnnotationMessageAttachment }> {
	return requestJson<{ ok: true; annotation: WebAnnotationMessageAttachment }>(`/api/web-annotations/${encodeURIComponent(annotationId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function listWebAnnotationTargets(cdpUrl?: string): Promise<{ ok: true; targets: WebAnnotationTargetSummary[] }> {
	const params = new URLSearchParams();
	if (cdpUrl?.trim()) params.set("cdpUrl", cdpUrl.trim());
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<{ ok: true; targets: WebAnnotationTargetSummary[] }>(`/api/web-annotations/targets${suffix}`);
}

export async function createWebAnnotationBinding(input: {
	piboSessionId: string;
	piboRoomId?: string;
	url?: string;
	title?: string;
	targetId?: string;
	cdpUrl?: string;
	sameOrigin?: boolean;
	annotationShortcut?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>("/api/web-annotations/bindings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function injectWebAnnotationBinding(bindingId: string, input: {
	piboSessionId: string;
	piboRoomId?: string;
	cdpUrl?: string;
	annotationShortcut?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>(`/api/web-annotations/bindings/${encodeURIComponent(bindingId)}/inject`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function postAction(piboSessionId: string, action: string, params?: unknown): Promise<unknown> {
	return requestJson("/api/chat/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, action, params }),
	});
}

export async function uploadChatFiles(files: readonly File[]): Promise<ChatUploadResult> {
	const form = new FormData();
	for (const file of files) form.append("files", file, file.name);
	const response = await fetch("/api/chat/upload", {
		method: "POST",
		body: form,
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Upload failed";
		throw new Error(message);
	}
	return response.json() as Promise<ChatUploadResult>;
}

export async function downloadChatFile(path: string, options: { piboSessionId?: string; roomId?: string } = {}): Promise<void> {
	const params = new URLSearchParams({ path });
	if (options.piboSessionId) params.set("piboSessionId", options.piboSessionId);
	if (options.roomId) params.set("roomId", options.roomId);
	const response = await fetch(`/api/chat/download?${params.toString()}`);
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Download failed";
		throw new Error(message);
	}
	const blob = await response.blob();
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = downloadFilename(response.headers.get("content-disposition"));
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(href);
}

function downloadFilename(contentDisposition: string | null): string {
	const match = contentDisposition?.match(DOWNLOAD_FILENAME_RE);
	const encoded = match?.[1];
	if (encoded) return decodeURIComponent(encoded);
	return match?.[2] ?? "download";
}

export async function signOut(): Promise<void> {
	await fetch("/api/auth/sign-out", {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function signInWithGoogle(): Promise<void> {
	const callbackURL = location.pathname.startsWith("/apps/chat")
		? `${location.pathname}${location.search}`
		: "/apps/chat";
	const response = await fetch("/api/auth/sign-in/social", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "google", callbackURL, disableRedirect: true }),
	});
	const data = (await response.json()) as { url?: string; error?: string; message?: string };
	if (!response.ok || !data.url) throw new Error(data.message || data.error || "Could not start Google sign in.");
	location.href = data.url;
}

function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== "")) as Partial<T>;
}

function createNavigationParams(piboSessionId?: string, includeArchived = false, roomId?: string): URLSearchParams {
	const params = new URLSearchParams();
	if (piboSessionId) params.set("piboSessionId", piboSessionId);
	if (includeArchived) params.set("includeArchived", "true");
	if (roomId) params.set("roomId", roomId);
	return params;
}

function normalizeNavigation(payload: Partial<NavigationData>): NavigationData {
	if (!payload.session) throw new Error("Invalid navigation response.");
	const sessions = payload.sessions ?? [];
	const selectedPiboSessionId = payload.selectedPiboSessionId ?? payload.session.id ?? sessions[0]?.piboSessionId ?? "";
	return {
		identity: payload.identity ?? { userId: "" },
		session: payload.session,
		runtimeStatus: payload.runtimeStatus,
		room: payload.room,
		selectedRoomId: payload.selectedRoomId ?? "",
		selectedPiboSessionId,
		rooms: payload.rooms ?? [],
		sessions,
	};
}

function normalizeBootstrap(payload: Partial<BootstrapData>): BootstrapData {
	const navigation = normalizeNavigation(payload);
	return {
		...navigation,
		agents: payload.agents ?? [],
		customAgents: payload.customAgents ?? [],
		modelDefaults: payload.modelDefaults,
		modelCatalog: payload.modelCatalog
			? {
				providers: (payload.modelCatalog.providers ?? []).map((provider) => ({
					...provider,
					models: provider.models ?? [],
				})),
			}
			: payload.modelCatalog,
		agentCatalog: payload.agentCatalog
			? {
				...payload.agentCatalog,
				piboTools: payload.agentCatalog.piboTools ?? [],
				piPackages: (payload.agentCatalog.piPackages ?? []).map((pkg) => ({ ...pkg, enabled: pkg.enabled !== false })),
				userSkills: payload.agentCatalog.userSkills ?? [],
			}
			: payload.agentCatalog,
		capabilities: {
			actions: payload.capabilities?.actions ?? [],
		},
	};
}

function toEtag(version: string): string {
	return `"${version}"`;
}

function fromEtag(value: string | null): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (trimmed.startsWith("W/")) return fromEtag(trimmed.slice(2));
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
	return trimmed;
}


export * from "./api-agent-designer";
export * from "./api-context-files";
export * from "./api-cron";
export * from "./api-ralph";
export * from "./api-settings";
export * from "./api-workflows";
