import { PiboWebHttpError } from "../../web/http.js";

export const CHAT_WEB_API_PREFIX = "/api/chat";

export type RoomResourcePath = { roomId: string; child?: "events" | "messages" | "read" };
export type WorkflowDraftActionResource = { draftId: string; action: "validate" | "publish" };
export type WorkflowVersionResource = { workflowId: string; version?: string };
export type ProjectResourcePath = { projectId: string; child?: string };
export type ProjectWorkflowSessionResource = { projectId: string; piboSessionId: string };
export type SessionActionResource = { piboSessionId: string; action: "read" | "kill" | "kill-all" };
export type SignalResource = { kind: "session" | "tree"; piboSessionId: string };

export function roomResourcePath(pathname: string): RoomResourcePath | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/rooms/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname
		.slice(prefix.length)
		.split("/")
		.filter((part) => part.length > 0);
	if (parts.length < 1 || parts.length > 2) return undefined;
	try {
		const roomId = decodeURIComponent(parts[0]);
		const child = parts[1] ? (decodeURIComponent(parts[1]) as "events" | "messages" | "read") : undefined;
		if (child && child !== "events" && child !== "messages" && child !== "read") return undefined;
		return { roomId, child };
	} catch {
		throw new PiboWebHttpError("Invalid room id", 400);
	}
}

export function agentResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/agents/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid agent id", 400);
	}
}

export function workflowPickerKind(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/pickers/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedKind = pathname.slice(prefix.length);
	if (!encodedKind || encodedKind.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedKind);
	} catch {
		throw new PiboWebHttpError("Invalid workflow picker kind", 400);
	}
}

export function workflowPromptAssetResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/prompt-assets/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow prompt asset id", 400);
	}
}

export function workflowDraftResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/drafts/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow draft id", 400);
	}
}

export function workflowDraftActionResource(pathname: string): WorkflowDraftActionResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/drafts/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
	try {
		const action = decodeURIComponent(parts[1]);
		if (action !== "validate" && action !== "publish") return undefined;
		return { draftId: decodeURIComponent(parts[0]), action };
	} catch {
		throw new PiboWebHttpError("Invalid workflow draft action", 400);
	}
}

export function workflowDuplicateResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	const suffix = "/duplicate";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedId = pathname.slice(prefix.length, -suffix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

export function workflowNextDraftResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	const suffix = "/drafts";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedId = pathname.slice(prefix.length, -suffix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

export function workflowArchiveResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	const suffix = "/archive";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedId = pathname.slice(prefix.length, -suffix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

export function workflowVersionResource(pathname: string): WorkflowVersionResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 2 && parts.length !== 3) return undefined;
	if (!parts[0] || parts[1] !== "versions" || (parts.length === 3 && !parts[2])) return undefined;
	try {
		return {
			workflowId: decodeURIComponent(parts[0]),
			...(parts[2] ? { version: decodeURIComponent(parts[2]) } : {}),
		};
	} catch {
		throw new PiboWebHttpError("Invalid workflow version route", 400);
	}
}

export function workflowCatalogResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		const workflowId = decodeURIComponent(encodedId);
		if (workflowId === "drafts" || workflowId === "pickers" || workflowId === "lifecycle-events") return undefined;
		return workflowId;
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

export function piPackageResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/pi-packages/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid Pi package id", 400);
	}
}

export function mcpServerResourceName(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/mcp-servers/`;
	const suffix = "/description";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedName = pathname.slice(prefix.length, -suffix.length);
	if (!encodedName || encodedName.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedName);
	} catch {
		throw new PiboWebHttpError("Invalid MCP server name", 400);
	}
}

export function userSkillResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/user-skills/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid user skill id", 400);
	}
}

export function projectResourcePath(pathname: string): ProjectResourcePath | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/projects/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
	if (!parts[0]) return undefined;
	return { projectId: parts[0], ...(parts[1] ? { child: parts[1] } : {}) };
}

export function projectWorkflowSessionStartResource(pathname: string): ProjectWorkflowSessionResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/projects/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 4 || !parts[0] || parts[1] !== "workflow-sessions" || !parts[2] || parts[3] !== "start") return undefined;
	try {
		return { projectId: decodeURIComponent(parts[0]), piboSessionId: decodeURIComponent(parts[2]) };
	} catch {
		throw new PiboWebHttpError("Invalid Project workflow session start path", 400);
	}
}

export function projectWorkflowHumanActionsResource(pathname: string): ProjectWorkflowSessionResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/projects/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 4 || !parts[0] || parts[1] !== "workflow-sessions" || !parts[2] || parts[3] !== "human-actions") return undefined;
	try {
		return { projectId: decodeURIComponent(parts[0]), piboSessionId: decodeURIComponent(parts[2]) };
	} catch {
		throw new PiboWebHttpError("Invalid Project workflow human-action path", 400);
	}
}

export function projectSessionResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/project-sessions/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	return decodeURIComponent(encodedId);
}

export function sessionResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/sessions/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid session id", 400);
	}
}

export function sessionActionResource(pathname: string): SessionActionResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/sessions/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 2 || !parts[0]) return undefined;
	const action = parts[1];
	if (action !== "read" && action !== "kill" && action !== "kill-all") return undefined;
	try {
		return { piboSessionId: decodeURIComponent(parts[0]), action };
	} catch {
		throw new PiboWebHttpError("Invalid session id", 400);
	}
}

export function signalResource(pathname: string): SignalResource | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/signals/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const [kind, encodedId, extra] = pathname.slice(prefix.length).split("/");
	if (extra || (kind !== "session" && kind !== "tree") || !encodedId) return undefined;
	try {
		return { kind, piboSessionId: decodeURIComponent(encodedId) };
	} catch {
		throw new PiboWebHttpError("Invalid session id", 400);
	}
}
