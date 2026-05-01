import type { BootstrapData, CreateSessionData, PiboRoom, PiboSession, PiboSessionTraceView } from "./types";

export async function getBootstrap(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
	markRead = false,
): Promise<BootstrapData> {
	const params = new URLSearchParams();
	if (piboSessionId) params.set("piboSessionId", piboSessionId);
	if (includeArchived) params.set("includeArchived", "true");
	if (roomId) params.set("roomId", roomId);
	if (markRead) params.set("markRead", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return normalizeBootstrap(await requestJson<Partial<BootstrapData>>(`/api/chat/bootstrap${suffix}`));
}

export async function getTrace(piboSessionId: string): Promise<PiboSessionTraceView> {
	return requestJson<PiboSessionTraceView>(`/api/chat/trace?piboSessionId=${encodeURIComponent(piboSessionId)}`);
}

export async function postSession(profile?: string, roomId?: string): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>("/api/chat/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...(profile ? { profile } : {}), ...(roomId ? { roomId } : {}) }),
	});
}

export async function postRoom(input: { name: string; topic?: string }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>("/api/chat/rooms", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchRoom(roomId: string, input: { name?: string; topic?: string | null }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>(`/api/chat/rooms/${encodeURIComponent(roomId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchSession(
	piboSessionId: string,
	input: { title?: string | null; archived?: boolean },
): Promise<{ session: PiboSession }> {
	return requestJson<{ session: PiboSession }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postMessage(piboSessionId: string, text: string, clientTxnId: string, roomId?: string): Promise<unknown> {
	return requestJson("/api/chat/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, text, clientTxnId, ...(roomId ? { roomId } : {}) }),
	});
}

export async function postAction(piboSessionId: string, action: string, params?: unknown): Promise<unknown> {
	return requestJson("/api/chat/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, action, params }),
	});
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
	const response = await fetch("/api/auth/sign-in/social", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "google", callbackURL: "/apps/chat", disableRedirect: true }),
	});
	const data = (await response.json()) as { url?: string; error?: string; message?: string };
	if (!response.ok || !data.url) throw new Error(data.message || data.error || "Could not start Google sign in.");
	location.href = data.url;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		throw new Error(message);
	}
	return payload as T;
}

function normalizeBootstrap(payload: Partial<BootstrapData>): BootstrapData {
	if (!payload.session) throw new Error("Invalid bootstrap response.");
	const sessions = payload.sessions ?? [];
	const selectedPiboSessionId = payload.selectedPiboSessionId ?? payload.session.id ?? sessions[0]?.piboSessionId ?? "";
	return {
		identity: payload.identity ?? { userId: "" },
		session: payload.session,
		room: payload.room,
		selectedRoomId: payload.selectedRoomId ?? "",
		selectedPiboSessionId,
		rooms: payload.rooms ?? [],
		sessions,
		agents: payload.agents ?? [],
		capabilities: {
			actions: payload.capabilities?.actions ?? [],
		},
	};
}
