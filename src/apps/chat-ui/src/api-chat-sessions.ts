import { requestJson } from "./api-http";
import type { BootstrapData, ChatSessionPage, CreateSessionData, ModelProfile, NavigationData, PiboProject, ProjectsBootstrapData, PiboRoom, PiboSession } from "./types";

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

export async function postAction(piboSessionId: string, action: string, params?: unknown): Promise<unknown> {
	return requestJson("/api/chat/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, action, params }),
	});
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
