import type { NavigateOptions } from "@tanstack/react-router";
import { parseChatSessionViewId, type ChatSessionViewId } from "./session-views/types";
import type { SettingsPanel } from "./settings/types";

export type ChatAppRoute =
	| { area: "sessions"; roomId?: string; piboSessionId?: string; sessionViewId?: ChatSessionViewId }
	| { area: "projects"; projectId?: string; piboSessionId?: string; sessionViewId?: ChatSessionViewId }
	| { area: "workflows"; draftId?: string; viewWorkflowId?: string; viewWorkflowVersion?: string }
	| { area: "agents" }
	| { area: "cron" }
	| { area: "ralph" }
	| { area: "context"; piboSessionId?: string }
	| { area: "settings"; panel?: SettingsPanel };

export type NavigationOptions = {
	closeMobileSidebar?: boolean;
};

type SessionViewSearch = { view: ChatSessionViewId };
type ContextSearch = { piboSessionId?: string };

type SettingsNavigationTo = "/settings/shortcuts" | "/settings/pi-packages" | "/settings/skills" | "/settings/providers" | "/settings";

type ChatRouteNavigationRequest =
	| { to: "/projects/$projectId/sessions/$piboSessionId"; params: { projectId: string; piboSessionId: string }; search: SessionViewSearch; replace: boolean }
	| { to: "/projects/$projectId"; params: { projectId: string }; search: SessionViewSearch; replace: boolean }
	| { to: "/projects"; search: SessionViewSearch; replace: boolean }
	| { to: "/workflows/drafts/$draftId"; params: { draftId: string }; replace: boolean }
	| { to: "/workflows"; replace: boolean }
	| { to: "/agents"; replace: boolean }
	| { to: "/cron"; replace: boolean }
	| { to: "/ralph"; replace: boolean }
	| { to: "/context"; search: ContextSearch; replace: boolean }
	| { to: "/settings/shortcuts"; replace: boolean }
	| { to: "/settings/pi-packages"; replace: boolean }
	| { to: "/settings/skills"; replace: boolean }
	| { to: "/settings/providers"; replace: boolean }
	| { to: "/settings"; replace: boolean }
	| { to: "/rooms/$roomId/sessions/$piboSessionId"; params: { roomId: string; piboSessionId: string }; search: SessionViewSearch; replace: boolean }
	| { to: "/rooms/$roomId"; params: { roomId: string }; search: SessionViewSearch; replace: boolean }
	| { to: "/sessions/$piboSessionId"; params: { piboSessionId: string }; search: SessionViewSearch; replace: boolean }
	| { to: "/"; search: SessionViewSearch; replace: boolean };

export function chatRouteFromLocation(pathname: string, search: Record<string, unknown>): ChatAppRoute {
	const path = pathname.startsWith("/apps/chat") ? pathname.slice("/apps/chat".length) || "/" : pathname;
	const contextPiboSessionId = typeof search.piboSessionId === "string" && search.piboSessionId.trim() ? search.piboSessionId.trim() : undefined;
	const parts = path
		.split("/")
		.filter(Boolean)
		.map((part) => decodeURIComponent(part));
	const sessionViewId = parseChatSessionViewId(search.view);
	if (parts[0] === "context") return { area: "context", ...(contextPiboSessionId ? { piboSessionId: contextPiboSessionId } : {}) };
	if (parts[0] === "workflows" && parts[1] === "drafts" && parts[2]) return { area: "workflows", draftId: parts[2] };
	if (parts[0] === "workflows" && parts[1] === "view" && parts[2] && parts[3]) return { area: "workflows", viewWorkflowId: parts[2], viewWorkflowVersion: parts[3] };
	if (parts[0] === "workflows") return { area: "workflows" };
	if (parts[0] === "agents") return { area: "agents" };
	if (parts[0] === "cron") return { area: "cron" };
	if (parts[0] === "ralph") return { area: "ralph" };
	if (parts[0] === "settings") return { area: "settings", panel: settingsPanelFromPathPart(parts[1]) };
	if (parts[0] === "projects" && parts[1] && parts[2] === "sessions" && parts[3]) {
		return { area: "projects", projectId: parts[1], piboSessionId: parts[3], sessionViewId };
	}
	if (parts[0] === "projects" && parts[1]) return { area: "projects", projectId: parts[1], sessionViewId };
	if (parts[0] === "projects") return { area: "projects", sessionViewId };
	if (parts[0] === "rooms" && parts[1] && parts[2] === "sessions" && parts[3]) {
		return { area: "sessions", roomId: parts[1], piboSessionId: parts[3], sessionViewId };
	}
	if (parts[0] === "rooms" && parts[1]) return { area: "sessions", roomId: parts[1], sessionViewId };
	if (parts[0] === "sessions" && parts[1]) return { area: "sessions", piboSessionId: parts[1], sessionViewId };
	return { area: "sessions", sessionViewId };
}

export function chatNavigationRequest(target: ChatAppRoute, replace: boolean, nextSessionViewId: ChatSessionViewId): ChatRouteNavigationRequest {
	const sessionViewSearch = { view: nextSessionViewId };
	if (target.area === "projects") {
		if (target.projectId && target.piboSessionId) {
			return {
				to: "/projects/$projectId/sessions/$piboSessionId",
				params: { projectId: target.projectId, piboSessionId: target.piboSessionId },
				search: sessionViewSearch,
				replace,
			};
		}
		if (target.projectId) return { to: "/projects/$projectId", params: { projectId: target.projectId }, search: sessionViewSearch, replace };
		return { to: "/projects", search: sessionViewSearch, replace };
	}
	if (target.area === "workflows") {
		if (target.draftId) return { to: "/workflows/drafts/$draftId", params: { draftId: target.draftId }, replace };
		return { to: "/workflows", replace };
	}
	if (target.area === "agents") return { to: "/agents", replace };
	if (target.area === "cron") return { to: "/cron", replace };
	if (target.area === "ralph") return { to: "/ralph", replace };
	if (target.area === "context") {
		return {
			to: "/context",
			search: target.piboSessionId ? { piboSessionId: target.piboSessionId } : {},
			replace,
		};
	}
	if (target.area === "settings") return { to: settingsPathForPanel(target.panel), replace };
	if (target.roomId && target.piboSessionId) {
		return {
			to: "/rooms/$roomId/sessions/$piboSessionId",
			params: { roomId: target.roomId, piboSessionId: target.piboSessionId },
			search: sessionViewSearch,
			replace,
		};
	}
	if (target.roomId) return { to: "/rooms/$roomId", params: { roomId: target.roomId }, search: sessionViewSearch, replace };
	if (target.piboSessionId) {
		return {
			to: "/sessions/$piboSessionId",
			params: { piboSessionId: target.piboSessionId },
			search: sessionViewSearch,
			replace,
		};
	}
	return { to: "/", search: sessionViewSearch, replace };
}

export function navigateToChatRoute(navigate: (options: NavigateOptions) => Promise<void>, target: ChatAppRoute, replace: boolean, nextSessionViewId: ChatSessionViewId): void {
	void navigate(chatNavigationRequest(target, replace, nextSessionViewId) as NavigateOptions);
}

function settingsPanelFromPathPart(part: string | undefined): SettingsPanel {
	if (part === "shortcuts") return "shortcuts";
	if (part === "pi-packages") return "pi-packages";
	if (part === "skills") return "skills";
	if (part === "providers") return "providers";
	return "general";
}

function settingsPathForPanel(panel: SettingsPanel | undefined): SettingsNavigationTo {
	if (panel === "shortcuts") return "/settings/shortcuts";
	if (panel === "pi-packages") return "/settings/pi-packages";
	if (panel === "skills") return "/settings/skills";
	if (panel === "providers") return "/settings/providers";
	return "/settings";
}
