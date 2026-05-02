import type { AgentCatalog, BootstrapData, CreateSessionData, CustomAgent, PiboRoom, PiboSession, PiboSessionTraceView } from "./types";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	absolutePath: string;
	source: "plugin" | "managed";
	scope: "global" | "agent";
	agentProfileName?: string;
	managed: boolean;
	dynamic: boolean;
	editable: boolean;
	removable: boolean;
	exists: boolean;
	bytes?: number;
	updatedAt?: string;
	version?: string;
	sourceRef?: string;
	sourceHash?: string;
	linkState: "plugin-only" | "linked-clean" | "linked-dirty" | "linked-stale" | "orphaned" | "managed-unlinked";
	activeRevisionId?: string;
};

export type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

export type ContextFileRevision = {
	id: string;
	kind: "source-snapshot" | "working";
	contentHash: string;
	createdAt: string;
	actorId?: string;
	basedOnRevisionId?: string;
	sourceHashAtCreation?: string;
	note?: string;
	content: string;
	active: boolean;
};

export type ContextFileDiff = {
	base: { kind: "source" | "working"; contentHash?: string };
	target: { kind: "source" | "working"; contentHash?: string };
	chunks: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>;
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

export type BasePromptMode = "library" | "custom";

export type BasePromptSnapshot = {
	mode: BasePromptMode;
	effectiveMode: BasePromptMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
};

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
	return requestJson<Partial<BootstrapData>>(`/api/chat/bootstrap${suffix}`).then(normalizeBootstrap);
}

export async function getTrace(
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number; knownVersion?: string } = {},
): Promise<{ trace?: PiboSessionTraceView; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.includeRawEvents) params.set("includeRawEvents", "true");
	if (options.rawEventsLimit) params.set("rawEventsLimit", String(options.rawEventsLimit));
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

export async function postSession(profile?: string, roomId?: string): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>("/api/chat/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...(profile ? { profile } : {}), ...(roomId ? { roomId } : {}) }),
	});
}

export async function getAgentCatalog(): Promise<{
	catalog: AgentCatalog;
	profiles: Array<{ name: string; description?: string; aliases: string[] }>;
}> {
	return requestJson("/api/chat/agent-catalog");
}

export async function getCustomAgents(): Promise<{ agents: CustomAgent[] }> {
	return requestJson("/api/chat/agents");
}

export async function getBasePrompt(): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt")).basePrompt;
}

export async function setBasePromptMode(mode: BasePromptMode): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ mode }),
	})).basePrompt;
}

export async function saveCustomBasePrompt(markdown: string): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt/custom", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown }),
	})).basePrompt;
}

export async function postContextFile(input: {
	label: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<{
	file: ContextFileDocument;
}> {
	return requestJson("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function listContextFiles(): Promise<ContextFileInfo[]> {
	return (await requestJson<{ files: ContextFileInfo[] }>("/api/context-files")).files;
}

export async function readContextFile(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`)).file;
}

export async function createContextFile(input: {
	label?: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function linkContextFileFromPlugin(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string } = {},
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/link-from-plugin`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function saveContextFile(
	key: string,
	input: { markdown: string; expectedVersion?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function updateContextFileMetadata(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function removeContextFile(key: string, deleteFile: boolean): Promise<void> {
	await requestJson(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ deleteFile }),
	});
}

export async function listContextFileRevisions(key: string): Promise<{ revisions: ContextFileRevision[]; activeRevisionId?: string }> {
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/revisions`);
}

export async function diffContextFile(
	key: string,
	base: "source" | "working" = "source",
	target: "source" | "working" = "working",
): Promise<ContextFileDiff> {
	const params = new URLSearchParams({ base, target });
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/diff?${params.toString()}`);
}

export async function resetContextFileToSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/reset-to-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function adoptContextFileSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/adopt-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function restoreContextFileRevision(key: string, revisionId: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/restore-revision`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ revisionId }),
	})).file;
}

export type SaveCustomAgentInput = {
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgent["subagents"];
	mcpServers: string[];
	piPackages: string[];
	builtinTools: "default" | "disabled";
	builtinToolNames: string[];
	autoContextFiles: boolean;
	runControl: boolean;
};

export async function postCustomAgent(input: SaveCustomAgentInput): Promise<{ agent: CustomAgent }> {
	return requestJson("/api/chat/agents", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchCustomAgent(
	id: string,
	input: Partial<SaveCustomAgentInput> & { archived?: boolean },
): Promise<{ agent: CustomAgent }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteCustomAgent(id: string, confirmName: string): Promise<{ deletedAgentId: string; deletedSessionIds: string[] }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmName }),
	});
}

export async function patchMcpServerDescription(name: string, description: string): Promise<{
	server: AgentCatalog["mcpServers"][number];
}> {
	return requestJson(`/api/chat/mcp-servers/${encodeURIComponent(name)}/description`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ description }),
	});
}

export async function postPiPackage(source: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>("/api/chat/pi-packages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ source }),
	})).package;
}

export async function patchPiPackage(
	id: string,
	input: { enabled: boolean },
): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).package;
}

export async function deletePiPackage(id: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ removedPackage: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).removedPackage;
}

export async function postRoom(input: { name: string; topic?: string }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>("/api/chat/rooms", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchRoom(roomId: string, input: { name?: string; topic?: string | null; archived?: boolean }): Promise<{ room: PiboRoom }> {
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
	input: { title?: string | null; archived?: boolean; profile?: string },
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
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
		customAgents: payload.customAgents ?? [],
		agentCatalog: payload.agentCatalog
			? {
				...payload.agentCatalog,
				piboTools: payload.agentCatalog.piboTools ?? [],
				piPackages: (payload.agentCatalog.piPackages ?? []).map((pkg) => ({ ...pkg, enabled: pkg.enabled !== false })),
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
